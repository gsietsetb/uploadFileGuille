import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import * as FileType from 'file-type';

const fsExists = promisify(fs.exists);
const fsMkdir = promisify(fs.mkdir);
const fsReadFile = promisify(fs.readFile);
const fsWriteFile = promisify(fs.writeFile);
const fsUnlink = promisify(fs.unlink);
const fsReaddir = promisify(fs.readdir);
const fsStat = promisify(fs.stat);

const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
const CHUNKS_DIR = path.join(UPLOADS_DIR, 'chunks');
const COMPLETE_DIR = path.join(UPLOADS_DIR, 'complete');
const CHUNK_RETENTION_MINUTES = parseInt(process.env.CHUNK_RETENTION_MINUTES || '30', 10);
const FILE_RETENTION_DAYS = parseInt(process.env.FILE_RETENTION_DAYS || '30', 10);

// Cache para hashes de archivos para evitar duplicados
const fileHashMap = new Map<string, string>();

export interface FileResult {
  path: string;
  hash: string;
  url: string;
  isDuplicate?: boolean;
}

/**
 * Crear las carpetas necesarias para el sistema
 */
export const setupFolders = async (): Promise<void> => {
  const folders = [UPLOADS_DIR, CHUNKS_DIR, COMPLETE_DIR, 'logs'];
  
  for (const folder of folders) {
    if (!await fsExists(folder)) {
      await fsMkdir(folder, { recursive: true });
      console.log(`Carpeta creada: ${folder}`);
    }
  }
};

/**
 * Calcular el hash MD5 de un archivo
 */
export const calculateFileHash = async (filePath: string): Promise<string> => {
  const fileBuffer = await fsReadFile(filePath);
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
};

/**
 * Obtener la ruta para guardar un chunk
 */
export const getChunkPath = (fileId: string, chunkIndex: number): string => {
  return path.join(CHUNKS_DIR, `${fileId}-${chunkIndex}`);
};

/**
 * Guardar un chunk en el sistema de archivos
 */
export const saveChunk = async (
  fileId: string,
  chunkIndex: number,
  chunkBuffer: Buffer
): Promise<string> => {
  const chunkPath = getChunkPath(fileId, chunkIndex);
  await fsWriteFile(chunkPath, chunkBuffer);
  return chunkPath;
};

/**
 * Verificar el tipo de archivo usando magic numbers
 */
export const validateFileType = async (
  buffer: Buffer,
  declaredType: string
): Promise<boolean> => {
  try {
    const fileTypeResult = await FileType.fileTypeFromBuffer(buffer);
    
    // Si no se pudo detectar, podría ser un archivo de texto
    if (!fileTypeResult) {
      // Verificar si el tipo declarado es de texto
      return declaredType.includes('text/') || declaredType.includes('application/json');
    }
    
    // Para imágenes y vídeos, verificar que el tipo detectado coincida con la categoría declarada
    const isImage = fileTypeResult.mime.startsWith('image/');
    const isVideo = fileTypeResult.mime.startsWith('video/');
    
    if (declaredType.startsWith('image/')) {
      return isImage;
    }
    
    if (declaredType.startsWith('video/')) {
      return isVideo;
    }
    
    // En caso de duda, comparar el tipo MIME general
    return fileTypeResult.mime === declaredType;
  } catch (error) {
    console.error('Error al validar tipo de archivo:', error);
    return false;
  }
};

/**
 * Verificar si existe un archivo con el mismo hash
 */
export const findDuplicateFile = (hash: string): string | null => {
  return fileHashMap.get(hash) || null;
};

/**
 * Combinar chunks para formar un archivo completo
 */
