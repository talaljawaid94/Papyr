import {
  PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList,
  BlendMode, LineCapStyle, LineJoinStyle, rgb, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, setLineJoin,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { state } from './state.js';
import { FONTS, baselineOffset } from './fonts.js';
import { pathFor, paintFor } from './shapes.js';
import { rasterizePage } from './viewer.js';

const hex = (h) => {
  const v = parseInt((h || '#000000').slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

// PDF matrix helpers ([a b c d e f], row-vector convention).
const mul = (m, k) => [
  m[0] * k[0] + m[1] * k[2], m[0] * k[1] + m[1] * k[3],
  m[2] * k[0] + m[3] * k[2], m[2] * k[1] + m[3] * k[3],
  m[4] * k[0] + m[5] * k[2] + k[4], m[4] * k[1] + m[5] * k[3] + k[5],
];
const inv = ([a, b, c, d, e, f]) => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};

class FontCache {
  constructor(doc) {
    this.doc = doc;
    this.cache = new Map();
  }
  async get(a) {
    const f = FONTS[a.font] || FONTS.helvetica;
    const variant = a.bold && a.italic && f.italic ? 'boldItalic'
      : a.bold ? 'bold' : a.italic && f.italic ? 'italic' : 'regular';
    const key = `${a.font}:${variant}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, (async () => {
        if (f.standard) return { font: await this.doc.embedFont(f.standard[variant]), standard: true };
        const bytes = await fetch(f.files[variant] || f.files.regular).then((r) => r.arrayBuffer());
        return { font: await this.doc.embedFont(bytes, { subset: !!f.subset }), standard: false };
      })());
    }
    return this.cache.get(key);
  }
}

// Standard fonts only cover WinAnsi; swap anything else for '?' instead of failing.
function encodable(font, text) {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return [...text].map((ch) => {
      try { font.encodeText(ch); return ch; } catch { return '?'; }
    }).join('');
  }
}

async function drawAnnotations(doc, page, annots, H, fonts, images) {
  page.pushOperators(setLineJoin(LineJoinStyle.Round));
  for (const a of annots) {
    if (a.type === 'text') {
      const { font } = await fonts.get(a);
      const lines = a.text.replace(/\r/g, '').split('\n');
      const base = baselineOffset(a);
      lines.forEach((line, i) => {
        if (!line) return;
        page.drawText(encodable(font, line), {
          x: a.x,
          y: H - (a.y + i * a.size * 1.2 + base),
          size: a.size,
          font,
          color: hex(a.color),
        });
      });
    } else if (a.type === 'image') {
      const asset = state.assets.get(a.assetId);
      if (!asset) continue;
      if (!images.has(a.assetId)) {
        const bytes = await fetch(asset.dataUrl).then((r) => r.arrayBuffer());
        images.set(a.assetId, asset.mime === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes));
      }
      page.drawImage(images.get(a.assetId), {
        x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, opacity: a.opacity ?? 1,
      });
    } else {
      const p = paintFor(a);
      const path = pathFor(a);
      if (!path || (!p.fill && !p.stroke)) continue;
      page.drawSvgPath(path, {
        x: 0,
        y: H,
        color: p.fill ? hex(p.fill) : undefined,
        borderColor: p.stroke ? hex(p.stroke) : undefined,
        borderWidth: p.stroke ? p.strokeWidth : undefined,
        borderLineCap: LineCapStyle.Round,
        opacity: p.opacity,
        borderOpacity: p.opacity,
        blendMode: p.multiply ? BlendMode.Multiply : undefined,
      });
    }
  }
}

function applyFormValues(doc) {
  if (!state.formDirty.size && !state.flatten) return;
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const name of state.formDirty) {
    try {
      const field = form.getField(name);
      const v = state.formValues[name];
      if (field instanceof PDFTextField) {
        // Auto-sized (0 Tf) multiline fields render one giant line; use a fixed size.
        const da = field.acroField.getDefaultAppearance() || '';
        if (field.isMultiline() && /(^|\s)0(\.0+)?\s+Tf/.test(da)) field.setFontSize(10);
        field.setText(v ? String(v) : '');
      }
      else if (field instanceof PDFCheckBox) (v ? field.check() : field.uncheck());
      else if (field instanceof PDFRadioGroup) (v ? field.select(v) : field.clear());
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) (v ? field.select(v) : field.clear());
    } catch (err) {
      console.warn(`Could not set field "${name}"`, err);
    }
  }
  if (state.flatten) {
    try {
      form.flatten();
    } catch (err) {
      console.warn('Flatten failed', err);
    }
  }
}

export async function exportPdf() {
  let doc;
  try {
    doc = await PDFDocument.load(state.bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypted/i.test(String(err?.message))) return exportFlattened();
    throw err;
  }
  doc.registerFontkit(fontkit);
  applyFormValues(doc);

  const fonts = new FontCache(doc);
  const images = new Map();
  const pdfPages = doc.getPages();

  for (const info of state.pages) {
    const annots = state.annotations.filter((a) => a.page === info.index);
    if (!annots.length) continue;
    const page = pdfPages[info.index];

    // Isolate the original content so its graphics state can't leak into ours.
    page.node.normalize();
    const start = doc.context.register(page.createContentStream(pushGraphicsState()));
    const end = doc.context.register(page.createContentStream(popGraphicsState()));
    page.node.wrapContentStreams(start, end);

    // Map "display space with y-up" (what pdf-lib's draw calls expect) into the
    // page's user space. This handles crop-box offsets and rotated pages.
    const H = info.height;
    const flip = [1, 0, 0, -1, 0, H];
    const m = mul(flip, inv(info.viewport.transform));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
    await drawAnnotations(doc, page, annots, H, fonts, images);
    page.pushOperators(popGraphicsState());
  }

  try {
    return await doc.save();
  } catch (err) {
    console.warn('Saving with appearance update failed, retrying without', err);
    return doc.save({ updateFieldAppearances: false });
  }
}

// Encrypted PDFs can't be rewritten by pdf-lib. Render each page to an image
// and draw edits on top, so the user still gets a usable, filled document.
async function exportFlattened() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = new FontCache(doc);
  const images = new Map();
  const formAnnots = formValuesAsAnnotations();

  for (const info of state.pages) {
    const canvas = await rasterizePage(info, 2);
    const png = await doc.embedPng(canvas.toDataURL('image/png'));
    const page = doc.addPage([info.width, info.height]);
    page.drawImage(png, { x: 0, y: 0, width: info.width, height: info.height });
    const annots = [...formAnnots, ...state.annotations].filter((a) => a.page === info.index);
    await drawAnnotations(doc, page, annots, info.height, fonts, images);
  }
  return doc.save();
}

function formValuesAsAnnotations() {
  const out = [];
  for (const f of state.formFields) {
    const v = state.formValues[f.name];
    const { x, y, w, h } = f.rect;
    if (f.kind === 'text' || f.kind === 'choice') {
      if (!v) continue;
      const size = f.fontSize || Math.min(12, Math.max(6, h * 0.7));
      out.push({ type: 'text', page: f.page, x: x + 2, y: y + Math.max(0, (h - size * 1.2) / 2),
        text: String(v), font: 'helvetica', size, color: '#000000' });
    } else if ((f.kind === 'checkbox' && v) || (f.kind === 'radio' && v === f.buttonValue)) {
      const s = Math.min(w, h);
      out.push({ type: f.kind === 'checkbox' ? 'check' : 'dot', page: f.page,
        x: x + (w - s) / 2, y: y + (h - s) / 2, w: s, h: s, color: '#000000' });
    }
  }
  return out;
}
