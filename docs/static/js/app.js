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

const FRODO_PAUSE          = { start: '2024-07-29', end: '2024-08-23' };
const FRODO_ARAGORN_BREAK  = { start: '2025-01-09', end: '2025-01-13' };
const ARAGORN_BILBO_BREAK  = { start: '2025-08-27', end: '2026-01-19' };

// ME Time rest/break ranges — ordinal pairs [startOrd, endOrd] from me_time.csv
const ME_BREAK_ORDINALS = {
  Hobbit: [[154, 184], [237, 264], [265, 285]],  // Rivendell, Wood-elves, Esgaroth
  Gap: [[326, 28390]],                           // Historical gap before LOTR-era chronology
  Mordor: [[28417, 28482], [28506, 28535]],      // Rivendell, Lothlórien
};

/* ── Middle-earth Calendar Ordinal Calculator ────────────────────────
 *
 * Matches the Python implementation in notebooks/me-time-generator.ipynb.
 * Used to assign absolute ordinals to chronology.json dates that are not
 * present in me_time.csv (gap events, post-journey events, year-only dates).
 *
 * BASE year T.A. 2941 = ordinal 0 (Yule 2).
 * Months 1-12 have 30 days each; intercalary days exist between months 6 & 7.
 * Leap years (year % 4 === 0) have one extra intercalary day (Overlithe).
 */
const _ME_ORD_BASE = 2941;
const _meAbsStartCache = new Map();

function _meAbsStart(year) {
  if (_meAbsStartCache.has(year)) return _meAbsStartCache.get(year);
  let acc = 0;
  for (let y = _ME_ORD_BASE; y < year; y++) acc += (y % 4 === 0 ? 366 : 365);
  _meAbsStartCache.set(year, acc);
  return acc;
}

/**
 * Compute the absolute Shire Calendar ordinal for a me_date string.
 * Handles 'YYYY-MM-DD' and year-only 'YYYY'.
 * Returns null for special named days (those are resolved via meDateToOrdinal
 * which is populated from me_time.csv).
 */
function _meAbsOrdFromDate(meDate) {
  if (!meDate) return null;
  const mDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meDate);
  if (mDay) {
    const yr = +mDay[1], mo = +mDay[2], dy = +mDay[3];
    const extra = (yr % 4 === 0) ? 4 : 3;
    const yord  = (mo - 1) * 30 + dy + (mo <= 6 ? 0 : extra);
    return _meAbsStart(yr) + yord;
  }
  const mYr = /^(\d{4})$/.exec(meDate);
  if (mYr) return _meAbsStart(+mYr[1]);  // year-only → Yule 2 (yord=0)
  return null;  // special named days handled via meDateToOrdinal
}

/* ── Data loading ────────────────────────────────────────────────────── */
async function fetchData() {
  const [walkingTxt, meTimeTxt, journeysJson, routesJson, chronologyJson] = await Promise.all([
    fetch('data/walking.csv').then(r => { if (!r.ok) throw r; return r.text(); }),
    fetch('data/me_time.csv').then(r => { if (!r.ok) throw r; return r.text(); }),
    fetch('data/journeys.json').then(r => r.json()),
    fetch('data/routes.json').then(r => r.json()),
    fetch('data/chronology.json').then(r => r.json()),
  ]);
  return {
    walking:    _parseCsv(walkingTxt),
    meTime:     _parseCsv(meTimeTxt),
    journeys:   journeysJson,
    routes:     routesJson,
    chronology: chronologyJson,
  };
}

