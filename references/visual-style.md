# Visual style — the "case file" look

## What makes it work

- **Two backgrounds only.** `paper`: warm off-white notebook (faint ruled lines, centre fold,
  binder holes, grain, vignette). `dark`: charcoal film with a sprocket strip. Paper explains; dark
  is for tension, horror, reveals and the end card. Alternate them to create rhythm (≈ 60/40).
- **Meta row** like a lab report: section label left, `FIG. N` right, brand tag in red. It makes a
  reel feel like evidence, not entertainment.
- **Headline** top-left, condensed heavy caps (Anton). Line 1 ink, line 2 red punch word.
- **One hero object per scene**, centred, floating with a soft ground shadow. Never more than
  3 things competing (hero + one chip/stamp + headline).
- **Red is a signal, not decoration**: punch words, blood, danger, stamps, the pencil. Everything
  else is ink, cream, skin tones, x-ray blue.
- **Props that feel handled**: tape labels, rubber stamps, a red pencil that strikes and ticks,
  index cards, terminal input boxes, rulers, magnifier callouts, newspaper clips.
- **Motion**: something moves in the first 0.3 s of every scene; the payoff lands on a spoken
  word; objects breathe (float) instead of sitting still; impacts get a stamp + thud + shake.
- **Cuts every 2–4 s**. Hard cuts; continuity comes from the shared background and recurring objects
  (same brain/arm/mosquito across scenes, same notepad being edited).

## Drawing objects (SVG, no API needed)

**1. Check the library first.** `assets/art/` has ready, shaded pieces. Use them with
`"svg_file": "@lib/<name>.svg"`: arm (reaching), brain, dna, eye, glass (of water), heart,
magnifier, neuron, skull, syringe, virus. Reuse beats redraw. When you draw something new and good,
save it to the library too.

**2. Draw in layers.** This is what separates an "engraving" from clip art (see `assets/art/brain.svg`):

1. **Silhouette** as one path, then put it in a `<clipPath>`, so everything below stays inside it.
2. **Base volume**: fill a rect with a kit gradient (`url(#kit-flesh)`, `kit-skin`, `kit-bone`,
   `kit-organ`, `kit-metal`, `kit-glass`, `kit-water`, `kit-wood`, `kit-leaf`, `kit-cloth`, `kit-blood`).
3. **Shadow side**: a large ellipse offset to the lower right, filled with `url(#kit-hatch)`; add
   a second with `url(#kit-hatch-r)` for cross-hatching in the deepest shadow.
4. **Highlight**: a soft white ellipse (opacity .3–.4) upper left. Light always comes from the upper left.
5. **Detail strokes**: folds, veins, seams and creases in a darker tint of the base colour, with
   `class="draw"` so they draw themselves on.
6. **Ink outline last**: the silhouette path again, `fill="none" stroke="#2b2420"` at 5–6 px,
   `filter="url(#kit-rough)"` for a subtle hand-drawn wobble. Inner lines go thinner (2–4 px).
7. Glows: `url(#kit-glow-red|blue|warm)` on a circle behind the object.

**Art kit** (always available in reels, no `<defs>` needed): patterns `kit-hatch`, `kit-hatch-r`,
`kit-hatch-fine`, `kit-hatch-dense`, `kit-cross`, `kit-stipple`, `kit-hatch-light` (for dark
scenes), `kit-hatch-red`; the gradients listed above; filters `kit-rough`, `kit-shadow`, `kit-glow`.

**3. Review before using.** Always render new art on its own first:

```bash
node scripts/art-preview.mjs <project>/art --dark --sketch
```

Read the sheet. Check that the silhouette reads at thumbnail size, that there's a clear light side
and shadow side, that nothing breaks the outline, and that the drawing works on dark too (else
use `kit-hatch-light` or light strokes). Fix and re-run until it's clean. Only then put it in scenes.

**Rules**: `viewBox` cropped tight to the object; no text inside art; red only for blood, danger or
emphasis; dark-theme art needs light outlines; complex objects are built from simple primitives
(ellipses + béziers); silhouettes are fine for people and animals, while anatomy reads best as cutaways.
For geometric or repeating art (helixes, spikes, grids, cell clusters), write a small script that
generates the SVG instead of hand-placing coordinates.

