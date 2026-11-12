import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const domains = env.VITE_HOST ? [env.VITE_HOST] : undefined;
  const tlsCertificate = env.VITE_TLS_CERTIFICATE;
  const tlsPrivateKey = env.VITE_TLS_PRIVATE_KEY;
  if (Boolean(tlsCertificate) !== Boolean(tlsPrivateKey)) {
    throw new Error('VITE_TLS_CERTIFICATE 和 VITE_TLS_PRIVATE_KEY 必须同时配置');
  }
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(tlsCertificate && tlsPrivateKey ? [] : [basicSsl({ domains, certDir: '.cert' })]),
    ],
    server: {
      host: env.VITE_HOST || true,
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
        '/api': {
          target: 'http://127.0.0.1:8080',
          ws: true,
          configure(proxy) {
            proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
              // 刷新后立即释放已收到 FIN 的连接，避免上游继续写入旧 TLS socket。
              socket.once('end', () => socket.destroy());
            });
          },
        },
        '/healthz': 'http://127.0.0.1:8080',
      },
      allowedHosts: domains,
    },
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
  };
});
