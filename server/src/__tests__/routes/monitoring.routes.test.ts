import request from 'supertest';
import express from 'express';
import monitoringRoutes from '../../routes/monitoring.routes';

// Declaraciones para TypeScript
declare const jest: any;
declare const describe: any;
declare const beforeEach: any;
declare const it: any;
declare const expect: any;

// Mock para fs/promises
jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue(['file1.jpg', 'file2.pdf']),
  stat: jest.fn().mockResolvedValue({
    size: 1024,
    mtime: new Date(),
    isDirectory: () => false
  })
}));

describe('Monitoring Routes', () => {
  let app: express.Application;
  
  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/monitoring', monitoringRoutes);
    
    jest.clearAllMocks();
  });
  
  describe('GET /api/monitoring/health', () => {
    it('debería devolver estado de salud', async () => {
      const response = await request(app)
        .get('/api/monitoring/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('memory');
    });
  });
  
  describe('GET /api/monitoring/stats', () => {
    it('debería devolver estadísticas del sistema', async () => {
      const response = await request(app)
        .get('/api/monitoring/stats');
      
      expect(response.status).toBe(200);
      // Los campos específicos dependerán del estado real y pueden variar
      expect(response.body).toBeDefined();
    });
  });
}); 