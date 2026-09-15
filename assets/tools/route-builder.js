/**
 * route-builder.js — Walk to Mordor route drawing / calibration tool
 *
 * Development-only. Not part of the GitHub Pages production app.
 *
 * Workflow
 * --------
 * 1. Load routes.json  (from project or file picker)
 * 2. Select journey    (Mordor / Return / Hobbit)
 * 3. DRAW mode         → click to append geometry points
 * 4. ANCHOR mode       → click nearest point, set mile + location
 * 5. Export            → Copy JSON | Download | Save As
 * 6. Reload next session and continue
 *
 * Data contract
 * -------------
 * geometry : [{x, y}, ...]       — dense ordered SVG-space points
 * anchors  : [{geom_idx, mile, location?}, ...]  — no x/y (looked up from geometry)
 * Coordinates always in SVG viewBox space (0–3200, 0–2400).
 */

'use strict';

/* ── Constants ───────────────────────────────────────────────────── */
const JOURNEY_LABEL = {
  Mordor: 'Frodo — Mordor',
  Return: 'Aragorn — Return',
  Hobbit: 'Bilbo — The Hobbit',
};
const JOURNEY_COLOR = { Mordor: '#C17F40', Return: '#4A7C8E', Hobbit: '#5F8A5A' };
const ARROW_EVERY   = 20;   // direction arrow every N segments
const GEOM_DOT_R    = 5;    // geometry dot radius in SVG units (ANCHOR mode)
const ANCHOR_R      = 11;   // anchor diamond half-size in SVG units
const ENDPOINT_R    = 14;   // endpoint marker radius
const SEL_R         = 18;   // selected-point ring radius
const DRAG_PX       = 5;    // pixels before mousedown becomes a drag

/* ── State ───────────────────────────────────────────────────────── */
let routes      = null;        // { Mordor:{geometry,anchors}, Return:{...}, Hobbit:{...} }
let currentJid  = 'Mordor';
let mode        = 'VIEW';
let selIdx      = null;        // selected geometry index in ANCHOR mode
let isDirty     = false;

/* View transform (for pan/zoom) */
const V = { scale: 1, tx: 0, ty: 0 };
let panning = false, dragStartX = 0, dragStartY = 0, vTxAt = 0, vTyAt = 0;
let clickOrigin = null;  // set on mousedown, cleared on mouseup

/* ── DOM shortcuts ───────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const vp = () => $('viewport');
const cl = () => $('canvas-layer');
const ov = () => $('overlay');

/* ── SVG helpers ─────────────────────────────────────────────────── */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function ptsToPath(pts) {
  if (!pts || pts.length < 2) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
}

/* ── Coordinate conversion ───────────────────────────────────────── */
/**
 * Convert browser screen (clientX/Y) to SVG viewBox coordinates.
 * Uses getScreenCTM() which accounts for all CSS transforms on ancestors
 * (including the canvas-layer zoom/pan transform).
 */
function toSVG(clientX, clientY) {
  const svg = ov();
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const s = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 };
}

/* ── Pan / zoom ──────────────────────────────────────────────────── */
function applyTransform() {
  cl().style.transform = `translate(${V.tx}px,${V.ty}px) scale(${V.scale})`;
}

function zoomAt(cx, cy, factor) {
  const newScale = Math.max(0.25, Math.min(14, V.scale * factor));
  if (newScale === V.scale) return;
  const ratio = newScale / V.scale;
  V.tx    = cx - (cx - V.tx) * ratio;
  V.ty    = cy - (cy - V.ty) * ratio;
  V.scale = newScale;
  applyTransform();
}

function resetView() { V.scale = 1; V.tx = 0; V.ty = 0; applyTransform(); }

$('viewport').addEventListener('wheel', e => {
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  if (e.deltaMode === 2) dy *= 400;
  const rect = $('viewport').getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-dy * 0.001));
}, { passive: false });

$('viewport').addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  clickOrigin = { x: e.clientX, y: e.clientY };
  panning     = false;
  dragStartX  = e.clientX;
  dragStartY  = e.clientY;
  vTxAt       = V.tx;
  vTyAt       = V.ty;
});

$('viewport').addEventListener('mousemove', e => {
  // Always update mouse coordinates
  const pt = toSVG(e.clientX, e.clientY);
  if (pt) $('s-mouse').textContent = `${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}`;

  if (!clickOrigin) return;
  const dx = e.clientX - clickOrigin.x, dy = e.clientY - clickOrigin.y;
  if (!panning && Math.hypot(dx, dy) > DRAG_PX) panning = true;
  if (panning) {
    V.tx = vTxAt + (e.clientX - dragStartX);
    V.ty = vTyAt + (e.clientY - dragStartY);
    applyTransform();
  }
});

