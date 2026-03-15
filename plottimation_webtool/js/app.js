import { PAPER_PRESETS, dom, state } from "./dom-state.js";
import { applyVisualAdjustments, hasAppearanceAdjustments } from "./appearance.js";
import { drawImageToCanvas, renderCanvasFit, resizeCanvasToBox } from "./canvas-view.js";
import {
  runPipeline,
  estimateCrossRoiSidePx,
  getCvInterpolationFlag,
  extractSingleFrameToCanvas,
} from "./pipeline.js";

init();

/**
 * Bootstrap the application once the module is loaded.
 *
 * @returns {void}
 */
function init() {
  attachUi();
  syncPaperPresetUi();
  dom.gifImage.classList.add("hidden");
  dom.gifImage.hidden = true;
  dom.gifImage.removeAttribute("src");

  if (typeof cv !== "undefined" && cv.onRuntimeInitialized) {
    cv.onRuntimeInitialized = onOpenCvReady;
  } else if (typeof cv !== "undefined") {
    onOpenCvReady();
  } else {
    setStatus("OpenCV.js did not load.");
  }

  updateSliderReadouts();
  attachResizeHandler();
  startGifPreviewLoop();
}

/**
 * Attach all DOM event listeners and classify controls by what they invalidate.
 *
 * @returns {void}
 */
function attachUi() {
  makeCanvasDraggable(dom.rawCanvas, "raw-photo.png", () => state.source.canvas);
  makeCanvasDraggable(dom.rectifiedCanvas, "rectified-sheet.png", () => state.preview.rectifiedCanvas);
  makeGifImageDraggable();

  dom.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.dropZone.classList.add("dragging");
  });
  dom.dropZone.addEventListener("dragleave", () => {
    dom.dropZone.classList.remove("dragging");
  });
  dom.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dom.dropZone.classList.remove("dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  dom.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  });
  dom.loadDemoButton.addEventListener("click", () => {
    void loadImageSource("demo/mySrcImage.jpg", "mySrcImage.jpg");
  });

  attachResetButton(dom.resetAppearanceButton, resetAppearanceControls);
  attachResetButton(dom.resetTrimButton, resetTrimControls);

  dom.paperPreset.addEventListener("input", () => {
    syncPaperPresetUi();
    updateSliderReadouts();
    scheduleProcess();
  });
  dom.paperPreset.addEventListener("change", () => {
    syncPaperPresetUi();
    scheduleProcess();
  });

  const appearanceInputs = [dom.brightness, dom.contrast, dom.vibrance, dom.invert];
  appearanceInputs.forEach((input) => {
    input.addEventListener("input", () => {
      revokeGifUrl();
      updateSliderReadouts();
      invalidateAppearanceCache();
      scheduleAppearancePreviewUpdate(false);
      cancelInFlightProcessing();
    });
    input.addEventListener("change", () => {
      revokeGifUrl();
      updateSliderReadouts();
      invalidateAppearanceCache();
      scheduleAppearancePreviewUpdate(true);
    });
  });

  const geometryInputs = [
    dom.paperWidth,
    dom.paperHeight,
    dom.frameCols,
    dom.frameRows,
    dom.thresholdMethod,
    dom.thresholdOffset,
    dom.crossRoiScale,
    dom.useCrossAlignment,
    dom.useRectifiedAsSource,
    dom.cropLeft,
    dom.cropRight,
    dom.cropTop,
    dom.cropBottom,
  ];
  geometryInputs.forEach((input) => {
    input.addEventListener("input", () => {
      revokeGifUrl();
      updateSliderReadouts();
      scheduleProcess();
    });
    input.addEventListener("change", () => {
      revokeGifUrl();
      scheduleProcess();
    });
  });

  const lazyFrameInputs = [dom.gifResampling, dom.fps, dom.gifQuality, dom.gifDither, dom.gifGlobalPalette];
  lazyFrameInputs.forEach((input) => {
    input.addEventListener("input", () => {
      revokeGifUrl();
      updateSliderReadouts();
      if (input === dom.gifResampling) invalidateFrameCaches();
      drawCurrentGifPreview();
    });
    input.addEventListener("change", () => {
      revokeGifUrl();
      if (input === dom.gifResampling) invalidateFrameCaches();
      drawCurrentGifPreview();
    });
  });

  dom.exportButton.addEventListener("click", () => {
    void exportGif();
  });
}

