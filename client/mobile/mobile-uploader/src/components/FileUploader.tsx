import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Alert, ScrollView, SafeAreaView, StatusBar, ToastAndroid, Platform, FlatList, LogBox } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { FontAwesome } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { generateUUID } from '../utils/fileUtils';

// Tamaño del chunk (1MB)
const CHUNK_SIZE = 1 * 1024 * 1024;

// Constantes de configuración
const MAX_FILES = 10;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_RETRIES = 3;
const ALLOWED_FILE_TYPES = ['image/*', 'video/*', 'application/pdf'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// URL del servidor
// Cambiamos la URL para que use la dirección IP local correcta
// En iOS, localhost no funciona correctamente desde el emulador/dispositivo
const DEFAULT_IP = '192.168.1.144';
const DEFAULT_PORT = '3001';
// Intentar usar la IP y puerto configurados o los valores predeterminados
const API_URL = `http://${DEFAULT_IP}:${DEFAULT_PORT}/api/upload`;

// Función de notificación que no bloquea la interfaz
const showToast = (message: string) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    // En iOS podríamos usar una biblioteca de toast o una implementación simple
    console.log(message);
    // Aquí se podría implementar una notificación personalizada para iOS
  }
};

interface FileInfo {
  id?: string;
  name: string;
  size: number;
  type: string;
  uri: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'paused';
  progress: number;
  retries: number;
  error?: string;
  uploadedChunks?: number[];
  totalChunks?: number;
  selectedForUpload?: boolean;
}

// Función para generar un ID único sin usar crypto.randomUUID()
const generateId = (): string => {
  return generateUUID();
};

