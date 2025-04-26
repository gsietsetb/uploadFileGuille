import request from 'supertest';
import { expect } from 'chai'; // Mantener chai aquí si otros tests lo usan, o cambiar todo a Jest
import { describe, it, beforeAll, afterAll } from '@jest/globals'; // Importar funciones globales de Jest
import app, { startServer, stopServer } from '../../src/index'; // Importar app y funciones de control
import * as monitoringRoutes from '../../src/routes/monitoring.routes';
import { Server } from 'http'; // Tipo para la instancia del servidor

describe('Monitoring API Tests', () => {
  let server: Server | null;

  // Iniciar el servidor una vez antes de todos los tests
  beforeAll((done) => {
    // Usar un puerto diferente para los tests para evitar EADDRINUSE
    process.env.PORT = '5001'; 
    server = startServer();
    // Esperar un poco para asegurar que el servidor esté listo (mejorable con event listener)
    setTimeout(done, 500); 
  });

  // Detener el servidor una vez después de todos los tests
  afterAll((done) => {
    stopServer(done); // Pasar 'done' para manejar asincronía
  });

  describe('GET /api/monitoring/health', () => {
    // Quitar la lógica de escucha de app.ts de aquí, ya está en beforeAll
    it('should return server health status', async () => {
      const response = await request(app) // Usar la instancia de app importada
        .get('/api/monitoring/health')
        .expect(200);
      
      // ... (aserción con expect de chai o jest) ...
      expect(response.body).to.have.property('status', 'ok');
      // ... resto de aserciones ...
    });
  });
  
  describe('GET /api/monitoring/stats', () => {
    it('should return server statistics', async () => {
      const response = await request(app)
        .get('/api/monitoring/stats')
        .expect(200);
      // ... aserciones ...
    });
    
    it('should update statistics when uploads are registered', async () => {
      // ... lógica del test ...
      const response = await request(app)
        .get('/api/monitoring/stats')
        .expect(200);
      // ... aserciones ...
    });
  });
  
  describe('GET /api/monitoring/storage', () => {
    it('should return storage statistics', async () => {
      const response = await request(app)
        .get('/api/monitoring/storage')
        .expect(200);
      // ... aserciones ...
    });
  });
  
  describe('POST /api/monitoring/reset', () => {
    it('should reject reset from non-localhost IP', async () => {
      const response = await request(app)
        .post('/api/monitoring/reset')
        .set('X-Forwarded-For', '8.8.8.8')
        .expect(403);
      // ... aserciones ...
      expect(response.body).to.have.property('error', 'No autorizado');
    });
  });
}); 