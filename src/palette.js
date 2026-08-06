/* Dominant colour from the actual garment pixels.
   No model involved — this is just arithmetic, and it beats asking a language
   model to eyeball a hex code, because it reads the real pixels. */

/** Median-cut quantisation over masked pixels. Returns the dominant hex. */
export function dominantColour(imageData, mask, width, height) {
  const px = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 6000))); // sample ~6k px
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (mask && mask[i] < 128) continue;
      const o = i * 4;
      const a = imageData[o + 3];
      if (a < 200) continue;
      const r = imageData[o], g = imageData[o + 1], b = imageData[o + 2];
      // Skin tones and near-white blowouts drag the average around; skip the
      // most obvious ones so a beige shirt doesn't read as "arm".
      if (r > 250 && g > 250 && b > 250) continue;
      px.push([r, g, b]);
    }
  }
  if (px.length < 12) return "#8C8A85";

  const box = medianCut(px, 4); // 16 buckets
  box.sort((a, b) => b.length - a.length);

  // Prefer the biggest bucket, unless it is nearly colourless and a smaller
  // but clearly chromatic bucket is almost as large — that's usually the print.
  let chosen = box[0];
  const satOf = (bk) => {
    const [r, g, b] = mean(bk);
    return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  };
  for (let i = 1; i < Math.min(4, box.length); i++) {
    if (box[i].length > chosen.length * 0.6 && satOf(box[i]) > satOf(chosen) + 0.22) {
      chosen = box[i];
    }
  }
  return rgb2hex(mean(chosen));
}

function medianCut(pixels, depth) {
  if (depth === 0 || pixels.length < 4) return [pixels];
  let widest = 0, range = -1;
  for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0;
    for (const p of pixels) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
    if (hi - lo > range) { range = hi - lo; widest = c; }
  }
  pixels.sort((a, b) => a[widest] - b[widest]);
  const mid = pixels.length >> 1;
  return [
    ...medianCut(pixels.slice(0, mid), depth - 1),
    ...medianCut(pixels.slice(mid), depth - 1),
  ];
}

function mean(px) {
  const s = px.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return s.map((v) => Math.round(v / px.length));
}
const rgb2hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

/* ---- naming ---- */
const NAMED = [
  ["black", "#111111"], ["charcoal", "#36363A"], ["grey", "#8A8A8E"],
  ["silver", "#C9C9CD"], ["white", "#F6F5F2"], ["ecru", "#E8E1D2"],
  ["cream", "#F2E9D8"], ["beige", "#D9C9AE"], ["camel", "#C19A6B"],
  ["tan", "#A97B4F"], ["brown", "#6A4A32"], ["chocolate", "#4A3227"],
  ["rust", "#9E4B2C"], ["terracotta", "#C4643F"], ["orange", "#E1721C"],
  ["mustard", "#D4A017"], ["yellow", "#EFCB37"], ["lime", "#B7D145"],
  ["olive", "#6B7150"], ["sage", "#A3B08D"], ["green", "#3E7A46"],
  ["emerald", "#1F7A55"], ["teal", "#1F6F72"], ["aqua", "#61C0BF"],
  ["sky", "#8FBEDD"], ["denim", "#4A6488"], ["indigo", "#37455F"],
  ["navy", "#22304C"], ["cobalt", "#2A44C8"], ["blue", "#3C62B8"],
  ["lavender", "#B6AEDA"], ["purple", "#6B4C8F"], ["plum", "#6A3350"],
  ["magenta", "#B4327C"], ["pink", "#E39BB4"], ["blush", "#EAC7C4"],
  ["coral", "#E97A6A"], ["red", "#C0392B"], ["burgundy", "#6E2233"],
  ["maroon", "#5A2430"],
];

export function colourName(hex) {
  const [r, g, b] = hex2rgb(hex);
  let best = "grey", d = Infinity;
  for (const [name, ref] of NAMED) {
    const [R, G, B] = hex2rgb(ref);
    // Weighted RGB — approximates how the eye actually judges closeness.
    const rm = (r + R) / 2;
    const dist =
      (2 + rm / 256) * (r - R) ** 2 +
      4 * (g - G) ** 2 +
      (2 + (255 - rm) / 256) * (b - B) ** 2;
    if (dist < d) { d = dist; best = name; }
  }
  return best;
}

export function hex2rgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || "#888888");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [136, 136, 136];
}

/* ---- pattern, from image statistics rather than a model ---- */
export function readPattern(imageData, mask, width, height) {
  let n = 0, sumL = 0, sumL2 = 0, edges = 0, hues = [];
  const at = (x, y) => (y * width + x) * 4;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x;
      if (mask && mask[i] < 128) continue;
      const o = at(x, y);
      if (imageData[o + 3] < 200) continue;
      const L = imageData[o] * 0.299 + imageData[o + 1] * 0.587 + imageData[o + 2] * 0.114;
      sumL += L; sumL2 += L * L; n++;
      const mx = Math.max(imageData[o], imageData[o + 1], imageData[o + 2]);
      const mn = Math.min(imageData[o], imageData[o + 1], imageData[o + 2]);
      if (mx - mn > 30) hues.push(hueOf(imageData[o], imageData[o + 1], imageData[o + 2]));
      const rx = at(x + 1, y), ry = at(x, y + 1);
      const Lx = imageData[rx] * 0.299 + imageData[rx + 1] * 0.587 + imageData[rx + 2] * 0.114;
      const Ly = imageData[ry] * 0.299 + imageData[ry + 1] * 0.587 + imageData[ry + 2] * 0.114;
      if (Math.abs(L - Lx) + Math.abs(L - Ly) > 46) edges++;
    }
  }
  if (n < 40) return "solid";
  const sd = Math.sqrt(Math.max(0, sumL2 / n - (sumL / n) ** 2));
  const edgeRate = edges / n;
  const hueSpread = spread(hues);

  if (hueSpread > 70 && edgeRate > 0.10) return "printed";
  if (edgeRate > 0.16) return "checked";
  if (edgeRate > 0.09) return "striped";
  if (sd > 26) return "textured";
  return "solid";
}

function hueOf(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}
function spread(hues) {
  if (hues.length < 20) return 0;
  // circular standard deviation, in degrees
  let sx = 0, sy = 0;
  for (const h of hues) { sx += Math.cos((h * Math.PI) / 180); sy += Math.sin((h * Math.PI) / 180); }
  const R = Math.sqrt(sx * sx + sy * sy) / hues.length;
  return Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-6, R)))) * (180 / Math.PI);
}
