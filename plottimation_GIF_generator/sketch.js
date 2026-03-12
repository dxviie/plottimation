/* ANIMATED GIF GENERATOR FOR PLOTTIMATION
 * - Converts frame-sheets to animated GIFs!
 * - Press 's' to export the GIF!
 * - Press 'x' to toggle cross-alignment debug overlays.
 * 
 * This program imports a photograph of a frame-sheet, 
 * and exports a GIF made from the extracted frames. 
 * Created for Drawing with Machines, CMU
 * Golan Levin, 7 October 2025 - (CC BY 4.0)
 * Uses https://github.com/huningxin/opencv.js
 * Uses p5.js v1.11.10 and gif.js v0.2.0.
 * 
 * PLEASE study the included image "mySrcImage.jpg", 
 * and the image "diagram_mySrcImage.png", to understand
 * the assumptions this program makes about input formatting: 
 * 
 * - The paper should be shown against a darker background.
 * - The paper should be completely contained within the photo. 
 * - (It's not a problem if there is some rotation or perspective!)
 * - The paper is assumed to be the brightest color (i.e. white).
 * - The paper should contain a grid of animation frames. 
 * - (You should modify N_FRAME_COLS and N_FRAME_ROWS accordingly.)
 * - (You should specify PAPER_WIDTH_IN and PAPER_HEIGHT_IN also.)
 * - There must be small dark circles on the corners of the frame grid.
 * - There must be NO graphics plotted in the paper margins. 
 * - There must be a thin gutter between the circles and the graphics.
 * - The cross registration marks (+) can optionally refine frame extraction.
 * 
 * The mySrcImage.jpg design was created with this p5 sketch: 
 * - https://editor.p5js.org/golan/sketches/Lv53d3TZw
 * - Uses p5.plotSvg to generate artwork SVGs for e.g. AxiDraw.
 * Feel free to fork/modify these sketches for your own art!
 * The design shown here was inspired by Dave Mawer (dmawer_art)
 * - https://x.com/FigsFromPlums/status/1974203677771477418
 *
 * To-do (Golan notes to self): 
 * - Do subpixel frame alignment with (+) marks to reduce jitter
 * - Offer some basic contrast/brightness controls
 * - Improve variable names, add more documentation
*/ 

// Main user-modifiable fields: 
const PAPER_WIDTH_IN = 11.0; // width of your page in inches
const PAPER_HEIGHT_IN = 8.5; // height of your page in inches
const N_FRAME_COLS = 5; // number of columns of frames
const N_FRAME_ROWS = 4; // number of rows of frames
const CROP_PX = 0; // number of pixels to crop in the GIF
let bUseCrossesForSubpixelAlignment = true;
let bShowCrossAlignmentDebug = false;

// Advanced image-processing controls:
const IGNORE_PX = 8; // number of pixels to ignore on edge of page
const DOT_DIM_PCT_COLS = 0.03; // percent of dimming caused by dots
const DOT_DIM_PCT_ROWS = 0.02; // percent of dimming caused by dots
const GUTTER_PCT = 0.01; // gutter between dots and art, as % of width
const MIN_CROSS_DETECTION_RATIO = 0.5;
const MIN_CROSS_DETECTIONS_ABS = 4;

//-------------------------------------------------------------
let bCvReady = false;
let bGifEncoderReady = false;
let bProcessedImage = false;
let gifRecorder;
let srcImage;
let rectifiedSpriteSheet;
let animationFrames = [];
let crossAlignmentDebug = null;

//-------------------------------------------------------------
function preload() {
  srcImage = loadImage('mySrcImage.jpg');
}

//-------------------------------------------------------------
function setup() {
  createCanvas(800, 450);

  // Wait for OpenCV to initialize
  if (typeof cv !== 'undefined' && cv['onRuntimeInitialized']) {
    cv['onRuntimeInitialized'] = onOpenCvReady;
  } else {
    // fallback if already loaded
    onOpenCvReady();
  }

  // Initialize gif.js
  gifRecorder = new GIF({
    workers: 2,
    quality: 10,
    workerScript:
      'https://cdn.jsdelivr.net/npm/gif.js.optimized/dist/gif.worker.js',
  });
  bGifEncoderReady = true;
}


//-------------------------------------------------------------
function onOpenCvReady() {
  bCvReady = true;
  console.log('OpenCV.js is loaded into p5.js!');
  if (!bProcessedImage){
    if (bCvReady && srcImage){
      processSrcImage();
    }
  }
}