/**
 * Make a preview canvas draggable by exposing its backing canvas as a PNG data URL.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 * @param {() => HTMLCanvasElement | null} getSourceCanvas
 * @returns {void}
 */
function makeCanvasDraggable(canvas, filename, getSourceCanvas) {
  canvas.draggable = true;
  canvas.addEventListener("dragstart", (event) => {
    try {
      const sourceCanvas = getSourceCanvas?.() || canvas;
      if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
        event.preventDefault();
        return;
      }
      const dataUrl = sourceCanvas.toDataURL("image/png");
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/uri-list", dataUrl);
      event.dataTransfer.setData("text/plain", dataUrl);
      event.dataTransfer.setData("DownloadURL", `image/png:${filename}:${dataUrl}`);
    } catch (error) {
      console.error("Could not start canvas drag:", error);
    }
  });
}

/**
 * Make the exported GIF preview image draggable with a friendly filename.
 *
 * @returns {void}
 */
function makeGifImageDraggable() {
  dom.gifImage.draggable = true;
  dom.gifImage.addEventListener("dragstart", (event) => {
    if (!state.export.url || !state.export.filename) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/uri-list", state.export.url);
    event.dataTransfer.setData("text/plain", state.export.url);
    event.dataTransfer.setData("DownloadURL", `image/gif:${state.export.filename}:${state.export.url}`);
  });
}

/**
 * Wire a small header reset button without toggling the parent details element.
 *
 * @param {HTMLButtonElement | null} button
 * @param {() => void} onReset
 * @returns {void}
 */
function attachResetButton(button, onReset) {
  if (!button) return;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onReset();
  });
}

/**
 * Restore all appearance controls to their defaults and invalidate derived caches.
 *
 * @returns {void}
 */
function resetAppearanceControls() {
  dom.brightness.value = "0";
  dom.contrast.value = "0";
  dom.vibrance.value = "0";
  dom.invert.checked = false;
  dom.gifResampling.value = "linear";
  revokeGifUrl();
  updateSliderReadouts();
  invalidateFrameCaches();
  invalidateAppearanceCache();
  refreshAppearanceOutputs();
  drawCurrentGifPreview();
}

/**
 * Restore all trim controls to zero and rerun geometry extraction.
 *
 * @returns {void}
 */
function resetTrimControls() {
  dom.cropLeft.value = "0";
  dom.cropRight.value = "0";
  dom.cropTop.value = "0";
  dom.cropBottom.value = "0";
  revokeGifUrl();
  updateSliderReadouts();
  scheduleProcess();
}

/**
 * Mark OpenCV ready and initialize any controls that depend on its runtime capabilities.
 *
 * @returns {void}
 */
function onOpenCvReady() {
  state.runtime.cvReady = true;
  populateResamplingOptions();
  setStatus("OpenCV.js ready.\nLoad frame-sheet image to begin.");
}

/**
 * Invalidate any queued or active processing pass by bumping the request id.
 *
 * @returns {void}
 */
function cancelInFlightProcessing() {
  state.processing.requestId += 1;
  state.processing.pending = false;
}

/**
 * Coalesce rapid appearance updates into one animation-frame preview refresh.
 *
 * @param {boolean} [includeRectified=false]
 * @returns {void}
 */
function scheduleAppearancePreviewUpdate(includeRectified = false) {
  state.preview.appearancePreviewNeedsRectified = state.preview.appearancePreviewNeedsRectified || includeRectified;
  if (state.preview.appearancePreviewRaf) return;
  state.preview.appearancePreviewRaf = requestAnimationFrame(() => {
    state.preview.appearancePreviewRaf = 0;
    if (state.preview.appearancePreviewNeedsRectified) {
      refreshAppearanceOutputs();
    }
    state.preview.appearancePreviewNeedsRectified = false;
    drawCurrentGifPreview();
  });
}

