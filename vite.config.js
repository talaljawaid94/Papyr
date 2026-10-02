import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Serve the same security headers locally (`npm run preview`) that Vercel applies,
// so a policy that would break the app is caught before deploying.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const globalHeaders = Object.fromEntries(
  vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value])
);

export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  preview: { headers: globalHeaders },
});