//-------------------------------------------------------------
function draw() {
  background(255);
  textSize(12);
  fill(0); 

  if (bProcessedImage){
    // Draw original source image
    let srcw = srcImage.width; 
    let srch = srcImage.height; 
    push(); 
    translate(0,0); 
    scale(width/srcw*0.5);
    image(srcImage,0,0,srcw,srch); 
    pop(); 
    
    // Draw rectified extracted sprite grid
    let rssw = rectifiedSpriteSheet.width;
    let rssh = rectifiedSpriteSheet.height;
    push(); 
    translate(width/2,0); 
    scale(width/rssw*0.5);
    image(rectifiedSpriteSheet,0,0,rssw,rssh); 
    if (bShowCrossAlignmentDebug && crossAlignmentDebug){
      drawCrossAlignmentDebugOverlay(crossAlignmentDebug);
    }
    pop(); 
  
    push(); 
    let nFrames = animationFrames.length; 
    let currentFrame = frameCount%nFrames;
    let aw = animationFrames[currentFrame].width;
    let ah = animationFrames[currentFrame].height;
    translate(width/2 + 20, width/rssw*0.5*rssh + 20); 
    image(animationFrames[currentFrame],0,0, aw,ah);
    pop(); 
  }
}


//-------------------------------------------------------------
function processSrcImage() {
  if (!bCvReady) return;
  if (!srcImage || srcImage.width === 0 || srcImage.height === 0) {
    console.warn('srcImage not ready yet');
    return;
  }

  // --- Allocate opencv Mats up front
  const src = cv.imread(srcImage.canvas || srcImage.elt); 
  const grayImg = new cv.Mat();
  const thresh = new cv.Mat();

  try {
    //-----------------
    print ("1. Converting RGBA source image to GRAY"); 
    cv.cvtColor(src, grayImg, cv.COLOR_RGBA2GRAY);
    
    //-----------------
    print ("2. Computing paper threshold via histogram"); 
    const images = new cv.MatVector();
    images.push_back(grayImg); // CV_8UC1
    const channels = [0];      // histogram over channel 0
    const histSize = [256];    // 256 bins
    const ranges   = [0, 256]; // intensity range [0,256)
    const hist = new cv.Mat();
    cv.calcHist(images, channels, new cv.Mat(), hist, histSize, ranges);
    // find the brightest peak (bin index)
    const { maxLoc } = cv.minMaxLoc(hist);
    const peakBin = (hist.rows > 1) ? maxLoc.y : maxLoc.x; 
    const threshVal = Math.max(0, peakBin - 20);
    print ("   (Likely) paper brightness = " + peakBin + "/255"); 
    images.delete();
    hist.delete();

    //-----------------
    print ("3. Thresholding bright blobs (assume paper is brightest)"); 
    cv.threshold(grayImg, thresh, threshVal, 255, cv.THRESH_BINARY);

    //-----------------
    print ("4. Finding largest contour (presumably: the page)"); 
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, 
                    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() === 0) throw new Error('No contours found.');
    let largest = contours.get(0);
    let maxArea = cv.contourArea(largest);
    for (let i = 1; i < contours.size(); i++) {
      const c = contours.get(i);
      const a = cv.contourArea(c);
      if (a > maxArea) { maxArea = a; largest = c; }
    }
    let totalArea = srcImage.width * srcImage.height;
    print("   Area percentage of largest contour = " + nf(maxArea/totalArea, 1,3)); 
    
    //-----------------
    print ("5. Approximate largest contour as quadrilateral"); 
    const peri = cv.arcLength(largest, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(largest, approx, 0.02 * peri, true);
    if (approx.rows !== 4) throw new Error(
      `Expected 4 corners; got ${approx.rows}`);

    //-----------------
    print ("6. Ensure corner order: TL,TR,BR,BL"); 
    const srcPts = [];
    for (let i = 0; i < 4; i++) {
      const pt = approx.intPtr(i, 0);
      srcPts.push({ x: pt[0], y: pt[1] });
    }
    // See helper function orderCorners() below
    const ordered = orderCorners(srcPts);
    
    //-----------------
    let aspectStr = nf(PAPER_WIDTH_IN,0) + "x" + nf(PAPER_HEIGHT_IN,0);
    print ("7. Resize and perspective-unwarp to " + aspectStr + " aspect ratio"); 
    const PW = Math.round(PAPER_WIDTH_IN * 100);
    const PH = Math.round(PAPER_HEIGHT_IN * 100);
    // 4 points as a 4x1 CV_32FC2 Mat (TL, TR, BR, BL)
    const srcCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered.tl.x, ordered.tl.y,
      ordered.tr.x, ordered.tr.y,
      ordered.br.x, ordered.br.y,
      ordered.bl.x, ordered.bl.y
    ]);
    const dstCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, PW, 0,PW, PH, 0, PH]);
    // getPerspectiveTransform RETURNS the matrix
    const M = cv.getPerspectiveTransform(srcCorners, dstCorners);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(PW, PH));
    
    //-----------------
    print ("8. Convert Mat -> p5.Image"); 
    const outImg = matToP5Image(dst);
    image(outImg, 0, 0, PW, PH);

    //-----------------
    print ("9. Cleanup temporary data"); 
    M.delete(); 
    srcCorners.delete(); 
    dstCorners.delete();
    approx.delete(); 
    contours.delete(); 
    hierarchy.delete();
    
    //-----------------
    print ("10. Find row & column dips"); 
    const L = toLightnessGray(dst);
    const cols = columnSums(L); // Float64Array length W
    const rows = rowSums(L);    // Float64Array length H
    
    const leftDip  = findFirstDipFromEdge(cols, 'left',  { 
      insetPx:IGNORE_PX, 
      depthFrac:DOT_DIM_PCT_COLS,
      gutterLenFrac:GUTTER_PCT, 
      gutterTolFrac:0.01 });
    const rightDip = findFirstDipFromEdge(cols, 'right', { 
      insetPx:IGNORE_PX, 
      depthFrac:DOT_DIM_PCT_COLS, 
      gutterLenFrac:GUTTER_PCT, 
      gutterTolFrac:0.01 });
    const topDip   = findFirstDipFromEdge(rows, 'top',   { 
      insetPx:IGNORE_PX, 
      depthFrac:DOT_DIM_PCT_ROWS, 
      gutterLenFrac:GUTTER_PCT, 
      gutterTolFrac:0.01 });
    const botDip   = findFirstDipFromEdge(rows, 'bottom',{ 
      insetPx:IGNORE_PX, 
      depthFrac:DOT_DIM_PCT_ROWS, 
      gutterLenFrac:GUTTER_PCT, 
      gutterTolFrac:0.01 });
    // Initial circle center guesses:
    const cxL = leftDip.center;
    const cxR = rightDip.center;
    const cyT = topDip.center;
    const cyB = botDip.center;
    // Dip widths -> diameter estimates (clipped to minimums)
    const wL = Math.max(8, leftDip.width);
    const wR = Math.max(8, rightDip.width);
    const hT = Math.max(8, topDip.width);
    const hB = Math.max(8, botDip.width);

    //-----------------
    print ("11. Refine dot centroids"); 
    // Refine each corner using local ROI centroiding:
    const ctl = refineDotCentroid(L, cxL, cyT, wL, hT, 3.5);
    const ctr = refineDotCentroid(L, cxR, cyT, wR, hT, 3.5);
    const cbr = refineDotCentroid(L, cxR, cyB, wR, hB, 3.5);
    const cbl = refineDotCentroid(L, cxL, cyB, wL, hB, 3.5);
    
    noFill();
    stroke('red');
    let bDrawCircleFindDebug = false; 
    if (bDrawCircleFindDebug){
      beginShape(); 
      for (let i=8; i<cols.length-8; i++){
        let y = map(cols[i], 0, PH*255, 0,255); 
        let x = i; 
        vertex(x,y); 
      }
      endShape(); 
      beginShape(); 
      for (let i=8; i<rows.length-8; i++){
        let x = map(rows[i], 0, PW*255, 0,255);  
        let y = i;
        vertex(x,y); 
      }
      endShape(); 
      circle(ctl.x,ctl.y, 20); 
      circle(ctr.x,ctr.y, 20); 
      circle(cbr.x,cbr.y, 20);
      circle(cbl.x,cbl.y, 20); 
    }
    quad(ctl.x,ctl.y, ctr.x,ctr.y, cbr.x,cbr.y, cbl.x,cbl.y);
    
    //-----------------
    print ("12. Rectify quad"); 
    // Euclidean distance
    const D = (p,q) => Math.hypot(p.x - q.x, p.y - q.y);
    // ---- build destination size from averaged edge lengths
    const widthPx  = Math.round((D(ctl, ctr) + D(cbl, cbr)) * 0.5);
    const heightPx = Math.round((D(ctl, cbl) + D(ctr, cbr)) * 0.5);
    const quadSrcCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ctl.x,ctl.y, ctr.x,ctr.y, cbr.x,cbr.y, cbl.x,cbl.y]);
    const quadDstCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,0, widthPx,0, widthPx,heightPx, 0,heightPx]);

    const perspT = cv.getPerspectiveTransform(
      quadSrcCorners, quadDstCorners);
    const rectified = new cv.Mat();
    cv.warpPerspective(dst /* the page Mat */, 
                       rectified, perspT, new cv.Size(widthPx, heightPx),
                       cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    // clean up temps
    quadSrcCorners.delete(); 
    quadDstCorners.delete(); 
    perspT.delete();
    
    //-----------------
    let frameExtractionInfo = null;
    if (bUseCrossesForSubpixelAlignment){
      print("13. Detect and use crosses for subpixel frame alignment");
      frameExtractionInfo = buildCrossAlignmentData(
        rectified, N_FRAME_COLS, N_FRAME_ROWS);
      if (frameExtractionInfo.ok){
        print(
          "   Using " + frameExtractionInfo.detectedCount + "/" +
          frameExtractionInfo.expectedCount + " cross detections");
      } else {
        print(
          "   Cross alignment fallback: " + frameExtractionInfo.reason);
      }
    } else {
      print("13. Cross-based subpixel alignment disabled");
      frameExtractionInfo = buildFallbackFrameExtractionData(
        rectified, N_FRAME_COLS, N_FRAME_ROWS, "disabled");
    }
    
    crossAlignmentDebug = frameExtractionInfo;
    rectifiedSpriteSheet = matToP5Image(rectified);
    
    //-----------------
    print ("14. Slice rectified image into frames"); 
    animationFrames = sliceRectifiedToP5Frames(
      rectified, frameExtractionInfo);
    rectified.delete(); 
    dst.delete(); 
    
    //-----------------
    print ("15. Ready to export GIF; press 's' to save."); 
    

  } catch (e) {
    console.error(e);
  } finally {
    // always free these
    src.delete(); 
    grayImg.delete(); 
    thresh.delete(); 
  }
  
  bProcessedImage = true; 
}


