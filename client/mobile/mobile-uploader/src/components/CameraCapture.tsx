import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  Alert,
  Image,
  Platform,
  SafeAreaView
} from 'react-native';
import { Camera } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { FileToUpload } from '../services/uploadService';
import { generateUniqueFileName } from '../utils/fileUtils';

// Definiciones de tipos que faltan en expo-camera
enum CameraTypes {
  front = 'front',
  back = 'back'
}

enum FlashModes {
  on = 'on',
  off = 'off',
  auto = 'auto',
  torch = 'torch'
}

interface CameraCaptureProps {
  onCapture: (file: FileToUpload) => void;
  onCancel: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onCancel }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [cameraType, setCameraType] = useState<CameraTypes>(CameraTypes.back);
  const [flashMode, setFlashMode] = useState<FlashModes>(FlashModes.off);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      if (status !== 'granted') {
        Alert.alert(
          'Permiso denegado',
          'Para usar la cámara, necesitas conceder permiso en la configuración de tu dispositivo.',
          [
            { text: 'Cancelar', onPress: onCancel, style: 'cancel' },
            { text: 'OK' }
          ]
        );
      }
    })();
  }, []);

  const takePicture = async () => {
    if (!cameraRef.current) return;
    
    try {
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.8,
        skipProcessing: true 
      });
      
      setPreviewUri(photo.uri);
    } catch (error) {
      console.error('Error al tomar foto:', error);
      Alert.alert('Error', 'No se pudo capturar la imagen');
    }
  };

  const confirmCapture = async () => {
    if (!previewUri) return;

    try {
      // Preparar el archivo para subir
      const fileName = generateUniqueFileName('camera-photo.jpg');
      
      const fileToUpload: FileToUpload = {
        uri: previewUri,
        name: fileName,
        type: 'image/jpeg',
        size: 0, // No se puede determinar el tamaño en este punto
      };
      
      onCapture(fileToUpload);
    } catch (error) {
      console.error('Error al procesar imagen:', error);
      Alert.alert('Error', 'No se pudo procesar la imagen');
    }
  };

  const toggleCameraType = () => {
    setCameraType(current => 
      current === CameraTypes.back ? CameraTypes.front : CameraTypes.back
    );
  };

  const toggleFlash = () => {
    setFlashMode(current => 
      current === FlashModes.off 
        ? FlashModes.on 
        : FlashModes.off
    );
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text>Solicitando permiso de cámara...</Text></View>;
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No hay acceso a la cámara</Text>
        <TouchableOpacity style={styles.button} onPress={onCancel}>
          <Text style={styles.buttonText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {previewUri ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: previewUri }} style={styles.preview} />
          
          <View style={styles.previewControls}>
            <TouchableOpacity 
              style={[styles.roundButton, styles.cancelButton]} 
              onPress={() => setPreviewUri(null)}
            >
              <MaterialIcons name="close" size={24} color="white" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.roundButton, styles.confirmButton]} 
              onPress={confirmCapture}
            >
              <MaterialIcons name="check" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.cameraContainer}>
          <Camera
            ref={cameraRef}
            style={styles.camera}
            type={cameraType}
            flashMode={flashMode}
          >
            <View style={styles.controlsContainer}>
              <TouchableOpacity style={styles.backButton} onPress={onCancel}>
                <MaterialIcons name="arrow-back" size={28} color="white" />
              </TouchableOpacity>
              
              <View style={styles.cameraControls}>
                <TouchableOpacity style={styles.controlButton} onPress={toggleFlash}>
                  <MaterialIcons 
                    name={flashMode === FlashModes.on ? "flash-on" : "flash-off"} 
                    size={28} 
                    color="white" 
                  />
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
                  <View style={styles.captureButtonInner} />
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.controlButton} onPress={toggleCameraType}>
                  <MaterialIcons name="flip-camera-ios" size={28} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </Camera>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  controlsContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    flexDirection: 'column',
    justifyContent: 'space-between',
    marginHorizontal: 20,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginTop: 40,
    marginLeft: 10,
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 30,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  previewContainer: {
    flex: 1,
    position: 'relative',
  },
  preview: {
    flex: 1,
  },
  previewControls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  roundButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 20,
  },
  confirmButton: {
    backgroundColor: '#4CAF50',
  },
  cancelButton: {
    backgroundColor: '#F44336',
  },
  button: {
    backgroundColor: '#0066cc',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#F44336',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
  }
});

export default CameraCapture; 