/**
 * Populate the resampling dropdown with only the interpolation modes available in this OpenCV build.
 *
 * @returns {void}
 */
function populateResamplingOptions() {
  const select = dom.gifResampling;
  const previousValue = select.value || "linear";
  select.innerHTML = "";
  const options = [
    { value: "linear", label: "Balanced (Linear)" },
    { value: "cubic", label: "Sharper (Cubic)" },
  ];
  if (typeof cv !== "undefined" && typeof cv.INTER_LANCZOS4 !== "undefined") {
    options.push({ value: "lanczos", label: "Maximum Detail (Lanczos)" });
  }
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    if (option.value === previousValue) el.selected = true;
    select.appendChild(el);
  }
}

/**
 * Rerender previews after window resize settles so canvases match their new boxes.
 *
 * @returns {void}
 */
function attachResizeHandler() {
  window.addEventListener("resize", () => {
    window.clearTimeout(state.preview.resizeTimer);
    state.preview.resizeTimer = window.setTimeout(() => {
      rerenderPreviews();
    }, 40);
  });
}

/**
 * Load an image selected by the user from a File object.
 *
 * @param {File} file
 * @returns {Promise<void>}
 */
async function handleFile(file) {
  const url = URL.createObjectURL(file);
  await loadImageSource(url, file.name || "", () => {
    URL.revokeObjectURL(url);
  });
}

/**
 * Load an image from a URL, reset dependent state, and kick off processing.
 *
 * @param {string} src
 * @param {string} [filename=""]
 * @param {(() => void) | null} [onComplete=null]
 * @returns {Promise<void>}
 */
async function loadImageSource(src, filename = "", onComplete = null) {
  const image = new Image();
  image.onload = async () => {
    try {
      document.body.classList.add("has-loaded-image");
      state.source.image = image;
      state.source.filename = filename || "";
      state.source.rawPageContour = null;
      state.geometry.baseRectifiedCanvas = null;
      state.geometry.alignmentInfo = null;
      state.geometry.frameCount = 0;
      invalidateFrameCaches();
      invalidateAppearanceCache();
      dom.rawPhotoName.textContent = filename ? `(${filename})` : "";
      drawImageToCanvas(image, state.source.canvas);
      renderRawPreview();
      revokeGifUrl();
      await processCurrentImage();
    } finally {
      onComplete?.();
    }
  };
  image.onerror = () => {
    onComplete?.();
    setStatus("Failed to load the selected image.");
  };
  image.src = src;
}

/**
 * Debounce a geometry-affecting reprocess so multiple control edits collapse into one run.
 *
 * @returns {void}
 */
function scheduleProcess() {
  if (!state.source.image) return;
  state.processing.requestId += 1;
  const requestId = state.processing.requestId;
  window.clearTimeout(state.processing.timer);
  state.processing.timer = window.setTimeout(() => {
    void processCurrentImage(requestId);
  }, 220);
}

/**
 * Read the current UI state and normalize it into a processing/export config object.
 *
 * @returns {{
 *   paperPreset:string,
 *   paperWidthIn:number,
 *   paperHeightIn:number,
 *   frameCols:number,
 *   frameRows:number,
 *   thresholdMethod:string,
 *   thresholdOffset:number,
 *   crossRoiScalePct:number,
 *   crossRoiScale:number,
 *   useCrossAlignment:boolean,
 *   useRectifiedAsSource:boolean,
 *   crop:{left:number,right:number,top:number,bottom:number},
 *   filters:{brightness:number,contrast:number,vibrance:number,invert:boolean},
 *   fps:number,
 *   exportOptions:{quality:number,dither:string|false,resampling:string,globalPalette:boolean}
 * }}
 */
