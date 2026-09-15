/**
 * map.js — SVG overlay rendering for Walk to Mordor
 */
'use strict';

const JOURNEY_META = {
  Mordor: { color: '#C17F40', totalMiles: 1815 },
  Return: { color: '#4A7C8E', totalMiles: 1482 },
  Hobbit: { color: '#5F8A5A', totalMiles: 1100 },
};

class MapController {
  constructor(svgEl, routes) {
    this._svg    = svgEl;
    this._routes = routes;
    this._els    = {};
    this._geom   = {};

    // Geometry MUST be built first so dasharray is applied synchronously.
    this._buildGeometry();
    this._buildElements();
  }

  /**
   * Pre-compute cumulative Euclidean path lengths at each waypoint.
   * The path is a straight polyline of the waypoints, so these values
   * equal getTotalLength() — but available without requiring DOM layout.
   */
  _buildGeometry() {
    for (const jid of ['Hobbit', 'Return', 'Mordor']) {
      const routeData = this._routes[jid];
      if (!routeData) continue;
      // Support new { geometry, anchors } format and legacy flat array
      const pts = routeData.geometry || routeData;
      if (!pts || pts.length < 2) continue;
      const cumLen = [0];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        cumLen.push(total);
      }
      this._geom[jid] = { totalLen: total, cumLen };
    }
  }

  /**
   * Single authoritative function: given fictional cumulative miles,
   * return { x, y, revealLen }.
   *
   * Both the marker position and the stroke-dashoffset are derived from
   * this one call, so they always agree — the filled route ends exactly
   * where the marker sits.
   */
  _resolve(jid, cumMiles) {
    const routeData = this._routes[jid];
    const geom      = this._geom[jid];
    if (!routeData || !geom) return null;

    const anchors = routeData.anchors || routeData;  // new format or legacy
    const maxMile = anchors[anchors.length - 1].mile;
    const clamped = Math.min(Math.max(cumMiles, 0), maxMile);

    if (clamped <= 0) {
      return { x: anchors[0].x, y: anchors[0].y, revealLen: 0 };
    }

    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (clamped >= a.mile && clamped <= b.mile) {
        const segMiles = b.mile - a.mile;
        const t = segMiles === 0 ? 1 : (clamped - a.mile) / segMiles;
        // geom_idx present → reference dense geometry cumLen; else fall back to anchor index
        const idxA = a.geom_idx !== undefined ? a.geom_idx : i;
        const idxB = b.geom_idx !== undefined ? b.geom_idx : i + 1;
        return {
          x:         a.x + t * (b.x - a.x),
          y:         a.y + t * (b.y - a.y),
          revealLen: geom.cumLen[idxA] + t * (geom.cumLen[idxB] - geom.cumLen[idxA]),
        };
      }
    }

    const last = anchors[anchors.length - 1];
    return { x: last.x, y: last.y, revealLen: geom.totalLen };
  }

  _buildElements() {
    this._svg.innerHTML = '';

    for (const jid of ['Hobbit', 'Return', 'Mordor']) {
      const { color } = JOURNEY_META[jid];
      const routeData = this._routes[jid];
      if (!routeData) continue;

      // geometry[] for visual path; anchors[] (or legacy flat array) for resolution
      const pts  = routeData.geometry || routeData;
      const d    = _waypointsToPath(pts);
      const geom = this._geom[jid];
      const g    = _svgEl('g', { id: `journey-${jid}` });

      const ghost = _svgEl('path', {
        class: 'route-ghost', d, stroke: color,
        'stroke-width': '4', 'stroke-opacity': '0.15', fill: 'none',
      });

      const active = _svgEl('path', {
        class: 'route-active', d, stroke: color,
        'stroke-width': '5', fill: 'none',
      });

      // Apply dasharray synchronously from pre-computed geometry — no rAF needed.
      if (geom) {
        active.style.strokeDasharray  = `${geom.totalLen}`;
        active.style.strokeDashoffset = `${geom.totalLen}`;  // fully hidden
        active.style.strokeOpacity    = '0';
      }

      const pulse = _svgEl('circle', {
        class: 'marker-pulse', cx: '0', cy: '0', r: '14', fill: color,
      });
      const ring = _svgEl('circle', {
        class: 'marker-ring', cx: '0', cy: '0', r: '22',
        stroke: color, fill: 'none', 'stroke-width': '2', opacity: '0.4',
      });
      const core = _svgEl('circle', {
        class: 'marker-core', cx: '0', cy: '0', r: '12',
        fill: '#D4A853', stroke: '#13110D', 'stroke-width': '3',
      });

      for (const el of [pulse, ring, core]) el.style.display = 'none';

      g.append(ghost, active, pulse, ring, core);
      this._svg.appendChild(g);
      this._els[jid] = { ghost, active, pulse, ring, core };
    }
  }

  /**
   * Update all route visuals from current journey states.
   * @param {{ mode: string, journeyStates: { [jid]: { status, cumMiles } } }} state
   */
  update(state) {
    const { mode, journeyStates } = state;

    for (const jid of ['Mordor', 'Return', 'Hobbit']) {
      const js  = journeyStates[jid];
      const els = this._els[jid];
      if (!js || !els) continue;

      const { status, cumMiles } = js;
      const isOther  = (mode !== 'ALL' && mode !== jid);
      const resolved = (status !== 'unstarted') ? this._resolve(jid, cumMiles) : null;

      this._updateRoute(jid, status, resolved, isOther);
      this._updateMarker(status, resolved, isOther, els);
    }
  }

  _updateRoute(jid, status, resolved, isOther) {
    const { ghost, active } = this._els[jid];
    const geom = this._geom[jid];
    if (!geom) return;

    let ghostOpacity;
    if      (status === 'unstarted') ghostOpacity = isOther ? 0.06 : 0.12;
    else if (isOther)                ghostOpacity = 0.08;
    else                             ghostOpacity = 0.18;
    ghost.setAttribute('stroke-opacity', ghostOpacity);

    if (!resolved || status === 'unstarted') {
      active.style.strokeDashoffset = `${geom.totalLen}`;
      active.style.strokeOpacity    = '0';
      return;
    }

    // dashoffset = totalLen - revealLen  →  first revealLen units of path are shown.
    // revealLen comes from _resolve(), same call that produces marker x/y.
    active.style.strokeDashoffset = `${geom.totalLen - resolved.revealLen}`;

    const opacity = isOther
      ? (status === 'completed' ? '0.35' : '0.4')
      : (status === 'completed' ? '0.65' : '0.9');
    active.style.strokeOpacity = opacity;
  }

  _updateMarker(status, resolved, isOther, els) {
    const { pulse, ring, core } = els;

    if (!resolved || status === 'unstarted') {
      for (const el of [pulse, ring, core]) el.style.display = 'none';
      return;
    }

    const { x, y } = resolved;
    for (const el of [pulse, ring, core]) {
      el.setAttribute('cx', x);
      el.setAttribute('cy', y);
      el.style.display = '';
    }

    pulse.style.display = (!isOther && status === 'active') ? '' : 'none';
    ring.style.display  = (!isOther && status === 'active') ? '' : 'none';

    if (isOther) {
      core.setAttribute('r', '8');
      core.style.opacity = '0.4';
    } else if (status === 'completed') {
      core.setAttribute('r', '11');
      core.style.opacity = '0.7';
    } else {
      core.setAttribute('r', '13');
      core.style.opacity = '1';
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function _waypointsToPath(waypoints) {
  return waypoints.map((w, i) => `${i === 0 ? 'M' : 'L'}${w.x},${w.y}`).join(' ');
}

function _svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Return the last waypoint name at or before cumMiles.
 * Used by app.js for the info-panel location display.
 */
function getNearestLocation(waypoints, cumMiles) {
  if (!waypoints || waypoints.length === 0) return '';
  let name = waypoints[0].location;
  for (const w of waypoints) {
    if (w.mile <= cumMiles) name = w.location;
    else break;
  }
  return name;
}

window.MapController      = MapController;
window.getNearestLocation = getNearestLocation;
