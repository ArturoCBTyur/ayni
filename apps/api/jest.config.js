/** Configuración de Jest para el API. Los umbrales de cobertura implementan RNF-19. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.module.ts', '!**/main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Un solo worker, a proposito. Estas no son pruebas unitarias: casi todas
  // escriben en la misma base PostgreSQL, sobre un libro contable que es un
  // recurso global, con transacciones SERIALIZABLE y advisory locks por fondo.
  // En paralelo se estorban entre si: los asientos de una suite hacen fallar
  // la conciliacion de otra, y la prueba de manipulacion del libro toma un
  // lock ACCESS EXCLUSIVE sobre movimientos_contables que bloquea al resto.
  // Los fallos que produce son intermitentes, que es la peor clase de fallo:
  // ensena a desconfiar de la suite en lugar de a corregir el codigo.
  maxWorkers: 1,
  // Reactiva los triggers de inmutabilidad del libro por si una corrida
  // anterior se interrumpio con alguno apagado. Ver preparar-pruebas.ts.
  globalSetup: '<rootDir>/comun/prisma/preparar-pruebas.ts',
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/$1' },
  // RNF-19: cobertura >= 70 % en los módulos contable y de gastos.
  coverageThreshold: {
    './src/modules/contable/': { lines: 70, statements: 70, branches: 60 },
    './src/modules/gastos/': { lines: 70, statements: 70, branches: 60 },
  },
};