**Entrances for art**: `"enter": "sketch"` draws the whole illustration in by hand (outline, then
colour), which works great for the first appearance of a key object. `spring`/`swing` suit small props,
`slideL`/`slideR` suit reaching arms and incoming objects, and `zoom` suits reveals.

## AI illustrations (Cloudflare free; Gemini paid)

When an image provider is set up (settings page → **Images**), the best-looking option for hero
objects is a generated illustration. Ask for it in `reel.json`, and keep an SVG as the fallback:

```json
{ "type": "art", "image_prompt": "human heart, anatomical, front view", "svg_file": "@lib/heart.svg", "w": 780 }
{ "theme": "photo", "bg_prompt": "a mosquito on a bedroom wall at night, lamp glow" }
```

Then generate (once; the images are saved in `<project>/art/gen/`) and review:

```bash
node scripts/imagegen.mjs <project>
node scripts/art-preview.mjs <project>/art/gen
```

- **Styles** (`image_style`, or default from settings): `engraving` (default on paper),
  `engraving-dark` (automatic on dark scenes), `diagram`, `photo`, `photo-dark`, `xray` (dark),
  `cinematic` (photo-scene backgrounds). The style adds the look and background to your prompt, so
  `image_prompt` should only describe **the subject**: what it is, its view or pose, and a key detail.
- **Backgrounds vanish automatically**: light styles get their background cut out to a transparent
  PNG (and blend with `multiply`), and dark styles sit on pure black (and blend with `screen`).
- **Consistency across scenes**: generate the object once, then for its variants set
  `"image_ref": "art/gen/<that file>.png"` with the change in the prompt ("same heart, now with
  the left ventricle glowing red"). Refs go to Cloudflare FLUX.2 [klein] (free), or Gemini if that fails.
- **Same person across scenes**: define them once in `reel.characters` with a `look` and tag each object
  with `"character"` (see reel-json.md → Characters). The first image becomes the reference for the rest.
  Keep the `look` specific and visual (hair colour and shape, glasses, one clothing colour + pattern):
  those survive best. Review the set side by side and re-roll (`image_seed`) the odd one out.
- **Hand-drawn fallback is automatic** — a reel never breaks over images. Chain: generated image →
  the object's `svg_file` → a library drawing matched by keyword in the prompt (heart, brain, neuron,
  eye, skull, dna, virus, syringe, glass/water, magnifier, arm/hand) → nothing (warned). This covers no
  key, provider down, quota used up, AI turned off, a deleted file, and a corrupt file that fails to load.
  Still give every hero object an explicit `svg_file` when no library match fits.
- **Re-roll** a bad result: change `image_seed` (any number) and run `imagegen.mjs` again; `--force`
  regenerates everything. When reviewing, look for **stray text** (FLUX sometimes adds fake captions or dates
  despite the prompt), extra limbs, and cropped subjects, and re-roll those.
- Every image is saved as an original (`*.orig.*`) plus the PNG the reel uses: background cut out and
  **trimmed to the subject**, so `w` sets the subject's real size. `imagegen.mjs <project> --reprocess`
  redoes the cut-out and trim from the originals without new API calls.
- **Providers**: Cloudflare FLUX schnell (about 170 free images a day, fast, the default) and Google Gemini
  "Nano Banana" (**needs billing**: image models have no free quota as of late 2026; better at following
  detailed instructions and edits). Reference images (`image_ref`, `character`) use Cloudflare
  FLUX.2 [klein] (`images.cloudflare_ref_model`), which is on the free tier too.
  If one fails, the other is tried, and if both fail the `svg_file` fallback is used.
- `"enter": "sketch"` needs SVG strokes, so generated images use `blur` (a "develop" effect) instead.
- **Don't** put text in images, ask for a whole scene in one image, or show real people's faces.
  One object per image, composed in the reel with overlays.

Supplied images work the same way: `"image": "art/my-photo.png"` with `"blend": "multiply"` (white
background) or `"screen"` (black background).

## Colour tokens

`--paper #ECE8DF` · `--ink #1B1A18` · `--accent #C8302A` (brand.accent) · `--dark #1C1B19` ·
`--dark-ink #EFEAE0` · highlighter `#F4D33A`. Change the accent per brand; keep everything else.
