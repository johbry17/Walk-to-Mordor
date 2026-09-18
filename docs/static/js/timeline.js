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
  constructor(allDates, journeyRanges, sliderEl, startLabel, endLabel, ordinalToMeDate = null) {
    this._allDates        = allDates;
    this._ranges          = journeyRanges;
    this._slider          = sliderEl;
    this._startLbl        = startLabel;
    this._endLbl          = endLabel;
    this._ordinalToMeDate = ordinalToMeDate;

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
    this._emit();

    if (wasPlaying) this.play();
  }

  setCalendar(allDates, ranges, ordinalToMeDate) {
    const wasPlaying = this._playing;
    if (wasPlaying) this.pause();

    this._allDates        = allDates;
    this._ranges          = ranges;
    this._ordinalToMeDate = ordinalToMeDate || null;

    this._dates = this._datesForMode(this._mode);
    this._index = 0;

    this._slider.max   = Math.max(0, this._dates.length - 1);
    this._slider.value = 0;

    this._updateLabels();
    this._emit();

    if (wasPlaying) this.play();
  }

  /** Adjust playback speed. 1× = base (35 ms/step). */
  setSpeed(multiplier) {
    this._msPerDay = Math.max(10, Math.round(35 / multiplier));
  }

  /**
   * Return {left, width} percentages for a date-range highlight on the slider.
   * Returns null if either date is absent from the current _dates array.
   */
  getPauseHighlight(startDate, endDate) {
    const total = this._dates.length - 1;
    if (total <= 0) return null;
    const s = this._dates.indexOf(startDate);
    const e = this._dates.indexOf(endDate);
    if (s < 0 || e < 0) return null;
    return { left: (s / total) * 100, width: Math.max(0.5, ((e - s) / total) * 100) };
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

  _formatEntry(entry) {
    if (this._ordinalToMeDate) {
      const meDate = this._ordinalToMeDate.get(entry);
      if (!meDate) return String(entry);
      if (!/^\d{4}-/.test(meDate)) return meDate;
      const [y, m] = meDate.split('-').map(Number);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[m - 1]} T.A. ${y}`;
    }
    return _fmtDateShort(entry);
  }
}

function _fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m] = dateStr.split('-').map(Number);
  // Safe Gregorian formatting — My Time dates are always valid Gregorian
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

window.TimelineController = TimelineController;