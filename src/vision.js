/* On-device wardrobe cataloguing. No API key, no server, no per-photo cost.
   Two models run in the browser via ONNX:

     1. SegFormer trained on clothing parsing — gives a pixel mask per garment,
        so pieces come out as true cut-outs rather than rectangular crops.
     2. CLIP — zero-shot classification, used only to pick a sub-type inside a
        category the segmenter has already decided.

   Everything else (colour, pattern, dress code, season) is derived from the
   pixels or from a lookup table, because a model is the wrong tool for those.

   Models download once, roughly 80MB, then live in the browser cache. */

import { pipeline, env } from "@huggingface/transformers";
import { dominantColour, colourName, readPattern } from "./palette.js";

// Models are fetched from the Hugging Face CDN. To self-host, drop the ONNX
// files on your own domain and set env.remoteHost to it.
env.allowLocalModels = false;

const SEG_MODEL = "Xenova/segformer_b2_clothes";
const CLIP_MODEL = "Xenova/clip-vit-base-patch32";

/* SegFormer clothing-parsing labels mapped onto the app's categories.
   Anything not listed here (skin, hair, background) is discarded. */
const LABEL_MAP = {
  "Upper-clothes": { category: "Topwear", fallback: "T-shirt" },
  Skirt: { category: "Bottomwear", fallback: "Skirt" },
  Pants: { category: "Bottomwear", fallback: "Trousers" },
  Dress: { category: "One-piece", fallback: "Dress" },
  Belt: { category: "Accessories", fallback: "Belt" },
  "Left-shoe": { category: "Footwear", fallback: "Sneakers", pair: "shoes" },
  "Right-shoe": { category: "Footwear", fallback: "Sneakers", pair: "shoes" },
  Bag: { category: "Bags", fallback: "Shoulder" },
  Scarf: { category: "Accessories", fallback: "Scarf" },
  Hat: { category: "Accessories", fallback: "Hat" },
  Sunglasses: { category: "Accessories", fallback: "Sunglasses" },
};

/* Sub-types CLIP chooses between, per category. Small lists keep it fast. */
const SUBTYPES = {
  Topwear: ["t-shirt", "shirt", "blouse", "sweater", "hoodie", "crop top", "tank top", "kurta", "blazer"],
  Bottomwear: ["jeans", "trousers", "shorts", "skirt", "leggings", "cargo trousers"],
  "One-piece": ["dress", "jumpsuit", "gown", "romper"],
  Outerwear: ["jacket", "coat", "blazer", "cardigan"],
  Footwear: ["sneakers", "heels", "flats", "boots", "sandals", "loafers"],
  Bags: ["tote bag", "shoulder bag", "crossbody bag", "clutch", "backpack"],
  Accessories: ["belt", "scarf", "sunglasses", "hat"],
};

/* Dress code and warmth are properties of the garment type, not of the photo.
   A lookup beats a guess. 0 lounge, 1 casual, 2 smart casual, 3 formal, 4 occasion. */
const TRAITS = {
  "t-shirt": [1, ["spring", "summer", "autumn"]],
  shirt: [2, ["spring", "summer", "autumn", "winter"]],
  blouse: [2, ["spring", "summer", "autumn"]],
  sweater: [2, ["autumn", "winter"]],
  hoodie: [0, ["autumn", "winter"]],
  "crop top": [1, ["spring", "summer"]],
  "tank top": [1, ["summer"]],
  kurta: [2, ["spring", "summer", "autumn"]],
  blazer: [3, ["autumn", "winter", "spring"]],
  jeans: [1, ["spring", "autumn", "winter"]],
  trousers: [2, ["spring", "autumn", "winter"]],
  shorts: [1, ["summer"]],
  skirt: [2, ["spring", "summer"]],
  leggings: [0, ["autumn", "winter"]],
  "cargo trousers": [1, ["spring", "autumn"]],
  dress: [2, ["spring", "summer"]],
  jumpsuit: [2, ["spring", "summer", "autumn"]],
  gown: [4, ["autumn", "winter"]],
  romper: [1, ["summer"]],
  jacket: [2, ["autumn", "winter", "spring"]],
  coat: [2, ["winter"]],
  cardigan: [1, ["autumn", "winter"]],
  sneakers: [1, ["spring", "summer", "autumn"]],
  heels: [3, ["spring", "summer", "autumn", "winter"]],
  flats: [2, ["spring", "summer"]],
  boots: [2, ["autumn", "winter"]],
  sandals: [1, ["summer"]],
  loafers: [2, ["spring", "autumn"]],
  "tote bag": [1, ["spring", "summer", "autumn", "winter"]],
  "shoulder bag": [2, ["spring", "summer", "autumn", "winter"]],
  "crossbody bag": [1, ["spring", "summer", "autumn", "winter"]],
  clutch: [4, ["spring", "summer", "autumn", "winter"]],
  backpack: [1, ["spring", "summer", "autumn", "winter"]],
  belt: [2, ["spring", "summer", "autumn", "winter"]],
  scarf: [1, ["autumn", "winter"]],
  sunglasses: [1, ["spring", "summer"]],
  hat: [1, ["spring", "summer"]],
};

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- model loading ---------------- */
let segP = null, clipP = null;