$('viewport').addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  if (!panning && clickOrigin) handleClick(e);
  clickOrigin = null;
  panning     = false;
});

window.addEventListener('mouseup', () => { clickOrigin = null; panning = false; });

/* ── Mode / journey management ───────────────────────────────────── */
function setMode(m) {
  mode = m;
  $('viewport').className = `mode-${m}`;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('s-mode').textContent = m;
  if (m !== 'ANCHOR') {
    selIdx = null;
    $('anchor-section').classList.remove('on');
  }
  render();
}

function setJourney(jid) {
  currentJid = jid;
  selIdx     = null;
  $('anchor-section').classList.remove('on');
  document.querySelectorAll('.jbtn').forEach(b => b.classList.toggle('active', b.dataset.jid === jid));
  updateStatus();
  render();
}

/* ── Click handling ──────────────────────────────────────────────── */
function handleClick(e) {
  if (!routes) return;
  const pt = toSVG(e.clientX, e.clientY);
  if (!pt) return;

  if (mode === 'DRAW') {
    routes[currentJid].geometry.push({ x: pt.x, y: pt.y });
    markDirty();
    updateStatus();
    render();
  } else if (mode === 'ANCHOR') {
    const geom = routes[currentJid].geometry;
    if (!geom.length) return;
    const { idx, dist } = nearestGeomPt(pt.x, pt.y, geom);
    selIdx = idx;
    showAnchorPanel(idx, geom[idx], dist);
    render();
  }
}

/* ── Nearest geometry point ──────────────────────────────────────── */
function nearestGeomPt(svgX, svgY, geom) {
  let minD = Infinity, minI = 0;
  for (let i = 0; i < geom.length; i++) {
    const d = Math.hypot(geom[i].x - svgX, geom[i].y - svgY);
    if (d < minD) { minD = d; minI = i; }
  }
  return { idx: minI, dist: minD };
}

/* ── Anchor panel ────────────────────────────────────────────────── */
function showAnchorPanel(geomIdx, geomPt, distSVG) {
  const ancs    = routes[currentJid].anchors;
  const existing = ancs.find(a => a.geom_idx === geomIdx);

  $('a-idx').textContent  = geomIdx;
  $('a-xy').textContent   = `${geomPt.x.toFixed(0)}, ${geomPt.y.toFixed(0)}`;
  $('a-dist').textContent = `${distSVG.toFixed(0)} SVG units`;

  if (existing) {
    $('existing-anchor-box').style.display = '';
    $('ea-mile').textContent = existing.mile;
    $('ea-loc').textContent  = existing.location || '—';
    $('inp-mile').value = existing.mile;
    $('inp-loc').value  = existing.location || '';
  } else {
    $('existing-anchor-box').style.display = 'none';
    // Pre-fill mile based on neighbouring anchors
    const sorted = [...ancs].sort((a, b) => a.geom_idx - b.geom_idx);
    const prev   = sorted.filter(a => a.geom_idx < geomIdx).pop();
    const next   = sorted.find(a => a.geom_idx > geomIdx);
    if (prev && next) {
      $('inp-mile').value = ((prev.mile + next.mile) / 2).toFixed(1);
    } else if (prev) {
      $('inp-mile').value = '';
    } else {
      $('inp-mile').value = '0';
    }
    $('inp-loc').value = '';
  }

  $('anc-warns').textContent = '';
  $('anchor-section').classList.add('on');
}

/* ── Anchor save / delete ────────────────────────────────────────── */
function saveAnchor() {
  if (selIdx === null || !routes) return;
  const mile = parseFloat($('inp-mile').value);
  if (isNaN(mile)) { $('anc-warns').textContent = '⚠ Mile must be a number.'; return; }

  const loc  = $('inp-loc').value.trim() || undefined;
  const warns = validateMile(currentJid, selIdx, mile);
  $('anc-warns').textContent = warns.join('  ');

  const ancs = routes[currentJid].anchors;
  const ei   = ancs.findIndex(a => a.geom_idx === selIdx);
  const entry = { geom_idx: selIdx, mile, ...(loc ? { location: loc } : {}) };

  if (ei >= 0) ancs[ei] = entry;
  else         ancs.push(entry);

  ancs.sort((a, b) => a.geom_idx - b.geom_idx);

  markDirty();
  updateStatus();
  renderAnchorList();
  render();
  showAnchorPanel(selIdx, routes[currentJid].geometry[selIdx], 0);
}

