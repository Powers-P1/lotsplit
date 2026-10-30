import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: {
  outDir: 'dist/client',
  // Open tabs may still need an earlier build's lazy chunks after a local rebuild.
  emptyOutDir: false,
}, server: { allowedHosts: ['localhost','127.0.0.1'] } });