//-------------------------------------------------------------
function keyPressed(){
  if (key == 's'){
    if (bProcessedImage && (animationFrames.length > 0)){
      exportMyAnimatedGIF(); 
    } else {
      print("Error; No frames to export"); 
    }
  } else if (key == 'x'){
    bShowCrossAlignmentDebug = !bShowCrossAlignmentDebug;
  }
}

//-------------------------------------------------------------
function exportMyAnimatedGIF(){
  if (bProcessedImage && (animationFrames.length > 0)){
      let timeStr = nf(month(),2) + nf(day(),2) + nf(hour(),2) + nf(minute(),2); 
      let outputFilename = "animation_" + timeStr + ".gif";
      print ("Exporting GIF: " + outputFilename);
      exportGif(animationFrames, { 
        fps: 20, 
        quality: 10, 
        dither: 'FloydSteinberg', 
        filename: outputFilename });
    }
}


//-------------------------------------------------------------
// Convert an OpenCV Mat -> p5.Image (handles 1/3/4 channel mats)
function matToP5Image(mat) {
  // Ensure RGBA
  let rgba = new cv.Mat();
  switch (mat.type()) {
    case cv.CV_8UC1:  // grayscale
      cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
      break;
    case cv.CV_8UC3:  // BGR
      cv.cvtColor(mat, rgba, cv.COLOR_BGR2RGBA);
      break;
    case cv.CV_8UC4:  // already RGBA
      rgba = mat.clone();
      break;
    default:
      rgba.delete?.();
      throw new Error('matToP5Image: unsupported Mat type: ' + mat.type());
  }

  // Make a p5.Image and copy pixels
  const img = createImage(rgba.cols, rgba.rows);
  img.loadPixels();
  img.pixels.set(new Uint8ClampedArray(rgba.data)); // RGBA byte-for-byte
  img.updatePixels();

  rgba.delete();
  return img;
}


