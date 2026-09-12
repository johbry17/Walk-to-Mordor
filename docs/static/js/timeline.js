/**
 * timeline.js — date sequence and slider management for Walk to Mordor
 */
'use strict';

class TimelineController {
  /**
   * @param {string[]}  allDates  - sorted array of ALL date strings in project range
   * @param {object}    journeyRanges - { Mordor:{start,end}, Return:{start,end}, Hobbit:{start,end} }
   * @param {HTMLInputElement} sliderEl
   * @param {HTMLElement} startLabel
   * @param {HTMLElement} endLabel
   * @param {HTMLElement} ticksEl
   * @param {object}    segmentsByJourney - { Mordor:[{start_date,end_date}], ... }
   */
  constructor(allDates, journeyRanges, segmentsByJourney, sliderEl, startLabel, endLabel, ticksEl) {
    this._allDates  = allDates;          // full 806-day sequence
    this._ranges    = journeyRanges;
    this._segments  = segmentsByJourney;
    this._slider    = sliderEl;
    this._startLbl  = startLabel;
    this._endLbl    = endLabel;
    this._ticksEl   = ticksEl;

    this._mode      = 'ALL';
    this._dates     = allDates;          // active date sequence
    this._index     = 0;
    this._playing   = false;
    this._raf       = null;
    this._lastTime  = 0;
    this._msPerDay  = 35;                // playback speed: ms per calendar day

    this._onChange  = null;              // callback(index, date)

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

    this._mode = mode;
    this._dates = this._datesForMode(mode);

    this._slider.max   = this._dates.length - 1;
    this._slider.value = 0;
    this._index        = 0;

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

  get currentDate() { return this._dates[this._index] || null; }
  get index()       { return this._index; }
  get maxIndex()    { return this._dates.length - 1; }
  get playing()     { return this._playing; }

  onChange(fn) { this._onChange = fn; }

  play() {
    if (this._playing) return;
    // Wrap-around at end
    if (this._index >= this._dates.length - 1) this.setIndex(0);
    this._playing = true;
    this._lastTime = 0;
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  pause() {
    this._playing = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  toggle() {
    this._playing ? this.pause() : this.play();
  }

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
    return this._allDates.filter(d => d >= range.start && d <= range.end);
  }

  _updateLabels() {
    if (!this._dates.length) return;
    this._startLbl.textContent = _fmtDateShort(this._dates[0]);
    this._endLbl.textContent   = _fmtDateShort(this._dates[this._dates.length - 1]);
  }

  _drawTicks() {
    if (!this._ticksEl) return;
    this._ticksEl.innerHTML = '';
    const segs = this._mode === 'ALL'
      ? Object.values(this._segments).flat()
      : (this._segments[this._mode] || []);

    const total = this._dates.length - 1;
    if (total <= 0) return;

    for (const seg of segs) {
      const startIdx = this._dates.indexOf(seg.start_date);
      if (startIdx < 0) continue;
      const pct = (startIdx / total) * 100;
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = `${pct}%`;
      this._ticksEl.appendChild(tick);
    }
  }
}

function _fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Expose
window.TimelineController = TimelineController;
