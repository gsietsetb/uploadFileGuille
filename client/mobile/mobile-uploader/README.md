# Mobile Uploader App

Aplicación móvil para cargar archivos al servidor del sistema de carga. Desarrollada con React Native y Expo.

## Características

- Selección de imágenes y videos desde la galería
- Carga de archivos al servidor con soporte para progreso
- Carga fragmentada para archivos grandes
- Previsualización de archivos subidos
- Interfaz de usuario intuitiva y moderna

## Requisitos

- Node.js (versión 14 o superior)
- npm o yarn
- Expo CLI
- XCode para desarrollo iOS
- Android Studio para desarrollo Android

## Instalación

1. Clonar el repositorio
```
git clone https://github.com/tu-usuario/upload-system.git
cd upload-system/client/mobile/mobile-uploader
```

2. Instalar dependencias
```
npm install
```

3. Configurar la URL del servidor
Editar el archivo `src/services/uploadService.ts` y cambiar la variable `API_URL` con la URL de tu servidor.

## Ejecución

### Desarrollo

```
npm start
```

Esto iniciará el servidor de desarrollo de Expo. Puedes escanear el código QR con la aplicación Expo Go en tu dispositivo móvil o usar los emuladores presionando 'i' para iOS o 'a' para Android.

### Construir para producción

#### Android
```
expo build:android
```

#### iOS
```
expo build:ios
```

## Estructura del proyecto

```
src/
├── components/    # Componentes React
│   └── FileUploader.tsx
├── hooks/         # Custom hooks
├── services/      # Servicios para API
│   └── uploadService.ts
└── utils/         # Utilidades
    └── fileUtils.ts
```

## Tecnologías utilizadas

- React Native
- Expo
- TypeScript
- Axios para solicitudes HTTP
- react-native-document-picker para selección de archivos 