import kalam400 from '@expo-google-fonts/kalam/400Regular/Kalam_400Regular.ttf?url';
import kalam700 from '@expo-google-fonts/kalam/700Bold/Kalam_700Bold.ttf?url';
import caveat400 from '@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf?url';
import dancing400 from '@expo-google-fonts/dancing-script/400Regular/DancingScript_400Regular.ttf?url';
import dancing700 from '@expo-google-fonts/dancing-script/700Bold/DancingScript_700Bold.ttf?url';
import greatVibes from '@expo-google-fonts/great-vibes/400Regular/GreatVibes_400Regular.ttf?url';
import homemadeApple from '@expo-google-fonts/homemade-apple/400Regular/HomemadeApple_400Regular.ttf?url';

// Text fonts: one per category. The first three are PDF standard fonts (no embedding,
// tiny output); the last two are open-licensed Google Fonts embedded on export.
// `subset` is chosen per font: pdf-lib's subsetter drops glyphs from many fonts
// (e.g. Kalam), so fonts are embedded whole unless subsetting is known to work.
export const FONTS = {
  helvetica: {
    label: 'Helvetica',
    category: 'Sans-serif',
    css: 'Helvetica, Arial, sans-serif',
    italic: true,
    standard: {
      regular: 'Helvetica',
      bold: 'Helvetica-Bold',
      italic: 'Helvetica-Oblique',
      boldItalic: 'Helvetica-BoldOblique',
    },
  },
  times: {
    label: 'Times',
    category: 'Serif',
    css: '"Times New Roman", Times, serif',
    italic: true,
    standard: {
      regular: 'Times-Roman',
      bold: 'Times-Bold',
      italic: 'Times-Italic',
      boldItalic: 'Times-BoldItalic',
    },
  },
  courier: {
    label: 'Courier',
    category: 'Monospace',
    css: '"Courier New", Courier, monospace',
    italic: true,
    standard: {
      regular: 'Courier',
      bold: 'Courier-Bold',
      italic: 'Courier-Oblique',
      boldItalic: 'Courier-BoldOblique',
    },
  },
  kalam: {
    label: 'Kalam',
    category: 'Handwriting',
    css: '"FPE Kalam", cursive',
    face: 'FPE Kalam',
    italic: false,
    files: { regular: kalam400, bold: kalam700 },
  },
  dancing: {
    label: 'Dancing Script',
    category: 'Script',
    css: '"FPE Dancing Script", cursive',
    face: 'FPE Dancing Script',
    italic: false,
    subset: true, // full embedding fails in pdf-lib's fontkit for this file; subsetting renders correctly
    files: { regular: dancing400, bold: dancing700 },
  },
};

// Fonts offered for typed signatures/initials (rendered to an image).
export const SIGNATURE_FONTS = [
  { name: 'FPE Great Vibes', label: 'Great Vibes', url: greatVibes, scale: 1.15 },
  { name: 'FPE Homemade Apple', label: 'Homemade Apple', url: homemadeApple, scale: 0.75 },
  { name: 'FPE Dancing Script', label: 'Dancing Script', url: dancing400, scale: 1 },
  { name: 'FPE Caveat', label: 'Caveat', url: caveat400, scale: 1.1 },
];

async function addFaces(faces) {
  await Promise.all(
    faces.map(async (face) => {
      try {
        document.fonts.add(await face.load());
      } catch (err) {
        console.warn('Font failed to load', face.family, err);
      }
    })
  );
}

// Fonts used by the page and text tool (also shown on the landing page).
export function loadWebFonts() {
  const faces = [];
  for (const f of Object.values(FONTS)) {
    if (!f.files) continue;
    faces.push(new FontFace(f.face, `url(${f.files.regular})`, { weight: '400' }));
    faces.push(new FontFace(f.face, `url(${f.files.bold})`, { weight: '700' }));
  }
  faces.push(new FontFace('FPE Great Vibes', `url(${SIGNATURE_FONTS[0].url})`, { weight: '400' }));
  return addFaces(faces);
}

// Extra handwriting fonts only the signature dialog needs; fetched on first use.
let sigFontsLoaded = null;
export function loadSignatureFonts() {
  sigFontsLoaded ||= addFaces(
    SIGNATURE_FONTS.filter((s) => s.name === 'FPE Homemade Apple' || s.name === 'FPE Caveat').map(
      (s) => new FontFace(s.name, `url(${s.url})`, { weight: '400' })
    )
  );
  return sigFontsLoaded;
}

export function cssFont(a, sizePx = a.size) {
  const f = FONTS[a.font] || FONTS.helvetica;
  const italic = a.italic && f.italic ? 'italic ' : '';
  const bold = a.bold ? '700 ' : '400 ';
  return `${italic}${bold}${sizePx}px ${f.css}`;
}

// Where the browser puts each line's baseline inside a CSS line box of
// line-height 1.2, so export matches the on-screen layout exactly.
const metricsCache = new Map();
export function baselineOffset(a) {
  const key = `${a.font}|${a.bold}|${a.italic}`;
  let m = metricsCache.get(key);
  if (!m) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = cssFont(a, 100);
    const tm = ctx.measureText('Hg');
    const asc = (tm.fontBoundingBoxAscent ?? tm.actualBoundingBoxAscent) / 100;
    const desc = (tm.fontBoundingBoxDescent ?? tm.actualBoundingBoxDescent) / 100;
    m = { asc, desc };
    metricsCache.set(key, m);
  }
  const lh = 1.2;
  return (a.size * (lh - (m.asc + m.desc))) / 2 + a.size * m.asc;
}
