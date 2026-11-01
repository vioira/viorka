import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const tlsCertificate = env.VITE_TLS_CERTIFICATE;
  const tlsPrivateKey = env.VITE_TLS_PRIVATE_KEY;
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: env.VITE_PORT ? +env.VITE_PORT : 8143,
      strictPort: true,
      https:
        tlsCertificate && tlsPrivateKey
          ? {
              cert: readFileSync(tlsCertificate),
              key: readFileSync(tlsPrivateKey),
            }
          : undefined,
      proxy: {
        '/api': 'http://127.0.0.1:8080',
        '/healthz': 'http://127.0.0.1:8080',
      },
      allowedHosts: env.VITE_HOST ? [env.VITE_HOST] : undefined,
    },
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
  };
});
