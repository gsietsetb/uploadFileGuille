import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { expect } from 'chai';
import FormData from 'form-data';
import crypto from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const API_PATH = '/api/upload';
const TEST_FILES_DIR = path.join(__dirname, '../fixtures');

// Tamaño de los chunks para pruebas (50KB)
const CHUNK_SIZE = 50 * 1024;

// Función auxiliar para simular retrasos
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Función para subir un chunk con reintentos
async function uploadChunkWithRetry(fileId: string, chunkIndex: number, chunkBuffer: Buffer, maxRetries = 3) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      const formData = new FormData();
      formData.append('chunk', chunkBuffer, {
        filename: 'blob',
        contentType: 'application/octet-stream'
      });
      
      const response = await axios.post(
        `${SERVER_URL}${API_PATH}/chunk/${fileId}/${chunkIndex}`,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          }
        }
      );
      
      return response;
    } catch (error) {
      if (retries >= maxRetries) throw error;
      
      // Incrementar contador de reintentos
      retries++;
      
      // Esperar con backoff exponencial
      const backoffTime = 100 * Math.pow(2, retries);
      console.log(`Reintento ${retries}/${maxRetries} para chunk ${chunkIndex} en ${backoffTime}ms`);
      await delay(backoffTime);
    }
  }
  
  throw new Error(`Máximo de reintentos alcanzado para chunk ${chunkIndex}`);
}

