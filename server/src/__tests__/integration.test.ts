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
        .get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('endpoints');
    });
    
    it('GET /api/monitoring/health debería devolver estado de salud', async () => {
      const response = await request(app)
        .get('/api/monitoring/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });
  
  // Nota: Las pruebas de flujo completo de carga son complejas y requieren
  // una mejor integración con el estado del servidor. En un entorno real,
  // estas pruebas deberían realizarse con un enfoque más e2e o de integración.
}); 