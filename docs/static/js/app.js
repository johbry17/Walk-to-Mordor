/**
 * app.js — main orchestrator for Walk to Mordor
 *
 * Loads data, connects TimelineController ↔ MapController,
 * manages mode selection, and updates the info panel.
 */
'use strict';

/* ── Constants ───────────────────────────────────────────────────────── */
const JOURNEY_CONFIG = {
  Mordor: {
    character:   'Frodo',
    title:       'The Road to Mordor',
    color:       '#C17F40',
    totalMiles:  1815,
  },
  Return: {
    character:   'Aragorn',
    title:       'Return of the King',
    color:       '#4A7C8E',
    totalMiles:  1482,
  },
  Hobbit: {
    character:   'Bilbo',
    title:       'The Hobbit',
    color:       '#5F8A5A',
    totalMiles:  1100,
  },
};

// Frodo's intentional challenge pause
const FRODO_PAUSE = { start: '2024-07-29', end: '2024-08-23' };

/* ── Data loading ────────────────────────────────────────────────────── */
async function fetchData() {
  const base = '';  // relative to index.html

  const [walkingTxt, journeysJson, routesJson, eventsJson] = await Promise.all([
    fetch(`${base}data/walking.csv`).then(r => { if (!r.ok) throw r; return r.text(); }),
    fetch(`${base}data/journeys.json`).then(r => r.json()),
    fetch(`${base}data/routes.json`).then(r => r.json()),
    fetch(`${base}data/events.json`).then(r => r.json()),
  ]);

  const walking = _parseCsv(walkingTxt);
  return { walking, journeys: journeysJson, routes: routesJson, events: eventsJson };
}

function _parseCsv(text) {
  const lines   = text.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row  = {};
    headers.forEach((h, i) => {
      const v = vals[i] ?? '';
      if (h === 'date' || h === 'journey_id' || h === 'character' || h === 'segment') {
        row[h] = v || null;
      } else {
        row[h] = v !== '' ? parseFloat(v) : null;
      }
    });
    return row;
  });
}

/* ── Pre-computation ─────────────────────────────────────────────────── */

/**
 * Build per-journey cumulative mile arrays (carries forward the last known value).
 * Returns { Mordor: Float64Array, Return: Float64Array, Hobbit: Float64Array }
 */
function buildCumulativeLookup(walking) {
  const result  = {};
  const jids    = ['Mordor', 'Return', 'Hobbit'];
  for (const jid of jids) result[jid] = new Float64Array(walking.length);

  const last = { Mordor: 0, Return: 0, Hobbit: 0 };

  for (let i = 0; i < walking.length; i++) {
    const row = walking[i];
    if (row.journey_id && row.cumulative_miles !== null) {
      last[row.journey_id] = row.cumulative_miles;
    }
    for (const jid of jids) result[jid][i] = last[jid];
  }

  return result;
}

/**
 * Build date → index lookup for fast binary search.
 */
function buildDateIndex(walking) {
  const map = {};
  walking.forEach((row, i) => { map[row.date] = i; });
  return map;
}

/**
 * Extract journey date ranges from journeys list.
 */
function buildJourneyRanges(journeys) {
  const ranges = {};
  for (const seg of journeys) {
    const jid = seg.journey_id;
    if (!ranges[jid]) {
      ranges[jid] = { start: seg.start_date, end: seg.end_date };
    } else {
      if (seg.start_date < ranges[jid].start) ranges[jid].start = seg.start_date;
      if (seg.end_date   > ranges[jid].end)   ranges[jid].end   = seg.end_date;
    }
  }
  return ranges;
}

/**
 * Group segment metadata by journey for tick rendering.
 */
function buildSegmentsByJourney(journeys) {
  const result = {};
  for (const seg of journeys) {
    if (!result[seg.journey_id]) result[seg.journey_id] = [];
    result[seg.journey_id].push(seg);
  }
  return result;
}

/**
 * Build event lookup: date → event text (first event wins).
 */
function buildEventLookup(events) {
  const map = {};
  for (const ev of events) map[ev.date] = ev;
  return map;
}

/* ── Journey state calculator ────────────────────────────────────────── */

