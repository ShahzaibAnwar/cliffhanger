# reel.json reference

Canvas is **1080 × 1920** by default (x, y below are in these pixels; `x,y` = the element's centre).
Safe area: keep important things between y = 180 and y = 1770; headline zone is y ≈ 196–460.

**16:9 (long YouTube videos):** `"format": { "width": 1920, "height": 1080 }` (any size works). Wide videos
use the **split layout** by default: the headline sits in the left column, art defaults to the right
(x ≈ 1380, y ≈ 560), and chips, captions, big numbers and ransom words default to the left column
(x ≈ 480). `"layout": "center"` keeps everything centred instead. `headline_style: "center"` makes
full-width chapter cards. The safe-zone check watches the YouTube player bar instead of Reels buttons, and
the final render also writes `out/thumbnail.jpg` (1280 × 720).

16:9 recipe (used across several long videos): art slot centre x = 1380, y = 560 (`w` 560–900); chips, captions
and big numbers at x = 480, y = 620–880; left-column captions ≤ 40 characters; chapter cards dark, ~1.7 s,
`transition: "glitch"`, `headline_style: "center"`, `headline_y: 360`, `headline_size: 170`; end card `"min": 18`.
Overlays are kept inside the canvas automatically (with room for the camera push), and the stills check
reports anything that still runs off the edge.

```jsonc
{
  "title": "Why your body jerks awake",      // used for output file name (or "slug")
  "slug": "hypnic-jerk",
  "series": { "name": "Body Glitches", "part": 1, "next": "The exploding head" },
  "brand": { "name": "YOUR BRAND", "handle": "@yourhandle", "accent": "#C8302A" },
  "format": { "fps": 30 },                   // 16:9: { "width": 1920, "height": 1080, "fps": 30 }
  "layout": "split",                          // 16:9 only: split (default) | center
  "voice": {
    "provider": "auto",                       // auto | elevenlabs | edge
    "elevenlabs": { "voice_id": "nPczCjzI2devNBz1zQrb", "model_id": "eleven_multilingual_v2",
                    "stability": 0.38, "similarity_boost": 0.8, "style": 0.4, "speed": 1.05 },
    "edge": { "voice": "en-US-AndrewMultilingualNeural", "rate": "+8%" }
  },
  "audio": { "bed": "drone", "bed_volume": 0.07, "music": null, "music_volume": 0.18, "sfx": true, "lufs": -14 },
  "tail": 0.25,                               // seconds of hold after the last scene
  "css": "",                                  // optional extra CSS injected into the page
  "scenes": [ /* see below */ ]
}
```

## Scene

| key | meaning |
|---|---|
| `id` | unique id (also the VO file name) |
| `theme` | `paper` (explain) · `dark` (tension/reveal) · `photo` (full-bleed `bg_image`) |
| `section` | small mono label top-left ("THE BITE"); FIG. numbers are automatic |
| `chapter` | starts a YouTube chapter here: the final render writes `out/chapters.txt` (`0:00 Title` lines). `reel.chapter_intro` names the first one if no chapter starts at 0 (default "Intro") |
| `chrome` | `false` hides meta row + brand tag (use on end card) |
| `vo` | the spoken line. Scene length = VO length + `pad` (0.08 s) unless `duration` is set |
| `vo_tts` | optional alternate text sent to TTS (pronunciation fixes: spell out years and codes, e.g. vo "July 1969 … 1202" → vo_tts "July nineteen sixty-nine … twelve oh two"; the subtitles keep `vo`) |
| `duration`, `min`, `pad`, `lead` | timing overrides; `lead` delays the VO inside the scene |
| `headline` | `["LINE ONE", "PUNCH LINE"]` — line 2 is red. One string = one line |
| `accent_line` | which line is red (default 1) |
| `punch_at` | when the red line appears. Default: when its first word is spoken |
| `headline_at` | force line-1 time (default: each word appears as it is spoken) |
| `headline_style` | `""` · `label` (white tape label, default on photo) · `center` |
| `headline_size`, `headline_y` | override auto-fit size / top position |
| `bg_image`, `bg_motion` | photo theme background (`kenburns` / `kenout` / `drift`) |
| `visual` | the main component (below) |
| `overlays` | list of extra elements (below) |
| `cut_sfx` | `false` = no transition sound on this cut |
| `transition` | how this scene enters: `cut` · `whip` · `glitch` · `zoom` · `slide` · `page` · `flash` · `auto` (default from settings: glitch into dark, whip back to paper, cut otherwise) |
| `camera` | `push` (default slow push-in) · `pull` · `pan` · `tilt` · `drift` (handheld) · `crash` (fast punch-in that settles) · `none` |
| `headline_fx` | punch-word emphasis: `underline` · `marker` · `shake` (default from settings) |
| `film_fx` | `false` turns off dust/scratch/flicker on a dark scene |
| `sfx` | list of sound cues: `[{"at": "word:bang", "type": "boom"}, {"at": 1.2, "prompt": "glass shattering on tile", "dur": 1.5, "fallback": "impact", "vol": 0.6}]` |
| `ambience` | looped background sound for the scene: `"heartbeat"` / `"clock"` / `"buzz"` or `{"prompt": "night crickets, distant dog", "vol": 0.2, "fallback": "buzz"}` |

Top-level extras: `"animation": {...}` overrides the animation settings for the whole reel;
`"cover": {"scene": "twist", "at": 1.5}` picks the thumbnail frame saved as `out/cover.png`.

## Time specs (`at`, `punch_at`, `reveal_at`, `strike_at`, `until` …)

Relative to scene start: `1.2` · `"40%"` · `"vo:0.42"` (42% through the spoken line) · `"word:fall"` (when that word is spoken — prefix match,
case/punctuation-insensitive) · `"word:fall+0.2"` / `"word:fall-0.3"` · `"end-0.5"` · `"start"`.
Add `"until": <time>` to any visual/overlay to fade it out.

## Common object keys

`x`, `y`, `w` (width px), `rot` (deg), `at`, `dur` (entrance length), `enter`, `until`, `z`.
`enter`: `fadeUp` (default) · `fade` · `fadeDown` · `pop` · `spring` · `swing` · `slam` · `zoom` ·
`blur` · `wipe` · `wipeDown` · `slideL` · `slideR` · `slideUp` (slides get motion blur) · `drop` ·
`sketch` (SVG art only: outlines draw themselves on, then colour/hatching fade in; `sketch_dur`) · `none`.
Any object/overlay can carry `"sfx": "impact"` or `"sfx": {"prompt": "...", "fallback": "pop"}`.

## Visual components (`visual.type`)

**art** — an illustration. `svg_file` (`"@lib/heart.svg"` uses the shared library in
`assets/art/`) | `svg` (inline string) | `image` (png/jpg path) | **`image_prompt`** (AI-generated
by `imagegen.mjs`; keep an `svg_file` as fallback). AI keys: `image_style`, `image_seed`,
`image_ref` (reference image for a consistent variant), `character` (a name from `reel.characters`),
`finish` (`collage`: grayscale halftone cut-out with a paper edge), `backing` (`block` · `disc` · `torn` · `none`,
a paint shape behind the art; `backing_color`, `backing_rot`, `backing_scale`), `halftone` (false to skip the dots),
`image_provider` (`cloudflare`/`gemini`),
`feather` (soft oval edge). Photo scenes: `bg_prompt`, `bg_style`, `bg_seed`.
Keys: `x`(540) `y`(1180) `w`(820) `motion`: `float`(default) · `hover` (insects) · `kenburns` ·
`kenout` · `drift` (`dx`,`dy`) · `pulse` · `spin` · `shiver` · `none`. `shadow` (ground shadow, default
true). `blend`: `multiply` (white-background PNGs on paper) / `screen` (black-background PNGs on dark).
`mystery: true` + `reveal_at` → pixelated until revealed. SVG paths with `class="draw"` draw on
(`draw_dur`, `draw_stagger`).

**stat** — giant counting number. `value` ("7,00,000" Indian grouping kept, "70%", "~1 CRORE"),
`label`, `y`(640), `count` (false = no count-up), `count_dur`, `color`, optional `art` {…, mystery}.

**bars** — comparison bars. `rows: [{label, value, display, svg_file|image, mystery}]`, `y`, `max`, `stagger`.

**notepad** — lined paper with a red pencil that writes. `x` (centre; default: art slot on 16:9), `y`, `w`, `title`, `rot`, `min_rows`(4),
`pencil` (false hides). `lines: [{ text, at, write_dur, box, mark: "check"|"x", mark_at,
strike, strike_at, replace, replace_at, highlight, highlight_at, circle, circle_at }]` (plain strings work too).
Myth-bust pattern: scene A writes the myth; scene B repeats the pad with `"enter":"none","at":0`,
the line pre-written (`"write_dur":0.01`), then `strike` + `replace`.

**terminal** — `> PROMPT: TEXT_` typing box. `prompt`, `text`, `y`, `w`, `progress` (0–1), `progress_dur`, `type_dur`.

**labfile** — index card. `kicker`, `title`, `rows: [[label, value, redBool]]`, `x`, `y`, `w`, `rot`.

**question** — giant red "?" (`mark` to change) with optional `art` on top.

**endcard** — `kicker` ("DECODED IN"), `title` ("PART 2"), `sub`, `brand` (defaults to brand.name;
false hides), `next` (next-episode teaser), `next_label`, `cta` ("Follow"; false hides), `y`.

**none** — headline + overlays only.

## Overlays (`overlays: [...]`)

| type | keys | notes |
|---|---|---|
| `art` | as art component (`w` default 400) | extra objects, hands, icons |
| `chip` | `text`, `style`: "" (black) · `red` · `light` | mono caption pill: "FEMALE · DRINKS BLOOD" |
| `stamp` | `text`, `size`: "" · `big`, `rot` | slams in with a thud + screen shake |
| `tag` | `text`, `kicker`, `style`: `red` | torn tape label: "DAY 06" |
| `caption` | `text` | small grey mono line |
| `big` | `text`, `size`, `style`: `red` | huge condensed word / symbol |
| `counter` | `value` ("x 4", "100x"), `size`, `count_dur` | big counting number |
| `terminal` | as terminal component + `x`,`y` | |
| `labfile` | as labfile component | |
| `progress` | `text`, `from`, `value` (0–1), `color`, `fill_at`, `fill_dur` | "BODY WATER", draining bars |
| `callout` | `x`,`y`,`r`, `text`, `tx`,`ty`, `label_at`, `color` | red ring drawn around a detail |
| `arrow` | `x1,y1,x2,y2`, `dashed`, `color`, `stroke` | hand-drawn red arrow |
| `ecg` | `x`,`y`,`w`,`beats` | heartbeat line drawing itself |
| `path` | `d` (SVG path in canvas coords), `dashed` | any drawn line (trails, zig-zags) |
| `flash` | `max` (0–1), `dur` | white flash on an impact word |

Any overlay can take `sfx` ("thud", "swish", "pop", "riser", "typing", "scratch") and `sfx_vol`.

## Layout recipes

- Headline + one hero object: art `y` 1100–1200, `w` 700–900.
- Object + card: art at x 330, labfile at x 700 y 1450.
- Two objects reaching (hands, arms): two `art` overlays with `slideL` / `slideR`.
- Data beat: `stat` at y 640 + mystery art at y 1300, or `bars`.
- Dark reveal: `question` or `art` + `stamp` + `flash` on the reveal word.


## Beats: several visuals for one long line

```json
{ "id": "rare", "vo": "About eight percent of people have had it. Students? Nearly one in three.",
  "visual": { "type": "stat", "value": "~8%", "label": "of people" },
  "beats": [ { "at": "word:students", "visual": { "type": "stat", "value": "28%", "label": "of students" },
               "overlays": [ ... ], "headline": ["optional", "NEW HEADLINE"], "transition": "cut" } ] }
```
The voice plays once; at each beat the visual (and overlays) switch. Without its own `headline` a beat
keeps the current one on screen.

## More components

**newspaper**: `masthead`, `date`, `issue`, `headline`, `lines` (per column), `highlight` (line indexes
turned red), `highlight_at`, `x`, `y`, `w`, `rot`.

**compare**: `left` / `right` = `{svg_file|image|image_prompt, label, value, w, at}`, `vs`, `winner`
(`left`/`right` gets a red underline at `winner_at`), `y`.

**timeline**: `items: [{year, text, at}]`, `x`, `y`, `gap`, `stagger`.

Overlay **lens**: zoom callout on the scene's main `art`: `fx`, `fy` (0–1 point in the art), `x`, `y`
(lens centre), `r`, `zoom`, `text`, `at`. Read `fx`/`fy` off `node scripts/grid.mjs <image>` instead of guessing.
Overlay **ransom**: a ransom-note word, letters cut from different papers and stuck down one per frame:
`text` (≤ 10 characters reads best), `at`, `x`, `y`, `size` (130), `align` (`center`/`left`).
Overlay **pins**: `items: [{x, y, label, at}]`, for maps
(use an `image_prompt` like "vintage engraved world map" as the visual).

## Images shared across scenes

`"image_key": "brain"` on several objects → one generated picture used in all of them (on paper and
dark). The first object with the key and an `image_prompt` defines it.

## Characters: the same person in every scene

```json
"characters": {
  "sleeper": { "look": "young woman, short curly red hair, round glasses, mustard-yellow striped pyjamas" }
}
```

Put `"character": "sleeper"` on every art object that shows her and describe only the pose or action in
`image_prompt` ("sitting up in bed, startled, hand on chest"). The `look` is added to each prompt, and the
first generated image of the character becomes the reference image for all later ones, so face, hair and
clothes carry over. `"ref": "none"` turns the reference off; `"ref": "art/me.png"` uses your own picture
as the reference instead. Use `image_key` (above) when you want the identical picture, and `character`
when you want the same person in a new pose.

## Collage look

`"animation": { "look": "collage" }` (or settings → animation) sets `finish: "collage"` on every art object,
`stop_motion: 2` (poses held for 2 frames, like paper animated by hand; grain still moves every frame) and
scribble wipes when the theme changes. Per scene: `"stop_motion": 0` to turn it off, `"transition": "scribble"`
for a marker-scribble wipe anywhere (`transition_color` sets its colour; default paint yellow).

## Reel-level extras

- `"subtitles": { "burn": true, "style": "word"|"line"|"tape", "y": 1500, "size": 60, "max_words": 4, "lang": "auto"|"vo" }`
- `"cover": { "scene": "builds", "text": ["SOMEONE'S", "IN THE ROOM"], "size": 150, "theme": "dark", "keep_overlays": false }`
- `"hook_variants": [ { "id": "b", "vo": "...", "headline": [...], "visual": {...} } ]` → `variants.mjs`
- `"audio": { "bed": "drone|tension|mystery|pulse|calm|none", "ai_music": false, "music_prompt": "..." }`
