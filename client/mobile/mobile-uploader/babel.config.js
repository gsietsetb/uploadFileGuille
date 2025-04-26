module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Agregar transformación de runtime para polyfills
      ["@babel/plugin-transform-runtime", {
        "helpers": true,
        "regenerator": true
      }]
    ]
  };
}; 