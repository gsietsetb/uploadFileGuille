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

// Confiar en la cabecera X-Forwarded-For si está presente (para req.ip)
app.set('trust proxy', true);

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

// Limitador de tasa para la ruta de carga (50 solicitudes por minuto)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false //{ trustProxy: false }
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

// Variable para guardar la instancia del servidor HTTP
let serverInstance: ReturnType<typeof app.listen> | null = null;

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

// Función para iniciar el servidor
const startServer = () => {
  if (!serverInstance) {
    serverInstance = app.listen(PORT, () => {
      logger.info(`Servidor corriendo en el puerto ${PORT}`);
    });

    // Tarea programada para limpiar chunks antiguos (cada 30 minutos)
    const cleanupChunksInterval = setInterval(() => {
      cleanupOldChunks()
        .then(() => logger.info('Limpieza de chunks antiguos completada'))
        .catch(err => logger.error('Error al limpiar chunks antiguos:', err));
    }, 30 * 60 * 1000);

    // Tarea programada para limpiar archivos antiguos (a medianoche)
    scheduleMidnightCleanup();

    // Manejo de cierre graceful
    process.on('SIGTERM', () => {
      logger.info('SIGTERM recibido. Cerrando servidor...');
      if (serverInstance) {
        serverInstance.close(() => {
          clearInterval(cleanupChunksInterval);
          logger.info('Servidor HTTP cerrado.');
          process.exit(0);
        });
      }
    });
  }
  return serverInstance;
};

// Función para detener el servidor (útil para tests)
export const stopServer = (done?: jest.DoneCallback) => {
  if (serverInstance) {
    logger.info('Cerrando servidor HTTP...');
    serverInstance.close((err) => {
      if (err) {
        logger.error('Error al cerrar el servidor:', err);
      }
      logger.info('Servidor HTTP cerrado.');
      serverInstance = null;
      if (done) {
        done(); // Llamar a done para indicar que la operación asíncrona terminó (para Jest)
      }
    });
  } else if (done) {
    done(); // Si no hay servidor, llamar a done inmediatamente
  }
};

// Iniciar el servidor solo si este script se ejecuta directamente
if (require.main === module) {
  startServer();
}

// Exportar la app para tests u otros usos
export default app;
// Exportar la instancia del servidor (puede ser null si no está iniciado)
// o mejor exportar las funciones start/stop para tests
export { startServer }; 