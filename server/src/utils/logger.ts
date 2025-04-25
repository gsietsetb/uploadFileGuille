import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Directorio de logs
const logDir = 'logs';

// Crear directorio de logs si no existe
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Configuración del logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'user-service' },
  transports: [
    //
    // - Escribe todos los logs con importancia 'error' o menos en `error.log`
    // - Escribe todos los logs con importancia 'info' o menos en `combined.log`
    //
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') })
  ]
});

//
// Si no estamos en producción, también loguear a la consola
// con el formato simple.
//
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
} 