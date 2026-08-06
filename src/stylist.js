/* The stylist's note, written from the same numbers the harmony score uses.
   Nothing here calls a model. It reads the actual colour relationships in the
   outfit and says what it found, which is more useful than a generated
   compliment — it can point at the specific pair that is doing the work, or
   the specific pair that is fighting. */

import { hex2rgb } from "./palette.js";

function hsl(hex) {
  let [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const isNeutral = (hex) => {
  const c = hsl(hex);
  return c.s < 0.15 || c.l < 0.13 || c.l > 0.9;
};
function hueGap(a, b) {
  let d = Math.abs(hsl(a).h - hsl(b).h);
  return d > 180 ? 360 - d : d;
}
const FORMALITY = ["lounge", "casual", "smart casual", "formal", "occasion"];
const bold = (p) => p && !["solid", "textured", "denim"].includes(p);

export function stylistNote(pieces) {
  if (!pieces || pieces.length < 2) return "Add a second piece and there's something to say.";

  const coloured = pieces.filter((p) => !isNeutral(p.hex));
  const neutrals = pieces.filter((p) => isNeutral(p.hex));
  const patterned = pieces.filter((p) => bold(p.pattern));
  const codes = pieces.map((p) => p.formality ?? 1);
  const spread = Math.max(...codes) - Math.min(...codes);
  const lo = pieces.find((p) => p.formality === Math.min(...codes));
  const hi = pieces.find((p) => p.formality === Math.max(...codes));

  /* --- first sentence: where the outfit gets its structure --- */
  let opener;
  if (coloured.length === 0) {
    const lights = pieces.filter((p) => hsl(p.hex).l > 0.55).length;
    opener =
      lights && lights < pieces.length
        ? `All neutrals, but split light and dark, so it reads composed rather than flat.`
        : `A full neutral run — quiet, and it will go with almost anything you own.`;
  } else if (coloured.length === 1) {
    opener = `The ${coloured[0].colourName} ${lower(coloured[0].sub)} is the only voice here, and neutrals around it are exactly why it lands.`;
  } else {
    const [a, b] = coloured;
    const gap = hueGap(a.hex, b.hex);
    if (gap > 150)
      opener = `${cap(a.colourName)} against ${b.colourName} sits opposite on the wheel, which is why this looks deliberate rather than accidental.`;
    else if (gap < 22)
      opener = `${cap(a.colourName)} and ${b.colourName} are near-neighbours, so it reads tonal and easy.`;
    else if (gap < 48)
      opener = `${cap(a.colourName)} and ${b.colourName} sit close together — soft, and it holds.`;
    else if (gap > 105)
      opener = `${cap(a.colourName)} and ${b.colourName} are a wide interval; there's tension, but the good kind.`;
    else
      opener = `${cap(a.colourName)} and ${b.colourName} are awkwardly spaced — close enough to look unintended rather than chosen.`;
  }

  /* --- second sentence: the one thing to change --- */
  let advice;
  if (patterned.length > 1) {
    advice = `Two prints are competing, though — drop the ${lower(patterned[1].sub)} to something plain and the rest gets its room back.`;
  } else if (spread >= 3) {
    advice = `The dress code is stretched, from ${FORMALITY[lo.formality]} at the ${lower(lo.sub)} to ${FORMALITY[hi.formality]} at the ${lower(hi.sub)} — pick which end you mean and move the other piece toward it.`;
  } else if (coloured.length > 2) {
    advice = `Three colours is one more than this needs; swap the ${lower(coloured[2].sub)} for a neutral and it sharpens immediately.`;
  } else if (neutrals.length === pieces.length && pieces.length > 2) {
    advice = `If you want it to register, one saturated accessory is all it takes.`;
  } else if (!pieces.some((p) => (ROLE_OF[p.category] || "") === "SHOES")) {
    advice = `No shoes filed against this yet — the pair you choose will decide whether it reads casual or sharp.`;
  } else if (spread === 0) {
    advice = `Everything sits at the same register, which is safe; breaking one piece up or down is what would make it interesting.`;
  } else {
    const rarely = [...pieces].sort((a, b) => (a.worn ?? 0) - (b.worn ?? 0))[0];
    advice = (rarely.worn ?? 0) === 0
      ? `You've never worn the ${lower(rarely.sub)} — this is a reasonable day to start.`
      : `Nothing here needs fixing; the ${lower(pieces[0].sub)} is doing more work than you'd expect.`;
  }

  return `${opener} ${advice}`;
}

const ROLE_OF = {
  Topwear: "TOP", Bottomwear: "BOTTOM", "One-piece": "ONE", Ethnic: "ONE",
  Outerwear: "LAYER", Footwear: "SHOES", Bags: "CARRY", Accessories: "EXTRA",
  Jewellery: "EXTRA", Activewear: "TOP", Loungewear: "ONE", Swimwear: "ONE",
};
const cap = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s = "") => s.toLowerCase();
