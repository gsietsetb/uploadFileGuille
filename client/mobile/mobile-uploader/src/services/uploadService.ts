import axios, { AxiosResponse, AxiosError, AxiosRequestConfig } from 'axios';
import { generateUniqueFileName, getMimeType, sanitizeUrl } from '../utils/fileUtils';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import mockServer from './mockServer';

// URL base de la API - Modificar esta configuración según tu entorno
// Para desarrollo local en el emulador iOS, usa localhost
// Para dispositivos físicos o emulador Android, usa la IP de tu máquina en tu red local
const API_URL = Platform.OS === 'web' 
  ? 'http://localhost:3001/api'
  // Para dispositivos físicos, usa tu IP local
  : Platform.OS === 'ios' 
    ? 'http://localhost:3001/api'  // Emulador iOS usa localhost
    : 'http://10.0.2.2:3001/api';  // Emulador Android usa 10.0.2.2 (alias para localhost)

// URL base del servidor para acceder a los archivos
const SERVER_BASE_URL = Platform.OS === 'web' 
  ? 'http://localhost:3001'
  : Platform.OS === 'ios' 
    ? 'http://localhost:3001'
    : 'http://10.0.2.2:3001';

// Configuración de depuración
console.log(`Utilizando API URL: ${API_URL}`);
console.log(`Utilizando SERVER BASE URL: ${SERVER_BASE_URL}`);
console.log(`Plataforma: ${Platform.OS}`);

// Configuración global de Axios
axios.defaults.headers.common['Content-Type'] = 'application/json';
axios.defaults.timeout = 30000; // 30 segundos de timeout

// Modo de desarrollo - cambiar a false para usar el servidor real
const DEVELOPMENT_MODE = true;
// Estado de disponibilidad del servidor
let SERVER_AVAILABLE = false;

// Verificar si el servidor está disponible al iniciar
(async () => {
  try {
    if (!DEVELOPMENT_MODE) {
      await axios.get(`${API_URL.replace('/api', '')}/health`);
      console.log('Servidor disponible');
      SERVER_AVAILABLE = true;
    } else {
      console.log('Modo desarrollo activado, usando servidor mock');
    }
  } catch (error) {
    console.error('Servidor no disponible:', error);
    console.log('Usando servidor mock como fallback');
  }
})();

/**
 * Interfaz para la respuesta del servidor
 */
export interface UploadResponse {
  success: boolean;
  message: string;
  fileName?: string;
  fileUrl?: string;
  error?: string;
}

/**
 * Interfaz para archivo a cargar
 */
export interface FileToUpload {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

class UploadService {
  private abortControllers: Map<string, AbortController> = new Map();
  private activeUploads: Set<string> = new Set();
  private maxConcurrentUploads: number = 3;
  private maxRetries: number = 3;
  private retryDelayMs: number = 1000;

  /**
   * Carga un archivo al servidor
   * @param file Archivo a cargar
   * @param onProgress Función de callback para reportar el progreso
   * @returns Promesa con la respuesta del servidor
   */
  public async uploadFile(
    file: FileToUpload,
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    // Si estamos en modo desarrollo o el servidor no está disponible, usar mock
    if (DEVELOPMENT_MODE || !SERVER_AVAILABLE) {
      try {
        // Simular progreso
        let progress = 0;
        const interval = setInterval(() => {
          progress += 10;
          if (progress > 100) {
            clearInterval(interval);
            return;
          }
          if (onProgress) onProgress(progress);
        }, 300);

        const response = await mockServer.uploadComplete(file);
        clearInterval(interval);
        if (onProgress) onProgress(100);

        return {
          success: true,
          message: 'Archivo cargado correctamente',
          fileName: response.fileName,
          fileUrl: response.fileUrl
        };
      } catch (error: any) {
        console.error('Error en mock server:', error);
        return {
          success: false,
          message: 'Error de carga',
          error: error.message || 'Error inesperado'
        };
      }
    }

    try {
      // Verificar límite de cargas concurrentes
      if (this.activeUploads.size >= this.maxConcurrentUploads) {
        return {
          success: false,
          message: 'Límite de cargas excedido',
          error: 'Se ha alcanzado el límite de cargas concurrentes. Intenta más tarde.'
        };
      }

      const fileId = Date.now().toString();
      this.activeUploads.add(fileId);

      // Crear el controlador de aborto
      const abortController = new AbortController();
      this.abortControllers.set(fileId, abortController);

      // Crear form data
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.type
      } as any);

