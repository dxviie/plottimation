# Per-Frame Alignment Pipeline — Implementation Plan

This document plans the addition of a third `alignmentPipeline` mode — `"per-frame"` —
that lets the user upload N images, one per animation frame, instead of a single
frame-sheet photo. Each image is page-rectified independently and the rectified
results are stacked into a synthetic `baseRectifiedMat`, after which the existing
stabilization / ordering / appearance / export path runs unchanged.

This is an engineering plan, not user docs. User-facing copy belongs in
`documentation.md`; durable invariants belong in `AGENTS.md`.

## Locked Decisions

These were chosen up front so individual sessions do not need to relitigate them.

1. **Frame count = image count (Option 1A).** The number of uploaded images is the
   number of animation frames. Internally treated as a flat `1 × N` strip. The
   `Frame Rows` / `Frame Columns` Layout controls become display-only / disabled
   in per-frame mode.
2. **Rescale to common cell size (Option 2B).** After per-image page rectification,
   every cell is resized to a single common cell size (default: median rectified
   width × median rectified height). All cells in the synthetic `baseRectifiedMat`
   are the same size; stabilization and extraction work on uniform cells.
3. **Persist per-image overrides (Option 3A).** Page-corner overrides and
   post-rotation are saved per image using indexed settings keys
   (`page_corner_override_tl_0`, `..._tl_1`, …, `per_frame_post_rotation_deg_0`,
   …). Settings files round-trip cleanly.
4. **Single image in per-frame mode is allowed (Option 4A).** Loading a single
   image in per-frame mode produces a 1-frame animation. The user can add more
   images via the strip afterwards.

## Architectural Summary

- Add `"per-frame"` as a third value for `config.alignmentPipeline`.
- New per-image source structure under `state.source.images[]`; the existing
  `state.source.image` / `manualPageContour` / `dragUrl` / etc. become *views into*
  the active image (`state.source.images[state.source.activeImageIndex]`) so most
  legacy callers keep working.
- Factor out the page-detection + page-rectification block from
  `pipeline.js → runPipeline` into a reusable `rectifySinglePage(...)`. Markers and
  markerless modes continue to call it as before; per-frame mode calls it once per
  uploaded image.
- New `pipeline.js → runPerFramePipeline(images, config, …)`:
  1. Run `rectifySinglePage` per image (respecting per-image page-corner and
     post-rotation overrides).
  2. Pick a common cell size (median of rectified sizes; clamped so the composite
     fits within the existing large-image limits).
  3. Resize each rectified Mat to the common cell size.
  4. Concatenate horizontally into a single composite `rectifiedMat`
     (`cellWidth * N × cellHeight × 1` row × N column grid).
  5. Synthesize an `alignmentInfo` whose marker lookup contains regular corner
     intersections at the known cell boundaries.
  6. Return the same result shape that `runPipeline` returns.
- `runPipeline` becomes a dispatcher: per-frame → `runPerFramePipeline`; otherwise
  the existing markers/markerless path.
- Downstream (frame extraction, stabilization, ordering, appearance, export) does
  not branch on per-frame mode. The synthetic sheet looks like a 1×N markerless
  sheet to those subsystems.

## Phases

Each phase below is self-contained: it lists scope, files, acceptance criteria,
and explicit out-of-scope items so individual implementation sessions do not
overreach.

---

### Phase 0 — Spike (½ day, throwaway)

**Goal:** prove that a tiled composite Mat plus existing stabilization can produce
a working animation end-to-end, before doing any real refactoring.

**Scope:**
- Hardcode two demo images (or load two arbitrary images via the existing file
  input twice in sequence).
- Add a dev-only code path that builds a `2 × cellW × cellH` composite Mat from
  the two latest rectified Mats and stuffs it into `state.geometry.baseRectifiedMat`
  alongside a fake `alignmentInfo` with two cell corners.
- Confirm: preview animates, stabilization measurement runs, GIF export produces
  the expected 2-frame GIF.

**Files touched (throwaway code, do not merge as-is):**
- `js/app.js` — small scratch block, clearly marked `// SPIKE: per-frame, remove`.

