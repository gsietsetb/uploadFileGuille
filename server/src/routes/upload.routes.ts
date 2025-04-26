import express, { Request, Response, NextFunction, Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { saveChunk, assembleFile, getChunkPath, validateFileType, calculateFileHash, cleanupOldChunks } from '../utils/fileUtils';
import Redis from 'ioredis';
import winston from 'winston';
import { createClient, RedisClientType } from 'redis';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { logger } from './../utils/logger';

const router = express.Router();

// Configuración de Redis para el seguimiento del estado de carga
let redisClient: Redis | null = null;

// Verificar si Redis está habilitado
const redisEnabled = process.env.REDIS_ENABLED === 'true';

if (redisEnabled) {
  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      retryStrategy: () => null, // Desactivar reintentos automáticos
      enableOfflineQueue: false, // Desactivar la cola offline
      maxRetriesPerRequest: 1
    });
    
    // Manejar evento de error para evitar "Unhandled error event"
    redisClient.on('error', (err) => {
      if (redisClient) {
        console.log('Redis no disponible, usando almacenamiento en memoria');
        redisClient.disconnect();
        redisClient = null;
      }
    });
    
    // Evento de conexión
    redisClient.on('connect', () => {
      console.log('Redis conectado correctamente');
    });
  } catch (err) {
    console.error('Error al inicializar Redis, usando almacenamiento en memoria:', err);
    redisClient = null;
  }
} else {
  console.log('Redis desactivado en la configuración, usando almacenamiento en memoria');
}

// Interfaz para el estado de carga
interface UploadStatus {
  totalChunks: number;
  receivedChunks: Set<number>;
  fileName: string;
  fileType: string;
  validatedFileType?: string;
  uploadStartTime: number;
  isPaused: boolean;
  isCompleted: boolean;
  filePath?: string;
  md5Hash?: string;
  error?: string;
  lastActivityTime: number;
}

// Almacenamiento en memoria alternativo cuando Redis no está disponible
const memoryUploadStatus = new Map<string, UploadStatus>();

// Logger específico para uploads
const uploadLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'upload-service' },
  transports: [
    new winston.transports.File({ filename: 'logs/uploads.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ],
});

// Configuración de Multer para almacenar archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '50000000', 10), // 50MB por defecto
  },
});

// Configuración de Multer para chunks grandes
const largeChunkStorage = multer.memoryStorage();
const uploadLargeChunk = multer({
  storage: largeChunkStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_CHUNK_SIZE || '20000000', 10), // 20MB para chunks
  },
});

// Interfaces para tipos
interface ChunkRequest extends Request {
  file?: Express.Multer.File;
}

// Función para manejar errores de forma centralizada
const handleError = (res: Response, error: any, message: string) => {
  logger.error(`${message}: ${error.message}`, { error });
  return res.status(500).json({
    error: message,
    details: error.message
  });
};

// Tipo para los datos de carga
interface UploadStatusData {
  totalChunks?: number;
  receivedChunks?: number[];
  fileName?: string;
  fileType?: string;
  validatedFileType?: string;
  isPaused?: boolean;
  isCompleted?: boolean;
  userId?: string;
  startTime?: number;
  finalPath?: string;
  md5Hash?: string;
}

