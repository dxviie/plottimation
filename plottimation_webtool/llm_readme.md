# Plottimation Web Tool: LLM Handoff

## Purpose

This directory contains a desktop-oriented browser tool for generating an animated GIF from a photograph of a plotted frame-sheet. The frame-sheet is a sheet of paper containing a grid of animation frames plus registration marks. The intended workflow is:

1. User uploads a phone photo or scan of a plotted frame-sheet.
2. Tool detects the paper page.
3. Tool rectifies the page with perspective correction.
4. Tool finds the four corner registration circles.
5. Tool performs a second rectification to the dot-defined sheet coordinate system.
6. Tool optionally detects interior `+` registration marks for subpixel frame alignment.
7. Tool extracts the individual animation frames.
8. Tool previews the animation and exports an animated GIF.

This tool is a friendlier browser-based successor to `plottimation_GIF_generator/`.

## Important sibling directories

- `grid-animation-svg-generator/`
  Generates plotted frame-sheets and the registration-mark geometry.
- `plottimation_GIF_generator/`
  Original p5.js/OpenCV sketch that inspired this web tool.
- `plottimation_webtool/`
  Current web app.

## Core design constraints

- The GIF generator should know as little as possible about the sheet design.
- It should depend only on:
  - `N_FRAME_COLS`
  - `N_FRAME_ROWS`
  - user-entered sheet width/height
- It should infer the cross lattice from equal spacing in the rectified sheet.
- It should not depend on exact margins, circle sizes, or other generator-specific geometry.
- The app is intended for desktop browser use, not mobile.
- p5.js has been removed from this tool; it is plain HTML/CSS/JS.

## Main files

- `plottimation_webtool/index.html`
  Main UI structure.
- `plottimation_webtool/style.css`
  Neutral gray visual styling and layout.
- `plottimation_webtool/app.js`
  All application logic, CV pipeline, preview rendering, GIF export, drag/drop.
- `plottimation_webtool/opencv.js`
  Local OpenCV.js build used by the app.
- `plottimation_webtool/gif.js`
  GIF encoder library.

## UI structure

### Sidebar controls

- Photo
  - drag/drop zone
  - file input
- Layout
  - sheet width
  - sheet height
  - frame columns
  - frame rows
- Detection
  - `Cross Region Size` slider
- Alignment
  - `Use cross-based subpixel alignment`
  - `Use rectified as source`
- Trim Output
  - crop left/right/top/bottom
- Appearance
  - brightness
  - contrast
  - saturation
- Playback
  - frame rate
- Status
  - multiline diagnostics

### Main workspace panels

- `Raw Photo`
  - shows uploaded image
  - header shows source filename in parentheses
- `Rectified Sheet`
  - shows final rectified sheet preview
- `Cross Regions`
  - shows square ROI patches around expected cross locations
  - arranged in a `(cols + 1) x (rows + 1)` lattice with dotted placeholders for the missing corner slots
- `Animation Preview`
  - animated canvas preview
  - skinny `Export GIF` button in panel header
  - exported GIF `<img>` stays hidden until export exists

## Current visual style

- Neutral gray theme
- Minimal styling
- Browser-default font stacks
- Rounded corners reduced to 3px on normal panels
- Cross ROI tiles intentionally have no decorative frame/border/radius

## Important current behaviors

- Processing is automatic after image load or control changes.
- There is no `Process Photo` button.
- `Export GIF` lives in the `Animation Preview` header.
- The exported GIF file name is friendly:
  - `<sanitized_source_basename>_animation_YYYYMMDD_HHMMSS.gif`
- Spaces and junk characters are sanitized to underscores or removed.
- Dragging the displayed GIF out of the browser should use the same friendly filename.
- Dragging `Raw Photo` or `Rectified Sheet` should use the full-resolution backing canvases, not panel previews.

## Current status panel fields

The status panel currently reports:

