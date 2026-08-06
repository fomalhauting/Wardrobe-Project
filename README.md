# Archive — a wardrobe app with no API key and no server

Photograph an outfit, every piece gets cut out and filed separately, and the
app shows you what works together.

Everything runs on your phone. No key, no backend, no account, no per-photo
cost, and no photo ever leaves the device.

---

## What replaced the AI service

| Job | Before | Now |
|---|---|---|
| Find the garments | Claude vision, bounding boxes | SegFormer clothes-parsing, **pixel masks** |
| Cut them out | rectangular crop | true cut-out, transparent background |
| Category | model guess | segmentation label |
| Sub-type | model guess | CLIP, choosing within a known category |
| Colour | model guess at a hex | median-cut over the real pixels |
| Pattern | model guess | edge density + hue spread |
| Dress code, season | model guess | lookup table by garment type |
| Stylist note | generated text | written from the harmony maths |

The cut-outs are genuinely better than the hosted version — pixel masks beat
rectangles. The naming is blunter: you get "Indigo jeans" rather than "Indigo
straight-leg selvedge jeans". Every field is editable before it saves.

---

## What you need

Node.js 18 or newer. That's the whole list.

```bash
cd archive
npm install
npm run dev
```

Open http://localhost:5173. The first photo pauses to download about 80MB of
models; after that they're cached and it's fast. There's a progress bar.

---

## Put it online

Any static host works — there is no server side any more.

```bash
git init && git add . && git commit -m "Archive"
git remote add origin https://github.com/YOUR-NAME/archive.git
git push -u origin main
```

On netlify.com: **Add new site → Import an existing project → GitHub → your
repo**, accept the defaults from `netlify.toml`, deploy. Nothing to configure
and no environment variables. Vercel, Cloudflare Pages and GitHub Pages work
the same way.

---

## Install it on your phone

Open your new URL on the phone.

**iPhone** — must be Safari, Chrome on iOS cannot install apps.
Share → **Add to Home Screen** → Add.

**Android (Chrome)** — a blue *Install Archive on this phone* bar appears at
the bottom. If it doesn't, use the ⋮ menu → **Install app**.

You get a real icon, a fullscreen app, and your wardrobe stored on the device.
Once the models are cached it works with no connection at all, including
adding new pieces.

---

## Where things live

```
index.html                  install meta tags for iOS and Android
public/manifest.webmanifest name, icons, colours, home-screen shortcuts
public/sw.js                service worker — offline + installability
public/icons/               app icons, swap for your own
src/App.jsx                 the whole interface
src/vision.js               segmentation + classification, on device
src/palette.js              colour and pattern from raw pixels
src/stylist.js              the styling notes
src/storage.js              IndexedDB — your wardrobe, on your device
```

---

## Honest limitations

**First run is a real download.** Around 80MB before the first photo can be
read. It happens once, in the background, starting at launch. On a slow
connection it is a genuine wait, and there is no way around it — that download
is the thing standing in for the API.

**Older phones will feel it.** With WebGPU (Chrome, Safari 18+) a photo takes
two or three seconds. Falling back to WebAssembly on an older device, expect
ten to twenty. Anything below roughly 3GB of RAM may run out of memory; the
app catches the failure so you can enter the piece by hand.

**The segmenter was trained on worn clothing.** Photos of a person wearing the
outfit work best. Flat-lays on a bed work reasonably. A folded pile does not —
it was never trained on that.

**It sees a fixed set of garments.** Tops, bottoms, dresses, shoes, bags,
hats, belts, scarves, sunglasses. Jewellery and watches are too small for it
to catch reliably, so add those by hand.

**Verify the model IDs on first install.** `src/vision.js` pulls
`Xenova/segformer_b2_clothes` and `Xenova/clip-vit-base-patch32` from the
Hugging Face CDN. If either has been renamed or removed, the browser console
will say so — search Hugging Face for a current ONNX conversion and change the
two constants at the top of that file. For anything you intend to ship,
download the ONNX files and serve them from your own domain rather than
depending on someone else's CDN staying put.

---

## If you'd rather have both

The two approaches aren't exclusive. A sensible setup is on-device by default,
with an optional "better names" toggle in settings that a user can switch on
with their own API key. Nobody pays unless they choose to, and you never carry
the cost of other people's photos — which matters a great deal if this ever
reaches an app store with real users.

---

## Onto the app stores

This same code moves over with Capacitor:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/camera
npx cap init Archive com.yourname.archive --web-dir=dist
npm run build && npx cap add android && npx cap open android
```

Swap the file input in `AddScreen` for `@capacitor/camera` to get the native
camera and photo picker. Everything else works unchanged.

Store costs: Google Play $25 once, Apple $99 a year, and Apple requires a Mac.

Both stores ask for a privacy policy because the app uses the camera. Yours is
unusually short: photos are processed on the device and never transmitted.

**After any deploy, bump `archive-v1` to `archive-v2` in `public/sw.js`.**
Otherwise phones that already installed the app keep serving the cached old
version and it looks like the deploy failed.
