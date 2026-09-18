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

    // Active pointer tracking (covers mouse + touch + pen)
    this._ptrs       = new Map();  // pointerId → {x, y}
    this._panAnchor  = null;       // {px, py, tx, ty} at single-pointer drag start
    this._pinchStart = null;       // {d0, cx0, cy0, s0, tx0, ty0} at two-pointer pinch start

    this.MIN_SCALE = 0.4;
    this.MAX_SCALE = 8;

    this._bindEvents();
    this._applyTransform();
  }

  // ── Events ────────────────────────────────────────────────────────

  _bindEvents() {
    this._viewport.addEventListener('wheel',         e => this._onWheel(e),      { passive: false });
    this._viewport.addEventListener('pointerdown',   e => this._onPointerdown(e));
    this._viewport.addEventListener('pointermove',   e => this._onPointermove(e));
    this._viewport.addEventListener('pointerup',     e => this._onPointerup(e));
    this._viewport.addEventListener('pointercancel', e => this._onPointerup(e));
    this._viewport.addEventListener('dblclick', e => {
      if (!e.target.closest('.info-panel, .pause-badge, .reset-view, .zoom-btn')) this.reset();
    });
    if (this._resetBtn) {
      this._resetBtn.addEventListener('click', () => this.reset());
    }
  }

  // ── Wheel zoom ────────────────────────────────────────────────────

  _onWheel(e) {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    if (e.deltaMode === 2) delta *= 400;
    const rect = this._viewport.getBoundingClientRect();
    this._zoomAt(Math.exp(-delta * 0.0008), e.clientX - rect.left, e.clientY - rect.top);
  }

  // ── Pointer handlers ──────────────────────────────────────────────

  _onPointerdown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.info-panel, .pause-badge, .reset-view, .zoom-btn')) return;

    this._viewport.setPointerCapture(e.pointerId);
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._ptrs.size === 1) {
      this._panAnchor  = { px: e.clientX, py: e.clientY, tx: this._tx, ty: this._ty };
      this._pinchStart = null;
      this._viewport.classList.add('dragging');
    } else if (this._ptrs.size === 2) {
      this._panAnchor = null;
      this._viewport.classList.remove('dragging');
      this._beginPinch();
    }
  }

  _onPointermove(e) {
    if (!this._ptrs.has(e.pointerId)) return;
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._ptrs.size === 1 && this._panAnchor) {
      const pt = this._ptrs.get(e.pointerId);
      this._tx = this._panAnchor.tx + (pt.x - this._panAnchor.px);
      this._ty = this._panAnchor.ty + (pt.y - this._panAnchor.py);
      this._applyTransform();
    } else if (this._ptrs.size === 2 && this._pinchStart) {
      this._handlePinch();
    }
  }

  _onPointerup(e) {
    this._ptrs.delete(e.pointerId);

    if (this._ptrs.size === 0) {
      this._panAnchor  = null;
      this._pinchStart = null;
      this._viewport.classList.remove('dragging');
    } else if (this._ptrs.size === 1 && this._pinchStart) {
      // One finger lifted from pinch — restart pan from remaining pointer
      this._pinchStart = null;
      const [, pt]     = [...this._ptrs.entries()][0];
      this._panAnchor  = { px: pt.x, py: pt.y, tx: this._tx, ty: this._ty };
    }
  }

  // ── Pinch helpers ─────────────────────────────────────────────────

  _beginPinch() {
    const pts  = [...this._ptrs.values()];
    const cx   = (pts[0].x + pts[1].x) / 2;
    const cy   = (pts[0].y + pts[1].y) / 2;
    const d0   = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const rect = this._viewport.getBoundingClientRect();
    this._pinchStart = {
      d0,
      cx0: cx - rect.left,
      cy0: cy - rect.top,
      s0:  this._scale,
      tx0: this._tx,
      ty0: this._ty,
    };
  }

  _handlePinch() {
    const pts      = [...this._ptrs.values()];
    const cx       = (pts[0].x + pts[1].x) / 2;
    const cy       = (pts[0].y + pts[1].y) / 2;
    const dist     = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const { d0, cx0, cy0, s0, tx0, ty0 } = this._pinchStart;
    const rect     = this._viewport.getBoundingClientRect();
    const vcx      = cx - rect.left;
    const vcy      = cy - rect.top;
    const newScale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, s0 * dist / d0));
    const ratio    = newScale / s0;
    this._scale = newScale;
    // Keep the pinch centre stable while scale + translation both change
    this._tx    = vcx - (cx0 - tx0) * ratio;
    this._ty    = vcy - (cy0 - ty0) * ratio;
    this._applyTransform();
  }

  // ── Public zoom API ───────────────────────────────────────────────

  /** Zoom by factor, centred on the viewport centre (for button use). */
  zoom(factor) {
    const rect = this._viewport.getBoundingClientRect();
    this._zoomAt(factor, rect.width / 2, rect.height / 2);
  }

  _zoomAt(factor, cx, cy) {
    const newScale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, this._scale * factor));
    if (newScale === this._scale) return;
    const ratio = newScale / this._scale;
    this._tx    = cx - (cx - this._tx) * ratio;
    this._ty    = cy - (cy - this._ty) * ratio;
    this._scale = newScale;
    this._applyTransform();
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

    if (this._resetBtn) {
      const isDefault = Math.abs(this._scale - 1) < 0.01
                     && Math.abs(this._tx) < 1
                     && Math.abs(this._ty) < 1;
      this._resetBtn.classList.toggle('visible', !isDefault);
    }
  }
}

window.PanZoomController = PanZoomController;