- raw photo size
- paper threshold
- largest contour area
- detection warp size
- extraction warp size
- rectified sheet size
- animation size
- frame source
- frames extracted
- cross-alignment usage/fallback message

## Main application state in `app.js`

### `dom`

Important handles include:

- `dropZone`
- `fileInput`
- `exportButton`
- `paperWidth`
- `paperHeight`
- `frameCols`
- `frameRows`
- `crossRoiScale`
- `crossRoiScaleValue`
- `useCrossAlignment`
- `useRectifiedAsSource`
- crop inputs
- appearance sliders and outputs
- `fps`
- `statusText`
- `rawCanvas`
- `rawPhotoName`
- `rectifiedCanvas`
- `gifPreviewCanvas`
- `gifImage`
- `crossRoiGrid`

### `state`

Important fields include:

- `cvReady`
- `sourceImage`
- `sourceFilename`
- `exportedGifFilename`
- `sourceCanvas`
  - full-resolution uploaded image
- `adjustedCanvas`
  - full-resolution appearance-adjusted image
- `frameCanvases`
- `rectifiedPreviewCanvas`
- `exportedGifUrl`
- timers and preview-loop fields
- `alignmentInfo`

## High-level processing pipeline

The entry point is `processCurrentImage()`, which:

1. Reads UI config.
2. Applies appearance filters from `sourceCanvas` into `adjustedCanvas`.
3. Calls `runPipeline(sourceCanvas, adjustedCanvas, config)`.
4. Updates previews, cross-region display, GIF preview, and status.

### `runPipeline(...)`

The pipeline currently uses:

- `visionSrc = cv.imread(sourceCanvas)`
- `styledSrc = cv.imread(adjustedCanvas)`

This means:

- computer vision runs on the unadjusted image
- final visual output can use brightness/contrast/saturation-adjusted imagery

### Stage 1: page detection

1. Convert `visionSrc` to grayscale.
2. Estimate a paper threshold.
3. Threshold to binary.
4. Find the largest external contour.
5. Approximate it to a quad.
6. Order corners with `orderCorners(...)`.

Function names:

- `estimatePaperThreshold(grayImg)`
- `findLargestQuad(binaryMat, totalArea)`
- `orderCorners(pts)`

## Split-resolution architecture

This was introduced because changing the original `paperWidthIn * 100` normalization scale broke the tuned corner-dot detector.

### Detection warp

Still fixed at:

- `paperWidthIn * 100`
- `paperHeightIn * 100`

Purpose:

- preserve the working scale expected by the existing gutter/dip / corner-dot finding code

### Extraction warp

A second, larger page warp is created for better output resolution.

Current logic:

- estimate raw page quad area in source image pixels
- derive a larger page-warp size from the quad area and paper aspect ratio
- never allow it to be smaller than the low-res detection warp

Function:

- `estimateHighResPageWarpSize(quadAreaPx, paperWidthIn, paperHeightIn, pageSizeLow)`

The high-res page warp is used as the basis for final output-oriented work.

## Perspective warp details

Function:

- `perspectiveWarp(visionSrc, styledSrc, ordered, size)`

It now returns:

- `visionMat`
- `styledMat`
- `forwardTransform`
- `inverseTransform`

The transform arrays are plain JS arrays extracted from OpenCV homography matrices.

Helper functions:

- `homographyMatToArray(mat)`
- `applyHomographyToPoint(point, homography)`
- `mapDotRectThroughHomography(dotRect, homography)`

These were added to support using the raw photo as the source for the final dot-based rectification.

## Corner-dot detection

The corner-dot finder runs on the low-resolution detection warp only.

Workflow:

1. Convert low-res page warp to blurred grayscale with `toLightnessGray(...)`
2. Sum rows and columns
3. Find the first dark dip from each edge using `findFirstDipFromEdge(...)`
4. Refine each corner-dot center with `refineDotCentroid(...)`

Function names:

- `toLightnessGray(inMat)`
- `columnSums(grayImg)`
- `rowSums(grayImg)`
- `findFirstDipFromEdge(profile, edge, options)`
- `refineDotCentroid(grayMat, cx, cy, w, h, dscale)`
- `findDotRect(pageGrayMat)`

### Important constants

At top of `app.js`:

- `IGNORE_PX = 8`
- `DOT_DIM_PCT_COLS = 0.03`
- `DOT_DIM_PCT_ROWS = 0.02`
- `GUTTER_PCT = 0.01`

These are somewhat tuned to the current low-res detection warp scale. This is why simply replacing `100` with a larger number previously broke the rectification.

## Dot rectangle scaling

The detected corner-dot quad is found on the low-res detection warp, then scaled to the high-res extraction warp:

- `scaleDotRect(dotRect, fromSize, toSize)`

This assumes the low-res and high-res page warps represent the same source page geometry at different pixel densities.

## Final rectification modes

This is the main recent architectural change.

### Mode A: `Use rectified as source` checked

Current/original design.

Final dot-based rectification uses:

- `pageWarpHigh.visionMat`
- `pageWarpHigh.styledMat`
- `dotRectHigh`

This means the final sheet is rectified from the already page-warped high-res image.

### Mode B: `Use rectified as source` unchecked

Alternative design for better detail preservation.

Final dot-based rectification uses:

- `visionSrc`
- `styledSrc`
- `dotRectHigh` mapped back into raw-photo coordinates using `pageWarpHigh.inverseTransform`

This means:

1. Low-res warp is used for stable dot detection.
2. Dot quad is scaled to high-res page-warp coordinates.
3. That high-res dot quad is projected back to the original image.
4. Final `rectifyByDots(...)` is performed directly from the original full-resolution source image.

This path should preserve more true detail than repeatedly resampling intermediate warps.

## Dot-based rectification

Function:

- `rectifyByDots(pageVision, pageStyled, dotRect, size, padding = 0)`

Inputs:

- a source image pair
- a 4-corner dot quad in the coordinate system of that source
- target `size`
- extra `padding`

Outputs:

- `visionMat`
- `styledMat`
- `gridBounds`

### `gridBounds`

This is critical.

Because the final rectified sheet is padded outward to provide real margin around edge cross ROIs, the true animation/cross lattice does not occupy the whole rectified image.

`gridBounds` describes the actual inner lattice rectangle:

- `left`
- `top`
- `width`
- `height`

Many later computations must use `gridBounds`, not full image size.

## Cross-region and cross-alignment workflow

### Expected lattice

Expected marker points are inferred as equal spacing over `gridBounds`:

- total lattice is `(cols + 1) x (rows + 1)`
- four corners are corner dots, not cross marks
- all other lattice intersections are expected `+` marks

Functions:

- `getExpectedCrossLattice(bounds, cols, rows)`
- `getRectifiedCornerAnchors(bounds, cols, rows)`

### Cross ROI sizing

Cross region size is based on the smaller frame-cell dimension:

- `cellW = rectifiedWidth / cols`
- `cellH = rectifiedHeight / rows`
- `roiHalf = max(10, round(min(cellW, cellH) * 0.18 * crossRoiScale))`
- side length = `2 * roiHalf + 1`

The default slider value is currently `60`, not `75`.

This corresponds to:

- `crossRoiScale = slider / 100`
- default `0.60`

Relevant functions:

- `estimateCrossRoiSidePx(...)`
- `estimateDetectionPadding(...)`

### Important clarification

The UI slider is still percentage-like internally, but the user-facing readout is pixel size.

### Cross Regions panel behavior

The Cross Regions panel should display ROI patches at intrinsic size, unscaled, without any decorative frame.

Requirements that were explicitly requested:

- no rounded-rect framing
- no border/background nonsense
- show true 1:1 ROI size
- okay if panel scrolls
- keep dotted placeholders for the four missing corner slots

If this ever looks wrong again, inspect CSS selectors affecting:

- `.cross-roi-tile`
- `.viewer-card canvas`
- grid sizing/layout

## Cross detection mode

