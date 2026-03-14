# Plottimation Web Tool: LLM Handoff

## Purpose

`plottimation_webtool/` is a browser-based desktop tool for producing an animated GIF from a photograph or scan of a plotted animation frame-sheet.

The source sheet contains:

- a regular grid of animation frames
- 4 corner registration circles
- interior `+` registration marks

The tool:

1. loads a photo or scan of the sheet
2. finds and rectifies the page
3. finds the corner dots
4. rectifies to the dot-defined sheet coordinate system
5. optionally refines frame geometry with the interior `+` marks
6. previews the animation
7. exports an animated GIF

This tool is a friendlier successor to `plottimation_GIF_generator/`.

## Related directories

- `grid-animation-svg-generator/`
  Generates plotted frame-sheets and registration graphics.
- `plottimation_GIF_generator/`
  Original p5.js/OpenCV sketch that inspired this app.
- `plottimation_webtool/`
  Current HTML/CSS/JS application.

## Core design constraints

- The GIF tool should know as little as possible about the exact sheet design.
- It should depend primarily on:
  - frame columns
  - frame rows
  - sheet aspect ratio
- It should infer the marker lattice from equal spacing over the rectified sheet.
- It should not depend on exact plot margins, dot sizes, SVG generator constants, etc.
- Desktop browser only. Mobile is not a target.
- No p5.js in this tool.

## Main files

- `plottimation_webtool/index.html`
  UI structure.
- `plottimation_webtool/style.css`
  layout and styling.
- `plottimation_webtool/app.js`
  app logic, CV pipeline, preview logic, GIF export.
- `plottimation_webtool/opencv.js`
  local OpenCV.js runtime.
- `plottimation_webtool/gif.js`
  GIF encoder library.
- `plottimation_webtool/demo/mySrcImage.jpg`
  demo image loaded by the `Load Demo` button.

## Current UI

### Header

- Title: `Plottimation Tool`
- Subtitle line 1: `Build an animated GIF from a photo of a frame-sheet.`
- Subtitle line 2: `v.1.0 • Golan Levin, 3/2026`

### Sidebar panels

1. `Photo`
   - drag/drop zone
   - file picker
   - skinny `Load Demo` button

2. `Layout`
   - `Frame Columns`
   - `Frame Rows`
   - `Paper Size (Landscape)` preset menu
   - `Custom` width/height fields only visible when preset is `Custom`

3. `Detection & Alignment`
   - `Thresholding Method`
     - `Offset Peak`
     - `Otsu`
   - `Thresholding Offset`
   - `Cross Region Size`
   - `Use cross-based subpixel alignment`
   - `Use rectified as source`

4. `Appearance`
   - skinny `Reset` button in subpanel summary
   - `Brightness`
   - `Contrast`
   - `Vibrance`
   - `Resampling`

5. `Trim Output`
   - skinny `Reset` button in subpanel summary
   - crop left/right/top/bottom

6. `GIF Export Options`
   - `Frame Rate`
   - `Encoding Quality (lower is better)`
   - `Dithering`
   - `Use Global Palette`

7. `Status`
   - multiline text diagnostics

### Main viewer panels

- `Raw Photo`
  - shows uploaded image
  - header shows source filename in parentheses
  - overlays detected page contour in semi-transparent lime

- `Rectified Sheet`
  - shows the final rectified sheet preview

- `Cross Regions`
  - shows ROI tiles around expected interior `+` positions
  - grid is `(cols + 1) x (rows + 1)` with dotted placeholders for the 4 corner-dot slots

- `Animation Preview`
  - animated preview canvas
  - skinny `Export GIF` button in header
  - exported GIF image appears only after export

## Visual style

- neutral gray
- built-in browser fonts
- minimal styling
- subtle stripe background in preview stages before any image is loaded
- plain light gray stage background after an image is loaded
- collapsible subpanels use large `▶` / `▼` disclosure glyphs
- `Reset` buttons are normal weight, not bold

## Important UX behavior

- processing is automatic after image load
- there is no `Process Photo` button
- any relevant control change revokes and hides any previously exported GIF
- exported GIF preview should not remain visible if controls change
- the visible preview canvases are panel-sized previews only, not the data used internally for CV/export
- dragging `Raw Photo` or `Rectified Sheet` out uses full-resolution backing canvases
- dragging exported GIF out should preserve the friendly filename

