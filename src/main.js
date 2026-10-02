import '@fontsource-variable/inter';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './style.css';
import {
  state, defaults, groupOf, uid, getAnnot, subscribe, emit, commit, undo, redo, canUndo, canRedo, resetHistory,
} from './state.js';
import { FONTS, loadWebFonts } from './fonts.js';
import { initOverlay, setupLayer, renderAll, startEditing } from './overlay.js';
import { openSignatureDialog, readFileAsDataUrl, loadImage } from './signature.js';
import { icons } from './icons.js';
import { translate, bbox } from './shapes.js';

const $ = (sel) => document.querySelector(sel);

// The PDF engines are big, so they load only once someone opens a file.
let viewerMod = null;
const loadViewer = async () => (viewerMod ||= await import('./viewer.js'));
const applyZoom = () => viewerMod?.applyZoom();

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
  { id: 'select', label: 'Select', key: 'v' },
  { sep: true },
  { id: 'text', label: 'Text', key: 't' },
  { id: 'date', label: 'Date', key: 'd' },
  { sep: true },
  { id: 'check', label: 'Tick', key: 'k' },
  { id: 'cross', label: 'Cross', key: 'x' },
  { id: 'dot', label: 'Dot', key: 'o' },
  { sep: true },
  { id: 'rect', label: 'Box', key: 'r' },
  { id: 'ellipse', label: 'Circle', key: 'e' },
  { id: 'line', label: 'Line', key: 'l' },
  { id: 'arrow', label: 'Arrow', key: 'a' },
  { sep: true },
  { id: 'pen', label: 'Draw', key: 'p' },
  { id: 'highlight', label: 'Highlight', key: 'h' },
  { id: 'whiteout', label: 'Whiteout', key: 'w' },
  { sep: true },
  { id: 'image', label: 'Image', key: 'i', action: true },
  { id: 'signature', label: 'Sign', key: 's', action: true },
  { id: 'initials', label: 'Initials', key: 'n', action: true },
];

const HINTS = {
  select: 'Click an item to select it. Drag to move, use the handles to resize. Double-click text to edit.',
  text: 'Click anywhere to type. Click text to edit it, or drag it to move. While typing, drag the blue grip.',
  date: "Click to stamp today's date.",
  check: 'Click on a box to tick it.',
  cross: 'Click on a box to mark it with a cross.',
  dot: 'Click inside a circle to fill a radio choice.',
  rect: 'Drag to draw a box. Hold Shift for a square.',
  ellipse: 'Drag to draw a circle or ellipse. Hold Shift for a perfect circle.',
  line: 'Drag to draw a line. Hold Shift to snap angles.',
  arrow: 'Drag to draw an arrow. Hold Shift to snap angles.',
  pen: 'Draw freehand on the page.',
  highlight: 'Drag over text to highlight it.',
  whiteout: 'Drag to cover content with a white box.',
};

function buildToolbar() {
  const bar = $('#toolbar');
  bar.innerHTML = '';
  for (const t of TOOLS) {
    if (t.sep) {
      bar.append(Object.assign(document.createElement('div'), { className: 'tool-sep' }));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.id;
    b.title = `${t.label} (${t.key.toUpperCase()})`;
    b.innerHTML = `${icons[t.id]}<span>${t.label}</span>`;
    b.onclick = () => activateTool(t.id);
    bar.append(b);
  }
}

function activateTool(id) {
  if (id === 'image') return pickImage();
  if (id === 'signature' || id === 'initials') return addSignature(id);
  setTool(id);
}

function setTool(id) {
  if (state.editingId) document.activeElement?.blur();
  state.tool = id;
  if (id !== 'select') state.selectedId = null;
  if (state.pending && id !== 'place') state.pending = null;
  document.body.dataset.tool = id;
  emit();
}

async function pickImage() {
  const input = $('#image-input');
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      await placeImage(await readFileAsDataUrl(file), 'image');
    } catch {
      toast('That image could not be read.');
    }
  };
  input.click();
}

async function addSignature(kind) {
  const res = await openSignatureDialog(kind);
  if (res) await placeImage(res.dataUrl, kind);
}