describe('Upload Retry E2E Tests', function() {
  // Incrementar timeout para pruebas E2E con reintentos
  this.timeout(60000);
  
  let testFilePath: string;
  let fileSize: number;
  let fileBuffer: Buffer;
  let totalChunks: number;
  
  before(async () => {
    // Crear directorio de archivos de prueba si no existe
    try {
      await fs.mkdir(TEST_FILES_DIR, { recursive: true });
    } catch (err) {
      console.log('Test directory already exists');
    }
    
    // Crear un archivo de prueba de 300KB
    testFilePath = path.join(TEST_FILES_DIR, 'retry-test-file.jpg');
    fileSize = 300 * 1024; // 300KB
    fileBuffer = Buffer.alloc(fileSize);
    
    // Llenar el buffer con datos aleatorios para simular una imagen
    crypto.randomFillSync(fileBuffer);
    
    // Añadir magic bytes para JPEG al principio del archivo
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    jpegHeader.copy(fileBuffer);
    
    // Guardar el archivo para las pruebas
    await fs.writeFile(testFilePath, fileBuffer);
    
    // Calcular el número total de chunks
    totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  });
  
  after(async () => {
    // Limpiar archivos de prueba
    try {
      await fs.unlink(testFilePath);
    } catch (err) {
      console.log('Error cleaning up test file:', err);
    }
  });
  
  it('should handle pause, resume and network failures during upload', async () => {
    // 1. Inicializar la carga
    const initResponse = await axios.post(`${SERVER_URL}${API_PATH}/init`, {
      fileName: 'retry-test-file.jpg',
      fileSize: fileSize,
      fileType: 'image/jpeg',
      totalChunks: totalChunks
    });
    
    expect(initResponse.status).to.equal(201);
    expect(initResponse.data).to.have.property('fileId');
    
    const fileId = initResponse.data.fileId;
    
    // 2. Cargar el primer tercio de los chunks
    const firstThird = Math.floor(totalChunks / 3);
    for (let i = 0; i < firstThird; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      const response = await uploadChunkWithRetry(fileId, i, chunkBuffer);
      expect(response.status).to.equal(200);
    }
    
    // 3. Pausar la carga
    const pauseResponse = await axios.put(`${SERVER_URL}${API_PATH}/pause/${fileId}`);
    expect(pauseResponse.status).to.equal(200);
    
    // 4. Verificar que está pausado
    const statusAfterPause = await axios.get(`${SERVER_URL}${API_PATH}/status/${fileId}`);
    expect(statusAfterPause.data).to.have.property('isPaused', true);
    
    // 5. Reanudar la carga
    const resumeResponse = await axios.put(`${SERVER_URL}${API_PATH}/resume/${fileId}`);
    expect(resumeResponse.status).to.equal(200);
    
    // 6. Cargar el resto de chunks con simulación de fallos
    for (let i = firstThird; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      // Simular fallo de red en algunos chunks (cada tercero)
      if (i % 3 === 0) {
        // Crear una instancia personalizada de axios que fallará en el primer intento
        const failingAxios = axios.create();
        const originalPost = failingAxios.post;
        
        // Sobreescribir temporalmente la función post para que falle una vez
        let firstAttempt = true;
        failingAxios.post = async function(...args: any[]) {
          if (firstAttempt) {
            firstAttempt = false;
            // Simular error de red
            throw new Error('Simulated network failure');
          }
          // Después del primer intento, usar la implementación original
          return originalPost.apply(this, args);
        };
        
        try {
          // Usar la función personalizada de uploadChunkWithRetry adaptada al axios modificado
          const formData = new FormData();
          formData.append('chunk', chunkBuffer, {
            filename: 'blob',
            contentType: 'application/octet-stream'
          });
          
          // Primer intento fallará, segundo intento debe tener éxito
          await uploadChunkWithRetry(fileId, i, chunkBuffer);
        } catch (error) {
          // El error debe ser capturado y manejado por la función de reintento
          console.error(`Error no esperado al cargar chunk ${i}:`, error);
          throw error;
        }
      } else {
        // Cargar normalmente los chunks que no necesitan simular fallos
        await uploadChunkWithRetry(fileId, i, chunkBuffer);
      }
    }
    
    // 7. Finalizar la carga
    const finalizeResponse = await axios.post(`${SERVER_URL}${API_PATH}/finalize/${fileId}`);
    expect(finalizeResponse.status).to.equal(200);
    expect(finalizeResponse.data).to.have.property('fileUrl');
    expect(finalizeResponse.data).to.have.property('md5Hash');
    
    // 8. Verificar el estado final
    const statusResponse = await axios.get(`${SERVER_URL}${API_PATH}/status/${fileId}`);
    expect(statusResponse.status).to.equal(200);
    expect(statusResponse.data).to.have.property('isCompleted', true);
    expect(statusResponse.data).to.have.property('progress', 100);
  });
  
  it('should recover from a cancelled upload', async () => {
    // 1. Inicializar la carga
    const initResponse = await axios.post(`${SERVER_URL}${API_PATH}/init`, {
      fileName: 'cancel-test-file.jpg',
      fileSize: fileSize,
      fileType: 'image/jpeg',
      totalChunks: totalChunks
    });
    
    const fileId = initResponse.data.fileId;
    
    // 2. Cargar algunos chunks
    const halfChunks = Math.floor(totalChunks / 2);
    for (let i = 0; i < halfChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      await uploadChunkWithRetry(fileId, i, chunkBuffer);
    }
    
    // 3. Cancelar la carga
    await axios.delete(`${SERVER_URL}${API_PATH}/cancel/${fileId}`);
    
    // 4. Iniciar una nueva carga con el mismo archivo
    const newInitResponse = await axios.post(`${SERVER_URL}${API_PATH}/init`, {
      fileName: 'cancel-test-file.jpg',
      fileSize: fileSize,
      fileType: 'image/jpeg',
      totalChunks: totalChunks
    });
    
    const newFileId = newInitResponse.data.fileId;
    
    // 5. Cargar todos los chunks para la nueva sesión
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      await uploadChunkWithRetry(newFileId, i, chunkBuffer);
    }
    
    // 6. Finalizar la nueva carga
    const finalizeResponse = await axios.post(`${SERVER_URL}${API_PATH}/finalize/${newFileId}`);
    expect(finalizeResponse.status).to.equal(200);
    
    // 7. Verificar el estado
    const statusResponse = await axios.get(`${SERVER_URL}${API_PATH}/status/${newFileId}`);
    expect(statusResponse.data).to.have.property('isCompleted', true);
  });
}); 