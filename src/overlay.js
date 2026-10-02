import { state, defaults, groupOf, uid, getAnnot, commit, emit } from './state.js';
import { FONTS } from './fonts.js';
import { bbox, translate, pathFor, paintFor, normalizePen, VECTOR_TYPES, KEEP_RATIO } from './shapes.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DRAG_TOOLS = new Set(['rect', 'ellipse', 'line', 'arrow', 'highlight', 'whiteout']);
const MARK_TOOLS = new Set(['check', 'cross', 'dot']);
// Tools that stay active after use (handy for filling many fields in a row).
const STICKY_TOOLS = new Set(['text', 'check', 'cross', 'dot', 'pen', 'highlight', 'whiteout']);

let hooks = { setTool: () => {}, toast: () => {} };
export function initOverlay(h) {
  hooks = { ...hooks, ...h };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

const pageOf = (i) => state.pages[i];
function layerPoint(layer, e) {
  const r = layer.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
}
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ---------------------------------------------------------------------------
// Layer setup
// ---------------------------------------------------------------------------
export function setupLayer(p) {
  p.layer.addEventListener('pointerdown', (e) => onLayerDown(e, p));
  p.layer.addEventListener('pointermove', (e) => onLayerHover(e, p));
  p.layer.addEventListener('pointerleave', () => ghost?.remove());
  buildFormInputs(p);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
export function renderAll() {
  for (const p of state.pages) if (p.layer) renderLayer(p);
}

function renderLayer(p) {
  const layer = p.layer;
  const annots = state.annotations.filter((a) => a.page === p.index);
  const keep = new Set(annots.map((a) => a.id));
  for (const el of [...layer.querySelectorAll(':scope > .annot')]) {
    if (!keep.has(el.dataset.id)) el.remove();
  }
  annots.forEach((a, i) => {
    let el = layer.querySelector(`:scope > .annot[data-id="${a.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = `annot annot-${a.type}`;
      el.dataset.id = a.id;
      el.addEventListener('pointerdown', (e) => onAnnotDown(e, a.id));
      el.addEventListener('dblclick', () => {
        const an = getAnnot(a.id);
        if (an?.type === 'text') startEditing(an.id);
      });
      layer.append(el);
    }
    el.style.zIndex = 10 + i;
    updateEl(el, a);
  });
  renderSelection(p);
  if (state.pending) layer.classList.add('placing');
  else layer.classList.remove('placing');
}

function updateEl(el, a) {
  el.classList.toggle('selected', a.id === state.selectedId);
  if (a.type === 'text') {
    const f = FONTS[a.font] || FONTS.helvetica;
    Object.assign(el.style, {
      left: `${a.x}px`, top: `${a.y}px`,
      fontFamily: f.css, fontSize: `${a.size}px`, color: a.color,
      fontWeight: a.bold ? '700' : '400', fontStyle: a.italic && f.italic ? 'italic' : 'normal',
    });
    const editing = state.editingId === a.id;
    el.classList.toggle('editing', editing);
    if (!editing && el.textContent !== a.text) el.textContent = a.text;
    if (!editing) el.contentEditable = 'false';
    measureText(el, a);
    return;
  }
  if (a.type === 'image') {
    const asset = state.assets.get(a.assetId);
    Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${a.w}px`, height: `${a.h}px`, opacity: a.opacity ?? 1 });
    let img = el.firstChild;
    if (!img) {
      img = document.createElement('img');
      img.draggable = false;
      el.append(img);
    }
    if (asset && img.src !== asset.dataUrl) img.src = asset.dataUrl;
    return;
  }
  if (VECTOR_TYPES.has(a.type)) {
    const p = paintFor(a);
    const b = bbox(a);
    const pad = (p.stroke ? p.strokeWidth / 2 : 0) + 4;
    const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    let svg = el.firstChild;
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.append(document.createElementNS(SVGNS, 'path'));
      el.append(svg);
    }
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    const path = svg.firstChild;
    path.setAttribute('d', pathFor(a));
    path.setAttribute('fill', p.fill || 'none');
    path.setAttribute('stroke', p.stroke || 'none');
    path.setAttribute('stroke-width', p.stroke ? p.strokeWidth : 0);
    path.setAttribute('opacity', p.opacity);
    el.style.mixBlendMode = p.multiply ? 'multiply' : '';
  }
}

function measureText(el, a) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (w && h) {
    a.w = w;
    a.h = h;
  }
}