// Función para guardar/actualizar estado de carga
const saveUploadStatus = async (
  fileId: string,
  data: Partial<UploadStatus>
) => {
  try {
    let statusToSave: any;
    
    if (redisClient) {
      const currentStatusString = await redisClient.get(`upload:${fileId}`);
      const currentStatus = currentStatusString ? JSON.parse(currentStatusString) : {};
      
      // Merge data, converting Set to Array for storage
      statusToSave = { ...currentStatus, ...data };
      // Ensure receivedChunks is always an array in the object to be saved
      if (data.receivedChunks instanceof Set) {
          statusToSave.receivedChunks = Array.from(data.receivedChunks);
      } else if (data.receivedChunks && Array.isArray(data.receivedChunks)) {
          statusToSave.receivedChunks = data.receivedChunks;
      } else if (currentStatus.receivedChunks && !data.receivedChunks) {
          statusToSave.receivedChunks = currentStatus.receivedChunks; // Keep existing array if not updated
      } else {
           statusToSave.receivedChunks = []; // Default to empty array
      }

      if (!statusToSave.uploadStartTime) {
        statusToSave.uploadStartTime = Date.now();
      }
      
      await redisClient.set(`upload:${fileId}`, JSON.stringify(statusToSave), 'EX', 60 * 60 * 24);
    } else {
      const current = memoryUploadStatus.get(fileId);
      const newStatus = { ...current, ...data } as UploadStatus; // Cast to UploadStatus

      // Ensure receivedChunks is a Set in memory
      if (Array.isArray(newStatus.receivedChunks)) {
          newStatus.receivedChunks = new Set(newStatus.receivedChunks);
      } else if (!newStatus.receivedChunks) {
          newStatus.receivedChunks = new Set<number>();
      } else if (!(newStatus.receivedChunks instanceof Set)) {
          // En caso de que receivedChunks exista pero no sea un Set ni un Array
          newStatus.receivedChunks = new Set<number>();
      }
      
      if (!newStatus.uploadStartTime) {
        newStatus.uploadStartTime = Date.now();
      }
      
      memoryUploadStatus.set(fileId, newStatus);
      statusToSave = newStatus; // For logging if needed
    }
     logger.debug(`Status saved for ${fileId}`, { status: statusToSave });
     return statusToSave; // Devolvemos el estado guardado para seguimiento
  } catch (error) {
    logger.error('Error al guardar estado de carga:', { error, fileId });
    throw error; // Re-lanzamos el error para manejo superior
  }
};

// Función para obtener estado de carga
const getUploadStatus = async (fileId: string): Promise<UploadStatus | null> => {
  try {
    if (redisClient) {
      const statusString = await redisClient.get(`upload:${fileId}`);
      if (!statusString) return null;
      const status = JSON.parse(statusString);
      // Convert receivedChunks array back to Set
      status.receivedChunks = new Set(status.receivedChunks || []);
      return status as UploadStatus;
    } else {
       const status = memoryUploadStatus.get(fileId);
       if (!status) return null;
       // Ensure receivedChunks is a Set (should be already, but good practice)
       if (!(status.receivedChunks instanceof Set)) {
         status.receivedChunks = new Set(Array.isArray(status.receivedChunks) ? status.receivedChunks : []);
       }
       return status;
    }
  } catch (error) {
    logger.error('Error al obtener estado de carga:', { error, fileId });
    return null;
  }
};

// Configuración de tipos permitidos (ejemplo, leer desde env vars sería mejor)
// Formato: lista de MIME types completos o prefijos (ej. 'image/')
const ALLOWED_MIME_TYPES = (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/gif,video/mp4,application/pdf').split(',');
const TEMP_DIR = path.join(__dirname, '../../uploads/.temp'); // Define TEMP_DIR correctly once, using .temp subfolder

// Middleware para validar File ID
const validateFileId = async (req: Request, res: Response, next: NextFunction) => {
    const fileId = req.params.fileId;
    if (!fileId || !/^[a-zA-Z0-9-]+$/.test(fileId)) {
        logger.warn(`Invalid fileId format received: ${fileId}`);
        return res.status(400).json({ message: 'Invalid file ID format.' });
    }
    try {
        const status = await getUploadStatus(fileId);
        if (!status) {
            logger.warn(`File ID ${fileId} not found for validation.`);
            return res.status(404).json({ message: 'Upload session not found.' });
        }
        // Adjuntar el estado al request para reusarlo en la ruta
        (req as any).uploadStatus = status;
        next();
    } catch (error) {
        logger.error(`Error validating fileId ${fileId}: ${error}`);
        res.status(500).json({ message: 'Error validating upload session.' });
    }
};

/**
 * Iniciar una nueva carga
 * POST /api/upload/init
 */
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { fileName, fileSize, fileType, totalChunks, userId } = req.body;
    
    if (!fileName || !fileSize || !fileType || !totalChunks) {
      return res.status(400).json({
        error: 'Faltan parámetros requeridos (fileName, fileSize, fileType, totalChunks)'
      });
    }
    
    // Nota: La validación robusta del tipo se hará en el primer chunk.
    // Aquí podríamos hacer una validación básica si se desea.
    // const allowedTypes = ['image/', 'video/', 'application/pdf']; // Ejemplo
    // if (!allowedTypes.some(type => fileType.startsWith(type))) {
    //   uploadLogger.warn(`Tipo de archivo reportado no permitido inicialmente: ${fileType}`, { fileName });
    //   // No rechazamos aún, esperamos a la validación del chunk 0
    // }
    
    // Generar ID único para el archivo
    const fileId = crypto.randomBytes(16).toString('hex');
    
    // Guardar metadatos iniciales
    const initialStatus: UploadStatus = {
      totalChunks,
      receivedChunks: new Set<number>(),
      fileName,
      fileType, // Tipo reportado por el cliente
      isPaused: false,
      isCompleted: false,
      uploadStartTime: Date.now(),
      lastActivityTime: Date.now()
    };

    try {
      // Eliminar la conversión explícita de Set a Array, dejar initialStatus sin modificar
      await saveUploadStatus(fileId, initialStatus); // Pasar el objeto con receivedChunks como Set<number>
      logger.info(`Upload initialized for ${fileName} with fileId ${fileId}`);
      res.status(201).json({ fileId, message: 'Upload initialized successfully.' });
    } catch (error) {
      logger.error(`Error initializing upload for ${fileName}: ${error}`);
      res.status(500).json({ message: 'Failed to initialize upload session.' });
    }
  } catch (error) {
    handleError(res, error, 'Error al inicializar la carga');
  }
});

