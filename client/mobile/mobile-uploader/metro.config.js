const { getDefaultConfig } = require('expo/metro-config');
const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.resolver.extraNodeModules = {
  ...defaultConfig.resolver.extraNodeModules,
  crypto: require.resolve('expo-crypto')
};

module.exports = defaultConfig; 