function renderSelection(p) {
  p.layer.querySelector(':scope > .sel')?.remove();
  const a = getAnnot(state.selectedId);
  if (!a || a.page !== p.index) return;
  if (state.editingId === a.id) {
    p.layer.append(makeTextGrip(a));
    return;
  }
  const sel = document.createElement('div');
  sel.className = 'sel';
  sel.style.zIndex = 1000;
  if (a.type === 'line' || a.type === 'arrow') {
    for (const [name, x, y] of [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]]) {
      sel.append(makeHandle(name, x, y, a.id));
    }
  } else {
    const b = bbox(a);
    const frame = document.createElement('div');
    frame.className = 'sel-frame';
    Object.assign(frame.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    sel.append(frame);
    if (a.type !== 'text') {
      const corners = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
      const edges = [['n', 0.5, 0], ['s', 0.5, 1], ['w', 0, 0.5], ['e', 1, 0.5]];
      const hs = KEEP_RATIO.has(a.type) ? corners : [...corners, ...edges];
      for (const [name, fx, fy] of hs) sel.append(makeHandle(name, b.x + b.w * fx, b.y + b.h * fy, a.id));
    }
  }
  p.layer.append(sel);
}

function makeTextGrip(a) {
  const wrap = document.createElement('div');
  wrap.className = 'sel';
  wrap.style.zIndex = 1000;
  const grip = document.createElement('div');
  grip.className = 'text-grip';
  grip.title = 'Drag to move';
  grip.innerHTML = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
  Object.assign(grip.style, { left: `${a.x}px`, top: `${a.y}px`, height: `${Math.max(a.h, a.size * 1.2)}px` });
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // keeps focus (and the caret) in the text being edited
    const an = getAnnot(a.id);
    drag = { kind: 'move', id: a.id, orig: structuredClone(an), start: layerPoint(pageOf(an.page).layer, e), moved: false };
  });
  wrap.append(grip);
  return wrap;
}

function makeHandle(name, x, y, id) {
  const h = document.createElement('div');
  h.className = `handle handle-${name}`;
  h.style.left = `${x}px`;
  h.style.top = `${y}px`;
  h.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const a = getAnnot(id);
    drag = { kind: 'resize', handle: name, id, orig: structuredClone(a), start: layerPoint(pageOf(a.page).layer, e) };
  });
  return h;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
let drag = null;
let ghost = null;

function onLayerHover(e, p) {
  if (!state.pending) return;
  const pt = layerPoint(p.layer, e);
  if (!ghost) {
    ghost = document.createElement('img');
    ghost.className = 'place-ghost';
  }
  const asset = state.assets.get(state.pending.assetId);
  if (ghost.src !== asset.dataUrl) ghost.src = asset.dataUrl;
  if (ghost.parentNode !== p.layer) p.layer.append(ghost);
  Object.assign(ghost.style, {
    left: `${pt.x - state.pending.w / 2}px`, top: `${pt.y - state.pending.h / 2}px`,
    width: `${state.pending.w}px`, height: `${state.pending.h}px`,
  });
}

