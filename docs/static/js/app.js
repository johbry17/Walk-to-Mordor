/**
 * app.js — main orchestrator for Walk to Mordor
 */
'use strict';

/* ── Constants ───────────────────────────────────────────────────────── */
const JOURNEY_CONFIG = {
  Mordor: { character: 'Frodo',   title: 'The Walk to Mordor',  color: '#C17F40', totalMiles: 1815 },
  Return: { character: 'Aragorn', title: 'Return of the King',  color: '#4A7C8E', totalMiles: 1482 },
  Hobbit: { character: 'Bilbo',   title: 'The Hobbit',          color: '#5F8A5A', totalMiles: 1100 },
};

const FRODO_PAUSE = { start: '2024-07-29', end: '2024-08-23' };

/* ── Data loading ────────────────────────────────────────────────────── */
async function fetchData() {
  const [walkingTxt, journeysJson, routesJson, eventsJson] = await Promise.all([
    fetch('data/walking.csv').then(r => { if (!r.ok) throw r; return r.text(); }),
    fetch('data/journeys.json').then(r => r.json()),
    fetch('data/routes.json').then(r => r.json()),
    fetch('data/events.json').then(r => r.json()),
  ]);
  return { walking: _parseCsv(walkingTxt), journeys: journeysJson, routes: routesJson, events: eventsJson };
}

