import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = Number(env.PORT || 6889);
  const frontendPort = Number(env.FRONTEND_PORT || 8888);

  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/ws/live': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
  };
});
