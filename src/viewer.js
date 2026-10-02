import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { state } from './state.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = import.meta.env.BASE_URL;
const PDFJS_OPTS = {
  cMapUrl: `${base}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
  wasmUrl: `${base}pdfjs/wasm/`,
  iccUrl: `${base}pdfjs/iccs/`,
};

let observer = null;
const renderTasks = new Map();

export async function openPdf(bytes, askPassword) {
  const task = pdfjs.getDocument({ ...PDFJS_OPTS, data: bytes.slice() });
  task.onPassword = (update, reason) => {
    const pw = askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw === null) task.destroy();
    else update(pw);
  };
  const pdf = await task.promise;
  if (state.pdf) state.pdf.destroy();
  state.pdf = pdf;

  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ index: i, page, viewport, width: viewport.width, height: viewport.height, rendered: 0 });
  }
  state.pages = pages;
  state.formFields = await detectFormFields(pages);
  return pdf;
}

async function detectFormFields(pages) {
  const fields = [];
  for (const p of pages) {
    let annots = [];
    try {
      annots = await p.page.getAnnotations({ intent: 'display' });
    } catch {
      continue;
    }
    for (const an of annots) {
      if (an.subtype !== 'Widget' || !an.fieldName || an.hidden) continue;
      const [x1, y1] = p.viewport.convertToViewportPoint(an.rect[0], an.rect[1]);
      const [x2, y2] = p.viewport.convertToViewportPoint(an.rect[2], an.rect[3]);
      const rect = {
        x: Math.min(x1, x2), y: Math.min(y1, y2),
        w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      };
      if (rect.w < 2 || rect.h < 2) continue;
      const base = { id: an.id, page: p.index, name: an.fieldName, rect, readOnly: !!an.readOnly };
      if (an.fieldType === 'Tx') {
        fields.push({
          ...base, kind: 'text', multiline: !!an.multiLine, maxLen: an.maxLen || 0,
          comb: !!an.comb, value: an.fieldValue ?? '', align: an.textAlignment ?? 0,
          fontSize: an.defaultAppearanceData?.fontSize || 0, password: !!an.password,
        });
      } else if (an.fieldType === 'Btn' && an.checkBox) {
        const on = an.exportValue || 'Yes';
        fields.push({ ...base, kind: 'checkbox', exportValue: on, value: an.fieldValue === on });
      } else if (an.fieldType === 'Btn' && an.radioButton) {
        fields.push({ ...base, kind: 'radio', buttonValue: an.buttonValue, value: an.fieldValue });
      } else if (an.fieldType === 'Ch') {
        fields.push({
          ...base, kind: 'choice', combo: !!an.combo,
          options: (an.options || []).map((o) => ({ value: o.exportValue, label: o.displayValue })),
          value: Array.isArray(an.fieldValue) ? an.fieldValue[0] ?? '' : an.fieldValue ?? '',
        });
      }
    }
  }
  // Initial values keyed by fully-qualified field name.
  state.formValues = {};
  state.formDirty = new Set();
  for (const f of fields) {
    if (f.kind === 'radio') {
      if (f.value && f.value !== 'Off') state.formValues[f.name] = f.value;
      else if (!(f.name in state.formValues)) state.formValues[f.name] = null;
    } else if (!(f.name in state.formValues)) {
      state.formValues[f.name] = f.value;
    }
  }
  return fields;
}

export function buildPageDom(container, onLayerReady) {
  container.innerHTML = '';
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) renderPage(state.pages[+e.target.dataset.index]);
      }
    },
    { root: container.closest('.viewer'), rootMargin: '600px 0px' }
  );

  for (const p of state.pages) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.dataset.index = p.index;
    const canvas = document.createElement('canvas');
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.dataset.page = p.index;
    layer.style.width = `${p.width}px`;
    layer.style.height = `${p.height}px`;
    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = `Page ${p.index + 1} of ${state.pages.length}`;
    wrap.append(canvas, layer, label);
    container.append(wrap);
    Object.assign(p, { wrap, canvas, layer });
    onLayerReady(p);
    observer.observe(wrap);
  }
  applyZoom();
}

export function applyZoom() {
  const z = state.zoom;
  for (const p of state.pages) {
    if (!p.wrap) continue;
    p.wrap.style.width = `${p.width * z}px`;
    p.wrap.style.height = `${p.height * z}px`;
    p.canvas.style.width = `${p.width * z}px`;
    p.canvas.style.height = `${p.height * z}px`;
    p.layer.style.transform = `scale(${z})`;
    p.layer.style.setProperty('--z', z);
    if (p.rendered && p.rendered !== z) {
      p.rendered = 0;
      const r = p.wrap.getBoundingClientRect();
      if (r.bottom > -600 && r.top < window.innerHeight + 600) renderPage(p);
    }
  }
}

async function renderPage(p) {
  if (!p || p.rendered === state.zoom) return;
  const z = state.zoom;
  renderTasks.get(p.index)?.cancel();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = p.page.getViewport({ scale: z * dpr });
  const off = document.createElement('canvas');
  off.width = Math.floor(viewport.width);
  off.height = Math.floor(viewport.height);
  const task = p.page.render({
    canvas: off,
    viewport,
    annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS, // form widgets are drawn by our own inputs
  });
  renderTasks.set(p.index, task);
  try {
    await task.promise;
    // Swap in only when complete to avoid a blank flash while zooming.
    p.canvas.width = off.width;
    p.canvas.height = off.height;
    p.canvas.getContext('2d').drawImage(off, 0, 0);
    p.rendered = z;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.error(err);
  } finally {
    if (renderTasks.get(p.index) === task) renderTasks.delete(p.index);
  }
}

// Render a page to a canvas at a given scale (used for the encrypted-PDF fallback).
export async function rasterizePage(p, scale) {
  const viewport = p.page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await p.page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
  return canvas;
}
