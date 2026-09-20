# `Walk to Mordor` Route Builder

## How loading/saving works

**Loading:** On startup the tool auto-fetches `../../docs/static/data/routes.json` (resolved from the project root when the server is run from the project root). The **"Open file…"** button accepts a local `.json` file via `<input type="file">`. Both paths run through `normalise()`, which handles the legacy flat-array format **and** the current `{geometry, anchors}` format, and **strips redundant `x`/`y` from anchors** on load.

**Saving:** Three options:

- **"Copy JSON"** writes to the clipboard.
- **"Download"** triggers a browser file download named `routes.json`.
- **"Save As…"** uses the File System Access API (Chrome/Edge).

All three call `cleanRoutes()`, which produces anchors with only `{geom_idx, mile, location?}` — no `x`, no `y`. Production files are never touched automatically.

**Session continuity:** All three journeys stay in memory throughout the session. Switching journeys is instant and lossless. The `beforeunload` event warns of unsaved changes.

---

## How geometry coordinates are calculated

`toSVG(clientX, clientY)` calls `overlay.getScreenCTM().inverse()` on the SVG overlay element. `getScreenCTM()` returns the complete transform chain from SVG viewBox coordinates to screen coordinates, including the CSS `translate/scale` zoom/pan transform applied to `canvas-layer`.

The inverse converts any screen click back to viewBox coordinates (`0–3200, 0–2400`) regardless of current zoom level, pan offset, or window size. Coordinates are rounded to one decimal place.

---

## How anchor indices are maintained

Anchors store `geom_idx` — an index into `geometry[]`.

When a geometry point is **deleted** at index `k`:

- Any anchor at index `k` is removed first (after confirmation).
- All anchors with `geom_idx > k` are decremented by 1.

When geometry points are **appended** (DRAW mode), existing anchor indices are unaffected.

When **re-anchoring after a full retrace:** old anchors are not automatically migrated. Their `geom_idx` values are invalid until manually re-pinned. The ANCHOR list shows a validation warning for any anchor whose `geom_idx ≥ geometry.length`. The user re-clicks each landmark in ANCHOR mode and assigns the new index.

---

## Limitations

1. **Must be served from the project root.** The tool fetches from `../../docs/static/…` relative paths; open it at `http://localhost:PORT/assets/tools/route-builder.html`, not from the `tools` directory directly.
2. **No undo beyond `Backspace` in DRAW mode.** Backspace removes the last appended geometry point; there is no multi-level undo stack.
3. **No point dragging.** Misplaced points must be deleted and re-added. Append-only workflow.
4. **Geometry dot rendering in ANCHOR mode** renders all points as small circles. At 500+ points on a large map, this remains performant (SVG handles it), but the dots will appear dense at low zoom.
5. **Anchor validation is visual-only.** A warning text appears, but saving invalid data is not blocked. This is intentional; the user may want to save mid-work states.

---

## Instructions for tracing a route over multiple sessions

### Session 1 — Setup

1. Start the server from the project root:
   ```bash
   python -m http.server 8793
   ```
2. Open
   ```bash
   http://localhost:8793/assets/tools/route-builder.html
   ```
3. Click "From project" (auto-runs on load). Existing sparse geometry appears.
4. Select the journey to trace (e.g., Frodo — Mordor).
5. Optional: click "Clear Geometry…" to remove the old sparse geometry before retracing (anchors are preserved as metadata).

### Tracing

1. Press D (or click DRAW).
2. Zoom into the starting region with mouse wheel.
3. Drag to pan to Bag End.
4. Click the exact location → a geometry point appears.
5. Continue clicking, following roads, rivers, and mountain passes.
6. Press Backspace to remove the last point if you mis-click.
7. Switch to V (VIEW) periodically to see the full route.

### Saving

1. Press Ctrl+S or click "Download" after any tracing session.
2. Your browser downloads `routes.json`.
3. Copy the downloaded file over `routes.json`.

### Session 2 — Continue

1. Reload the tool.
2. Click "From project" to load the updated routes.json.
3. The existing geometry is restored. Press D and continue clicking from the last endpoint (shown as the gold dot).

### Re-anchoring after densification

1. Once the dense geometry is fully traced, press A (ANCHOR mode).
2. Zoom to a known location (e.g., Bree).
3. Click the geometry point at that location. The panel shows its geom_idx and SVG coordinates.
4. Enter mile `145`, location `Bree`. Press Enter or click "Create / Update Anchor".
5. Repeat for each calibration point.
6. The anchor list shows validation warnings if mileage order is broken.
7. Save when done.