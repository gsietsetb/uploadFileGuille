import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ConnectionStatusProps {
  isConnected: boolean;
  isDevelopment: boolean;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ isConnected, isDevelopment }) => {
  // Si estamos en modo desarrollo, mostrar indicador de modo mock
  if (isDevelopment) {
    return (
      <View style={styles.container}>
        <MaterialIcons name="developer-mode" size={16} color="#8e44ad" />
        <Text style={[styles.text, styles.developmentText]}>
          Modo desarrollo (servidor mock)
        </Text>
      </View>
    );
  }
  
  // Si no estamos en modo desarrollo, mostrar estado de conexión real
  return (
    <View style={styles.container}>
      <MaterialIcons 
        name={isConnected ? "cloud-done" : "cloud-off"} 
        size={16} 
        color={isConnected ? "#27ae60" : "#e74c3c"} 
      />
      <Text 
        style={[
          styles.text, 
          isConnected ? styles.connectedText : styles.disconnectedText
        ]}
      >
        {isConnected ? "Conectado al servidor" : "Sin conexión al servidor"}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    opacity: 0.9,
    marginBottom: 8,
  },
  text: {
    fontSize: 12,
    marginLeft: 4,
  },
  connectedText: {
    color: '#27ae60',
  },
  disconnectedText: {
    color: '#e74c3c',
  },
  developmentText: {
    color: '#8e44ad',
  }
});

export default ConnectionStatus; 