//-------------------------------------------------------------
function orderCorners(pts) {
  // pts: array of 4 {x,y}
  const sum = p => p.x + p.y;
  const diff = p => p.y - p.x;
  const tl = pts.reduce((a,b)=> sum(a) < sum(b) ? a : b);
  const br = pts.reduce((a,b)=> sum(a) > sum(b) ? a : b);
  const tr = pts.reduce((a,b)=> diff(a) < diff(b) ? a : b);
  const bl = pts.reduce((a,b)=> diff(a) > diff(b) ? a : b);
  return { tl, tr, br, bl };
}


// ------------- preprocessing (BT.601 grayscale) -------------
function toLightnessGray(inMat) {
  if (!(inMat instanceof cv.Mat)) throw new Error('toLightnessGray: need cv.Mat');
  const grayMat = new cv.Mat();
  if (inMat.type() === cv.CV_8UC4) {
    cv.cvtColor(inMat, grayMat, cv.COLOR_RGBA2GRAY); // uses ~0.299R+0.587G+0.114B
  } else if (inMat.type() === cv.CV_8UC3) {
    cv.cvtColor(inMat, grayMat, cv.COLOR_BGR2GRAY);  // same weights
  } else {
    throw new Error('toLightnessGray: expected 3- or 4-channel image');
  }

  // mild blur to stabilize column/row sums (optional)
  const k = Math.max(3, (Math.min(grayMat.rows, grayMat.cols) / 400) | 1); // e.g. 3..5
  cv.GaussianBlur(grayMat, grayMat, new cv.Size(k, k), 0, 0, cv.BORDER_REPLICATE);
  return grayMat; // CV_8UC1
}

// ------------- 1D profiles -------------
function columnSums(grayImg) {
  const col = new cv.Mat();
  cv.reduce(grayImg, col, 0, cv.REDUCE_SUM, cv.CV_64F);
  // col is 1×W, CV_64F
  const W = grayImg.cols;
  const data = new Float64Array(col.data64F); // length W
  col.delete();
  return data;
}

