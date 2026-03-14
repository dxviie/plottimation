const IGNORE_PX = 8;
const DOT_DIM_PCT_COLS = 0.03;
const DOT_DIM_PCT_ROWS = 0.02;
const GUTTER_PCT = 0.01;
const MIN_CROSS_DETECTION_RATIO = 0.5;
const MIN_CROSS_DETECTIONS_ABS = 4;

const dom = {
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  exportButton: document.querySelector("#exportButton"),
  paperWidth: document.querySelector("#paperWidth"),
  paperHeight: document.querySelector("#paperHeight"),
  frameCols: document.querySelector("#frameCols"),
  frameRows: document.querySelector("#frameRows"),
  crossRoiScale: document.querySelector("#crossRoiScale"),
  crossRoiScaleValue: document.querySelector("#crossRoiScaleValue"),
  useCrossAlignment: document.querySelector("#useCrossAlignment"),
  useRectifiedAsSource: document.querySelector("#useRectifiedAsSource"),
  cropLeft: document.querySelector("#cropLeft"),
  cropRight: document.querySelector("#cropRight"),
  cropTop: document.querySelector("#cropTop"),
  cropBottom: document.querySelector("#cropBottom"),
  brightness: document.querySelector("#brightness"),
  brightnessValue: document.querySelector("#brightnessValue"),
  contrast: document.querySelector("#contrast"),
  contrastValue: document.querySelector("#contrastValue"),
  saturation: document.querySelector("#saturation"),
  saturationValue: document.querySelector("#saturationValue"),
  fps: document.querySelector("#fps"),
  statusText: document.querySelector("#statusText"),
  rawCanvas: document.querySelector("#rawCanvas"),
  rawPhotoName: document.querySelector("#rawPhotoName"),
  rectifiedCanvas: document.querySelector("#rectifiedCanvas"),
  gifPreviewCanvas: document.querySelector("#gifPreviewCanvas"),
  gifImage: document.querySelector("#gifImage"),
  crossRoiGrid: document.querySelector("#crossRoiGrid"),
};

const state = {
  cvReady: false,
  sourceImage: null,
  sourceFilename: "",
  exportedGifFilename: "",
  sourceCanvas: document.createElement("canvas"),
  adjustedCanvas: document.createElement("canvas"),
  frameCanvases: [],
  rectifiedPreviewCanvas: null,
  exportedGifUrl: "",
  processTimer: 0,
  resizeTimer: 0,
  processing: false,
  previewLoopHandle: 0,
  previewFrameIndex: 0,
  previewLastTime: 0,
  alignmentInfo: null,
};

init();

function init() {
  attachUi();
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

function attachUi() {
  makeCanvasDraggable(dom.rawCanvas, "raw-photo.png", () => state.sourceCanvas);
  makeCanvasDraggable(dom.rectifiedCanvas, "rectified-sheet.png", () => state.rectifiedPreviewCanvas);
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
    if (file) {
      handleFile(file);
    }
  });

  dom.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  });

  [
    dom.paperWidth,
    dom.paperHeight,
    dom.frameCols,
    dom.frameRows,
    dom.crossRoiScale,
    dom.useCrossAlignment,
    dom.useRectifiedAsSource,
    dom.cropLeft,
    dom.cropRight,
    dom.cropTop,
    dom.cropBottom,
    dom.brightness,
    dom.contrast,
    dom.saturation,
    dom.fps,
  ].forEach((input) => {
    input.addEventListener("input", () => {
      updateSliderReadouts();
      scheduleProcess();
    });
    input.addEventListener("change", scheduleProcess);
  });

  dom.exportButton.addEventListener("click", () => {
    void exportGif();
  });
}

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

function makeGifImageDraggable() {
  dom.gifImage.draggable = true;
  dom.gifImage.addEventListener("dragstart", (event) => {
    if (!state.exportedGifUrl || !state.exportedGifFilename) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/uri-list", state.exportedGifUrl);
    event.dataTransfer.setData("text/plain", state.exportedGifUrl);
    event.dataTransfer.setData(
      "DownloadURL",
      `image/gif:${state.exportedGifFilename}:${state.exportedGifUrl}`
    );
  });
}

function onOpenCvReady() {
  state.cvReady = true;
  setStatus("OpenCV.js ready.\nLoad frame-sheet image to begin.");
}

function attachResizeHandler() {
  window.addEventListener("resize", () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      rerenderPreviews();
    }, 40);
  });
}

async function handleFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = async () => {
    URL.revokeObjectURL(url);
    state.sourceImage = image;
    state.sourceFilename = file.name || "";
    dom.rawPhotoName.textContent = `(${file.name})`;
    drawImageToCanvas(image, state.sourceCanvas);
    renderCanvasFit(state.sourceCanvas, dom.rawCanvas);
    dom.gifImage.classList.add("hidden");
    dom.gifImage.hidden = true;
    revokeGifUrl();
    await processCurrentImage();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus("Failed to load the selected image.");
  };
  image.src = url;
}

function scheduleProcess() {
  if (!state.sourceImage) return;
  window.clearTimeout(state.processTimer);
  state.processTimer = window.setTimeout(() => {
    void processCurrentImage();
  }, 220);
}

function readConfig() {
  return {
    paperWidthIn: Math.max(1, Number(dom.paperWidth.value) || 11),
    paperHeightIn: Math.max(1, Number(dom.paperHeight.value) || 8.5),
    frameCols: Math.max(1, Math.round(Number(dom.frameCols.value) || 5)),
    frameRows: Math.max(1, Math.round(Number(dom.frameRows.value) || 4)),
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
      saturation: Number(dom.saturation.value) || 0,
    },
    fps: Math.max(1, Math.min(60, Math.round(Number(dom.fps.value) || 20))),
  };
}

function updateSliderReadouts() {
  dom.brightnessValue.textContent = formatSignedValue(dom.brightness.value);
  dom.contrastValue.textContent = formatSignedValue(dom.contrast.value);
  dom.saturationValue.textContent = formatSignedValue(dom.saturation.value);
  const config = readConfig();
  const roiSizePx = estimateCrossRoiSidePx(
    state.alignmentInfo?.rectifiedWidth,
    state.alignmentInfo?.rectifiedHeight,
    config.frameCols,
    config.frameRows,
    config.crossRoiScale
  );
  dom.crossRoiScaleValue.textContent = `${roiSizePx} px`;
}

function formatSignedValue(value) {
  const number = Number(value) || 0;
  return (number >= 0 ? "+" : "") + number;
}

