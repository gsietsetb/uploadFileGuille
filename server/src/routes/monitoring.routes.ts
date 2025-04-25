import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import os from 'os';

const router = express.Router();
const fsReaddir = promisify(fs.readdir);
const fsStat = promisify(fs.stat);

// Timestamp de inicio del servidor
const serverStartTime = Date.now();

// Contador de cargas activas y completadas
let activeUploads = 0;
let completedUploads = 0;
let failedUploads = 0;

// Función para registrar una carga activa
export const registerActiveUpload = () => {
  activeUploads++;
};

// Función para registrar una carga completada
export const registerCompletedUpload = (success: boolean) => {
  activeUploads = Math.max(0, activeUploads - 1);
  if (success) {
    completedUploads++;
  } else {
    failedUploads++;
  }
};

/**
 * Verificar estado de salud del servidor
 * GET /api/monitoring/health
 */
router.get('/health', (req: Request, res: Response) => {
  const uptime = Date.now() - serverStartTime;
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: {
      ms: uptime,
      formatted: formatUptime(uptime)
    },
    memory: {
      rss: formatBytes(memoryUsage.rss),
      heapTotal: formatBytes(memoryUsage.heapTotal),
      heapUsed: formatBytes(memoryUsage.heapUsed),
      external: formatBytes(memoryUsage.external)
    }
  });
});

/**
 * Obtener estadísticas generales
 * GET /api/monitoring/stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    // Calcular tiempo de actividad
    const uptime = Date.now() - serverStartTime;
    
    // Uso de CPU y memoria
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem()
    };
    
    // Calcular tasa de éxito
    const totalUploads = completedUploads + failedUploads;
    const successRate = totalUploads > 0 
      ? Math.round((completedUploads / totalUploads) * 100) 
      : 100;
    
    res.json({
      uptime: {
        ms: uptime,
        formatted: formatUptime(uptime)
      },
      uploads: {
        active: activeUploads,
        completed: completedUploads,
        failed: failedUploads,
        total: totalUploads,
        successRate: `${successRate}%`
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        cpus: os.cpus().length
      },
      memory: {
        rss: formatBytes(memoryUsage.rss),
        heapTotal: formatBytes(memoryUsage.heapTotal),
        heapUsed: formatBytes(memoryUsage.heapUsed),
        external: formatBytes(memoryUsage.external),
        systemTotal: formatBytes(systemMemory.total),
        systemFree: formatBytes(systemMemory.free),
        systemUsed: formatBytes(systemMemory.used)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

/**
 * Obtener estadísticas de disco
 * GET /api/monitoring/storage
 */
router.get('/storage', async (req: Request, res: Response) => {
  try {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const chunksDir = path.join(uploadsDir, 'chunks');
    const completeDir = path.join(uploadsDir, 'complete');
    
    // Obtener estadísticas de almacenamiento
    const chunksStats = await getDirectoryStats(chunksDir);
    const completeStats = await getDirectoryStats(completeDir);
    
    res.json({
      chunks: {
        count: chunksStats.fileCount,
        size: formatBytes(chunksStats.totalSize),
        sizeBytes: chunksStats.totalSize
      },
      complete: {
        count: completeStats.fileCount,
        size: formatBytes(completeStats.totalSize),
        sizeBytes: completeStats.totalSize,
        byType: completeStats.byType
      },
      total: {
        count: chunksStats.fileCount + completeStats.fileCount,
        size: formatBytes(chunksStats.totalSize + completeStats.totalSize),
        sizeBytes: chunksStats.totalSize + completeStats.totalSize
      }
    });
  } catch (error) {
    console.error('Error al obtener estadísticas de almacenamiento:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas de almacenamiento' });
  }
});

/**
 * Reiniciar contadores
 * POST /api/monitoring/reset
 */
router.post('/reset', (req: Request, res: Response) => {
  // Solo permitir desde localhost o con autenticación admin
  if (req.ip !== '127.0.0.1' && req.ip !== '::1' && req.ip !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'No autorizado' });
  }
  
  completedUploads = 0;
  failedUploads = 0;
  
  res.json({ message: 'Contadores reiniciados' });
});

// Funciones auxiliares
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatUptime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  
  let result = '';
  if (days > 0) result += `${days}d `;
  if (remainingHours > 0 || days > 0) result += `${remainingHours}h `;
  if (remainingMinutes > 0 || remainingHours > 0 || days > 0) result += `${remainingMinutes}m `;
  result += `${remainingSeconds}s`;
  
  return result;
};

interface DirectoryStats {
  fileCount: number;
  totalSize: number;
  byType: Record<string, { count: number; size: number }>;
}

const getDirectoryStats = async (dirPath: string): Promise<DirectoryStats> => {
  try {
    if (!fs.existsSync(dirPath)) {
      return { fileCount: 0, totalSize: 0, byType: {} };
    }
    
    const files = await fsReaddir(dirPath);
    let fileCount = 0;
    let totalSize = 0;
    const byType: Record<string, { count: number; size: number }> = {};
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = await fsStat(filePath);
      
      if (stat.isDirectory()) {
        // Si es un directorio, obtener estadísticas recursivamente
        const subStats = await getDirectoryStats(filePath);
        fileCount += subStats.fileCount;
        totalSize += subStats.totalSize;
        
        // Combinar byType
        for (const [type, data] of Object.entries(subStats.byType)) {
          if (byType[type]) {
            byType[type].count += data.count;
            byType[type].size += data.size;
          } else {
            byType[type] = { ...data };
          }
        }
      } else {
        fileCount++;
        totalSize += stat.size;
        
        // Categorizar por tipo
        const ext = path.extname(file).toLowerCase();
        const type = ext || 'unknown';
        
        if (byType[type]) {
          byType[type].count++;
          byType[type].size += stat.size;
        } else {
          byType[type] = { count: 1, size: stat.size };
        }
      }
    }
    
    return { fileCount, totalSize, byType };
  } catch (error) {
    console.error(`Error al obtener estadísticas de directorio ${dirPath}:`, error);
    return { fileCount: 0, totalSize: 0, byType: {} };
  }
};

export default router; 