## Current filename behavior

Exported GIF filenames now look like:

- `<sanitized_base>_anim_YYYYMMDD_HHMMSS_q10.gif`

Notes:

- `animation` was shortened to `anim`
- quality suffix is appended as `_q<quality>`
- basename is sanitized to remove spaces/junk

## Status panel fields

Currently includes:

- raw photo size
- paper threshold
- largest contour area as a percentage
- detection warp size
- extraction warp size
- rectified sheet size
- animation size
- frame source
- frames extracted
- cross alignment usage/fallback text

## Main DOM handles in `app.js`

Important `dom` fields:

- upload / demo
  - `dropZone`
  - `fileInput`
  - `loadDemoButton`

- layout
  - `paperPreset`
  - `customPaperFields`
  - `paperWidth`
  - `paperHeight`
  - `frameCols`
  - `frameRows`

- detection/alignment
  - `thresholdMethod`
  - `thresholdOffset`
  - `thresholdOffsetValue`
  - `crossRoiScale`
  - `crossRoiScaleValue`
  - `useCrossAlignment`
  - `useRectifiedAsSource`

- appearance
  - `brightness`
  - `brightnessValue`
  - `contrast`
  - `contrastValue`
  - `vibrance`
  - `vibranceValue`
  - `gifResampling`
  - `resetAppearanceButton`

- trim
  - `cropLeft`
  - `cropRight`
  - `cropTop`
  - `cropBottom`
  - `resetTrimButton`

- gif export
  - `fps`
  - `gifQuality`
  - `gifQualityValue`
  - `gifDither`
  - `gifGlobalPalette`
  - `exportButton`

- viewers
  - `rawCanvas`
  - `rawPhotoName`
  - `rectifiedCanvas`
  - `gifPreviewCanvas`
  - `gifImage`
  - `crossRoiGrid`

## Main state in `app.js`

Important `state` fields:

- `cvReady`
- `sourceImage`
- `sourceFilename`
- `exportedGifFilename`
- `sourceCanvas`
  - full-resolution uploaded image
- `baseRectifiedCanvas`
  - unadjusted rectified sheet canvas
- `adjustedRectifiedCanvas`
  - temp canvas for adjusted rectified preview
- `frameCanvases`
  - IMPORTANT: now treated as a lazy cache of base extracted frames
- `adjustedFrameCache`
  - lazy cache of appearance-adjusted preview/export frames
- `frameCount`
  - separate from `frameCanvases.length`, because the frame array may be sparse
- `rectifiedPreviewCanvas`
- `exportedGifUrl`
- `alignmentInfo`
- `rawPageContour`
- `processRequestId`
- `pendingProcess`
- `appearancePreviewRaf`
- `appearancePreviewNeedsRectified`

## High-level architecture

### Big change: preview is now lazy

This is very important.

The app used to batch-render all adjusted frames after many control changes. That caused bad UI stalls, especially around appearance edits.

Current architecture:

- geometry-affecting controls rerun the CV/rectification/extraction pipeline
- appearance changes do NOT rerun the full pipeline
- resampling changes do NOT rerun the full pipeline
- preview frames are extracted/rendered lazily on demand
- full all-frame generation happens mainly when exporting GIFs

This split is a major architectural change.

## Processing pipeline

### Entry point

`processCurrentImage(requestId = state.processRequestId)`

Used for geometry-changing controls and initial image load.

High-level:

1. read config
2. run CV pipeline from source image
3. cache:
   - base extracted frame canvases
   - base rectified sheet canvas
   - alignment info
   - page contour
4. invalidate appearance caches
5. refresh previews

### `runPipeline(sourceCanvas, config, requestId)`

Current `runPipeline(...)` no longer takes a pre-adjusted canvas.

It uses:

- `visionSrc = cv.imread(sourceCanvas)`
- `styledSrc = cv.imread(sourceCanvas)`

This means the geometry pipeline is based on raw source imagery, and appearance adjustments are now applied later/lazily rather than during the main extraction pass.

## Page detection / thresholding

Page detection pipeline:

1. grayscale
2. threshold
3. largest contour
4. quad approximation
5. corner ordering

Functions:

- `estimatePaperThreshold(grayImg, method, offset)`
- `findLargestQuad(binaryMat, totalArea)`
- `orderCorners(pts)`

### Thresholding controls

`Thresholding Method`:

- `Offset Peak`
- `Otsu`

`Thresholding Offset`:

- range `-128 .. 128`
- default `-20`

Behavior:

- `Offset Peak`: threshold = histogram peak + offset
- `Otsu`: threshold = Otsu result + offset

Otsu is available in this OpenCV.js build because `cv.THRESH_OTSU` is already used elsewhere.

## Split-resolution geometry architecture

This remains in place because the corner-dot detector was tuned to the original lower working scale.

### Detection warp

Still fixed at:

- `paperWidth * 100`
- `paperHeight * 100`

Purpose:

- preserve stable scale for corner-dot finding

### Extraction warp

Computed from:

- raw page quad area
- requested paper aspect ratio

Function:

- `estimateHighResPageWarpSize(quadAreaPx, paperWidthIn, paperHeightIn, pageSizeLow)`

This produces a larger page warp for output-oriented work.

## Perspective/homography helpers

`perspectiveWarp(...)` returns:

- `visionMat`
- `styledMat`
- `forwardTransform`
- `inverseTransform`

Helpers:

- `homographyMatToArray(mat)`
- `applyHomographyToPoint(point, homography)`
- `mapDotRectThroughHomography(dotRect, homography)`

These are used for the `Use rectified as source` / raw-source final rectification split.

## Final rectification modes

### `Use rectified as source` checked

Final dot-based rectification is sourced from the high-res page warp.

### `Use rectified as source` unchecked

Final dot-based rectification uses:

- raw source image
- high-res dot quad projected back through the inverse page homography

This is generally the more detail-preserving path and is now the default UI state.

## Corner-dot detection

Still based on the low-res detection warp.

Functions:

- `toLightnessGray(...)`
- `columnSums(...)`
- `rowSums(...)`
- `findFirstDipFromEdge(...)`
- `refineDotCentroid(...)`
- `findDotRect(...)`

Tuned constants:

- `IGNORE_PX`
- `DOT_DIM_PCT_COLS`
- `DOT_DIM_PCT_ROWS`
- `GUTTER_PCT`

These remain somewhat scale-sensitive, which is why the fixed detection warp scale is still retained.

## Rectified sheet + grid bounds

`rectifyByDots(...)` returns:

- `visionMat`
- `styledMat`
- `gridBounds`

`gridBounds` is critical because the final rectified sheet may include padding around the true dot rectangle in order to provide real pixel margins around edge cross ROIs.

The actual frame/cross lattice lives inside `gridBounds`, not necessarily across the full rectified image.

## Cross detection / alignment

Expected crosses:

- inferred as equal spacing over `gridBounds`
- `(cols + 1) x (rows + 1)` lattice
- four corners are dot anchors, not crosses

Functions:

- `getExpectedCrossLattice(...)`
- `getRectifiedCornerAnchors(...)`
- `buildCrossAlignmentData(...)`
- `buildUnrefinedCrossRegionInfo(...)`

### Cross Regions panel behavior

When cross alignment is ON:

- refined cross locations are computed
- panel shows ROI tiles with red crosshair at detected center
- accepted/rejected hover text appears

When cross alignment is OFF:

- refined locations are not computed
- ROI tiles are centered on nominal expected positions
- red crosshair sits at exact tile center
- hover text is suppressed

### Confidence / fallback policy

- weak/failed crosses are rejected
- ideal lattice positions are used as fallback
- corner dots are used as corner anchors
- if too many crosses are missing, pipeline falls back gracefully

## Subpixel refinement

Yes, the cross alignment path is truly subpixel.

Why:

- `getWeightedPeakIndex(...)` returns a fractional position
- `detectCrossAtExpectedPosition(...)` maps that fractional peak back to floating-point sheet coordinates
- those floating-point coordinates feed the per-frame quad extraction

This is subpixel estimation, not just integer snapping.

## Frame extraction

Current frame extraction still uses per-frame perspective warps.

Functions:

- `sliceRectifiedToCanvases(...)`
- `extractSingleFrameToCanvas(...)`
- `resolveFrameQuad(...)`
- `bilerpQuad(...)`

Important:

- `sliceRectifiedToCanvases(...)` is still used during the full geometry pipeline
- `extractSingleFrameToCanvas(...)` is also used later for lazy on-demand frame extraction

## Lazy preview architecture

This is one of the most important new sections.

### Base frame cache