function estimateCrossRoiSidePx(gridWidth, gridHeight, cols, rows, crossRoiScale) {
  const fallbackWidth = (Number(dom.paperWidth.value) || 11) * 100;
  const fallbackHeight = (Number(dom.paperHeight.value) || 8.5) * 100;
  const effectiveWidth = gridWidth || fallbackWidth;
  const effectiveHeight = gridHeight || fallbackHeight;
  const cellW = effectiveWidth / Math.max(1, cols);
  const cellH = effectiveHeight / Math.max(1, rows);
  const roiHalf = Math.max(10, Math.round(Math.min(cellW, cellH) * 0.18 * crossRoiScale));
  return roiHalf * 2 + 1;
}

async function processCurrentImage() {
  if (!state.cvReady) {
    setStatus("OpenCV is still loading.");
    return;
  }
  if (!state.sourceImage || state.processing) return;

  state.processing = true;
  dom.exportButton.disabled = true;

  try {
    const config = readConfig();
    applyVisualAdjustments(state.sourceCanvas, state.adjustedCanvas, config.filters);
    const result = runPipeline(state.sourceCanvas, state.adjustedCanvas, config);
    state.frameCanvases = result.frames;
    state.alignmentInfo = result.alignmentInfo;
    state.rectifiedPreviewCanvas = result.rectifiedCanvas;
    updateSliderReadouts();
    renderCanvasFit(state.sourceCanvas, dom.rawCanvas);
    renderRectifiedPreview(result.rectifiedCanvas);
    renderCrossRoiGrid(result.alignmentInfo);
    drawCurrentGifPreview();
    dom.exportButton.disabled = state.frameCanvases.length === 0;
    setStatus(result.statusText);
  } catch (error) {
    console.error(error);
    setStatus("Processing failed.\n" + (error?.message || String(error)));
  } finally {
    state.processing = false;
  }
}

function runPipeline(sourceCanvas, adjustedCanvas, config) {
  const visionSrc = cv.imread(sourceCanvas);
  const styledSrc = cv.imread(adjustedCanvas);

  const grayImg = new cv.Mat();
  const thresh = new cv.Mat();

  try {
    cv.cvtColor(visionSrc, grayImg, cv.COLOR_RGBA2GRAY);
    const threshVal = estimatePaperThreshold(grayImg);
    cv.threshold(grayImg, thresh, threshVal, 255, cv.THRESH_BINARY);

    const pageQuad = findLargestQuad(thresh, sourceCanvas.width * sourceCanvas.height);
    const ordered = orderCorners(pageQuad.points);
    const pageSizeLow = new cv.Size(
      Math.round(config.paperWidthIn * 100),
      Math.round(config.paperHeightIn * 100)
    );
    const pageSizeHigh = estimateHighResPageWarpSize(
      pageQuad.quadAreaPx,
      config.paperWidthIn,
      config.paperHeightIn,
      pageSizeLow
    );
    const pageWarpLow = perspectiveWarp(visionSrc, styledSrc, ordered, pageSizeLow);
    const pageWarpHigh = perspectiveWarp(visionSrc, styledSrc, ordered, pageSizeHigh);

    const lightnessLow = toLightnessGray(pageWarpLow.visionMat);
    const dotRectLow = findDotRect(lightnessLow);
    lightnessLow.delete();
    const dotRectHigh = scaleDotRect(dotRectLow, pageSizeLow, pageSizeHigh);

    const rectifiedSize = estimateRectifiedSize(dotRectHigh);
    const detectionPadding = estimateDetectionPadding(
      rectifiedSize.width,
      rectifiedSize.height,
      config.frameCols,
      config.frameRows,
      config.crossRoiScale
    );
    const useRectifiedAsSource = config.useRectifiedAsSource;
    const finalDotRect = useRectifiedAsSource
      ? dotRectHigh
      : mapDotRectThroughHomography(dotRectHigh, pageWarpHigh.inverseTransform);
    const finalVisionSource = useRectifiedAsSource ? pageWarpHigh.visionMat : visionSrc;
    const finalStyledSource = useRectifiedAsSource ? pageWarpHigh.styledMat : styledSrc;
    const rectifiedWarp = rectifyByDots(
      finalVisionSource,
      finalStyledSource,
      finalDotRect,
      rectifiedSize,
      detectionPadding
    );
    const alignmentInfo = config.useCrossAlignment
      ? buildCrossAlignmentData(
          rectifiedWarp.visionMat,
          config.frameCols,
          config.frameRows,
          config.crossRoiScale,
          rectifiedWarp.gridBounds
        )
      : buildUnrefinedCrossRegionInfo(
          rectifiedWarp.visionMat,
          config.frameCols,
          config.frameRows,
          "disabled",
          rectifiedWarp.gridBounds,
          config.crossRoiScale
        );

    const frames = sliceRectifiedToCanvases(
      rectifiedWarp.styledMat,
      alignmentInfo,
      config.crop
    );
    const rectifiedCanvas = matToCanvas(rectifiedWarp.styledMat);

    const statusText = buildStatusText({
      threshVal,
      rawWidth: sourceCanvas.width,
      rawHeight: sourceCanvas.height,
      pageAreaPct: pageQuad.areaPct,
      pageWarpWidth: pageSizeLow.width,
      pageWarpHeight: pageSizeLow.height,
      highPageWarpWidth: pageSizeHigh.width,
      highPageWarpHeight: pageSizeHigh.height,
      alignmentInfo,
      frameCount: frames.length,
      rectifiedWidth: rectifiedWarp.styledMat.cols,
      rectifiedHeight: rectifiedWarp.styledMat.rows,
      animationWidth: frames[0]?.width || 0,
      animationHeight: frames[0]?.height || 0,
      sourceMode: useRectifiedAsSource ? "rectified" : "raw photo",
    });

    rectifiedWarp.visionMat.delete();
    rectifiedWarp.styledMat.delete();
    pageWarpLow.visionMat.delete();
    pageWarpLow.styledMat.delete();
    pageWarpHigh.visionMat.delete();
    pageWarpHigh.styledMat.delete();

    return { frames, rectifiedCanvas, alignmentInfo, statusText };
  } finally {
    visionSrc.delete();
    styledSrc.delete();
    grayImg.delete();
    thresh.delete();
  }
}

function estimatePaperThreshold(grayImg) {
  const images = new cv.MatVector();
  const hist = new cv.Mat();
  images.push_back(grayImg);
  cv.calcHist(images, [0], new cv.Mat(), hist, [256], [0, 256]);
  const { maxLoc } = cv.minMaxLoc(hist);
  const peakBin = (hist.rows > 1) ? maxLoc.y : maxLoc.x;
  images.delete();
  hist.delete();
  return Math.max(0, peakBin - 20);
}

