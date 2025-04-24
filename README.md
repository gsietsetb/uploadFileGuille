# Sistema de Carga de Archivos

Sistema completo para la carga, gestión y visualización de archivos con soporte para archivos grandes y carga fragmentada.

## Estructura del Proyecto

```
upload-system/
├── client/                  # Código del cliente
│   ├── web/                 # Aplicación web (React)
│   └── mobile/              # Aplicación móvil (React Native/Expo)
│       └── mobile-uploader/ # Proyecto de Expo
├── server/                  # Servidor API (Node.js/Express)
│   ├── src/                 # Código fuente del servidor
│   └── ...
└── src/                     # Código compartido
    └── utils/               # Utilidades compartidas
```

## Características

- **API RESTful** para gestión de archivos
- **Carga fragmentada** (chunked upload) para archivos grandes
- **Reinicio/Pausa** de cargas
- **Deduplicación** de archivos por hash MD5
- **Validación** de tipos de archivo por magic numbers
- **Organización** automática de archivos por fecha
- **Limpieza automática** de archivos temporales
- **Aplicación móvil** para carga desde dispositivos

## Requisitos

- Node.js v14+
- npm o yarn
- Redis (opcional, para seguimiento de estado de carga)
- Expo CLI (para desarrollo móvil)

## Instalación

### Servidor

```bash
cd server
npm install
```

### Cliente Web

```bash
cd client/web
npm install
```

### Cliente Móvil

```bash
cd client/mobile/mobile-uploader
npm install
```

## Configuración

### Variables de Entorno

Crear un archivo `.env` en la carpeta `server` con las siguientes variables:

```
PORT=3001
UPLOADS_DIR=uploads
REDIS_ENABLED=false
# Si REDIS_ENABLED=true
# REDIS_HOST=localhost
# REDIS_PORT=6379
MAX_FILE_SIZE=50000000
CHUNK_RETENTION_MINUTES=30
FILE_RETENTION_DAYS=30
```

## Ejecución

### Servidor

```bash
cd server
npm run dev
```

### Cliente Web

```bash
cd client/web
npm start
```

### Cliente Móvil

```bash
cd client/mobile/mobile-uploader
npm start
```

## API REST

### Rutas principales

- `POST /api/upload/init` - Inicializar carga
- `POST /api/upload/chunk/:fileId/:chunkIndex` - Subir fragmento
- `POST /api/upload/finalize/:fileId` - Finalizar carga
- `GET /api/upload/status/:fileId` - Verificar estado
- `PUT /api/upload/pause/:fileId` - Pausar carga
- `PUT /api/upload/resume/:fileId` - Reanudar carga
- `DELETE /api/upload/cancel/:fileId` - Cancelar carga
- `GET /api/monitoring/stats` - Estadísticas del sistema

## Licencia

MIT 