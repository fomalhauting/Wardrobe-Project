import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Camera, Upload, X, Check, Trash2, Shuffle, Heart, Loader2, ChevronLeft,
  Lock, Unlock, Sparkles, Plus, Copy, AlertTriangle, Layers, Grid3x3,
  Bookmark, Wand2, Download
} from "lucide-react";
import { kvGet, kvSet, kvDel, makePersistent } from "./storage.js";
import { analyseLocal, loadModels, modelsReady } from "./vision.js";
import { stylistNote } from "./stylist.js";

/* ============================================================
   ARCHIVE — a wardrobe catalogued like a collection
   Palette: paper grey ground, true ink, archival cobalt.
   Type: Bodoni Moda (display) / Archivo (UI) / Space Mono (data)
   ============================================================ */

const C = {
  ground: "#EDECEA",
  surface: "#FFFFFF",
  ink: "#141414",
  ink2: "#3C3B38",
  muted: "#8C8A85",
  faint: "#B6B3AD",
  line: "#DDDBD6",
  lineSoft: "#EBE9E5",
  accent: "#1E2AC7",
  accentSoft: "#E8E9FB",
  warn: "#9A5B14",
};

const FD = "'Bodoni Moda', Georgia, serif";
const FB = "'Archivo', system-ui, sans-serif";
const FM = "'Space Mono', ui-monospace, monospace";

const CATEGORIES = {
  Topwear: ["T-shirt", "Shirt", "Blouse", "Sweater", "Hoodie", "Crop top", "Tank", "Kurta", "Vest"],
  Bottomwear: ["Jeans", "Trousers", "Shorts", "Skirt", "Leggings", "Cargos", "Palazzo"],
  "One-piece": ["Dress", "Jumpsuit", "Romper", "Gown", "Co-ord set", "Overall"],
  Outerwear: ["Jacket", "Coat", "Blazer", "Cardigan", "Shrug", "Overshirt", "Puffer"],
  Footwear: ["Sneakers", "Heels", "Flats", "Boots", "Sandals", "Loafers", "Juttis"],
  Bags: ["Tote", "Shoulder", "Crossbody", "Clutch", "Backpack", "Duffel"],
  Accessories: ["Belt", "Scarf", "Sunglasses", "Watch", "Hat", "Hair", "Gloves"],
  Jewellery: ["Earrings", "Necklace", "Rings", "Bracelet", "Anklet", "Brooch"],
  Ethnic: ["Kurta set", "Lehenga", "Saree", "Sherwani", "Dupatta", "Anarkali"],
  Activewear: ["Sports bra", "Track pants", "Gym top", "Joggers", "Cycling shorts"],
  Loungewear: ["Pyjamas", "Robe", "Sleep set", "Sweatpants"],
  Swimwear: ["Swimsuit", "Bikini", "Cover-up", "Trunks"],
};
const CAT_LIST = Object.keys(CATEGORIES);

const ROLE = {
  Topwear: "TOP", Bottomwear: "BOTTOM", "One-piece": "ONE", Ethnic: "ONE",
  Outerwear: "LAYER", Footwear: "SHOES", Bags: "CARRY", Accessories: "EXTRA",
  Jewellery: "EXTRA", Activewear: "TOP", Loungewear: "ONE", Swimwear: "ONE",
};

const PATTERNS = ["solid", "striped", "checked", "floral", "printed", "textured", "denim", "colourblock"];
const SEASONS = ["spring", "summer", "autumn", "winter"];
const FORMALITY = ["lounge", "casual", "smart casual", "formal", "occasion"];

/* ---------------- storage ---------------- */
const K_INDEX = "archive:index";
const K_LOOKS = "archive:looks";
const kImg = (id) => `archive:img:${id}`;

const sGet = (key) => kvGet(key);
const sSet = (key, val) => kvSet(key, val);
const sDel = (key) => kvDel(key);

/* ---------------- image utils ---------------- */
function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Could not open that image."));
    i.src = src;
  });
}
function drawTo(img, max, quality, box) {
  const sx = box ? (box[0] / 100) * img.width : 0;
  const sy = box ? (box[1] / 100) * img.height : 0;
  const sw = box ? (box[2] / 100) * img.width : img.width;
  const sh = box ? (box[3] / 100) * img.height : img.height;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h);
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}
function padBox(b, pad = 3) {
  let [x, y, w, h] = b.map(Number);
  x = Math.max(0, x - pad); y = Math.max(0, y - pad);
  w = Math.min(100 - x, w + pad * 2); h = Math.min(100 - y, h + pad * 2);
  if (!(w > 2 && h > 2)) return [0, 0, 100, 100];
  return [x, y, w, h];
}