function findLargestQuad(binaryMat, totalArea) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const approx = new cv.Mat();

  try {
    cv.findContours(binaryMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() === 0) {
      throw new Error("No page contour found.");
    }

    let largest = contours.get(0);
    let maxArea = cv.contourArea(largest);
    for (let i = 1; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area > maxArea) {
        maxArea = area;
        largest = contour;
      }
    }

    const peri = cv.arcLength(largest, true);
    cv.approxPolyDP(largest, approx, 0.02 * peri, true);
    if (approx.rows !== 4) {
      throw new Error(`Expected 4 page corners, got ${approx.rows}.`);
    }

    const points = [];
    for (let i = 0; i < 4; i++) {
      const pt = approx.intPtr(i, 0);
      points.push({ x: pt[0], y: pt[1] });
    }

    return {
      points,
      areaPx: maxArea,
      quadAreaPx: getPolygonArea(points),
      areaPct: maxArea / totalArea,
    };
  } finally {
    contours.delete();
    hierarchy.delete();
    approx.delete();
  }
}

function estimateHighResPageWarpSize(quadAreaPx, paperWidthIn, paperHeightIn, pageSizeLow) {
  const aspect = Math.max(1e-6, paperWidthIn / paperHeightIn);
  const widthFromArea = Math.max(1, Math.round(Math.sqrt(Math.max(1, quadAreaPx) * aspect)));
  const heightFromArea = Math.max(1, Math.round(Math.sqrt(Math.max(1, quadAreaPx) / aspect)));
  return new cv.Size(
    Math.max(pageSizeLow.width, widthFromArea),
    Math.max(pageSizeLow.height, heightFromArea)
  );
}

function scaleDotRect(dotRect, fromSize, toSize) {
  const sx = toSize.width / fromSize.width;
  const sy = toSize.height / fromSize.height;
  return {
    tl: { x: dotRect.tl.x * sx, y: dotRect.tl.y * sy },
    tr: { x: dotRect.tr.x * sx, y: dotRect.tr.y * sy },
    br: { x: dotRect.br.x * sx, y: dotRect.br.y * sy },
    bl: { x: dotRect.bl.x * sx, y: dotRect.bl.y * sy },
  };
}

function getPolygonArea(points) {
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area2 += (p.x * q.y) - (q.x * p.y);
  }
  return Math.abs(area2) * 0.5;
}

function perspectiveWarp(visionSrc, styledSrc, ordered, size) {
  const srcCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ordered.tl.x, ordered.tl.y,
    ordered.tr.x, ordered.tr.y,
    ordered.br.x, ordered.br.y,
    ordered.bl.x, ordered.bl.y,
  ]);
  const dstCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    size.width, 0,
    size.width, size.height,
    0, size.height,
  ]);
  const transform = cv.getPerspectiveTransform(srcCorners, dstCorners);
  const inverseTransform = cv.getPerspectiveTransform(dstCorners, srcCorners);
  const visionMat = new cv.Mat();
  const styledMat = new cv.Mat();
  cv.warpPerspective(visionSrc, visionMat, transform, size);
  cv.warpPerspective(styledSrc, styledMat, transform, size);
  const forwardArray = homographyMatToArray(transform);
  const inverseArray = homographyMatToArray(inverseTransform);
  srcCorners.delete();
  dstCorners.delete();
  transform.delete();
  inverseTransform.delete();
  return {
    visionMat,
    styledMat,
    forwardTransform: forwardArray,
    inverseTransform: inverseArray,
  };
}

function homographyMatToArray(mat) {
  const values = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      values.push(mat.doubleAt(row, col));
    }
  }
  return values;
}

function applyHomographyToPoint(point, homography) {
  const x = point.x;
  const y = point.y;
  const w =
    (homography[6] * x) +
    (homography[7] * y) +
    homography[8];
  const safeW = Math.abs(w) > 1e-9 ? w : 1e-9;
  return {
    x: ((homography[0] * x) + (homography[1] * y) + homography[2]) / safeW,
    y: ((homography[3] * x) + (homography[4] * y) + homography[5]) / safeW,
  };
}

function mapDotRectThroughHomography(dotRect, homography) {
  return {
    tl: applyHomographyToPoint(dotRect.tl, homography),
    tr: applyHomographyToPoint(dotRect.tr, homography),
    br: applyHomographyToPoint(dotRect.br, homography),
    bl: applyHomographyToPoint(dotRect.bl, homography),
  };
}

function findDotRect(pageGrayMat) {
  const cols = columnSums(pageGrayMat);
  const rows = rowSums(pageGrayMat);
  const leftDip = findFirstDipFromEdge(cols, "left", {
    insetPx: IGNORE_PX,
    depthFrac: DOT_DIM_PCT_COLS,
    gutterLenFrac: GUTTER_PCT,
    gutterTolFrac: 0.01,
  });
  const rightDip = findFirstDipFromEdge(cols, "right", {
    insetPx: IGNORE_PX,
    depthFrac: DOT_DIM_PCT_COLS,
    gutterLenFrac: GUTTER_PCT,
    gutterTolFrac: 0.01,
  });
  const topDip = findFirstDipFromEdge(rows, "top", {
    insetPx: IGNORE_PX,
    depthFrac: DOT_DIM_PCT_ROWS,
    gutterLenFrac: GUTTER_PCT,
    gutterTolFrac: 0.01,
  });
  const bottomDip = findFirstDipFromEdge(rows, "bottom", {
    insetPx: IGNORE_PX,
    depthFrac: DOT_DIM_PCT_ROWS,
    gutterLenFrac: GUTTER_PCT,
    gutterTolFrac: 0.01,
  });

  return {
    tl: refineDotCentroid(pageGrayMat, leftDip.center, topDip.center, leftDip.width, topDip.width, 3.5),
    tr: refineDotCentroid(pageGrayMat, rightDip.center, topDip.center, rightDip.width, topDip.width, 3.5),
    br: refineDotCentroid(pageGrayMat, rightDip.center, bottomDip.center, rightDip.width, bottomDip.width, 3.5),
    bl: refineDotCentroid(pageGrayMat, leftDip.center, bottomDip.center, leftDip.width, bottomDip.width, 3.5),
  };
}

function estimateRectifiedSize(dotRect) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return new cv.Size(
    Math.round((dist(dotRect.tl, dotRect.tr) + dist(dotRect.bl, dotRect.br)) * 0.5),
    Math.round((dist(dotRect.tl, dotRect.bl) + dist(dotRect.tr, dotRect.br)) * 0.5)
  );
}

