/**
 * map.js — SVG overlay rendering for Walk to Mordor
 *
 * Manages the three route paths, waypoint markers, and position dots
 * drawn on top of the Middle-earth SVG base map.
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
    this._routes = routes;  // { Mordor: [{location,mile,x,y}], ... }
    this._els    = {};      // { Mordor: { ghost, active, markerPulse, markerCore }, ... }

    this._buildElements();
  }

  /** Create all SVG groups and paths on first load. */
  _buildElements() {
    const svg = this._svg;

    // Clear any previous content
    svg.innerHTML = '';

    // One group per journey, rendered back→front (Hobbit first, Mordor on top)
    for (const jid of ['Hobbit', 'Return', 'Mordor']) {
      const { color } = JOURNEY_META[jid];
      const wpts = this._routes[jid];
      if (!wpts) continue;

      const d = _waypointsToPath(wpts);
      const g = _svgEl('g', { id: `journey-${jid}` });

      // Ghost — full route, always drawn, low opacity
      const ghost = _svgEl('path', {
        class: 'route-ghost',
        d,
        stroke: color,
        'stroke-width': '4',
        'stroke-opacity': '0.15',
        fill: 'none',
      });

      // Active — same path, revealed via stroke-dashoffset
      const active = _svgEl('path', {
        class: 'route-active',
        d,
        stroke: color,
        'stroke-width': '5',
        'stroke-opacity': '0.9',
        fill: 'none',
      });

      // Pulse ring (animated, behind core)
      const pulse = _svgEl('circle', {
        class: 'marker-pulse',
        cx: '0', cy: '0', r: '14',
        fill: color,
      });

      // Position marker core
      const ring = _svgEl('circle', {
        class: 'marker-ring',
        cx: '0', cy: '0', r: '22',
        stroke: color,
        fill: 'none',
        'stroke-width': '2',
        opacity: '0.4',
      });
      const core = _svgEl('circle', {
        class: 'marker-core',
        cx: '0', cy: '0', r: '12',
        fill: '#D4A853',
        stroke: '#13110D',
        'stroke-width': '3',
      });

      g.append(ghost, active, pulse, ring, core);
      svg.appendChild(g);

      this._els[jid] = { ghost, active, pulse, ring, core };

      // Initialise dashoffset after element is in DOM
      requestAnimationFrame(() => this._initDash(jid));
    }
  }

  _initDash(jid) {
    const { active } = this._els[jid];
    const len = active.getTotalLength();
    active.style.strokeDasharray  = len;
    active.style.strokeDashoffset = len;  // fully hidden at start
    active.dataset.totalLen = len;
  }

  /**
   * Update all three route visuals.
   * @param {object} state - { mode, journeyStates: { Mordor, Return, Hobbit } }
   *   Each journeyState: { status: 'unstarted'|'active'|'completed'|'paused', cumMiles, position }
   */
  update(state) {
    const { mode, journeyStates } = state;

    for (const jid of ['Mordor', 'Return', 'Hobbit']) {
      const js = journeyStates[jid];
      const els = this._els[jid];
      if (!js || !els) continue;

      const { status, cumMiles, position } = js;
      const meta = JOURNEY_META[jid];
      const isFocused = (mode === 'ALL' || mode === jid);
      const isOther   = (mode !== 'ALL' && mode !== jid);

      this._updateRoute(jid, status, cumMiles, meta.totalMiles, isOther);
      this._updateMarker(jid, status, position, isOther);
    }
  }

  _updateRoute(jid, status, cumMiles, totalMiles, isOther) {
    const { ghost, active } = this._els[jid];
    const totalLen = parseFloat(active.dataset.totalLen) || 0;
    if (!totalLen) return;

    const fraction = Math.min(cumMiles / totalMiles, 1);

    // Ghost (full route)
    let ghostOpacity;
    if (status === 'unstarted')  ghostOpacity = isOther ? 0.06 : 0.12;
    else if (isOther)            ghostOpacity = 0.08;
    else                         ghostOpacity = 0.18;
    ghost.setAttribute('stroke-opacity', ghostOpacity);

    // Active (revealed portion)
    if (status === 'unstarted') {
      active.style.strokeDashoffset = totalLen;
      active.style.strokeOpacity = '0';
    } else {
      const offset = totalLen * (1 - fraction);
      active.style.strokeDashoffset = offset;
      const opacity = isOther
        ? (status === 'completed' ? '0.35' : '0.4')
        : (status === 'completed' ? '0.65' : '0.9');
      active.style.strokeOpacity = opacity;
    }
  }

  _updateMarker(jid, status, position, isOther) {
    const { pulse, ring, core } = this._els[jid];

    if (!position || status === 'unstarted') {
      pulse.style.display = 'none';
      ring.style.display  = 'none';
      core.style.display  = 'none';
      return;
    }

    const { x, y } = position;
    for (const el of [pulse, ring, core]) {
      el.setAttribute('cx', x);
      el.setAttribute('cy', y);
      el.style.display = '';
    }

    // Pulse only for active, non-other journeys
    pulse.style.display = (!isOther && status === 'active') ? '' : 'none';
    ring.style.display  = (!isOther && status === 'active') ? '' : 'none';

    // Core size and opacity
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
 * Interpolate SVG (x,y) from cumulative miles and waypoint list.
 * @returns {{ x: number, y: number } | null}
 */
function getRoutePosition(waypoints, cumMiles) {
  if (!waypoints || waypoints.length === 0) return null;
  if (cumMiles <= 0) return { x: waypoints[0].x, y: waypoints[0].y };

  const maxMile = waypoints[waypoints.length - 1].mile;
  const clamped = Math.min(cumMiles, maxMile);

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    if (clamped >= a.mile && clamped <= b.mile) {
      const t = (clamped - a.mile) / (b.mile - a.mile);
      return {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
      };
    }
  }

  const last = waypoints[waypoints.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Return the name of the most recently passed waypoint.
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

// Expose to app.js
window.MapController   = MapController;
window.getRoutePosition = getRoutePosition;
window.getNearestLocation = getNearestLocation;