function rowSums(grayImg) {
  const row = new cv.Mat();
  cv.reduce(grayImg, row, 1, cv.REDUCE_SUM, cv.CV_64F);
  // row is H×1, CV_64F
  const H = grayImg.rows;
  const data = new Float64Array(row.data64F); // length H
  row.delete();
  return data;
}


// ------------- refine centroid in ROI -------------
function refineDotCentroid(grayMat, cx, cy, w, h, dscale = 2.0) {
  const W = grayMat.cols;
  const H = grayMat.rows;
  const rw = Math.round(w * dscale);
  const rh = Math.round(h * dscale);
  const x0 = Math.max(0, Math.round(cx - rw / 2));
  const y0 = Math.max(0, Math.round(cy - rh / 2));
  const x1 = Math.min(W, x0 + rw);
  const y1 = Math.min(H, y0 + rh);
  const rect = new cv.Rect(x0, y0, x1 - x0, y1 - y0);

  const roi = grayMat.roi(rect);
  // local Otsu on ROI, inverted (dark=255)
  const mask = new cv.Mat();
  cv.threshold(roi, mask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

  // Largest blob in ROI
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  if (contours.size() === 0) { 
    roi.delete(); 
    mask.delete(); 
    contours.delete(); 
    hier.delete(); 
    throw new Error('No blob in ROI'); 
  }

  let best = contours.get(0), bestArea = cv.contourArea(best);
  for (let i = 1; i < contours.size(); i++) {
    const c = contours.get(i);
    const a = cv.contourArea(c);
    if (a > bestArea) { 
      best.delete(); best = c; bestArea = a; 
    } else { 
      c.delete(); 
    }
  }

  const m = cv.moments(best);
  const cxR = m.m10 / m.m00;
  const cyR = m.m01 / m.m00;
  const out = { x: x0 + cxR, y: y0 + cyR };

  // cleanup
  best.delete(); 
  contours.delete(); 
  hier.delete();
  roi.delete(); 
  mask.delete();
  return out;
}


//-------------------------------------------------------------
// Simple 1D moving-average smoother (odd window)
function smooth1D(arr, win=5) {
  win = Math.max(1, win|0); 
  if (win % 2 === 0) win += 1;
  const n = arr.length, out = new Float64Array(n);
  const h = (win-1)/2;
  let acc = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const add = arr[i];
    acc += add; cnt++;
    if (i - win >= 0) { acc -= arr[i - win]; cnt--; }
    out[i] = acc / cnt;
  }
  return out;
}


//-------------------------------------------------------------
// Robust "bright baseline" near the edge: use high percentile of the first band
function edgeBaseline(profile, edge='left', inset=6, bandFrac=0.08) {
  const n = profile.length;
  const band = Math.max(inset+4, Math.min(n, Math.round(n*bandFrac)));
  const vals = [];
  if (edge === 'left' || edge === 'top') {
    for (let i = inset; i < band; i++) vals.push(profile[i]);
  } else {
    for (let i = n - band; i < n - inset; i++) vals.push(profile[i]);
  }
  vals.sort((a,b)=>a-b);
  const p95 = vals[Math.max(0, Math.min(vals.length-1, Math.round(0.95*(vals.length-1))))];
  return p95; // bright paper level near the edge
}


//-------------------------------------------------------------
/**
 * Find the FIRST significant dip from an edge, 
 * then stop once a bright gutter follows it.
 * - profile: Float64Array (column or row 
 *   sums on grayscale/lightness)
 * - edge: 'left'|'right'|'top'|'bottom'  
 *   (left/top = forward scan, right/bottom = backward)
 * - options:
 *    insetPx: skip this many pixels from the edge before scanning
 *    smoothWin: moving average window (odd; 5 or 7 is fine)
 *    depthFrac: dip must go below baseline by at least this fraction (e.g., 0.08 = 8%)
 *    gutterLenFrac: length of post-dip bright gutter as fraction of length (e.g., 0.02)
 *    gutterTolFrac: gutter values must be within this fraction of baseline (e.g., 0.08 = 8%)
 * Returns: { center, width, left, right, baseline, minVal } in original index space
 */