function readConfig() {
  const paperPreset = dom.paperPreset.value || "letter";
  const presetSize = PAPER_PRESETS[paperPreset];
  const isCustomPaper = paperPreset === "custom";
  const paperWidth = isCustomPaper ? (Number(dom.paperWidth.value) || 11) : (presetSize?.width || 11);
  const paperHeight = isCustomPaper ? (Number(dom.paperHeight.value) || 8.5) : (presetSize?.height || 8.5);
  return {
    paperPreset,
    paperWidthIn: Math.max(1, paperWidth),
    paperHeightIn: Math.max(1, paperHeight),
    frameCols: Math.max(1, Math.round(Number(dom.frameCols.value) || 5)),
    frameRows: Math.max(1, Math.round(Number(dom.frameRows.value) || 4)),
    thresholdMethod: dom.thresholdMethod.value || "offset-peak",
    thresholdOffset: Math.max(-128, Math.min(128, Math.round(Number(dom.thresholdOffset.value) || -20))),
    crossRoiScalePct: Math.max(30, Math.min(150, Number(dom.crossRoiScale.value) || 60)),
    crossRoiScale: Math.max(0.3, Math.min(1.5, (Number(dom.crossRoiScale.value) || 60) / 100)),
    useCrossAlignment: dom.useCrossAlignment.checked,
    useRectifiedAsSource: dom.useRectifiedAsSource.checked,
    crop: {
      left: Math.max(0, Math.round(Number(dom.cropLeft.value) || 0)),
      right: Math.max(0, Math.round(Number(dom.cropRight.value) || 0)),
      top: Math.max(0, Math.round(Number(dom.cropTop.value) || 0)),
      bottom: Math.max(0, Math.round(Number(dom.cropBottom.value) || 0)),
    },
    filters: {
      brightness: Number(dom.brightness.value) || 0,
      contrast: Number(dom.contrast.value) || 0,
      vibrance: Number(dom.vibrance.value) || 0,
      invert: dom.invert.checked,
    },
    fps: Math.max(1, Math.min(60, Math.round(Number(dom.fps.value) || 20))),
    exportOptions: {
      quality: Math.max(1, Math.min(20, Math.round(Number(dom.gifQuality.value) || 10))),
      dither: (dom.gifDither.value && dom.gifDither.value !== "off") ? dom.gifDither.value : false,
      resampling: dom.gifResampling.value || "linear",
      globalPalette: dom.gifGlobalPalette.checked,
    },
  };
}

/**
 * Show or hide the custom paper size fields based on the current preset selection.
 *
 * @returns {void}
 */
function syncPaperPresetUi() {
  const presetKey = dom.paperPreset.value || "letter";
  const isCustom = presetKey === "custom";
  const preset = PAPER_PRESETS[presetKey];
  dom.customPaperFields.hidden = !isCustom;
  dom.paperWidth.disabled = !isCustom;
  dom.paperHeight.disabled = !isCustom;
  if (!isCustom && preset) {
    dom.paperWidth.value = String(preset.width);
    dom.paperHeight.value = String(preset.height);
  }
}

/**
 * Refresh all live numeric readouts attached to sliders and similar controls.
 *
 * @returns {void}
 */
function updateSliderReadouts() {
  dom.brightnessValue.textContent = formatSignedValue(dom.brightness.value);
  dom.contrastValue.textContent = formatSignedValue(dom.contrast.value);
  dom.vibranceValue.textContent = formatSignedValue(dom.vibrance.value);
  dom.thresholdOffsetValue.textContent = formatSignedValue(dom.thresholdOffset.value);
  dom.gifQualityValue.textContent = String(Math.max(1, Math.min(20, Number(dom.gifQuality.value) || 10)));
  if (!state.geometry.alignmentInfo) {
    dom.crossRoiScaleValue.textContent = "-- px";
    return;
  }
  const config = readConfig();
  const roiSizePx = estimateCrossRoiSidePx(
    state.geometry.alignmentInfo.rectifiedWidth,
    state.geometry.alignmentInfo.rectifiedHeight,
    config.frameCols,
    config.frameRows,
    config.crossRoiScale,
    config.paperWidthIn * 100,
    config.paperHeightIn * 100
  );
  dom.crossRoiScaleValue.textContent = `${roiSizePx} px`;
}

/**
 * Format a numeric slider value with an explicit sign for display.
 *
 * @param {string | number} value
 * @returns {string}
 */
function formatSignedValue(value) {
  const number = Number(value) || 0;
  return (number >= 0 ? "+" : "") + number;
}

