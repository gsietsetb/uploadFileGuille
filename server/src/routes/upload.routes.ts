import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { saveChunk, assembleFile, getChunkPath, validateFileType } from '../utils/fileUtils';
import Redis from 'ioredis';
import winston from 'winston';

const router = express.Router();

// Configuración de Redis para el seguimiento del estado de carga
let redisClient: Redis | null = null;
try {
  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    retryStrategy: (times: number) => Math.min(times * 50, 2000)
  });
  console.log('Redis conectado correctamente');
} catch (err) {
  console.error('Error al conectar Redis, usando almacenamiento en memoria:', err);
}

// Interfaz para el estado de carga
interface UploadStatus {
  totalChunks: number;
  receivedChunks: number[];
  fileName: string;
  fileType: string;
  isPaused: boolean;
  isCompleted: boolean;
  userId?: string;
  startTime: number;
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

// Interfaces para tipos
interface ChunkRequest extends Request {
  file?: Express.Multer.File;
}

// Función para manejar errores de forma centralizada
const handleError = (res: Response, error: any, message: string) => {
  uploadLogger.error(`${message}: ${error.message}`, { error });
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
  isPaused?: boolean;
  isCompleted?: boolean;
  userId?: string;
  startTime?: number;
}

// Función para guardar/actualizar estado de carga
const saveUploadStatus = async (
  fileId: string, 
  data: UploadStatusData
) => {
  try {
    if (redisClient) {
      // Primero obtener estado actual si existe
      const currentStatus = await redisClient.get(`upload:${fileId}`);
      let status = data;
      
      if (currentStatus) {
        status = { ...JSON.parse(currentStatus), ...data };
      } else if (!data.startTime) {
        status = { ...data, startTime: Date.now() };
      }
      
      // Guardar en Redis (expira en 24 horas)
      await redisClient.set(`upload:${fileId}`, JSON.stringify(status), 'EX', 60 * 60 * 24);
    } else {
      // Almacenamiento en memoria
      if (memoryUploadStatus.has(fileId)) {
        const current = memoryUploadStatus.get(fileId)!;
        memoryUploadStatus.set(fileId, { ...current, ...data } as UploadStatus);
      } else {
        memoryUploadStatus.set(fileId, { 
          totalChunks: data.totalChunks || 0, 
          receivedChunks: data.receivedChunks || [], 
          fileName: data.fileName || '', 
          fileType: data.fileType || '',
          isPaused: data.isPaused || false,
          isCompleted: data.isCompleted || false,
          userId: data.userId,
          startTime: data.startTime || Date.now()
        });
      }
    }
  } catch (error) {
    console.error('Error al guardar estado de carga:', error);
  }
};

// Función para obtener estado de carga
const getUploadStatus = async (fileId: string): Promise<UploadStatus | null> => {
  try {
    if (redisClient) {
      const status = await redisClient.get(`upload:${fileId}`);
      return status ? JSON.parse(status) : null;
    } else {
      return memoryUploadStatus.get(fileId) || null;
    }
  } catch (error) {
    console.error('Error al obtener estado de carga:', error);
    return null;
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
    
    // Validar tipo de archivo
    const allowedTypes = ['image/', 'video/'];
    if (!allowedTypes.some(type => fileType.startsWith(type))) {
      return res.status(400).json({
        error: 'Tipo de archivo no permitido. Solo se aceptan imágenes y videos.'
      });
    }
    
    // Generar ID único para el archivo
    const fileId = crypto.randomUUID();
    
    // Guardar metadatos iniciales
    await saveUploadStatus(fileId, {
      totalChunks: parseInt(totalChunks, 10),
      receivedChunks: [],
      fileName,
      fileType,
      isPaused: false,
      isCompleted: false,
      userId
    });
    
    uploadLogger.info(`Carga inicializada: ${fileName}`, { 
      fileId, 
      fileName, 
      fileSize, 
      fileType, 
      totalChunks,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    res.status(200).json({
      fileId,
      message: 'Carga inicializada correctamente'
    });
  } catch (error) {
    handleError(res, error, 'Error al inicializar la carga');
  }
});

/**
 * Subir un chunk
 * POST /api/upload/chunk/:fileId/:chunkIndex
 */
router.post('/chunk/:fileId/:chunkIndex', upload.single('chunk'), async (req: ChunkRequest, res: Response) => {
  try {
    const { fileId, chunkIndex } = req.params;
    const chunkIndexNum = parseInt(chunkIndex, 10);
    
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: 'No se recibió ningún chunk'
      });
    }
    
    // Verificar estado actual de la carga
    const status = await getUploadStatus(fileId);
    
    if (!status) {
      return res.status(404).json({
        error: 'ID de carga no encontrado. Inicialice la carga primero.'
      });
    }
    
    if (status.isCompleted) {
      return res.status(400).json({
        error: 'La carga ya ha sido completada'
      });
    }
    
    if (status.isPaused) {
      return res.status(409).json({
        error: 'La carga está en pausa'
      });
    }
    
    // Si es el primer chunk, validar el tipo de archivo
    if (chunkIndexNum === 0) {
      const isValidType = await validateFileType(req.file.buffer, status.fileType);
      if (!isValidType) {
        return res.status(400).json({
          error: 'El tipo de archivo real no coincide con el tipo declarado'
        });
      }
    }
    
    // Guardar el chunk en el sistema de archivos
    const chunkPath = await saveChunk(fileId, chunkIndexNum, req.file.buffer);
    
    // Actualizar estado de carga con el nuevo chunk
    const receivedChunks = [...(status.receivedChunks || [])];
    if (!receivedChunks.includes(chunkIndexNum)) {
      receivedChunks.push(chunkIndexNum);
    }
    
    await saveUploadStatus(fileId, { receivedChunks });
    
    uploadLogger.debug(`Chunk recibido: ${fileId}-${chunkIndexNum}`, { 
      fileId, 
      chunkIndex: chunkIndexNum, 
      progress: `${receivedChunks.length}/${status.totalChunks}`
    });
    
    res.status(200).json({
      message: 'Chunk recibido correctamente',
      fileId,
      chunkIndex: chunkIndexNum,
      receivedChunks,
      totalChunks: status.totalChunks
    });
  } catch (error) {
    handleError(res, error, 'Error al procesar el chunk');
  }
});