function deleteAnchor() {
  if (selIdx === null || !routes) return;
  const ancs = routes[currentJid].anchors;
  const i    = ancs.findIndex(a => a.geom_idx === selIdx);
  if (i < 0) return;
  ancs.splice(i, 1);
  markDirty();
  updateStatus();
  renderAnchorList();
  render();
  showAnchorPanel(selIdx, routes[currentJid].geometry[selIdx], 0);
}

function validateMile(jid, geomIdx, mile) {
  const others = routes[jid].anchors.filter(a => a.geom_idx !== geomIdx)
                                     .sort((a, b) => a.geom_idx - b.geom_idx);
  const prev   = others.filter(a => a.geom_idx < geomIdx).pop();
  const next   = others.find(a => a.geom_idx > geomIdx);
  const w = [];
  if (prev && prev.mile > mile)
    w.push(`⚠ Prev anchor [${prev.geom_idx}] has mile ${prev.mile} > ${mile}`);
  if (next && next.mile < mile)
    w.push(`⚠ Next anchor [${next.geom_idx}] has mile ${next.mile} < ${mile}`);
  return w;
}

/* ── Geometry point deletion ─────────────────────────────────────── */
function deleteGeomPt(idx) {
  if (!routes) return;
  const data       = routes[currentJid];
  const isAnchored = data.anchors.some(a => a.geom_idx === idx);
  const q = isAnchored
    ? `Point ${idx} has a calibration anchor. Deleting it removes the anchor too. Continue?`
    : `Delete geometry point ${idx}? Cannot be undone.`;
  if (!confirm(q)) return;

  if (isAnchored) data.anchors = data.anchors.filter(a => a.geom_idx !== idx);
  for (const a of data.anchors) if (a.geom_idx > idx) a.geom_idx--;
  data.geometry.splice(idx, 1);

  selIdx = null;
  $('anchor-section').classList.remove('on');
  markDirty();
  updateStatus();
  renderAnchorList();
  render();
}

