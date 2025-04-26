#!/bin/bash

# Definir colores para mejor visualización
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Directorio del proyecto
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Asegurarse de que todas las dependencias están instaladas
echo -e "${BLUE}Verificando dependencias...${NC}"
npm install

# Función para ejecutar un grupo de tests
run_tests() {
  local test_type=$1
  local test_dir=$2
  local message=$3
  
  echo -e "\n${YELLOW}=======================================${NC}"
  echo -e "${YELLOW}   $message${NC}"
  echo -e "${YELLOW}=======================================${NC}\n"
  
  # Ejecutar los tests
  NODE_ENV=test npx jest --config=jest.config.js --testPathPattern="$test_dir" --verbose
  
  # Verificar resultado
  if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✓ $test_type tests completados exitosamente${NC}\n"
    return 0
  else
    echo -e "\n${RED}✗ $test_type tests fallaron${NC}\n"
    return 1
  fi
}

# Configurar variables para los tests E2E
start_server() {
  echo -e "${BLUE}Iniciando servidor para tests E2E...${NC}"
  
  # Usar PORT diferente para evitar conflictos
  export PORT=5000
  export SERVER_URL="http://localhost:5000"
  
  # Iniciar servidor en segundo plano
  NODE_ENV=test npm run start:dev > /tmp/server-test.log 2>&1 &
  SERVER_PID=$!
  
  # Esperar a que el servidor inicie
  echo -e "${BLUE}Esperando que el servidor inicie...${NC}"
  sleep 3
  
  # Verificar que el servidor está corriendo
  if kill -0 $SERVER_PID > /dev/null 2>&1; then
    echo -e "${GREEN}Servidor iniciado correctamente (PID: $SERVER_PID)${NC}"
    return 0
  else
    echo -e "${RED}Error al iniciar el servidor${NC}"
    cat /tmp/server-test.log
    return 1
  fi
}

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    echo -e "${BLUE}Deteniendo servidor (PID: $SERVER_PID)...${NC}"
    kill $SERVER_PID
    wait $SERVER_PID 2>/dev/null
    echo -e "${GREEN}Servidor detenido${NC}"
  fi
}

# Ejecutar tests unitarios primero
run_tests "Unit" "tests/unit" "Ejecutando tests unitarios"
UNIT_RESULT=$?

# Ejecutar tests de integración
run_tests "Integration" "tests/integration" "Ejecutando tests de integración"
INTEGRATION_RESULT=$?

# Iniciar servidor para tests E2E
E2E_RESULT=0
if start_server; then
  # Ejecutar tests E2E
  run_tests "E2E" "tests/e2e" "Ejecutando tests end-to-end"
  E2E_RESULT=$?
  
  # Detener servidor
  stop_server
else
  E2E_RESULT=1
fi

# Mostrar resumen
echo -e "\n${YELLOW}=======================================${NC}"
echo -e "${YELLOW}            RESUMEN DE TESTS            ${NC}"
echo -e "${YELLOW}=======================================${NC}\n"

if [ $UNIT_RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ Tests unitarios: PASADOS${NC}"
else
  echo -e "${RED}✗ Tests unitarios: FALLIDOS${NC}"
fi

if [ $INTEGRATION_RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ Tests de integración: PASADOS${NC}"
else
  echo -e "${RED}✗ Tests de integración: FALLIDOS${NC}"
fi

if [ $E2E_RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ Tests E2E: PASADOS${NC}"
else
  echo -e "${RED}✗ Tests E2E: FALLIDOS${NC}"
fi

# Resultado final
if [ $UNIT_RESULT -eq 0 ] && [ $INTEGRATION_RESULT -eq 0 ] && [ $E2E_RESULT -eq 0 ]; then
  echo -e "\n${GREEN}=========================================${NC}"
  echo -e "${GREEN}  Todos los tests completados con éxito  ${NC}"
  echo -e "${GREEN}=========================================${NC}"
  exit 0
else
  echo -e "\n${RED}=========================================${NC}"
  echo -e "${RED}       Algunos tests han fallado         ${NC}"
  echo -e "${RED}=========================================${NC}"
  exit 1
fi 