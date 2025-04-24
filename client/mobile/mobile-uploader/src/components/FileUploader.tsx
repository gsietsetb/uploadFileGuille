import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  ActivityIndicator,
  Alert,
  Image,
  Platform
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialIcons } from '@expo/vector-icons';
import {FileToUpload, uploadService} from "../services/uploadService";
import {getFileExtension, normalizeFileName} from "../utils/fileUtils";

// Tipo para el seguimiento del progreso de carga
interface FileProgress {
  id: string;
  name: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
  url?: string;
}

const FileUploader: React.FC = () => {
  // Estado para los archivos y su progreso
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Seleccionar archivo
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        multiple: false,
      });
      
      if (result.canceled) {
        console.log('El usuario canceló la selección');
        return;
      }
      
      const document = result.assets[0];
      if (!document) return;
      
      // Crear un ID único para este archivo
      const fileId = Date.now().toString();
      
      // Normalizar el nombre del archivo
      const normalizedName = normalizeFileName(document.name || 'archivo-sin-nombre');
      
      // Añadir el archivo a la lista con estado pendiente
      setFiles(currentFiles => [
        ...currentFiles,
        {
          id: fileId,
          name: normalizedName,
          progress: 0,
          status: 'pending'
        }
      ]);
      
      // Preparar archivo para cargar
      const fileToUpload: FileToUpload = {
        uri: document.uri,
        name: normalizedName,
        type: document.mimeType || '',
        size: document.size
      };
      
      // Cargar archivo
      uploadFile(fileId, fileToUpload);
      
    } catch (err) {
      console.error('Error al seleccionar archivo:', err);
      Alert.alert('Error', 'No se pudo seleccionar el archivo');
    }
  };
  
  // Cargar archivo al servidor
  const uploadFile = async (fileId: string, file: FileToUpload) => {
    try {
      setIsUploading(true);
      
      // Actualizar estado a 'uploading'
      updateFileProgress(fileId, { status: 'uploading' });
      
      // Determinar si usar carga en fragmentos según tamaño
      const useChunks = file.size && file.size > 5 * 1024 * 1024; // 5MB
      
      // Función para actualizar progreso
      const onProgress = (progress: number) => {
        updateFileProgress(fileId, { progress });
      };
      
      // Cargar archivo con reintentos
      let retries = 3;
      let lastError = null;
      
      while (retries > 0) {
        try {
          const response = useChunks
            ? await uploadService.uploadFileInChunks(file, 1024 * 1024, onProgress)
            : await uploadService.uploadFile(file, onProgress);
          
          if (response.success) {
            updateFileProgress(fileId, { 
              status: 'completed', 
              progress: 100,
              url: response.fileUrl
            });
            return;
          } else {
            throw new Error(response.error || 'Error al cargar archivo');
          }
        } catch (error: any) {
          lastError = error;
          if (error.response?.status === 429) {
            // Esperar antes de reintentar
            await new Promise(resolve => setTimeout(resolve, 2000 * (4 - retries)));
            retries--;
          } else {
            throw error;
          }
        }
      }
      
      throw lastError;
      
    } catch (error: any) {
      console.error('Error al cargar archivo:', error);
      updateFileProgress(fileId, { 
        status: 'error', 
        error: error.message || 'Error inesperado al cargar archivo'
      });
    } finally {
      setIsUploading(false);
    }
  };
  
  // Actualizar progreso de un archivo
  const updateFileProgress = (fileId: string, update: Partial<FileProgress>) => {
    setFiles(currentFiles => 
      currentFiles.map(file => 
        file.id === fileId ? { ...file, ...update } : file
      )
    );
  };
  
  // Cancelar carga
  const cancelUpload = (fileId: string) => {
    // Remover archivo de la lista
    setFiles(currentFiles => currentFiles.filter(file => file.id !== fileId));
  };
  
  // Renderizar indicador de estado
  const renderStatusIndicator = (file: FileProgress) => {
    switch (file.status) {
      case 'pending':
        return <Text style={styles.statusText}>Pendiente</Text>;
      
      case 'uploading':
        return (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${file.progress}%` }]} />
            <Text style={styles.progressText}>{file.progress}%</Text>
          </View>
        );
        
      case 'completed':
        return <Text style={[styles.statusText, styles.successText]}>Completado</Text>;
        
      case 'error':
        return <Text style={[styles.statusText, styles.errorText]}>Error</Text>;
        
      default:
        return null;
    }
  };
  
  // Renderizar previsualización de archivo
  const renderFilePreview = (file: FileProgress) => {
    const extension = getFileExtension(file.name).toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(extension);
    
    if (isImage && file.url) {
      return (
        <Image 
          source={{ uri: file.url }} 
          style={styles.previewImage}
          resizeMode="cover"
        />
      );
    }
    
    // Icono basado en tipo de archivo
    let iconName: keyof typeof MaterialIcons.glyphMap = 'insert-drive-file';
    let iconColor = '#666';
    
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(extension)) {
      iconName = 'image';
      iconColor = '#4CAF50';
    } else if (['mp4', 'mov', 'avi', 'webm'].includes(extension)) {
      iconName = 'video-library';
      iconColor = '#2196F3';
    } else if (['doc', 'docx'].includes(extension)) {
      iconName = 'description';
      iconColor = '#2196F3';
    } else if (['xls', 'xlsx'].includes(extension)) {
      iconName = 'table-chart';
      iconColor = '#4CAF50';
    } else if (['pdf'].includes(extension)) {
      iconName = 'picture-as-pdf';
      iconColor = '#F44336';
    }
    
    return (
      <View style={styles.fileIconContainer}>
        <MaterialIcons name={iconName} size={32} color={iconColor} />
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cargador de Archivos</Text>
      
      <TouchableOpacity 
        style={styles.button} 
        onPress={pickDocument}
        disabled={isUploading}
      >
        <Text style={styles.buttonText}>Seleccionar Archivo</Text>
      </TouchableOpacity>
      
      {/* Lista de archivos */}
      {files.length > 0 && (
        <View style={styles.fileList}>
          <Text style={styles.subtitle}>Archivos:</Text>
          
          {files.map(file => (
            <View key={file.id} style={styles.fileItem}>
              {renderFilePreview(file)}
              
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
                  {file.name}
                </Text>
                {renderStatusIndicator(file)}
                {file.error && (
                  <Text style={styles.errorMessage} numberOfLines={2}>
                    {file.error}
                  </Text>
                )}
              </View>
              
              <TouchableOpacity 
                style={styles.cancelButton} 
                onPress={() => cancelUpload(file.id)}
              >
                <Text style={styles.cancelText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      
      {isUploading && (
        <ActivityIndicator style={styles.loader} size="large" color="#0066cc" />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f7',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  button: {
    backgroundColor: '#0066cc',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 15,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fileList: {
    marginTop: 20,
  },
  fileItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  fileIconContainer: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  previewImage: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 10,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  progressContainer: {
    height: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 5,
    position: 'relative',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4cd964',
    borderRadius: 10,
  },
  progressText: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    color: '#333',
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  errorText: {
    color: '#ff3b30',
  },
  successText: {
    color: '#34c759',
  },
  errorMessage: {
    fontSize: 11,
    color: '#ff3b30',
    marginTop: 2,
  },
  cancelButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  cancelText: {
    fontSize: 18,
    color: '#ff3b30',
    fontWeight: 'bold',
  },
  loader: {
    marginTop: 20,
  }
});

export default FileUploader; 