/* ── Rendering ───────────────────────────────────────────────────── */
function render() {
  const svg  = ov();
  const defs = svg.querySelector('defs');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);
  if (!routes) return;

  // Ghost routes for the other two journeys
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    if (jid === currentJid) continue;
    const geom = routes[jid].geometry;
    if (geom.length < 2) continue;
    svg.appendChild(svgEl('path', {
      d:              ptsToPath(geom),
      stroke:         JOURNEY_COLOR[jid],
      'stroke-width': '3',
      'stroke-opacity': '0.12',
      'stroke-linecap':  'round',
      'stroke-linejoin': 'round',
      fill: 'none',
    }));
  }

  const data  = routes[currentJid];
  const geom  = data.geometry;
  const color = JOURNEY_COLOR[currentJid];

  if (!geom.length) return;

  // ── Route line ──────────────────────────────────────────────────
  if (geom.length >= 2) {
    svg.appendChild(svgEl('path', {
      d:              ptsToPath(geom),
      stroke:         color,
      'stroke-width': '5',
      'stroke-opacity': '0.75',
      'stroke-linecap':  'round',
      'stroke-linejoin': 'round',
      fill: 'none',
    }));
  }

  // ── Direction arrows every ARROW_EVERY segments ─────────────────
  for (let i = ARROW_EVERY; i < geom.length; i += ARROW_EVERY) {
    const a = geom[i - 1], b = geom[i];
    const mx  = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    svg.appendChild(svgEl('polygon', {
      points:    '0,-7 14,0 0,7',
      fill:      color,
      opacity:   '0.55',
      transform: `translate(${mx},${my}) rotate(${ang})`,
    }));
  }

  // ── Start marker ────────────────────────────────────────────────
  svg.appendChild(svgEl('circle', {
    cx: geom[0].x, cy: geom[0].y, r: ENDPOINT_R * 0.65,
    fill: 'none', stroke: color, 'stroke-width': '3', opacity: '0.8',
  }));

  // ── Endpoint marker (gold dot + ring) ───────────────────────────
  const ep = geom[geom.length - 1];
  svg.appendChild(svgEl('circle', {
    cx: ep.x, cy: ep.y, r: ENDPOINT_R + 7,
    fill: 'none', stroke: '#FFD700', 'stroke-width': '2', opacity: '0.35',
  }));
  svg.appendChild(svgEl('circle', {
    cx: ep.x, cy: ep.y, r: ENDPOINT_R,
    fill: '#FFD700', stroke: '#0D0B08', 'stroke-width': '3',
  }));

  // ── Anchor markers (diamonds with labels) ───────────────────────
  const sortedAncs = [...data.anchors].sort((a, b) => a.geom_idx - b.geom_idx);
  for (const anc of sortedAncs) {
    if (anc.geom_idx >= geom.length) continue; // invalid — skip rendering
    const p = geom[anc.geom_idx];
    const r = ANCHOR_R;
    svg.appendChild(svgEl('polygon', {
      points: `${p.x},${p.y - r} ${p.x + r},${p.y} ${p.x},${p.y + r} ${p.x - r},${p.y}`,
      fill: '#0D0B08', stroke: color, 'stroke-width': '2.5',
    }));
    if (anc.location) {
      const lbl = svgEl('text', {
        x: p.x + r + 5, y: p.y + 5,
        fill: color, 'font-size': '20', 'font-family': 'sans-serif',
        'paint-order': 'stroke', stroke: '#0D0B08',
        'stroke-width': '6', 'stroke-linejoin': 'round',
      });
      lbl.textContent = `${anc.location} (${anc.mile})`;
      svg.appendChild(lbl);
    }
  }

  // ── Geometry dots in ANCHOR mode ─────────────────────────────────
  if (mode === 'ANCHOR') {
    for (let i = 0; i < geom.length; i++) {
      if (i === selIdx) continue; // drawn as selected below
      const isAnc = data.anchors.some(a => a.geom_idx === i);
      if (isAnc) continue;        // anchors already have diamond markers
      const p = geom[i];
      svg.appendChild(svgEl('circle', {
        cx: p.x, cy: p.y, r: GEOM_DOT_R,
        fill: color, opacity: '0.35',
      }));
    }
  }

  // ── Selected point (ANCHOR mode) ─────────────────────────────────
  if (mode === 'ANCHOR' && selIdx !== null && selIdx < geom.length) {
    const p = geom[selIdx];
    svg.appendChild(svgEl('circle', {
      cx: p.x, cy: p.y, r: SEL_R,
      fill: 'none', stroke: '#FFD700', 'stroke-width': '3',
    }));
    svg.appendChild(svgEl('circle', {
      cx: p.x, cy: p.y, r: GEOM_DOT_R + 3,
      fill: '#FFD700',
    }));
  }
}

/* ── Anchor list panel ───────────────────────────────────────────── */
function renderAnchorList() {
  if (!routes) return;
  const { geometry, anchors } = routes[currentJid];
  const sorted = [...anchors].sort((a, b) => a.geom_idx - b.geom_idx);
  const valid  = sorted.filter(a => a.geom_idx < geometry.length);
  const bad    = sorted.filter(a => a.geom_idx >= geometry.length);

  $('anc-count').textContent = `(${anchors.length})`;

  const lines = valid.map(a => {
    const isSel = (a.geom_idx === selIdx);
    return `<div class="anc-item${isSel ? ' sel' : ''}">
      <span>[${a.geom_idx}] ${a.location || '—'}</span>
      <span>${a.mile} mi</span>
    </div>`;
  });

  if (bad.length) {
    lines.push(`<div class="anc-item bad">⚠ ${bad.length} invalid (geom_idx ≥ ${geometry.length})</div>`);
  }
  $('anchor-list-box').innerHTML = lines.join('');

  // Validation
  const warns = validateJourney(currentJid);
  $('anc-validation').innerHTML = warns.map(w => `<div>${w}</div>`).join('');
}

function validateJourney(jid) {
  if (!routes) return [];
  const { geometry, anchors } = routes[jid];
  const sorted = [...anchors].sort((a, b) => a.geom_idx - b.geom_idx);
  const warns  = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (a.geom_idx >= geometry.length)
      warns.push(`⚠ [${a.geom_idx}] out of bounds (geometry has ${geometry.length} pts)`);
    if (i > 0 && sorted[i - 1].mile > a.mile)
      warns.push(`⚠ Mile order: ${sorted[i-1].mile} → ${a.mile} (non-monotone)`);
  }
  return warns;
}

