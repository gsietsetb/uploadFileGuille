# Plan de Pruebas de Estrés - Sistema de Carga de Archivos

## 1. Objetivos

- Verificar que el sistema puede manejar un mínimo de 100 cargas concurrentes
- Evaluar el rendimiento bajo altas cargas de trabajo
- Identificar cuellos de botella en el procesamiento de archivos
- Medir la capacidad de recuperación frente a fallos de red
- Establecer métricas de referencia para capacidad de escalado

## 2. Entorno de Pruebas

### Hardware
- Servidor: Mínimo 4 núcleos CPU, 8GB RAM
- Cliente de pruebas: Máquina separada con 8GB+ RAM

### Software
- Node.js v14+
- Artillery.io para generación de carga
- Chaos Monkey para simulación de fallos de red
- Grafana/Prometheus para monitoreo en tiempo real

## 3. Pruebas de Carga Concurrente

### 3.1 Prueba de 100 Usuarios Simultáneos

```javascript
// artillery-config.yml
config:
  target: "http://localhost:3001"
  phases:
    - duration: 60
      arrivalRate: 10
      rampTo: 100
      name: "Ramping up to 100 concurrent users"
  variables:
    fileSize: [500000, 1000000, 5000000, 10000000]
    
scenarios:
  - name: "Upload files"
    flow:
      - post:
          url: "/api/upload/init"
          json:
            fileName: "test-file-{{ $randomNumber(1, 1000) }}.jpg"
            fileSize: "{{ fileSize }}"
            fileType: "image/jpeg"
            totalChunks: "{{ Math.ceil(fileSize / 1048576) }}"
          capture:
            - json: "$.fileId"
              as: "fileId"
      - loop:
          - post:
              url: "/api/upload/chunk/{{ fileId }}/{{ $loopElement }}"
              body: "{{ $randomString(1048576) }}"
          count: "{{ Math.ceil(fileSize / 1048576) }}"
      - post:
          url: "/api/upload/finalize/{{ fileId }}"
```

### 3.2 Prueba de Carga Sostenida
- Duración: 1 hora
- Usuarios concurrentes: 50-100
- Tamaño de archivos: Variable (1MB-50MB)
- Métricas a monitorear: 
  - Tiempo de respuesta
  - Uso de CPU/memoria
  - Tasas de error
  - Uso de disco

### 3.3 Prueba de Escalado Vertical
Incrementar gradualmente la carga hasta que el sistema alcance sus límites:
1. Empezar con 10 usuarios concurrentes
2. Incrementar 10 usuarios cada 5 minutos
3. Continuar hasta que el tiempo de respuesta supere 5 segundos o la tasa de error supere el 5%

## 4. Pruebas de Fallo de Red

### 4.1 Interrupciones de Red Durante Carga

Usando Chaos Monkey o similares para simular:

1. **Pérdida de paquetes** (5%, 15%, 30%)
   - Iniciar 50 cargas concurrentes
   - Activar pérdida de paquetes a diferentes niveles
   - Verificar tasas de reintentos y recuperación

2. **Latencia de Red** (100ms, 500ms, 1000ms)
   - Iniciar 50 cargas concurrentes
   - Introducir latencia artificial
   - Medir impacto en tiempos de carga y tasa de completado

3. **Desconexiones Intermitentes**
   - Simular desconexiones aleatorias (5-10 segundos) cada 30 segundos
   - Verificar que el sistema pueda reanudar cargas interrumpidas
   - Medir tiempo total para completar cargas con interrupciones vs. sin ellas

### 4.2 Prueba de Reanudación de Carga
1. Iniciar 20 cargas concurrentes
2. Desconectar completamente el cliente a mitad del proceso
3. Reconectar después de 30 segundos
4. Verificar que todas las cargas se puedan reanudar correctamente
5. Medir cuántos chunks adicionales fueron requeridos (idealmente cero)

## 5. Diseño Experimental

### Comparativa de Rendimiento

| Escenario | Descripción | Métrica Primaria | Valor Aceptable |
|-----------|-------------|------------------|-----------------|
| Base | 10 usuarios, archivos 5MB | Tiempo medio carga | <10s |
| Nominal | 50 usuarios, archivos 5MB | Tiempo medio carga | <30s |
| Estrés | 100 usuarios, archivos 5MB | Tiempo medio carga | <60s |
| Red Débil | 50 usuarios, 15% pérdida paquetes | % cargas completas | >95% |
| Desconexión | 20 usuarios, desconexión 30s | % cargas recuperadas | 100% |

## 6. Herramientas para Pruebas de Red

### Simulador de Conexiones Débiles

```bash
# Usando tc (Linux) para simular pérdida de paquetes
sudo tc qdisc add dev eth0 root netem loss 15%

# Usando tc para simular latencia
sudo tc qdisc add dev eth0 root netem delay 500ms 50ms

# Para reestablecer
sudo tc qdisc del dev eth0 root
```

### Script para Pruebas de Desconexión

