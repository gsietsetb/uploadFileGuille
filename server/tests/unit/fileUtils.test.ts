import { expect } from 'chai';
import * as fileUtils from '../../src/utils/fileUtils';
import { jest, describe, beforeEach, afterEach, it } from '@jest/globals';

// Mock para file-type (versión 16.5.4 que usa CommonJS)
jest.mock('file-type', () => {
  return { 
    fromBuffer: jest.fn() 
  };
});

// Importar file-type después del mock
const FileType = require('file-type');

describe('File Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    jest.resetAllMocks();
  });
  
  describe('validateFileType', () => {
    it('should validate a supported file type', async () => {
      // Configurar el mock para file-type
      FileType.fromBuffer.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      
      // Ejecutar la función y verificar el resultado
      const result = await fileUtils.validateFileType(Buffer.from('fake image data'), 'image/jpeg');
      
      // Verificaciones
      expect(result).to.be.true;
    });
    
    it('should reject an unsupported file type', async () => {
      // Configurar el mock para file-type
      FileType.fromBuffer.mockResolvedValue({ mime: 'application/exe', ext: 'exe' });
      
      // Ejecutar la función y verificar el resultado
      const result = await fileUtils.validateFileType(Buffer.from('fake exe data'), 'image/jpeg');
      
      // Verificaciones
      expect(result).to.be.false;
    });
    
    it('should handle null fileType result', async () => {
      // Configurar el mock para file-type
      FileType.fromBuffer.mockResolvedValue(null);
      
      // Ejecutar la función y verificar el resultado para texto plano
      const result = await fileUtils.validateFileType(Buffer.from('text data'), 'text/plain');
      
      // El resultado debe ser true para tipos de texto cuando fileType no detecta nada
      expect(result).to.be.true;
    });
  });
}); 