import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/index';
import * as monitoringRoutes from '../../src/routes/monitoring.routes';

describe('Monitoring API Tests', () => {
  describe('GET /api/monitoring/health', () => {
    it('should return server health status', async () => {
      const response = await request(app)
        .get('/api/monitoring/health')
        .expect(200);
      
      // Verificar la estructura de la respuesta
      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('timestamp');
      expect(response.body).to.have.property('uptime');
      expect(response.body.uptime).to.have.property('ms');
      expect(response.body.uptime).to.have.property('formatted');
      expect(response.body).to.have.property('memory');
      expect(response.body.memory).to.have.property('rss');
      expect(response.body.memory).to.have.property('heapTotal');
      expect(response.body.memory).to.have.property('heapUsed');
    });
  });
  
  describe('GET /api/monitoring/stats', () => {
    it('should return server statistics', async () => {
      const response = await request(app)
        .get('/api/monitoring/stats')
        .expect(200);
      
      // Verificar la estructura de la respuesta
      expect(response.body).to.have.property('uptime');
      expect(response.body).to.have.property('uploads');
      expect(response.body.uploads).to.have.property('active');
      expect(response.body.uploads).to.have.property('completed');
      expect(response.body.uploads).to.have.property('failed');
      expect(response.body.uploads).to.have.property('total');
      expect(response.body.uploads).to.have.property('successRate');
      expect(response.body).to.have.property('system');
      expect(response.body).to.have.property('memory');
      expect(response.body).to.have.property('cpu');
    });
    
    it('should update statistics when uploads are registered', async () => {
      // Registrar unas cargas para probar
      monitoringRoutes.registerActiveUpload();
      monitoringRoutes.registerActiveUpload();
      
      // Completar una carga con éxito
      monitoringRoutes.registerCompletedUpload(true);
      
      // Completar una carga con fallo
      monitoringRoutes.registerCompletedUpload(false);
      
      const response = await request(app)
        .get('/api/monitoring/stats')
        .expect(200);
      
      // Verificar que los contadores se actualizaron
      expect(response.body.uploads.active).to.equal(0);
      expect(response.body.uploads.completed).to.be.at.least(1);
      expect(response.body.uploads.failed).to.be.at.least(1);
    });
  });
  
  describe('GET /api/monitoring/storage', () => {
    it('should return storage statistics', async () => {
      const response = await request(app)
        .get('/api/monitoring/storage')
        .expect(200);
      
      // Verificar la estructura de la respuesta
      expect(response.body).to.have.property('chunks');
      expect(response.body).to.have.property('complete');
      expect(response.body).to.have.property('total');
      
      expect(response.body.chunks).to.have.property('count');
      expect(response.body.chunks).to.have.property('size');
      expect(response.body.chunks).to.have.property('sizeBytes');
      
      expect(response.body.complete).to.have.property('count');
      expect(response.body.complete).to.have.property('size');
      expect(response.body.complete).to.have.property('sizeBytes');
      expect(response.body.complete).to.have.property('byType');
      
      expect(response.body.total).to.have.property('count');
      expect(response.body.total).to.have.property('size');
      expect(response.body.total).to.have.property('sizeBytes');
    });
  });
  
  describe('POST /api/monitoring/reset', () => {
    it('should reject reset from non-localhost IP', async () => {
      // Simular una solicitud desde una IP remota
      const response = await request(app)
        .post('/api/monitoring/reset')
        .set('X-Forwarded-For', '8.8.8.8')
        .expect(403);
      
      expect(response.body).to.have.property('error', 'No autorizado');
    });
    
    // Nota: No podemos probar fácilmente el caso exitoso en un entorno de prueba
    // ya que supertest siempre se ejecuta con una IP local (127.0.0.1)
  });
}); 