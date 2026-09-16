/** Configuración de Jest para el API. Los umbrales de cobertura implementan RNF-19. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.module.ts', '!**/main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/$1' },
  // RNF-19: cobertura >= 70 % en los módulos contable y de gastos.
  coverageThreshold: {
    './src/modules/contable/': { lines: 70, statements: 70, branches: 60 },
    './src/modules/gastos/': { lines: 70, statements: 70, branches: 60 },
  },
};
