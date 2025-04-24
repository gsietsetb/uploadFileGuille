/**
 * Utilidades para el manejo de archivos en React Native
 */

/**
 * Normaliza el nombre del archivo eliminando caracteres especiales y espacios
 * @param fileName Nombre del archivo original
 * @returns Nombre del archivo normalizado
 */
export const normalizeFileName = (fileName: string): string => {
  // Obtener la extensión del archivo
  const lastDotIndex = fileName.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? fileName.slice(lastDotIndex) : '';
  const baseName = lastDotIndex !== -1 ? fileName.slice(0, lastDotIndex) : fileName;
  
  // Normalizar el nombre base: reemplazar espacios por guiones y eliminar caracteres especiales
  const normalizedBaseName = baseName
    .normalize('NFD')                   // Descomponer acentos
    .replace(/[\u0300-\u036f]/g, '')    // Eliminar diacríticos
    .replace(/[^\w\-]/g, '-')          // Reemplazar caracteres no alfanuméricos por guiones
    .replace(/\-+/g, '-')              // Convertir múltiples guiones en uno solo
    .replace(/^\-+|\-+$/g, '')         // Eliminar guiones al inicio y final
    .toLowerCase();                     // Convertir a minúsculas
  
  // Devolver el nombre normalizado con la extensión original
  return `${normalizedBaseName}${extension.toLowerCase()}`;
};

/**
 * Genera un nombre de archivo único basado en el nombre original
 * @param fileName Nombre del archivo original
 * @returns Nombre de archivo único normalizado
 */
export const generateUniqueFileName = (fileName: string): string => {
  const normalizedName = normalizeFileName(fileName);
  const timestamp = Date.now();
  
  // Obtener la extensión del archivo
  const lastDotIndex = normalizedName.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? normalizedName.slice(lastDotIndex) : '';
  const baseName = lastDotIndex !== -1 ? normalizedName.slice(0, lastDotIndex) : normalizedName;
  
  // Generar nombre único agregando timestamp
  return `${baseName}-${timestamp}${extension}`;
};

/**
 * Extrae la extensión del nombre de archivo
 * @param fileName Nombre del archivo
 * @returns Extensión del archivo sin el punto
 */
export const getFileExtension = (fileName: string): string => {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex !== -1 ? fileName.slice(lastDotIndex + 1).toLowerCase() : '';
};

/**
 * Determina el tipo MIME basado en la extensión del archivo
 * @param fileName Nombre del archivo
 * @returns Tipo MIME del archivo o application/octet-stream si no se reconoce
 */
export const getMimeType = (fileName: string): string => {
  const extension = getFileExtension(fileName);
  
  const mimeTypes: Record<string, string> = {
    // Imágenes
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    
    // Videos
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'wmv': 'video/x-ms-wmv',
    'webm': 'video/webm',
    
    // Documentos
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    
    // Otros
    'txt': 'text/plain',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'application/xml',
    'zip': 'application/zip',
  };
  
  return mimeTypes[extension] || 'application/octet-stream';
}; 