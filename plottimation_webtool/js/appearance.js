/**
 * Report whether any appearance controls require a non-identity color pass.
 *
 * @param {{brightness:number, contrast:number, vibrance:number, invert:boolean}} filters
 * @returns {boolean}
 */
export function hasAppearanceAdjustments(filters) {
  return filters.brightness !== 0 || filters.contrast !== 0 || filters.vibrance !== 0 || filters.invert;
}

/**
 * Copy a source canvas into a target canvas and optionally apply perceptual
 * appearance adjustments in-place.
 *
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {HTMLCanvasElement} targetCanvas
 * @param {{brightness:number, contrast:number, vibrance:number, invert:boolean}} filters
 * @returns {void}
 */
export function applyVisualAdjustments(sourceCanvas, targetCanvas, filters) {
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  const ctx = targetCanvas.getContext("2d");
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);
  if (!hasAppearanceAdjustments(filters)) {
    return;
  }
  applyOklabAppearanceAdjustments(targetCanvas, filters);
}

/**
 * Map the UI vibrance slider into an internal chroma-scaling amount.
 *
 * @param {number} vibranceValue
 * @returns {number}
 */
function mapVibranceSliderToAmount(vibranceValue) {
  const normalized = Math.max(-1, Math.min(1, vibranceValue / 100));
  return normalized * 1.6;
}

/**
 * Apply the full appearance stack in a single OKLab pass:
 * brightness on L, contrast on L, vibrance on chroma, then optional RGB inversion.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{brightness:number, contrast:number, vibrance:number, invert:boolean}} filters
 * @returns {void}
 */
function applyOklabAppearanceAdjustments(canvas, filters) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const deltaL = mapBrightnessSliderToDeltaL(filters.brightness);
  const contrastK = mapContrastSliderToCurveStrength(filters.contrast);
  const vibranceAmount = mapVibranceSliderToAmount(filters.vibrance);

  for (let i = 0; i < data.length; i += 4) {
    const oklab = srgbToOklab(
      data[i] / 255,
      data[i + 1] / 255,
      data[i + 2] / 255
    );
    let lightness = Math.max(0, Math.min(1, oklab.L + deltaL));
    lightness = applyMidpointSCurve(lightness, contrastK);

    const chroma = Math.hypot(oklab.a, oklab.b);
    const adaptive = 1 - Math.max(0, Math.min(1, chroma / 0.32));
    const chromaScale = Math.max(0, 1 + (vibranceAmount * adaptive));
    const adjusted = oklabToSrgb(lightness, oklab.a * chromaScale, oklab.b * chromaScale);

    let r = Math.round(adjusted[0] * 255);
    let g = Math.round(adjusted[1] * 255);
    let b = Math.round(adjusted[2] * 255);
    if (filters.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Map the brightness slider into an OKLab lightness delta.
 *
 * @param {number} brightnessValue
 * @returns {number}
 */
function mapBrightnessSliderToDeltaL(brightnessValue) {
  const normalized = Math.max(-1, Math.min(1, brightnessValue / 100));
  return normalized * 0.28;
}

/**
 * Map the contrast slider into the S-curve strength parameter.
 *
 * @param {number} contrastValue
 * @returns {number}
 */
function mapContrastSliderToCurveStrength(contrastValue) {
  const normalized = Math.max(-1, Math.min(1, contrastValue / 100));
  return normalized * 5.5;
}

/**
 * Apply a midpoint-preserving S-curve to a normalized lightness value.
 *
 * @param {number} value
 * @param {number} k
 * @returns {number}
 */
function applyMidpointSCurve(value, k) {
  if (Math.abs(k) < 1e-6) {
    return value;
  }
  const strength = Math.abs(k);
  const centered = value - 0.5;
  const tanhHalf = Math.tanh(0.5 * strength);
  if (Math.abs(tanhHalf) < 1e-6) {
    return value;
  }

  let curved;
  if (k > 0) {
    curved = 0.5 + (Math.tanh(centered * strength) / (2 * tanhHalf));
  } else {
    const scaled = Math.max(-0.999999, Math.min(0.999999, (2 * centered) * tanhHalf));
    curved = 0.5 + (Math.atanh(scaled) / strength);
  }

  return Math.max(0, Math.min(1, curved));
}

/**
 * Convert an sRGB triple in 0..1 into OKLab.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{L:number, a:number, b:number}}
 */
function srgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt((0.4122214708 * lr) + (0.5363325363 * lg) + (0.0514459929 * lb));
  const m = Math.cbrt((0.2119034982 * lr) + (0.6806995451 * lg) + (0.1073969566 * lb));
  const s = Math.cbrt((0.0883024619 * lr) + (0.2817188376 * lg) + (0.6299787005 * lb));

  return {
    L: (0.2104542553 * l) + (0.7936177850 * m) - (0.0040720468 * s),
    a: (1.9779984951 * l) - (2.4285922050 * m) + (0.4505937099 * s),
    b: (0.0259040371 * l) + (0.7827717662 * m) - (0.8086757660 * s),
  };
}

/**
 * Convert OKLab back into an sRGB triple in 0..1.
 *
 * @param {number} L
 * @param {number} a
 * @param {number} b
 * @returns {[number, number, number]}
 */
function oklabToSrgb(L, a, b) {
  const l = Math.pow(L + (0.3963377774 * a) + (0.2158037573 * b), 3);
  const m = Math.pow(L - (0.1055613458 * a) - (0.0638541728 * b), 3);
  const s = Math.pow(L - (0.0894841775 * a) - (1.2914855480 * b), 3);

  const r = linearToSrgb((4.0767416621 * l) - (3.3077115913 * m) + (0.2309699292 * s));
  const g = linearToSrgb((-1.2684380046 * l) + (2.6097574011 * m) - (0.3413193965 * s));
  const blue = linearToSrgb((-0.0041960863 * l) - (0.7034186147 * m) + (1.7076147010 * s));

  return [
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, blue)),
  ];
}

/**
 * Convert one gamma-encoded sRGB channel into linear light.
 *
 * @param {number} value
 * @returns {number}
 */
function srgbToLinear(value) {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * Convert one linear-light channel into gamma-encoded sRGB.
 *
 * @param {number} value
 * @returns {number}
 */
function linearToSrgb(value) {
  const clamped = Math.max(0, value);
  if (clamped <= 0.0031308) {
    return 12.92 * clamped;
  }
  return (1.055 * Math.pow(clamped, 1 / 2.4)) - 0.055;
}
