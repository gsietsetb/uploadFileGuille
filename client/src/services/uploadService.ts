import axios from 'axios';
import { generateUniqueFileName, getMimeType } from '../utils/fileUtils';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

// Configuración del servidor
const API_URL = 'http://localhost:3001/api';

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

/**
 * Servicio para la carga de archivos al servidor
 */
export const uploadService = {
  /**
   * Carga un archivo al servidor
   * @param file Archivo a cargar
   * @param onProgress Función de callback para reportar el progreso
   * @returns Promesa con la respuesta del servidor
   */
  async uploadFile(
    file: FileToUpload,
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    try {
      // Generar un nombre de archivo normalizado y único
      const uniqueFileName = generateUniqueFileName(file.name);
      
      // Determinar el tipo MIME si no está especificado
      const fileType = file.type || getMimeType(file.name);
      
      // Crear forma de datos para enviar el archivo
      const formData = new FormData();
      
      // Añadir el archivo al FormData
      const fileInfo: any = {
        uri: Platform.OS === 'android' ? file.uri : file.uri.replace('file://', ''),
        name: uniqueFileName,
        type: fileType,
      };
      
      formData.append('file', fileInfo as any);
      
      // Configurar la petición con soporte para reportar progreso
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(percentCompleted);
          }
        },
      });
      
      return {
        success: true,
        message: 'Archivo cargado correctamente',
        fileName: response.data.fileName,
        fileUrl: response.data.fileUrl,
      };
    } catch (error: any) {
      console.error('Error al cargar el archivo:', error);
      
      // Extraer mensaje de error
      let errorMessage = 'Error al cargar el archivo';
      if (axios.isAxiosError(error) && error.response) {
        errorMessage = error.response.data.message || errorMessage;
      }
      
      return {
        success: false,
        message: errorMessage,
        error: errorMessage,
      };
    }
  },
  
  /**
   * Carga un archivo en partes (chunks) al servidor para archivos grandes
   * @param file Archivo a cargar
   * @param chunkSize Tamaño de cada parte en bytes (por defecto 1MB)
   * @param onProgress Función de callback para reportar el progreso
   * @returns Promesa con la respuesta del servidor
   */
  async uploadFileInChunks(
    file: FileToUpload,
    chunkSize = 1024 * 1024, // 1MB por defecto
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    try {
      // Verificar si podemos obtener el tamaño del archivo
      const fileInfo = await FileSystem.getInfoAsync(file.uri);
      if (!fileInfo.exists) {
        throw new Error('Archivo no encontrado');
      }
      
      const fileSize = fileInfo.size;
      const totalChunks = Math.ceil(fileSize / chunkSize);
      
      // Inicializar la carga
      const initResponse = await axios.post(`${API_URL}/upload/init`, {
        fileName: file.name,
        fileSize,
        fileType: file.type || getMimeType(file.name),
        totalChunks
      });
      
      const fileId = initResponse.data.fileId;
      
      // Cargar cada fragmento
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(fileSize, start + chunkSize);
        
        // Leer el fragmento del archivo
        const chunk = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
          position: start,
          length: end - start
        });
        
        // Convertir a blob
        const chunkFormData = new FormData();
        chunkFormData.append('chunk', {
          uri: `data:${file.type || 'application/octet-stream'};base64,${chunk}`,
          name: 'chunk',
          type: file.type || 'application/octet-stream'
        } as any);
        
        // Enviar el fragmento
        await axios.post(`${API_URL}/upload/chunk/${fileId}/${chunkIndex}`, chunkFormData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          }
        });
        
        // Actualizar progreso
        if (onProgress) {
          onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100));
        }
      }
      
      // Finalizar la carga
      const finalizeResponse = await axios.post(`${API_URL}/upload/finalize/${fileId}`);
      
      return {
        success: true,
        message: 'Archivo cargado correctamente',
        fileName: finalizeResponse.data.fileName,
        fileUrl: finalizeResponse.data.fileUrl,
      };
    } catch (error: any) {
      console.error('Error al cargar el archivo en fragmentos:', error);
      
      // Extraer mensaje de error
      let errorMessage = 'Error al cargar el archivo';
      if (axios.isAxiosError(error) && error.response) {
        errorMessage = error.response.data.message || errorMessage;
      }
      
      return {
        success: false,
        message: errorMessage,
        error: errorMessage,
      };
    }
  },
  
  /**
   * Obtiene la URL completa de un archivo
   * @param fileName Nombre del archivo
   * @returns URL completa del archivo
   */
  getFileUrl(fileName: string): string {
    return `${API_URL}/uploads/${fileName}`;
  }
}; 