// Normalise to PNG/JPEG (the formats PDFs support) and arm click-to-place.
async function placeImage(dataUrl, kind) {
  const img = await loadImage(dataUrl);
  let mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    dataUrl = c.toDataURL('image/png');
    mime = 'image/png';
  }
  const assetId = uid();
  state.assets.set(assetId, { dataUrl, mime, width: img.width, height: img.height });
  const ratio = img.width / img.height;
  let w, h;
  if (kind === 'signature') {
    h = 42; w = h * ratio;
    if (w > 200) { w = 200; h = w / ratio; }
  } else if (kind === 'initials') {
    h = 30; w = h * ratio;
    if (w > 90) { w = 90; h = w / ratio; }
  } else {
    w = Math.min(220, img.width * 0.75); h = w / ratio;
  }
  setTool('place');
  state.pending = { assetId, w, h, kind };
  emit();
  toast(`Click on the page to place your ${kind}. Press Esc to cancel.`);
}

// ---------------------------------------------------------------------------
// Property bar
// ---------------------------------------------------------------------------
let propKey = '';

function propTarget() {
  const a = getAnnot(state.selectedId);
  if (a) return { a, type: a.type, g: groupOf(a.type), src: a };
  const g = groupOf(state.tool);
  if (defaults[g] && state.tool !== 'select') return { a: null, type: state.tool, g, src: defaults[g] };
  return null;
}

function setProp(key, value, final = true) {
  const t = propTarget();
  if (!t) return;
  if (t.a) {
    if (t.g === 'mark' && key === 'size') {
      const cx = t.a.x + t.a.w / 2, cy = t.a.y + t.a.h / 2;
      Object.assign(t.a, { w: value, h: value, x: cx - value / 2, y: cy - value / 2 });
    } else {
      t.a[key] = value;
    }
  }
  if (defaults[t.g]) defaults[t.g][key] = value;
  if (key === 'font' && !FONTS[value].italic) {
    if (t.a) t.a.italic = false;
    defaults.text.italic = false;
  }
  if (t.a && final) commit();
  else emit();
}

function control(html) {
  const d = document.createElement('div');
  d.className = 'prop';
  d.innerHTML = html;
  return d;
}

const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
const CHECK = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const BASIC_COLORS = [
  { name: 'Black', value: '#111111' },
  { name: 'Gray', value: '#6b7280' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Purple', value: '#7c3aed' },
];

// ---- popover (menus are attached to <body> so the scrollable bar can't clip them) ----
let openPop = null;

function closePopover() {
  if (!openPop) return;
  const { el, anchor, onDoc, onKey } = openPop;
  openPop = null;
  el.remove();
  anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onDoc, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', closePopover);
  $('#viewer').removeEventListener('scroll', closePopover);
}

function openPopover(anchor, el, keyHandler) {
  closePopover();
  el.classList.add('popover');
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - el.offsetWidth - 8);
  let top = r.bottom + 6;
  if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - el.offsetHeight - 6);
  Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  // Clicking menu buttons must not steal focus from text being edited.
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  const onDoc = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
      return;
    }
    keyHandler?.(e);
  };
  document.addEventListener('pointerdown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closePopover);
  $('#viewer').addEventListener('scroll', closePopover);
  anchor.setAttribute('aria-expanded', 'true');
  openPop = { el, anchor, onDoc, onKey };
}

const togglePopover = (anchor, build) => (openPop?.anchor === anchor ? closePopover() : build());

// ---- font menu: every option is previewed in its own typeface ----
function fontControl() {
  const c = control(`<button type="button" class="font-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Font">
    <span class="font-btn-name"></span><span class="font-btn-cat"></span>${CHEVRON}</button>`);
  const btn = c.querySelector('button');
  btn._sync = (src) => {
    const f = FONTS[src.font] || FONTS.helvetica;
    const name = btn.querySelector('.font-btn-name');
    name.textContent = f.label;
    name.style.fontFamily = f.css;
    btn.querySelector('.font-btn-cat').textContent = f.category;
  };
  btn.onclick = (e) =>
    togglePopover(btn, () => {
      const current = propTarget()?.src.font;
      const list = document.createElement('div');
      list.className = 'font-menu';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Font');
      for (const [id, f] of Object.entries(FONTS)) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'font-opt';
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', id === current);
        opt.innerHTML = `<span class="font-opt-name" style="font-family:${f.css.replace(/"/g, "'")}">${f.label}</span>
          <span class="font-opt-sample" style="font-family:${f.css.replace(/"/g, "'")}">Aa Bb 123</span>
          <span class="font-opt-cat">${f.category}</span>${CHECK}`;
        opt.onclick = () => {
          setProp('font', id);
          closePopover();
        };
        list.append(opt);
      }
      openPopover(btn, list, (ev) => {
        const opts = [...list.querySelectorAll('.font-opt')];
        const i = opts.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const next = i < 0 ? 0 : (i + (ev.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
          opts[next].focus();
        }
      });
      // Only move focus into the menu when it was opened from the keyboard.
      if (e.detail === 0) (list.querySelector('[aria-selected="true"]') || list.firstChild).focus();
    });
  return c;
}

