import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        // Точка входа CLI: шебанг + вызов `runGranularCli` и установка
        // `process.exitCode`. Исполняется на импорте, поэтому покрывается
        // только запуском подпроцесса. Вся логика — в `src/cli.ts` (100%).
        'src/bin.ts',
      ],
      // Пороги — чтобы нулевое покрытие критичных модулей (`vite.ts`, CLI)
      // не могло вернуться незамеченным. Значения чуть ниже текущих:
      // это защита от регрессий, а не гонка за процентами.
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