/**
 * Subir un chunk
 * POST /api/upload/chunk/:fileId/:chunkIndex
 */
router.post('/chunk/:fileId/:chunkIndex', validateFileId, (req, res, next) => {
  // Determinar qué middleware de multer usar basado en la cabecera
  const isLargeChunk = req.headers['x-large-chunk'] === 'true';
  
  if (isLargeChunk) {
    uploadLargeChunk.single('chunk')(req, res, next);
  } else {
    upload.single('chunk')(req, res, next);
  }
}, async (req: Request, res: Response) => {
  const { fileId, chunkIndex: chunkIndexStr } = req.params;
  const chunkIndex = parseInt(chunkIndexStr, 10);
  const status = (req as any).uploadStatus as UploadStatus;

  if (!req.file && !req.body.chunkData) {
    logger.warn('Intento de subir chunk sin archivo ni datos', { fileId, chunkIndex });
    return res.status(400).json({ message: 'Chunk no proporcionado' });
  }

  if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= status.totalChunks) {
    logger.warn('Índice de chunk inválido', { fileId, chunkIndex: chunkIndexStr });
    return res.status(400).json({ message: 'Índice de chunk inválido' });
  }

  try {
    if (status.isCompleted) {
      logger.info('Chunk recibido para un archivo ya completado', { fileId });
      return res.status(200).json({ message: 'Archivo ya completado' });
    }

    if (status.isPaused) {
      logger.info('Chunk recibido para un archivo pausado', { fileId });
      return res.status(409).json({ message: 'La carga está pausada' }); // 409 Conflict
    }

    // Verificar si el chunk ya fue recibido (importante para reintentos)
    if (status.receivedChunks.has(chunkIndex)) {
      logger.info('Chunk duplicado recibido', { fileId, chunkIndex });
      return res.status(200).json({ message: 'Chunk ya recibido' });
    }

    // Determinar la fuente de datos y guardar el chunk
    let chunkBuffer: Buffer;
    
    if (req.file) {
      // Si es un archivo binario
      chunkBuffer = req.file.buffer;
    } else if (req.body.chunkData) {
      // Si son datos codificados en base64
      try {
        chunkBuffer = Buffer.from(req.body.chunkData, 'base64');
      } catch (error) {
        logger.error('Error al decodificar datos base64', { fileId, chunkIndex, error });
        return res.status(400).json({ message: 'Datos de chunk inválidos' });
      }
    } else {
      logger.warn('Formato de chunk desconocido', { fileId, chunkIndex });
      return res.status(400).json({ message: 'Formato de chunk no reconocido' });
    }

    // Guardar el chunk
    await saveChunk(fileId, chunkIndex, chunkBuffer);
    logger.debug('Chunk guardado', { fileId, chunkIndex });

    // Actualizar estado
    status.receivedChunks.add(chunkIndex);
    status.lastActivityTime = Date.now();
    await saveUploadStatus(fileId, { 
      receivedChunks: status.receivedChunks,
      lastActivityTime: status.lastActivityTime 
    });

    res.status(200).json({ message: `Chunk ${chunkIndex} recibido` });

  } catch (error) {
    // Manejo de errores más robusto
    let errorMessage = 'Error desconocido al procesar el chunk';
    let errorStack: string | undefined = undefined;

    if (error instanceof Error) {
      // Si es una instancia de Error, usamos su mensaje y stack
      errorMessage = error.message;
      errorStack = error.stack;
    } else if (typeof error === 'string') {
      // Si es un string, lo usamos como mensaje
      errorMessage = error;
    } else if (error && typeof error === 'object' && 'message' in error) {
      // Si es un objeto con propiedad 'message', la usamos
      errorMessage = String(error.message);
      // Intentar obtener el stack si existe
      if ('stack' in error) {
        errorStack = String(error.stack);
      }
    } else {
      // Si no, intentar convertir el error a string
      try {
        errorMessage = JSON.stringify(error);
      } catch (stringifyError) {
        errorMessage = 'Error al procesar el chunk (no se pudo serializar el error original)';
      }
    }

    logger.error('Error al procesar chunk', { 
      fileId: fileId, 
      chunkIndex: chunkIndex, 
      originalError: errorMessage, // Usar un nombre diferente para la clave
      stack: errorStack
    });
    
    // Enviar un mensaje más específico al cliente
    res.status(500).json({ 
      message: 'Error interno al procesar el chunk',
      details: errorMessage.includes('Field value too long') ? 'Field value too long' : 'Error en el servidor'
    });
  }
});