/**
 * Run the full geometry/CV pipeline, update caches, and refresh all previews.
 *
 * @param {number} [requestId=state.processing.requestId]
 * @returns {Promise<void>}
 */
async function processCurrentImage(requestId = state.processing.requestId) {
  if (!state.runtime.cvReady) {
    setStatus("OpenCV is still loading.");
    return;
  }
  if (!state.source.image) return;
  if (state.processing.active) {
    state.processing.pending = true;
    return;
  }

  state.processing.active = true;
  dom.exportButton.disabled = true;

  try {
    const config = readConfig();
    const result = runPipeline(state.source.canvas, config, requestId, throwIfProcessAborted);
    if (requestId !== state.processing.requestId) return;

    state.frames.base = result.frames;
    state.geometry.frameCount = result.frames.length;
    state.geometry.alignmentInfo = result.alignmentInfo;
    state.geometry.baseRectifiedCanvas = result.rectifiedCanvas;
    state.source.rawPageContour = result.pageQuadPoints;
    invalidateAppearanceCache();
    updateSliderReadouts();
    renderRawPreview();
    refreshAppearanceOutputs();
    renderCrossRoiGrid(result.alignmentInfo);
    drawCurrentGifPreview();
    dom.exportButton.disabled = state.geometry.frameCount === 0;
    setStatus(result.statusText);
  } catch (error) {
    if (error?.name !== "ProcessAbortedError") {
      console.error(error);
      setStatus("Processing failed.\n" + (error?.message || String(error)));
    }
  } finally {
    state.processing.active = false;
    if (state.processing.pending) {
      state.processing.pending = false;
      window.clearTimeout(state.processing.timer);
      state.processing.timer = window.setTimeout(() => {
        void processCurrentImage(state.processing.requestId);
      }, 0);
    }
  }
}

/**
 * Throw a sentinel error if a stale processing pass is still running.
 *
 * @param {number} requestId
 * @returns {void}
 */
function throwIfProcessAborted(requestId) {
  if (requestId !== state.processing.requestId) {
    const error = new Error("Processing aborted.");
    error.name = "ProcessAbortedError";
    throw error;
  }
}

/**
 * Render the current rectified-sheet canvas into its preview panel.
 *
 * @param {HTMLCanvasElement} rectifiedCanvas
 * @returns {void}
 */
function renderRectifiedPreview(rectifiedCanvas) {
  renderCanvasFit(rectifiedCanvas, dom.rectifiedCanvas);
}

/**
 * Invalidate all appearance-adjusted frame/rectified caches while keeping base geometry intact.
 *
 * @returns {void}
 */
function invalidateAppearanceCache() {
  state.frames.adjustedCache.clear();
  state.preview.rectifiedCanvas = null;
}

/**
 * Invalidate lazily extracted base frames and any adjusted-frame cache derived from them.
 *
 * @returns {void}
 */
function invalidateFrameCaches() {
  state.frames.base = new Array(state.geometry.frameCount);
  state.frames.adjustedCache.clear();
}

/**
 * Refresh the rectified-sheet preview, applying appearance adjustments only when needed.
 *
 * @returns {void}
 */
function refreshAppearanceOutputs() {
  if (!state.geometry.baseRectifiedCanvas) return;
  const filters = readConfig().filters;
  if (!hasAppearanceAdjustments(filters)) {
    state.preview.rectifiedCanvas = state.geometry.baseRectifiedCanvas;
  } else {
    applyVisualAdjustments(state.geometry.baseRectifiedCanvas, state.preview.adjustedRectifiedCanvas, filters);
    state.preview.rectifiedCanvas = state.preview.adjustedRectifiedCanvas;
  }
  renderRectifiedPreview(state.preview.rectifiedCanvas);
}

/**
 * Lazily extract one unadjusted animation frame from the cached rectified sheet.
 *
 * @param {number} index
 * @returns {HTMLCanvasElement | null}
 */