// ---- color menu: 7 basic colors + any custom color ----
function colorControl(label, key) {
  const c = control(`<button type="button" class="color-btn" aria-haspopup="true" aria-expanded="false" title="${label}">
    <span class="color-chip"></span><span class="color-btn-label">${label}</span>${CHEVRON}</button>`);
  const btn = c.querySelector('button');
  btn._sync = (src) => (btn.querySelector('.color-chip').style.background = src[key]);
  btn.onclick = () =>
    togglePopover(btn, () => {
      const current = String(propTarget()?.src[key] || '#000000').toLowerCase();
      const menu = document.createElement('div');
      menu.className = 'color-menu';
      menu.innerHTML = `<div class="pop-title">${label}</div>
        <div class="color-grid">${BASIC_COLORS.map((col) => `<button type="button" class="swatch lg" data-color="${col.value}"
          style="background:${col.value}" title="${col.name}" aria-label="${col.name}"
          aria-pressed="${col.value === current}"></button>`).join('')}</div>
        <div class="pop-sep"></div>
        <div class="custom-row">
          <label class="rainbow" title="Pick any color"><input type="color" value="${current}" aria-label="Custom color"></label>
          <div class="custom-text"><span>Custom</span><input class="hex" value="${current}" maxlength="7" spellcheck="false" aria-label="Hex color"></div>
        </div>`;
      const pick = menu.querySelector('input[type=color]');
      const hexIn = menu.querySelector('.hex');
      const mark = (v) => menu.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === v));
      menu.querySelectorAll('[data-color]').forEach((b) => {
        b.onclick = () => {
          setProp(key, b.dataset.color);
          pick.value = hexIn.value = b.dataset.color;
          mark(b.dataset.color);
        };
      });
      pick.oninput = () => {
        hexIn.value = pick.value;
        mark(pick.value);
        setProp(key, pick.value, false);
      };
      pick.onchange = () => setProp(key, pick.value, true);
      hexIn.onchange = () => {
        let v = hexIn.value.trim().toLowerCase();
        if (!v.startsWith('#')) v = `#${v}`;
        if (/^#[0-9a-f]{3}$/.test(v)) v = `#${[...v.slice(1)].map((ch) => ch + ch).join('')}`;
        if (!/^#[0-9a-f]{6}$/.test(v)) {
          hexIn.value = pick.value;
          return;
        }
        pick.value = hexIn.value = v;
        mark(v);
        setProp(key, v, true);
      };
      openPopover(btn, menu);
    });
  return c;
}

// ---- stepper: the same −/value/+ control for every numeric property ----
function stepperControl(label, key, { min, max, step, unit = 'pt', scale = 1 }) {
  const c = control(`${label ? `<span class="prop-label">${label}</span>` : ''}
    <div class="stepper" role="group" aria-label="${label || key}">
      <button type="button" class="icon-btn sm" data-dir="-1" aria-label="Decrease ${label || key}">${icons.minus}</button>
      <span class="stepper-val"><input type="text" inputmode="decimal" aria-label="${label || key}">${unit ? `<i>${unit}</i>` : ''}</span>
      <button type="button" class="icon-btn sm" data-dir="1" aria-label="Increase ${label || key}">${icons.plus}</button>
    </div>`);
  const input = c.querySelector('input');
  const clampV = (v) => Math.min(max, Math.max(min, v));
  const show = (v) => String(Math.round(v * scale * 10) / 10);
  const current = () => {
    const t = propTarget();
    return t ? (t.g === 'mark' && key === 'size' && t.a ? Math.round(t.a.w) : t.src[key]) : min;
  };
  input._sync = (src) => {
    if (document.activeElement !== input) input.value = show(src[key]);
  };
  input.onchange = () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) setProp(key, clampV(v / scale));
    input.value = show(current());
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
  };

  // Click to step once; press and hold to keep stepping.
  for (const b of c.querySelectorAll('[data-dir]')) {
    let timer = null;
    const stepOnce = (final) => {
      const raw = current() * scale + +b.dataset.dir * step;
      const next = clampV(Math.round(raw / step) * step / scale);
      setProp(key, next, final);
      input.value = show(next);
    };
    const stop = () => {
      if (!timer) return;
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
      setProp(key, current(), true); // one undo step for the whole hold
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      stepOnce(false);
      timer = setTimeout(() => (timer = setInterval(() => stepOnce(false), 70)), 380);
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        stepOnce(true);
      }
    });
  }
  return c;
}