// Función auxiliar para eliminar estado (y chunks)
const deleteUploadStatusAndChunks = async (fileId: string, status: UploadStatus | null) => {
   // Use the retrieved status if available, otherwise fetch it
   const currentStatus = status || await getUploadStatus(fileId);
   const totalChunks = currentStatus?.totalChunks || 0; // Default to 0 if status not found

  try {
    if (redisClient) {
      await redisClient.del(`upload:${fileId}`);
    } else {
      memoryUploadStatus.delete(fileId);
    }
    logger.info(`Estado de carga eliminado para fileId: ${fileId}`);

    // Eliminar chunks asociados usando la función importada
    await cleanupOldChunks(); // Call without arguments

  } catch (error) {
    logger.error('Error al eliminar estado de carga o chunks', { fileId, error: (error as Error).message });
  }
};

/**
 * Finalizar la carga y ensamblar el archivo
 * POST /api/upload/finalize/:fileId
 */
router.post('/finalize/:fileId', validateFileId, async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const status = (req as any).uploadStatus as UploadStatus;
  const { md5: clientMd5 } = req.body; // Opcional: MD5 enviado por el cliente para verificación

  if (status.isCompleted) {
    logger.warn(`Finalize called for already completed fileId ${fileId}.`);
    // Devolver la URL existente si ya está completado y el archivo existe
    if (status.filePath) { // Use filePath
      try {
        await fs.access(status.filePath); // Use filePath
        const fileUrl = `http://localhost:3001/uploads/complete/${path.basename(path.dirname(status.filePath))}/${path.basename(status.filePath)}`; 
        return res.status(200).json({ message: 'Upload already completed.', fileUrl, md5Hash: status.md5Hash });
      } catch (accessError) {
        logger.warn(`Final file path ${status.filePath} for completed upload ${fileId} not accessible. Re-assembling.`); // Use filePath
        // Si el archivo no existe, permitir re-ensamblaje (proceder)
      }
    } else {
      // Si está completado pero sin ruta final (estado inconsistente?), intentar ensamblar.
      logger.warn(`Finalize called for completed fileId ${fileId} but finalPath is missing. Attempting assembly.`);
    }
  }

  if (status.receivedChunks.size !== status.totalChunks) {
    logger.warn(`Finalize called for fileId ${fileId} before all chunks received. Received: ${status.receivedChunks.size}/${status.totalChunks}`);
    return res.status(400).json({
      message: 'Not all chunks have been uploaded.',
      receivedChunks: Array.from(status.receivedChunks).sort((a, b) => a - b), // Enviar chunks recibidos para depuración
      totalChunks: status.totalChunks
    });
  }

  const finalFileName = status.fileName; // Usar el nombre original almacenado
  // finalPath is determined within assembleFile now
  // const finalPath = path.join(TEMP_DIR, finalFileName); // Removed finalPath definition here

  try {
    // Asegurarse que la función assembleFile usa el fileId, totalChunks, fileName, fileType correctos
    const assemblyResult = await assembleFile(fileId, status.totalChunks, finalFileName, status.fileType); // Pass required arguments
    logger.info(`File ${finalFileName} (fileId: ${fileId}) assembled successfully at ${assemblyResult.path}`);

    // Calcular MD5 hash del archivo ensamblado (hash is returned by assembleFile)
    const serverMd5 = assemblyResult.hash; // Use hash from result
    logger.info(`MD5 hash calculated for ${finalFileName} (fileId: ${fileId}): ${serverMd5}`);

    // Verificar MD5 si el cliente lo envió
    if (clientMd5 && clientMd5 !== serverMd5) {
      logger.warn(`MD5 mismatch for fileId ${fileId}. Client: ${clientMd5}, Server: ${serverMd5}`);
      // Considerar eliminar el archivo ensamblado si hay mismatch? O devolver error?
      await fs.unlink(assemblyResult.path).catch(err => logger.error(`Failed to delete mismatched file ${assemblyResult.path}: ${err}`)); // Limpiar archivo incorrecto
      await deleteUploadStatusAndChunks(fileId, status); // Limpiar estado y chunks
      return res.status(400).json({ message: 'File integrity check failed (MD5 mismatch).' });
    }

    // Actualizar estado a completado
    status.isCompleted = true;
    status.filePath = assemblyResult.path; // Use filePath and path from result
    status.md5Hash = serverMd5;
    status.lastActivityTime = Date.now();

    // Pass a partial update, ensuring receivedChunks is handled by saveUploadStatus logic
    await saveUploadStatus(fileId, { 
        isCompleted: true,
        filePath: assemblyResult.path,
        md5Hash: serverMd5,
        lastActivityTime: status.lastActivityTime
        // Let saveUploadStatus handle merging/preserving receivedChunks
    });

    // Limpiar chunks temporales después de ensamblar (Handled by assembleFile internally now)
    // await cleanupOldChunks(fileId, status.totalChunks); // Removed duplicate cleanup call

    // Modificar la URL para que siempre use el puerto 3001
    const fileUrl = `http://localhost:3001${assemblyResult.url}`;
    logger.info(`Upload finalized successfully for fileId ${fileId}. URL: ${fileUrl}`);
    res.status(200).json({ message: 'File uploaded and assembled successfully.', fileUrl, md5Hash: serverMd5 });

  } catch (error) {
    logger.error(`Error finalizing upload for fileId ${fileId}: ${error}`);
    // Intentar limpiar estado incluso si falla el ensamblaje
    await deleteUploadStatusAndChunks(fileId, status).catch(delErr => logger.error(`Failed to cleanup status/chunks for failed finalization ${fileId}: ${delErr}`));
    res.status(500).json({ message: 'Failed to assemble file.' });
  }
});

