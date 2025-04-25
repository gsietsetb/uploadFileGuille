import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { expect } from 'chai';
import FormData from 'form-data';
import crypto from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const API_PATH = '/api/upload';
const TEST_FILES_DIR = path.join(__dirname, '../fixtures');

// Tamaño de los chunks para pruebas (100KB)
const CHUNK_SIZE = 100 * 1024;

describe('Upload API E2E Tests', function() {
  // Incrementar timeout para pruebas E2E
  this.timeout(30000);
  
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
    
    // Crear un archivo de prueba de 500KB
    testFilePath = path.join(TEST_FILES_DIR, 'test-file.jpg');
    fileSize = 500 * 1024; // 500KB
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
  
  it('should complete the full upload flow', async () => {
    // 1. Inicializar la carga
    const initResponse = await axios.post(`${SERVER_URL}${API_PATH}/init`, {
      fileName: 'test-file.jpg',
      fileSize: fileSize,
      fileType: 'image/jpeg',
      totalChunks: totalChunks
    });
    
    expect(initResponse.status).to.equal(201);
    expect(initResponse.data).to.have.property('fileId');
    expect(initResponse.data).to.have.property('message').that.includes('initialized');
    
    const fileId = initResponse.data.fileId;
    
    // 2. Cargar cada chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      const formData = new FormData();
      formData.append('chunk', chunkBuffer, {
        filename: 'blob',
        contentType: 'application/octet-stream'
      });
      
      const chunkResponse = await axios.post(
        `${SERVER_URL}${API_PATH}/chunk/${fileId}/${i}`,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          }
        }
      );
      
      expect(chunkResponse.status).to.equal(200);
      expect(chunkResponse.data).to.have.property('message').that.includes('recibido');
    }
    
    // 3. Finalizar la carga
    const finalizeResponse = await axios.post(`${SERVER_URL}${API_PATH}/finalize/${fileId}`);
    
    expect(finalizeResponse.status).to.equal(200);
    expect(finalizeResponse.data).to.have.property('message').that.includes('successfully');
    expect(finalizeResponse.data).to.have.property('fileUrl');
    expect(finalizeResponse.data).to.have.property('md5Hash');
    
    // 4. Verificar el estado
    const statusResponse = await axios.get(`${SERVER_URL}${API_PATH}/status/${fileId}`);
    
    expect(statusResponse.status).to.equal(200);
    expect(statusResponse.data).to.have.property('fileName', 'test-file.jpg');
    expect(statusResponse.data).to.have.property('isCompleted', true);
    expect(statusResponse.data).to.have.property('progress', 100);
  });
  
  it('should handle pause and resume flow', async () => {
    // 1. Inicializar la carga
    const initResponse = await axios.post(`${SERVER_URL}${API_PATH}/init`, {
      fileName: 'pause-resume-test.jpg',
      fileSize: fileSize,
      fileType: 'image/jpeg',
      totalChunks: totalChunks
    });
    
    const fileId = initResponse.data.fileId;
    
    // 2. Cargar la mitad de los chunks
    const halfChunks = Math.floor(totalChunks / 2);
    for (let i = 0; i < halfChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      const formData = new FormData();
      formData.append('chunk', chunkBuffer, {
        filename: 'blob',
        contentType: 'application/octet-stream'
      });
      
      await axios.post(
        `${SERVER_URL}${API_PATH}/chunk/${fileId}/${i}`,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          }
        }
      );
    }
    
    // 3. Pausar la carga
    const pauseResponse = await axios.put(`${SERVER_URL}${API_PATH}/pause/${fileId}`);
    
    expect(pauseResponse.status).to.equal(200);
    expect(pauseResponse.data).to.have.property('message').that.includes('paused');
    
    // 4. Verificar que está pausado
    const statusAfterPause = await axios.get(`${SERVER_URL}${API_PATH}/status/${fileId}`);
    expect(statusAfterPause.data).to.have.property('isPaused', true);
    
    // 5. Reanudar la carga
    const resumeResponse = await axios.put(`${SERVER_URL}${API_PATH}/resume/${fileId}`);
    
    expect(resumeResponse.status).to.equal(200);
    expect(resumeResponse.data).to.have.property('message').that.includes('resumed');
    
    // 6. Cargar el resto de chunks
    for (let i = halfChunks; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      
      const formData = new FormData();
      formData.append('chunk', chunkBuffer, {
        filename: 'blob',
        contentType: 'application/octet-stream'
      });
      
      await axios.post(
        `${SERVER_URL}${API_PATH}/chunk/${fileId}/${i}`,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          }
        }
      );
    }
    
    // 7. Finalizar la carga
    const finalizeResponse = await axios.post(`${SERVER_URL}${API_PATH}/finalize/${fileId}`);
    expect(finalizeResponse.status).to.equal(200);
  });
}); 