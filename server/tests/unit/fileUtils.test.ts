import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs/promises';
import path from 'path';
import * as fileUtils from '../../src/utils/fileUtils';
import { fileTypeFromBuffer } from 'file-type';

// Mock para file-type
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}));

describe('File Utils', () => {
  let sandbox: sinon.SinonSandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Mock para las funciones de fs
    sandbox.stub(fs, 'mkdir').resolves();
    sandbox.stub(fs, 'writeFile').resolves();
    sandbox.stub(fs, 'readFile').resolves(Buffer.from('test data'));
    sandbox.stub(fs, 'unlink').resolves();
    sandbox.stub(fs, 'readdir').resolves(['file1', 'file2']);
    sandbox.stub(fs, 'stat').resolves({
      isDirectory: () => true,
      mtime: new Date(),
      size: 1000
    } as any);
  });
  
  afterEach(() => {
    sandbox.restore();
    jest.resetAllMocks();
  });
  
  describe('setupFolders', () => {
    it('should create the necessary folders', async () => {
      await fileUtils.setupFolders();
      expect(fs.mkdir.callCount).to.be.at.least(3); // Al menos 3 llamadas para crear carpetas
    });
  });
  
  describe('calculateFileHash', () => {
    it('should calculate MD5 hash of a file', async () => {
      const hash = await fileUtils.calculateFileHash('test/file.txt');
      expect(hash).to.be.a('string');
      expect(hash.length).to.be.greaterThan(0);
    });
  });
  
  describe('getChunkPath', () => {
    it('should return the correct chunk path', () => {
      const result = fileUtils.getChunkPath('fileId123', 5);
      expect(result).to.include('fileId123-5');
    });
  });
  
  describe('saveChunk', () => {
    it('should save a chunk to disk', async () => {
      const buffer = Buffer.from('chunk data');
      await fileUtils.saveChunk('fileId123', 1, buffer);
      expect(fs.writeFile.calledOnce).to.be.true;
    });
  });
  
  describe('validateFileType', () => {
    it('should validate a supported file type', async () => {
      (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      const result = await fileUtils.validateFileType(Buffer.from('fake image data'), 'image/jpeg');
      expect(result).to.be.true;
    });
    
    it('should reject an unsupported file type', async () => {
      (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/exe', ext: 'exe' });
      const result = await fileUtils.validateFileType(Buffer.from('fake exe data'), 'image/jpeg');
      expect(result).to.be.false;
    });
    
    it('should handle null fileType result', async () => {
      (fileTypeFromBuffer as jest.Mock).mockResolvedValue(null);
      const result = await fileUtils.validateFileType(Buffer.from('text data'), 'text/plain');
      expect(result).to.be.true; // Debería retornar true para tipos de texto
    });
  });
  
  describe('assembleFile', () => {
    it('should assemble chunks into a complete file', async () => {
      // Stub para validación de tipo
      sandbox.stub(fileUtils, 'validateFileType').resolves(true);
      
      const result = await fileUtils.assembleFile('fileId123', 3, 'test.jpg', 'image/jpeg');
      
      expect(result).to.have.property('path');
      expect(result).to.have.property('hash');
      expect(result).to.have.property('url');
      expect(fs.readFile.callCount).to.equal(3); // Debería leer 3 chunks
    });
    
    it('should throw an error if file type is invalid', async () => {
      // Stub para que validateFileType devuelva false
      sandbox.stub(fileUtils, 'validateFileType').resolves(false);
      
      try {
        await fileUtils.assembleFile('fileId123', 1, 'test.exe', 'application/exe');
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect(error).to.be.an('Error');
        expect((error as Error).message).to.include('Tipo de archivo no válido');
      }
    });
  });
  
  describe('cleanupOldChunks', () => {
    it('should remove old chunks', async () => {
      // Modificar el stub de fs.stat para devolver una fecha antigua
      (fs.stat as any).restore();
      sandbox.stub(fs, 'stat').resolves({
        isDirectory: () => false,
        mtime: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 día atrás
        size: 1000
      } as any);
      
      await fileUtils.cleanupOldChunks();
      expect(fs.unlink.callCount).to.equal(2); // Debería eliminar los 2 archivos
    });
    
    it('should keep recent chunks', async () => {
      // Modificar el stub de fs.stat para devolver una fecha reciente
      (fs.stat as any).restore();
      sandbox.stub(fs, 'stat').resolves({
        isDirectory: () => false,
        mtime: new Date(), // Fecha actual
        size: 1000
      } as any);
      
      await fileUtils.cleanupOldChunks();
      expect(fs.unlink.callCount).to.equal(0); // No debería eliminar archivos
    });
  });
}); 