/**
 * Verificar el estado de una carga
 * GET /api/upload/status/:fileId
 */
router.get('/status/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    
    // Obtener estado desde Redis/memoria
    const status = await getUploadStatus(fileId);
    
    if (!status) {
      return res.status(404).json({
        error: 'ID de carga no encontrado'
      });
    }
    
    res.status(200).json({
      fileId,
      fileName: status.fileName,
      fileType: status.fileType,
      totalChunks: status.totalChunks,
      receivedChunks: Array.from(status.receivedChunks),
      totalUploaded: status.receivedChunks.size,
      progress: Math.round((status.receivedChunks.size / status.totalChunks) * 100),
      isPaused: status.isPaused,
      isCompleted: status.isCompleted,
      startTime: status.uploadStartTime
    });
  } catch (error) {
    handleError(res, error, 'Error al verificar el estado de la carga');
  }
});

/**
 * Pausar una carga en progreso
 * PUT /api/upload/pause/:fileId
 */
router.put('/pause/:fileId', validateFileId, async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const status = (req as any).uploadStatus as UploadStatus;

  if (status.isCompleted) {
    return res.status(400).json({ message: 'Upload already completed.' });
  }
  if (status.isPaused) {
    return res.status(200).json({ message: 'Upload already paused.' });
  }

  status.isPaused = true;
  status.lastActivityTime = Date.now();

  try {
    // Pass only the changed fields
    await saveUploadStatus(fileId, { isPaused: true, lastActivityTime: status.lastActivityTime });
    logger.info(`Upload paused for fileId ${fileId}`);
    res.status(200).json({ message: 'Upload paused successfully.' });
  } catch (error) {
    logger.error(`Error pausing upload for fileId ${fileId}: ${error}`);
    res.status(500).json({ message: 'Failed to pause upload.' });
  }
});

