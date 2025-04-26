#!/bin/bash

# Script para instalar las dependencias globales necesarias para los tests

# Colores para mensajes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}= Configuración de entorno para =${NC}"
echo -e "${BLUE}=    pruebas Upload System      =${NC}"
echo -e "${BLUE}=================================${NC}"

# Instalar dependencias globales
echo -e "\n${YELLOW}Instalando dependencias globales...${NC}"
npm install -g nyc mocha ts-node

# Instalar dependencias locales
echo -e "\n${YELLOW}Instalando dependencias del proyecto...${NC}"
npm install

# Crear directorios necesarios
echo -e "\n${YELLOW}Creando directorios para tests...${NC}"
mkdir -p test/fixtures
mkdir -p test/tmp
mkdir -p reports

# Verificar instalación de nyc
if command -v nyc > /dev/null; then
    echo -e "\n${GREEN}✓ nyc está instalado correctamente${NC}"
else
    echo -e "\n${YELLOW}⚠️ nyc no está disponible. Intenta ejecutar 'npm install -g nyc' manualmente${NC}"
fi

# Verificar instalación de mocha
if command -v mocha > /dev/null; then
    echo -e "${GREEN}✓ mocha está instalado correctamente${NC}"
else
    echo -e "${YELLOW}⚠️ mocha no está disponible. Intenta ejecutar 'npm install -g mocha' manualmente${NC}"
fi

# Verificar instalación de ts-node
if command -v ts-node > /dev/null; then
    echo -e "${GREEN}✓ ts-node está instalado correctamente${NC}"
else
    echo -e "${YELLOW}⚠️ ts-node no está disponible. Intenta ejecutar 'npm install -g ts-node' manualmente${NC}"
fi

echo -e "\n${GREEN}¡Configuración completada!${NC}"
echo -e "Puedes ejecutar las pruebas con: ${BLUE}npm test${NC}" 