/* perceptual hash — 64 bit difference hash */
function dHash(img) {
  const c = document.createElement("canvas");
  c.width = 9; c.height = 8;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data;
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let i = 0; i < 8; i++) {
      const a = (y * 9 + i) * 4, b = (y * 9 + i + 1) * 4;
      const la = d[a] * 0.299 + d[a + 1] * 0.587 + d[a + 2] * 0.114;
      const lb = d[b] * 0.299 + d[b + 1] * 0.587 + d[b + 2] * 0.114;
      bits += la > lb ? "1" : "0";
    }
  }
  return bits;
}
function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 99;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/* ---------------- colour ---------------- */
function hex2rgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || "#888888");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [136, 136, 136];
}
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const toHsl = (hex) => { const [r, g, b] = hex2rgb(hex); return rgb2hsl(r, g, b); };
function colourDist(a, b) {
  const x = hex2rgb(a), y = hex2rgb(b);
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- styling engine ---------------- */
const isBold = (p) => p && !["solid", "textured", "denim"].includes(p);

function pairScore(a, b) {
  const A = toHsl(a.hex), B = toHsl(b.hex);
  const nA = A.s < 0.15 || A.l < 0.13 || A.l > 0.9;
  const nB = B.s < 0.15 || B.l < 0.13 || B.l > 0.9;
  let s;
  if (nA && nB) s = 82;
  else if (nA || nB) s = 79;
  else {
    let d = Math.abs(A.h - B.h);
    if (d > 180) d = 360 - d;
    if (d < 20) s = 77;
    else if (d < 48) s = 71;
    else if (d > 150) s = 81;
    else if (d > 105) s = 66;
    else s = 43;
    if (A.s > 0.6 && B.s > 0.6 && s < 60) s -= 9;
  }
  if (isBold(a.pattern) && isBold(b.pattern)) s -= 15;
  s -= Math.abs((a.formality ?? 2) - (b.formality ?? 2)) * 8;
  const overlap = (a.seasons || []).some((x) => (b.seasons || []).includes(x));
  if (overlap) s += 4;
  return clamp(s, 0, 100);
}

function scoreOutfit(pieces) {
  if (pieces.length < 2) return 0;
  let total = 0, n = 0;
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) { total += pairScore(pieces[i], pieces[j]); n++; }
  let s = total / n;
  const freshness = pieces.reduce((acc, p) => acc + (p.worn > 6 ? -1.2 : p.worn === 0 ? 2 : 0), 0);
  return clamp(Math.round(s + freshness), 0, 100);
}

function buildOutfit(items, locked = []) {
  const by = (role) => items.filter((i) => ROLE[i.category] === role);
  const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  const lockedRoles = new Set(locked.map((l) => ROLE[l.category]));
  const take = (role) => locked.find((l) => ROLE[l.category] === role) || null;

  const out = [];
  const one = take("ONE");
  const top = take("TOP");
  const bottom = take("BOTTOM");

  let useOne;
  if (one) useOne = true;
  else if (top || bottom) useOne = false;
  else useOne = by("ONE").length > 0 && (by("TOP").length === 0 || Math.random() < 0.32);

  if (useOne) {
    const o = one || pick(by("ONE"));
    if (o) out.push(o);
  } else {
    const t = top || pick(by("TOP"));
    const b = bottom || pick(by("BOTTOM"));
    if (t) out.push(t);
    if (b) out.push(b);
  }
  const layer = take("LAYER") || (Math.random() < 0.42 ? pick(by("LAYER")) : null);
  if (layer) out.push(layer);
  const shoes = take("SHOES") || pick(by("SHOES"));
  if (shoes) out.push(shoes);
  const carry = take("CARRY") || (Math.random() < 0.5 ? pick(by("CARRY")) : null);
  if (carry) out.push(carry);
  const extra = take("EXTRA") || (Math.random() < 0.45 ? pick(by("EXTRA")) : null);
  if (extra) out.push(extra);

  locked.forEach((l) => { if (!out.find((o) => o.id === l.id)) out.push(l); });
  const seen = new Set();
  return out.filter((p) => p && !seen.has(p.id) && seen.add(p.id));
}

function generateBest(items, locked, tries = 70) {
  const cands = [];
  for (let i = 0; i < tries; i++) {
    const o = buildOutfit(items, locked);
    if (o.length < 2) continue;
    cands.push({ pieces: o, score: scoreOutfit(o) });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const pool = cands.slice(0, Math.min(8, cands.length));
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- vision ----------------
   Now handled entirely on the device by src/vision.js.
   No prompt, no key, no request leaving the phone. */

/* ---------------- sample seed ---------------- */
function swatch(hex, label) {
  const c = document.createElement("canvas");
  c.width = 300; c.height = 380;
  const x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 300, 380);
  x.fillStyle = hex; x.fillRect(28, 28, 244, 288);
  x.strokeStyle = "rgba(0,0,0,.12)"; x.lineWidth = 1; x.strokeRect(28.5, 28.5, 243, 287);
  x.fillStyle = "#141414"; x.font = "500 15px monospace";
  x.fillText(label.toUpperCase(), 28, 350);
  return c.toDataURL("image/jpeg", 0.8);
}
const SEED = [
  ["Topwear", "Shirt", "Ecru linen shirt", "#E6DFCE", "ecru", "solid", "linen", 2, ["spring", "summer"]],
  ["Topwear", "T-shirt", "Black cotton tee", "#1B1B1B", "black", "solid", "cotton", 1, ["spring", "summer", "autumn"]],
  ["Topwear", "Sweater", "Slate wool knit", "#5A6470", "slate", "textured", "wool", 2, ["autumn", "winter"]],
  ["Bottomwear", "Jeans", "Indigo straight jeans", "#37455F", "indigo", "denim", "denim", 1, ["spring", "autumn", "winter"]],
  ["Bottomwear", "Trousers", "Stone wide trousers", "#C9C2B4", "stone", "solid", "cotton", 2, ["spring", "summer"]],
  ["One-piece", "Dress", "Olive midi dress", "#6B7150", "olive", "solid", "viscose", 2, ["spring", "summer"]],
  ["Outerwear", "Blazer", "Charcoal blazer", "#3A3A3C", "charcoal", "solid", "wool", 3, ["autumn", "winter"]],
  ["Footwear", "Sneakers", "White leather sneakers", "#F1EFEA", "white", "solid", "leather", 1, ["spring", "summer", "autumn"]],
  ["Footwear", "Boots", "Brown ankle boots", "#6A4A32", "brown", "solid", "leather", 2, ["autumn", "winter"]],
  ["Bags", "Tote", "Tan leather tote", "#A97B4F", "tan", "solid", "leather", 2, ["spring", "autumn"]],
];

/* ============================================================
   UI PRIMITIVES
   ============================================================ */
const Eyebrow = ({ children, style }) => (
  <div style={{ fontFamily: FB, fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: C.muted, fontWeight: 500, ...style }}>
    {children}
  </div>
);
const Mono = ({ children, style }) => (
  <span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: ".02em", color: C.faint, ...style }}>{children}</span>
);