/**
 * Reanudar una carga pausada
 * PUT /api/upload/resume/:fileId
 */
router.put('/resume/:fileId', validateFileId, async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const status = (req as any).uploadStatus as UploadStatus;

  if (status.isCompleted) {
    return res.status(400).json({ message: 'Upload already completed.' });
  }
  if (!status.isPaused) {
    return res.status(200).json({ message: 'Upload is not paused.' });
  }

  status.isPaused = false;
  status.lastActivityTime = Date.now();

  try {
    // Pass only the changed fields
    await saveUploadStatus(fileId, { isPaused: false, lastActivityTime: status.lastActivityTime });
    logger.info(`Upload resumed for fileId ${fileId}`);
    res.status(200).json({
      message: 'Upload resumed successfully.',
      // Enviar los chunks ya recibidos para que el cliente sepa qué falta
      receivedChunks: Array.from(status.receivedChunks).sort((a, b) => a - b)
    });
  } catch (error) {
    logger.error(`Error resuming upload for fileId ${fileId}: ${error}`);
    res.status(500).json({ message: 'Failed to resume upload.' });
  }
});

/**
 * Cancelar una carga
 * DELETE /api/upload/cancel/:fileId
 */
router.delete('/cancel/:fileId', validateFileId, async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const status = (req as any).uploadStatus as UploadStatus;

  logger.info(`Cancellation request received for fileId ${fileId}.`);

  try {
    // Eliminar el estado y los chunks temporales asociados
    await deleteUploadStatusAndChunks(fileId, status);

    // Si el archivo ya se había ensamblado (p.ej., cancelación después de finalizar pero antes de respuesta), eliminarlo
    if (status.filePath) { // Use filePath
      try {
        await fs.unlink(status.filePath); // Use filePath
        logger.info(`Deleted final assembled file due to cancellation: ${status.filePath}`); // Use filePath
      } catch (unlinkError: any) {
        // No fallar si el archivo no existe o no se puede eliminar, pero loguearlo
        if (unlinkError.code !== 'ENOENT') {
          logger.error(`Could not delete final file ${status.filePath} during cancellation: ${unlinkError}`); // Use filePath
        }
      }
    }

    logger.info(`Upload cancelled and cleaned up successfully for fileId ${fileId}.`);
    res.status(200).json({ message: 'Upload cancelled and cleaned up successfully.' });

  } catch (error) {
    logger.error(`Error cancelling upload for fileId ${fileId}: ${error}`);
    res.status(500).json({ message: 'Failed to cancel upload and clean up resources.' });
  }
});

// Helper Functions (Removed duplicate local helpers)
// async function saveUploadStatus(...) { ... } // Removed
// async function getUploadStatus(...) { ... } // Removed
// async function deleteUploadStatus(...) { ... } // Removed
// async function saveChunk(...) { ... } // Removed (Using import)
// async function cleanUpChunks(...) { ... } // Removed (Using import)