/* ── Status bar ──────────────────────────────────────────────────── */
function updateStatus() {
  if (!routes) {
    $('s-jid').textContent      = '—';
    $('s-geom').textContent     = '0';
    $('s-anc').textContent      = '0';
    $('s-end').textContent      = '—';
    $('s-last-anc').textContent = '—';
    return;
  }
  const { geometry, anchors } = routes[currentJid];
  $('s-jid').textContent  = JOURNEY_LABEL[currentJid];
  $('s-mode').textContent = mode;
  $('s-geom').textContent = geometry.length;
  $('s-anc').textContent  = anchors.length;

  if (geometry.length) {
    const ep = geometry[geometry.length - 1];
    $('s-end').textContent = `${ep.x.toFixed(0)}, ${ep.y.toFixed(0)}`;
  } else {
    $('s-end').textContent = '—';
  }

  const lastAnc = [...anchors].sort((a, b) => b.geom_idx - a.geom_idx)[0];
  $('s-last-anc').textContent = lastAnc
    ? `mi ${lastAnc.mile}${lastAnc.location ? ' · ' + lastAnc.location : ''} [${lastAnc.geom_idx}]`
    : '—';

  renderAnchorList();
}

function markDirty() {
  isDirty = true;
  $('dirty-badge').style.display = '';
}
function clearDirty() {
  isDirty = false;
  $('dirty-badge').style.display = 'none';
}

/* ── Save / export ───────────────────────────────────────────────── */
/**
 * Return routes with clean anchor format: no redundant x/y fields.
 * Anchors sorted by geom_idx.
 */
function cleanRoutes() {
  const out = {};
  for (const [jid, data] of Object.entries(routes)) {
    out[jid] = {
      geometry: data.geometry.map(p => ({ x: p.x, y: p.y })),
      anchors:  data.anchors
        .map(a => ({ geom_idx: a.geom_idx, mile: a.mile, ...(a.location ? { location: a.location } : {}) }))
        .sort((a, b) => a.geom_idx - b.geom_idx),
    };
  }
  return out;
}

function msg(text, ok = true) {
  const el  = $('save-msg');
  el.textContent = text;
  el.style.color = ok ? '#6DB46D' : 'var(--danger)';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 3000);
}

function copyJSON() {
  const json = JSON.stringify(cleanRoutes(), null, 2);
  navigator.clipboard.writeText(json)
    .then(() => { msg('✓ Copied to clipboard'); clearDirty(); })
    .catch(() => msg('✗ Clipboard blocked — use Download', false));
}

function downloadJSON() {
  const json = JSON.stringify(cleanRoutes(), null, 2);
  const url  = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'routes.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  msg('✓ Download started');
  clearDirty();
}

async function saveAsFile() {
  if (!window.showSaveFilePicker) { msg('✗ API unavailable — use Download or Copy', false); return; }
  try {
    const fh = await window.showSaveFilePicker({
      suggestedName: 'routes.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(cleanRoutes(), null, 2));
    await w.close();
    msg('✓ Saved');
    clearDirty();
  } catch (e) {
    if (e.name !== 'AbortError') msg(`✗ ${e.message}`, false);
  }
}

/* ── Load / normalise ────────────────────────────────────────────── */
/**
 * Accept both the legacy flat-array format and the new {geometry,anchors} format.
 * Strips redundant x/y from anchors.
 */
function normalise(raw) {
  const result = {};
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    const d = raw[jid];
    if (!d) { result[jid] = { geometry: [], anchors: [] }; continue; }

    if (Array.isArray(d)) {
      // Legacy: flat array of {x, y, mile?, location?}
      result[jid] = {
        geometry: d.map(p => ({ x: p.x, y: p.y })),
        anchors:  d.flatMap((p, i) =>
          p.mile !== undefined
            ? [{ geom_idx: i, mile: p.mile, ...(p.location ? { location: p.location } : {}) }]
            : []
        ),
      };
    } else {
      // New format — strip x/y from anchors if present
      result[jid] = {
        geometry: (d.geometry || []).map(p => ({ x: p.x, y: p.y })),
        anchors:  (d.anchors  || []).map(a => ({
          geom_idx: a.geom_idx,
          mile:     a.mile,
          ...(a.location ? { location: a.location } : {}),
          // x, y intentionally omitted — position always from geometry[geom_idx]
        })),
      };
    }
  }
  return result;
}

function onLoaded(raw, sourceName) {
  routes  = normalise(raw);
  clearDirty();
  $('status-bar').textContent = `Loaded: ${sourceName}`;
  $('load-msg').textContent   = `✓ ${sourceName}`;
  $('load-msg').style.color   = '#6DB46D';
  setMode('VIEW');
  setJourney(currentJid);
}

async function loadFromProject() {
  $('load-msg').textContent   = 'Fetching…';
  $('load-msg').style.color   = 'var(--muted)';
  try {
    const r = await fetch('../../docs/static/data/routes.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    onLoaded(await r.json(), 'routes.json (project)');
  } catch (e) {
    $('load-msg').textContent = `✗ ${e.message}`;
    $('load-msg').style.color = 'var(--danger)';
  }
}

function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try   { onLoaded(JSON.parse(ev.target.result), file.name); }
    catch (e) { $('load-msg').textContent = `✗ Invalid JSON: ${e.message}`; $('load-msg').style.color = 'var(--danger)'; }
  };
  reader.readAsText(file);
}