function _parseCsv(text) {
  const lines = text.trim().split('\n');
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
 * Build a date-string → { Mordor, Return, Hobbit } cumulative-miles map.
 * Reads cumulative_miles directly from the ETL output and carries forward
 * the last known value on gap/unassigned days.
 */
function buildCumulativeByDate(walking) {
  const byDate = {};
  const last   = { Mordor: 0, Return: 0, Hobbit: 0 };
  for (const row of walking) {
    if (row.journey_id && row.cumulative_miles !== null) {
      last[row.journey_id] = row.cumulative_miles;
    }
    byDate[row.date] = { Mordor: last.Mordor, Return: last.Return, Hobbit: last.Hobbit };
  }
  return byDate;
}

/**
 * Generate a continuous calendar-date sequence (every day, no gaps).
 * Using UTC noon avoids DST edge cases on date arithmetic.
 */
function generateCalendarDates(startDate, endDate) {
  const dates = [];
  const d   = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate   + 'T12:00:00Z');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

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

function buildSegmentsByJourney(journeys) {
  const result = {};
  for (const seg of journeys) {
    if (!result[seg.journey_id]) result[seg.journey_id] = [];
    result[seg.journey_id].push(seg);
  }
  return result;
}

function buildEventLookup(events) {
  const map = {};
  for (const ev of events) map[ev.date] = ev;
  return map;
}

/* ── Journey state ───────────────────────────────────────────────────── */

function computeJourneyState(jid, date, cumulativeByDate, journeyRanges, routes) {
  const range = journeyRanges[jid];
  if (!range) return null;

  let status;
  if      (date < range.start) status = 'unstarted';
  else if (date > range.end)   status = 'completed';
  else                         status = 'active';

  if (jid === 'Mordor' && date >= FRODO_PAUSE.start && date <= FRODO_PAUSE.end) {
    status = 'paused';
  }

  const cumMiles = cumulativeByDate[date]?.[jid] ?? 0;
  const location = (status !== 'unstarted' && cumMiles > 0)
    ? getNearestLocation(routes[jid], cumMiles)
    : (routes[jid]?.[0]?.location || '');

  return { status, cumMiles, location };
}

/* ── Info panel ──────────────────────────────────────────────────────── */
const fmt      = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtMiles = n => n >= 1 ? `${Math.round(n).toLocaleString()} mi` : `${n.toFixed(1)} mi`;

function updateInfoPanel(mode, date, journeyStates, eventLookup, segmentsByJourney) {
  document.getElementById('info-date').textContent = date ? fmt.format(_parseDate(date)) : '—';

  const isPaused = date >= FRODO_PAUSE.start && date <= FRODO_PAUSE.end;
  document.getElementById('pause-badge').hidden = !isPaused;

  const ev  = eventLookup[date];
  const evEl = document.getElementById('info-event');
  if (ev) {
    evEl.textContent = ev.text;
    evEl.hidden      = false;
    evEl.className   = 'info-event' + (ev.type === 'pause' ? ' pause-event' : '');
  } else {
    evEl.hidden = true;
  }

  if (mode === 'ALL') {
    _updateAllTimePanel(date, journeyStates, segmentsByJourney);
  } else {
    _updateSinglePanel(mode, date, journeyStates, segmentsByJourney[mode], isPaused);
  }
}

function _updateAllTimePanel(date, journeyStates, segmentsByJourney) {
  // Primary display: the currently active journey (or Frodo if none active)
  const activeJid = ['Mordor', 'Return', 'Hobbit'].find(
    j => journeyStates[j]?.status === 'active' || journeyStates[j]?.status === 'paused'
  ) || 'Mordor';
  const js  = journeyStates[activeJid];
  const cfg = JOURNEY_CONFIG[activeJid];

  if (js && js.status !== 'unstarted') {
    document.getElementById('info-location').textContent = js.location || '—';
    document.getElementById('info-miles').textContent    = `${fmtMiles(js.cumMiles)} walked`;
    document.getElementById('info-journey').innerHTML    =
      `<strong>${cfg.character}</strong>${cfg.title}${_segmentLabel(activeJid, js.cumMiles, segmentsByJourney)}`;
  } else {
    document.getElementById('info-location').textContent = 'The Shire';
    document.getElementById('info-miles').textContent    = '';
    document.getElementById('info-journey').innerHTML    = '';
  }

  // All three progress bars — all visible in ALL TIME mode
  _renderProgressBars(journeyStates, null);
}

function _updateSinglePanel(jid, date, journeyStates, segments, isPaused) {
  const js  = journeyStates[jid];
  const cfg = JOURNEY_CONFIG[jid];

  document.getElementById('info-location').textContent =
    (!js || js.status === 'unstarted')
      ? `${cfg.character}'s journey hasn't started yet`
      : js.location || '—';

  document.getElementById('info-miles').textContent =
    (js && js.status !== 'unstarted') ? `${fmtMiles(js.cumMiles)} walked` : '';

  const statusLabel =
    isPaused               ? 'Pause for a month,<br>Lament for Gandalf'
    : js?.status === 'completed' ? '✓ Complete'
    : js?.status === 'active'    ? _segmentLabel(jid, js.cumMiles, { [jid]: segments })
    : '';

  document.getElementById('info-journey').innerHTML =
    `<strong>${cfg.character}</strong>${cfg.title}<br>${statusLabel}`;

  // Progress bars: only the selected journey shows progress; others are zero.
  _renderProgressBars(journeyStates, jid);
}

/**
 * Render the three journey progress bars.
 * @param {object} journeyStates
 * @param {string|null} activeOnly - if set, only this journey shows progress; others are 0.
 *                                   null means show all (ALL TIME mode).
 */
function _renderProgressBars(journeyStates, activeOnly) {
  document.getElementById('journey-rows').hidden = false;

  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    const row = document.querySelector(`.journey-row[data-journey="${jid}"]`);
    if (!row) continue;

    const showProgress = (activeOnly === null || activeOnly === jid);
    const cum = showProgress ? (journeyStates[jid]?.cumMiles ?? 0) : 0;
    const pct = showProgress ? Math.min((cum / JOURNEY_CONFIG[jid].totalMiles) * 100, 100) : 0;

    document.getElementById(`fill-${jid}`).style.width = `${pct}%`;
    document.getElementById(`val-${jid}`).textContent  = (showProgress && cum > 0) ? fmtMiles(cum) : '—';
    row.classList.toggle('has-progress', showProgress && cum > 0);
  }
}