const opacityStepper = () => stepperControl('Opacity', 'opacity', { min: 0.1, max: 1, step: 10, unit: '%', scale: 100 });

function buildPropbar() {
  const bar = $('#propbar');
  const t = propTarget();
  const key = t ? `${t.a ? t.a.id : 'tool'}:${t.type}` : `none:${state.tool}`;
  if (key === propKey) return syncProps();
  propKey = key;
  closePopover();
  bar.innerHTML = '';

  if (!t || t.g === 'image' && !t.a) {
    const hint = HINTS[state.tool] || (state.pending ? 'Click on the page to place it. Esc to cancel.' : HINTS.select);
    bar.append(control(`<span class="hint">${hint}</span>`));
    return;
  }

  const { g } = t;
  if (g === 'text') {
    bar.append(fontControl());
    bar.append(stepperControl('', 'size', { min: 4, max: 144, step: 1, unit: '' }));
    const style = control(`<button class="icon-btn toggle" data-toggle="bold" title="Bold" aria-label="Bold">${icons.bold}</button>
      <button class="icon-btn toggle" data-toggle="italic" title="Italic" aria-label="Italic">${icons.italic}</button>`);
    style.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = () => setProp(b.dataset.toggle, !propTarget().src[b.dataset.toggle]);
    });
    bar.append(style, colorControl('Color', 'color'));
  } else if (g === 'shape') {
    bar.append(colorControl('Stroke', 'stroke'));
    bar.append(stepperControl('Width', 'strokeWidth', { min: 0, max: 20, step: 0.5 }));
    const fill = control(`<label class="check-label"><input type="checkbox" data-prop="fillOn"> Fill</label>`);
    fill.querySelector('input').onchange = (e) => setProp('fillOn', e.target.checked);
    bar.append(fill, colorControl('Fill color', 'fill'));
    bar.append(opacityStepper());
  } else if (g === 'line' || g === 'pen') {
    bar.append(colorControl('Color', 'stroke'));
    bar.append(stepperControl('Width', 'strokeWidth', { min: 0.5, max: 20, step: 0.5 }));
    bar.append(opacityStepper());
  } else if (g === 'mark') {
    bar.append(colorControl('Color', 'color'));
    bar.append(stepperControl('Size', 'size', { min: 6, max: 72, step: 1 }));
  } else if (g === 'highlight' || g === 'whiteout') {
    const presets = g === 'highlight' ? ['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74'] : ['#ffffff', '#f3f4f6', '#000000'];
    const sw = control(presets.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join(''));
    sw.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => setProp('color', b.dataset.color)));
    bar.append(sw, colorControl('Custom', 'color'));
  } else if (g === 'image') {
    bar.append(opacityStepper());
  }

  if (t.a) {
    bar.append(Object.assign(document.createElement('div'), { className: 'spacer' }));
    const acts = control(`
      <button class="icon-btn" data-act="front" title="Bring to front" aria-label="Bring to front">${icons.front}</button>
      <button class="icon-btn" data-act="back" title="Send to back" aria-label="Send to back">${icons.back}</button>
      <button class="icon-btn" data-act="dup" title="Duplicate (Ctrl+D)" aria-label="Duplicate">${icons.copy}</button>
      <button class="icon-btn danger" data-act="del" title="Delete (Del)" aria-label="Delete">${icons.trash}</button>`);
    acts.querySelector('[data-act=front]').onclick = () => reorder(1);
    acts.querySelector('[data-act=back]').onclick = () => reorder(-1);
    acts.querySelector('[data-act=dup]').onclick = duplicateSelected;
    acts.querySelector('[data-act=del]').onclick = deleteSelected;
    bar.append(acts);
  }
  syncProps();
}