```javascript
const { exec } = require('child_process');
const ON_DURATION = 60000;  // 1 minuto online
const OFF_DURATION = 10000; // 10 segundos offline

function toggleNetwork(online) {
  const cmd = online ? 
    'sudo ifconfig eth0 up' : 
    'sudo ifconfig eth0 down';
  
  exec(cmd, (error) => {
    if (error) console.error(`Error: ${error}`);
    console.log(`Red ${online ? 'conectada' : 'desconectada'}`);
  });
}

// Ciclo de conexión/desconexión
setInterval(() => {
  toggleNetwork(false);
  setTimeout(() => toggleNetwork(true), OFF_DURATION);
}, ON_DURATION + OFF_DURATION);
```

## 7. Criterios de Éxito

Para considerar que el sistema supera las pruebas debe cumplir:

1. Soportar 100 cargas concurrentes con menos del 1% de fallos
2. Tiempo medio de carga inferior a 60 segundos para archivos de 5MB en escenario de estrés
3. Recuperar el 100% de las cargas interrumpidas por desconexiones
4. Mantener uso de CPU por debajo del 80% durante carga máxima
5. No presentar fugas de memoria (memory leaks) después de 1 hora de carga sostenida

## 8. Automatización de Pruebas

Las pruebas se ejecutarán automáticamente como parte del pipeline CI/CD:

```yaml
# En .github/workflows/stress-test.yml
name: Stress Tests

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  stress-test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '14'
    
    - name: Install dependencies
      run: npm ci
      working-directory: ./server
      
    - name: Start server
      run: npm start &
      working-directory: ./server
      
    - name: Install Artillery
      run: npm install -g artillery
      
    - name: Run stress tests
      run: artillery run tests/stress/artillery-config.yml
      
    - name: Generate report
      run: artillery report -o stress-test-report.html
      
    - name: Upload results
      uses: actions/upload-artifact@v2
      with:
        name: stress-test-results
        path: stress-test-report.html
```

## 9. Medición de Network Failure Recovery

Script específico para probar la recuperación tras fallos de red:

```javascript
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Configuración
const SERVER_URL = 'http://localhost:3001';
const FILE_SIZE = 10 * 1024 * 1024; // 10MB
const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB
const TOTAL_CHUNKS = Math.ceil(FILE_SIZE / CHUNK_SIZE);

// Simular desconexión después de cierto número de chunks
const DISCONNECT_AFTER_CHUNK = Math.floor(TOTAL_CHUNKS / 2);
const RECONNECT_AFTER_MS = 5000; // 5 segundos

async function testNetworkFailureRecovery() {
  console.log('Iniciando prueba de recuperación por fallo de red');
  
  // 1. Crear archivo de prueba
  const testBuffer = Buffer.alloc(FILE_SIZE, 'x');
  
  // 2. Inicializar carga
  const initResponse = await axios.post(`${SERVER_URL}/api/upload/init`, {
    fileName: 'network-test.dat',
    fileSize: FILE_SIZE,
    fileType: 'application/octet-stream',
    totalChunks: TOTAL_CHUNKS
  });
  
  const fileId = initResponse.data.fileId;
  console.log(`Carga iniciada: ${fileId}`);
  
  // 3. Cargar chunks hasta el punto de desconexión
  for (let i = 0; i < DISCONNECT_AFTER_CHUNK; i++) {
    await uploadChunk(fileId, i, testBuffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    console.log(`Chunk ${i} cargado correctamente`);
  }
  
  // 4. Simular desconexión
  console.log('Simulando desconexión de red...');
  await new Promise(resolve => setTimeout(resolve, RECONNECT_AFTER_MS));
  
  // 5. Obtener estado para saber qué chunks se cargaron
  const statusResponse = await axios.get(`${SERVER_URL}/api/upload/status/${fileId}`);
  const uploadedChunks = statusResponse.data.receivedChunks;
  console.log(`Chunks ya cargados: ${uploadedChunks.length}/${TOTAL_CHUNKS}`);
  
  // 6. Cargar los chunks restantes
  for (let i = 0; i < TOTAL_CHUNKS; i++) {
    if (!uploadedChunks.includes(i)) {
      await uploadChunk(fileId, i, testBuffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      console.log(`Chunk ${i} cargado después de reconexión`);
    }
  }
  
  // 7. Finalizar la carga
  const finalizeResponse = await axios.post(`${SERVER_URL}/api/upload/finalize/${fileId}`);
  console.log(`Carga finalizada: ${finalizeResponse.data.fileUrl}`);
  
  return {
    success: true,
    chunksBeforeDisconnect: DISCONNECT_AFTER_CHUNK,
    chunksAfterReconnect: TOTAL_CHUNKS - uploadedChunks.length,
    totalTime: Date.now() - startTime
  };
}

async function uploadChunk(fileId, chunkIndex, buffer) {
  const formData = new FormData();
  formData.append('chunk', buffer, {
    filename: 'blob',
    contentType: 'application/octet-stream'
  });
  
  return axios.post(
    `${SERVER_URL}/api/upload/chunk/${fileId}/${chunkIndex}`,
    formData,
    { headers: { ...formData.getHeaders() } }
  );
}

// Ejecutar prueba
const startTime = Date.now();
testNetworkFailureRecovery()
  .then(result => console.log('Resultado:', result))
  .catch(error => console.error('Error en prueba:', error));
``` 