function Btn({ children, onClick, variant = "solid", disabled, style, full }) {
  const base = {
    fontFamily: FB, fontSize: 12.5, letterSpacing: ".08em", textTransform: "uppercase",
    fontWeight: 500, padding: "13px 20px", borderRadius: 2, cursor: disabled ? "default" : "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    width: full ? "100%" : undefined, opacity: disabled ? 0.4 : 1,
    transition: "background .18s, color .18s, border-color .18s",
  };
  const v = {
    solid: { background: C.ink, color: "#fff", border: `1px solid ${C.ink}` },
    accent: { background: C.accent, color: "#fff", border: `1px solid ${C.accent}` },
    ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.line}` },
    quiet: { background: "transparent", color: C.muted, border: "1px solid transparent" },
  }[variant];
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ ...base, ...v, ...style }}>
      {children}
    </button>
  );
}

function Chip({ label, active, onClick, count }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: FB, fontSize: 11.5, letterSpacing: ".07em", textTransform: "uppercase",
      padding: "7px 13px", borderRadius: 999, whiteSpace: "nowrap", cursor: "pointer",
      border: `1px solid ${active ? C.ink : C.line}`,
      background: active ? C.ink : "transparent", color: active ? "#fff" : C.ink2,
      fontWeight: 500, transition: "all .16s",
    }}>
      {label}{count != null && <span style={{ opacity: .55, marginLeft: 6, fontFamily: FM, fontSize: 10 }}>{count}</span>}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="block">
      <Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>
      {children}
    </div>
  );
}
const inputCss = {
  width: "100%", fontFamily: FB, fontSize: 14, color: C.ink, background: C.surface,
  border: `1px solid ${C.line}`, borderRadius: 2, padding: "10px 12px", outline: "none",
};

/* ============================================================
   PLATE — the signature catalogue card
   ============================================================ */
function Plate({ item, img, onClick, index }) {
  return (
    <button onClick={onClick} className="text-left w-full" style={{
      background: C.surface, border: `1px solid ${C.lineSoft}`, borderRadius: 2,
      overflow: "hidden", cursor: "pointer", animation: `rise .45s ${index * 0.03}s both`,
    }}>
      <div style={{ aspectRatio: "3/4", background: "#fff", position: "relative" }}>
        {img
          ? <img src={img} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 10 }} />
          : <div className="w-full h-full flex items-center justify-center" style={{ background: C.ground }}>
              <Loader2 size={14} color={C.faint} className="animate-spin" />
            </div>}
        {item.fav && (
          <div style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: 999, background: "rgba(255,255,255,.92)", display: "grid", placeItems: "center" }}>
            <Heart size={11} fill={C.ink} color={C.ink} />
          </div>
        )}
      </div>
      <div style={{ padding: "9px 10px 11px", borderTop: `1px solid ${C.lineSoft}` }}>
        <div style={{ fontFamily: FD, fontSize: 14.5, lineHeight: 1.2, color: C.ink, fontWeight: 500 }}>
          {item.name}
        </div>
        <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
          <Eyebrow style={{ fontSize: 9 }}>{item.sub || item.category}</Eyebrow>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: 999, background: item.hex, border: `1px solid ${C.line}`, display: "inline-block" }} />
            <Mono style={{ fontSize: 9.5 }}>{item.code}</Mono>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ============================================================
   SCREENS
   ============================================================ */

function Wardrobe({ items, imgs, onOpen, onAdd, onSeed, seeding }) {
  const [filter, setFilter] = useState("All");
  const counts = useMemo(() => {
    const m = {};
    items.forEach((i) => { m[i.category] = (m[i.category] || 0) + 1; });
    return m;
  }, [items]);
  const shown = filter === "All" ? items : items.filter((i) => i.category === filter);
  const cats = CAT_LIST.filter((c) => counts[c]);

  if (!items.length) {
    return (
      <div className="px-5 pt-16 pb-32">
        <div style={{ fontFamily: FD, fontSize: 46, lineHeight: .98, color: C.ink, letterSpacing: "-.02em" }}>
          Nothing<br />catalogued<br /><span style={{ fontStyle: "italic" }}>yet.</span>
        </div>
        <p style={{ fontFamily: FB, fontSize: 14.5, lineHeight: 1.6, color: C.ink2, marginTop: 22, maxWidth: 330 }}>
          Photograph one outfit. Every piece in the frame gets separated, named and filed on its own.
        </p>
        <div className="flex flex-col gap-2.5" style={{ marginTop: 28, maxWidth: 330 }}>
          <Btn onClick={onAdd} full><Camera size={14} /> Add your first piece</Btn>
          <Btn onClick={onSeed} variant="ghost" full disabled={seeding}>
            {seeding ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />} Load 10 sample pieces
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <div className="px-5 pt-12 pb-5">
        <Eyebrow>The collection</Eyebrow>
        <div className="flex items-baseline gap-3" style={{ marginTop: 4 }}>
          <h1 style={{ fontFamily: FD, fontSize: 40, lineHeight: 1, color: C.ink, letterSpacing: "-.02em" }}>Wardrobe</h1>
          <Mono style={{ fontSize: 12 }}>{String(items.length).padStart(3, "0")}</Mono>
        </div>
      </div>
      <div className="flex gap-2 px-5 pb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <Chip label="All" active={filter === "All"} onClick={() => setFilter("All")} count={items.length} />
        {cats.map((c) => <Chip key={c} label={c} active={filter === c} onClick={() => setFilter(c)} count={counts[c]} />)}
      </div>
      <div className="grid grid-cols-2 gap-2.5 px-5">
        {shown.map((it, i) => <Plate key={it.id} item={it} img={imgs[it.id]} index={i} onClick={() => onOpen(it)} />)}
      </div>
    </div>
  );
}

function AddScreen({ onCommit, items, imgs }) {
  const [stage, setStage] = useState("idle"); // idle | working | review
  const [status, setStatus] = useState("");
  const [pct, setPct] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);
  const camRef = useRef(null);
  const upRef = useRef(null);

  const handle = async (file) => {
    if (!file) return;
    setErr(""); setStage("working"); setPct(null);
    try {
      setStatus("Reading the photograph");
      const raw = await readFile(file);
      const img = await loadImg(raw);
      const shrunk = drawTo(img, 900, 0.85);

      const found = await analyseLocal(shrunk, ({ stage, pct }) => {
        setStatus(stage);
        setPct(typeof pct === "number" ? pct : null);
      });
      if (!found.length) {
        throw new Error("No clear pieces found. A plain background and the whole garment in frame helps most.");
      }

      setStatus("Checking against what you own"); setPct(null);
      const built = [];
      for (const f of found) {
        const cimg = await loadImg(f.crop);
        const hash = dHash(cimg);
        const dup = items.find((it) =>
          hamming(it.hash, hash) <= 10 ||
          (it.sub === f.sub && it.category === f.category && colourDist(it.hex, f.hex) < 30)
        );
        built.push({ ...f, tmp: Math.random().toString(36).slice(2), hash, dup: dup || null, keep: !dup });
      }
      setDrafts(built);
      setStage("review");
    } catch (e) {
      setErr(e.message || "Something went wrong.");
      setStage("idle");
    }
  };

  const reset = () => { setStage("idle"); setDrafts([]); setErr(""); };

  if (stage === "working") {
    return (
      <div className="px-5 pt-12 pb-32">
        <Eyebrow>In process</Eyebrow>
        <div style={{ fontFamily: FD, fontSize: 34, lineHeight: 1.05, color: C.ink, marginTop: 6, letterSpacing: "-.015em" }}>
          {status}<span style={{ animation: "blink 1.1s steps(1) infinite" }}>.</span>
        </div>
        <div style={{ marginTop: 30, height: 2, background: C.line, position: "relative", overflow: "hidden" }}>
          {pct == null
            ? <div style={{ position: "absolute", inset: 0, background: C.accent, animation: "sweep 1.4s ease-in-out infinite" }} />
            : <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${pct}%`, background: C.accent, transition: "width .3s" }} />}
        </div>
        {pct != null && (
          <div className="flex justify-between" style={{ marginTop: 10 }}>
            <Mono style={{ fontSize: 10.5 }}>FIRST RUN ONLY</Mono>
            <Mono style={{ fontSize: 10.5, color: C.accent }}>{pct}%</Mono>
          </div>
        )}
        <p style={{ fontFamily: FB, fontSize: 13, color: C.muted, marginTop: 18, lineHeight: 1.55, maxWidth: 330 }}>
          This runs on your phone. The photo is never uploaded anywhere.
        </p>
      </div>
    );
  }

  if (stage === "review") {
    const keeping = drafts.filter((d) => d.keep);
    return (
      <div className="px-5 pt-12 pb-40">
        <Eyebrow>Found in the frame</Eyebrow>
        <h1 style={{ fontFamily: FD, fontSize: 34, lineHeight: 1.05, color: C.ink, marginTop: 4, letterSpacing: "-.015em" }}>
          {drafts.length} piece{drafts.length > 1 ? "s" : ""}
        </h1>
        <p style={{ fontFamily: FB, fontSize: 13, color: C.muted, marginTop: 8 }}>
          Tap a card to correct anything. Untick what you don't want filed.
        </p>

        <div className="flex flex-col gap-2.5" style={{ marginTop: 20 }}>
          {drafts.map((d, i) => (
            <div key={d.tmp} style={{
              background: C.surface, border: `1px solid ${d.dup ? "#E2D2B8" : C.lineSoft}`,
              borderRadius: 2, animation: `rise .4s ${i * .05}s both`,
            }}>
              {d.dup && (
                <div className="flex items-start gap-2 px-3 py-2.5" style={{ background: "#FAF4E8", borderBottom: `1px solid #EEE2CB` }}>
                  <Copy size={13} color={C.warn} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: FB, fontSize: 12.5, color: C.warn, fontWeight: 500 }}>
                      Already in the archive as {d.dup.code}
                    </div>
                    <div style={{ fontFamily: FB, fontSize: 12, color: C.muted, marginTop: 1 }}>
                      “{d.dup.name}”. Tick to file it anyway as a second copy.
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-3 p-3">
                <img src={d.crop} alt="" style={{ width: 74, height: 96, objectFit: "contain", background: "#fff", border: `1px solid ${C.lineSoft}`, flexShrink: 0 }} />
                <button className="flex-1 text-left" onClick={() => setEditing(d.tmp)}>
                  <div style={{ fontFamily: FD, fontSize: 17, lineHeight: 1.15, color: C.ink }}>{d.name}</div>
                  <Eyebrow style={{ marginTop: 5, fontSize: 9 }}>{d.category} · {d.sub}</Eyebrow>
                  <div className="flex items-center gap-1.5" style={{ marginTop: 7 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: d.hex, border: `1px solid ${C.line}` }} />
                    <Mono style={{ fontSize: 10 }}>{d.colourName} · {d.pattern} · {FORMALITY[d.formality]}</Mono>
                  </div>
                  <div style={{ fontFamily: FB, fontSize: 11.5, color: C.accent, marginTop: 8, letterSpacing: ".04em" }}>Edit details</div>
                </button>
                <button onClick={() => setDrafts((p) => p.map((x) => x.tmp === d.tmp ? { ...x, keep: !x.keep } : x))}
                  style={{
                    width: 26, height: 26, borderRadius: 2, flexShrink: 0, cursor: "pointer",
                    border: `1px solid ${d.keep ? C.ink : C.line}`, background: d.keep ? C.ink : "transparent",
                    display: "grid", placeItems: "center", alignSelf: "flex-start",
                  }}>
                  {d.keep && <Check size={14} color="#fff" />}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2" style={{ marginTop: 22 }}>
          <Btn variant="ghost" onClick={reset}>Discard</Btn>
          <Btn onClick={() => { onCommit(keeping); reset(); }} disabled={!keeping.length} style={{ flex: 1 }}>
            File {keeping.length} piece{keeping.length === 1 ? "" : "s"}
          </Btn>
        </div>

        {editing && (
          <EditSheet
            draft={drafts.find((d) => d.tmp === editing)}
            onClose={() => setEditing(null)}
            onSave={(patch) => { setDrafts((p) => p.map((x) => x.tmp === editing ? { ...x, ...patch } : x)); setEditing(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="px-5 pt-12 pb-32">
      <Eyebrow>Add to the archive</Eyebrow>
      <h1 style={{ fontFamily: FD, fontSize: 40, lineHeight: 1, color: C.ink, marginTop: 4, letterSpacing: "-.02em" }}>
        One photo,<br /><span style={{ fontStyle: "italic" }}>every piece.</span>
      </h1>
      <p style={{ fontFamily: FB, fontSize: 14.5, lineHeight: 1.6, color: C.ink2, marginTop: 16, maxWidth: 340 }}>
        Shoot a full outfit or a single garment. Each item is cut out, named, colour-matched and filed separately.
      </p>

      {err && (
        <div className="flex gap-2 items-start" style={{ marginTop: 20, padding: "11px 13px", background: "#FBF0EC", border: "1px solid #EFD9D1", borderRadius: 2 }}>
          <AlertTriangle size={14} color="#A34A2B" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontFamily: FB, fontSize: 13, color: "#7E3A22", lineHeight: 1.45 }}>{err}</div>
        </div>
      )}

      <div className="flex flex-col gap-2.5" style={{ marginTop: 26, maxWidth: 340 }}>
        <Btn full onClick={() => camRef.current?.click()}><Camera size={14} /> Take a photo</Btn>
        <Btn full variant="ghost" onClick={() => upRef.current?.click()}><Upload size={14} /> Upload from library</Btn>
      </div>

      <div style={{ marginTop: 34, paddingTop: 20, borderTop: `1px solid ${C.line}`, maxWidth: 340 }}>
        <Eyebrow>For a cleaner cut-out</Eyebrow>
        <ul style={{ marginTop: 10, display: "grid", gap: 7 }}>
          {["Plain wall or floor behind the clothes", "Even daylight, no hard shadow", "Whole garment inside the frame", "Flat-lay works better than a mirror selfie"].map((t, i) => (
            <li key={i} className="flex gap-2.5" style={{ fontFamily: FB, fontSize: 13, color: C.ink2, lineHeight: 1.5 }}>
              <Mono style={{ color: C.accent, fontSize: 10, marginTop: 2 }}>{String(i + 1).padStart(2, "0")}</Mono>{t}
            </li>
          ))}
        </ul>
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={upRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

function EditSheet({ draft, onClose, onSave }) {
  const [f, setF] = useState({ ...draft });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const subs = CATEGORIES[f.category] || [];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(20,20,20,.4)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full overflow-y-auto"
        style={{ maxWidth: 520, background: C.ground, maxHeight: "88vh", animation: "slideUp .3s ease-out", borderTop: `1px solid ${C.line}` }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.ground }}>
          <Eyebrow>Correct the record</Eyebrow>
          <button onClick={onClose}><X size={18} color={C.ink} /></button>
        </div>
        <div className="px-5 py-5 grid gap-4">
          <Field label="Name"><input style={inputCss} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select style={inputCss} value={f.category} onChange={(e) => { set("category", e.target.value); set("sub", CATEGORIES[e.target.value][0]); }}>
                {CAT_LIST.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select style={inputCss} value={f.sub} onChange={(e) => set("sub", e.target.value)}>
                {!subs.includes(f.sub) && <option>{f.sub}</option>}
                {subs.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pattern">
              <select style={inputCss} value={f.pattern} onChange={(e) => set("pattern", e.target.value)}>
                {PATTERNS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Colour">
              <div className="flex gap-2 items-center" style={{ ...inputCss, padding: 6 }}>
                <input type="color" value={f.hex} onChange={(e) => set("hex", e.target.value)}
                  style={{ width: 30, height: 28, border: "none", background: "none", padding: 0, cursor: "pointer" }} />
                <input value={f.colourName} onChange={(e) => set("colourName", e.target.value)} placeholder="name"
                  style={{ border: "none", outline: "none", fontFamily: FB, fontSize: 13.5, width: "100%", background: "transparent" }} />
              </div>
            </Field>
          </div>
          <Field label="Dress code">
            <div className="flex flex-wrap gap-1.5">
              {FORMALITY.map((lbl, i) => <Chip key={lbl} label={lbl} active={f.formality === i} onClick={() => set("formality", i)} />)}
            </div>
          </Field>
          <Field label="Seasons">
            <div className="flex flex-wrap gap-1.5">
              {SEASONS.map((s) => (
                <Chip key={s} label={s} active={(f.seasons || []).includes(s)}
                  onClick={() => set("seasons", (f.seasons || []).includes(s) ? f.seasons.filter((x) => x !== s) : [...(f.seasons || []), s])} />
              ))}
            </div>
          </Field>
          <Btn full onClick={() => onSave(f)} style={{ marginTop: 4 }}>Save details</Btn>
        </div>
      </div>
    </div>
  );
}

function Studio({ items, imgs, onSaveLook, onWear }) {
  const [outfit, setOutfit] = useState(null);
  const [locks, setLocks] = useState([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const roll = useCallback(() => {
    const locked = items.filter((i) => locks.includes(i.id));
    const r = generateBest(items, locked);
    setOutfit(r); setNote(""); setSaved(false);
  }, [items, locks]);

  useEffect(() => { if (items.length >= 2 && !outfit) roll(); }, [items.length]);

  if (items.length < 2) {
    return (
      <div className="px-5 pt-16 pb-32">
        <Eyebrow>The styling table</Eyebrow>
        <div style={{ fontFamily: FD, fontSize: 38, lineHeight: 1.02, color: C.ink, marginTop: 6, letterSpacing: "-.02em" }}>
          Two pieces<br />and it starts<br /><span style={{ fontStyle: "italic" }}>working.</span>
        </div>
        <p style={{ fontFamily: FB, fontSize: 14.5, lineHeight: 1.6, color: C.ink2, marginTop: 20, maxWidth: 330 }}>
          File a few pieces first. Then this table pairs them by colour, dress code and season, and shows you combinations you own but have never worn together.
        </p>
      </div>
    );
  }

  const score = outfit?.score ?? 0;
  const verdict = score >= 78 ? "Sharp" : score >= 66 ? "Works" : score >= 52 ? "Bold" : "A stretch";

  return (
    <div className="pb-40">
      <div className="px-5 pt-12 pb-4 flex items-end justify-between">
        <div>
          <Eyebrow>The styling table</Eyebrow>
          <h1 style={{ fontFamily: FD, fontSize: 40, lineHeight: 1, color: C.ink, marginTop: 4, letterSpacing: "-.02em" }}>Today</h1>
        </div>
        <div className="text-right">
          <div style={{ fontFamily: FD, fontSize: 26, color: C.ink, lineHeight: 1 }}>{verdict}</div>
          <Mono style={{ fontSize: 10.5, color: C.accent }}>HARMONY {score}</Mono>
        </div>
      </div>

      {/* flat-lay column */}
      <div className="mx-5" style={{ border: `1px solid ${C.line}`, background: C.surface, borderRadius: 2 }}>
        {(outfit?.pieces || []).map((p, i) => {
          const locked = locks.includes(p.id);
          return (
            <div key={p.id} className="flex items-center gap-3.5 p-3"
              style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none", animation: `rise .35s ${i * .05}s both` }}>
              <img src={imgs[p.id]} alt="" style={{ width: 62, height: 78, objectFit: "contain", background: "#fff", border: `1px solid ${C.lineSoft}` }} />
              <div className="flex-1 min-w-0">
                <Eyebrow style={{ fontSize: 9 }}>{ROLE[p.category]}</Eyebrow>
                <div style={{ fontFamily: FD, fontSize: 17, lineHeight: 1.2, color: C.ink, marginTop: 3 }}>{p.name}</div>
                <div className="flex items-center gap-1.5" style={{ marginTop: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: p.hex, border: `1px solid ${C.line}` }} />
                  <Mono style={{ fontSize: 9.5 }}>{p.code} · worn {p.worn}×</Mono>
                </div>
              </div>
              <button onClick={() => setLocks((l) => locked ? l.filter((x) => x !== p.id) : [...l, p.id])}
                style={{ padding: 8, cursor: "pointer", color: locked ? C.accent : C.faint }} title={locked ? "Unlock" : "Keep this piece"}>
                {locked ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-5" style={{ marginTop: 10 }}>
        <div style={{ fontFamily: FB, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Lock a piece to build around it, then shuffle the rest.
        </div>
      </div>

      {note && (
        <div className="mx-5 p-4" style={{ marginTop: 14, background: C.accentSoft, borderRadius: 2 }}>
          <Eyebrow style={{ color: C.accent }}>Stylist's note</Eyebrow>
          <p style={{ fontFamily: FD, fontSize: 16.5, lineHeight: 1.45, color: C.ink, marginTop: 7 }}>{note}</p>
        </div>
      )}

      <div className="px-5 grid grid-cols-2 gap-2" style={{ marginTop: 16 }}>
        <Btn onClick={roll} full><Shuffle size={14} /> Shuffle</Btn>
        <Btn variant="ghost" full onClick={() => setNote(stylistNote(outfit.pieces))}>
          <Wand2 size={14} /> Ask a stylist
        </Btn>
        <Btn variant={saved ? "ghost" : "accent"} full disabled={saved}
          onClick={() => { onSaveLook(outfit); setSaved(true); }}>
          {saved ? <><Check size={14} /> Saved</> : <><Bookmark size={14} /> Save look</>}
        </Btn>
        <Btn variant="ghost" full onClick={() => { onWear(outfit.pieces.map((p) => p.id)); roll(); }}>
          <Check size={14} /> Wearing it
        </Btn>
      </div>
    </div>
  );
}

function Looks({ looks, items, imgs, onDelete, onWear }) {
  if (!looks.length) {
    return (
      <div className="px-5 pt-16 pb-32">
        <Eyebrow>Saved looks</Eyebrow>
        <div style={{ fontFamily: FD, fontSize: 38, lineHeight: 1.02, color: C.ink, marginTop: 6, letterSpacing: "-.02em" }}>
          Your lookbook<br /><span style={{ fontStyle: "italic" }}>is empty.</span>
        </div>
        <p style={{ fontFamily: FB, fontSize: 14.5, lineHeight: 1.6, color: C.ink2, marginTop: 20, maxWidth: 330 }}>
          Anything you save at the styling table is kept here, ready for a morning when you have no time to think.
        </p>
      </div>
    );
  }
  return (
    <div className="pb-32">
      <div className="px-5 pt-12 pb-5">
        <Eyebrow>Saved looks</Eyebrow>
        <div className="flex items-baseline gap-3" style={{ marginTop: 4 }}>
          <h1 style={{ fontFamily: FD, fontSize: 40, lineHeight: 1, color: C.ink, letterSpacing: "-.02em" }}>Lookbook</h1>
          <Mono style={{ fontSize: 12 }}>{String(looks.length).padStart(3, "0")}</Mono>
        </div>
      </div>
      <div className="px-5 grid gap-3">
        {looks.map((lk, i) => {
          const pieces = lk.ids.map((id) => items.find((x) => x.id === id)).filter(Boolean);
          if (!pieces.length) return null;
          return (
            <div key={lk.id} style={{ background: C.surface, border: `1px solid ${C.lineSoft}`, borderRadius: 2, animation: `rise .4s ${i * .04}s both` }}>
              <div className="flex gap-1.5 p-3">
                {pieces.map((p) => (
                  <img key={p.id} src={imgs[p.id]} alt="" style={{ width: 56, height: 72, objectFit: "contain", background: "#fff", border: `1px solid ${C.lineSoft}` }} />
                ))}
              </div>
              <div className="flex items-center justify-between px-3 pb-3">
                <div>
                  <div style={{ fontFamily: FD, fontSize: 16, color: C.ink }}>{lk.title}</div>
                  <Mono style={{ fontSize: 9.5 }}>HARMONY {lk.score} · {pieces.length} PIECES</Mono>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => onWear(lk.ids)} style={{ padding: 8, color: C.ink }} title="Mark as worn"><Check size={16} /></button>
                  <button onClick={() => onDelete(lk.id)} style={{ padding: 8, color: C.faint }} title="Remove"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ item, img, onClose, onUpdate, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: C.ground }}>
      <div className="mx-auto" style={{ maxWidth: 520 }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.ground, zIndex: 2 }}>
          <button onClick={onClose} className="flex items-center gap-1" style={{ color: C.ink, fontFamily: FB, fontSize: 13 }}>
            <ChevronLeft size={18} /> Wardrobe
          </button>
          <Mono>{item.code}</Mono>
        </div>
        <img src={img} alt={item.name} style={{ width: "100%", background: "#fff", display: "block" }} />
        <div className="px-5 py-5">
          <h2 style={{ fontFamily: FD, fontSize: 30, lineHeight: 1.08, color: C.ink, letterSpacing: "-.015em" }}>{item.name}</h2>
          <Eyebrow style={{ marginTop: 8 }}>{item.category} · {item.sub}</Eyebrow>

          <div className="grid grid-cols-2 gap-x-4" style={{ marginTop: 22 }}>
            {[
              ["Colour", item.colourName || item.hex],
              ["Pattern", item.pattern],
              ["Material", item.material || "—"],
              ["Dress code", FORMALITY[item.formality]],
              ["Seasons", (item.seasons || []).join(", ") || "any"],
              ["Times worn", `${item.worn}`],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: "11px 0", borderBottom: `1px solid ${C.lineSoft}` }}>
                <Eyebrow style={{ fontSize: 9 }}>{k}</Eyebrow>
                <div style={{ fontFamily: FB, fontSize: 14, color: C.ink, marginTop: 3, textTransform: "capitalize" }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2" style={{ marginTop: 24 }}>
            <Btn variant={item.fav ? "solid" : "ghost"} onClick={() => onUpdate({ fav: !item.fav })} style={{ flex: 1 }}>
              <Heart size={14} fill={item.fav ? "#fff" : "none"} /> {item.fav ? "Favourite" : "Add to favourites"}
            </Btn>
            <Btn variant="ghost" onClick={() => onUpdate({ worn: item.worn + 1 })}><Plus size={14} /> Worn</Btn>
          </div>
          <button onClick={onDelete} className="flex items-center gap-2 mx-auto"
            style={{ marginTop: 26, marginBottom: 40, fontFamily: FB, fontSize: 12.5, color: C.faint, letterSpacing: ".05em" }}>
            <Trash2 size={13} /> Remove from archive
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function App() {
  const [tab, setTab] = useState("wardrobe");
  const [items, setItems] = useState([]);
  const [imgs, setImgs] = useState({});
  const [looks, setLooks] = useState([]);
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [toast, setToast] = useState("");
  const [installer, setInstaller] = useState(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..600&family=Archivo:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
    const st = document.createElement("style");
    st.textContent = `
      @keyframes rise { from { opacity:0; transform:translateY(9px) } to { opacity:1; transform:none } }
      @keyframes slideUp { from { transform:translateY(100%) } to { transform:none } }
      @keyframes sweep { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
      @keyframes blink { 50% { opacity:0 } }
      @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important } }
      button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid ${C.accent}; outline-offset:2px }
      ::-webkit-scrollbar { display:none }
    `;
    document.head.appendChild(st);
    const grab = (e) => { e.preventDefault(); setInstaller(e); };
    window.addEventListener("beforeinstallprompt", grab);
    window.addEventListener("appinstalled", () => setInstaller(null));
    return () => window.removeEventListener("beforeinstallprompt", grab);
  }, []);

  // load
  useEffect(() => {
    (async () => {
      makePersistent();
      // Start fetching the models straight away so the first photo isn't a wait.
      if (navigator.onLine && !modelsReady()) setTimeout(() => loadModels().catch(() => {}), 1500);
      const t = new URLSearchParams(location.search).get("tab");
      if (["wardrobe", "add", "studio", "looks"].includes(t)) setTab(t);
      const idx = (await sGet(K_INDEX)) || [];
      const lk = (await sGet(K_LOOKS)) || [];
      setItems(idx); setLooks(lk); setLoading(false);
      const pairs = await Promise.all(idx.map(async (it) => [it.id, await sGet(kImg(it.id))]));
      setImgs(Object.fromEntries(pairs.filter(([, v]) => v)));
    })();
  }, []);

  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2400); };
  const persist = (next) => { setItems(next); sSet(K_INDEX, next); };
  const persistLooks = (next) => { setLooks(next); sSet(K_LOOKS, next); };

  const commit = async (drafts) => {
    let n = items.length;
    const added = [];
    const newImgs = {};
    for (const d of drafts) {
      n += 1;
      const id = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rec = {
        id, code: "W-" + String(n).padStart(3, "0"), name: d.name, category: d.category, sub: d.sub,
        hex: d.hex, colourName: d.colourName, pattern: d.pattern, material: d.material,
        formality: d.formality, seasons: d.seasons, hash: d.hash, worn: 0, fav: false, added: Date.now(),
      };
      added.push(rec);
      newImgs[id] = d.crop;
      await sSet(kImg(id), d.crop);
    }
    setImgs((p) => ({ ...p, ...newImgs }));
    persist([...added.reverse(), ...items]);
    say(`${added.length} piece${added.length === 1 ? "" : "s"} filed`);
    setTab("wardrobe");
  };

  const seed = async () => {
    setSeeding(true);
    const drafts = [];
    for (const [cat, sub, name, hex, cn, pat, mat, f, se] of SEED) {
      const crop = swatch(hex, sub);
      const im = await loadImg(crop);
      drafts.push({ category: cat, sub, name, hex, colourName: cn, pattern: pat, material: mat, formality: f, seasons: se, crop, hash: dHash(im) });
    }
    await commit(drafts);
    setSeeding(false);
  };

  const wear = (ids) => persist(items.map((i) => ids.includes(i.id) ? { ...i, worn: i.worn + 1 } : i));

  const saveLook = (o) => {
    const lead = o.pieces[0];
    persistLooks([{
      id: "l" + Date.now().toString(36), ids: o.pieces.map((p) => p.id), score: o.score,
      title: `${FORMALITY[Math.round(o.pieces.reduce((a, p) => a + p.formality, 0) / o.pieces.length)]} · ${lead.colourName || lead.category}`,
    }, ...looks]);
    say("Saved to your lookbook");
  };

  const removeItem = async (id) => {
    persist(items.filter((i) => i.id !== id));
    persistLooks(looks.filter((l) => !l.ids.includes(id)));
    await sDel(kImg(id));
    setImgs((p) => { const c = { ...p }; delete c[id]; return c; });
    setOpen(null);
    say("Removed from archive");
  };

  const TABS = [
    { k: "wardrobe", label: "Wardrobe", Icon: Grid3x3 },
    { k: "add", label: "Add", Icon: Camera },
    { k: "studio", label: "Style", Icon: Sparkles },
    { k: "looks", label: "Lookbook", Icon: Bookmark },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.ground, fontFamily: FB, WebkitFontSmoothing: "antialiased" }}>
      <div className="mx-auto relative" style={{ maxWidth: 520, minHeight: "100vh", paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex items-center justify-between px-5 pt-5" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <Mono style={{ fontSize: 10, color: C.faint, letterSpacing: ".2em" }}>ARCHIVE</Mono>
          <Mono style={{ fontSize: 10, color: C.faint, letterSpacing: ".1em" }}>
            {items.length} PCS · {looks.length} LOOKS
          </Mono>
        </div>

        {loading ? (
          <div className="flex items-center justify-center" style={{ height: "70vh" }}>
            <Loader2 size={18} color={C.faint} className="animate-spin" />
          </div>
        ) : (
          <>
            {tab === "wardrobe" && <Wardrobe items={items} imgs={imgs} onOpen={setOpen} onAdd={() => setTab("add")} onSeed={seed} seeding={seeding} />}
            {tab === "add" && <AddScreen onCommit={commit} items={items} imgs={imgs} />}
            {tab === "studio" && <Studio items={items} imgs={imgs} onSaveLook={saveLook} onWear={wear} />}
            {tab === "looks" && <Looks looks={looks} items={items} imgs={imgs} onWear={wear} onDelete={(id) => persistLooks(looks.filter((l) => l.id !== id))} />}
          </>
        )}

        {installer && (
          <button
            onClick={async () => { installer.prompt(); await installer.userChoice; setInstaller(null); }}
            className="fixed left-1/2 flex items-center justify-center gap-2"
            style={{
              bottom: 78, transform: "translateX(-50%)", zIndex: 45,
              width: "calc(100% - 40px)", maxWidth: 480, padding: "11px 14px",
              background: C.accentSoft, color: C.accent, borderRadius: 2,
              border: `1px solid #D3D6F5`,
              fontFamily: FB, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase",
            }}>
            <Download size={14} /> Install Archive on this phone
          </button>
        )}

        {toast && (
          <div className="fixed left-1/2 flex items-center gap-2 px-4 py-2.5"
            style={{ bottom: installer ? 140 : 92, transform: "translateX(-50%)", background: C.ink, color: "#fff", borderRadius: 2, zIndex: 60, animation: "rise .3s both", fontFamily: FB, fontSize: 13 }}>
            <Check size={13} /> {toast}
          </div>
        )}

        <nav className="fixed bottom-0 left-1/2" style={{
          transform: "translateX(-50%)", width: "100%", maxWidth: 520,
          background: "rgba(237,236,234,.94)", backdropFilter: "blur(14px)",
          borderTop: `1px solid ${C.line}`, zIndex: 40,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          <div className="grid grid-cols-4">
            {TABS.map(({ k, label, Icon }) => {
              const on = tab === k;
              return (
                <button key={k} onClick={() => setTab(k)} className="flex flex-col items-center gap-1.5 pt-3 pb-4"
                  style={{ color: on ? C.ink : C.faint, position: "relative", cursor: "pointer" }}>
                  <Icon size={17} strokeWidth={on ? 2 : 1.5} />
                  <span style={{ fontFamily: FB, fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: on ? 600 : 400 }}>{label}</span>
                  {on && <span style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 26, height: 2, background: C.accent }} />}
                </button>
              );
            })}
          </div>
        </nav>

        {open && (
          <Detail
            item={items.find((i) => i.id === open.id) || open}
            img={imgs[open.id]}
            onClose={() => setOpen(null)}
            onUpdate={(patch) => persist(items.map((i) => i.id === open.id ? { ...i, ...patch } : i))}
            onDelete={() => removeItem(open.id)}
          />
        )}
      </div>
    </div>
  );
}