function syncProps() {
  const t = propTarget();
  if (!t) return;
  const src = { ...t.src };
  if (t.g === 'mark' && t.a) src.size = Math.round(t.a.w);
  const bar = $('#propbar');
  for (const el of bar.querySelectorAll('.font-btn, .color-btn, .stepper input')) el._sync?.(src);
  for (const el of bar.querySelectorAll('[data-prop]')) {
    if (el.type === 'checkbox') el.checked = !!src[el.dataset.prop];
  }
  for (const b of bar.querySelectorAll('[data-toggle]')) {
    b.setAttribute('aria-pressed', !!src[b.dataset.toggle]);
    if (b.dataset.toggle === 'italic') b.disabled = !(FONTS[src.font] || FONTS.helvetica).italic;
  }
  for (const b of bar.querySelectorAll('[data-color]')) {
    b.setAttribute('aria-pressed', b.dataset.color.toLowerCase() === String(src.color).toLowerCase());
  }
}

// ---------------------------------------------------------------------------
// Selection actions
// ---------------------------------------------------------------------------
function deleteSelected() {
  if (!state.selectedId) return;
  state.annotations = state.annotations.filter((a) => a.id !== state.selectedId);
  state.selectedId = null;
  commit();
}

function duplicateSelected() {
  const a = getAnnot(state.selectedId);
  if (!a) return;
  const copy = { ...structuredClone(a), id: uid() };
  const p = state.pages[a.page];
  const b = bbox(a);
  const off = b.x + b.w + 12 < p.width ? 12 : -12;
  translate(copy, off, b.y + b.h + 12 < p.height ? 12 : -12);
  state.annotations.push(copy);
  state.selectedId = copy.id;
  commit();
}

function reorder(dir) {
  const i = state.annotations.findIndex((a) => a.id === state.selectedId);
  if (i < 0) return;
  const [a] = state.annotations.splice(i, 1);
  if (dir > 0) state.annotations.push(a);
  else state.annotations.unshift(a);
  commit();
}

function nudge(dx, dy) {
  const a = getAnnot(state.selectedId);
  if (!a) return;
  translate(a, dx, dy);
  commit();
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function setZoom(z) {
  state.zoom = Math.min(3, Math.max(0.3, Math.round(z * 100) / 100));
  $('#zoom-val').textContent = `${Math.round(state.zoom * 100)}%`;
  applyZoom();
}

function stepZoom(dir) {
  const z = state.zoom;
  const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) : [...ZOOMS].reverse().find((v) => v < z - 0.001);
  if (next) zoomKeepingCenter(next);
}

function zoomKeepingCenter(z) {
  const v = $('#viewer');
  const ratio = (v.scrollTop + v.clientHeight / 2) / v.scrollHeight;
  setZoom(z);
  v.scrollTop = ratio * v.scrollHeight - v.clientHeight / 2;
}

function fitWidth() {
  const v = $('#viewer');
  const maxW = Math.max(...state.pages.map((p) => p.width));
  const avail = v.clientWidth - (window.innerWidth < 720 ? 24 : 64);
  setZoom(Math.min(1.6, avail / maxW));
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
async function loadFile(bytes, name) {
  if (state.dirty && !confirm('Open a new file? Your unsaved changes to the current PDF will be lost.')) return;
  setBusy(true, 'Opening PDF…');
  try {
    const { openPdf } = await loadViewer();
    await openPdf(bytes, (retry) =>
      prompt(retry ? 'Wrong password. Try again:' : 'This PDF is password-protected. Enter the password:')
    );
  } catch (err) {
    setBusy(false);
    console.error(err);
    toast(err?.name === 'PasswordException' ? 'Could not open: password required.' : 'That file could not be opened as a PDF.');
    return;
  }
  state.bytes = bytes;
  state.fileName = name;
  state.annotations = [];
  state.assets.clear();
  state.selectedId = state.editingId = state.pending = null;
  state.dirty = false;
  state.flatten = false;
  $('#flatten').checked = false;
  resetHistory();
  document.body.classList.add('has-doc');
  $('#file-name').textContent = name;
  $('#file-name').title = name;
  $('#flatten-wrap').hidden = !state.formFields.length;
  viewerMod.buildPageDom($('#pages'), setupLayer);
  fitWidth();
  $('#viewer').scrollTop = 0;
  setTool(state.formFields.length ? 'select' : 'text');
  setBusy(false);
  if (state.formFields.length) {
    toast(`This PDF has ${new Set(state.formFields.map((f) => f.name)).size} fillable fields — just click and type.`);
  }
}

async function loadFromFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    toast('Please choose a PDF file.');
    return;
  }
  await loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
}