function findFirstDipFromEdge(
  profile,
  edge='left',
  {
    insetPx=8,
    smoothWin=1,
    depthFrac=0.04,
    gutterLenFrac=0.01,
    gutterTolFrac=0.01
  }={}){
  const n = profile.length;
  if (n === 0) throw new Error('empty profile');

  // Smooth for stability
  const s = smooth1D(profile, smoothWin);

  // Bright baseline near the edge
  const baseline = edgeBaseline(s, edge, insetPx, 0.08);

  // Thresholds
  const dipThresh = baseline * (1 - Math.max(0.01, depthFrac)); // must go below this
  const gutterLen = Math.max(3, Math.round(n * gutterLenFrac));
  const gutterThresh = baseline * (1 - Math.max(0.0, gutterTolFrac)); // gutter must be >= this

  // Scanning direction
  const forward = (edge === 'left' || edge === 'top');
  const start = forward ? insetPx : (n - 1 - insetPx);
  const step  = forward ? +1 : -1;
  const stop  = forward ? (n - gutterLen - 1) : (gutterLen);

  // State machine: SEEK_DROP -> IN_DIP -> SEEK_GUTTER
  let state = 'SEEK_DROP';
  let L = -1, R = -1, minIdx = -1, minVal = Infinity;

  for (let i = start; forward ? (i < stop) : (i > stop); i += step) {
    const v = s[i];

    if (state === 'SEEK_DROP') {
      if (v <= dipThresh) {
        state = 'IN_DIP';
        L = i;
        minIdx = i;
        minVal = v;
      }
    } else if (state === 'IN_DIP') {
      // Track min inside dip
      if (v < minVal) { minVal = v; minIdx = i; }
      // Leave dip when we climb back near baseline (halfway back is fine)
      const leaveThresh = (dipThresh + baseline) * 0.5;
      if (v >= leaveThresh) {
        R = i;
        state = 'SEEK_GUTTER';
        // Ensure R > L in forward indexing; if scanning backward, swap later
      }
    } else if (state === 'SEEK_GUTTER') {
      // Verify next "gutterLen" samples stay bright enough (>= gutterThresh)
      let ok = true;
      for (let k = 0; k < gutterLen; k++) {
        const j = i + k*step;
        if (j < 0 || j >= n) { ok = false; break; }
        if (s[j] < gutterThresh) { ok = false; break; }
      }
      if (ok) {
        // We have a dip followed by a bright gutter: accept and compute center/width
        // Normalize indices to left→right order for return
        let left = Math.min(L, R), right = Math.max(L, R);
        const center = Math.round((left + right)/2);
        const width  = right - left + 1;
        return { center, width, left, right, baseline, minVal };
      } else {
        // If gutter check fails, keep scanning; allow multiple small oscillations
        // but if values drop again below dipThresh, extend the dip's right bound.
        if (v <= dipThresh) {
          // Re-enter dip region; extend R
          R = i;
          state = 'IN_DIP';
          if (v < minVal) { minVal = v; minIdx = i; }
        }
      }
    }
  }

  throw new Error('No qualifying dip found from ' + edge + ' edge');
}

//-------------------------------------------------------------
function buildFallbackFrameExtractionData(
  rectifiedMat,
  cols=N_FRAME_COLS,
  rows=N_FRAME_ROWS,
  reason='fallback') {

  const expectedCrosses = getExpectedCrossLattice(rectifiedMat.cols, rectifiedMat.rows, cols, rows);
  return {
    ok: false,
    enabled: bShowCrossAlignmentDebug,
    reason,
    rectifiedWidth: rectifiedMat.cols,
    rectifiedHeight: rectifiedMat.rows,
    cols,
    rows,
    expectedCount: expectedCrosses.length,
    detectedCount: 0,
    expectedCrosses,
    detectedCrosses: [],
    rejectedCrosses: [],
    frameOffsets: buildZeroFrameOffsets(cols, rows),
  };
}

//-------------------------------------------------------------
function buildCrossAlignmentData(
  rectifiedMat,
  cols=N_FRAME_COLS,
  rows=N_FRAME_ROWS) {

  const expectedCrosses = getExpectedCrossLattice(rectifiedMat.cols, rectifiedMat.rows, cols, rows);
  if (expectedCrosses.length === 0) {
    return buildFallbackFrameExtractionData(rectifiedMat, cols, rows, "no crosses expected");
  }
  const grayMat = toLightnessGray(rectifiedMat);
  const detectedCrosses = [];
  const rejectedCrosses = [];

  try {
    for (const expected of expectedCrosses) {
      const detection = detectCrossAtExpectedPosition(
        grayMat, expected, rectifiedMat.cols, rectifiedMat.rows, cols, rows);
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
    Math.ceil(expectedCrosses.length * MIN_CROSS_DETECTION_RATIO));
  const ok = detectedCrosses.length >= minRequired;
  const reason = ok
    ? 'ok'
    : 'too few confident detections (' + detectedCrosses.length + '/' + expectedCrosses.length + ')';

  return {
    ok,
    enabled: bShowCrossAlignmentDebug,
    reason,
    rectifiedWidth: rectifiedMat.cols,
    rectifiedHeight: rectifiedMat.rows,
    cols,
    rows,
    expectedCount: expectedCrosses.length,
    detectedCount: detectedCrosses.length,
    expectedCrosses,
    detectedCrosses,
    rejectedCrosses,
    frameOffsets: ok
      ? computeFrameOffsetsFromCrosses(detectedCrosses, rectifiedMat.cols, rectifiedMat.rows, cols, rows)
      : buildZeroFrameOffsets(cols, rows),
  };
}

//-------------------------------------------------------------
function getExpectedCrossLattice(sheetW, sheetH, cols, rows) {
  const pts = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const isCorner =
        ((c === 0) || (c === cols)) &&
        ((r === 0) || (r === rows));
      if (isCorner) continue;

      pts.push({
        col: c,
        row: r,
        x: sheetW * (c / cols),
        y: sheetH * (r / rows),
      });
    }
  }
  return pts;
}