**Acceptance:**
- Two-frame GIF exports correctly.
- Stabilization runs without errors and offsets are non-zero when the two source
  images are deliberately misregistered.
- Nothing about the marker/markerless code paths regresses for a normal source
  image.

**Out of scope:**
- Real UI, real `state.source.images[]`, settings, i18n, mobile, memory trimming.
- Any code that should survive into Phase 2+.

**Rollback:** delete the spike block; no other files were touched.

---

### Phase 1 — Refactor: extract `rectifySinglePage`

**Goal:** isolate the page-detection + page-rectification stage of `runPipeline`
into a reusable helper without behavioral change to markers or markerless mode.

**Scope:**
- In `js/pipeline.js`, factor lines roughly 250–385 of `runPipeline` (page
  detection through `applyPostRectificationRotation`) into a new function:
  ```
  rectifySinglePage(sourceCanvas, perPageConfig, requestId, throwIfAborted)
    -> { rectifiedWarp, pageQuad, pageQuadSource, pageWarpPreviewCanvas,
         pageWarpPreviewWidth, pageWarpPreviewHeight,
         useNearIdentityRectification }
  ```
  Caller is responsible for Mat lifetime of the returned `rectifiedWarp`.
- `perPageConfig` is a strict subset of the full config: `paperAspect`,
  `manualPageQuadPoints`, `fallbackPageQuadPoints`, `thresholdMethod`,
  `thresholdOffset`, `postRotationDeg`, `lightOnDarkDesign`, `alignmentPipeline`
  (still needed because near-identity fast-path branches on markerless).
- `runPipeline` is unchanged behaviorally; it just calls `rectifySinglePage` and
  then proceeds with the existing grid-rectification + alignment + extraction
  path.

**Files touched:**
- `js/pipeline.js`

**Acceptance:**
- Demo round-trip on every demo image listed in `index.html#loadDemoSelect`
  produces visually identical previews to `main`.
- Settings save/load round-trip is byte-identical.
- No new console errors. Memory profile during a large-image reprocess does not
  regress (peak Mat count unchanged).
- `runPipeline` is meaningfully shorter; `rectifySinglePage` has a clear contract
  documented in JSDoc.

**Out of scope:**
- Any per-frame mode code.
- Any change to `runPipeline`'s output shape.
- Any change to the marker/markerless detector functions.

**As built (Phase 1 — COMPLETE):**
- `rectifySinglePage` was implemented in `js/pipeline.js`, taking the
  **full `config` object** rather than the trimmed `perPageConfig` subset
  proposed above. The block it owns (`buildFrameGridRectification_fromCrosses`,
  via the marker path) needs the frame-grid fields (`useRectifiedAsSource`,
  `frameCols`, `frameRows`, `crossRoiScale`, `paperMarginXPx`, `paperMarginYPx`,
  `boundarySensitivity`, `boundaryPersistencePx`) in addition to the page-stage
  fields, so passing a strict subset would have meant re-threading the entire
  grid config anyway. The JSDoc on `rectifySinglePage` enumerates exactly which
  `config` keys it reads. Phase 3's per-image call therefore passes a shallow
  copy of `config` with per-image overrides (see Phase 3, step 2).
- Actual signature/return:
  ```
  rectifySinglePage(sourceCanvas, config, requestId, throwIfAborted)
    -> { rectifiedWarp, pageQuad, pageQuadSource, pageWarpPreviewCanvas,
         pageWarpPreviewWidth, pageWarpPreviewHeight,
         useNearIdentityRectification, threshVal, pageSizeLow, pageSizeHigh }
  ```
  `threshVal`, `pageSizeLow`, and `pageSizeHigh` were added beyond the proposed
  shape so `runPipeline` can keep building byte-identical status text.
- Mat lifetime: `rectifySinglePage` releases every intermediate Mat in its own
  `finally` and releases `rectifiedWarp` in its `catch` on failure, so the
  caller only ever owns a successfully returned `rectifiedWarp`. `runPipeline`'s
  `finally` shrank to just deleting `rectifiedWarp.visionMat` / `styledMat`.
