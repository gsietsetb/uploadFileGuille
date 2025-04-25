import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { setupFolders } from './utils/fileUtils';
import uploadRoutes from './routes/upload.routes';
import monitoringRoutes from './routes/monitoring.routes';
import { logger } from './utils/logger';

// Cargar variables de entorno
dotenv.config();

// Configuración del servidor
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware CORS
app.use(cors());

// Middleware para parsear JSON
app.use(express.json());

// Middleware de log de solicitudes (solo en desarrollo y producción)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Middleware para auditoría (solo en desarrollo y producción)
if (process.env.NODE_ENV !== 'test') {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.url} ${res.statusCode} - ${duration}ms - ${req.ip} - ${req.get('user-agent')}`);
    });
    
    next();
  });
}

// Limitador de tasa para la ruta de carga (10 solicitudes por minuto)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Aplicar limitador a la ruta de carga
app.use('/api/upload', limiter);

// Configurar carpetas necesarias (en entornos que no sean de prueba)
if (process.env.NODE_ENV !== 'test') {
  setupFolders()
    .then(() => logger.info('Carpetas configuradas correctamente'))
    .catch(err => logger.error('Error al configurar carpetas:', err));
}

// Rutas de API
app.use('/api/upload', uploadRoutes);
app.use('/api/monitoring', monitoringRoutes);

// Servir archivos estáticos de la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Ruta raíz
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'API del sistema de carga de archivos',
    version: '1.0.0',
    endpoints: {
      upload: '/api/upload',
      monitoring: '/api/monitoring'
    }
  });
});

// Manejo de errores centralizado
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Error: ${err.message}`, { error: err });
  
  res.status(err.status || 500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'production' ? 'Ha ocurrido un error' : err.message
  });
});

export default app; 