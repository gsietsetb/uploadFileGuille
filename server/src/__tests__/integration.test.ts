import request from 'supertest';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Declaraciones para TypeScript
declare const jest: any;
declare const describe: any;
declare const beforeAll: any;
declare const afterAll: any;
declare const beforeEach: any;
declare const it: any;
declare const expect: any;

// Cargar variables de entorno de prueba
dotenv.config({ path: path.join(__dirname, '../../.env.test') });

// Para evitar iniciar todo el servidor, mockear algunas dependencias
jest.mock('../utils/fileUtils', () => ({
  setupFolders: jest.fn().mockResolvedValue(undefined),
  cleanupOldChunks: jest.fn().mockResolvedValue(undefined),
  cleanupOldFiles: jest.fn().mockResolvedValue(undefined),
  saveChunk: jest.fn().mockResolvedValue('/path/to/chunk'),
  getChunkPath: jest.fn().mockReturnValue('/path/to/chunk'),
  validateFileType: jest.fn().mockResolvedValue(true),
  assembleFile: jest.fn().mockResolvedValue({
    path: '/path/to/file',
    hash: 'file-hash-123',
    url: '/uploads/complete/file.jpg',
    isDuplicate: false
  })
}));

// Antes de importar el servidor, asegurarse que el entorno sea de prueba
process.env.NODE_ENV = 'test';
process.env.PORT = '3002'; // Puerto diferente para pruebas

// Importar la aplicación Express
import app from '../app';

describe('Integración del Servidor', () => {
  beforeAll(async () => {
    // Simular archivo .env para pruebas si no existe
    const envTestPath = path.join(__dirname, '../../.env.test');
    if (!fs.existsSync(envTestPath)) {
      fs.writeFileSync(envTestPath, `
PORT=3002
NODE_ENV=test
UPLOADS_DIR=test-uploads
REDIS_ENABLED=false
MAX_FILE_SIZE=10485760
CHUNK_RETENTION_MINUTES=10
FILE_RETENTION_DAYS=1
ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf
      `);
    }
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Puntos finales básicos', () => {
    it('GET / debería devolver información básica de la API', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);
      
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('endpoints');
    });
    
    it('GET /api/monitoring/health debería devolver estado de salud', async () => {
      const response = await request(app)
        .get('/api/monitoring/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });
  
  describe('Flujo completo de carga', () => {
    let fileId: string;
    
    it('Paso 1: Inicializar carga', async () => {
      const response = await request(app)
        .post('/api/upload/init')
        .send({
          fileName: 'test.jpg',
          fileSize: 1024,
          fileType: 'image/jpeg',
          totalChunks: 2
        })
        .expect(200);
      
      expect(response.body).toHaveProperty('fileId');
      expect(response.body).toHaveProperty('status', 'ok');
      
      fileId = response.body.fileId;
    });
    
    it('Paso 2: Subir un chunk', async () => {
      // Saltamos la subida real del archivo y solo probamos la API
      // Mock de multer ya debería estar manejando la carga
      const response = await request(app)
        .post(`/api/upload/chunk/${fileId}`)
        .field('chunkIndex', '0')
        .field('totalChunks', '2')
        .attach('file', Buffer.from('chunk data'), 'chunk.bin')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
    });
    
    it('Paso 3: Verificar estado', async () => {
      const response = await request(app)
        .get(`/api/upload/status/${fileId}`)
        .expect(200);
      
      expect(response.body).toHaveProperty('status');
    });
    
    it('Paso 4: Completar carga', async () => {
      const response = await request(app)
        .post(`/api/upload/complete/${fileId}`)
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('url');
    });
  });
}); 