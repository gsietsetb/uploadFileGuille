import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { setupFolders, cleanupOldChunks, cleanupOldFiles } from './utils/fileUtils';
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

// Middleware de log de solicitudes
app.use(morgan('combined'));

// Middleware para auditoría
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} ${res.statusCode} - ${duration}ms - ${req.ip} - ${req.get('user-agent')}`);
  });
  
  next();
});

// Limitador de tasa para la ruta de carga (10 solicitudes por minuto)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Aplicar limitador a la ruta de carga
app.use('/api/upload', limiter);

// Configurar carpetas necesarias
setupFolders()
  .then(() => logger.info('Carpetas configuradas correctamente'))
  .catch(err => logger.error('Error al configurar carpetas:', err));

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

// Iniciar servidor
const server = app.listen(PORT, () => {
  logger.info(`Servidor corriendo en el puerto ${PORT}`);
});

// Tarea programada para limpiar chunks antiguos (cada 30 minutos)
const cleanupChunksInterval = setInterval(() => {
  cleanupOldChunks()
    .then(() => logger.info('Limpieza de chunks antiguos completada'))
    .catch(err => logger.error('Error al limpiar chunks antiguos:', err));
}, 30 * 60 * 1000);

// Tarea programada para limpiar archivos antiguos (a medianoche)
const scheduleMidnightCleanup = () => {
  const now = new Date();
  const night = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0
  );
  const msToMidnight = night.getTime() - now.getTime();
  
  setTimeout(() => {
    cleanupOldFiles()
      .then(() => logger.info('Limpieza de archivos antiguos completada'))
      .catch(err => logger.error('Error al limpiar archivos antiguos:', err));
    
    // Programar para la siguiente medianoche
    scheduleMidnightCleanup();
  }, msToMidnight);
};

scheduleMidnightCleanup();

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido. Cerrando servidor...');
  server.close(() => {
    clearInterval(cleanupChunksInterval);
    process.exit(0);
  });
});

export default app; 