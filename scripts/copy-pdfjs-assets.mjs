// Copies pdf.js runtime assets (CMaps, standard fonts, wasm decoders, ICC profiles)
// into public/ so they are served as static files (no CDN, no cost).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const out = join(process.cwd(), 'public', 'pdfjs');
mkdirSync(out, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(pdfjsRoot, dir), join(out, dir), { recursive: true });
}
console.log('pdf.js assets copied to public/pdfjs');