//-------------------------------------------------------------
function detectCrossAtExpectedPosition(grayMat, expected, sheetW, sheetH, cols, rows) {
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  const rx = Math.max(10, Math.round(cellW * 0.18));
  const ry = Math.max(10, Math.round(cellH * 0.18));
  const x0 = Math.max(0, Math.round(expected.x - rx));
  const y0 = Math.max(0, Math.round(expected.y - ry));
  const x1 = Math.min(grayMat.cols, Math.round(expected.x + rx));
  const y1 = Math.min(grayMat.rows, Math.round(expected.y + ry));
  const roiW = Math.max(1, x1 - x0);
  const roiH = Math.max(1, y1 - y0);
  const roi = grayMat.roi(new cv.Rect(x0, y0, roiW, roiH));
  const mask = new cv.Mat();

  try {
    cv.threshold(roi, mask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
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
        const v = data[rowOffset + x] / 255.0;
        if ((y >= bandY0) && (y < bandY1)) {
          colProfile[x] += v;
        }
        if ((x >= bandX0) && (x < bandX1)) {
          rowProfile[y] += v;
        }
      }
    }

    const smoothCols = smooth1D(colProfile, 5);
    const smoothRows = smooth1D(rowProfile, 5);
    const peakX = getWeightedPeakIndex(smoothCols);
    const peakY = getWeightedPeakIndex(smoothRows);
    const detectedX = x0 + peakX.position;
    const detectedY = y0 + peakY.position;
    const dx = detectedX - expected.x;
    const dy = detectedY - expected.y;
    const colMean = averageArrayValue(smoothCols);
    const rowMean = averageArrayValue(smoothRows);
    const colContrast = peakX.value / Math.max(1e-6, colMean);
    const rowContrast = peakY.value / Math.max(1e-6, rowMean);
    const darkFrac = countNonZeroMask(mask) / (roiW * roiH);
    const displacementLimit = Math.max(2.0, Math.min(cellW, cellH) * 0.08);
    const displacement = Math.hypot(dx, dy);
    const accepted =
      displacement <= displacementLimit &&
      colContrast >= 1.6 &&
      rowContrast >= 1.6 &&
      darkFrac >= 0.002 &&
      darkFrac <= 0.25;

    return {
      ...expected,
      detectedX,
      detectedY,
      dx,
      dy,
      confidence: colContrast * rowContrast,
      darkFrac,
      accepted,
    };
  } finally {
    roi.delete();
    mask.delete();
  }
}

//-------------------------------------------------------------
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
  const lo = Math.max(0, maxIdx - 2);
  const hi = Math.min(arr.length - 1, maxIdx + 2);
  for (let i = lo; i <= hi; i++) {
    const w = Math.max(0, arr[i]);
    acc += i * w;
    wsum += w;
  }

  return {
    position: (wsum > 0) ? (acc / wsum) : maxIdx,
    value: Math.max(0, maxVal),
  };
}

//-------------------------------------------------------------
function averageArrayValue(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return (arr.length > 0) ? (sum / arr.length) : 0;
}

//-------------------------------------------------------------
function countNonZeroMask(maskMat) {
  let count = 0;
  const data = maskMat.data;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) count++;
  }
  return count;
}

//-------------------------------------------------------------
function buildZeroFrameOffsets(cols, rows) {
  const offsets = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      offsets.push({ col: c, row: r, dx: 0, dy: 0, usedCount: 0 });
    }
  }
  return offsets;
}

//-------------------------------------------------------------
function computeFrameOffsetsFromCrosses(detectedCrosses, sheetW, sheetH, cols, rows) {
  const frameOffsets = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centerX = sheetW * ((c + 0.5) / cols);
      const centerY = sheetH * ((r + 0.5) / rows);
      let sumW = 0;
      let sumDx = 0;
      let sumDy = 0;
      let usedCount = 0;

      for (const cross of detectedCrosses) {
        const dist = Math.hypot(cross.x - centerX, cross.y - centerY);
        const inv = 1.0 / Math.max(1.0, dist);
        const w = inv * inv * Math.max(1.0, cross.confidence);
        sumW += w;
        sumDx += cross.dx * w;
        sumDy += cross.dy * w;
        usedCount++;
      }

      frameOffsets.push({
        col: c,
        row: r,
        dx: (sumW > 0) ? (sumDx / sumW) : 0,
        dy: (sumW > 0) ? (sumDy / sumW) : 0,
        usedCount,
      });
    }
  }
  return frameOffsets;
}