function computeJourneyState(jid, date, dateIndex, cumulativeLookup, journeyRanges, routes) {
  const range = journeyRanges[jid];
  if (!range) return null;

  let status;
  if      (date < range.start) status = 'unstarted';
  else if (date > range.end)   status = 'completed';
  else                         status = 'active';

  // Frodo's mid-journey pause
  if (jid === 'Mordor' && date >= FRODO_PAUSE.start && date <= FRODO_PAUSE.end) {
    status = 'paused';
  }

  const cumMiles = cumulativeLookup[jid]?.[dateIndex] ?? 0;
  const position = (status !== 'unstarted')
    ? getRoutePosition(routes[jid], cumMiles)
    : null;

  const location = (status !== 'unstarted' && cumMiles > 0)
    ? getNearestLocation(routes[jid], cumMiles)
    : (routes[jid]?.[0]?.location || '');

  // Find current segment name from journeySegments
  return { status, cumMiles, position, location };
}

/* ── Info panel updater ──────────────────────────────────────────────── */
const fmt = new Intl.DateTimeFormat('en-US', { year:'numeric', month:'long', day:'numeric' });
const fmtMiles = n => n >= 1 ? `${Math.round(n).toLocaleString()} mi` : `${(n).toFixed(1)} mi`;

function updateInfoPanel(mode, date, journeyStates, eventLookup, segmentsByJourney) {
  document.getElementById('info-date').textContent =
    date ? fmt.format(_parseDate(date)) : '—';

  const isPaused = (date >= FRODO_PAUSE.start && date <= FRODO_PAUSE.end);

  // Pause badge
  const pauseBadge = document.getElementById('pause-badge');
  pauseBadge.hidden = !isPaused;

  // Event text
  const ev = eventLookup[date];
  const evEl = document.getElementById('info-event');
  if (ev) {
    evEl.textContent = ev.text;
    evEl.hidden = false;
    evEl.className = 'info-event' + (ev.type === 'pause' ? ' pause-event' : '');
  } else {
    evEl.hidden = true;
  }

  if (mode === 'ALL') {
    _updateAllTimePanel(date, journeyStates, segmentsByJourney);
  } else {
    _updateSinglePanel(mode, date, journeyStates[mode], segmentsByJourney[mode], isPaused);
  }
}

function _updateAllTimePanel(date, journeyStates, segmentsByJourney) {
  // Find the primary "active" journey
  const active = ['Mordor', 'Return', 'Hobbit'].find(
    jid => journeyStates[jid]?.status === 'active' || journeyStates[jid]?.status === 'paused'
  );
  const jid = active || 'Mordor';
  const js  = journeyStates[jid];

  if (js && js.status !== 'unstarted') {
    document.getElementById('info-location').textContent = js.location || '—';
    document.getElementById('info-miles').textContent    = `${fmtMiles(js.cumMiles)} walked`;
    const cfg = JOURNEY_CONFIG[jid];
    document.getElementById('info-journey').innerHTML =
      `<strong>${cfg.character}</strong>${_segmentLabel(jid, js.cumMiles, segmentsByJourney)}`;
  } else {
    document.getElementById('info-location').textContent = 'The Shire';
    document.getElementById('info-miles').textContent    = '';
    document.getElementById('info-journey').innerHTML    = '';
  }

  // Journey rows
  document.getElementById('journey-rows').hidden = false;
  for (const jid2 of ['Mordor', 'Return', 'Hobbit']) {
    const js2 = journeyStates[jid2];
    const row = document.querySelector(`.journey-row[data-journey="${jid2}"]`);
    if (!row) continue;

    const totalMiles = JOURNEY_CONFIG[jid2].totalMiles;
    const cum = js2?.cumMiles ?? 0;
    const pct = Math.min((cum / totalMiles) * 100, 100);

    document.getElementById(`fill-${jid2}`).style.width = `${pct}%`;
    document.getElementById(`val-${jid2}`).textContent  = cum > 0 ? fmtMiles(cum) : '—';
    row.classList.toggle('has-progress', cum > 0);
  }
}

function _updateSinglePanel(jid, date, js, segments, isPaused) {
  document.getElementById('journey-rows').hidden = true;
  if (!js) return;

  const cfg = JOURNEY_CONFIG[jid];

  document.getElementById('info-location').textContent =
    (js.status === 'unstarted') ? cfg.character + "'s journey hasn't started yet" : js.location || '—';

  document.getElementById('info-miles').textContent =
    (js.status !== 'unstarted')
      ? `${fmtMiles(js.cumMiles)} walked`
      : '';

  const statusLabel = isPaused    ? '⏸ Challenge paused'
                    : js.status === 'completed'  ? '✓ Complete'
                    : js.status === 'active'     ? _segmentLabel(jid, js.cumMiles, { [jid]: segments })
                    : '';

  document.getElementById('info-journey').innerHTML =
    `<strong>${cfg.character}</strong>${cfg.title}<br>${statusLabel}`;
}