Function:

- `buildCrossAlignmentData(rectifiedMat, cols, rows, crossRoiScale, gridBounds)`

For each expected cross:

1. Extract a centered square ROI
2. Threshold with Otsu
3. Accumulate vertical/horizontal dark-pixel profiles in a central band
4. Smooth the profiles
5. Find weighted peaks
6. Estimate subpixel center
7. Compute confidence / acceptance

Key functions:

- `detectCrossAtExpectedPosition(...)`
- `extractCenteredSquareRoi(...)`
- `buildCrossRoiCanvas(...)`
- `getWeightedPeakIndex(...)`
- `smooth1D(...)`

### Critical bug that was fixed

`smooth1D()` used to be a trailing moving average, which shifted peaks consistently down-right in the detected centers. It is now a centered moving average. This was a real bug and visibly improved both the debug view and GIF jitter.

### Another critical bug that was fixed

Edge ROIs used to be sampled from an image cropped too tightly to the dot rectangle, which caused edge-region ROI padding to be filled with replicated pixels instead of real paper/image content. This was fixed by padding the final rectified sheet and keeping `gridBounds` inside it.

### ROI centering note

ROIs are now odd-sized and use a true center pixel convention.

## Unrefined cross-region display mode

When `Use cross-based subpixel alignment` is unchecked:

- refined cross locations should not be computed or shown
- extraction should use nominal/fallback geometry
- Cross Regions should still be displayed
- each ROI patch should be centered on the nominal expected cross position
- the red crosshair should be drawn exactly at the center of the patch
- the hover overlay text like `(0, 1) rejected` should not appear

This mode is meant to show the actual unrefined locations being used, so the user can visually compare the ignored real cross to the centered nominal crosshair.

Function:

- `buildUnrefinedCrossRegionInfo(...)`
- `buildUnrefinedCrossRegionTile(...)`

## Marker fallback policy

If a cross is missing or rejected:

- use the ideal lattice position for that marker

Corner markers:

- use the corner-dot anchor positions

This ensures all frames always have a complete marker set even with some missing cross detections.

## Frame extraction

Function:

- `sliceRectifiedToCanvases(rectifiedMat, extractionInfo, crop)`

Current extraction uses:

- per-frame full perspective warp, not just translation and not just affine

For each frame:

1. Resolve its four surrounding lattice points.
2. These points may be:
  - detected cross centers
  - ideal fallback cross positions
  - corner-dot anchors
3. Apply crop margins in normalized cell coordinates.
4. Bilinearly interpolate source quad corners.
5. Build a 4-point perspective transform to a rectangular output frame.
6. Warp the source patch into the output frame canvas.

This was upgraded in stages:

- originally nominal slicing
- then translation-only correction
- then affine
- finally full perspective warp per frame

The current state is full perspective per frame.

## Appearance pipeline

Appearance controls are intentionally separate from CV:

- CV uses `sourceCanvas`
- final styled extraction uses `adjustedCanvas`

Function:

- `applyVisualAdjustments(sourceCanvas, targetCanvas, filters)`

Uses browser canvas filters:

- brightness
- contrast
- saturate

These transforms must still apply whether final rectification uses the rectified source or the raw source.

## Preview rendering

The visible canvases are previews only. They should preserve aspect ratio and redraw on resize.

Relevant functions:

- `renderCanvasFit(sourceCanvas, targetCanvas)`
- `resizeCanvasToBox(canvas)`
- `renderRectifiedPreview(rectifiedCanvas)`
- `drawCurrentGifPreview()`
- `rerenderPreviews()`

Several CSS/layout bugs were fixed so repeated window resizes should no longer push previews downward/offscreen.

Important:

- The panel-sized preview canvases are not the data used for CV or output.
- `sourceCanvas` and `rectifiedPreviewCanvas` are the backing canvases used for drag/export.

## GIF preview/export

Preview:

- `startGifPreviewLoop()`
- `drawCurrentGifPreview()`