      // Configuración de la petición
      const config: AxiosRequestConfig = {
        signal: abortController.signal,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percentCompleted);
          }
        }
      };

      // Enviar petición con reintentos
      let attempts = 0;
      let lastError: AxiosError | null = null;

      while (attempts < this.maxRetries) {
        try {
          const response = await axios.post(`${API_URL}/upload`, formData, config);
          
          // Limpiar referencias
          this.abortControllers.delete(fileId);
          this.activeUploads.delete(fileId);
          
          // Sanitizar la URL antes de devolverla
          const sanitizedUrl = response.data?.fileUrl 
            ? sanitizeUrl(response.data.fileUrl) 
            : undefined;
            
          return {
            success: true,
            message: 'Archivo cargado correctamente',
            fileName: response.data.fileName,
            fileUrl: sanitizedUrl
          };
        } catch (error: any) {
          lastError = error;
          
          // Si es error 429 (Too Many Requests), esperar y reintentar
          if (error.response?.status === 429) {
            attempts++;
            if (attempts < this.maxRetries) {
              // Esperar con backoff exponencial
              const delay = this.retryDelayMs * Math.pow(2, attempts - 1);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          } else if (axios.isCancel(error)) {
            // Carga cancelada intencionalmente
            this.activeUploads.delete(fileId);
            return {
              success: false,
              message: 'Carga cancelada',
              error: 'Carga cancelada por el usuario'
            };
          } else {
            // Otro tipo de error, no reintentar
            break;
          }
        }
      }

      // Limpiar referencias
      this.abortControllers.delete(fileId);
      this.activeUploads.delete(fileId);
      
      const errorMessage = this.formatErrorMessage(lastError);
      console.error('Error al cargar archivo:', errorMessage);
      
      return {
        success: false,
        message: 'Error de carga',
        error: errorMessage
      };
    } catch (error: any) {
      console.error('Error no controlado al cargar archivo:', error);
      return {
        success: false,
        message: 'Error inesperado',
        error: 'Error inesperado al procesar la carga'
      };
    }
  }
  
  /**
   * Carga un archivo en partes (chunks) al servidor para archivos grandes
   * @param file Archivo a cargar
   * @param chunkSize Tamaño de cada parte en bytes (por defecto 1MB)
   * @param onProgress Función de callback para reportar el progreso
   * @returns Promesa con la respuesta del servidor
   */
  public async uploadFileInChunks(
    file: FileToUpload,
    chunkSize: number = 1024 * 1024,
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    // Si estamos en modo desarrollo o el servidor no está disponible, usar mock
    if (DEVELOPMENT_MODE || !SERVER_AVAILABLE) {
      try {
        // Inicializar la carga
        const initResponse = await mockServer.initializeUpload(file.name, file.size || 0);
        const { uploadId, totalChunks } = initResponse;

        // Simular la carga de fragmentos
        for (let i = 0; i < totalChunks; i++) {
          // Actualizar progreso
          if (onProgress) {
            onProgress(Math.round((i / totalChunks) * 90));
          }

          // Simular carga de fragmento
          await mockServer.uploadChunk(uploadId, i, null);
        }

        // Finalizar la carga
        const finalResponse = await mockServer.finalizeUpload(uploadId);
        if (onProgress) onProgress(100);

        return {
          success: true,
          message: 'Archivo cargado correctamente',
          fileName: finalResponse.fileName,
          fileUrl: finalResponse.fileUrl
        };
      } catch (error: any) {
        console.error('Error en mock server:', error);
        return {
          success: false,
          message: 'Error de carga fragmentada',
          error: error.message || 'Error inesperado'
        };
      }
    }

    try {
      // Verificar límite de cargas concurrentes
      if (this.activeUploads.size >= this.maxConcurrentUploads) {
        return {
          success: false,
          message: 'Límite de cargas excedido',
          error: 'Se ha alcanzado el límite de cargas concurrentes. Intenta más tarde.'
        };
      }

      const fileId = Date.now().toString();
      this.activeUploads.add(fileId);

      // Crear el controlador de aborto
      const abortController = new AbortController();
      this.abortControllers.set(fileId, abortController);

      // Paso 1: Inicializar la carga
      const initResponse = await this.initializeChunkedUpload(file, abortController.signal);
      if (!initResponse.success) {
        this.abortControllers.delete(fileId);
        this.activeUploads.delete(fileId);
        return initResponse;
      }

      const { uploadId, totalChunks } = initResponse;
      let completedChunks = 0;

      // Paso 2: Cargar fragmentos
      if (!totalChunks || !uploadId) {
        this.abortControllers.delete(fileId);
        this.activeUploads.delete(fileId);
        return {
          success: false,
          message: 'Error de configuración',
          error: 'Faltan parámetros necesarios para la carga en fragmentos'
        };
      }

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Verificar si la carga fue cancelada
        if (abortController.signal.aborted) {
          this.abortControllers.delete(fileId);
          this.activeUploads.delete(fileId);
          return {
            success: false,
            message: 'Carga cancelada',
            error: 'Carga cancelada por el usuario'
          };
        }

        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size || 0);
        
        // Leer el fragmento y subirlo
        try {
          const chunkBlob = await this.readFileChunk(file.uri, start, end);
          await this.uploadChunk(uploadId, chunkIndex, chunkBlob, abortController.signal);
          
          completedChunks++;
          if (onProgress) {
            const progress = Math.round((completedChunks / totalChunks) * 100);
            onProgress(progress);
          }
        } catch (error: any) {
          // Si es error 429, esperar y reintentar
          if (error.response?.status === 429) {
            chunkIndex--; // Reintentar este fragmento
            await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
            continue;
          } else {
            this.abortControllers.delete(fileId);
            this.activeUploads.delete(fileId);
            return {
              success: false,
              message: 'Error en fragmento',
              error: `Error al cargar fragmento ${chunkIndex}: ${this.formatErrorMessage(error)}`
            };
          }
        }
      }

      // Paso 3: Finalizar la carga
      const finalizeResponse = await this.finalizeChunkedUpload(uploadId, abortController.signal);
      
      // Limpiar referencias
      this.abortControllers.delete(fileId);
      this.activeUploads.delete(fileId);
      
      // Sanitizar la URL antes de devolverla
      if (finalizeResponse.success && finalizeResponse.fileUrl) {
        finalizeResponse.fileUrl = sanitizeUrl(finalizeResponse.fileUrl);
      }
      
      return finalizeResponse;
    } catch (error: any) {
      console.error('Error al cargar archivo en fragmentos:', error);
      return {
        success: false,
        message: 'Error en carga fragmentada',
        error: this.formatErrorMessage(error)
      };
    }
  }
  
  /**
   * Obtiene la URL completa de un archivo
   * @param fileName Nombre del archivo
   * @returns URL completa del archivo
   */
  public getFileUrl(filePath: string): string {
    if (!filePath) return '';
    
    // Si ya es una URL completa, devolverla sanitizada
    if (filePath.startsWith('http')) {
      return sanitizeUrl(filePath);
    }
    
    // Construir la URL completa
    const baseUrl = SERVER_BASE_URL;
    const fullUrl = `${baseUrl}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
    
    console.log(`URL generada: ${fullUrl}`);
    return sanitizeUrl(fullUrl);
  }

  // Métodos privados para la carga en fragmentos
  private async initializeChunkedUpload(
    file: FileToUpload, 
    signal: AbortSignal
  ): Promise<UploadResponse & { uploadId?: string; totalChunks?: number }> {
    try {
      const response = await axios.post(
        `${API_URL}/upload/init`,
        {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size || 0,
          chunkSize: 1024 * 1024 // 1MB
        },
        { signal }
      );

      return {
        success: true,
        message: 'Inicialización exitosa',
        uploadId: response.data.uploadId,
        totalChunks: response.data.totalChunks
      };
    } catch (error: any) {
      console.error('Error al inicializar carga en fragmentos:', error);
      return {
        success: false,
        message: 'Error al inicializar',
        error: this.formatErrorMessage(error)
      };
    }
  }

  private async readFileChunk(uri: string, start: number, end: number): Promise<Blob> {
    // Implementación específica de plataforma para leer fragmentos de archivo
    // Esto es una simplificación, la implementación real dependerá de React Native
    // y podría requerir bibliotecas nativas adicionales
    
    // Por ahora, simulamos una lectura de fragmento
    // En una implementación real, usarías FileSystem de Expo o react-native-fs
    return new Promise<Blob>((resolve, reject) => {
      // Simulación de lectura de archivo
      // En una implementación real, se leería el archivo desde el sistema de archivos
      setTimeout(() => {
        try {
          // Crear un blob vacío del tamaño adecuado
          const blob = new Blob([''], { type: 'application/octet-stream' });
          resolve(blob);
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  }

  private async uploadChunk(
    uploadId: string, 
    chunkIndex: number, 
    chunk: Blob,
    signal: AbortSignal
  ): Promise<void> {
    const formData = new FormData();
    formData.append('chunk', chunk);

    let attempts = 0;
    while (attempts < this.maxRetries) {
      try {
        await axios.post(
          `${API_URL}/upload/chunk/${uploadId}/${chunkIndex}`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            signal
          }
        );
        return;
      } catch (error: any) {
        if (error.response?.status === 429) {
          attempts++;
          if (attempts < this.maxRetries) {
            // Esperar con backoff exponencial
            const delay = this.retryDelayMs * Math.pow(2, attempts - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        throw error;
      }
    }
  }

  private async finalizeChunkedUpload(
    uploadId: string, 
    signal: AbortSignal
  ): Promise<UploadResponse> {
    try {
      const response = await axios.post(
        `${API_URL}/upload/finalize/${uploadId}`,
        {},
        { signal }
      );

      return {
        success: true,
        message: 'Archivo cargado correctamente',
        fileName: response.data.fileName,
        fileUrl: response.data.fileUrl
      };
    } catch (error: any) {
      console.error('Error al finalizar carga en fragmentos:', error);
      return {
        success: false,
        message: 'Error al finalizar',
        error: this.formatErrorMessage(error)
      };
    }
  }

  // Método para formatear mensajes de error
  private formatErrorMessage(error: any): string {
    if (!error) return 'Error desconocido';
    
    if (error.response) {
      // Error de respuesta del servidor
      const status = error.response.status;
      
      switch (status) {
        case 400:
          return 'Solicitud incorrecta. Verifica los datos del archivo.';
        case 401:
          return 'No autorizado. Inicia sesión para continuar.';
        case 403:
          return 'Acceso prohibido. No tienes permiso para esta operación.';
        case 404:
          return 'Recurso no encontrado. La API no está disponible.';
        case 413:
          return 'Archivo demasiado grande. Intenta con uno más pequeño.';
        case 415:
          return 'Tipo de archivo no soportado.';
        case 429:
          return 'Demasiadas solicitudes. Intenta más tarde.';
        case 500:
          return 'Error interno del servidor. Intenta más tarde.';
        default:
          return `Error del servidor: ${status}`;
      }
    } else if (error.request) {
      // No se recibió respuesta
      return 'No se pudo conectar con el servidor. Verifica tu conexión.';
    } else if (error.message) {
      // Otro tipo de error
      return error.message;
    }
    
    return 'Error desconocido al procesar la solicitud.';
  }

  // Método para cancelar una carga en progreso
  public cancelUpload(fileId: string): boolean {
    const controller = this.abortControllers.get(fileId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(fileId);
      this.activeUploads.delete(fileId);
      return true;
    }
    return false;
  }
}

export const uploadService = new UploadService(); 