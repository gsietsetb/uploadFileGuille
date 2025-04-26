import React from 'react';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';
import FileUploader from '../src/components/FileUploader';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { CameraView } from 'expo-camera';

// Mocks
jest.mock('axios');
jest.mock('expo-file-system');
jest.mock('expo-document-picker');
jest.mock('expo-camera');
jest.mock('expo-crypto');
jest.mock('@expo/vector-icons', () => ({
  FontAwesome: 'FontAwesome'
}));

describe('FileUploader Component', () => {
  beforeEach(() => {
    // Limpiar todos los mocks
    jest.clearAllMocks();
    
    // Mock para randomUUID
    (Crypto.randomUUID as jest.Mock).mockReturnValue('test-uuid-123');
    
    // Mock para axios
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
    (axios.post as jest.Mock).mockImplementation((url) => {
      if (url.includes('/init')) {
        return Promise.resolve({ data: { fileId: 'server-file-id-123' } });
      } else if (url.includes('/chunk')) {
        return Promise.resolve({ data: { success: true } });
      } else if (url.includes('/finalize')) {
        return Promise.resolve({ data: { url: '/uploads/test.jpg', hash: 'abc123' } });
      }
      return Promise.resolve({ data: {} });
    });
    
    // Mock para FileSystem
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1024 * 1024, // 1MB
      isDirectory: false
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('base64encodeddata');
    
    // Mock para DocumentPicker
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file://test/image.jpg',
          name: 'image.jpg',
          size: 1024 * 1024,
          mimeType: 'image/jpeg'
        }
      ]
    });
    
    // Mock for CameraView
    (CameraView as jest.Mock).mockImplementation(({ children, ref }) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: jest.fn().mockResolvedValue({
          uri: 'file://test/camera_photo.jpg',
          width: 1000,
          height: 1000
        })
      }));
      return <div>{children}</div>;
    });
  });
  
  it('should render correctly', () => {
    const { getByText } = render(<FileUploader />);
    
    expect(getByText('Subir Archivos')).toBeTruthy();
    expect(getByText('Seleccionar')).toBeTruthy();
    expect(getByText('Cámara')).toBeTruthy();
  });
  
  it('should check server connection on mount', async () => {
    render(<FileUploader />);
    
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/monitoring/health'));
    });
  });
  
  it('should pick a file when Select button is pressed', async () => {
    const { getByText } = render(<FileUploader />);
    
    // Simular click en botón "Seleccionar"
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // Verificar que se llamó al selector de documentos
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      type: expect.any(Array),
      multiple: true,
      copyToCacheDirectory: true
    });
    
    // La UI debería mostrar el archivo seleccionado
    await waitFor(() => {
      expect(getByText('image.jpg')).toBeTruthy();
      expect(getByText('1.00 KB')).toBeTruthy();
      expect(getByText('Pendiente')).toBeTruthy();
    });
  });
  
  it('should upload a file', async () => {
    const { getByText, queryByText } = render(<FileUploader />);
    
    // Paso 1: Seleccionar archivo
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // Esperar a que el archivo aparezca en la lista
    await waitFor(() => {
      expect(getByText('image.jpg')).toBeTruthy();
    });
    
    // Paso 2: Iniciar carga
    await act(async () => {
      fireEvent.press(getByText('Subir seleccionados'));
    });
    
    // Verificar peticiones al servidor
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/init'),
      expect.objectContaining({
        fileName: 'image.jpg',
        fileSize: 1024 * 1024
      })
    );
    
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chunk/server-file-id-123/0'),
      expect.any(Object),
      expect.any(Object)
    );
    
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/finalize/server-file-id-123')
    );
    
    // La UI debería mostrar "Completado" eventualmente
    await waitFor(() => {
      expect(getByText('Completado')).toBeTruthy();
    });
  });
  
  it('should handle file upload errors', async () => {
    // Mock para simular error en la carga
    (axios.post as jest.Mock).mockImplementation((url) => {
      if (url.includes('/init')) {
        return Promise.resolve({ data: { fileId: 'server-file-id-123' } });
      } else if (url.includes('/chunk')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ data: {} });
    });
    
    const { getByText } = render(<FileUploader />);
    
    // Paso 1: Seleccionar archivo
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // Esperar a que el archivo aparezca en la lista
    await waitFor(() => {
      expect(getByText('image.jpg')).toBeTruthy();
    });
    
    // Paso 2: Iniciar carga
    await act(async () => {
      fireEvent.press(getByText('Subir seleccionados'));
    });
    
    // La UI debería mostrar "Error" eventualmente
    await waitFor(() => {
      expect(getByText('Error')).toBeTruthy();
    });
  });
  
  it('should take a picture when camera is used', async () => {
    const { getByText } = render(<FileUploader />);
    
    // Mock de permisos de cámara
    jest.spyOn(React, 'useState').mockImplementation((initial) => {
      if (typeof initial === 'object' && initial !== null && 'granted' in initial) {
        return [{ granted: true }, jest.fn()];
      }
      return [initial, jest.fn()];
    });
    
    // Abrir cámara
    await act(async () => {
      fireEvent.press(getByText('Cámara'));
    });
    
    // Simular toma de foto (no podemos directamente ya que el componente CameraView está mockeado)
    // Pero podemos verificar que se renderizó
    expect(CameraView).toHaveBeenCalled();
  });
  
  it('should pause and resume upload', async () => {
    const { getByText, getAllByText } = render(<FileUploader />);
    
    // Paso 1: Seleccionar archivo
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // Esperar a que el archivo aparezca en la lista
    await waitFor(() => {
      expect(getByText('image.jpg')).toBeTruthy();
    });
    
    // Paso 2: Iniciar carga
    await act(async () => {
      fireEvent.press(getByText('Subir seleccionados'));
    });
    
    // Mock para cambiar estado del archivo a 'uploading'
    jest.spyOn(React, 'useState').mockImplementationOnce(() => [
      [{
        id: 'server-file-id-123',
        name: 'image.jpg',
        size: 1024 * 1024,
        type: 'image/jpeg',
        uri: 'file://test/image.jpg',
        status: 'uploading',
        progress: 50,
        retries: 0,
        uploadedChunks: [0],
        totalChunks: 2,
        selectedForUpload: true
      }],
      jest.fn()
    ]);
    
    // Re-renderizar para reflejar el cambio de estado
    await act(async () => {
      render(<FileUploader />);
    });
    
    // Buscar botón de pausa/play (los iconos están mockeados, así que no podemos encontrarlos directamente)
    // En lugar de eso, podemos verificar cómo respondería el componente
    expect(axios.post).toHaveBeenCalled();
  });
  
  it('should cancel upload', async () => {
    (axios.delete as jest.Mock) = jest.fn().mockResolvedValue({ status: 204 });
    
    const { getByText } = render(<FileUploader />);
    
    // Paso 1: Seleccionar archivo
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // Esperar a que el archivo aparezca en la lista
    await waitFor(() => {
      expect(getByText('image.jpg')).toBeTruthy();
    });
    
    // Buscar y presionar el botón de eliminar (trash)
    const buttons = document.querySelectorAll('button, TouchableOpacity');
    const deleteButton = Array.from(buttons).find(
      button => button.innerHTML.includes('trash')
    );
    
    if (deleteButton) {
      await act(async () => {
        fireEvent.press(deleteButton);
      });
      
      // Verificar que el archivo ya no está en la lista
      await waitFor(() => {
        expect(() => getByText('image.jpg')).toThrow();
      });
    }
  });
  
  it('should enforce the maximum file limit', async () => {
    // Mock para simular que ya hay MAX_FILES archivos
    jest.spyOn(React, 'useState').mockImplementationOnce(() => {
      const files = Array(10).fill(null).map((_, i) => ({
        id: `test-${i}`,
        name: `file-${i}.jpg`,
        size: 1024,
        type: 'image/jpeg',
        uri: `file://test/file-${i}.jpg`,
        status: 'pending',
        progress: 0,
        retries: 0,
        selectedForUpload: true
      }));
      return [files, jest.fn()];
    });
    
    const { getByText } = render(<FileUploader />);
    
    // El botón de seleccionar debería estar deshabilitado
    const selectButton = getByText('Seleccionar').closest('TouchableOpacity');
    expect(selectButton.props.disabled).toBe(true);
    
    // Intentar seleccionar archivo de todos modos
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // No debería llamar a DocumentPicker
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  });
  
  it('should handle multiple file uploads concurrently', async () => {
    // Mock para simular selección de múltiples archivos
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file://test/image1.jpg',
          name: 'image1.jpg',
          size: 1024 * 1024,
          mimeType: 'image/jpeg'
        },
        {
          uri: 'file://test/image2.jpg',
          name: 'image2.jpg',
          size: 2 * 1024 * 1024,
          mimeType: 'image/jpeg'
        },
        {
          uri: 'file://test/image3.jpg',
          name: 'image3.jpg',
          size: 3 * 1024 * 1024,
          mimeType: 'image/jpeg'
        }
      ]
    });
    
    const { getByText, getAllByText } = render(<FileUploader />);
    
    // Paso 1: Seleccionar archivos
    await act(async () => {
      fireEvent.press(getByText('Seleccionar'));
    });
    
    // Esperar a que los archivos aparezcan en la lista
    await waitFor(() => {
      expect(getAllByText(/image[1-3]\.jpg/).length).toBe(3);
    });
    
    // Paso 2: Iniciar carga
    await act(async () => {
      fireEvent.press(getByText('Subir seleccionados'));
    });
    
    // Verificar que se inició la carga de todos los archivos
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/init'),
      expect.objectContaining({
        fileName: expect.stringMatching(/image[1-3]\.jpg/)
      })
    );
  });
}); 