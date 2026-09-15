/**
 * app.js — main orchestrator for Walk to Mordor
 *
 * Supports two independent clocks:
 *   MY TIME  — real walking dates + ETL cumulative miles → fictional route position
 *   ME TIME  — Tolkien fictional dates → interpolated fictional miles → same route position
 *
 * Both clocks produce { journey_id, cumMiles } which the shared _resolve() in map.js
 * converts to an SVG position. The renderer is clock-agnostic.
 */
'use strict';

/* ── Constants ───────────────────────────────────────────────────────── */
const JOURNEY_CONFIG = {
  Mordor: { character: 'Frodo',   title: 'The Walk to Mordor', color: '#C17F40', totalMiles: 1815 },
  Return: { character: 'Aragorn', title: 'Return of the King', color: '#4A7C8E', totalMiles: 1482 },
  Hobbit: { character: 'Bilbo',   title: 'The Hobbit',         color: '#5F8A5A', totalMiles: 1100 },
};

// My Time: intentional challenge pause between Mines of Moria and Eye of Sauron
const FRODO_PAUSE = { start: '2024-07-29', end: '2024-08-23' };

/* ── Data loading ────────────────────────────────────────────────────── */
async function fetchData() {
  const [walkingTxt, journeysJson, routesJson, eventsJson, chronologyJson] = await Promise.all([
    fetch('data/walking.csv').then(r => { if (!r.ok) throw r; return r.text(); }),
    fetch('data/journeys.json').then(r => r.json()),
    fetch('data/routes.json').then(r => r.json()),
    fetch('data/events.json').then(r => r.json()),
    fetch('data/chronology.json').then(r => r.json()),
  ]);
  return {
    walking:    _parseCsv(walkingTxt),
    journeys:   journeysJson,
    routes:     routesJson,
    events:     eventsJson,
    chronology: chronologyJson,
  };
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

/* ── My Time pre-computation ─────────────────────────────────────────── */

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

/* ── ME Time pre-computation ─────────────────────────────────────────── */

function buildChronologyByJourney(chronology) {
  const result = { Mordor: [], Return: [], Hobbit: [] };
  for (const entry of chronology) {
    if (result[entry.journey_id]) result[entry.journey_id].push(entry);
  }
  for (const jid of Object.keys(result)) {
    result[jid].sort((a, b) => a.me_date.localeCompare(b.me_date));
  }
  return result;
}

// ME slider uses only the unique anchor dates — no day-by-day generation needed.
function buildMESliderDates(chronologyByJourney) {
  const all = Object.values(chronologyByJourney).flat().map(e => e.me_date);
  return [...new Set(all)].sort();
}

function buildMEJourneyRanges(chronologyByJourney) {
  const ranges = {};
  for (const [jid, entries] of Object.entries(chronologyByJourney)) {
    if (!entries.length) continue;
    ranges[jid] = { start: entries[0].me_date, end: entries[entries.length - 1].me_date };
  }
  return ranges;
}

/* ── ME Time resolver ────────────────────────────────────────────────── */

// Approximate integer day count for linear interpolation between ME dates.
// Shire Calendar is close enough to Gregorian for interpolation purposes.
function _meDateToInt(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return y * 365 + (m - 1) * 30 + d;
}

/**
 * Given a sorted array of chronology entries for one journey and a ME date,
 * return { status, cumMiles, location?, text? }.
 *
 * Consecutive entries with the same mile value represent a rest stop —
 * no interpolation occurs and status is 'paused'.
 */
function resolveChronologyForDate(jidEntries, meDate) {
  if (!jidEntries || !jidEntries.length) {
    return { status: 'unstarted', cumMiles: 0 };
  }

  const first = jidEntries[0];
  const last  = jidEntries[jidEntries.length - 1];

  if (meDate < first.me_date) {
    return { status: 'unstarted', cumMiles: 0, location: first.location };
  }
  if (meDate >= last.me_date) {
    return {
      status:   'completed',
      cumMiles: last.mile,
      location: last.location,
      text:     meDate === last.me_date ? last.text : null,
    };
  }

  for (let i = 0; i < jidEntries.length - 1; i++) {
    const a = jidEntries[i], b = jidEntries[i + 1];
    if (meDate >= a.me_date && meDate < b.me_date) {
      const stopped = (a.mile === b.mile);
      let cumMiles;
      if (stopped) {
        cumMiles = a.mile;
      } else {
        const da = _meDateToInt(a.me_date);
        const db = _meDateToInt(b.me_date);
        const t  = da === db ? 0 : (_meDateToInt(meDate) - da) / (db - da);
        cumMiles = a.mile + t * (b.mile - a.mile);
      }
      const location = stopped ? a.location
                     : (cumMiles - a.mile < b.mile - cumMiles ? a.location : b.location);
      return {
        status:   stopped ? 'paused' : 'active',
        cumMiles,
        location,
        text: meDate === a.me_date ? a.text : null,
      };
    }
  }

  return { status: 'completed', cumMiles: last.mile, location: last.location };
}

/* ── Journey state builders ──────────────────────────────────────────── */

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
  // routes[jid] is now { geometry, anchors }; support legacy flat array too
  const anchors  = routes[jid]?.anchors || routes[jid];
  const location = (status !== 'unstarted' && cumMiles > 0)
    ? getNearestLocation(anchors, cumMiles)
    : (anchors?.[0]?.location || '');

  return { status, cumMiles, location };
}