export const assembleFile = async (
  fileId: string,
  totalChunks: number,
  fileName: string,
  fileType: string
): Promise<FileResult> => {
  // Crear carpeta para fecha actual (YYYY-MM-DD)
  const today = new Date();
  const dateFolder = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const datePath = path.join(COMPLETE_DIR, dateFolder);
  
  if (!await fsExists(datePath)) {
    await fsMkdir(datePath, { recursive: true });
  }
  
  // Generar nombre único para el archivo
  const fileExt = path.extname(fileName);
  const baseName = path.basename(fileName, fileExt);
  const timestamp = Date.now();
  const uniqueFileName = `${baseName}-${timestamp}${fileExt}`;
  const filePath = path.join(datePath, uniqueFileName);
  
  // Crear stream de escritura
  const writeStream = fs.createWriteStream(filePath);
  
  // Verificar validez del primer chunk con magic numbers
  const firstChunkPath = getChunkPath(fileId, 0);
  const firstChunkBuffer = await fsReadFile(firstChunkPath);
  const isValidType = await validateFileType(firstChunkBuffer, fileType);
  
  if (!isValidType) {
    throw new Error(`Tipo de archivo no válido. Tipo declarado: ${fileType}`);
  }
  
  // Escribir cada chunk en el archivo
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = getChunkPath(fileId, i);
    if (await fsExists(chunkPath)) {
      const chunkData = await fsReadFile(chunkPath);
      writeStream.write(chunkData);
      // Eliminar el chunk después de usarlo
      await fsUnlink(chunkPath);
    } else {
      throw new Error(`Chunk faltante: ${i} de ${fileId}`);
    }
  }
  
  // Cerrar el stream
  await new Promise<void>((resolve, reject) => {
    writeStream.end((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  // Calcular hash MD5 para deduplicación
  const fileHash = await calculateFileHash(filePath);
  
  // Verificar si ya existe un archivo con el mismo hash
  const duplicateFilePath = findDuplicateFile(fileHash);
  let resultPath = filePath;
  let isDuplicate = false;
  
  if (duplicateFilePath) {
    // Si existe un duplicado, eliminar el nuevo archivo y usar el existente
    await fsUnlink(filePath);
    resultPath = duplicateFilePath;
    isDuplicate = true;
  } else {
    // Guardar el hash en el mapa para futuras verificaciones
    fileHashMap.set(fileHash, filePath);
  }
  
  // Generar URL relativa para acceso al archivo
  const relativeFilePath = resultPath.replace(COMPLETE_DIR, '');
  const url = `/uploads/complete${relativeFilePath.replace(/\\/g, '/')}`;
  
  return {
    path: resultPath,
    hash: fileHash,
    url,
    isDuplicate
  };
};

/**
 * Limpiar chunks antiguos
 */
export const cleanupOldChunks = async (): Promise<void> => {
  const files = await fsReaddir(CHUNKS_DIR);
  const now = Date.now();
  
  for (const file of files) {
    const filePath = path.join(CHUNKS_DIR, file);
    const stats = await fsStat(filePath);
    const fileAge = now - stats.mtime.getTime();
    
    // Convertir minutos a milisegundos
    const maxAge = CHUNK_RETENTION_MINUTES * 60 * 1000;
    
    if (fileAge > maxAge) {
      await fsUnlink(filePath);
      console.log(`Chunk antiguo eliminado: ${file}`);
    }
  }
};

/**
 * Limpiar archivos completos antiguos
 */
export const cleanupOldFiles = async (): Promise<void> => {
  const dateFolders = await fsReaddir(COMPLETE_DIR);
  const now = Date.now();
  
  for (const dateFolder of dateFolders) {
    const dateFolderPath = path.join(COMPLETE_DIR, dateFolder);
    const stats = await fsStat(dateFolderPath);
    
    if (stats.isDirectory()) {
      const fileAge = now - stats.mtime.getTime();
      // Convertir días a milisegundos
      const maxAge = FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      
      if (fileAge > maxAge) {
        const files = await fsReaddir(dateFolderPath);
        
        for (const file of files) {
          await fsUnlink(path.join(dateFolderPath, file));
        }
        
        // Eliminar carpeta vacía
        await fs.promises.rmdir(dateFolderPath);
        console.log(`Carpeta antigua eliminada: ${dateFolder}`);
      }
    }
  }
}; 