const FileUploader: React.FC = () => {
  // Estado de archivos y carga
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [serverStatus, setServerStatus] = useState({
    connected: false,
    isChecking: true
  });
  
  // Opción para cambiar la URL del servidor en tiempo de ejecución
  const [serverUrl, setServerUrl] = useState(API_URL);
  
  // Estado para la cámara y previsualización
  const [cameraPermission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);
  
  // Estado para mensajes de notificación
  const [notification, setNotification] = useState<string | null>(null);
  
  // Estado para control de concurrencia
  const [activeUploads, setActiveUploads] = useState<number>(0);

  // Mostrar notificación no intrusiva en un toast más elegante
  const showNotification = (message: string) => {
    setNotification(message);
    
    // Usar solo el console.log para debug, no para notificaciones al usuario
    if (__DEV__) {
      console.log(message);
    }
    
    // Mostrar toast
    showToast(message);
    
    // Limpiar la notificación después de 3 segundos
    setTimeout(() => {
      setNotification(null);
    }, 3000);
  };

  // Verificar conexión del servidor - sin console.log
  useEffect(() => {
    const checkServerConnection = async () => {
      try {
        // Intentamos conectar con el endpoint de health
        await axios.get(`${serverUrl.split('/api')[0]}/api/monitoring/health`);
        setServerStatus({ connected: true, isChecking: false });
        showNotification('Servidor conectado');
      } catch (error) {
        setServerStatus({ connected: false, isChecking: false });
        
        // Notificación en lugar de alerta modal
        showNotification('Error de conexión al servidor');
      }
    };
    
    checkServerConnection();
  }, [serverUrl]);

  // Actualizar progreso de carga de archivo
  const updateFileProgress = (fileId: string, updates: Partial<FileInfo>) => {
    setFiles(currentFiles => 
      currentFiles.map(file => 
        file.id === fileId ? { ...file, ...updates } : file
      )
    );
  };

  // Seleccionar archivos desde la galería
  const pickFile = async () => {
    try {
      // Verificar si ya tenemos el máximo de archivos permitidos
      if (files.length >= MAX_FILES) {
        showNotification(`Máximo ${MAX_FILES} archivos permitidos`);
        return;
      }
      
      const result = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_FILE_TYPES,
        multiple: true,
        copyToCacheDirectory: true
      });
      
      if (result.canceled) return;
      
      // Verificar la cantidad total de archivos
      const totalFilesAfterAdd = files.length + result.assets.length;
      if (totalFilesAfterAdd > MAX_FILES) {
        showNotification(`Solo puedes seleccionar hasta ${MAX_FILES} archivos en total`);
        return;
      }
      
      // Validar y procesar cada archivo
      const newValidFiles: FileInfo[] = [];
      const invalidFiles: string[] = [];
      
      for (const fileAsset of result.assets) {
        // Validar que tenemos la información completa
        if (!fileAsset.uri || !fileAsset.name || fileAsset.size === undefined) {
          invalidFiles.push(fileAsset.name || 'Archivo desconocido');
          continue;
        }
        
        // Validar tamaño de archivo
        if (fileAsset.size > MAX_FILE_SIZE) {
          invalidFiles.push(`${fileAsset.name} (excede 100MB)`);
          continue;
        }
        
        // Guardar información del archivo
        newValidFiles.push({
          id: generateId(),
          name: fileAsset.name,
          size: fileAsset.size,
          type: fileAsset.mimeType || 'application/octet-stream',
          uri: fileAsset.uri,
          status: 'pending',
          progress: 0,
          retries: 0,
          selectedForUpload: true,
          totalChunks: Math.ceil(fileAsset.size / CHUNK_SIZE),
          uploadedChunks: []
        });
      }
      
      // Informar sobre archivos inválidos
      if (invalidFiles.length > 0) {
        showNotification(`${invalidFiles.length} archivos inválidos no agregados`);
        console.log('Archivos inválidos:', invalidFiles);
      }
      
      // Actualizar el estado con los nuevos archivos
      if (newValidFiles.length > 0) {
        setFiles(current => [...current, ...newValidFiles]);
        
        // Si es el primer archivo, establecer la vista previa
        if (files.length === 0 && newValidFiles.length > 0) {
          setPreviewUri(newValidFiles[0].uri);
        }
        
        showNotification(`${newValidFiles.length} archivos seleccionados`);
      }
    } catch (error) {
      console.error('Error al seleccionar archivos:', error);
      showNotification('No se pudieron seleccionar los archivos');
    }
  };

  // Seleccionar/Deseleccionar un archivo para carga
  const toggleFileSelection = (fileId: string) => {
    setFiles(currentFiles => 
      currentFiles.map(file => 
        file.id === fileId ? 
          { ...file, selectedForUpload: !file.selectedForUpload } : 
          file
      )
    );
  };

  // Renderizar item de la lista de archivos
  const renderFileItem = ({ item }: { item: FileInfo }) => (
    <View style={styles.fileListItem}>
      <TouchableOpacity 
        style={styles.fileSelectButton}
        onPress={() => toggleFileSelection(item.id!)}
        disabled={item.status === 'uploading' || item.status === 'completed'}
      >
        <FontAwesome 
          name={item.selectedForUpload ? "check-square-o" : "square-o"} 
          size={24} 
          color={
            item.status === 'uploading' || item.status === 'completed' ? "#ccc" :
            item.selectedForUpload ? "#4CAF50" : "#666"
          } 
        />
      </TouchableOpacity>
      
      {/* Miniatura del archivo */}
      {item.type.startsWith('image/') && (
        <Image 
          source={{ uri: item.uri }} 
          style={styles.fileItemThumbnail}
          resizeMode="cover"
        />
      )}
      
      {!item.type.startsWith('image/') && (
        <View style={styles.fileItemIconContainer}>
          <FontAwesome 
            name={
              item.type.startsWith('video/') ? "file-video-o" :
              item.type.startsWith('audio/') ? "file-audio-o" :
              item.type.includes('pdf') ? "file-pdf-o" : 
              "file-o"
            } 
            size={24} 
            color="#757575" 
          />
        </View>
      )}
      
      <View style={styles.fileItemContent}>
        <Text style={styles.fileItemName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.fileItemInfo}>{(item.size / 1024).toFixed(2)} KB</Text>
        
        {item.progress > 0 && (
          <View style={styles.fileItemProgressContainer}>
            <View 
              style={[
                styles.fileItemProgressBar, 
                { width: `${item.progress}%` },
                item.status === 'paused' && styles.progressBarPaused,
                item.status === 'failed' && styles.progressBarError,
                item.status === 'completed' && styles.progressBarSuccess
              ]} 
            />
            <Text style={styles.fileItemProgressText}>{item.progress.toFixed(0)}%</Text>
          </View>
        )}
        
        <Text style={[
          styles.fileItemStatus,
          item.status === 'completed' ? styles.statusSuccess : null,
          item.status === 'failed' ? styles.statusError : null,
          item.status === 'paused' ? styles.statusPaused : null
        ]}>
          {item.status === 'pending' && 'Pendiente'}
          {item.status === 'uploading' && 'Subiendo...'}
          {item.status === 'completed' && 'Completado'}
          {item.status === 'failed' && 'Error'}
          {item.status === 'paused' && 'Pausado'}
        </Text>
        
        {item.error && (
          <Text style={styles.fileItemError} numberOfLines={1}>
            {item.error}
          </Text>
        )}
      </View>
      
      <View style={styles.fileActionButtons}>
        {/* Botones dependiendo del estado */}
        {item.status === 'uploading' && (
          <TouchableOpacity 
            style={styles.fileActionButton}
            onPress={() => togglePauseUpload(item.id!)}
          >
            <FontAwesome name="pause" size={18} color="#FFC107" />
          </TouchableOpacity>
        )}
        
        {item.status === 'paused' && (
          <TouchableOpacity 
            style={styles.fileActionButton}
            onPress={() => togglePauseUpload(item.id!)}
          >
            <FontAwesome name="play" size={18} color="#4CAF50" />
          </TouchableOpacity>
        )}
        
        {item.status === 'failed' && (
          <TouchableOpacity 
            style={styles.fileActionButton}
            onPress={() => {
              // Reintentar subida
              updateFileProgress(item.id!, { status: 'pending', error: undefined });
            }}
          >
            <FontAwesome name="refresh" size={18} color="#2196F3" />
          </TouchableOpacity>
        )}
        
        <TouchableOpacity 
          style={styles.fileActionButton}
          onPress={() => {
            if (item.status === 'uploading') {
              // Si está subiendo, cancelar
              cancelUpload(item.id!);
            } else {
              // Si no está subiendo, solo eliminar
              setFiles(current => current.filter(f => f.id !== item.id));
              if (previewUri === item.uri) {
                const remainingFiles = files.filter(f => f.id !== item.id);
                if (remainingFiles.length > 0) {
                  setPreviewUri(remainingFiles[0].uri);
                } else {
                  setPreviewUri(null);
                }
              }
            }
          }}
        >
          <FontAwesome name="trash" size={18} color="#F44336" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Iniciar upload del archivo
  const uploadFile = async () => {
    if (files.length === 0) {
      showNotification('No hay archivos para subir');
      return;
    }
    
    if (!serverStatus.connected) {
      showNotification('No hay conexión con el servidor');
      return;
    }
    
    // Obtener archivos seleccionados para carga (solo los pendientes, con error o pausados)
    const selectedFiles = files.filter(file => 
      file.selectedForUpload && 
      (file.status === 'pending' || file.status === 'failed' || file.status === 'paused')
    );
    
    if (selectedFiles.length === 0) {
      showNotification('No hay archivos seleccionados para subir');
      return;
    }
    
    setIsUploading(true);
    
    // Crear un queue de carga
    const uploadQueue = [...selectedFiles];
    let hasErrors = false;
    
    // Iniciar cargas concurrentes (hasta MAX_CONCURRENT_UPLOADS)
    const runUploadQueue = async () => {
      // Procesar mientras haya archivos en la cola y menos de MAX_CONCURRENT_UPLOADS activos
      while (uploadQueue.length > 0 && activeUploads < MAX_CONCURRENT_UPLOADS) {
        const file = uploadQueue.shift();
        if (!file) break;
        
        // Incrementar el contador de cargas activas
        setActiveUploads(current => current + 1);
        
        // Iniciar la carga del archivo de forma independiente
        uploadSingleFile(file)
          .then(() => {
            // Decrementar el contador de cargas activas
            setActiveUploads(current => {
              const newCount = current - 1;
              
              // Si hay más archivos en la cola, continuar procesando
              if (uploadQueue.length > 0 && newCount < MAX_CONCURRENT_UPLOADS) {
                setTimeout(runUploadQueue, 100);
              } else if (newCount === 0 && uploadQueue.length === 0) {
                // Si todas las cargas están completas, actualizar el estado
                setIsUploading(false);
                if (!hasErrors) {
                  showNotification('Todas las cargas completadas');
                } else {
                  showNotification('Carga completada con algunos errores');
                }
              }
              return newCount;
            });
          })
          .catch(error => {
            console.error('Error en carga individual:', error);
            hasErrors = true;
            setActiveUploads(current => {
              const newCount = current - 1;
              
              // Continuar procesando otros archivos
              if (uploadQueue.length > 0 && newCount < MAX_CONCURRENT_UPLOADS) {
                setTimeout(runUploadQueue, 100);
              } else if (newCount === 0 && uploadQueue.length === 0) {
                setIsUploading(false);
                showNotification('Carga completada con errores');
              }
              return newCount;
            });
          });
      }
    };
    
    // Iniciar el procesamiento de la cola con un tiempo de espera de seguridad
    try {
      runUploadQueue();
      
      // Agregar un timeout de seguridad para evitar que se quede bloqueado en caso de error
      setTimeout(() => {
        if (activeUploads > 0) {
          console.warn("Tiempo de espera excedido para las cargas. Restableciendo estado...");
          setActiveUploads(0);
          setIsUploading(false);
          showNotification('Tiempo de espera excedido. Algunas cargas pueden haber fallado.');
        }
      }, 120000); // 2 minutos como límite máximo
    } catch (error) {
      console.error("Error general en el proceso de carga:", error);
      setIsUploading(false);
      setActiveUploads(0);
      showNotification('Error al iniciar el proceso de carga');
    }
  };

  // Cargar un solo archivo con sistema de reintentos
  const uploadSingleFile = async (file: FileInfo): Promise<void> => {
    // Asegurarnos de que el archivo tiene un ID único
    const fileId = file.id || generateId();
    
    // Actualizar estado inicial
    updateFileProgress(fileId, { 
      id: fileId,
      status: 'uploading',
      retries: 0,
      progress: 0,
      uploadedChunks: file.uploadedChunks || []
    });
    
    try {
      // 1. Iniciar el proceso de carga en el servidor
      const initResponse = await axiosWithRetry(() => axios.post(`${serverUrl}/init`, {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        totalChunks: Math.ceil(file.size / CHUNK_SIZE)
      }));
      
      const serverFileId = initResponse.data.fileId;
      
      if (!serverFileId) {
        throw new Error('No se recibió ID de archivo del servidor');
      }
      
      // Actualizar con el ID del servidor
      updateFileProgress(fileId, { 
        id: serverFileId,
        status: 'uploading'
      });
      
      // 2. Cargar chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      // Obtener chunks ya subidos (para reanudación)
      const uploadedChunks = file.uploadedChunks || [];
      
      // Preparar array de promesas para chunks
      const chunkPromises = [];
      
      for (let i = 0; i < totalChunks; i++) {
        // Omitir chunks ya subidos
        if (uploadedChunks.includes(i)) {
          continue;
        }
        
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        
        // Crear y almacenar la promesa de carga de chunk
        const chunkPromise = (async (chunkIndex) => {
          try {
            // Leer el chunk como base64
            const chunk = await FileSystem.readAsStringAsync(file.uri, {
              encoding: FileSystem.EncodingType.Base64,
              position: start,
              length: end - start
            });
            
            // Dividir el chunk en partes más pequeñas si es demasiado grande
            const MAX_CHUNK_SIZE = 500000; // Tamaño máximo en caracteres para la petición
            if (chunk.length > MAX_CHUNK_SIZE) {
              console.log(`Subiendo fragmento ${chunkIndex}/${totalChunks} (${start}-${end} de ${file.size})`);
              
              // Usar formData con Blob en lugar de datos base64 directos
              const formData = new FormData();
              formData.append('fileId', serverFileId);
              formData.append('chunkIndex', String(chunkIndex));
              formData.append('totalChunks', String(totalChunks));
              
              // Crear un blob desde los datos del archivo para este chunk
              const fileChunk = {
                uri: file.uri,
                type: file.type,
                name: `${file.name}.part${chunkIndex}`,
              };
              
              formData.append('chunk', fileChunk as any);
              
              // Enviar el chunk con reintentos
              await axiosWithRetry(() => axios.post(`${serverUrl}/chunk/${serverFileId}/${chunkIndex}`, formData, {
                headers: {
                  'Content-Type': 'multipart/form-data',
                  'X-Large-Chunk': 'true'
                }
              }));
            } else {
              // Para chunks pequeños, usar el enfoque original
              const formData = new FormData();
              formData.append('fileId', serverFileId);
              formData.append('chunkIndex', String(chunkIndex));
              formData.append('totalChunks', String(totalChunks));
              formData.append('chunkData', chunk);
              
              await axiosWithRetry(() => axios.post(`${serverUrl}/chunk/${serverFileId}/${chunkIndex}`, formData, {
                headers: {
                  'Content-Type': 'multipart/form-data'
                }
              }));
            }
            
            // Actualizar chunks subidos
            updateFileProgress(serverFileId, { 
              uploadedChunks: [...(file.uploadedChunks || []), chunkIndex]
            });
            
            // Actualizar progreso
            const currentFile = files.find(f => f.id === serverFileId);
            if (currentFile) {
              const currentChunks = [...(currentFile.uploadedChunks || []), chunkIndex];
              const progress = Math.round((currentChunks.length / totalChunks) * 100);
              updateFileProgress(serverFileId, { progress });
            }
            
            return true;
          } catch (error) {
            console.error(`Error al subir chunk ${chunkIndex}:`, error);
            throw error;
          }
        })(i);
        
        chunkPromises.push(chunkPromise);
      }
      
      // Esperar a que todos los chunks se carguen
      await Promise.all(chunkPromises);
      
      // 3. Finalizar la carga
      await axiosWithRetry(() => axios.post(`${serverUrl}/finalize/${serverFileId}`));
      
      // Actualizar estado final
      updateFileProgress(serverFileId, { 
        status: 'completed', 
        progress: 100
      });
      
      showNotification(`"${file.name}" subido correctamente`);
      return;
    } catch (error: any) {
      // Mensaje de error más descriptivo
      let errorMessage = 'No se pudo completar la carga.';
      
      if (error.response) {
        errorMessage += ` Error ${error.response.status}`;
      } else if (error.request) {
        errorMessage += ' No se recibió respuesta del servidor.';
      } else {
        errorMessage += ` ${error.message}`;
      }
      
      // Actualizar estado de error
      const currentFileId = file.id || fileId;
      updateFileProgress(currentFileId, { 
        status: 'failed',
        error: errorMessage
      });
      
      showNotification(`Error al subir "${file.name}"`);
      throw error;
    }
  };

  // Utilidad para ejecutar solicitudes con reintentos automáticos
  const axiosWithRetry = async <T,>(
    fn: () => Promise<T>, 
    maxRetries: number = MAX_RETRIES, 
    delay: number = 1000
  ): Promise<T> => {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Comprobar si el error es HTTP 500 con mensaje específico de "Field value too long"
        if (error.response && 
            error.response.status === 500 && 
            error.response.data && 
            error.response.data.message && 
            error.response.data.message.includes("Field value too long")) {
          console.error("Error de valor demasiado largo, no se reintentará:", error.response.data);
          throw error; // No reintentar este tipo de error
        }
        
        // Log del intento fallido
        console.log(`Intento ${attempt + 1}/${maxRetries} fallido, reintentando en ${delay}ms...`);
        
        // Mostrar notificación solo en el primer intento
        if (attempt === 0) {
          showNotification(`Reintentando... (${attempt + 1}/${maxRetries})`);
        }
        
        // Esperar antes de reintentar (retroceso exponencial)
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Duplicar el tiempo de espera para el próximo intento
      }
    }
    
    console.error(`Todos los reintentos fallaron después de ${maxRetries} intentos`, lastError);
    throw lastError;
  };

  // Función de pausa/reanudar carga
  const togglePauseUpload = (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    
    const newStatus = file.status === 'paused' ? 'pending' : 'paused';
    updateFileProgress(fileId, { status: newStatus });
    
    showNotification(
      newStatus === 'paused' 
        ? `Carga de "${file.name}" pausada` 
        : `Carga de "${file.name}" lista para reanudar`
    );
  };

  // Cancelar carga de archivo
  const cancelUpload = (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    
    // Si el archivo está en proceso de carga, intentar cancelar en el servidor
    if (file.status === 'uploading' && file.id) {
      axios.delete(`${serverUrl}/cancel/${file.id}`)
        .catch(error => console.error('Error al cancelar en servidor:', error));
    }
    
    // Eliminar el archivo de la lista
    setFiles(current => current.filter(f => f.id !== fileId));
    
    // Si era el archivo de la vista previa, actualizar
    if (previewUri === file.uri) {
      const remainingFiles = files.filter(f => f.id !== fileId);
      if (remainingFiles.length > 0) {
        setPreviewUri(remainingFiles[0].uri);
      } else {
        setPreviewUri(null);
      }
    }
    
    showNotification(`Carga de "${file.name}" cancelada`);
  };

  // Función para tomar fotos con la cámara y procesarlas como archivos
  const takePicture = async () => {
    // Verificar si ya tenemos el máximo de archivos permitidos
    if (files.length >= MAX_FILES) {
      showNotification(`Máximo ${MAX_FILES} archivos permitidos`);
      return;
    }
    
    if (!cameraRef.current) {
      showNotification('La cámara no está disponible');
      return;
    }
    
    // Efecto visual al presionar sin alerta
    showNotification('Tomando foto...');
    
    try {
      console.log('Intentando tomar foto...');
      const photo = await cameraRef.current.takePictureAsync();
      console.log('Foto tomada:', photo.uri);
      
      // Cerrar cámara
      setShowCamera(false);
      
      // Guardar información de la foto como un archivo
      const timestamp = new Date().getTime();
      const photoName = `photo_${timestamp}.jpg`;
      
      // Obtener información del archivo
      const fileInfo = await FileSystem.getInfoAsync(photo.uri);
      const fileSize = fileInfo.exists && 'size' in fileInfo ? fileInfo.size : 0;
      
      // Crear nuevo objeto FileInfo
      const newFile: FileInfo = {
        id: generateId(),
        name: photoName,
        size: fileSize,
        type: 'image/jpeg',
        uri: photo.uri,
        status: 'pending',
        progress: 0,
        retries: 0,
        selectedForUpload: true,
        totalChunks: Math.ceil(fileSize / CHUNK_SIZE),
        uploadedChunks: []
      };
      
      // Actualizar estado
      setFiles(currentFiles => [...currentFiles, newFile]);
      setPreviewUri(photo.uri);
      
      // Feedback positivo
      showNotification('Foto capturada');
    } catch (error) {
      console.error('Error al tomar foto:', error);
      showNotification('No se pudo capturar la imagen');
    }
  };

  // Vista de cámara cuando está activa
  if (showCamera) {
    if (!cameraPermission || !cameraPermission.granted) {
      return (
        <SafeAreaView style={styles.fullScreenContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          <View style={styles.noCameraPermission}>
            <Text style={styles.permissionText}>No hay permiso para acceder a la cámara</Text>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => {
                requestPermission();
                setShowCamera(false);
              }}
            >
              <Text style={styles.backButtonText}>Solicitar permiso</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    
    return (
      <SafeAreaView style={styles.fullScreenContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <CameraView 
          ref={(ref) => { cameraRef.current = ref; }}
          style={styles.camera}
          facing="back"
          onCameraReady={() => console.log('Cámara lista')}
          onMountError={(event) => console.error('Error al montar cámara:', event.message)}
        >
          <View style={styles.cameraControls}>
            <TouchableOpacity 
              style={styles.captureButton} 
              onPress={takePicture}
            >
              <FontAwesome name="camera" size={24} color="white" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={() => setShowCamera(false)}
            >
              <FontAwesome name="times" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </CameraView>
      </SafeAreaView>
    );
  }

  // Vista principal
  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f7" />
      
      <View style={styles.header}>
        <Text style={styles.headerText}>Subir Archivos</Text>
      </View>
      
      <View style={styles.uploadContainer}>
        {/* Mostrador de notificaciones */}
        {notification && (
          <View style={styles.notificationContainer}>
            <Text style={styles.notificationText}>{notification}</Text>
          </View>
        )}
        
        {/* Indicador de estado del servidor */}
        <View style={styles.statusContainer}>
          <View style={[
            styles.statusIndicator, 
            serverStatus.isChecking 
              ? styles.statusChecking 
              : serverStatus.connected 
                ? styles.statusConnected 
                : styles.statusDisconnected
          ]} />
          <Text style={styles.statusText}>
            {serverStatus.isChecking 
              ? 'Verificando conexión...' 
              : serverStatus.connected 
                ? 'Servidor conectado' 
                : 'Servidor desconectado'}
          </Text>
        </View>
        
        {/* Contador de archivos */}
        <Text style={styles.fileCounter}>
          {files.length} / {MAX_FILES} archivos seleccionados
        </Text>
        
        {/* Botones de acción principal */}
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={[
              styles.button, 
              styles.pickButton,
              (isUploading || files.length >= MAX_FILES) && styles.buttonDisabled
            ]} 
            onPress={pickFile}
            disabled={isUploading || files.length >= MAX_FILES}
          >
            <FontAwesome name="file" size={20} color="white" />
            <Text style={styles.buttonText}>Seleccionar</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[
              styles.button, 
              styles.cameraButton,
              (isUploading || !cameraPermission?.granted || files.length >= MAX_FILES) && styles.buttonDisabled
            ]} 
            onPress={() => setShowCamera(true)}
            disabled={isUploading || !cameraPermission?.granted || files.length >= MAX_FILES}
          >
            <FontAwesome name="camera" size={20} color="white" />
            <Text style={styles.buttonText}>Cámara</Text>
          </TouchableOpacity>
        </View>
        
        {/* Lista de archivos */}
        {files.length > 0 && (
          <View style={styles.fileListContainer}>
            <Text style={styles.sectionTitle}>Archivos seleccionados:</Text>
            <FlatList
              data={files}
              renderItem={renderFileItem}
              keyExtractor={(item, index) => item.id || `file-${index}`}
              style={styles.fileList}
              scrollEnabled={true}
              nestedScrollEnabled={true}
            />
          </View>
        )}
        
        {/* Previsualización del archivo */}
        {previewUri && (
          <View style={styles.previewContainer}>
            <Text style={styles.sectionTitle}>Previsualización:</Text>
            <ScrollView 
              horizontal 
              style={styles.previewGrid}
              contentContainerStyle={styles.previewGridContainer}
            >
              {files.filter(file => file.type.startsWith('image/')).slice(0, 4).map((file, index) => (
                <TouchableOpacity
                  key={file.id || index}
                  onPress={() => setPreviewUri(file.uri)}
                  style={[
                    styles.previewGridItem,
                    previewUri === file.uri && styles.previewGridItemSelected
                  ]}
                >
                  <Image
                    source={{ uri: file.uri }}
                    style={styles.previewGridImage}
                    resizeMode="cover"
                  />
                  {file.status === 'uploading' && (
                    <View style={styles.previewItemOverlay}>
                      <ActivityIndicator size="small" color="white" />
                      <Text style={styles.previewItemProgress}>{file.progress.toFixed(0)}%</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Image 
              source={{ uri: previewUri }} 
              style={styles.previewImage}
              resizeMode="contain"
            />
          </View>
        )}
        
        {/* Botones de acción secundaria */}
        {files.length > 0 && (
          <View style={styles.actionContainer}>
            {!isUploading ? (
              <>
                <TouchableOpacity 
                  style={[
                    styles.button, 
                    styles.uploadButton,
                    (!serverStatus.connected || 
                      files.filter(f => f.selectedForUpload && f.status !== 'completed').length === 0) && 
                    styles.buttonDisabled
                  ]} 
                  onPress={() => {
                    showNotification('Iniciando carga...');
                    uploadFile();
                  }}
                  disabled={!serverStatus.connected || files.filter(f => f.selectedForUpload && f.status !== 'completed').length === 0}
                >
                  <FontAwesome name="upload" size={20} color="white" />
                  <Text style={styles.buttonText}>
                    {files.filter(f => f.selectedForUpload && f.status !== 'completed').length > 0 
                      ? 'Subir seleccionados' 
                      : 'No hay archivos para subir'}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.button, styles.resetButton]} 
                  onPress={() => {
                    setFiles([]);
                    setPreviewUri(null);
                    showNotification('Se han limpiado todos los archivos');
                  }}
                >
                  <FontAwesome name="trash" size={20} color="white" />
                  <Text style={styles.buttonText}>Eliminar todos</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#4CAF50" />
                <Text style={styles.loadingText}>Subiendo archivos...</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
};

// Ocultar el mensaje de error en desarrollo
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested',
  'ScrollView child layout',
  'Require cycle:', // También ocultar advertencias de ciclos de dependencia
  'Warning: Invariant Violation: ScrollView child layout'
]);

// Actualizar estilos para adaptarse a la nueva estructura
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
    alignItems: 'center',
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  uploadContainer: {
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    justifyContent: 'center',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusConnected: {
    backgroundColor: '#4CAF50',
  },
  statusDisconnected: {
    backgroundColor: '#F44336',
  },
  statusChecking: {
    backgroundColor: '#FFC107',
  },
  statusText: {
    fontSize: 14,
    color: '#666',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pickButton: {
    backgroundColor: '#2196F3',
    flex: 1,
    marginRight: 8,
  },
  cameraButton: {
    backgroundColor: '#9C27B0',
    flex: 1,
    marginLeft: 8,
  },
  uploadButton: {
    backgroundColor: '#4CAF50',
    flex: 1,
    marginRight: 8,
  },
  resetButton: {
    backgroundColor: '#F44336',
    flex: 1,
    marginLeft: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    marginLeft: 8,
    fontSize: 16,
  },
  previewContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  fileInfoContainer: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 12,
  },
  fileInfoText: {
    color: '#333',
    fontSize: 14,
    marginBottom: 4,
  },
  progressContainer: {
    height: 20,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    marginVertical: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  progressText: {
    position: 'absolute',
    color: '#fff',
    width: '100%',
    textAlign: 'center',
    lineHeight: 20,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 16,
  },
  statusMessage: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 8,
    fontWeight: 'bold',
    color: '#757575',
  },
  statusSuccess: {
    color: '#4CAF50',
  },
  statusError: {
    color: '#F44336',
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'white',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noCameraPermission: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  permissionText: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
    marginHorizontal: 20,
  },
  backButton: {
    marginTop: 20,
    padding: 12,
    backgroundColor: '#2196F3',
    borderRadius: 8,
    paddingHorizontal: 20,
  },
  backButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
    fontWeight: 'bold',
  },
  notificationContainer: {
    backgroundColor: 'rgba(33, 33, 33, 0.85)',
    borderRadius: 24,
    padding: 12,
    marginBottom: 20,
    alignSelf: 'center',
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  notificationText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  fileCounter: {
    textAlign: 'center',
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  fileListContainer: {
    marginVertical: 16,
    flex: 0,
    height: 240, // Altura fija para la lista de archivos
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  fileList: {
    flex: 1,
    height: 210,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
  },
  fileListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  fileSelectButton: {
    marginRight: 10,
  },
  fileItemContent: {
    flex: 1,
  },
  fileItemName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  fileItemInfo: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  fileItemStatus: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  fileItemProgressContainer: {
    height: 10,
    backgroundColor: '#e0e0e0',
    borderRadius: 5,
    marginTop: 4,
    marginBottom: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  fileItemProgressBar: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 5,
  },
  fileItemProgressText: {
    position: 'absolute',
    color: '#fff',
    fontSize: 8,
    fontWeight: 'bold',
    width: '100%',
    textAlign: 'center',
    lineHeight: 10,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  fileActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileActionButton: {
    marginLeft: 8,
    padding: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  fileItemError: {
    fontSize: 10,
    color: '#F44336',
    marginTop: 2,
  },
  statusPaused: {
    color: '#FFC107',
  },
  fileItemThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 6,
    marginRight: 10,
  },
  fileItemIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 6,
    marginRight: 10,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBarPaused: {
    backgroundColor: '#FFC107',
  },
  progressBarError: {
    backgroundColor: '#F44336',
  },
  progressBarSuccess: {
    backgroundColor: '#4CAF50',
  },
  fileListWrapper: {
    maxHeight: 250,
    borderRadius: 10,
    overflow: 'hidden',
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  previewGridContainer: {
    justifyContent: 'space-between',
    flexDirection: 'row',
    padding: 5,
  },
  previewGridItem: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginHorizontal: 5,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  previewGridItemSelected: {
    borderColor: '#2196F3',
  },
  previewGridImage: {
    width: '100%',
    height: '100%',
  },
  previewItemOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewItemProgress: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 4,
  },
});

export default FileUploader; 