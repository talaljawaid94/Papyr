// Central app state. Annotation coordinates are in PDF points relative to the
// page as displayed (top-left origin, page rotation applied, zoom = 1).

export const state = {
  bytes: null, // original PDF bytes (Uint8Array)
  fileName: '',
  pdf: null, // pdf.js document
  pages: [], // { index, width, height, viewport, wrap, canvas, layer, rendered }
  annotations: [],
  assets: new Map(), // id -> { dataUrl, mime, width, height }
  formFields: [],
  formValues: {},
  formDirty: new Set(),
  tool: 'select',
  pending: null, // image waiting to be placed: { assetId, w, h, kind }
  selectedId: null,
  editingId: null,
  zoom: 1,
  dirty: false,
  flatten: false,
};

export const defaults = {
  text: { font: 'helvetica', size: 12, color: '#111111', bold: false, italic: false },
  shape: { stroke: '#2563eb', strokeWidth: 2, fill: '#bfdbfe', fillOn: false, opacity: 1 },
  line: { stroke: '#2563eb', strokeWidth: 2, opacity: 1 },
  pen: { stroke: '#dc2626', strokeWidth: 2, opacity: 1 },
  mark: { color: '#111111', size: 14 },
  highlight: { color: '#fde047' },
  whiteout: { color: '#ffffff' },
  image: { opacity: 1 },
};

export function groupOf(type) {
  switch (type) {
    case 'text':
    case 'date':
      return 'text';
    case 'rect':
    case 'ellipse':
      return 'shape';
    case 'line':
    case 'arrow':
      return 'line';
    case 'check':
    case 'cross':
    case 'dot':
      return 'mark';
    case 'signature':
    case 'initials':
      return 'image';
    default:
      return type;
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const getAnnot = (id) => state.annotations.find((a) => a.id === id);

// ---- change notification ----
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
}
export function emit() {
  for (const fn of listeners) fn();
}

// ---- undo / redo (snapshots of the annotation list) ----
let undoStack = [];
let redoStack = [];
let baseline = '[]';

const snap = () => JSON.stringify(state.annotations);

export function resetHistory() {
  undoStack = [];
  redoStack = [];
  baseline = snap();
}

export function commit() {
  const s = snap();
  if (s === baseline) return;
  undoStack.push(baseline);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  baseline = s;
  state.dirty = true;
  emit();
}

function restore(s) {
  state.annotations = JSON.parse(s);
  baseline = s;
  state.editingId = null;
  if (!getAnnot(state.selectedId)) state.selectedId = null;
  state.dirty = true;
  emit();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(baseline);
  restore(undoStack.pop());
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(baseline);
  restore(redoStack.pop());
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
