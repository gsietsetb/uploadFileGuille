// Aumentar el timeout para tests que podrían llevar más tiempo (como E2E)
jest.setTimeout(30000);

// Configurar variables de entorno para pruebas
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '5000';
process.env.REDIS_ENABLED = 'false'; // Deshabilitar Redis para pruebas
process.env.LOG_LEVEL = 'error'; // Reducir logging durante pruebas

// Crear carpetas necesarias para tests
const fs = require('fs');
const path = require('path');

const testDirs = [
  './uploads',
  './uploads/chunks',
  './uploads/complete',
  './logs',
  './tests/fixtures'
];

for (const dir of testDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Directorio creado para pruebas: ${dir}`);
  }
}

// Silenciar console.log durante los tests
if (process.env.SILENT_LOGS !== 'false') {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  console.log = function(...args) {
    if (process.env.DEBUG === 'true') {
      originalConsoleLog(...args);
    }
  };
  
  console.error = function(...args) {
    if (process.env.DEBUG === 'true') {
      originalConsoleError(...args);
    }
  };
  
  console.warn = function(...args) {
    if (process.env.DEBUG === 'true') {
      originalConsoleWarn(...args);
    }
  };
}

// Función helper para limpiar archivos temporales después de tests
global.cleanupTestFiles = async () => {
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    // Limpiar archivos temporales en uploads/chunks
    const chunksDir = path.join(process.cwd(), 'uploads', 'chunks');
    const files = await fs.readdir(chunksDir);
    
    for (const file of files) {
      await fs.unlink(path.join(chunksDir, file));
    }
    
    // Limpiar archivos en uploads/complete
    const completeDir = path.join(process.cwd(), 'uploads', 'complete');
    await fs.rm(completeDir, { recursive: true, force: true });
    await fs.mkdir(completeDir);
    
    console.log('Test files cleaned up successfully');
  } catch (error) {
    console.error('Error cleaning up test files:', error);
  }
};

// Limpiar archivos antes de iniciar las pruebas
if (process.env.CLEANUP_BEFORE_TESTS !== 'false') {
  const { execSync } = require('child_process');
  try {
    execSync('rm -rf ./uploads/chunks/* ./uploads/complete/*');
  } catch (error) {
    console.error('Error cleaning test directories:', error);
  }
}

// Notificar que el setup está completo
console.log('Test setup complete'); 