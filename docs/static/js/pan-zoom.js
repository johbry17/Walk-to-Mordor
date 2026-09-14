/**
 * pan-zoom.js — independent map zoom/pan controller for Walk to Mordor
 *
 * Owns presentation state only: { scale, tx, ty }
 * Has no knowledge of journey data, timeline, or route geometry.
 */
'use strict';

class PanZoomController {
  constructor(viewport, layer, resetBtn) {
    this._viewport = viewport;
    this._layer    = layer;
    this._resetBtn = resetBtn;

    this._scale = 1;
    this._tx    = 0;
    this._ty    = 0;

    this._dragging      = false;
    this._dragStartX    = 0;
    this._dragStartY    = 0;
    this._txAtDragStart = 0;
    this._tyAtDragStart = 0;

    this.MIN_SCALE = 0.4;
    this.MAX_SCALE = 8;

    this._bindEvents();
    this._applyTransform();
  }

  // ── Events ────────────────────────────────────────────────────────

  _bindEvents() {
    // passive: false so we can preventDefault and stop page scroll
    this._viewport.addEventListener('wheel',     e => this._onWheel(e),     { passive: false });
    this._viewport.addEventListener('mousedown', e => this._onMousedown(e));
    // mousemove/up on window so drags continue outside the viewport
    window.addEventListener('mousemove', e => this._onMousemove(e));
    window.addEventListener('mouseup',   ()  => this._onMouseup());

    // Double-click on the map resets view (guard: not on UI overlays)
    this._viewport.addEventListener('dblclick', e => {
      if (!e.target.closest('.info-panel, .pause-badge, .reset-view')) this.reset();
    });

    if (this._resetBtn) {
      this._resetBtn.addEventListener('click', () => this.reset());
    }
  }

  // ── Wheel zoom ────────────────────────────────────────────────────

  _onWheel(e) {
    e.preventDefault();

    // Normalise deltaY across deltaMode values (pixels / lines / pages)
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    if (e.deltaMode === 2) delta *= 400;

    const factor   = Math.exp(-delta * 0.0008);
    const newScale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, this._scale * factor));
    if (newScale === this._scale) return;

    // Keep the map point currently under the cursor fixed after the scale change.
    const rect  = this._viewport.getBoundingClientRect();
    const cx    = e.clientX - rect.left;
    const cy    = e.clientY - rect.top;
    const ratio = newScale / this._scale;

    this._tx    = cx - (cx - this._tx) * ratio;
    this._ty    = cy - (cy - this._ty) * ratio;
    this._scale = newScale;

    this._applyTransform();
  }

  // ── Pan ───────────────────────────────────────────────────────────

  _onMousedown(e) {
    if (e.button !== 0) return;
    // Do not start a drag when the pointer is over a UI overlay element
    if (e.target.closest('.info-panel, .pause-badge, .reset-view')) return;

    e.preventDefault();
    this._dragging      = true;
    this._dragStartX    = e.clientX;
    this._dragStartY    = e.clientY;
    this._txAtDragStart = this._tx;
    this._tyAtDragStart = this._ty;
    this._viewport.classList.add('dragging');
  }

  _onMousemove(e) {
    if (!this._dragging) return;
    this._tx = this._txAtDragStart + (e.clientX - this._dragStartX);
    this._ty = this._tyAtDragStart + (e.clientY - this._dragStartY);
    this._applyTransform();
  }

  _onMouseup() {
    if (!this._dragging) return;
    this._dragging = false;
    this._viewport.classList.remove('dragging');
  }

  // ── Reset ─────────────────────────────────────────────────────────

  reset() {
    this._scale = 1;
    this._tx    = 0;
    this._ty    = 0;
    this._applyTransform();
  }

  // ── Apply ─────────────────────────────────────────────────────────

  _applyTransform() {
    this._layer.style.transform =
      `translate(${this._tx}px, ${this._ty}px) scale(${this._scale})`;

    // Show reset button only when view differs from default
    if (this._resetBtn) {
      const isDefault = Math.abs(this._scale - 1) < 0.01
                     && Math.abs(this._tx) < 1
                     && Math.abs(this._ty) < 1;
      this._resetBtn.classList.toggle('visible', !isDefault);
    }
  }
}

window.PanZoomController = PanZoomController;