function estimateDetectionPadding(rectifiedWidth, rectifiedHeight, cols, rows, crossRoiScale) {
  const cellW = rectifiedWidth / cols;
  const cellH = rectifiedHeight / rows;
  const roiHalf = Math.max(10, Math.round(Math.min(cellW, cellH) * 0.18 * crossRoiScale));
  return roiHalf + 4;
}

function rectifyByDots(pageVision, pageStyled, dotRect, size, padding = 0) {
  const srcCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
    dotRect.tl.x, dotRect.tl.y,
    dotRect.tr.x, dotRect.tr.y,
    dotRect.br.x, dotRect.br.y,
    dotRect.bl.x, dotRect.bl.y,
  ]);
  const dstCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
    padding, padding,
    padding + size.width, padding,
    padding + size.width, padding + size.height,
    padding, padding + size.height,
  ]);
  const transform = cv.getPerspectiveTransform(srcCorners, dstCorners);
  const visionMat = new cv.Mat();
  const styledMat = new cv.Mat();
  const expandedSize = new cv.Size(size.width + padding * 2, size.height + padding * 2);
  cv.warpPerspective(pageVision, visionMat, transform, expandedSize, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  cv.warpPerspective(pageStyled, styledMat, transform, expandedSize, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  srcCorners.delete();
  dstCorners.delete();
  transform.delete();
  return {
    visionMat,
    styledMat,
    gridBounds: {
      left: padding,
      top: padding,
      width: size.width,
      height: size.height,
    },
  };
}

function sliceRectifiedToCanvases(rectifiedMat, extractionInfo, crop) {
  const frames = [];
  const cols = extractionInfo.cols;
  const rows = extractionInfo.rows;
  const gridBounds = extractionInfo.gridBounds;
  const cellWidth = gridBounds.width / cols;
  const cellHeight = gridBounds.height / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nominalWidth = Math.max(1, cellWidth - crop.left - crop.right);
      const nominalHeight = Math.max(1, cellHeight - crop.top - crop.bottom);
      const outW = Math.max(1, Math.round(nominalWidth));
      const outH = Math.max(1, Math.round(nominalHeight));
      const quad = resolveFrameQuad(extractionInfo, col, row);
      const u0 = crop.left / cellWidth;
      const u1 = 1 - (crop.right / cellWidth);
      const v0 = crop.top / cellHeight;
      const v1 = 1 - (crop.bottom / cellHeight);
      const srcTL = bilerpQuad(quad, u0, v0);
      const srcTR = bilerpQuad(quad, u1, v0);
      const srcBR = bilerpQuad(quad, u1, v1);
      const srcBL = bilerpQuad(quad, u0, v1);
      const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        srcTL.x, srcTL.y,
        srcTR.x, srcTR.y,
        srcBR.x, srcBR.y,
        srcBL.x, srcBL.y,
      ]);
      const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        Math.max(0, outW - 1), 0,
        Math.max(0, outW - 1), Math.max(0, outH - 1),
        0, Math.max(0, outH - 1),
      ]);
      const perspective = cv.getPerspectiveTransform(srcPts, dstPts);
      const patch = new cv.Mat();
      cv.warpPerspective(
        rectifiedMat,
        patch,
        perspective,
        new cv.Size(outW, outH),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );
      frames.push(matToCanvas(patch));
      srcPts.delete();
      dstPts.delete();
      perspective.delete();
      patch.delete();
    }
  }

  return frames;
}

function renderRectifiedPreview(rectifiedCanvas) {
  const preview = dom.rectifiedCanvas;
  renderCanvasFit(rectifiedCanvas, preview);
}

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
      const isCorner = ((col === 0) || (col === alignmentInfo.cols)) &&
        ((row === 0) || (row === alignmentInfo.rows));
      if (isCorner) {
        const spacer = document.createElement("div");
        spacer.className = "cross-roi-empty";
        grid.appendChild(spacer);
        continue;
      }

      const tile = alignmentInfo.crossRoiTileMap.get(getMarkerKey(col, row));
      if (tile) {
        tile.canvas.classList.add("cross-roi-tile");
        tile.canvas.title = (tile.kind === "unrefined")
          ? ""
          : `(${col}, ${row}) ${tile.accepted ? "accepted" : "rejected"}`;
        grid.appendChild(tile.canvas);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "cross-roi-empty";
        grid.appendChild(spacer);
      }
    }
  }
}

function startGifPreviewLoop() {
  const loop = (time) => {
    if (state.frameCanvases.length > 0) {
      const fps = readConfig().fps;
      const frameDelay = 1000 / fps;
      if ((time - state.previewLastTime) >= frameDelay) {
        state.previewLastTime = time;
        state.previewFrameIndex = (state.previewFrameIndex + 1) % state.frameCanvases.length;
        drawCurrentGifPreview();
      }
    }
    state.previewLoopHandle = requestAnimationFrame(loop);
  };
  state.previewLoopHandle = requestAnimationFrame(loop);
}

function drawCurrentGifPreview() {
  const previewCanvas = dom.gifPreviewCanvas;
  const frame = state.frameCanvases[state.previewFrameIndex];
  if (!frame) {
    const ctx = previewCanvas.getContext("2d");
    resizeCanvasToBox(previewCanvas);
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    return;
  }
  renderCanvasFit(frame, previewCanvas);
}

function rerenderPreviews() {
  if (state.sourceImage) {
    renderCanvasFit(state.sourceCanvas, dom.rawCanvas);
  }
  if (state.rectifiedPreviewCanvas) {
    renderRectifiedPreview(state.rectifiedPreviewCanvas);
  }
  drawCurrentGifPreview();
}

async function exportGif() {
  if (!state.frameCanvases.length) return;

  dom.exportButton.disabled = true;
  setStatus("Encoding GIF…");

  const fps = readConfig().fps;
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: state.frameCanvases[0].width,
    height: state.frameCanvases[0].height,
    repeat: 0,
    workerScript: "../plottimation_GIF_generator/gif.worker.js",
  });

  const delay = Math.max(1, Math.round(1000 / fps));
  for (const frame of state.frameCanvases) {
    gif.addFrame(frame, { copy: true, delay });
  }

  gif.on("finished", (blob) => {
    revokeGifUrl();
    state.exportedGifFilename = makeGifFilename(state.sourceFilename);
    state.exportedGifUrl = URL.createObjectURL(blob);
    dom.gifImage.src = state.exportedGifUrl;
    dom.gifImage.classList.remove("hidden");
    dom.gifImage.hidden = false;
    downloadBlobWithFilename(blob, state.exportedGifFilename);
    dom.exportButton.disabled = false;
    setStatus("GIF ready.\nFrame count: " + state.frameCanvases.length);
  });

  gif.on("progress", (progress) => {
    setStatus("Encoding GIF…\n" + Math.round(progress * 100) + "%");
  });

  gif.render();
}