`state.frameCanvases`

- stores base extracted frames
- may be sparse
- should be thought of as a lazy cache, not a guaranteed fully populated contiguous batch

### Base frame lookup

`getBaseFrameCanvas(index)`

- returns cached base frame if present
- otherwise:
  - uses cached `baseRectifiedCanvas`
  - uses cached `alignmentInfo`
  - uses current crop + resampling
  - extracts a single frame on demand
  - caches it in `state.frameCanvases[index]`

This is why `Resampling` can now be lazy.

### Adjusted frame cache

`state.adjustedFrameCache`

`getAdjustedFrameCanvas(index)`

- reads base frame via `getBaseFrameCanvas(index)`
- if appearance adjustments are zero, returns base frame
- otherwise applies appearance adjustments to a per-frame canvas lazily
- caches the adjusted result

### Preview loop

`drawCurrentGifPreview()`

- asks for the adjusted current frame lazily
- does not require all frames to be precomputed

`startGifPreviewLoop()`

- uses `state.frameCount` instead of assuming `frameCanvases.length` is a full batch

## Appearance pipeline

Appearance controls are now:

- `Brightness`
- `Contrast`
- `Vibrance`

Old `Saturation` is gone.

### Important implementation change

Appearance is now performed in a single OKLab pass.

Workflow per pixel:

1. `sRGB -> OKLab`
2. apply brightness on `L`
3. apply contrast curve on `L`
4. apply vibrance on chroma (`a`, `b`)
5. `OKLab -> sRGB`

This replaced the older mixture of canvas filters + multiple passes.

Functions:

- `applyVisualAdjustments(sourceCanvas, targetCanvas, filters)`
- `applyOklabAppearanceAdjustments(canvas, filters)`
- `srgbToOklab(...)`
- `oklabToSrgb(...)`
- `srgbToLinear(...)`
- `linearToSrgb(...)`

### Brightness

Brightness is perceptual:

- implemented as an OKLab `L` shift

### Contrast

Contrast is midpoint-preserving and now applied to OKLab `L`, not RGB channels.

Functions:

- `mapContrastSliderToCurveStrength(...)`
- `applyMidpointSCurve(value, k)`

Negative contrast:

- uses the inverse S-curve logic
- should truly reduce contrast instead of mirroring positive contrast

### Vibrance

Vibrance is adaptive, not plain saturation.

Behavior:

- boosts muted colors more
- leaves already vivid colors more stable
- implemented via OKLab chroma scaling with an adaptive `(1 - normalized_chroma)` style factor

Functions:

- `mapVibranceSliderToAmount(...)`

The vibrance strength mapping was made stronger than the original timid version.

### No-op shortcut

If `Brightness == 0 && Contrast == 0 && Vibrance == 0`, the OKLab appearance pass is skipped entirely.

## Appearance slider responsiveness

This changed multiple times; current state matters.

Current behavior:

- appearance slider `input` no longer does heavy work synchronously inside every DOM event
- slider input now:
  - revokes stale GIF
  - updates readouts
  - invalidates appearance cache
  - schedules one preview update via `requestAnimationFrame`
  - cancels stale in-flight geometry work

- the expensive rectified-sheet adjusted preview is deferred until slider release
- while dragging, the app mainly updates the current animation preview frame lazily

Implementation helpers:

- `scheduleAppearancePreviewUpdate(includeRectified = false)`
- `appearancePreviewRaf`
- `appearancePreviewNeedsRectified`

This was introduced because direct OKLab rendering inside every slider `input` callback made both the animation and the slider itself sluggish.

## Resampling behavior

`Resampling` now lives under `Appearance`, not `GIF Export Options`.

Options are runtime-populated in `populateResamplingOptions()`:

- `Balanced (Linear)`
- `Sharper (Cubic)`
- `Maximum Detail (Lanczos)` if `cv.INTER_LANCZOS4` exists in this OpenCV build

Important:

- Resampling no longer forces a full geometry rerun
- it now invalidates frame caches and lazily re-extracts preview frames from the cached rectified sheet/alignment data

This is an important recent improvement.

## GIF export options

Current user-facing options:

- `Frame Rate`
- `Encoding Quality (lower is better)`
- `Dithering`
- `Use Global Palette`

### Dithering choices

Curated list:

- `Off`
- `Standard (Floyd-Steinberg)`
- `Smooth (Floyd-Steinberg Serpentine)` default
- `Retro (Atkinson)`

### Encoding quality

Important:

- lower number = better quality / slower
- higher number = lower quality / faster

This is a property of the specific `gif.js` build in use.

### What export controls affect

- `Frame Rate`, `Encoding Quality`, `Dithering`, `Use Global Palette`
  do NOT require a geometry rerun

- Export uses `getAdjustedFrameCanvas(i)` across all frames at export time, so the full adjusted batch is effectively realized only when needed for GIF writing.

## Raw photo overlay

The `Raw Photo` panel now outlines the detected page contour with:

- semi-transparent lime stroke

The contour is stored in `state.rawPageContour` and redrawn on resize.

## Resize behavior

Previews maintain aspect ratio and redraw on resize.

Relevant functions:

- `renderCanvasFit(...)`
- `renderRawPreview()`
- `renderRectifiedPreview(...)`
- `drawCurrentGifPreview()`
- `rerenderPreviews()`

There were several past CSS/layout bugs around viewer drift and stale canvas resizing; current code attempts to avoid them by redrawing on resize.

## Drag/export behavior

- `Raw Photo` drag uses the full-resolution `state.sourceCanvas`
- `Rectified Sheet` drag uses the backing rectified canvas, not just the panel preview
- exported GIF drag uses `DownloadURL` with the friendly filename

## OpenCV.js runtime caveat

The project uses a local OpenCV.js build that appears older / asm.js style.

Known implication:

- not all OpenCV APIs are available
- earlier, `cv.getRectSubPix` was missing

So code should prefer conservative OpenCV APIs that are already known to work in this build.

## Important recent bug fixes / lessons

1. `smooth1D()` used to be a trailing moving average, which biased cross detections down-right.
   It is now centered.

2. Edge cross ROIs used to be sampled from images cropped too tightly, causing replicated-border junk.
   This was fixed by padding the rectified sheet and tracking `gridBounds`.

3. Cross Regions must remain useful both with alignment enabled and disabled.

4. Resampling and appearance should not trigger full geometry work unnecessarily.

5. The slider lag issue was caused by doing heavy appearance work directly inside `input` handlers on the main thread.
   Current code defers/coalesces this with `requestAnimationFrame`.

## Current defaults

- paper preset default: `Letter (11×8.5 in)`
- frame columns default: `5`
- frame rows default: `4`
- threshold method default: `Offset Peak`
- threshold offset default: `-20`
- cross region slider default: `60`
- use cross alignment default: checked
- use rectified as source default: unchecked
- brightness default: `0`
- contrast default: `0`
- vibrance default: `0`
- resampling default: `linear`
- fps default: `20`
- gif quality default: `10`
- dithering default: `Smooth (Floyd-Steinberg Serpentine)`
- global palette default: unchecked

## Things intentionally removed or changed from earlier versions

- no p5.js
- no page preset/orientation split beyond current landscape-oriented paper preset list
- no old rectified-sheet cross overlay debug UI
- old `Saturation` replaced by `Vibrance`
- `Playback` panel removed; frame rate moved into `GIF Export Options`
- `Detection` and `Alignment` merged into one panel

## Good next debugging questions

If something regresses, check these:

1. Did a control incorrectly trigger `processCurrentImage()` when it should only invalidate lazy caches?
2. Is `state.frameCount` correct even when `state.frameCanvases` is sparse?
3. Is `getBaseFrameCanvas(index)` extracting from the correct cached rectified sheet and alignment info?
4. Is `Resampling` accidentally causing geometry recalculation again?
5. Are appearance slider handlers doing too much work directly on `input` instead of via `scheduleAppearancePreviewUpdate()`?
6. If cross alignment seems wrong, inspect:
   - Cross Regions panel
   - ROI centering
   - edge ROI padding behavior
   - confidence thresholds
   - fractional detected positions

## Minimal mental model

Think of the app as having three layers:

1. Geometry layer
   - page detection
   - corner-dot detection
   - final rectification
   - cross alignment
   - frame quads

2. Base image layer
   - raw uploaded image
   - base rectified sheet
   - lazily extracted base frames

3. Appearance/export layer
   - lazy OKLab appearance adjustment for preview
   - lazy resampling-based frame extraction
   - full all-frame realization only when exporting GIFs

If you preserve that separation, the app stays responsive.

