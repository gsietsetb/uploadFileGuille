describe('Pruebas Básicas', () => {
  it('debería pasar una prueba básica', () => {
    expect(1 + 1).toBe(2);
  });
  
  it('debería manejar correctamente los booleanos', () => {
    expect(true).toBe(true);
    expect(false).not.toBe(true);
  });
  
  it('debería manejar correctamente los arrays', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });
  
  it('debería manejar correctamente los objetos', () => {
    const obj = { name: 'test', value: 42 };
    expect(obj).toHaveProperty('name');
    expect(obj.value).toBe(42);
  });
}); 