function _parseCsv(text) {
  const lines   = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row  = {};
    headers.forEach((h, i) => {
      const v = vals[i] ?? '';
      if (h === 'date' || h === 'me_date' || h === 'journey_id' || h === 'character' || h === 'segment') {
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

/* ── ME Time pre-computation ─────────────────────────────────────────── */

/**
 * Build the ME Time timeline from me_time.csv rows.
 *
 * Returns:
 *   meOrdinals   — sorted unique numeric ordinals (the slider axis)
 *   ordinalToMeDate — Map<ordinal, me_date string> for display
 *   meTimeByOrdinalByJourney — Map<ordinal, Map<journey_id, cumulative_miles>>
 *   meJourneyOrdinalRanges — { jid: { start: ordinal, end: ordinal } }
 */
function buildMETimeIndex(meTime) {
  const ordinalSet         = new Set();
  const ordinalToMeDate    = new Map();
  // ordinal → { jid → cumMiles }
  const byOrdinal          = new Map();

  for (const row of meTime) {
    const ord = row.me_ordinal;
    if (ord === null || ord === undefined) continue;

    ordinalSet.add(ord);

    if (!ordinalToMeDate.has(ord)) {
      ordinalToMeDate.set(ord, row.me_date);
    }

    if (!byOrdinal.has(ord)) byOrdinal.set(ord, {});
    // Multiple journeys can share an ordinal — store each separately.
    // If the same journey appears twice at same ordinal (shouldn't happen),
    // take the later (higher miles) value.
    const jid = row.journey_id;
    const existing = byOrdinal.get(ord)[jid];
    if (existing === undefined || row.cumulative_miles > existing) {
      byOrdinal.get(ord)[jid] = row.cumulative_miles;
    }
  }

  const meOrdinals = [...ordinalSet].sort((a, b) => a - b);

  // Per-journey ordinal ranges (for mode filtering)
  const meJourneyOrdinalRanges = {};
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    const jidOrdinals = meTime
      .filter(r => r.journey_id === jid && r.me_ordinal !== null)
      .map(r => r.me_ordinal);
    if (jidOrdinals.length) {
      meJourneyOrdinalRanges[jid] = {
        start: Math.min(...jidOrdinals),
        end:   Math.max(...jidOrdinals),
      };
    }
  }

  return { meOrdinals, ordinalToMeDate, byOrdinal, meJourneyOrdinalRanges };
}

function buildChronologyByJourney(chronology) {
  const result = { Mordor: [], Return: [], Hobbit: [] };
  for (const entry of chronology) {
    if (result[entry.journey_id]) result[entry.journey_id].push(entry);
  }
  // Used by My Time: mileage-keyed narrative lookup.
  return result;
}

/**
 * Build an ordinal-keyed chronology index for ME Time narrative.
 * meDateToOrdinal is derived from me_time.csv rows at startup.
 *
 * Returns { Mordor: [{ordinal, entry}, ...], Return: [...], Hobbit: [...] }
 * sorted ascending by ordinal. When a journey has multiple events on the
 * same day, keeps the highest-mile (most advanced) one.
 *
 * Limitation: only covers me_date strings present in me_time.csv.
 * Gap-era events added to chronology.json in the future will need their
 * ordinals tracked in the source data.
 */
function buildChronologyByOrdinal(chronology, meDateToOrdinal) {
  const temp = { Mordor: new Map(), Return: new Map(), Hobbit: new Map() };
  for (const entry of chronology) {
    // null journey_id = gap event; skip from per-journey index
    if (!entry.journey_id || !temp[entry.journey_id]) continue;
    const ord = meDateToOrdinal.get(entry.me_date);
    if (ord === undefined) continue;
    const existing = temp[entry.journey_id].get(ord);
    if (!existing || entry.mile >= existing.mile) {
      temp[entry.journey_id].set(ord, entry);
    }
  }
  const result = {};
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    result[jid] = [...temp[jid].entries()]
      .sort(([a], [b]) => a - b)
      .map(([ordinal, entry]) => ({ ordinal, entry }));
  }
  return result;
}

/**
 * Build a global flat chronology index over ALL entries (all journey_ids
 * including null gap events).
 *
 * Multiple entries at the same ordinal are merged: texts are concatenated
 * and the first non-empty location is used.
 *
 * Used to drive the info panel during the inter-journey historical gap.
 */
function buildGlobalChronIndex(chronology, meDateToOrdinal) {
  const byOrd = new Map();
  for (const entry of chronology) {
    const ord = meDateToOrdinal.get(entry.me_date);
    if (ord === undefined) continue;
    if (!byOrd.has(ord)) {
      byOrd.set(ord, { me_date: entry.me_date, location: entry.location || '', text: entry.text || '' });
    } else {
      const merged = byOrd.get(ord);
      if (!merged.location && entry.location) merged.location = entry.location;
      if (entry.text) merged.text = merged.text ? merged.text + ' ' + entry.text : entry.text;
    }
  }
  return [...byOrd.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ordinal, entry]) => ({ ordinal, entry }));
}