async function build(task, model, onProgress) {
  // WebGPU is several times faster where it exists (Chrome, Safari 18+).
  // Everywhere else, fall back to WebAssembly, which is slower but universal.
  try {
    return await pipeline(task, model, { device: "webgpu", progress_callback: onProgress });
  } catch {
    return await pipeline(task, model, { progress_callback: onProgress });
  }
}

/** Warm the models up. Safe to call repeatedly; only downloads once. */
export function loadModels(onProgress = () => {}) {
  const report = (p) => {
    if (p.status === "progress" && p.total) {
      onProgress({ file: p.file, pct: Math.round((p.loaded / p.total) * 100) });
    } else if (p.status === "ready") {
      onProgress({ file: p.file, pct: 100 });
    }
  };
  if (!segP) segP = build("image-segmentation", SEG_MODEL, report);
  if (!clipP) clipP = build("zero-shot-image-classification", CLIP_MODEL, report);
  return Promise.all([segP, clipP]);
}

export function modelsReady() {
  return segP !== null && clipP !== null;
}

/* ---------------- helpers ---------------- */
function maskToBox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] < 128) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, count, area: count / (w * h) };
}

/** Cut the garment out of the photo using its mask. Returns a transparent PNG. */
function cutOut(img, mask, w, h, box, maxSide = 460) {
  const pad = 6;
  const x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad);
  const bw = Math.min(w - x0, box.x1 - box.x0 + pad * 2);
  const bh = Math.min(h - y0, box.y1 - box.y0 + pad * 2);

  const full = document.createElement("canvas");
  full.width = w; full.height = h;
  const fx = full.getContext("2d", { willReadFrequently: true });
  fx.drawImage(img, 0, 0, w, h);
  const data = fx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] < 128) d[i * 4 + 3] = 0;
  }
  fx.putImageData(data, 0, 0);

  const scale = Math.min(1, maxSide / Math.max(bw, bh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(bw * scale));
  out.height = Math.max(1, Math.round(bh * scale));
  const ox = out.getContext("2d");
  ox.drawImage(full, x0, y0, bw, bh, 0, 0, out.width, out.height);
  return { url: out.toDataURL("image/png"), pixels: data, box };
}

function unionMask(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(a[i], b[i]);
  return out;
}

/* ---------------- the pipeline ---------------- */
/**
 * @param {string} dataUrl  the photo
 * @param {(s:{stage:string,pct?:number})=>void} onStage
 * @returns {Promise<Array>} draft garment records
 */
export async function analyseLocal(dataUrl, onStage = () => {}) {
  onStage({ stage: "Waking the models" });
  const [segmenter, clip] = await loadModels((p) =>
    onStage({ stage: "Downloading the models, once only", pct: p.pct })
  );

  onStage({ stage: "Separating the pieces" });
  const raw = await segmenter(dataUrl);

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Could not open that image."));
    i.src = dataUrl;
  });
  const w = img.naturalWidth, h = img.naturalHeight;

  // Group the raw label masks into garments, merging the shoe pair.
  const groups = new Map();
  for (const seg of raw) {
    const map = LABEL_MAP[seg.label];
    if (!map) continue;
    const key = map.pair || seg.label;
    const mask = seg.mask.data;
    if (groups.has(key)) {
      groups.set(key, { ...groups.get(key), mask: unionMask(groups.get(key).mask, mask) });
    } else {
      groups.set(key, { map, mask, mw: seg.mask.width, mh: seg.mask.height });
    }
  }

  const drafts = [];
  let done = 0;
  for (const [, g] of groups) {
    const mw = g.mw || w, mh = g.mh || h;
    const box = maskToBox(g.mask, mw, mh);
    // Ignore slivers — usually a strap edge or a segmentation wobble.
    if (!box || box.area < 0.012) continue;

    onStage({ stage: `Reading piece ${++done}` });

    const scaled = mw === w && mh === h ? g.mask : rescaleMask(g.mask, mw, mh, w, h);
    const cut = cutOut(img, scaled, w, h, maskToBox(scaled, w, h) || box);

    const hex = dominantColour(cut.pixels.data, scaled, w, h);
    const pattern = readPattern(cut.pixels.data, scaled, w, h);

    // Ask CLIP only what it is good at: which sub-type, within a known category.
    let sub = g.map.fallback;
    const options = SUBTYPES[g.map.category];
    if (options && options.length > 1) {
      try {
        const guess = await clip(cut.url, options.map((o) => `a photo of ${o}`));
        const top = guess[0]?.label?.replace("a photo of ", "");
        if (top) sub = top;
      } catch { /* keep the fallback */ }
    }

    const [formality, seasons] = TRAITS[sub] || [1, ["spring", "summer", "autumn", "winter"]];
    const cname = colourName(hex);

    drafts.push({
      category: g.map.category,
      sub: titleCase(sub),
      name: `${titleCase(cname)} ${sub}`,
      hex,
      colourName: cname,
      pattern,
      material: "",
      formality,
      seasons,
      crop: cut.url,
      box: [
        (cut.box.x0 / w) * 100,
        (cut.box.y0 / h) * 100,
        ((cut.box.x1 - cut.box.x0) / w) * 100,
        ((cut.box.y1 - cut.box.y0) / h) * 100,
      ],
    });
  }

  return drafts;
}

function rescaleMask(mask, mw, mh, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mh - 1, Math.floor((y * mh) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mw - 1, Math.floor((x * mw) / w));
      out[y * w + x] = mask[sy * mw + sx];
    }
  }
  return out;
}
