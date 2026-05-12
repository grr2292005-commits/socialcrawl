import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/worker/index.ts', 'src/worker/session-warmer.ts', 'src/mcp-server.ts'],
  format: ['cjs'],
  clean: true,
  minify: true,
  splitting: false,
  keepNames: false,
});