async function download() {
  if (!state.bytes) return;
  if (state.editingId) document.activeElement?.blur();
  if (document.activeElement?.classList.contains('form-field')) document.activeElement.blur();
  setBusy(true, 'Preparing your PDF…');
  try {
    const { exportPdf } = await import('./exporter.js');
    const out = await exportPdf();
    const blob = new Blob([out], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.fileName.replace(/\.pdf$/i, '') || 'document'}-edited.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    state.dirty = false;
    toast('Done! Your edited PDF has been downloaded.');
  } catch (err) {
    console.error(err);
    toast('Sorry, something went wrong while saving this PDF.');
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

function setBusy(busy, msg) {
  document.body.classList.toggle('busy', busy);
  $('#btn-download').disabled = busy;
  if (busy && msg) toast(msg);
}

function render() {
  renderAll();
  buildPropbar();
  for (const b of document.querySelectorAll('.tool')) {
    const id = b.dataset.tool;
    const active = state.tool === id || (state.pending && state.pending.kind === id);
    b.setAttribute('aria-pressed', !!active);
  }
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function onKey(e) {
  if (!state.bytes) return;
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    download();
    return;
  }
  if (typing || $('#sig-dialog').open) return;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  if (mod && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    stepZoom(1);
    return;
  }
  if (mod && e.key === '-') {
    e.preventDefault();
    stepZoom(-1);
    return;
  }
  if (mod) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedId) {
      e.preventDefault();
      deleteSelected();
    }
    return;
  }
  if (e.key === 'Escape') {
    if (state.pending || state.tool !== 'select') setTool('select');
    else if (state.selectedId) {
      state.selectedId = null;
      emit();
    }
    return;
  }
  if (e.key === 'Enter' && getAnnot(state.selectedId)?.type === 'text') {
    e.preventDefault();
    startEditing(state.selectedId);
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && state.selectedId) {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1;
    nudge(arrows[e.key][0] * s, arrows[e.key][1] * s);
    return;
  }
  const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
  if (tool) activateTool(tool.id);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
  for (const el of document.querySelectorAll('[data-icon]')) {
    el.insertAdjacentHTML('afterbegin', icons[el.dataset.icon] || '');
  }
  buildToolbar();
  initOverlay({ setTool, toast });
  subscribe(render);

  $('#file-input').onchange = (e) => loadFromFile(e.target.files[0]);
  $('#btn-open').onclick = () => {
    $('#file-input').value = '';
    $('#file-input').click();
  };
  $('#btn-sample').onclick = async () => {
    setBusy(true, 'Preparing sample…');
    const { createSamplePdf } = await import('./sample.js');
    setBusy(false);
    loadFile(await createSamplePdf(), 'sample-form.pdf');
  };
  $('#btn-download').onclick = download;
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-zoom-in').onclick = () => stepZoom(1);
  $('#btn-zoom-out').onclick = () => stepZoom(-1);
  $('#zoom-val').onclick = fitWidth;
  $('#flatten').onchange = (e) => (state.flatten = e.target.checked);
  // Pressing toolbar-style buttons shouldn't end the text edit in progress.
  $('#propbar').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  document.addEventListener('keydown', onKey);

  // Drag & drop a PDF anywhere.
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    loadFromFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) e.preventDefault();
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.bytes && window.innerWidth < 720 && fitWidth(), 200);
  });

  loadWebFonts().then(() => state.bytes && renderAll());
  render();
}

init();