function _segmentLabel(jid, cumMiles, segmentsByJourney) {
  const segs = segmentsByJourney?.[jid];
  if (!segs || segs.length === 0) return '';
  for (const s of segs) {
    if (cumMiles >= s.cum_miles_start && cumMiles <= s.cum_miles_end) return `<br>${s.segment}`;
  }
  if (cumMiles > segs[segs.length - 1].cum_miles_end) return `<br>${segs[segs.length - 1].segment}`;
  return '';
}

function _parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ── Bootstrap ───────────────────────────────────────────────────────── */

document.body.classList.add('loading');

// Pan/zoom is pure presentation — wired up before data loads.
const panZoom = new PanZoomController(
  document.getElementById('map-viewport'),
  document.getElementById('map-layer'),
  document.getElementById('reset-view')
);

fetchData().then(({ walking, journeys, routes, events }) => {

  const cumulativeByDate  = buildCumulativeByDate(walking);
  const journeyRanges     = buildJourneyRanges(journeys);
  const segmentsByJourney = buildSegmentsByJourney(journeys);
  const eventLookup       = buildEventLookup(events);

  // Full continuous calendar from first journey start to last journey end.
  // The CSV already contains every calendar day, but generating explicitly
  // makes the sequence robust to any CSV gaps.
  const projectStart = Object.values(journeyRanges).map(r => r.start).sort()[0];
  const projectEnd   = Object.values(journeyRanges).map(r => r.end).sort().pop();
  const allCalDates  = generateCalendarDates(projectStart, projectEnd);

  const mapCtrl = new MapController(document.getElementById('overlay'), routes);

  const timeline = new TimelineController(
    allCalDates,
    journeyRanges,
    segmentsByJourney,
    document.getElementById('timeline'),
    document.getElementById('tl-start'),
    document.getElementById('tl-end'),
    document.getElementById('tl-ticks')
  );

  // ── Mode buttons ──────────────────────────────────────────────────
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

      timeline.setMode(mode);  // resets index to 0, emits onChange
    });

    btn.addEventListener('keydown', e => {
      const btns = [...document.querySelectorAll('.mode-btn')];
      const idx  = btns.indexOf(e.currentTarget);
      if (e.key === 'ArrowRight') { btns[(idx + 1) % btns.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { btns[(idx - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
    });
  });

  // ── Play button ───────────────────────────────────────────────────
  const playBtn = document.getElementById('play-btn');

  function syncPlayBtn() {
    const playing = timeline.playing;
    playBtn.classList.toggle('playing', playing);
    playBtn.querySelector('.icon-play').style.display  = playing ? 'none' : '';
    playBtn.querySelector('.icon-pause').style.display = playing ? ''     : 'none';
    playBtn.setAttribute('aria-label', playing ? 'Pause journey' : 'Play journey');
  }

  playBtn.addEventListener('click', () => { timeline.toggle(); syncPlayBtn(); });

  // Patch timeline.pause so the button syncs when playback ends naturally.
  const _origPause = timeline.pause.bind(timeline);
  timeline.pause = function () { _origPause(); syncPlayBtn(); };

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ')          { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); timeline.setIndex(timeline.index + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); timeline.setIndex(timeline.index - 1); }
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    playBtn.style.display = 'none';
  }

  // ── Main render function ──────────────────────────────────────────
  function onDateChange(_idx, date) {
    if (!date) return;

    const journeyStates = {};
    for (const jid of ['Mordor', 'Return', 'Hobbit']) {
      journeyStates[jid] = computeJourneyState(
        jid, date, cumulativeByDate, journeyRanges, routes
      );
    }

    mapCtrl.update({ mode: currentMode, journeyStates });
    updateInfoPanel(currentMode, date, journeyStates, eventLookup, segmentsByJourney);
  }

  timeline.onChange(onDateChange);

  document.body.classList.remove('loading');
  onDateChange(0, allCalDates[0]);

}).catch(err => {
  document.body.classList.remove('loading');
  document.getElementById('info-location').textContent = 'Failed to load data';
  console.error('Walk to Mordor: data load error', err);
});
