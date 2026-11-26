/**
 * Live-provider jest config (G6 part A). Kept separate so `*.live.ts` never runs
 * in the normal suite, whose testRegex only matches `*.spec.ts`.
 * Run with: pnpm --filter @kase/api test:live
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.live\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
