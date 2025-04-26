import { expect, jest, describe, beforeEach, afterEach, it } from '@jest/globals';
import crypto from 'crypto';
const fs = require('fs-extra');
const { retryChunkUpload, retryFileAssembly, retrySessionValidation } = require('../../src/utils/uploadRetry');

// Mock para fs-extra
jest.mock('fs-extra', () => ({
  // Usar mockResolvedValue<any>(...) para evitar error TS2345 si persiste
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('test data')),
  unlink: jest.fn().mockResolvedValue(undefined),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn()
}));

describe('Upload Retry Mechanism', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      const result = await retryChunkUpload(mockUpload, 'fileId', 1, Buffer.from('chunk data'));
      expect(mockUpload).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should handle maximum retries exceeded', async () => {
      const mockUpload = jest.fn()
        .mockRejectedValue(new Error('Network Error'));
      expect.assertions(2);
      try {
        await retryChunkUpload(mockUpload, 'fileId', 1, Buffer.from('chunk data'), 3);
      } catch (error) {
        expect(mockUpload).toHaveBeenCalledTimes(3);
        expect((error as Error).message).toMatch(/maximum retries exceeded/i);
      }
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
      expect.assertions(2);
      try {
        await retryFileAssembly(mockAssembleFile, 'fileId', 1, 'malware.exe', 'application/exe');
      } catch (error) {
        expect(mockAssembleFile).toHaveBeenCalledTimes(1);
        expect((error as Error).message).toMatch(/Tipo de archivo no válido/i);
      }
    });
  });

  describe('Upload Session Management', () => {
    it('should handle session timeouts', async () => {
      const mockSessionCheck = jest.fn()
        .mockRejectedValueOnce(new Error('Session timeout'))
        .mockResolvedValueOnce({ valid: true, sessionId: 'session123' });
      const result = await retrySessionValidation(mockSessionCheck, 'oldSession');
      expect(mockSessionCheck).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('valid', true);
      expect(result).toHaveProperty('sessionId', 'session123');
    });
  });
}); 