// --- Fin Helpers ---

// Configuración de Redis (si se usa) - Descomentado

let redisRateLimiterClient: RedisClientType | null = null; // Use separate client for rate limiter potentially
let rateLimiter: RateLimiterRedis | RateLimiterMemory | null = null;

if (process.env.USE_REDIS === 'true') {
    // Assuming redisClient (for status) is already initialized if redisEnabled
    if (redisClient && redisClient.status === 'ready') { // Check status client readiness
         rateLimiter = new RateLimiterRedis({
             storeClient: redisClient, // Reuse status client or use a dedicated one
             keyPrefix: 'rate_limit_upload',
             points: parseInt(process.env.UPLOAD_RATE_LIMIT_POINTS || '10', 10), // Limit points from env
             duration: parseInt(process.env.UPLOAD_RATE_LIMIT_DURATION || '60', 10), // Duration from env (seconds)
         });
         logger.info('Rate limiter initialized using Redis.');
    } else if(redisClient) {
        // Wait for status client to connect
        redisClient.on('ready', () => {
             if (!rateLimiter) { // Ensure it's not initialized twice
                 rateLimiter = new RateLimiterRedis({
                     storeClient: redisClient,
                     keyPrefix: 'rate_limit_upload',
                     points: parseInt(process.env.UPLOAD_RATE_LIMIT_POINTS || '10', 10),
                     duration: parseInt(process.env.UPLOAD_RATE_LIMIT_DURATION || '60', 10),
                 });
                 logger.info('Rate limiter initialized after Redis connection ready.');
             }
         });
         redisClient.on('error', (err) => {
             logger.error('Redis client error prevented rate limiter initialization. Falling back to memory limiter.', err);
             if (!rateLimiter) { // Fallback if Redis fails before rate limiter is setup
                 rateLimiter = new RateLimiterMemory({
                     keyPrefix: 'rate_limit_upload_mem',
                     points: parseInt(process.env.UPLOAD_RATE_LIMIT_POINTS || '10', 10),
                     duration: parseInt(process.env.UPLOAD_RATE_LIMIT_DURATION || '60', 10),
                 });
                  logger.warn('Rate limiter using in-memory store due to Redis error.');
             }
         });
    } else {
        // Fallback immediately if Redis client wasn't even attempted/created
        logger.warn("Redis client for rate limiting not available. Using in-memory store.");
        rateLimiter = new RateLimiterMemory({
            keyPrefix: 'rate_limit_upload_mem',
            points: parseInt(process.env.UPLOAD_RATE_LIMIT_POINTS || '10', 10),
            duration: parseInt(process.env.UPLOAD_RATE_LIMIT_DURATION || '60', 10),
        });
    }
} else {
    logger.info("Redis is disabled. Using in-memory store for rate limiting.");
     rateLimiter = new RateLimiterMemory({
         keyPrefix: 'rate_limit_upload_mem',
         points: parseInt(process.env.UPLOAD_RATE_LIMIT_POINTS || '10', 10), // Use env vars even for memory
         duration: parseInt(process.env.UPLOAD_RATE_LIMIT_DURATION || '60', 10),
     });
}


// Middleware de Rate Limiting (aplicado selectivamente)
const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!rateLimiter) {
        logger.warn('Rate limiter not initialized, skipping middleware.');
        return next(); // Should not happen if initialized correctly above, but safeguard
    }
    // Use IP as the key for rate limiting uploads, provide fallback
    const key = req.ip || 'unknown_ip'; // Provide fallback for undefined req.ip
    try {
        await rateLimiter.consume(key); // Pass the guaranteed string key
        next();
    } catch (rejRes) {
        logger.warn(`Rate limit exceeded for IP ${key}`);
        res.status(429).json({ message: 'Too many requests, please try again later.' });
    }
};

// Aplicar rate limiting a rutas de chunks y finalización
router.use('/chunk/:fileId/:chunkIndex', rateLimitMiddleware);
router.use('/finalize/:fileId', rateLimitMiddleware);
router.use('/init', rateLimitMiddleware); // Also limit initialization requests

// Removed duplicate TEMP_DIR/UPLOAD_DIR definitions

export default router; 