/** Return the most recently passed global chronology entry at or before meOrdinal. */
function getGlobalChronEntry(meOrdinal, globalChronByOrdinal) {
  let best = null;
  for (const { ordinal, entry } of globalChronByOrdinal) {
    if (ordinal <= meOrdinal) best = entry;
    else break;
  }
  return best;
}

/**
 * Merge movement ordinals (from me_time.csv) with gap chronology ordinals
 * (from chronology.json) into a single sorted, deduplicated array for the
 * ME All Time timeline domain.
 */
function buildHybridMeOrdinals(meOrdinals, globalChronByOrdinal) {
  const set = new Set(meOrdinals);
  for (const { ordinal } of globalChronByOrdinal) set.add(ordinal);
  return [...set].sort((a, b) => a - b);
}

/* ── Chronology lookup ─────────────────────────────────────────────── */

/**
 * My Time: select the most recently reached chronology entry by
 * fictional mileage. Entries without a mileage anchor are ignored.
 *
 * Same-mile events are resolved chronologically using me_date.
*/
/**
 * ME Time: select the most recently passed chronology entry by
 * Middle-earth date. Mileage is irrelevant, so null-mile entries
 * are valid here.
*/

function getChronologyEntryForMileage(jid, cumMiles, chronologyByJourney) {
  const entries = chronologyByJourney[jid];
  if (!entries || !entries.length) return null;

  let best = null;

  for (const entry of entries) {
    if (
      entry.mile !== null &&
      entry.mile <= cumMiles &&
      (
        !best ||
        entry.mile > best.mile ||
        (entry.mile === best.mile && entry.me_date > best.me_date)
      )
    ) {
      best = entry;
    }
  }

  return best;
}

/**
 * ME Time narrative: most recently passed story beat at or before meOrdinal.
 */
function getChronologyEntryForOrdinal(jid, meOrdinal, chronologyByOrdinal) {
  const beats = chronologyByOrdinal[jid];
  if (!beats || !beats.length) return null;
  
  let best = null;

  for (const { ordinal, entry } of beats) {
    if (ordinal <= meOrdinal) best = entry;
    else break;
  }

  return best;
}

/* ── ME Time resolver ────────────────────────────────────────────────── */

/**
 * Given the current ME ordinal and the pre-built index, resolve journey states.
 *
 * For each journey:
 *   - Find the two me_time rows bracketing this ordinal.
 *   - Interpolate cumulative miles linearly in ordinal space.
 *   - If ordinal is before/after the journey's range, mark unstarted/completed.
 *
 * Returns { Mordor: {status, cumMiles, chronologyEntry}, Return: {...}, Hobbit: {...} }
 */
