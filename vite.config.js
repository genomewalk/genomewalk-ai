import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  appType: 'mpa',
  plugins: [
    react(),
    {
      name: 'raw-compressed-data',
      configureServer(server) {
        // Same rule as Genomewalk: gzip/BGZF is the file format, not HTTP encoding.
        server.middlewares.use((req, res, next) => {
          if (/\/(?:samples|ref)\/[^?]*\.gz(?:\?|$)/.test(req.url || '')) {
            res.setHeader('Content-Encoding', 'identity');
            res.setHeader('Content-Type', 'application/gzip');
          }
          next();
        });
      },
    },
  ],
  worker: { format: 'es' },
  // These libraries load lazily in workers. Discover them before the first
  // question so dependency optimization cannot reload an active conversation.
  optimizeDeps: { include: ['@huggingface/transformers', '@mlc-ai/web-llm'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      strict: true,
      deny: [
        '.env',
        '.env.*',
        '**/.git/**',
        '**/.local/**',
        '**/scripts/**',
        '**/tests/**',
        '**/evals/**',
        '**/docs/**',
        '**/output/**',
        '**/VALIDATION.md',
        '**/*.sqlite*',
      ],
    },
  },
});