function revokeGifUrl() {
  if (!state.exportedGifUrl) return;
  URL.revokeObjectURL(state.exportedGifUrl);
  state.exportedGifUrl = "";
  state.exportedGifFilename = "";
  dom.gifImage.classList.add("hidden");
  dom.gifImage.hidden = true;
  dom.gifImage.removeAttribute("src");
}

function makeGifFilename(sourceFilename) {
  const base = sanitizeFilenameBase(sourceFilename || "frame_sheet");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${base}_animation_${yyyy}${mm}${dd}_${hh}${mi}${ss}.gif`;
}

function sanitizeFilenameBase(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "frame_sheet";
}

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

function buildStatusText({
  threshVal,
  rawWidth,
  rawHeight,
  pageAreaPct,
  pageWarpWidth,
  pageWarpHeight,
  highPageWarpWidth,
  highPageWarpHeight,
  alignmentInfo,
  frameCount,
  rectifiedWidth,
  rectifiedHeight,
  animationWidth,
  animationHeight,
  sourceMode,
}) {
  const lines = [
    "Raw photo: " + rawWidth + " x " + rawHeight,
    "Paper threshold: " + threshVal + "/255",
    "Largest contour area: " + pageAreaPct.toFixed(3),
    "Detection warp: " + pageWarpWidth + " x " + pageWarpHeight,
    "Extraction warp: " + highPageWarpWidth + " x " + highPageWarpHeight,
    "Rectified sheet: " + rectifiedWidth + " x " + rectifiedHeight,
    "Animation size: " + animationWidth + " x " + animationHeight,
    "Frame source: " + sourceMode,
    "Frames extracted: " + frameCount,
  ];

  if (alignmentInfo) {
    if (alignmentInfo.ok) {
      lines.push(
        "Cross alignment: " +
        alignmentInfo.detectedCount + "/" + alignmentInfo.expectedCount + " used"
      );
    } else {
      lines.push("Cross alignment fallback: " + alignmentInfo.reason);
    }
  }

  return lines.join("\n");
}

function setStatus(text) {
  dom.statusText.textContent = text;
}

function drawImageToCanvas(image, canvas) {
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function applyVisualAdjustments(sourceCanvas, targetCanvas, filters) {
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  const ctx = targetCanvas.getContext("2d");
  ctx.save();
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.filter = [
    `brightness(${100 + filters.brightness}%)`,
    `contrast(${100 + filters.contrast}%)`,
    `saturate(${100 + filters.saturation}%)`,
  ].join(" ");
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}

function renderCanvasFit(sourceCanvas, targetCanvas) {
  resizeCanvasToBox(targetCanvas);
  const ctx = targetCanvas.getContext("2d");
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

  const scale = Math.min(targetCanvas.width / sourceCanvas.width, targetCanvas.height / sourceCanvas.height);
  const drawW = sourceCanvas.width * scale;
  const drawH = sourceCanvas.height * scale;
  const offsetX = (targetCanvas.width - drawW) * 0.5;
  const offsetY = (targetCanvas.height - drawH) * 0.5;
  ctx.drawImage(sourceCanvas, offsetX, offsetY, drawW, drawH);
}

function resizeCanvasToBox(canvas) {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  if ((canvas.width !== width) || (canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }
}

function matToCanvas(mat) {
  const canvas = document.createElement("canvas");
  const rgba = new cv.Mat();
  try {
    if (mat.type() === cv.CV_8UC4) {
      mat.copyTo(rgba);
    } else if (mat.type() === cv.CV_8UC3) {
      cv.cvtColor(mat, rgba, cv.COLOR_BGR2RGBA);
    } else if (mat.type() === cv.CV_8UC1) {
      cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    } else {
      throw new Error("Unsupported Mat type: " + mat.type());
    }
    canvas.width = rgba.cols;
    canvas.height = rgba.rows;
    const ctx = canvas.getContext("2d");
    const imageData = new ImageData(
      new Uint8ClampedArray(rgba.data),
      rgba.cols,
      rgba.rows
    );
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    rgba.delete();
  }
}

function orderCorners(pts) {
  const sum = (p) => p.x + p.y;
  const diff = (p) => p.y - p.x;
  const tl = pts.reduce((a, b) => (sum(a) < sum(b)) ? a : b);
  const br = pts.reduce((a, b) => (sum(a) > sum(b)) ? a : b);
  const tr = pts.reduce((a, b) => (diff(a) < diff(b)) ? a : b);
  const bl = pts.reduce((a, b) => (diff(a) > diff(b)) ? a : b);
  return { tl, tr, br, bl };
}

function toLightnessGray(inMat) {
  const grayMat = new cv.Mat();
  if (inMat.type() === cv.CV_8UC4) {
    cv.cvtColor(inMat, grayMat, cv.COLOR_RGBA2GRAY);
  } else if (inMat.type() === cv.CV_8UC3) {
    cv.cvtColor(inMat, grayMat, cv.COLOR_BGR2GRAY);
  } else {
    throw new Error("Expected a 3- or 4-channel Mat.");
  }
  const k = Math.max(3, (Math.min(grayMat.rows, grayMat.cols) / 400) | 1);
  cv.GaussianBlur(grayMat, grayMat, new cv.Size(k, k), 0, 0, cv.BORDER_REPLICATE);
  return grayMat;
}

function columnSums(grayImg) {
  const col = new cv.Mat();
  cv.reduce(grayImg, col, 0, cv.REDUCE_SUM, cv.CV_64F);
  const data = new Float64Array(col.data64F);
  col.delete();
  return data;
}

function rowSums(grayImg) {
  const row = new cv.Mat();
  cv.reduce(grayImg, row, 1, cv.REDUCE_SUM, cv.CV_64F);
  const data = new Float64Array(row.data64F);
  row.delete();
  return data;
}

function refineDotCentroid(grayMat, cx, cy, w, h, dscale = 2.0) {
  const rw = Math.round(Math.max(8, w) * dscale);
  const rh = Math.round(Math.max(8, h) * dscale);
  const x0 = Math.max(0, Math.round(cx - rw / 2));
  const y0 = Math.max(0, Math.round(cy - rh / 2));
  const x1 = Math.min(grayMat.cols, x0 + rw);
  const y1 = Math.min(grayMat.rows, y0 + rh);
  const roi = grayMat.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
  const mask = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.threshold(roi, mask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() === 0) {
      throw new Error("No dot found in ROI.");
    }

    let best = contours.get(0);
    let bestArea = cv.contourArea(best);
    for (let i = 1; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area > bestArea) {
        best = contour;
        bestArea = area;
      }
    }

    const moments = cv.moments(best);
    return {
      x: x0 + (moments.m10 / moments.m00),
      y: y0 + (moments.m01 / moments.m00),
    };
  } finally {
    roi.delete();
    mask.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function smooth1D(arr, win = 5) {
  win = Math.max(1, win | 0);
  if ((win % 2) === 0) win += 1;
  const out = new Float64Array(arr.length);
  const half = (win - 1) >> 1;
  for (let i = 0; i < arr.length; i++) {
    let acc = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(arr.length - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      acc += arr[j];
      count++;
    }
    out[i] = acc / count;
  }
  return out;
}

function edgeBaseline(profile, edge = "left", inset = 6, bandFrac = 0.08) {
  const n = profile.length;
  const band = Math.max(inset + 4, Math.min(n, Math.round(n * bandFrac)));
  const values = [];
  if ((edge === "left") || (edge === "top")) {
    for (let i = inset; i < band; i++) values.push(profile[i]);
  } else {
    for (let i = n - band; i < n - inset; i++) values.push(profile[i]);
  }
  values.sort((a, b) => a - b);
  return values[Math.max(0, Math.min(values.length - 1, Math.round(0.95 * (values.length - 1))))];
}

function findFirstDipFromEdge(profile, edge, options = {}) {
  const n = profile.length;
  const insetPx = options.insetPx ?? 8;
  const depthFrac = options.depthFrac ?? 0.04;
  const gutterLenFrac = options.gutterLenFrac ?? 0.01;
  const gutterTolFrac = options.gutterTolFrac ?? 0.01;

  const smooth = smooth1D(profile, options.smoothWin ?? 1);
  const baseline = edgeBaseline(smooth, edge, insetPx, 0.08);
  const dipThresh = baseline * (1 - Math.max(0.01, depthFrac));
  const gutterLen = Math.max(3, Math.round(n * gutterLenFrac));
  const gutterThresh = baseline * (1 - Math.max(0, gutterTolFrac));
  const forward = (edge === "left") || (edge === "top");
  const start = forward ? insetPx : (n - 1 - insetPx);
  const step = forward ? 1 : -1;
  const stop = forward ? (n - gutterLen - 1) : gutterLen;

  let stateName = "SEEK_DROP";
  let left = -1;
  let right = -1;
  let minVal = Infinity;

  for (let i = start; forward ? (i < stop) : (i > stop); i += step) {
    const value = smooth[i];
    if (stateName === "SEEK_DROP") {
      if (value <= dipThresh) {
        stateName = "IN_DIP";
        left = i;
        minVal = value;
      }
    } else if (stateName === "IN_DIP") {
      if (value < minVal) minVal = value;
      const leaveThresh = (dipThresh + baseline) * 0.5;
      if (value >= leaveThresh) {
        right = i;
        stateName = "SEEK_GUTTER";
      }
    } else {
      let ok = true;
      for (let k = 0; k < gutterLen; k++) {
        const j = i + k * step;
        if ((j < 0) || (j >= n) || (smooth[j] < gutterThresh)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const a = Math.min(left, right);
        const b = Math.max(left, right);
        return {
          center: Math.round((a + b) / 2),
          width: b - a + 1,
          left: a,
          right: b,
          baseline,
          minVal,
        };
      }
      if (value <= dipThresh) {
        right = i;
        stateName = "IN_DIP";
        if (value < minVal) minVal = value;
      }
    }
  }

  throw new Error("Could not locate corner dots from " + edge + " edge.");
}

function buildFallbackFrameExtractionData(
  rectifiedMat,
  cols,
  rows,
  reason = "fallback",
  gridBounds = null,
  detectedInfo = null
) {
  const bounds = gridBounds || {
    left: 0,
    top: 0,
    width: rectifiedMat.cols,
    height: rectifiedMat.rows,
  };
  const expectedCrosses = getExpectedCrossLattice(bounds, cols, rows);
  const anchorDots = getRectifiedCornerAnchors(bounds, cols, rows);
  const markerLookup = buildMarkerLookup(expectedCrosses, [], anchorDots, cols, rows);
  return {
    ok: false,
    reason,
    rectifiedWidth: rectifiedMat.cols,
    rectifiedHeight: rectifiedMat.rows,
    gridBounds: bounds,
    cols,
    rows,
    expectedCount: expectedCrosses.length,
    detectedCount: detectedInfo?.detectedCount ?? 0,
    expectedCrosses,
    anchorDots,
    detectedCrosses: detectedInfo?.detectedCrosses ?? [],
    rejectedCrosses: detectedInfo?.rejectedCrosses ?? [],
    markerLookup,
    frameDebugQuads: buildFrameDebugQuads(markerLookup, cols, rows, bounds),
    crossRoiTiles: detectedInfo?.crossRoiTiles ?? [],
    crossRoiTileMap: detectedInfo?.crossRoiTileMap ?? new Map(),
  };
}

function buildUnrefinedCrossRegionInfo(
  rectifiedMat,
  cols,
  rows,
  reason = "disabled",
  gridBounds = null,
  crossRoiScale = 0.75
) {
  const bounds = gridBounds || {
    left: 0,
    top: 0,
    width: rectifiedMat.cols,
    height: rectifiedMat.rows,
  };
  const expectedCrosses = getExpectedCrossLattice(bounds, cols, rows);
  const anchorDots = getRectifiedCornerAnchors(bounds, cols, rows);
  const markerLookup = buildMarkerLookup(expectedCrosses, [], anchorDots, cols, rows);
  const crossRoiTiles = expectedCrosses.map((expected) =>
    buildUnrefinedCrossRegionTile(
      rectifiedMat,
      expected,
      rectifiedMat.cols,
      rectifiedMat.rows,
      cols,
      rows,
      crossRoiScale
    )
  );

  return {
    ok: false,
    reason,
    rectifiedWidth: rectifiedMat.cols,
    rectifiedHeight: rectifiedMat.rows,
    gridBounds: bounds,
    cols,
    rows,
    expectedCount: expectedCrosses.length,
    detectedCount: 0,
    expectedCrosses,
    anchorDots,
    detectedCrosses: [],
    rejectedCrosses: [],
    markerLookup,
    frameDebugQuads: buildFrameDebugQuads(markerLookup, cols, rows, bounds),
    crossRoiTiles,
    crossRoiTileMap: new Map(crossRoiTiles.map((tile) => [getMarkerKey(tile.col, tile.row), tile])),
  };
}

function buildCrossAlignmentData(rectifiedMat, cols, rows, crossRoiScale = 0.75, gridBounds = null) {
  const bounds = gridBounds || {
    left: 0,
    top: 0,
    width: rectifiedMat.cols,
    height: rectifiedMat.rows,
  };
  const expectedCrosses = getExpectedCrossLattice(bounds, cols, rows);
  if (expectedCrosses.length === 0) {
    return buildFallbackFrameExtractionData(rectifiedMat, cols, rows, "no crosses expected", bounds);
  }
  const anchorDots = getRectifiedCornerAnchors(bounds, cols, rows);

  const grayMat = toLightnessGray(rectifiedMat);
  const detectedCrosses = [];
  const rejectedCrosses = [];
  const crossRoiTiles = [];

  try {
    for (const expected of expectedCrosses) {
      const detection = detectCrossAtExpectedPosition(
        grayMat,
        expected,
        rectifiedMat.cols,
        rectifiedMat.rows,
        cols,
        rows,
        crossRoiScale
      );
      crossRoiTiles.push(detection);
      if (detection.accepted) {
        detectedCrosses.push(detection);
      } else {
        rejectedCrosses.push(detection);
      }
    }
  } finally {
    grayMat.delete();
  }

  const minRequired = Math.max(
    Math.min(expectedCrosses.length, MIN_CROSS_DETECTIONS_ABS),
    Math.ceil(expectedCrosses.length * MIN_CROSS_DETECTION_RATIO)
  );
  const ok = detectedCrosses.length >= minRequired;
  const markerLookup = buildMarkerLookup(expectedCrosses, detectedCrosses, anchorDots, cols, rows);
  return {
    ok,
    reason: ok ? "ok" : `too few confident detections (${detectedCrosses.length}/${expectedCrosses.length})`,
    rectifiedWidth: rectifiedMat.cols,
    rectifiedHeight: rectifiedMat.rows,
    gridBounds: bounds,
    cols,
    rows,
    expectedCount: expectedCrosses.length,
    detectedCount: detectedCrosses.length,
    expectedCrosses,
    anchorDots,
    detectedCrosses,
    rejectedCrosses,
    markerLookup,
    frameDebugQuads: buildFrameDebugQuads(markerLookup, cols, rows, bounds),
    crossRoiTiles,
    crossRoiTileMap: new Map(crossRoiTiles.map((tile) => [getMarkerKey(tile.col, tile.row), tile])),
  };
}

function getExpectedCrossLattice(bounds, cols, rows) {
  const points = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const isCorner = ((col === 0) || (col === cols)) && ((row === 0) || (row === rows));
      if (isCorner) continue;
      points.push({
        col,
        row,
        x: bounds.left + bounds.width * (col / cols),
        y: bounds.top + bounds.height * (row / rows),
      });
    }
  }
  return points;
}

function getRectifiedCornerAnchors(bounds, cols, rows) {
  return [
    { kind: "dot", col: 0, row: 0, x: bounds.left, y: bounds.top, detectedX: bounds.left, detectedY: bounds.top, dx: 0, dy: 0, confidence: 10, accepted: true },
    { kind: "dot", col: cols, row: 0, x: bounds.left + bounds.width, y: bounds.top, detectedX: bounds.left + bounds.width, detectedY: bounds.top, dx: 0, dy: 0, confidence: 10, accepted: true },
    { kind: "dot", col: cols, row: rows, x: bounds.left + bounds.width, y: bounds.top + bounds.height, detectedX: bounds.left + bounds.width, detectedY: bounds.top + bounds.height, dx: 0, dy: 0, confidence: 10, accepted: true },
    { kind: "dot", col: 0, row: rows, x: bounds.left, y: bounds.top + bounds.height, detectedX: bounds.left, detectedY: bounds.top + bounds.height, dx: 0, dy: 0, confidence: 10, accepted: true },
  ];
}

function detectCrossAtExpectedPosition(grayMat, expected, sheetW, sheetH, cols, rows, crossRoiScale = 0.75) {
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  const roiHalf = Math.max(10, Math.round(Math.min(cellW, cellH) * 0.18 * crossRoiScale));
  const centerX = expected.x;
  const centerY = expected.y;
  const side = Math.max(1, roiHalf * 2 + 1);
  const roi = extractCenteredSquareRoi(grayMat, centerX, centerY, side);
  const mask = new cv.Mat();

  try {
    cv.threshold(roi, mask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    const roiW = roi.cols;
    const roiH = roi.rows;
    const bandHalfH = Math.max(1, Math.round(roiH * 0.18));
    const bandHalfW = Math.max(1, Math.round(roiW * 0.18));
    const bandY0 = Math.max(0, Math.floor(roiH * 0.5 - bandHalfH));
    const bandY1 = Math.min(roiH, Math.ceil(roiH * 0.5 + bandHalfH));
    const bandX0 = Math.max(0, Math.floor(roiW * 0.5 - bandHalfW));
    const bandX1 = Math.min(roiW, Math.ceil(roiW * 0.5 + bandHalfW));
    const colProfile = new Float64Array(roiW);
    const rowProfile = new Float64Array(roiH);
    const data = mask.data;

    for (let y = 0; y < roiH; y++) {
      const rowOffset = y * roiW;
      for (let x = 0; x < roiW; x++) {
        const value = data[rowOffset + x] / 255.0;
        if ((y >= bandY0) && (y < bandY1)) colProfile[x] += value;
        if ((x >= bandX0) && (x < bandX1)) rowProfile[y] += value;
      }
    }

    const peakX = getWeightedPeakIndex(smooth1D(colProfile, 5));
    const peakY = getWeightedPeakIndex(smooth1D(rowProfile, 5));
    const roiCenterX = (roiW - 1) * 0.5;
    const roiCenterY = (roiH - 1) * 0.5;
    const detectedX = centerX + (peakX.position - roiCenterX);
    const detectedY = centerY + (peakY.position - roiCenterY);
    const dx = detectedX - expected.x;
    const dy = detectedY - expected.y;
    const darkFrac = countNonZeroMask(mask) / (roiW * roiH);
    const colContrast = peakX.value / Math.max(1e-6, averageArrayValue(colProfile));
    const rowContrast = peakY.value / Math.max(1e-6, averageArrayValue(rowProfile));
    const displacementLimit = Math.max(2.0, Math.min(cellW, cellH) * 0.08);
    const accepted =
      Math.hypot(dx, dy) <= displacementLimit &&
      colContrast >= 1.6 &&
      rowContrast >= 1.6 &&
      darkFrac >= 0.002 &&
      darkFrac <= 0.25;

    return {
      ...expected,
      kind: "cross",
      detectedX,
      detectedY,
      dx,
      dy,
      darkFrac,
      confidence: colContrast * rowContrast,
      accepted,
      canvas: buildCrossRoiCanvas(roi, peakX.position, peakY.position, accepted),
    };
  } finally {
    roi.delete();
    mask.delete();
  }
}

function buildUnrefinedCrossRegionTile(
  grayMat,
  expected,
  sheetW,
  sheetH,
  cols,
  rows,
  crossRoiScale = 0.75
) {
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  const roiHalf = Math.max(10, Math.round(Math.min(cellW, cellH) * 0.18 * crossRoiScale));
  const side = Math.max(1, roiHalf * 2 + 1);
  const roi = extractCenteredSquareRoi(grayMat, expected.x, expected.y, side);
  const center = (side - 1) * 0.5;

  try {
    return {
      ...expected,
      kind: "unrefined",
      detectedX: expected.x,
      detectedY: expected.y,
      dx: 0,
      dy: 0,
      darkFrac: 0,
      confidence: 0,
      accepted: false,
      canvas: buildCrossRoiCanvas(roi, center, center, false),
    };
  } finally {
    roi.delete();
  }
}

function extractCenteredSquareRoi(grayMat, centerX, centerY, side) {
  const roi = new cv.Mat();
  const roiCenter = (side - 1) * 0.5;
  const tx = roiCenter - centerX;
  const ty = roiCenter - centerY;
  const affine = cv.matFromArray(2, 3, cv.CV_64F, [
    1, 0, tx,
    0, 1, ty,
  ]);

  try {
    cv.warpAffine(
      grayMat,
      roi,
      affine,
      new cv.Size(side, side),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar()
    );
  } finally {
    affine.delete();
  }

  return roi;
}

function buildCrossRoiCanvas(roiMat, localX, localY, accepted) {
  const canvas = matToCanvas(roiMat);
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.strokeStyle = accepted ? "rgba(255, 0, 0, 0.55)" : "rgba(255, 0, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(localX + 0.5, 0);
  ctx.lineTo(localX + 0.5, canvas.height);
  ctx.moveTo(0, localY + 0.5);
  ctx.lineTo(canvas.width, localY + 0.5);
  ctx.stroke();
  ctx.restore();
  return canvas;
}

function getWeightedPeakIndex(arr) {
  let maxIdx = 0;
  let maxVal = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i];
      maxIdx = i;
    }
  }
  let acc = 0;
  let wsum = 0;
  for (let i = Math.max(0, maxIdx - 2); i <= Math.min(arr.length - 1, maxIdx + 2); i++) {
    const w = Math.max(0, arr[i]);
    acc += i * w;
    wsum += w;
  }
  return {
    position: (wsum > 0) ? (acc / wsum) : maxIdx,
    value: Math.max(0, maxVal),
  };
}

function averageArrayValue(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return arr.length ? (sum / arr.length) : 0;
}

function countNonZeroMask(maskMat) {
  let count = 0;
  const data = maskMat.data;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) count++;
  }
  return count;
}

function buildMarkerLookup(expectedCrosses, detectedCrosses, anchorDots, cols, rows) {
  const lookup = new Map();
  for (const cross of expectedCrosses) {
    lookup.set(getMarkerKey(cross.col, cross.row), {
      ...cross,
      kind: "fallback",
      detectedX: cross.x,
      detectedY: cross.y,
      confidence: 0,
      accepted: false,
    });
  }

  for (const cross of detectedCrosses) {
    lookup.set(getMarkerKey(cross.col, cross.row), cross);
  }

  const corners = [
    { col: 0, row: 0, dot: anchorDots[0] },
    { col: cols, row: 0, dot: anchorDots[1] },
    { col: cols, row: rows, dot: anchorDots[2] },
    { col: 0, row: rows, dot: anchorDots[3] },
  ];
  for (const corner of corners) {
    lookup.set(getMarkerKey(corner.col, corner.row), {
      ...corner.dot,
      col: corner.col,
      row: corner.row,
    });
  }

  return lookup;
}

function getMarkerKey(col, row) {
  return `${col},${row}`;
}

function resolveMarkerPoint(extractionInfo, col, row) {
  const marker = extractionInfo.markerLookup.get(getMarkerKey(col, row));
  if (marker) {
    return {
      x: marker.detectedX,
      y: marker.detectedY,
      marker,
    };
  }
  const bounds = extractionInfo.gridBounds;
  return {
    x: bounds.left + bounds.width * (col / extractionInfo.cols),
    y: bounds.top + bounds.height * (row / extractionInfo.rows),
    marker: null,
  };
}

function resolveFrameQuad(extractionInfo, col, row) {
  const tl = resolveMarkerPoint(extractionInfo, col, row);
  const tr = resolveMarkerPoint(extractionInfo, col + 1, row);
  const br = resolveMarkerPoint(extractionInfo, col + 1, row + 1);
  const bl = resolveMarkerPoint(extractionInfo, col, row + 1);
  return {
    tl,
    tr,
    br,
    bl,
  };
}

function bilerpQuad(quad, u, v) {
  const topX = quad.tl.x * (1 - u) + quad.tr.x * u;
  const topY = quad.tl.y * (1 - u) + quad.tr.y * u;
  const bottomX = quad.bl.x * (1 - u) + quad.br.x * u;
  const bottomY = quad.bl.y * (1 - u) + quad.br.y * u;
  return {
    x: topX * (1 - v) + bottomX * v,
    y: topY * (1 - v) + bottomY * v,
  };
}

function buildFrameDebugQuads(markerLookup, cols, rows, gridBounds) {
  const fakeInfo = {
    markerLookup,
    cols,
    rows,
    rectifiedWidth: gridBounds.left + gridBounds.width,
    rectifiedHeight: gridBounds.top + gridBounds.height,
    gridBounds,
  };
  const quads = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const quad = resolveFrameQuad(fakeInfo, col, row);
      quads.push({
        col,
        row,
        tl: quad.tl,
        tr: quad.tr,
        br: quad.br,
        bl: quad.bl,
      });
    }
  }
  return quads;
}