function _segmentLabel(jid, cumMiles, segmentsByJourney) {
  const segs = segmentsByJourney?.[jid];
  if (!segs || segs.length === 0) return '';
  for (const s of segs) {
    if (cumMiles >= s.cum_miles_start && cumMiles <= s.cum_miles_end) {
      return `<br>${s.segment}`;
    }
  }
  // cumMiles exceeded target (user walked slightly over) — show last segment
  if (cumMiles > segs[segs.length - 1].cum_miles_end) {
    return `<br>${segs[segs.length - 1].segment}`;
  }
  return '';
}

function _parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ── Bootstrap ───────────────────────────────────────────────────────── */

document.body.classList.add('loading');

fetchData().then(({ walking, journeys, routes, events }) => {

  // Pre-process
  const cumulativeLookup  = buildCumulativeLookup(walking);
  const dateIndex         = buildDateIndex(walking);
  const journeyRanges     = buildJourneyRanges(journeys);
  const segmentsByJourney = buildSegmentsByJourney(journeys);
  const eventLookup       = buildEventLookup(events);
  const allDates          = walking.map(r => r.date);

  // ── Map ──
  const mapCtrl = new MapController(
    document.getElementById('overlay'),
    routes
  );

  // ── Timeline ──
  const timeline = new TimelineController(
    allDates,
    journeyRanges,
    segmentsByJourney,
    document.getElementById('timeline'),
    document.getElementById('tl-start'),
    document.getElementById('tl-end'),
    document.getElementById('tl-ticks')
  );

  // ── Mode buttons ──
  let currentMode = 'ALL';

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === currentMode) return;
      currentMode = mode;

      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
        b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
        b.tabIndex = b.dataset.mode === mode ? 0 : -1;
      });

      timeline.setMode(mode);
    });

    // Roving tabindex keyboard nav
    btn.addEventListener('keydown', e => {
      const btns = [...document.querySelectorAll('.mode-btn')];
      const idx  = btns.indexOf(e.currentTarget);
      if (e.key === 'ArrowRight') { btns[(idx + 1) % btns.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { btns[(idx - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
    });
  });

  // ── Play button ──
  const playBtn = document.getElementById('play-btn');
  playBtn.addEventListener('click', () => {
    timeline.toggle();
    const playing = timeline.playing;
    playBtn.classList.toggle('playing', playing);
    playBtn.querySelector('.icon-play').style.display  = playing ? 'none' : '';
    playBtn.querySelector('.icon-pause').style.display = playing ? ''     : 'none';
    playBtn.setAttribute('aria-label', playing ? 'Pause journey' : 'Play journey');
  });

  // Stop play button when animation ends naturally
  const origPause = timeline.pause.bind(timeline);
  timeline.pause = function () {
    origPause();
    playBtn.classList.remove('playing');
    playBtn.querySelector('.icon-play').style.display  = '';
    playBtn.querySelector('.icon-pause').style.display = 'none';
    playBtn.setAttribute('aria-label', 'Play journey');
  };

  // Keyboard: Space = play/pause, Arrow keys scrub
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ')           { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight')  { e.preventDefault(); timeline.setIndex(timeline.index + 1); }
    if (e.key === 'ArrowLeft')   { e.preventDefault(); timeline.setIndex(timeline.index - 1); }
  });

  // ── Timeline change handler ──
  function onDateChange(idx, date) {
    if (!date) return;
    const wIdx = dateIndex[date] ?? 0;

    const journeyStates = {};
    for (const jid of ['Mordor', 'Return', 'Hobbit']) {
      journeyStates[jid] = computeJourneyState(
        jid, date, wIdx,
        cumulativeLookup, journeyRanges, routes
      );
    }

    mapCtrl.update({ mode: currentMode, journeyStates });
    updateInfoPanel(currentMode, date, journeyStates, eventLookup, segmentsByJourney);
  }

  timeline.onChange(onDateChange);

  // ── Reduced motion: disable playback ──
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    playBtn.style.display = 'none';
  }

  // ── Initial render ──
  document.body.classList.remove('loading');
  onDateChange(0, allDates[0]);

}).catch(err => {
  document.body.classList.remove('loading');
  document.getElementById('info-location').textContent = 'Failed to load data';
  console.error('Walk to Mordor: data load error', err);
});