Export:

- `exportGif()`

Uses local `gif.js` and `../plottimation_GIF_generator/gif.worker.js`.

Export behavior:

- auto-downloads GIF on completion
- shows exported GIF image in panel
- exported image is hidden until export exists
- drag-out of exported GIF should preserve the friendly filename

Helper functions:

- `makeGifFilename(sourceFilename)`
- `sanitizeFilenameBase(filename)`
- `downloadBlobWithFilename(blob, filename)`
- `revokeGifUrl()`

## Known OpenCV runtime constraint

The app uses a local OpenCV.js build that is an older asm.js-style bundle. This likely has a smaller or older API surface than more modern OpenCV.js builds. A concrete issue encountered earlier was:

- `cv.getRectSubPix` was not available

Because of this, code should prefer conservative OpenCV APIs already known to work in this build:

- `warpPerspective`
- `warpAffine`
- `getPerspectiveTransform`
- etc.

Avoid assuming every OpenCV.js API exists.

## Important user preferences and design decisions

- User dislikes spaces in filenames.
- User wants plain/neutral styling, not decorative styling.
- User wants the Cross Regions panel because it is more useful than the old rectified-sheet debug overlay.
- The old `Show cross-alignment debug overlay` feature was intentionally removed.
- The Cross Regions panel must continue to work even when cross-based alignment is disabled.

## Current defaults and knobs

- frame columns default: `5`
- frame rows default: `4`
- sheet width default: `11`
- sheet height default: `8.5`
- frame rate default: `20`
- cross-region slider default: `60`
- cross-region slider range: `30..150`
- use cross alignment default: checked
- use rectified as source default: checked

## Things that were intentionally not done

- No page preset UI
- No portrait/landscape preset UI
- No p5.js
- No extra cross-alignment overlay on the rectified sheet

## Likely next technical areas of work

1. Compare image quality between:
   - `Use rectified as source` checked
   - `Use rectified as source` unchecked

2. If raw-source mode produces visible improvements, consider making it the default.

3. Evaluate whether interpolation method should become a user-facing advanced setting:
   - linear
   - cubic
   - Lanczos

4. Continue improving cross localization if jitter remains.

5. If further resolution improvements are needed, prefer architectures that source the last warp from the original image rather than merely upscaling intermediate rectified images.

## Risks / fragile points

- Corner-dot detection remains somewhat scale-tuned to the low-res detection warp.
- OpenCV.js build may lack some APIs and may differ from newer documentation.
- If CSS changes accidentally reapply generic canvas styling to Cross Regions, the ROI display may again become scaled or framed incorrectly.
- If the raw-source rectification path is modified, be careful to preserve:
  - separate vision vs styled source mats
  - correct inverse homography usage
  - correct final `gridBounds`

## Sanity checks for future debugging

When debugging output quality, check these first:

1. Status panel values:
   - raw photo size
   - detection warp
   - extraction warp
   - rectified sheet
   - animation size
   - frame source

2. Cross Regions panel:
   - are edge ROIs centered correctly?
   - are ROIs truly square?
   - are they unscaled?
   - does the red crosshair match detected center when alignment is on?
   - does it stay centered when alignment is off?

3. Source mode:
   - checked: final source is high-res page warp
   - unchecked: final source is raw photo with inverse-mapped dot quad

4. If a consistent directional bias appears in cross detection again:
   - inspect `smooth1D()`
   - inspect ROI center convention
   - inspect coordinate mapping from ROI local coordinates back to sheet coordinates

5. If edge crosses start failing again:
   - inspect final rectification padding
   - inspect `gridBounds`
   - inspect whether ROI extraction is using real margin pixels rather than replicated border fill

## Minimal mental model

The most useful way to think about this app is:

- detect geometry at a stable scale
- rectify for output at higher quality
- optionally refine frame geometry with interior crosses
- keep CV and visual styling separated
- keep user-facing diagnostics visible
- preserve original-image detail whenever the final warp can reasonably use it