//-------------------------------------------------------------
function sliceRectifiedToP5Frames(
 rectifiedMat,
 extractionInfo=null) {
   
  const frames = [];
  const W = rectifiedMat.cols;
  const H = rectifiedMat.rows;
  const cols = extractionInfo?.cols ?? N_FRAME_COLS;
  const rows = extractionInfo?.rows ?? N_FRAME_ROWS;
  const frameOffsets = extractionInfo?.frameOffsets ?? buildZeroFrameOffsets(cols, rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = W * (c / cols);
      const x1 = W * ((c + 1) / cols);
      const y0 = H * (r / rows);
      const y1 = H * ((r + 1) / rows);
      const nominalW = Math.max(1, x1 - x0 - CROP_PX * 2);
      const nominalH = Math.max(1, y1 - y0 - CROP_PX * 2);
      const outW = Math.max(1, Math.round(nominalW));
      const outH = Math.max(1, Math.round(nominalH));
      const offset = frameOffsets[r * cols + c] || { dx: 0, dy: 0 };
      const centerX = x0 + (x1 - x0) * 0.5 + offset.dx;
      const centerY = y0 + (y1 - y0) * 0.5 + offset.dy;
      const patch = new cv.Mat();
      const tx = (outW * 0.5) - centerX;
      const ty = (outH * 0.5) - centerY;
      const affine = cv.matFromArray(2, 3, cv.CV_64F, [
        1, 0, tx,
        0, 1, ty
      ]);
      cv.warpAffine(
        rectifiedMat,
        patch,
        affine,
        new cv.Size(outW, outH),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );
      const frameImg = matToP5Image(patch);
      frames.push(frameImg);
      affine.delete();
      patch.delete();
    }
  }
  return frames; // Array<p5.Image> length = cols*rows
}

//-------------------------------------------------------------
function drawCrossAlignmentDebugOverlay(info) {
  if (!info) return;

  strokeWeight(1);
  noFill();

  stroke(0, 160, 255, 120);
  for (const cross of info.expectedCrosses) {
    line(cross.x - 5, cross.y, cross.x + 5, cross.y);
    line(cross.x, cross.y - 5, cross.x, cross.y + 5);
  }

  stroke(255, 80, 0, 180);
  for (const cross of info.detectedCrosses) {
    line(cross.x, cross.y, cross.detectedX, cross.detectedY);
  }

  noStroke();
  fill(0, 200, 100, 180);
  for (const cross of info.detectedCrosses) {
    circle(cross.detectedX, cross.detectedY, 6);
  }

  fill(255, 0, 80, 180);
  for (const cross of info.rejectedCrosses) {
    circle(cross.detectedX, cross.detectedY, 5);
  }

  stroke(120, 0, 255, 150);
  noFill();
  const cols = info.cols;
  const rows = info.rows;
  for (const offset of info.frameOffsets) {
    const centerX = info.rectifiedWidth * ((offset.col + 0.5) / cols);
    const centerY = info.rectifiedHeight * ((offset.row + 0.5) / rows);
    line(centerX, centerY, centerX + offset.dx * 10, centerY + offset.dy * 10);
  }
}

//-------------------------------------------------------------
// Minimal, reliable GIF export for an array of p5.Image frames
function exportGif(frames, {
  fps = 20,
  quality = 10,
  workers = 2,
  dither = 'FloydSteinberg',
  filename = 'animation.gif'
} = {}) {
  if (!frames || !frames.length) {
    console.error('exportGif: no frames');
    return;
  }

  // --- find smallest common size (crop, not scale) ---
  let minW = Infinity, minH = Infinity;
  for (const f of frames) {
    if (f.width  < minW) minW = f.width;
    if (f.height < minH) minH = f.height;
  }
  const W = minW;
  const H = minH;

  const pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.noSmooth();

  const gif = new GIF({
    workers,
    quality,
    dither,
    workerScript: 'gif.worker.js',
    width: W,
    height: H,
    repeat: 0 // loop forever
  });

  const delay = Math.max(1, Math.round(1000 / fps)); // ms per frame

  // --- crop every frame to (0,0,W,H) and add ---
  for (let i = 0; i < frames.length; i++) {
    pg.clear();
    pg.image(frames[i], 0, 0); //, W, H, 0, 0, W, H); // draw top-left W×H region
    gif.addFrame(pg.canvas, { copy: true, delay });
  }

  let bPrintVerboseExportProgress = false;
  if (bPrintVerboseExportProgress){
    gif.on('progress', p => console.log(`GIF progress: ${(p*100).toFixed(1)}%`));
  }
  
  gif.on('finished', blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pg.remove();
    console.log('GIF saved:', filename);
  });

  gif.render();
}
