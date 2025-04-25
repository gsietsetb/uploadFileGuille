/**
 * Utilidades para el manejo de archivos en React Native
 */

/**
 * Normaliza un nombre de archivo eliminando caracteres especiales y espacios
 * para que sea seguro en URLs y sistemas de archivos
 * @param fileName Nombre del archivo a normalizar
 * @returns Nombre normalizado
 */
export const normalizeFileName = (fileName: string): string => {
  // Separar el nombre y la extensión
  const lastDotIndex = fileName.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? fileName.slice(lastDotIndex) : '';
  const baseName = lastDotIndex !== -1 ? fileName.slice(0, lastDotIndex) : fileName;
  
  // Eliminar emojis y caracteres especiales
  const withoutEmojis = baseName.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
  
  // Reemplazar espacios y caracteres especiales por guiones
  const normalized = withoutEmojis
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
    .replace(/[^a-zA-Z0-9.-]/g, '-') // Reemplazar caracteres no alfanuméricos por guiones
    .replace(/-+/g, '-') // Reemplazar múltiples guiones por uno solo
    .replace(/^-|-$/g, '') // Eliminar guiones al inicio y final
    .trim();
  
  // Asegurar que el nombre no esté vacío y añadir extensión
  const normalizedBaseName = normalized || 'archivo';
  
  // Normalizar también la extensión (solo permitir caracteres alfanuméricos)
  const cleanExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, '');
  
  return normalizedBaseName + cleanExtension;
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

/**
 * Sanitiza una URL para asegurarse de que sea segura
 * @param url URL a sanitizar
 * @returns URL sanitizada
 */
export const sanitizeUrl = (url: string): string => {
  if (!url) return '';
  
  try {
    // Crear objeto URL para manipular partes de la URL
    const urlObj = new URL(url);
    
    // Decodificar y re-codificar el pathname para asegurar que esté correctamente formateado
    const pathParts = urlObj.pathname.split('/');
    const sanitizedPathParts = pathParts.map(part => {
      // Decodificar primero para evitar doble codificación
      const decoded = decodeURIComponent(part);
      // Codificar solo si no es una parte de la ruta como 'uploads' o 'complete'
      if (['uploads', 'complete', ''].includes(decoded) || decoded.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return decoded;
      }
      return encodeURIComponent(normalizeFileName(decoded));
    });
    
    urlObj.pathname = sanitizedPathParts.join('/');
    
    return urlObj.toString();
  } catch (error) {
    console.error('Error al sanitizar URL:', error);
    return url; // Devolver la URL original si algo falla
  }
}; 