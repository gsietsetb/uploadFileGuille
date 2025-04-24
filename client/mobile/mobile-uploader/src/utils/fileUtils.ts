/**
 * Utilidades para el manejo de archivos en React Native
 */

/**
 * Normaliza un nombre de archivo eliminando caracteres especiales y espacios
 * @param fileName Nombre del archivo a normalizar
 * @returns Nombre normalizado
 */
export const normalizeFileName = (fileName: string): string => {
  // Eliminar emojis y caracteres especiales
  const withoutEmojis = fileName.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
  
  // Reemplazar espacios y caracteres especiales por guiones
  const normalized = withoutEmojis
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
    .replace(/[^a-zA-Z0-9.-]/g, '-') // Reemplazar caracteres no alfanuméricos por guiones
    .replace(/-+/g, '-') // Reemplazar múltiples guiones por uno solo
    .replace(/^-|-$/g, ''); // Eliminar guiones al inicio y final
  
  // Asegurar que el nombre no esté vacío
  return normalized || 'archivo-sin-nombre';
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
 * Obtiene la extensión de un archivo
 * @param fileName Nombre del archivo
 * @returns Extensión del archivo
 */
export const getFileExtension = (fileName: string): string => {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

/**
 * Determina el tipo MIME de un archivo basado en su extensión
 * @param fileName Nombre del archivo
 * @returns Tipo MIME correspondiente
 */
export const getMimeType = (fileName: string): string => {
  const extension = getFileExtension(fileName);
  
  const mimeTypes: { [key: string]: string } = {
    // Imágenes
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    
    // Videos
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'webm': 'video/webm',
    
    // Documentos
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    
    // Por defecto
    'default': 'application/octet-stream'
  };
  
  return mimeTypes[extension] || mimeTypes.default;
}; 