- Error handling: `rectifySinglePage` attaches `error.partialResult` for
  page-stage failures; `runPipeline` only fills it in for later
  (alignment/extraction) failures, guarded by `!error.partialResult`.
- Phase 0 spike code in `js/app.js` (the `SPIKE_PER_FRAME` constants and the
  2-frame composite block in `processCurrentImage`) was removed as part of this
  work. Verified via demo round-trip; markers and markerless modes unchanged.

---

### Phase 2 — State: `state.source.images[]` and active-image accessor

**Goal:** introduce per-image source state without yet adding any UI or pipeline
support. Existing markers/markerless flows continue to use the active image
transparently.

**Scope:**
- In `js/dom-state.js`, extend `state.source`:
  ```
  images: [],            // [{ image, filename, mimeType, ownedObjectUrl, dragUrl,
                         //    canvas, manualPageContour, postRotationDeg,
                         //    rectifiedMatCache: null, rectifiedDirty: true }]
  activeImageIndex: 0,
  ```
- Add accessor helpers (likely in a new tiny module `js/source-images.js`, or
  inline in `dom-state.js`):
  - `getActiveSourceImage(state)` returns the active entry, or `null`.
  - `setActiveSourceImage(state, index)`.
  - `releaseAllSourceImages(state)` revokes object URLs and clears Mats.
- Mutate `load-controller.js → loadImageSource` to push the loaded image into
  `state.source.images` as a single-entry array and set `activeImageIndex = 0`,
  while *also* keeping the existing `state.source.image / filename / dragUrl /
  manualPageContour` fields populated. The legacy fields become projections of
  the active entry for the duration of the migration.
- No mode logic yet — `state.source.images[]` always has exactly 0 or 1 entries
  during this phase.

**Files touched:**
- `js/dom-state.js`
- `js/load-controller.js`
- new `js/source-images.js` (optional)

**Acceptance:**
- Markers and markerless modes still load the same demos and round-trip
  identically.
- `releaseOwnedSourceUrl` is replaced by / wraps `releaseAllSourceImages`; no
  blob URLs leak across reloads.
- Loading a new image clears prior `images[]` entries.

**Out of scope:**
- Multi-file `handleFile`. (That arrives in Phase 4.)
- Per-image overrides. (Phase 5.)
- Any UI for the image strip.

**As built (Phase 2 — COMPLETE):**
- `state.source` gained `images: []` and `activeImageIndex: 0` in `js/dom-state.js`.
  The legacy `state.source.image / filename / mimeType / dragUrl / ownedObjectUrl /
  canvas / manualPageContour` fields stay populated and are treated as projections
  of the active entry.
- New module `js/source-images.js` exports:
  - `createSourceImageEntry(fields)` — builds an entry with the documented shape
    (`image, filename, mimeType, ownedObjectUrl, dragUrl, canvas,
    manualPageContour, postRotationDeg, rectifiedMatCache: null,
    rectifiedDirty: true`).
  - `getActiveSourceImage(state)` — active entry or `null`.
  - `setActiveSourceImage(state, index)` — clamps and returns the new active entry.
  - `releaseAllSourceImages(state)` — revokes per-entry blob URLs, frees cached
    Mats, resets `images` to `[]` and `activeImageIndex` to `0`.
  - `releaseEntryRectifiedCache(entry)` — helper that frees either a bare `Mat` or
    a `{ visionMat, styledMat }` rectified-warp cache (added beyond the proposed
    list because Phase 9 / Phase 3 caches use that shape).
- `js/load-controller.js`:
  - `loadImageSource`'s `image.onload` now registers the loaded image as the single
    entry (`state.source.images = [entry]; activeImageIndex = 0`). The entry's
    `canvas` aliases the shared `state.source.canvas` (only one image exists in this
    phase); the entry's `manualPageContour` is mirrored from the legacy field after
    any settings file is applied. **Note for Phase 4:** this canvas aliasing is only
    safe while `images[]` holds at most one entry — Phase 4 must give each entry its
    own dedicated canvas (see Phase 4 scope).
  - `releaseOwnedSourceUrl(state)` now wraps `releaseAllSourceImages(state)` before
    revoking the legacy `ownedObjectUrl`, so loading a new image clears prior
    `images[]` entries and no blob URLs leak across reloads.