function buildMEJourneyStates(meOrdinal, byOrdinal, meOrdinals, meJourneyOrdinalRanges, chronologyByOrdinal) {
  const js = {};

  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    const range = meJourneyOrdinalRanges[jid];

    if (!range) {
      js[jid] = { status: 'unstarted', cumMiles: 0, location: '' };
      continue;
    }

    if (meOrdinal < range.start) {
      js[jid] = { status: 'unstarted', cumMiles: 0, location: '' };
      continue;
    }

    if (meOrdinal >= range.end) {
      // Find the miles at the last ordinal for this journey
      const lastMiles = _getJourneyMilesAtOrdinal(jid, range.end, byOrdinal, meOrdinals);
      const chronologyEntry  = getChronologyEntryForOrdinal(jid, meOrdinal, chronologyByOrdinal);
      js[jid] = { status: 'completed', cumMiles: lastMiles, chronologyEntry };
      continue;
    }

    // Active: interpolate between bracketing ordinals
    const cumMiles = _interpolateMilesForJourney(jid, meOrdinal, byOrdinal, meOrdinals);

    // Detect pause: two consecutive journey ordinals with same miles
    const status = _detectPause(jid, meOrdinal, byOrdinal, meOrdinals) ? 'paused' : 'active';

    const chronologyEntry = getChronologyEntryForOrdinal(jid, meOrdinal, chronologyByOrdinal);

    js[jid] = { status, cumMiles, chronologyEntry };
  }

  return js;
}

function _getJourneyMilesAtOrdinal(jid, ordinal, byOrdinal, meOrdinals) {
  const entry = byOrdinal.get(ordinal);
  if (entry && entry[jid] !== undefined) return entry[jid];
  // Scan backwards for last known ordinal with this journey
  const idx = meOrdinals.indexOf(ordinal);
  for (let i = (idx >= 0 ? idx : meOrdinals.length) - 1; i >= 0; i--) {
    const e = byOrdinal.get(meOrdinals[i]);
    if (e && e[jid] !== undefined) return e[jid];
  }
  return 0;
}

function _interpolateMilesForJourney(jid, meOrdinal, byOrdinal, meOrdinals) {
  // Find the journey-specific ordinals that bracket meOrdinal
  const jidOrdinals = meOrdinals.filter(o => {
    const e = byOrdinal.get(o);
    return e && e[jid] !== undefined;
  });

  if (!jidOrdinals.length) return 0;
  if (meOrdinal <= jidOrdinals[0]) return byOrdinal.get(jidOrdinals[0])[jid];
  if (meOrdinal >= jidOrdinals[jidOrdinals.length - 1]) {
    return byOrdinal.get(jidOrdinals[jidOrdinals.length - 1])[jid];
  }

  // Binary search for bracket
  let lo = 0, hi = jidOrdinals.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (jidOrdinals[mid] <= meOrdinal) lo = mid; else hi = mid;
  }

  const ordA = jidOrdinals[lo];
  const ordB = jidOrdinals[hi];
  const milesA = byOrdinal.get(ordA)[jid];
  const milesB = byOrdinal.get(ordB)[jid];

  if (ordA === ordB) return milesA;
  const t = (meOrdinal - ordA) / (ordB - ordA);
  return milesA + t * (milesB - milesA);
}

function _detectPause(jid, meOrdinal, byOrdinal, meOrdinals) {
  const jidOrdinals = meOrdinals.filter(o => {
    const e = byOrdinal.get(o);
    return e && e[jid] !== undefined;
  });

  let lo = -1;
  for (let i = 0; i < jidOrdinals.length - 1; i++) {
    if (jidOrdinals[i] <= meOrdinal && meOrdinal < jidOrdinals[i + 1]) { lo = i; break; }
  }
  if (lo < 0) return false;

  const milesA = byOrdinal.get(jidOrdinals[lo])[jid];
  const milesB = byOrdinal.get(jidOrdinals[lo + 1])[jid];
  return milesA === milesB;
}

/* ── Journey state builders ──────────────────────────────────────────── */

