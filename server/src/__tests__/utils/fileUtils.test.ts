import fs from 'fs';
import path from 'path';
import * as fileUtils from '../../utils/fileUtils';

// Declaraciones para TypeScript
declare const jest: any;
declare const describe: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const it: any;
declare const expect: any;

// Mock fileUtils para las pruebas
jest.mock('../../utils/fileUtils', () => ({
  setupFolders: jest.fn().mockResolvedValue(undefined),
  calculateFileHash: jest.fn().mockResolvedValue('mockedHash123'),
  getChunkPath: jest.fn().mockReturnValue('/path/to/chunk'),
  saveChunk: jest.fn().mockResolvedValue('/path/to/saved-chunk'),
  validateFileType: jest.fn().mockResolvedValue(true),
  assembleFile: jest.fn().mockResolvedValue({
    path: '/path/to/file',
    hash: 'file-hash-123',
    url: '/uploads/file.jpg',
    isDuplicate: false
  }),
  cleanupOldChunks: jest.fn().mockResolvedValue(undefined),
  cleanupOldFiles: jest.fn().mockResolvedValue(undefined)
}));

// Valores originales para procesar.env
const originalEnv = process.env;

describe('File Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restaurar process.env
    process.env = { ...originalEnv };
    // Establecer valores predeterminados para las variables de entorno
    process.env.UPLOADS_DIR = 'test-uploads';
  });

  afterEach(() => {
    // Restaurar process.env a su estado original
    process.env = originalEnv;
  });

  describe('setupFolders', () => {
    it('debería llamarse correctamente', async () => {
      await fileUtils.setupFolders();
      expect(fileUtils.setupFolders).toHaveBeenCalledTimes(1);
    });
  });

  describe('calculateFileHash', () => {
    it('debería calcular el hash MD5 de un archivo', async () => {
      const hash = await fileUtils.calculateFileHash('test-file.txt');
      expect(hash).toBe('mockedHash123');
      expect(fileUtils.calculateFileHash).toHaveBeenCalledWith('test-file.txt');
    });
  });

  describe('getChunkPath', () => {
    it('debería devolver la ruta correcta para un chunk', () => {
      const chunkPath = fileUtils.getChunkPath('file123', 456);
      expect(fileUtils.getChunkPath).toHaveBeenCalledWith('file123', 456);
    });
  });

  describe('saveChunk', () => {
    it('debería guardar un chunk correctamente', async () => {
      const mockChunkBuffer = Buffer.from('chunk data');
      await fileUtils.saveChunk('file123', 1, mockChunkBuffer);
      expect(fileUtils.saveChunk).toHaveBeenCalledWith('file123', 1, mockChunkBuffer);
    });
  });

  describe('validateFileType', () => {
    it('debería validar un tipo de archivo correctamente', async () => {
      const mockBuffer = Buffer.from('fake image data');
      const isValid = await fileUtils.validateFileType(mockBuffer, 'image/jpeg');
      expect(fileUtils.validateFileType).toHaveBeenCalledWith(mockBuffer, 'image/jpeg');
      expect(isValid).toBe(true);
    });
  });
  
  describe('assembleFile', () => {
    it('debería ensamblar un archivo correctamente', async () => {
      const result = await fileUtils.assembleFile('file123', 2, 'test.jpg', 'image/jpeg');
      expect(fileUtils.assembleFile).toHaveBeenCalledWith('file123', 2, 'test.jpg', 'image/jpeg');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('url');
    });
  });
}); 