function clearGeom() {
  if (!routes) return;
  const { geometry, anchors } = routes[currentJid];
  const q = anchors.length
    ? `Clear all ${geometry.length} geometry points for ${JOURNEY_LABEL[currentJid]}?\n\n${anchors.length} anchor(s) will become invalid until re-pinned. The anchor data is NOT deleted.`
    : `Clear all ${geometry.length} geometry points for ${JOURNEY_LABEL[currentJid]}?`;
  if (!confirm(q)) return;
  routes[currentJid].geometry = [];
  selIdx = null;
  $('anchor-section').classList.remove('on');
  markDirty();
  updateStatus();
  render();
}

/* ── Keyboard shortcuts ──────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);

  if (!inInput) {
    if (e.key === 'v' || e.key === 'V') { setMode('VIEW'); return; }
    if (e.key === 'd' || e.key === 'D') { setMode('DRAW'); return; }
    if (e.key === 'a' || e.key === 'A') { setMode('ANCHOR'); return; }
    if (e.key === 'Escape') { setMode('VIEW'); return; }

    // Backspace in DRAW mode: undo last geometry point
    if (e.key === 'Backspace' && mode === 'DRAW' && routes) {
      e.preventDefault();
      const geom = routes[currentJid].geometry;
      if (!geom.length) return;
      const lastIdx   = geom.length - 1;
      const isAnchored = routes[currentJid].anchors.some(a => a.geom_idx === lastIdx);
      if (isAnchored && !confirm(`Point ${lastIdx} has an anchor. Remove it?`)) return;
      if (isAnchored) routes[currentJid].anchors = routes[currentJid].anchors.filter(a => a.geom_idx !== lastIdx);
      geom.pop();
      markDirty();
      updateStatus();
      render();
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (routes) downloadJSON(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !inInput) { e.preventDefault(); if (routes) copyJSON(); }
});

/* ── Init ────────────────────────────────────────────────────────── */
function init() {
  // Journey buttons
  document.querySelectorAll('.jbtn').forEach(b =>
    b.addEventListener('click', () => setJourney(b.dataset.jid)));

  // Mode buttons
  document.querySelectorAll('.mbtn').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  // View controls
  $('btn-reset').addEventListener('click', resetView);
  $('btn-zoomin').addEventListener('click', () => {
    const r = $('viewport').getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1.4);
  });
  $('btn-zoomout').addEventListener('click', () => {
    const r = $('viewport').getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1 / 1.4);
  });

  // Anchor panel
  $('btn-save-anc').addEventListener('click', saveAnchor);
  $('btn-del-anc').addEventListener('click', deleteAnchor);
  $('btn-del-geom').addEventListener('click', () => { if (selIdx !== null) deleteGeomPt(selIdx); });

  // Enter key in anchor inputs submits
  $('inp-mile').addEventListener('keydown', e => { if (e.key === 'Enter') saveAnchor(); });
  $('inp-loc').addEventListener('keydown',  e => { if (e.key === 'Enter') saveAnchor(); });

  // Save/export
  $('btn-copy').addEventListener('click', copyJSON);
  $('btn-dl').addEventListener('click', downloadJSON);
  $('btn-save-as').addEventListener('click', saveAsFile);

  // Load
  $('btn-load-proj').addEventListener('click', loadFromProject);
  $('btn-load-file').addEventListener('click', () => $('file-inp').click());
  $('file-inp').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadFromFile(f);
    e.target.value = '';
  });

  // Clear geometry
  $('btn-clear-geom').addEventListener('click', clearGeom);

  // Warn before unload if unsaved
  window.addEventListener('beforeunload', e => {
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  updateStatus();
  loadFromProject();  // auto-load on open
}

init();