function computeJourneyState(jid, date, cumulativeByDate, journeyRanges, chronologyByJourney) {
  const range = journeyRanges[jid];
  if (!range) return null;

  let status;
  if      (date < range.start) status = 'unstarted';
  else if (date >= range.end)   status = 'completed';
  else                         status = 'active';

  if (jid === 'Mordor' && date >= FRODO_PAUSE.start && date <= FRODO_PAUSE.end) {
    status = 'paused';
  }

  const cumMiles = cumulativeByDate[date]?.[jid] ?? 0;
  const chronologyEntry = (status !== 'unstarted' && cumMiles > 0)
    ? getChronologyEntryForMileage(jid, cumMiles, chronologyByJourney)
    : null;

  return { status, cumMiles, chronologyEntry };
}

function buildMyTimeJourneyStates(date, cumulativeByDate, journeyRanges, chronologyByJourney) {
  const js = {};
  for (const jid of ['Mordor', 'Return', 'Hobbit']) {
    js[jid] = computeJourneyState(jid, date, cumulativeByDate, journeyRanges, chronologyByJourney);
  }
  return js;
}

/* ── Info panel ──────────────────────────────────────────────────────── */
const fmt      = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtMiles = n => n >= 1 ? `${Math.round(n).toLocaleString()} mi` : `${n.toFixed(1)} mi`;

/**
 * Format a ME date string for display. Does NOT parse it as a Gregorian date.
 * Handles: "YYYY-MM-DD", "1 Lithe", "Midyear's Day", "Overlithe",
 *          "2 Lithe", "Yule 1", "Yule 2".
 */
