import { SIGNATURE_FONTS, loadSignatureFonts } from './fonts.js';

const STORE_KEY = 'fpe.saved-signatures';
const COLORS = [
  { name: 'Black', value: '#111827' },
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Red', value: '#b91c1c' },
];

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}
function storeSaved(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: saving is a convenience only */
  }
}

// Crop a canvas to its non-transparent pixels.
export function trimCanvas(src, pad = 6) {
  const ctx = src.getContext('2d');
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function removeWhite(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum > 235) d[i + 3] = 0;
    else if (lum > 180) d[i + 3] = Math.round(d[i + 3] * ((235 - lum) / 55)); // soft edge
  }
  ctx.putImageData(img, 0, 0);
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Opens the signature dialog. Resolves with { dataUrl, width, height } or null.
 * @param {'signature'|'initials'} kind
 */
export function openSignatureDialog(kind) {
  const dlg = document.getElementById('sig-dialog');
  const label = kind === 'initials' ? 'initials' : 'signature';
  dlg.querySelector('.sig-title').textContent = kind === 'initials' ? 'Add your initials' : 'Add your signature';
  dlg.querySelector('#sig-use').textContent = `Use ${label}`;

  let tab = 'draw';
  let color = COLORS[0].value;
  let fontIdx = 0;
  let strokes = [];
  let current = null;
  let uploadCanvas = null;

  // ---- tabs ----
  const tabs = dlg.querySelectorAll('[data-sig-tab]');
  const panels = dlg.querySelectorAll('[data-sig-panel]');
  const showTab = (t) => {
    tab = t;
    tabs.forEach((b) => b.setAttribute('aria-selected', b.dataset.sigTab === t));
    panels.forEach((p) => (p.hidden = p.dataset.sigPanel !== t));
    dlg.querySelector('.sig-colors').style.visibility = t === 'upload' ? 'hidden' : 'visible';
    if (t === 'type') typeInput.focus();
  };
  tabs.forEach((b) => (b.onclick = () => showTab(b.dataset.sigTab)));

  // ---- colors ----
  const colorWrap = dlg.querySelector('.sig-colors');
  colorWrap.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c.value;
    b.title = c.name;
    b.setAttribute('aria-label', `${c.name} ink`);
    b.setAttribute('aria-pressed', c.value === color);
    b.onclick = () => {
      color = c.value;
      colorWrap.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', s === b));
      redraw();
      renderFontChoices();
    };
    colorWrap.append(b);
  }

  // ---- draw ----
  const canvas = dlg.querySelector('#sig-canvas');
  const SCALE = 3;
  const sizeCanvas = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = Math.round(r.width * SCALE);
    canvas.height = Math.round(r.height * SCALE);
    redraw();
  };
  const ctx = canvas.getContext('2d');
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    for (const s of strokes) drawStroke(s);
  }
  function drawStroke(pts) {
    ctx.lineWidth = 2.6 * SCALE;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    current = [pos(e)];
    strokes.push(current);
    dlg.querySelector('.sig-hint').hidden = true;
    redraw();
  };
  canvas.onpointermove = (e) => {
    if (!current) return;
    current.push(pos(e));
    redraw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => (current = null);
  dlg.querySelector('#sig-clear').onclick = () => {
    strokes = [];
    dlg.querySelector('.sig-hint').hidden = false;
    redraw();
  };

  // ---- type ----
  const typeInput = dlg.querySelector('#sig-type-input');
  typeInput.value = '';
  typeInput.placeholder = kind === 'initials' ? 'Your initials' : 'Type your full name';
  typeInput.oninput = renderFontChoices;
  const fontWrap = dlg.querySelector('.sig-fonts');
  function renderFontChoices() {
    fontWrap.innerHTML = '';
    SIGNATURE_FONTS.forEach((f, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sig-font';
      b.setAttribute('aria-pressed', i === fontIdx);
      b.style.fontFamily = `"${f.name}", cursive`;
      b.style.color = color;
      b.style.fontSize = `${28 * f.scale}px`;
      b.textContent = typeInput.value || (kind === 'initials' ? 'AB' : 'Your Name');
      b.title = f.label;
      b.onclick = () => {
        fontIdx = i;
        renderFontChoices();
      };
      fontWrap.append(b);
    });
  }

  // ---- upload ----
  const fileInput = dlg.querySelector('#sig-file');
  const preview = dlg.querySelector('.sig-upload-preview');
  const removeBg = dlg.querySelector('#sig-remove-bg');
  fileInput.value = '';
  preview.innerHTML = '<span>No image selected</span>';
  uploadCanvas = null;
  let uploadImg = null;
  const buildUpload = () => {
    if (!uploadImg) return;
    const max = 1200;
    const s = Math.min(1, max / Math.max(uploadImg.width, uploadImg.height));
    const c = document.createElement('canvas');
    c.width = Math.round(uploadImg.width * s);
    c.height = Math.round(uploadImg.height * s);
    c.getContext('2d').drawImage(uploadImg, 0, 0, c.width, c.height);
    if (removeBg.checked) removeWhite(c);
    uploadCanvas = c;
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = c.toDataURL('image/png');
    img.alt = 'Uploaded signature preview';
    preview.append(img);
  };
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadImg = await loadImage(await readFileAsDataUrl(file));
    buildUpload();
  };
  removeBg.onchange = buildUpload;

  // ---- saved ----
  const savedWrap = dlg.querySelector('.sig-saved');
  const renderSaved = (resolve) => {
    const list = loadSaved().filter((s) => s.kind === kind);
    savedWrap.innerHTML = '';
    savedWrap.hidden = !list.length;
    if (!list.length) return;
    const h = document.createElement('div');
    h.className = 'sig-saved-title';
    h.textContent = `Saved ${label}s — click to use`;
    savedWrap.append(h);
    const row = document.createElement('div');
    row.className = 'sig-saved-row';
    for (const s of list) {
      const item = document.createElement('div');
      item.className = 'sig-saved-item';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'sig-saved-use';
      use.innerHTML = `<img src="${s.dataUrl}" alt="Saved ${label}">`;
      use.onclick = async () => {
        const img = await loadImage(s.dataUrl);
        finish(resolve, { dataUrl: s.dataUrl, width: img.width, height: img.height });
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sig-saved-del';
      del.title = 'Delete';
      del.setAttribute('aria-label', `Delete saved ${label}`);
      del.textContent = '×';
      del.onclick = () => {
        storeSaved(loadSaved().filter((x) => x.id !== s.id));
        renderSaved(resolve);
      };
      item.append(use, del);
      row.append(item);
    }
    savedWrap.append(row);
  };

  function build() {
    let c = null;
    if (tab === 'draw') {
      if (!strokes.length) return null;
      c = trimCanvas(canvas, 10);
    } else if (tab === 'type') {
      const text = typeInput.value.trim();
      if (!text) return null;
      const f = SIGNATURE_FONTS[fontIdx];
      const size = 140 * f.scale;
      const tmp = document.createElement('canvas');
      const tctx = tmp.getContext('2d');
      tctx.font = `${size}px "${f.name}"`;
      const w = Math.ceil(tctx.measureText(text).width) + size;
      tmp.width = w;
      tmp.height = Math.ceil(size * 2);
      tctx.font = `${size}px "${f.name}"`;
      tctx.fillStyle = color;
      tctx.textBaseline = 'middle';
      tctx.fillText(text, size / 2, tmp.height / 2);
      c = trimCanvas(tmp, 8);
    } else if (uploadCanvas) {
      c = trimCanvas(uploadCanvas, 4) || uploadCanvas;
    }
    if (!c) return null;
    return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height };
  }

  loadSignatureFonts().then(() => renderFontChoices());

  let finish;
  return new Promise((resolve) => {
    finish = (res, value) => {
      dlg.close();
      res(value);
    };
    renderSaved(resolve);
    renderFontChoices();
    strokes = [];
    dlg.querySelector('.sig-hint').hidden = false;
    dlg.querySelector('#sig-remember').checked = true;
    dlg.showModal();
    showTab('draw');
    requestAnimationFrame(sizeCanvas);

    dlg.querySelector('#sig-use').onclick = () => {
      const out = build();
      if (!out) {
        const msg = { draw: `Draw your ${label} first.`, type: `Type your ${label} first.`, upload: 'Choose an image first.' }[tab];
        dlg.querySelector('.sig-error').textContent = msg;
        return;
      }
      if (dlg.querySelector('#sig-remember').checked) {
        const list = loadSaved();
        const same = list.filter((s) => s.kind === kind);
        if (same.length >= 4) list.splice(list.indexOf(same[0]), 1);
        list.push({ id: Math.random().toString(36).slice(2), kind, dataUrl: out.dataUrl });
        storeSaved(list);
      }
      finish(resolve, out);
    };
    dlg.querySelector('#sig-cancel').onclick = () => finish(resolve, null);
    dlg.querySelector('.sig-close').onclick = () => finish(resolve, null);
    dlg.oncancel = (e) => {
      e.preventDefault();
      finish(resolve, null);
    };
    dlg.querySelector('.sig-error').textContent = '';
    dlg.addEventListener('input', () => (dlg.querySelector('.sig-error').textContent = ''), { once: true });
  });
}