function buildMyTimeJourneyStates(date, cumulativeByDate, journeyRanges, routes) {
  const js = {};
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    js[jid] = computeJourneyState(jid, date, cumulativeByDate, journeyRanges, routes);
  }
  return js;
}

function buildMEJourneyStates(meDate, chronologyByJourney, routes) {
  const js = {};
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    const result  = resolveChronologyForDate(chronologyByJourney[jid] || [], meDate);
    const anchors = routes[jid]?.anchors || routes[jid] || [];
    const loc     = result.location ||
                    (result.cumMiles > 0 ? getNearestLocation(anchors, result.cumMiles) : anchors[0]?.location || '');
    js[jid] = { ...result, location: loc };
  }
  return js;
}

/* ── Info panel ──────────────────────────────────────────────────────── */
const fmt      = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtMiles = n => n >= 1 ? `${Math.round(n).toLocaleString()} mi` : `${n.toFixed(1)} mi`;

const _ME_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _fmtMEDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${_ME_MONTHS[m - 1]} ${d}, T.A. ${y}`;
}

function updateInfoPanel(clockMode, journeyMode, date, journeyStates, eventLookup, segmentsByJourney) {
  document.getElementById('info-date').textContent =
    clockMode === 'ME' ? _fmtMEDate(date) : (date ? fmt.format(_parseDate(date)) : '—');

  // Pause detection: ME uses resolved status; My Time uses hardcoded date range
  const isPaused = clockMode === 'ME'
    ? Object.values(journeyStates).some(js => js?.status === 'paused')
    : (date >= FRODO_PAUSE.start && date <= FRODO_PAUSE.end);
  document.getElementById('pause-badge').hidden = !isPaused;

  // Narrative text: ME clock uses chronology text; My Time uses events.json
  const evEl = document.getElementById('info-event');
  let evText = null, evClass = 'info-event';

  if (clockMode === 'ME') {
    const activeJid = ['Mordor', 'Return', 'Hobbit'].find(
      j => journeyStates[j]?.status === 'active' || journeyStates[j]?.status === 'paused'
    );
    if (activeJid) evText = journeyStates[activeJid].text;
  } else {
    const ev = eventLookup[date];
    if (ev) { evText = ev.text; if (ev.type === 'pause') evClass += ' pause-event'; }
  }

  if (evText) {
    evEl.textContent = evText;
    evEl.hidden      = false;
    evEl.className   = evClass;
  } else {
    evEl.hidden = true;
  }

  if (journeyMode === 'ALL') {
    _updateAllTimePanel(date, journeyStates, segmentsByJourney);
  } else {
    _updateSinglePanel(clockMode, journeyMode, journeyStates, segmentsByJourney[journeyMode], isPaused);
  }
}

function _updateAllTimePanel(date, journeyStates, segmentsByJourney) {
  const activeJid = ['Mordor', 'Return', 'Hobbit'].find(
    j => journeyStates[j]?.status === 'active' || journeyStates[j]?.status === 'paused'
  ) || 'Mordor';
  const js  = journeyStates[activeJid];
  const cfg = JOURNEY_CONFIG[activeJid];

  if (js && js.status !== 'unstarted') {
    document.getElementById('info-location').textContent = js.location || '—';
    document.getElementById('info-miles').textContent    = `${fmtMiles(js.cumMiles)} walked`;
    document.getElementById('info-journey').innerHTML    =
      `<strong>${cfg.character}</strong>${_segmentLabel(activeJid, js.cumMiles, segmentsByJourney)}`;
  } else {
    document.getElementById('info-location').textContent = 'The Shire';
    document.getElementById('info-miles').textContent    = '';
    document.getElementById('info-journey').innerHTML    = '';
  }

  _renderProgressBars(journeyStates, null);
}

function _updateSinglePanel(clockMode, jid, journeyStates, segments, isPaused) {
  const js  = journeyStates[jid];
  const cfg = JOURNEY_CONFIG[jid];

  document.getElementById('info-location').textContent =
    (!js || js.status === 'unstarted')
      ? `${cfg.character}'s journey hasn't started yet`
      : js.location || '—';

  document.getElementById('info-miles').textContent =
    (js && js.status !== 'unstarted') ? `${fmtMiles(js.cumMiles)} walked` : '';

  // Conqueror segment label is My Time-specific
  const statusLabel =
    isPaused                   ? '⏸ Challenge paused'
    : js?.status === 'completed' ? '✓ Complete'
    : (js?.status === 'active' && clockMode === 'MY') ? _segmentLabel(jid, js.cumMiles, { [jid]: segments })
    : '';

  document.getElementById('info-journey').innerHTML =
    `<strong>${cfg.character}</strong>${cfg.title}<br>${statusLabel}`;

  _renderProgressBars(journeyStates, jid);
}

function _renderProgressBars(journeyStates, activeOnly) {
  document.getElementById('journey-rows').hidden = false;
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    const row = document.querySelector(`.journey-row[data-journey="${jid}"]`);
    if (!row) continue;
    const show = (activeOnly === null || activeOnly === jid);
    const cum  = show ? (journeyStates[jid]?.cumMiles ?? 0) : 0;
    const pct  = show ? Math.min((cum / JOURNEY_CONFIG[jid].totalMiles) * 100, 100) : 0;
    document.getElementById(`fill-${jid}`).style.width = `${pct}%`;
    document.getElementById(`val-${jid}`).textContent  = (show && cum > 0) ? fmtMiles(cum) : '—';
    row.classList.toggle('has-progress', show && cum > 0);
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

// Pan/zoom is pure presentation — independent of journey/timeline state.
const panZoom = new PanZoomController(
  document.getElementById('map-viewport'),
  document.getElementById('map-layer'),
  document.getElementById('reset-view')
);

fetchData().then(({ walking, journeys, routes, events, chronology }) => {

  // ── My Time ───────────────────────────────────────────────────────
  const cumulativeByDate  = buildCumulativeByDate(walking);
  const journeyRanges     = buildJourneyRanges(journeys);
  const segmentsByJourney = buildSegmentsByJourney(journeys);
  const eventLookup       = buildEventLookup(events);
  const projectStart      = Object.values(journeyRanges).map(r => r.start).sort()[0];
  const projectEnd        = Object.values(journeyRanges).map(r => r.end).sort().pop();
  const myCalDates        = generateCalendarDates(projectStart, projectEnd);

  // ── ME Time ───────────────────────────────────────────────────────
  const chronologyByJourney = buildChronologyByJourney(chronology);
  const meSliderDates       = buildMESliderDates(chronologyByJourney);
  const meJourneyRanges     = buildMEJourneyRanges(chronologyByJourney);

  // ── Map ───────────────────────────────────────────────────────────
  const mapCtrl = new MapController(document.getElementById('overlay'), routes);

  // ── Timeline (starts in My Time) ──────────────────────────────────
  const timeline = new TimelineController(
    myCalDates, journeyRanges, segmentsByJourney,
    document.getElementById('timeline'),
    document.getElementById('tl-start'),
    document.getElementById('tl-end'),
    document.getElementById('tl-ticks')
  );

  // ── State ─────────────────────────────────────────────────────────
  let currentMode = 'ALL';  // journey focus: ALL | Mordor | Return | Hobbit
  let clockMode   = 'MY';   // MY | ME

  // ── Clock toggle ──────────────────────────────────────────────────
  document.querySelectorAll('.clock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newClock = btn.dataset.clock;
      if (newClock === clockMode) return;
      clockMode = newClock;

      document.querySelectorAll('.clock-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.clock === newClock);
        b.setAttribute('aria-pressed', b.dataset.clock === newClock ? 'true' : 'false');
      });

      if (clockMode === 'ME') {
        timeline.setCalendar(meSliderDates, meJourneyRanges, {});
      } else {
        timeline.setCalendar(myCalDates, journeyRanges, segmentsByJourney);
      }
    });
  });

  // ── Journey mode buttons ──────────────────────────────────────────
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

  // ── Unified render function ───────────────────────────────────────
  function onDateChange(_idx, date) {
    if (!date) return;

    // Both clocks produce the same journeyStates shape: { status, cumMiles, location }
    const journeyStates = (clockMode === 'ME')
      ? buildMEJourneyStates(date, chronologyByJourney, routes)
      : buildMyTimeJourneyStates(date, cumulativeByDate, journeyRanges, routes);

    mapCtrl.update({ mode: currentMode, journeyStates });
    updateInfoPanel(clockMode, currentMode, date, journeyStates, eventLookup, segmentsByJourney);
  }

  timeline.onChange(onDateChange);

  document.body.classList.remove('loading');
  onDateChange(0, myCalDates[0]);

}).catch(err => {
  document.body.classList.remove('loading');
  document.getElementById('info-location').textContent = 'Failed to load data';
  console.error('Walk to Mordor: data load error', err);
});