function _fmtMEDate(meDate) {
  if (!meDate) return '—';
  // Year-only precision (e.g. "2944") → "T.A. 2944"
  if (/^\d{4}$/.test(meDate)) return `T.A. ${meDate}`;
  // Special named days ("1 Lithe", "Midyear's Day", etc.) — display as-is
  if (!/^\d{4}-/.test(meDate)) return meDate;
  const [y, m, d] = meDate.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}, T.A. ${y}`;
}

function updateInfoPanel(clockMode, journeyMode, dateKey, journeyStates, ordinalToMeDate, globalChronEntry, isTimelineEnd) {
  // Date display
  let displayDate;
  if (clockMode === 'ME') {
    const meDate = typeof dateKey === 'number'
      ? (ordinalToMeDate.get(dateKey) || null)
      : dateKey;
    displayDate = _fmtMEDate(meDate);
  } else {
    displayDate = dateKey ? fmt.format(_parseDate(dateKey)) : '—';
  }
  document.getElementById('info-date').textContent = displayDate;

  // Timeline state badges
  const isFrodoPause = clockMode === 'MY'
    && dateKey >= FRODO_PAUSE.start
    && dateKey <= FRODO_PAUSE.end;

  const isBetweenJourneys =
    clockMode === 'MY'
    && journeyMode === 'ALL'
    && !isTimelineEnd
    && !Object.values(journeyStates).some(
      js => js?.status === 'active' || js?.status === 'paused'
    );

  const isMEGap =
    clockMode === 'ME'
    && journeyMode === 'ALL'
    && !isTimelineEnd
    && globalChronEntry
    && !Object.values(journeyStates).some(
      js => js?.status === 'active' || js?.status === 'paused'
    );

  document.getElementById('pause-badge').hidden   = !isFrodoPause;
  document.getElementById('between-badge').hidden = !isBetweenJourneys;
  document.getElementById('gap-badge').hidden     = !isMEGap;

  // Update the info panel based on the current journey mode
  if (journeyMode === 'ALL') {
    _updateAllTimePanel(clockMode, journeyStates, globalChronEntry, isTimelineEnd);
  } else {
    _updateSinglePanel(journeyMode, journeyStates, isFrodoPause);
  }
}

function _buildInfoBlock(jid, js, cfg, showWhoFirst, statusLabel) {
  const chronologyEntry = js?.chronologyEntry;
  const location = chronologyEntry?.location ?? '';
  const narrative = chronologyEntry?.text ?? '';
  
  const hasMiles  = (js?.cumMiles ?? 0) > 0;
  const milesText = hasMiles ? fmtMiles(js.cumMiles) : '';
  
  const suffix = statusLabel 
    ? ` · <span class="info-status" style="color:${cfg.color}">${statusLabel}</span>` 
    : '';

  let html = `<div class="info-block" data-jid="${jid}">`;
  if (showWhoFirst) {
    html += `<div class="info-who info-who--header"><span style="color:${cfg.color}">${cfg.character}</span> · ${milesText}${suffix}</div>`;
    if (location) html += `<div class="info-place">${location}</div>`;
  } else {
    if (location) html += `<div class="info-place">${location}</div>`;
    html += `<div class="info-who info-who--header"><span style="color:${cfg.color}">${cfg.character}</span> · ${milesText}${suffix}</div>`;
  }
  if (narrative) html += `<div class="info-event">${narrative}</div>`;
  html += '</div>';
  return html;
}

function _updateAllTimePanel(clockMode, journeyStates, globalChronEntry, isTimelineEnd) {
  const activeJids = ['Mordor', 'Return', 'Hobbit'].filter(
    j => journeyStates[j]?.status === 'active' || journeyStates[j]?.status === 'paused'
  );

  const infoBody = document.getElementById('info-body');

  // At the end of the full timeline, show the journeys that constitute
  // the ending of that clock rather than "Between journeys".
  if (isTimelineEnd) {
    const terminalJids = clockMode === 'ME'
      ? ['Mordor', 'Return']
      : ['Hobbit'];

    infoBody.innerHTML = terminalJids.map(jid => {
      const js  = journeyStates[jid];
      const cfg = JOURNEY_CONFIG[jid];
      return _buildInfoBlock(jid, js, cfg, true, '✓ Complete');
    }).join('');

    _renderProgressBars(journeyStates, null);
    return;
  }

  if (activeJids.length === 0) {
    // During the historical gap (and between My Time journeys), show the most
    // recently passed chronology event rather than a generic message.
    if (clockMode === 'ME' && globalChronEntry) {
      const loc  = globalChronEntry.location || '';
      const text = globalChronEntry.text     || '';
      let html = '';
      if (loc)  html += `<div class="info-place">${loc}</div>`;
      if (text) html += `<div class="info-event">${text}</div>`;
      infoBody.innerHTML = html || '<p class="info-gap">Between journeys</p>';
    } else {
      infoBody.innerHTML = '<p class="info-gap">Between journeys</p>';
    }
    _renderProgressBars(journeyStates, null);
    return;
  }

  // Show one block per active journey (ME Time may have concurrent journeys)
  const multi = clockMode === 'ME' && activeJids.length > 1;
  infoBody.innerHTML = activeJids.map(jid => {
    const js  = journeyStates[jid];
    const cfg = JOURNEY_CONFIG[jid];
    return _buildInfoBlock(jid, js, cfg, multi, '');
  }).join('');

  _renderProgressBars(journeyStates, null);
}

function _updateSinglePanel(jid, journeyStates, isFrodoPause) {
  const js  = journeyStates[jid];
  const cfg = JOURNEY_CONFIG[jid];
  const infoBody = document.getElementById('info-body');

  if (!js || js.status === 'unstarted') {
    infoBody.innerHTML = `<p class="info-gap">${cfg.character}'s journey hasn't started yet</p>`;
    _renderProgressBars(journeyStates, jid);
    return;
  }

  const statusLabel =
    isFrodoPause             ? '⏸ Challenge paused'
    : js.status === 'completed' ? '✓ Complete'
    : '';

  infoBody.innerHTML = _buildInfoBlock(jid, js, cfg, false, statusLabel);
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

function _parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ── Bootstrap ───────────────────────────────────────────────────────── */

document.body.classList.add('loading');

// ── Welcome modal — opens on every visit, no persistent state ─────────
(function () {
  const dlg = document.getElementById('welcome-dialog');
  if (dlg?.showModal) {
    dlg.showModal();
    dlg.addEventListener('click', () => dlg.close());
  }
}());

const panZoom = new PanZoomController(
  document.getElementById('map-viewport'),
  document.getElementById('map-layer'),
  document.getElementById('reset-view')
);

document.getElementById('zoom-in').addEventListener('click',  () => panZoom.zoom(1.5));
document.getElementById('zoom-out').addEventListener('click', () => panZoom.zoom(1 / 1.5));

fetchData().then(({ walking, meTime, journeys, routes, chronology }) => {

  // ── My Time ───────────────────────────────────────────────────────
  const cumulativeByDate  = buildCumulativeByDate(walking);
  const journeyRanges     = buildJourneyRanges(journeys);

  const projectStart      = Object.values(journeyRanges).map(r => r.start).sort()[0];
  const projectEnd        = Object.values(journeyRanges).map(r => r.end).sort().pop();
  const myCalDates        = generateCalendarDates(projectStart, projectEnd);

  // ── ME Time ───────────────────────────────────────────────────────
  const chronologyByJourney = buildChronologyByJourney(chronology);
  const {
    meOrdinals,
    ordinalToMeDate,
    byOrdinal,
    meJourneyOrdinalRanges,
  } = buildMETimeIndex(meTime);

  // Seed meDateToOrdinal from me_time.csv movement rows
  const meDateToOrdinal = new Map();
  for (const row of meTime) {
    if (row.me_ordinal !== null && row.me_date) meDateToOrdinal.set(row.me_date, row.me_ordinal);
  }

  // Extend both maps with computed ordinals for chronology dates not in me_time.csv.
  // This covers gap events, post-journey narrative, and year-only dates.
  for (const entry of chronology) {
    if (!meDateToOrdinal.has(entry.me_date)) {
      const ord = _meAbsOrdFromDate(entry.me_date);
      if (ord !== null) {
        meDateToOrdinal.set(entry.me_date, ord);
        // ordinalToMeDate is a Map returned by buildMETimeIndex; mutating is safe
        if (!ordinalToMeDate.has(ord)) ordinalToMeDate.set(ord, entry.me_date);
      }
    }
  }

  // Global flat index over all chronology entries — drives gap narrative display
  const globalChronByOrdinal = buildGlobalChronIndex(chronology, meDateToOrdinal);

  // Hybrid ordinal domain for ME Time All mode:
  // movement ordinals (daily) ∪ gap chronology ordinals (sparse)
  const hybridMeOrdinals = buildHybridMeOrdinals(meOrdinals, globalChronByOrdinal);

  const chronologyByOrdinal = buildChronologyByOrdinal(chronology, meDateToOrdinal);

  // ── Map ───────────────────────────────────────────────────────────
  const mapCtrl = new MapController(document.getElementById('overlay'), routes);

  // ── Timeline ──────────────────────────────────────────────────────
  const timeline = new TimelineController(
    myCalDates, journeyRanges,
    document.getElementById('timeline'),
    document.getElementById('tl-start'),
    document.getElementById('tl-end')
  );

  // ── State ─────────────────────────────────────────────────────────
  let currentMode = 'ALL';
  let clockMode   = 'MY';

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
        // hybridMeOrdinals: movement days (daily) + gap chronology events (sparse)
        timeline.setCalendar(hybridMeOrdinals, meJourneyOrdinalRanges, ordinalToMeDate);
      } else {
        timeline.setCalendar(myCalDates, journeyRanges, null);
      }
      _updatePauseRange();
      _updateNavButtons();
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
      _updatePauseRange();
      _updateNavButtons();
    });

    btn.addEventListener('keydown', e => {
      const btns = [...document.querySelectorAll('.mode-btn')];
      const idx  = btns.indexOf(e.currentTarget);
      if (e.key === 'ArrowRight') { btns[(idx + 1) % btns.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { btns[(idx - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
    });
  });

  // ── Play / Prev / Next ────────────────────────────────────────────
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

  document.getElementById('tl-prev').addEventListener('click', () => timeline.setIndex(timeline.index - 1));
  document.getElementById('tl-next').addEventListener('click', () => timeline.setIndex(timeline.index + 1));

  function _updateNavButtons() {
    const prevBtn = document.getElementById('tl-prev');
    const nextBtn = document.getElementById('tl-next');
    if (prevBtn) prevBtn.disabled = timeline.index === 0;
    if (nextBtn) nextBtn.disabled = timeline.index === timeline.maxIndex;
  }

  // ── Speed control ─────────────────────────────────────────────────
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mult = parseFloat(btn.dataset.speed);
      timeline.setSpeed(mult);
      document.querySelectorAll('.speed-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });

  // ── Pause/break range highlights on timeline ─────────────────────
  function _updatePauseRange() {
    const wrap = document.querySelector('.tl-slider-wrap');
    if (!wrap) return;

    // Remove all existing break indicators, then recreate for current state
    wrap.querySelectorAll('.tl-pause-range').forEach(el => el.remove());

    function addBreak(startKey, endKey) {
      const pos = timeline.getPauseHighlight(startKey, endKey);
      if (!pos) return;
      const el = document.createElement('div');
      el.className = 'tl-pause-range';
      el.setAttribute('aria-hidden', 'true');
      el.style.left  = `${pos.left}%`;
      el.style.width = `${pos.width}%`;
      wrap.appendChild(el);
    }

    if (clockMode === 'MY') {
      if (currentMode === 'ALL' || currentMode === 'Mordor') {
        addBreak(FRODO_PAUSE.start, FRODO_PAUSE.end);
      }
      if (currentMode === 'ALL') {
        addBreak(FRODO_ARAGORN_BREAK.start, FRODO_ARAGORN_BREAK.end);
        addBreak(ARAGORN_BILBO_BREAK.start,  ARAGORN_BILBO_BREAK.end);
      }
    } else {
      // ME Time: ordinals passed directly to getPauseHighlight
      const jidsToBreak = currentMode === 'ALL' ? Object.keys(ME_BREAK_ORDINALS) : [currentMode];
      for (const jid of jidsToBreak) {
        for (const [startOrd, endOrd] of (ME_BREAK_ORDINALS[jid] || [])) {
          addBreak(startOrd, endOrd);
        }
      }
    }
  }

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ')          { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); timeline.setIndex(timeline.index + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); timeline.setIndex(timeline.index - 1); }
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    playBtn.style.display = 'none';
  }

  // ── Unified render ────────────────────────────────────────────────
  function onDateChange(_idx, dateKey) {
    if (dateKey === null || dateKey === undefined) return;

    let journeyStates;
    let globalChronEntry = null;
    if (clockMode === 'ME') {
      journeyStates = buildMEJourneyStates(
        dateKey, byOrdinal, meOrdinals, meJourneyOrdinalRanges, chronologyByOrdinal
      );
      globalChronEntry = getGlobalChronEntry(dateKey, globalChronByOrdinal);
    } else {
      journeyStates = buildMyTimeJourneyStates(dateKey, cumulativeByDate, journeyRanges, chronologyByJourney);
    }

    mapCtrl.update({ mode: currentMode, journeyStates });
    const isTimelineEnd = timeline.index === timeline.maxIndex;
    updateInfoPanel(clockMode, currentMode, dateKey, journeyStates, ordinalToMeDate, globalChronEntry, isTimelineEnd);
    _updateNavButtons();
  }

  timeline.onChange(onDateChange);

  document.body.classList.remove('loading');
  _updatePauseRange();
  onDateChange(0, myCalDates[0]);

}).catch(err => {
  document.body.classList.remove('loading');
  document.getElementById('info-location').textContent = 'Failed to load data';
  console.error('Walk to Mordor: data load error', err);
});