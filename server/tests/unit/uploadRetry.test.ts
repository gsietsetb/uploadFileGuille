import { expect, jest, describe, beforeEach, afterEach, it } from '@jest/globals';
import crypto from 'crypto';
import fs from 'fs-extra';
import { retryChunkUpload, retryFileAssembly, retrySessionValidation } from '../../src/utils/uploadRetry';

// Mock simplificado para fs-extra
jest.mock('fs-extra', () => ({
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Acceder a los mocks tipados
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Upload Retry Mechanism', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Resetear mocks antes de cada test
    mockedFs.writeFile.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(Buffer.from('test data'));
    mockedFs.unlink.mockResolvedValue(undefined);
    mockedFs.existsSync.mockReturnValue(true);
    // mkdirSync es síncrona, no necesita mockResolvedValue
    mockedFs.mkdirSync.mockImplementation(() => {});

    jest.spyOn(crypto, 'randomBytes').mockImplementation(() => Buffer.from('random-bytes'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Chunk Upload Retries', () => {
    it('should retry chunk upload on network failure', async () => {
      const mockUpload = jest.fn()
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockResolvedValueOnce({ success: true });
      // Llama a la función real que usa los mocks
      const result = await retryChunkUpload(mockUpload, 'fileId', 1, Buffer.from('chunk data'));
      expect(mockUpload).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should handle maximum retries exceeded', async () => {
      const mockUpload = jest.fn()
        .mockRejectedValue(new Error('Network Error'));
      await expect(retryChunkUpload(mockUpload, 'fileId', 1, Buffer.from('chunk data'), 3))
        .rejects.toThrow(/maximum retries exceeded/i);
      expect(mockUpload).toHaveBeenCalledTimes(3);
    });
  });

  describe('File Assembly Resilience', () => {
    it('should handle missing chunks gracefully', async () => {
      const mockAssembleFile = jest.fn()
        .mockRejectedValueOnce(new Error('Chunk faltante: 1'))
        .mockResolvedValueOnce({ path: '/uploads/file.jpg', hash: 'abc123', url: '/uploads/file.jpg' });
      const result = await retryFileAssembly(mockAssembleFile, 'fileId', 3, 'test.jpg', 'image/jpeg');
      expect(mockAssembleFile).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('hash', 'abc123');
    });

    it('should validate file type during assembly', async () => {
      const mockAssembleFile = jest.fn()
        .mockRejectedValue(new Error('Tipo de archivo no válido'));
      await expect(retryFileAssembly(mockAssembleFile, 'fileId', 1, 'malware.exe', 'application/exe'))
        .rejects.toThrow(/Tipo de archivo no válido/i);
      expect(mockAssembleFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Upload Session Management', () => {
    it('should handle session timeouts', async () => {
      const mockSessionCheck = jest.fn()
        .mockRejectedValueOnce(new Error('Session timeout'))
        .mockResolvedValueOnce({ valid: true, sessionId: 'session123' });
      const result = await retrySessionValidation(mockSessionCheck, 'oldSession');
      expect(mockSessionCheck).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ valid: true, sessionId: 'session123' });
    });
  });
}); 