- No mode logic, multi-file handling, per-image overrides, or strip UI were added.
  Markers/markerless flows are unaffected (changes are additive; the legacy fields
  the pipeline reads remain authoritative).

---

### Phase 3 — Pipeline: `runPerFramePipeline` + dispatcher

**Goal:** wire the new per-frame pipeline behind the existing `runPipeline`
contract. No UI yet — exercised through manual config hacking or unit-level
testing.

**Scope:**
- In `js/pipeline.js`:
  - Add `runPerFramePipeline(images, config, requestId, throwIfAborted)`:
    1. For each `image` in `images`, build a per-image `sourceCanvas` (already
       in `state.source.images[i].canvas`).
    2. Call `rectifySinglePage(sourceCanvas, perImageConfig, …)`. As implemented
       in Phase 1, `rectifySinglePage` takes the **full `config` object** (not a
       trimmed `perPageConfig` subset) and reads the page-relevant fields plus the
       frame-grid fields needed by the marker rectifier; its JSDoc lists exactly
       which keys it consumes. So `perImageConfig` is a shallow copy of the base
       `config` with the per-image fields overridden:
       ```
       const perImageConfig = {
         ...config,
         // Treat each rectified page as a whole working sheet (no cross sweep,
         // no frame-grid crop). rectifySinglePage branches its near-identity
         // fast path and grid rectification on this value, so per-frame mode
         // must alias to "markerless" here rather than passing "per-frame".
         alignmentPipeline: "markerless",
         // Per-image page-corner override (source-space quad) for this image.
         manualPageQuadPoints: images[i].manualPageContour ?? null,
         // No live threshold-preview fallback when rectifying per image.
         fallbackPageQuadPoints: null,
         // Per-image Post-Rotation (Phase 5 stores this on the image entry).
         postRotationDeg: images[i].postRotationDeg ?? 0,
       };
       ```
       The base `config.alignmentPipeline` stays `"per-frame"` for the dispatcher
       and for downstream readConfig/UI gating; only the per-image copy handed to
       `rectifySinglePage` is aliased to `"markerless"`.
    3. From each call, take `result.rectifiedWarp`; the caller owns it (per the
       Phase 1 contract). Use `rectifiedWarp.styledMat` as the cell source and
       delete `rectifiedWarp.visionMat` immediately (per-frame mode does not run
       per-image alignment on it). Each `styledMat` is deleted after it has been
       resized/copied into the composite in step 6.
    4. Decide common cell size:
       - `cellW = clamp(median(rectifiedWidths), MIN_CELL_PX, MAX_CELL_PX)`
       - `cellH = clamp(median(rectifiedHeights), MIN_CELL_PX, MAX_CELL_PX)`
       - Limits chosen to keep `cellW × cellH × N` inside existing
         `RECTIFIED_PREVIEW_LONG_EDGE_PX` / large-image-memory budgets.
    5. Resize each rectified `styledMat` to `(cellW, cellH)` using the
       interpolation flag from `config.exportOptions.resampling`.
    6. Allocate composite `rectifiedMat` of size `(cellW * N, cellH)` and copy
       each resized cell into its column.
    7. Synthesize `alignmentInfo` whose corner intersection points are at
       `(i * cellW, 0)`, `((i+1) * cellW, 0)`, `(i * cellW, cellH)`,
       `((i+1) * cellW, cellH)` for `i = 0 … N`. The structure should match what
       `buildUnrefinedCrossRegionInfo` produces for a 1×N markerless sheet.
    8. Build a `rectifiedCanvas` preview from the composite Mat using the
       existing `matToPreviewCanvas`.
    9. Extract frame canvases via the existing `sliceRectifiedToCanvases` so the
       returned `frames` array matches what marker/markerless modes produce.
   10. Return the same result shape as `runPipeline`: `{ frames, rectifiedCanvas,
       rectifiedMat, pagePreviewCanvas: null, pagePreviewGridQuad: null,
       pagePreviewGridBounds: null, alignmentInfo, statusText, pageQuadPoints:
       null, pageQuadSource: "per-frame", rectifiedDownloadUsesRawSource: false }`.
       (`pagePreview*` is null because there is no single "page" in per-frame mode;
       Phase 7 will hide the corresponding UI.)
  - Modify `runPipeline` so its first lines dispatch:
    ```
    if (config.alignmentPipeline === "per-frame") {
      return runPerFramePipeline(state.source.images, config, requestId, throwIfAborted);
    }
    ```
    `runPipeline` should not import `state` directly; pass `images` from the
    caller. So update the caller in `app.js → processCurrentImage` to pass
    `state.source.images` alongside `state.source.canvas`.