function onLayerDown(e, p) {
  if (e.button !== 0) return;
  if (e.target.closest('.form-field')) return;
  const pt = layerPoint(p.layer, e);

  // Clicking empty space while editing text just finishes editing.
  if (state.editingId) {
    document.activeElement?.blur();
    return;
  }

  if (state.pending) {
    const { assetId, w, h } = state.pending;
    const a = {
      id: uid(), page: p.index, type: 'image', assetId,
      x: clamp(pt.x - w / 2, 0, p.width - w), y: clamp(pt.y - h / 2, 0, p.height - h), w, h, opacity: 1,
    };
    state.annotations.push(a);
    state.pending = null;
    ghost?.remove();
    state.selectedId = a.id;
    hooks.setTool('select');
    commit();
    return;
  }

  const tool = state.tool;
  if (tool === 'select') {
    if (state.selectedId) {
      state.selectedId = null;
      emit();
    }
    return;
  }
  e.preventDefault();

  if (tool === 'text' || tool === 'date') {
    const d = defaults.text;
    const text = tool === 'date' ? new Date().toLocaleDateString() : '';
    const a = {
      id: uid(), page: p.index, type: 'text', x: pt.x, y: Math.max(0, pt.y - d.size * 0.6),
      w: 0, h: 0, text, ...d,
    };
    state.annotations.push(a);
    if (tool === 'date') {
      state.selectedId = a.id;
      hooks.setTool('select');
      commit();
    } else {
      startEditing(a.id);
    }
    return;
  }

  if (MARK_TOOLS.has(tool)) {
    const s = defaults.mark.size;
    const a = {
      id: uid(), page: p.index, type: tool, x: pt.x - s / 2, y: pt.y - s / 2, w: s, h: s,
      color: defaults.mark.color,
    };
    state.annotations.push(a);
    state.selectedId = a.id;
    commit();
    return;
  }

  if (tool === 'pen') {
    drag = { kind: 'pen', page: p, points: [[pt.x, pt.y]] };
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.classList.add('pen-preview');
    svg.setAttribute('viewBox', `0 0 ${p.width} ${p.height}`);
    const path = document.createElementNS(SVGNS, 'path');
    const d = defaults.pen;
    Object.entries({ fill: 'none', stroke: d.stroke, 'stroke-width': d.strokeWidth, opacity: d.opacity }).forEach(([k, v]) =>
      path.setAttribute(k, v)
    );
    svg.append(path);
    p.layer.append(svg);
    drag.svg = svg;
    return;
  }

  if (DRAG_TOOLS.has(tool)) {
    const g = groupOf(tool);
    const a = { id: uid(), page: p.index, type: tool, ...structuredClone(defaults[g]) };
    if (tool === 'line' || tool === 'arrow') Object.assign(a, { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    else Object.assign(a, { x: pt.x, y: pt.y, w: 0, h: 0 });
    state.annotations.push(a);
    state.selectedId = a.id;
    drag = { kind: 'create', id: a.id, start: pt, page: p };
    emit();
  }
}

function onAnnotDown(e, id) {
  if (e.button !== 0) return;
  const a = getAnnot(id);
  if (!a) return;
  if (state.editingId === id) {
    e.stopPropagation(); // let the caret move inside the text
    return;
  }
  if (state.pending) return; // let the layer handle placement
  // Drawing tools draw on top of existing items instead of selecting them.
  const editsText = state.tool === 'text' && a.type === 'text';
  if (state.tool !== 'select' && !editsText) return;
  e.stopPropagation();
  e.preventDefault();
  if (state.editingId) document.activeElement?.blur();
  const wasSelected = state.selectedId === id;
  state.selectedId = id;
  const p = pageOf(a.page);
  drag = {
    kind: 'move', id, orig: structuredClone(a), start: layerPoint(p.layer, e), moved: false,
    // With the Text tool a plain click edits; with Select, a click on an already-selected text does.
    editOnClick: editsText || (a.type === 'text' && wasSelected),
  };
  emit();
}

function onMove(e) {
  if (!drag) return;
  if (drag.kind === 'pen') {
    const pt = layerPoint(drag.page.layer, e);
    drag.points.push([clamp(pt.x, 0, drag.page.width), clamp(pt.y, 0, drag.page.height)]);
    drag.svg.firstChild.setAttribute('d', drag.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''));
    return;
  }
  const a = getAnnot(drag.id);
  if (!a) return;
  const p = pageOf(a.page);
  const pt = layerPoint(p.layer, e);
  pt.x = clamp(pt.x, 0, p.width);
  pt.y = clamp(pt.y, 0, p.height);

  if (drag.kind === 'create') {
    const s = drag.start;
    if (a.type === 'line' || a.type === 'arrow') {
      let { x, y } = pt;
      if (e.shiftKey) {
        // Snap to 45° increments.
        const ang = Math.round(Math.atan2(y - s.y, x - s.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x - s.x, y - s.y);
        x = s.x + len * Math.cos(ang);
        y = s.y + len * Math.sin(ang);
      }
      a.x2 = x;
      a.y2 = y;
    } else {
      let w = pt.x - s.x;
      let h = pt.y - s.y;
      if (e.shiftKey) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * m;
        h = Math.sign(h || 1) * m;
      }
      a.x = Math.min(s.x, s.x + w);
      a.y = Math.min(s.y, s.y + h);
      a.w = Math.abs(w);
      a.h = Math.abs(h);
    }
    renderLayer(p);
    return;
  }

  const dx = pt.x - drag.start.x;
  const dy = pt.y - drag.start.y;
  if (drag.kind === 'move') {
    if (!drag.moved && Math.hypot(dx, dy) * state.zoom < 3) return;
    drag.moved = true;
    Object.assign(a, structuredClone(drag.orig));
    const b = bbox(drag.orig);
    const cdx = clamp(dx, -b.x, p.width - b.x - b.w);
    const cdy = clamp(dy, -b.y, p.height - b.y - b.h);
    translate(a, cdx, cdy);
    renderLayer(p);
    return;
  }

  if (drag.kind === 'resize') {
    const o = drag.orig;
    const hnd = drag.handle;
    if (hnd === 'p1' || hnd === 'p2') {
      a[hnd === 'p1' ? 'x1' : 'x2'] = pt.x;
      a[hnd === 'p1' ? 'y1' : 'y2'] = pt.y;
      renderLayer(p);
      return;
    }
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (hnd.includes('w')) x1 = Math.min(o.x + dx, x2 - 4);
    if (hnd.includes('e')) x2 = Math.max(o.x + o.w + dx, x1 + 4);
    if (hnd.includes('n')) y1 = Math.min(o.y + dy, y2 - 4);
    if (hnd.includes('s')) y2 = Math.max(o.y + o.h + dy, y1 + 4);
    if (KEEP_RATIO.has(a.type) || e.shiftKey) {
      const ratio = o.w / o.h;
      let w = x2 - x1;
      let h = y2 - y1;
      if (w / h > ratio) h = w / ratio;
      else w = h * ratio;
      if (hnd.includes('w')) x1 = x2 - w; else x2 = x1 + w;
      if (hnd.includes('n')) y1 = y2 - h; else y2 = y1 + h;
    }
    Object.assign(a, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    renderLayer(p);
  }
}

function onUp() {
  if (!drag) return;
  const d = drag;
  drag = null;

  if (d.kind === 'pen') {
    d.svg.remove();
    if (d.points.length > 1) {
      const a = { id: uid(), page: d.page.index, type: 'pen', ...structuredClone(defaults.pen), ...normalizePen(d.points) };
      state.annotations.push(a);
      commit();
    }
    return;
  }

  const a = getAnnot(d.id);
  if (!a) return;
  if (d.kind === 'create') {
    const b = bbox(a);
    if (b.w < 4 && b.h < 4) {
      // A simple click: give it a sensible default size.
      if (a.type === 'line' || a.type === 'arrow') {
        a.x2 = a.x1 + 120;
      } else {
        const size = { rect: [120, 70], ellipse: [100, 70], highlight: [150, 16], whiteout: [120, 24] }[a.type];
        a.w = size[0];
        a.h = size[1];
      }
    }
    if (!STICKY_TOOLS.has(state.tool)) hooks.setTool('select');
    commit();
    emit();
    return;
  }
  if (d.kind === 'move' && !d.moved) {
    if (d.editOnClick) startEditing(a.id);
    return;
  }
  commit();
}

// ---------------------------------------------------------------------------
// Text editing
// ---------------------------------------------------------------------------
export function startEditing(id) {
  const a = getAnnot(id);
  if (!a) return;
  state.editingId = id;
  state.selectedId = id;
  emit();
  const el = pageOf(a.page).layer.querySelector(`.annot[data-id="${id}"]`);
  if (!el) return;
  try {
    el.contentEditable = 'plaintext-only';
  } catch {
    el.contentEditable = 'true';
  }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.textContent = a.text;
  el.oninput = () => {
    a.text = el.innerText.replace(/\n$/, '');
    measureText(el, a);
  };
  el.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
    }
    e.stopPropagation();
  };
  el.onblur = () => {
    el.oninput = el.onblur = el.onkeydown = null;
    el.contentEditable = 'false';
    a.text = el.innerText.replace(/\n$/, '');
    if (state.editingId === id) state.editingId = null;
    if (!a.text.trim()) {
      state.annotations = state.annotations.filter((x) => x.id !== id);
      if (state.selectedId === id) state.selectedId = null;
    }
    commit();
    emit();
  };
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------------------------------------------------------------------------
// Fillable form fields (AcroForm) detected in the PDF
// ---------------------------------------------------------------------------
function setFormValue(name, value) {
  state.formValues[name] = value;
  state.formDirty.add(name);
  state.dirty = true;
  syncFormInputs(name);
  emit();
}

function syncFormInputs(name) {
  for (const p of state.pages) {
    for (const el of p.layer?.querySelectorAll('.form-field') || []) {
      const f = el._field;
      if (f.name !== name) continue;
      const v = state.formValues[name];
      if (f.kind === 'checkbox') el.classList.toggle('on', !!v);
      else if (f.kind === 'radio') el.classList.toggle('on', v === f.buttonValue);
      else if (el.value !== (v ?? '')) el.value = v ?? '';
    }
  }
}

function buildFormInputs(p) {
  for (const f of state.formFields.filter((x) => x.page === p.index)) {
    const { x, y, w, h } = f.rect;
    let el;
    if (f.kind === 'text') {
      el = document.createElement(f.multiline ? 'textarea' : 'input');
      if (!f.multiline) el.type = f.password ? 'password' : 'text';
      if (f.maxLen) el.maxLength = f.maxLen;
      el.value = state.formValues[f.name] ?? '';
      const size = f.fontSize || (f.multiline ? 10 : Math.min(12, Math.max(6, h * 0.65)));
      el.style.fontSize = `${size}px`;
      el.style.textAlign = ['left', 'center', 'right'][f.align] || 'left';
      if (f.comb && f.maxLen) {
        el.style.letterSpacing = `${w / f.maxLen - size * 0.6}px`;
        el.style.paddingLeft = `${(w / f.maxLen - size * 0.6) / 2}px`;
        el.style.fontFamily = 'Courier New, monospace';
      }
      el.addEventListener('input', () => setFormValue(f.name, el.value));
    } else if (f.kind === 'choice') {
      el = document.createElement('select');
      el.append(new Option('', ''));
      for (const o of f.options) el.append(new Option(o.label, o.value));
      el.value = state.formValues[f.name] ?? '';
      el.style.fontSize = `${Math.min(12, Math.max(6, h * 0.65))}px`;
      el.addEventListener('change', () => setFormValue(f.name, el.value));
    } else {
      el = document.createElement('button');
      el.type = 'button';
      el.innerHTML = f.kind === 'checkbox'
        ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg>'
        : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" /></svg>';
      const on = f.kind === 'checkbox' ? !!state.formValues[f.name] : state.formValues[f.name] === f.buttonValue;
      el.classList.toggle('on', on);
      el.setAttribute('aria-label', f.name);
      el.addEventListener('click', () => {
        if (f.kind === 'checkbox') setFormValue(f.name, !state.formValues[f.name]);
        else setFormValue(f.name, state.formValues[f.name] === f.buttonValue ? null : f.buttonValue);
      });
    }
    el.className = `form-field form-${f.kind}`;
    el._field = f;
    el.title = f.name;
    el.disabled = f.readOnly;
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => e.stopPropagation());
    p.layer.append(el);
  }
}
