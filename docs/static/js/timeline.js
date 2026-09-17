/**
 * timeline.js — date sequence and slider management for Walk to Mordor
 */
'use strict';

class TimelineController {
  /**
   * @param {Array}           allDates         - sorted array of date strings (MY) or numeric ordinals (ME)
   * @param {object}          journeyRanges    - { jid: { start, end } } — same type as allDates elements
   * @param {object}          segmentsByJourney
   * @param {HTMLInputElement} sliderEl
   * @param {HTMLElement}     startLabel
   * @param {HTMLElement}     endLabel
   * @param {HTMLElement}     ticksEl
   * @param {Map|null}        ordinalToMeDate  - if set, values are ME date strings for display
   */
  constructor(allDates, journeyRanges, segmentsByJourney, sliderEl, startLabel, endLabel, ticksEl, ordinalToMeDate = null) {
    this._allDates       = allDates;
    this._ranges         = journeyRanges;
    this._segments       = segmentsByJourney;
    this._slider         = sliderEl;
    this._startLbl       = startLabel;
    this._endLbl         = endLabel;
    this._ticksEl        = ticksEl;
    this._ordinalToMeDate = ordinalToMeDate;  // null in MY mode

    this._mode     = 'ALL';
    this._dates    = allDates;
    this._index    = 0;
    this._playing  = false;
    this._raf      = null;
    this._lastTime = 0;
    this._msPerDay = 35;
    this._onChange = null;

    this._slider.min   = 0;
    this._slider.max   = this._dates.length - 1;
    this._slider.value = 0;

    this._slider.addEventListener('input', () => {
      this._index = parseInt(this._slider.value, 10);
      this._emit();
    });

    this._updateLabels();
    this._drawTicks();
  }

  setMode(mode) {
    const wasPlaying = this._playing;
    if (wasPlaying) this.pause();

    this._mode  = mode;
    this._dates = this._datesForMode(mode);

    this._slider.max   = this._dates.length - 1;
    this._slider.value = 0;
    this._index        = 0;

    this._updateLabels();
    this._drawTicks();
    this._emit();

    if (wasPlaying) this.play();
  }

  /**
   * Replace the full date/range/segment dataset.
   * Called when switching clock modes.
   * ordinalToMeDate is a Map<ordinal, me_date string> or null for My Time.
   */
  setCalendar(allDates, ranges, segmentsByJourney, ordinalToMeDate) {
    const wasPlaying = this._playing;
    if (wasPlaying) this.pause();

    this._allDates        = allDates;
    this._ranges          = ranges;
    this._segments        = segmentsByJourney;
    this._ordinalToMeDate = ordinalToMeDate || null;

    this._dates = this._datesForMode(this._mode);
    this._index = 0;

    this._slider.max   = Math.max(0, this._dates.length - 1);
    this._slider.value = 0;

    this._updateLabels();
    this._drawTicks();
    this._emit();

    if (wasPlaying) this.play();
  }

  setIndex(i) {
    this._index = Math.max(0, Math.min(i, this._dates.length - 1));
    this._slider.value = this._index;
    this._emit();
  }

  get currentDate() { return this._dates[this._index] ?? null; }
  get index()       { return this._index; }
  get maxIndex()    { return this._dates.length - 1; }
  get playing()     { return this._playing; }

  onChange(fn) { this._onChange = fn; }

  play() {
    if (this._playing) return;
    if (this._index >= this._dates.length - 1) this.setIndex(0);
    this._playing = true;
    this._lastTime = 0;
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  pause() {
    this._playing = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  toggle() { this._playing ? this.pause() : this.play(); }

  _tick(time) {
    if (!this._playing) return;
    if (this._lastTime && time - this._lastTime >= this._msPerDay) {
      this._lastTime = time;
      if (this._index < this._dates.length - 1) {
        this._index++;
        this._slider.value = this._index;
        this._emit();
      } else {
        this.pause();
        return;
      }
    } else if (!this._lastTime) {
      this._lastTime = time;
    }
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  _emit() {
    if (this._onChange) this._onChange(this._index, this._dates[this._index]);
  }

  _datesForMode(mode) {
    if (mode === 'ALL') return this._allDates;
    const range = this._ranges[mode];
    if (!range) return this._allDates;
    // Works for both string dates and numeric ordinals — comparison operators
    // are valid for both.
    return this._allDates.filter(d => d >= range.start && d <= range.end);
  }

  _updateLabels() {
    if (!this._dates.length) return;
    this._startLbl.textContent = this._formatEntry(this._dates[0]);
    this._endLbl.textContent   = this._formatEntry(this._dates[this._dates.length - 1]);
  }

  /**
   * Format a single timeline entry for the start/end labels.
   * MY mode: date string → "Mar 2024"
   * ME mode: ordinal → look up me_date string → display it
   */
  _formatEntry(entry) {
    if (this._ordinalToMeDate) {
      // ME mode: entry is a numeric ordinal
      const meDate = this._ordinalToMeDate.get(entry);
      if (!meDate) return String(entry);
      // Special named days
      if (!/^\d{4}-/.test(meDate)) return meDate;
      const [y, m] = meDate.split('-').map(Number);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[m - 1]} T.A. ${y}`;
    }
    // MY mode: entry is a "YYYY-MM-DD" string
    return _fmtDateShort(entry);
  }

  _drawTicks() {
    if (!this._ticksEl) return;
    this._ticksEl.innerHTML = '';

    // ME mode: no segment ticks (segments are My Time constructs)
    if (this._ordinalToMeDate) return;

    const segs = this._mode === 'ALL'
      ? Object.values(this._segments).flat()
      : (this._segments[this._mode] || []);

    const total = this._dates.length - 1;
    if (total <= 0) return;

    for (const seg of segs) {
      const startIdx = this._dates.indexOf(seg.start_date);
      if (startIdx < 0) continue;
      const pct  = (startIdx / total) * 100;
      const tick = document.createElement('div');
      tick.className  = 'tl-tick';
      tick.style.left = `${pct}%`;
      this._ticksEl.appendChild(tick);
    }
  }
}

function _fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m] = dateStr.split('-').map(Number);
  // Safe Gregorian formatting — My Time dates are always valid Gregorian
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

window.TimelineController = TimelineController;