/**
 * Finalizar la carga y ensamblar el archivo
 * POST /api/upload/finalize/:fileId
 */
router.post('/finalize/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    
    // Verificar estado actual de la carga
    const status = await getUploadStatus(fileId);
    
    if (!status) {
      return res.status(404).json({
        error: 'ID de carga no encontrado'
      });
    }
    
    if (status.isCompleted) {
      return res.status(400).json({
        error: 'La carga ya ha sido completada'
      });
    }
    
    const { totalChunks, receivedChunks, fileName, fileType } = status;
    
    // Verificar que todos los chunks existan
    if (receivedChunks.length !== totalChunks) {
      return res.status(400).json({
        error: `Carga incompleta: ${receivedChunks.length}/${totalChunks} chunks recibidos`,
        receivedChunks,
        missingChunks: Array.from(Array(totalChunks).keys())
          .filter(i => !receivedChunks.includes(i))
      });
    }
    
    // Ensamblar el archivo final
    const fileResult = await assembleFile(fileId, totalChunks, fileName, fileType);
    
    // Marcar como completado
    await saveUploadStatus(fileId, { isCompleted: true });
    
    const timeElapsed = Math.round((Date.now() - status.startTime) / 1000);
    
    uploadLogger.info(`Archivo ensamblado: ${fileName}`, { 
      fileId, 
      fileName, 
      fileType, 
      fileHash: fileResult.hash,
      timeElapsed,
      isDuplicate: fileResult.isDuplicate
    });
    
    res.status(200).json({
      message: 'Archivo ensamblado correctamente',
      fileName,
      fileUrl: fileResult.url,
      fileHash: fileResult.hash,
      isDuplicate: fileResult.isDuplicate
    });
  } catch (error) {
    handleError(res, error, 'Error al ensamblar el archivo');
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
      receivedChunks: status.receivedChunks,
      totalUploaded: status.receivedChunks.length,
      progress: Math.round((status.receivedChunks.length / status.totalChunks) * 100),
      isPaused: status.isPaused,
      isCompleted: status.isCompleted,
      startTime: status.startTime
    });
  } catch (error) {
    handleError(res, error, 'Error al verificar el estado de la carga');
  }
});

