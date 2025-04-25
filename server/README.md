# Sistema de Carga de Archivos - Servidor

Este es el backend del sistema de carga de archivos, que proporciona APIs para la carga por chunks, gestión de estado y monitoreo.

## Características

- Carga de archivos grandes mediante particionamiento en chunks
- Validación de tipos de archivos mediante firmas binarias (magic numbers)
- Deduplicación de archivos mediante hashing MD5
- Almacenamiento organizado por fechas
- Limpieza automática de archivos temporales y antiguos
- APIs de monitoreo para estado del sistema
- Soporte para Redis para escalabilidad horizontal (opcional)
- Límites de tasa para prevenir abusos

## Requisitos previos

- Node.js (v18.x o superior)
- npm o yarn
- Redis (opcional, para producción)

## Instalación

1. Clonar el repositorio
2. Instalar dependencias:

```bash
cd server
npm install
```

3. Configurar variables de entorno: Copia el archivo `.env.example` a `.env` y ajusta los valores según tu entorno.

## Ejecutar en desarrollo

```bash
npm run dev
```

## Construir para producción

```bash
npm run build
npm start
```

## Pruebas

El proyecto incluye pruebas unitarias y de integración utilizando Jest.

### Ejecutar todas las pruebas

```bash
npm test
```

### Ejecutar pruebas individuales

```bash
npm test -- src/__tests__/basic.test.ts
```

### Ejecutar pruebas con watch mode

```bash
npm run test:watch
```

### Ejecutar pruebas con cobertura

```bash
npm run test:coverage
```

## Estructura de pruebas

El proyecto incluye varias capas de pruebas:

- **Pruebas unitarias**: Verifican componentes individuales de forma aislada
  - `__tests__/utils/fileUtils.test.ts`: Pruebas para utilidades de archivos
  - `__tests__/basic.test.ts`: Pruebas básicas para validar la configuración

- **Pruebas de integración**: Verifican la interacción entre componentes
  - `__tests__/routes/upload.routes.test.ts`: Pruebas para rutas de carga
  - `__tests__/routes/monitoring.routes.test.ts`: Pruebas para rutas de monitoreo
  - `__tests__/integration.test.ts`: Pruebas de integración del sistema completo

### Soluciones para problemas comunes en las pruebas

Durante el desarrollo de las pruebas, se identificaron y solucionaron los siguientes problemas:

1. **Error de tipado en parámetros de funciones mock**: Se agregó tipado explícito a los parámetros de las funciones mock para evitar errores de TypeScript.
   ```typescript
   get: jest.fn().mockImplementation((key: string) => { ... })
   ```

2. **Rutas faltantes en los controladores**: Se implementó la ruta `/health` en el router de monitoreo que faltaba, lo cual causaba respuestas 404 en las pruebas.

3. **Mock incompleto de bibliotecas**: Se corrigió el mock de multer para proporcionar la función `memoryStorage` que era requerida por el código:
   ```typescript
   multerMock.memoryStorage = jest.fn().mockReturnValue({});
   ```

4. **Adaptación a las respuestas reales de la API**: Se ajustaron las expectativas de los tests para que coincidan con el comportamiento real de la API:
   - Códigos de estado (201 para creación en lugar de 200)
   - Estructura de respuesta (`message` en lugar de `status`)

5. **Simplificación de pruebas complejas**: Se simplificaron las pruebas que dependían del estado interno del servidor, adoptando un enfoque más unitario.

### Mocks implementados

Para facilitar las pruebas, se han implementado varios mocks:

- Mock de `fileUtils`: Simula operaciones de archivos sin acceder al sistema de archivos real
- Mock de `multer`: Simula la subida de archivos sin requerir archivos reales
- Mock de `Redis`: Simula operaciones de caché sin requerir una instancia de Redis

## Variables de entorno

- `PORT`: Puerto del servidor (por defecto: 3001)
- `NODE_ENV`: Entorno de ejecución (development, production, test)
- `UPLOADS_DIR`: Directorio para almacenar uploads (por defecto: uploads)
- `REDIS_ENABLED`: Habilitar Redis para persistencia (true/false)
- `REDIS_HOST`: Host de Redis (por defecto: localhost)
- `REDIS_PORT`: Puerto de Redis (por defecto: 6379)
- `MAX_FILE_SIZE`: Tamaño máximo de archivo en bytes (por defecto: 50MB)
- `CHUNK_RETENTION_MINUTES`: Tiempo de retención para chunks temporales (por defecto: 30)
- `FILE_RETENTION_DAYS`: Tiempo de retención para archivos completos (por defecto: 30)
- `ALLOWED_MIME_TYPES`: Lista de tipos MIME permitidos separados por comas

## Mejoras futuras para pruebas

- Implementar pruebas de carga para verificar el rendimiento con múltiples usuarios
- Configurar un entorno CI/CD para ejecutar pruebas automáticamente
- Aumentar la cobertura de código con más pruebas unitarias
- Implementar pruebas e2e con un cliente real
- Mejorar las pruebas de flujo completo de carga utilizando un enfoque más realista con estado compartido 