- `app.js → readConfig`: when the per-frame radio is checked, set
  `alignmentPipeline: "per-frame"`. Also force `useCrossAlignment: false` for
  this mode (the synthetic grid does not need refinement).

**Files touched:**
- `js/pipeline.js`
- `js/app.js` (readConfig + the `runPipeline` invocation site only)

**Acceptance:**
- With per-frame mode forced via dev console (`dom.alignmentPipelineMarkerless.checked = false; dom.alignmentPipelineMarkers.checked = false; /* + manual flag */`)
  and two images loaded via dev hack, a 2-frame animation appears in
  `gifPreviewCanvas` and exports correctly.
- Stabilization measurement runs on the synthetic sheet without errors.
- Markers/markerless flows continue to work unchanged.
- Memory: `MAX_CELL_PX` and median selection keep peak Mat size bounded.

**Out of scope:**
- The "per-frame" radio button itself (Phase 6 adds it).
- Multi-file upload (Phase 4).
- Per-image overrides (Phase 5).
- UI strip (Phase 7).
- Settings persistence (Phase 8).

---

### Phase 4 — Multi-file upload (`handleFile`, drop zone)

**Goal:** support dragging or selecting multiple image files at once. Always
populate `state.source.images[]`; never silently drop additional images.

**Scope:**
- `js/load-controller.js → handleFile`: when multiple image files are present in
  the drag payload (or file input), build per-image entries for each. Sibling
  `_settings.txt` is still matched against the first image's filename and applied
  once after all images are loaded.
- **Per-entry canvases (carried over from Phase 2):** Phase 2 left each entry's
  `canvas` aliasing the shared `state.source.canvas`, which is only safe while
  `images[]` holds at most one entry. Phase 4 introduces multiple entries, so each
  entry **must** get its own dedicated source-resolution `canvas` drawn from its
  own decoded image (do not reuse the shared `state.source.canvas` for more than
  one entry, or every cell in `runPerFramePipeline` would rectify the same image).
  The legacy `state.source.canvas` / `state.source.image` should then project the
  **active** entry (e.g. point `state.source.canvas` at
  `images[activeImageIndex].canvas`), so legacy single-image callers keep reading
  the active image. Update the single-image load path accordingly so it produces a
  per-entry canvas too, keeping one code path for the 1-image and N-image cases.
- `index.html`: `<input id="fileInput" … multiple />` and drop-zone copy update.
- `js/i18n.js`: drop-zone copy strings for per-frame mode (and a generic copy
  that mentions multi-file support; localize across all locale tables).
- After multi-file load, if the currently selected pipeline is **not**
  `"per-frame"`, the app should auto-switch to `"per-frame"` (this is the most
  forgiving UX). Otherwise the user just dropped 12 files into a markerless app
  and would silently lose 11 of them.
- Single-image drops continue to behave exactly as before.

**Files touched:**
- `index.html`
- `js/load-controller.js`
- `js/i18n.js`

**Acceptance:**
- Drag-and-drop with 1 image: identical to current behavior.
- Drag-and-drop with N images: app switches to per-frame mode, loads all N,
  active index is 0, animation appears.
- File picker with multi-select: same behavior as drag.
- Mixed drag (N images + 1 `_settings.txt`): settings file is applied against
  the first image's name; per-frame mode is selected if N > 1.