/**
 * Pausar una carga en progreso
 * PUT /api/upload/pause/:fileId
 */
router.put('/pause/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    
    // Verificar estado actual
    const status = await getUploadStatus(fileId);
    
    if (!status) {
      return res.status(404).json({
        error: 'ID de carga no encontrado'
      });
    }
    
    if (status.isCompleted) {
      return res.status(400).json({
        error: 'No se puede pausar una carga completada'
      });
    }
    
    // Actualizar estado
    await saveUploadStatus(fileId, { isPaused: true });
    
    uploadLogger.info(`Carga pausada: ${fileId}`, { fileId });
    
    res.status(200).json({
      message: 'Carga pausada correctamente',
      fileId
    });
  } catch (error) {
    handleError(res, error, 'Error al pausar la carga');
  }
});

/**
 * Reanudar una carga pausada
 * PUT /api/upload/resume/:fileId
 */
router.put('/resume/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    
    // Verificar estado actual
    const status = await getUploadStatus(fileId);
    
    if (!status) {
      return res.status(404).json({
        error: 'ID de carga no encontrado'
      });
    }
    
    if (status.isCompleted) {
      return res.status(400).json({
        error: 'No se puede reanudar una carga completada'
      });
    }
    
    if (!status.isPaused) {
      return res.status(400).json({
        error: 'La carga no está pausada'
      });
    }
    
    // Actualizar estado
    await saveUploadStatus(fileId, { isPaused: false });
    
    uploadLogger.info(`Carga reanudada: ${fileId}`, { fileId });
    
    res.status(200).json({
      message: 'Carga reanudada correctamente',
      fileId,
      receivedChunks: status.receivedChunks,
      totalChunks: status.totalChunks
    });
  } catch (error) {
    handleError(res, error, 'Error al reanudar la carga');
  }
});

/**
 * Cancelar una carga
 * DELETE /api/upload/cancel/:fileId
 */
router.delete('/cancel/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    
    // Verificar estado actual
    const status = await getUploadStatus(fileId);
    
    if (!status) {
      return res.status(404).json({
        error: 'ID de carga no encontrado'
      });
    }
    
    if (status.isCompleted) {
      return res.status(400).json({
        error: 'No se puede cancelar una carga completada'
      });
    }
    
    // Eliminar chunks
    if (status.receivedChunks && status.receivedChunks.length > 0) {
      for (const chunkIndex of status.receivedChunks) {
        const chunkPath = getChunkPath(fileId, chunkIndex);
        if (fs.existsSync(chunkPath)) {
          await fs.promises.unlink(chunkPath);
        }
      }
    }
    
    // Eliminar datos de Redis si existe
    if (redisClient) {
      await redisClient.del(`upload:${fileId}`);
    } else {
      memoryUploadStatus.delete(fileId);
    }
    
    uploadLogger.info(`Carga cancelada: ${fileId}`, { 
      fileId,
      fileName: status.fileName
    });
    
    res.status(200).json({
      message: 'Carga cancelada correctamente',
      fileId
    });
  } catch (error) {
    handleError(res, error, 'Error al cancelar la carga');
  }
});

export default router; 