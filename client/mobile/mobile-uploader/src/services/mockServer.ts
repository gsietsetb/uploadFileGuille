/**
 * Servidor mock para pruebas y desarrollo sin backend
 * Este módulo proporciona respuestas simuladas para las API utilizadas en la aplicación
 */

import { generateUniqueFileName, sanitizeUrl } from '../utils/fileUtils';
import { Platform } from 'react-native';

// Configuración base de URL para archivos
const BASE_SERVER_URL = Platform.OS === 'web' 
  ? 'http://localhost:3001'
  : Platform.OS === 'ios' 
    ? 'http://localhost:3001'
    : 'http://10.0.2.2:3001';

// Variable global para almacenar los archivos cargados
const uploadedFiles: Record<string, any> = {};
const inProgressUploads: Record<string, any> = {};

// Generar un ID único para cada carga
const generateUploadId = (): string => {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
};

export const mockServer = {
  // Inicializar una carga
  initializeUpload: (fileName: string, fileSize: number): Promise<any> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const uploadId = generateUploadId();
        const chunkSize = 1024 * 1024; // 1MB
        const totalChunks = Math.ceil(fileSize / chunkSize);
        
        inProgressUploads[uploadId] = {
          fileName: generateUniqueFileName(fileName),
          fileSize,
          totalChunks,
          receivedChunks: 0,
          chunkSize,
          chunks: {},
          startTime: Date.now()
        };
        
        resolve({
          uploadId,
          totalChunks,
          chunkSize
        });
      }, 500); // Simular retardo de red
    });
  },
  
  // Cargar un fragmento
  uploadChunk: (uploadId: string, chunkIndex: number, chunk: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const upload = inProgressUploads[uploadId];
        
        if (!upload) {
          reject(new Error('Carga no encontrada'));
          return;
        }
        
        // Simular error aleatorio para probar reintentos (10% de probabilidad)
        if (Math.random() < 0.1) {
          reject(new Error('Error de red simulado'));
          return;
        }
        
        // Simular error 429 (Rate limit) aleatoriamente (5% de probabilidad)
        if (Math.random() < 0.05) {
          const error: any = new Error('Demasiadas solicitudes');
          error.response = { status: 429 };
          reject(error);
          return;
        }
        
        // Guardar el fragmento (en un entorno real, se guardaría en el sistema de archivos)
        upload.chunks[chunkIndex] = true;
        upload.receivedChunks++;
        
        resolve({
          success: true,
          message: `Fragmento ${chunkIndex} recibido correctamente`
        });
      }, 300); // Menor retardo para simular carga rápida
    });
  },
  
  // Finalizar una carga
  finalizeUpload: (uploadId: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const upload = inProgressUploads[uploadId];
        
        if (!upload) {
          reject(new Error('Carga no encontrada'));
          return;
        }
        
        // Verificar que todos los fragmentos se hayan recibido
        if (upload.receivedChunks < upload.totalChunks) {
          reject(new Error(`Faltan fragmentos: ${upload.receivedChunks}/${upload.totalChunks}`));
          return;
        }
        
        // Generar una URL de archivo más accesible
        const fileId = Date.now().toString();
        const currentDate = new Date().toISOString().split('T')[0];
        // Generar una URL que funcione en desarrollo
        const relativePath = `/uploads/complete/${currentDate}/${upload.fileName}`;
        const fileUrl = `${BASE_SERVER_URL}${relativePath}`;
        
        // Guardar el archivo completado
        uploadedFiles[fileId] = {
          fileName: upload.fileName,
          fileSize: upload.fileSize,
          fileUrl: sanitizeUrl(fileUrl),
          relativePath,
          uploadTime: Date.now(),
          processingTime: Date.now() - upload.startTime
        };
        
        // Eliminar la carga en progreso
        delete inProgressUploads[uploadId];
        
        resolve({
          success: true,
          message: 'Archivo cargado correctamente',
          fileName: upload.fileName,
          fileUrl: sanitizeUrl(fileUrl)
        });
      }, 800); // Simular procesamiento final más largo
    });
  },
  
  // Subir un archivo completo (no en fragmentos)
  uploadComplete: (file: any): Promise<any> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const fileName = generateUniqueFileName(file.name);
        const fileId = Date.now().toString();
        const currentDate = new Date().toISOString().split('T')[0];
        
        // Generar una URL más accesible
        const relativePath = `/uploads/complete/${currentDate}/${fileName}`;
        const fileUrl = `${BASE_SERVER_URL}${relativePath}`;
        
        // Guardar el archivo
        uploadedFiles[fileId] = {
          fileName,
          fileSize: file.size || 0,
          fileUrl: sanitizeUrl(fileUrl),
          relativePath,
          uploadTime: Date.now()
        };
        
        // Crear una URL de vista previa simulada para imágenes
        // En un entorno real, esto sería generado por el servidor
        console.log(`Archivo subido con éxito: ${sanitizeUrl(fileUrl)}`);
        
        resolve({
          success: true,
          message: 'Archivo cargado correctamente',
          fileName,
          fileUrl: sanitizeUrl(fileUrl) 
        });
      }, 1500); // Simular una carga completa
    });
  },
  
  // Obtener la lista de archivos subidos
  getUploadedFiles: (): Promise<any> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          files: Object.values(uploadedFiles)
        });
      }, 300);
    });
  }
};

// Exportar como valor por defecto para facilitar las pruebas
export default mockServer; 