import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    '.next_prev_*/**',
    'backups/**',
    'node_modules/**',
    'next-env.d.ts'
  ])
]);
