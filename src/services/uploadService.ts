import axios from 'axios';
import { generateUniqueFileName } from '../utils/fileUtils';

// Configuración del servidor
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

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
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    try {
      // Generar un nombre de archivo normalizado y único
      const uniqueFileName = generateUniqueFileName(file.name);
      
      // Crear un FormData para enviar el archivo
      const formData = new FormData();
      formData.append('file', file, uniqueFileName);
      
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
    } catch (error) {
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
   * Obtiene la URL completa de un archivo
   * @param fileName Nombre del archivo
   * @returns URL completa del archivo
   */
  getFileUrl(fileName: string): string {
    return `${API_URL}/uploads/${fileName}`;
  }
}; 