- Each loaded entry has its own distinct `canvas` (no two entries share a canvas
  reference, and none alias the shared `state.source.canvas` once N > 1).

**Out of scope:**
- Strip UI (Phase 7).
- Reorder/delete buttons (Phase 7).
- Settings-driven per-image overrides on reload (Phase 8 plus Phase 5).

---

### Phase 5 — Per-image page-corner and post-rotation overrides

**Goal:** make the existing Page Corners editor and Post-Rotation control operate
on the *active* image in per-frame mode.

**Scope:**
- Route `state.source.manualPageContour` reads/writes through the active image
  in per-frame mode. Concretely, where `app.js` currently writes
  `state.source.manualPageContour = …`, replace with a helper
  `setActiveManualPageContour(state, contour)` that:
  - in per-frame mode, writes to `state.source.images[activeIndex].manualPageContour`
    and also mirrors to the legacy field (so other read sites keep working);
  - in markers/markerless modes, writes the legacy field directly (no-op for
    `images[]`).
- Same treatment for `postRotationDeg` (per-image storage; the slider reads/writes
  the active image's value in per-frame mode).
- Switching active image redraws `rawCanvas`, Page Corners overlay, and
  Post-Rotation slider position to match the newly active image. The rectified
  preview / animation are *not* rebuilt on active-image switch — that is a UI
  navigation, not a config change.
- Page Detection Threshold remains a global control (acts on all per-frame
  images when reprocessing). Per-image threshold is out of scope for v1.

**Files touched:**
- `js/app.js` (Page Corners drag handlers, Post-Rotation handlers, redraws)
- `js/dom-state.js` (per-image fields added in Phase 2)
- `js/ui-controls.js` (active-image switching invalidations)

**Acceptance:**
- In per-frame mode with 3 images, the user can edit page corners on image #2
  without affecting images #1 or #3.
- Switching active image redraws the Page Corners overlay with that image's
  saved corners.
- Reprocessing uses every per-image override correctly.
- Markers/markerless modes are completely unaffected.

**Out of scope:**
- UI strip (Phase 7) — at this point active-image switching can be triggered by
  dev console (`state.source.activeImageIndex = 1; renderRawPreview();`).
- Persisting overrides to disk (Phase 8).

---

### Phase 6 — `alignmentPipeline` radio: add "per-frame"

**Goal:** expose per-frame mode via the existing Alignment Pipeline radio group
and wire mode-gated visibility.

**Scope:**
- `index.html`: add a third radio
  `#alignmentPipelinePerFrame` to `#alignmentPipelineField`.
- `js/dom-state.js`: add the DOM ref.
- `js/settings-defaults.js`: leave default as `"markers"`; add a sync line for
  the new radio.
- `js/ui-controls.js`: add to the change listeners; on switch into per-frame
  mode with `state.source.images.length === 0`, do not process; just wait for
  upload.
- `js/app.js → readConfig`: emit `"per-frame"` when the new radio is checked
  (already stubbed in Phase 3; this phase makes the radio real).
- Mode-gated visibility (audit and update):
  - **Disabled in per-frame mode:** all marker controls, all markerless gutter
    controls, Grid Edge Threshold, Grid Edge Run Length, marker editor,
    Rectified Grid `Pre`/`Post` toggle, Page Detection Threshold's "live
    preview" semantics (still functional but global).
  - **Enabled in per-frame mode:** stabilization (Neighbor / Median both work),
    Vertical Drift Compensation, Frame Corners overrides, ordering, appearance,
    export options, Layout's Frame Rows/Cols (display-only).
- `js/i18n.js`: new strings for the radio label, tooltip, and any mode-gated UI
  labels that diverge.
- Audit every `alignmentPipeline === "markerless"` site (≈30 in `app.js`) and
  classify:
  - **"markerless-only behavior"**: stays as `=== "markerless"`. Examples:
    markerless gutter chart, markerless phase debug, autocorrelation.
  - **"non-marker behavior"**: change to `!== "markers"` so per-frame inherits.
    Examples: stabilization availability, drift comp UI.
  - **"per-frame-disabled"**: add `&& alignmentPipeline !== "per-frame"` guard.
    Examples: Rectified Grid Pre/Post toggle visibility.

  Produce a checklist file (or inline TODO list) during this phase listing each
  classification decision; it makes the code review tractable.

**Files touched:**
- `index.html`
- `js/dom-state.js`
- `js/settings-defaults.js`
- `js/ui-controls.js`
- `js/app.js`
- `js/i18n.js`

**Acceptance:**
- Switching the radio between all three modes works without errors.
- Per-frame mode hides marker/markerless-specific UI cleanly (no orphan labels,
  no flashed empty panels).
- Markers and markerless modes still pass demo round-trips.
- Mobile single-viewer mode still behaves correctly across all three pipelines.

**Out of scope:**
- The image strip itself (Phase 7).
- Settings persistence (Phase 8).

---

### Phase 7 — Image strip UI

**Goal:** give the user a visible way to switch active image, see upload count,
reorder, and delete.

**Scope:**
- New section in `index.html`, visible only in per-frame mode. Likely placed
  inside the Photo control group below the drop zone, or as a new collapsible
  `#perFrameStripPanel`.
- Renders a horizontal scrollable strip of thumbnails (one per
  `state.source.images[i]`). Each thumbnail shows:
  - the image (small preview, square-cropped or letterboxed)
  - the frame number `1`, `2`, …
  - a delete (×) button on hover
  - active state highlighting
- Drag-to-reorder within the strip (HTML5 drag-and-drop API, scoped to the
  strip).
- Click selects active image.
- A `+` tile at the end accepts additional dropped or chosen images.
- New file `js/per-frame-strip.js` keeps strip rendering / event handling out of
  `app.js` and `ui-controls.js`.
- Mobile: the strip should still be usable in single-viewer mode. The strip can
  appear above the active raw photo viewer.
- Reorder triggers reprocessing (frame order changes).
- Delete triggers reprocessing.

**Files touched:**
- `index.html`
- `js/dom-state.js` (strip DOM refs)
- `js/ui-controls.js` (wire-up)
- new `js/per-frame-strip.js`
- `style.css` (strip + thumbnail styling)
- `js/i18n.js`

**Acceptance:**
- Upload 5 images, reorder them, the animation reflects the new order on next
  preview tick.
- Delete an image; the animation rebuilds with N-1 frames.
- Active-image highlighting matches `state.source.activeImageIndex`.
- Mobile: strip is reachable and usable in the Page viewer tab.

**Out of scope:**
- Cross-strip drag (e.g. dragging a thumbnail out of the app).
- Bulk operations (multi-select delete).

---

### Phase 8 — Settings persistence for per-image state

**Goal:** make `_settings.txt` round-trip in per-frame mode.

**Scope:**
- `js/settings-io.js` — save side:
  - Emit `alignment_pipeline = per-frame`.
  - For each image `i = 0 … N-1`:
    - `page_corner_override_tl_i`, `_tr_i`, `_br_i`, `_bl_i` (only if that image
      has overrides; otherwise omit).
    - `per_frame_post_rotation_deg_i` (only if non-zero).
  - Emit `per_frame_image_count = N` so reload knows how many to expect.
- `js/settings-io.js` — load side:
  - Recognize `per_frame_image_count` to size the per-image override array
    before images themselves load.
  - On image load (single image first, additional images added later), apply the
    matching indexed overrides to the corresponding `state.source.images[i]`.
  - Backward-compat: legacy files without `per_frame_*` keys load with empty
    per-image overrides.
- Loading a saved per-frame project requires the user to re-upload all N images
  (we cannot save image data in the settings file). On load with no images yet,
  the saved per-image overrides are buffered into a pending structure and
  applied as images arrive (matching by upload order — index 0 → first uploaded
  image). Document this clearly in `documentation.md`.

**Files touched:**
- `js/settings-io.js`
- `js/dom-state.js` (pending overrides buffer)
- `js/load-controller.js` (apply pending overrides as images arrive)
- `documentation.md`

**Acceptance:**
- Edit per-image corners + post-rotation across 3 images; save settings; reload
  the page; re-upload the same 3 images; per-image overrides reappear correctly.
- Legacy `_settings.txt` files (markers / markerless) still load without
  regression.
- The saved file remains a TSV that humans can inspect.

**Out of scope:**
- Saving image data inside the settings file.
- Auto-matching by filename across reloads (matching is strictly by upload
  order in v1).

---

### Phase 9 — Memory and polish

**Goal:** make per-frame mode safe on large inputs, finish documentation, and
write the AGENTS.md invariants.

**Scope:**
- `js/app.js → trimCachesBeforeReprocess`: release any per-image rectified Mat
  cache entries that are not the active image. The composite `baseRectifiedMat`
  is the only large Mat that needs to stay live between reprocesses.
- `js/pipeline.js → runPerFramePipeline`: bound the cell size such that
  `cellW × N × cellH` cannot exceed the same memory ceiling that the existing
  large-image path uses for `pageSizeHigh`. If the median would exceed the
  ceiling, scale the cell size down uniformly.
- Mobile single-viewer audit: confirm the Page tab works with the new strip and
  active-image switching.
- `documentation.md`: add a "Per-Frame Pipeline" section explaining when to use
  it, how to upload multiple images, per-image page-corner editing, and the
  reload story for saved settings.
- `AGENTS.md`: add invariants:
  - Per-image page-corner overrides are post-load, pre-rectification. They feed
    into `rectifySinglePage` for that image only.
  - Active-image switching is a UI navigation and does NOT trigger reprocessing.
  - Per-frame mode disables marker and markerless-specific controls.
  - Per-frame `_settings.txt` round-trip requires re-uploading images in the
    same order.
- `llm_readme.md`: add a "Per-Frame Pipeline" section that mirrors the marker /
  markerless sections and points back to this plan.

**Files touched:**
- `js/app.js`
- `js/pipeline.js`
- `documentation.md`
- `AGENTS.md`
- `llm_readme.md`

**Acceptance:**
- Loading 20 images at 4000×3000 each does not crash the tab (cell size scaled
  down).
- Switching active image is instant (no reprocessing).
- Mobile UX is acceptable.
- Documentation is current and the AGENTS.md invariants are stated.

**Out of scope:**
- New features beyond what Phases 0–8 added.

---

## Cross-Cutting Invariants (apply across every phase)

- Markers and markerless modes are not allowed to regress at any phase boundary.
  Run a demo round-trip for at least one markers demo and one markerless demo
  before declaring a phase done.
- `_settings.txt` files saved by `main` must still load in every phase up to and
  including Phase 8. Per-image keys are additive.
- Mat lifetime stays explicit. Every new Mat allocation in
  `runPerFramePipeline` has a matching `.delete()` in a `finally` block.
- i18n strings are added to **all** locale tables, not just English.
- Mobile single-viewer mode is checked at Phase 6, Phase 7, and Phase 9.

## Files Touched (cumulative reference)

| File | Phases |
|------|--------|
| `index.html` | 4, 6, 7 |
| `style.css` | 7 |
| `js/dom-state.js` | 2, 6, 7, 8 |
| `js/load-controller.js` | 2, 4, 8 |
| `js/pipeline.js` | 1, 3, 9 |
| `js/app.js` | 3, 5, 6, 9 |
| `js/ui-controls.js` | 5, 6, 7 |
| `js/settings-io.js` | 8 |
| `js/settings-defaults.js` | 6 |
| `js/i18n.js` | 4, 6, 7 |
| `js/per-frame-strip.js` (new) | 7 |
| `js/source-images.js` (new, optional) | 2 |
| `documentation.md` | 8, 9 |
| `AGENTS.md` | 9 |
| `llm_readme.md` | 9 |

## Open Items Deliberately Deferred

- Per-image Page Detection Threshold (v1 keeps it global).
- Auto-matching saved per-image overrides by filename on reload (v1 matches by
  upload order).
- Saving image data inside settings files (out of scope; settings stay text).
- Per-image grid mode (every image as its own 1×1; out of scope — frame count
  equals image count).
