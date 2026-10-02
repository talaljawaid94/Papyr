// Geometry shared by the on-screen SVG renderer and the PDF exporter, so what
// you see is exactly what gets written into the file.

const K = 0.5522847498; // cubic Bézier circle constant
const n = (v) => Math.round(v * 100) / 100;

export const VECTOR_TYPES = new Set([
  'rect', 'ellipse', 'line', 'arrow', 'pen', 'check', 'cross', 'dot', 'highlight', 'whiteout',
]);
export const KEEP_RATIO = new Set(['check', 'cross', 'dot', 'image']);

// Bounding box of the annotation geometry.
export function bbox(a) {
  if (a.type === 'line' || a.type === 'arrow') {
    const x = Math.min(a.x1, a.x2);
    const y = Math.min(a.y1, a.y2);
    return { x, y, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  }
  return { x: a.x, y: a.y, w: a.w || 0, h: a.h || 0 };
}

export function translate(a, dx, dy) {
  if (a.type === 'line' || a.type === 'arrow') {
    a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy;
  } else {
    a.x += dx; a.y += dy;
  }
}

function ellipsePath(cx, cy, rx, ry) {
  const ox = rx * K;
  const oy = ry * K;
  return (
    `M${n(cx - rx)} ${n(cy)}` +
    `C${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}` +
    `C${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)}` +
    `C${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}` +
    `C${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)}Z`
  );
}

const poly = (a, pts) =>
  pts.map(([px, py], i) => `${i ? 'L' : 'M'}${n(a.x + px * a.w)} ${n(a.y + py * a.h)}`).join('');

// SVG path in page coordinates (y down).
export function pathFor(a) {
  switch (a.type) {
    case 'rect':
    case 'highlight':
    case 'whiteout':
      return `M${n(a.x)} ${n(a.y)}H${n(a.x + a.w)}V${n(a.y + a.h)}H${n(a.x)}Z`;
    case 'ellipse':
      return ellipsePath(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2);
    case 'line':
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'arrow': {
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const len = Math.max(8, a.strokeWidth * 4);
      const w1 = [a.x2 - len * Math.cos(ang - 0.45), a.y2 - len * Math.sin(ang - 0.45)];
      const w2 = [a.x2 - len * Math.cos(ang + 0.45), a.y2 - len * Math.sin(ang + 0.45)];
      return (
        `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}` +
        `M${n(w1[0])} ${n(w1[1])}L${n(a.x2)} ${n(a.y2)}L${n(w2[0])} ${n(w2[1])}`
      );
    }
    case 'check':
      return poly(a, [[0.14, 0.55], [0.4, 0.8], [0.88, 0.2]]);
    case 'cross':
      return poly(a, [[0.2, 0.2], [0.8, 0.8]]) + poly(a, [[0.8, 0.2], [0.2, 0.8]]);
    case 'dot': {
      const r = Math.min(a.w, a.h) * 0.36;
      return ellipsePath(a.x + a.w / 2, a.y + a.h / 2, r, r);
    }
    case 'pen':
      return poly(a, a.points);
    default:
      return '';
  }
}

// Paint settings: { stroke, strokeWidth, fill, opacity, multiply }
export function paintFor(a) {
  switch (a.type) {
    case 'rect':
    case 'ellipse':
      return {
        stroke: a.strokeWidth > 0 ? a.stroke : null,
        strokeWidth: a.strokeWidth,
        fill: a.fillOn ? a.fill : null,
        opacity: a.opacity ?? 1,
      };
    case 'line':
    case 'arrow':
    case 'pen':
      return { stroke: a.stroke, strokeWidth: a.strokeWidth, fill: null, opacity: a.opacity ?? 1 };
    case 'check':
    case 'cross':
      return {
        stroke: a.color,
        strokeWidth: Math.max(1, Math.min(a.w, a.h) * 0.13),
        fill: null,
        opacity: 1,
      };
    case 'dot':
      return { stroke: null, strokeWidth: 0, fill: a.color, opacity: 1 };
    case 'highlight':
      return { stroke: null, strokeWidth: 0, fill: a.color, opacity: 0.45, multiply: true };
    case 'whiteout':
      return { stroke: null, strokeWidth: 0, fill: a.color, opacity: 1 };
    default:
      return { stroke: null, strokeWidth: 0, fill: null, opacity: 1 };
  }
}

// Convert absolute pen points into points normalized to their bounding box.
export function normalizePen(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return {
    x: minX, y: minY, w, h,
    points: points.map(([x, y]) => [n((x - minX) / w * 1000) / 1000, n((y - minY) / h * 1000) / 1000]),
  };
}
