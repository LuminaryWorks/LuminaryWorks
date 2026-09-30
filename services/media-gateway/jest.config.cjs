/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          esModuleInterop: true,
          strict: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          types: ["node", "jest"],
          target: "ES2022",
        },
      },
    ],
  },
  testEnvironment: "node",
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
};
