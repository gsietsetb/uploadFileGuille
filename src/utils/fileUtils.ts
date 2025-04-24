/**
 * Utilidades para el manejo de archivos
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