function getBaseFrameCanvas(index) {
  const cached = state.frames.base[index];
  if (cached) return cached;
  if (!state.geometry.baseRectifiedCanvas || !state.geometry.alignmentInfo) return null;
  const rectifiedMat = cv.imread(state.geometry.baseRectifiedCanvas);
  try {
    const config = readConfig();
    const cols = state.geometry.alignmentInfo.cols;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const frame = extractSingleFrameToCanvas(
      rectifiedMat,
      state.geometry.alignmentInfo,
      col,
      row,
      config.crop,
      getCvInterpolationFlag(config.exportOptions.resampling)
    );
    state.frames.base[index] = frame;
    return frame;
  } finally {
    rectifiedMat.delete();
  }
}

/**
 * Lazily apply appearance adjustments to one cached base frame.
 *
 * @param {number} index
 * @returns {HTMLCanvasElement | null}
 */
function getAdjustedFrameCanvas(index) {
  const baseFrame = getBaseFrameCanvas(index);
  if (!baseFrame) return null;
  const filters = readConfig().filters;
  if (!hasAppearanceAdjustments(filters)) return baseFrame;
  if (state.frames.adjustedCache.has(index)) return state.frames.adjustedCache.get(index);
  const adjustedFrame = document.createElement("canvas");
  applyVisualAdjustments(baseFrame, adjustedFrame, filters);
  state.frames.adjustedCache.set(index, adjustedFrame);
  return adjustedFrame;
}

/**
 * Render the raw photo preview and overlay the detected page quad in lime.
 *
 * @returns {void}
 */
