import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Serve the same security headers locally (`npm run preview`) that Vercel applies,
// so a policy that would break the app is caught before deploying.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const globalHeaders = Object.fromEntries(
  vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value])
);

// Social-preview tags need absolute URLs. On Vercel the production domain is exposed at
// build time; set SITE_URL yourself to override (e.g. when adding a custom domain).
const siteUrl = (
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
).replace(/\/$/, '');

const siteUrlPlugin = () => ({
  name: 'site-url',
  transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
});

export default defineConfig({
  plugins: [siteUrlPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  preview: { headers: globalHeaders },
});