function renderRawPreview() {
  renderCanvasFit(state.source.canvas, dom.rawCanvas);
  if (!state.source.rawPageContour || state.source.rawPageContour.length !== 4) return;
  const targetCanvas = dom.rawCanvas;
  const sourceCanvas = state.source.canvas;
  const ctx = targetCanvas.getContext("2d");
  const scale = Math.min(targetCanvas.width / sourceCanvas.width, targetCanvas.height / sourceCanvas.height);
  const drawW = sourceCanvas.width * scale;
  const drawH = sourceCanvas.height * scale;
  const offsetX = (targetCanvas.width - drawW) * 0.5;
  const offsetY = (targetCanvas.height - drawH) * 0.5;
  ctx.save();
  ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < state.source.rawPageContour.length; i++) {
    const pt = state.source.rawPageContour[i];
    const x = offsetX + (pt.x * scale);
    const y = offsetY + (pt.y * scale);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Rebuild the cross-region diagnostic grid from the latest alignment result.
 *
 * @param {object | null} alignmentInfo
 * @returns {void}
 */
function renderCrossRoiGrid(alignmentInfo) {
  const grid = dom.crossRoiGrid;
  grid.innerHTML = "";
  if (!alignmentInfo || !alignmentInfo.crossRoiTiles || alignmentInfo.crossRoiTiles.length === 0) {
    grid.textContent = "";
    return;
  }
  grid.style.gridTemplateColumns = `repeat(${alignmentInfo.cols + 1}, max-content)`;
  for (let row = 0; row <= alignmentInfo.rows; row++) {
    for (let col = 0; col <= alignmentInfo.cols; col++) {
      const isCorner = ((col === 0) || (col === alignmentInfo.cols)) && ((row === 0) || (row === alignmentInfo.rows));
      if (isCorner) {
        const spacer = document.createElement("div");
        spacer.className = "cross-roi-empty";
        grid.appendChild(spacer);
        continue;
      }
      const tile = alignmentInfo.crossRoiTileMap.get(`${col},${row}`);
      if (tile) {
        tile.canvas.classList.add("cross-roi-tile");
        tile.canvas.title = (tile.kind === "unrefined") ? "" : `(${col}, ${row}) ${tile.accepted ? "accepted" : "rejected"}`;
        grid.appendChild(tile.canvas);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "cross-roi-empty";
        grid.appendChild(spacer);
      }
    }
  }
}

/**
 * Drive the live animation preview at the configured frame rate.
 *
 * @returns {void}
 */
function startGifPreviewLoop() {
  const loop = (time) => {
    if (state.geometry.frameCount > 0) {
      const fps = readConfig().fps;
      const frameDelay = 1000 / fps;
      if ((time - state.preview.lastTime) >= frameDelay) {
        state.preview.lastTime = time;
        state.preview.frameIndex = (state.preview.frameIndex + 1) % state.geometry.frameCount;
        drawCurrentGifPreview();
      }
    }
    state.preview.loopHandle = requestAnimationFrame(loop);
  };
  state.preview.loopHandle = requestAnimationFrame(loop);
}

/**
 * Draw the current animation frame into the preview panel.
 *
 * @returns {void}
 */
function drawCurrentGifPreview() {
  const frame = getAdjustedFrameCanvas(state.preview.frameIndex);
  if (!frame) {
    const ctx = dom.gifPreviewCanvas.getContext("2d");
    resizeCanvasToBox(dom.gifPreviewCanvas);
    ctx.clearRect(0, 0, dom.gifPreviewCanvas.width, dom.gifPreviewCanvas.height);
    return;
  }
  renderCanvasFit(frame, dom.gifPreviewCanvas);
}

/**
 * Rerender all visible previews after a resize or other display-only change.
 *
 * @returns {void}
 */
function rerenderPreviews() {
  if (state.source.image) renderRawPreview();
  if (state.preview.rectifiedCanvas) renderRectifiedPreview(state.preview.rectifiedCanvas);
  drawCurrentGifPreview();
}

/**
 * Materialize all adjusted frames and hand them off to gif.js for encoding.
 *
 * @returns {Promise<void>}
 */
async function exportGif() {
  if (!state.geometry.frameCount) return;
  dom.exportButton.disabled = true;
  setStatus("Encoding GIF…");

  const config = readConfig();
  const firstFrame = getAdjustedFrameCanvas(0);
  if (!firstFrame) {
    dom.exportButton.disabled = false;
    return;
  }

  const gif = new GIF({
    workers: 2,
    quality: config.exportOptions.quality,
    width: firstFrame.width,
    height: firstFrame.height,
    repeat: 0,
    dither: config.exportOptions.dither,
    globalPalette: config.exportOptions.globalPalette,
    workerScript: "js/gif.worker.js",
  });

  const delay = Math.max(1, Math.round(1000 / config.fps));
  for (let i = 0; i < state.geometry.frameCount; i++) {
    gif.addFrame(getAdjustedFrameCanvas(i), { copy: true, delay });
  }

  gif.on("finished", (blob) => {
    revokeGifUrl();
    state.export.filename = makeGifFilename(state.source.filename, config.exportOptions.quality);
    state.export.url = URL.createObjectURL(blob);
    dom.gifImage.src = state.export.url;
    dom.gifImage.classList.remove("hidden");
    dom.gifImage.hidden = false;
    downloadBlobWithFilename(blob, state.export.filename);
    dom.exportButton.disabled = false;
    setStatus("GIF ready.\nFrame count: " + state.geometry.frameCount);
  });
  gif.on("progress", (progress) => {
    setStatus("Encoding GIF…\n" + Math.round(progress * 100) + "%");
  });
  gif.render();
}

/**
 * Revoke and hide any previously exported GIF URL.
 *
 * @returns {void}
 */
function revokeGifUrl() {
  if (!state.export.url) return;
  URL.revokeObjectURL(state.export.url);
  state.export.url = "";
  state.export.filename = "";
  dom.gifImage.classList.add("hidden");
  dom.gifImage.hidden = true;
  dom.gifImage.removeAttribute("src");
}

/**
 * Build a friendly exported GIF filename from the source name, timestamp, and quality.
 *
 * @param {string} sourceFilename
 * @param {number} [quality=10]
 * @returns {string}
 */
function makeGifFilename(sourceFilename, quality = 10) {
  const base = sanitizeFilenameBase(sourceFilename || "frame_sheet");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${base}_anim_${yyyy}${mm}${dd}_${hh}${mi}${ss}_q${quality}.gif`;
}

/**
 * Strip unsupported characters from a filename stem.
 *
 * @param {string} filename
 * @returns {string}
 */
function sanitizeFilenameBase(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "frame_sheet";
}

/**
 * Trigger a download for an in-memory blob with a caller-supplied filename.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @returns {void}
 */
function downloadBlobWithFilename(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Update the status panel text.
 *
 * @param {string} text
 * @returns {void}
 */
function setStatus(text) {
  dom.statusText.textContent = text;
}
