---
name: cliffhanger
description: End-to-end faceless explainer video studio for reels AND long YouTube videos. Finds viral "why/how" ideas, researches facts, writes suspense-and-curiosity scripts with open loops and Part-2 cliffhangers, generates voiceover (ElevenLabs, or free Edge neural voices) with a pacing pass, renders animated videos on the GPU (9:16 reels/Shorts/TikToks, or 16:9 long YouTube videos with chapters and thumbnails) in a "case file" style (notebook paper, bold two-tone headlines, stamps, pencil strikes, terminals, x-rays, counters) or a paper-collage cut-out style, with free AI illustrations and consistent characters, and writes platform-ready captions for Instagram, TikTok, YouTube, Facebook, X, LinkedIn and Threads. Use when the user wants reel/short/TikTok ideas, a reel or video script or story, a voiceover, an animated explainer reel or long-form YouTube explainer, a faceless video series, YouTube chapters, or social captions for a rendered video. Works in any language (English, Hindi/Hinglish, Urdu, ...).
---

# Cliffhanger — curiosity reel studio

One skill, whole pipeline: **idea → research → story → script → voiceover → animated reel → captions**.
The style is decoded from top-performing faceless science/explainer reels: a "case file" look
(notebook paper or dark film, a two-line condensed headline whose second line is the red punch word,
FIG. numbering, stamps, red pencil, terminal prompts), a voice that talks *to* the viewer, a new
visual every 2.5–4 seconds, and an ending that opens a bigger question than the one it answered.
The rules behind this (with sources) are in `references/engagement.md`; the stills run scores every
video against them.

`SKILL_DIR` below means the folder that contains this file.

## 0. Setup check (first run only)

Run the setup check and fix whatever it flags (it prints the install command for this OS):

```bash
cd "$SKILL_DIR/scripts" && npm install        # first time: installs playwright-core (uses your installed Chrome/Edge)
node "$SKILL_DIR/scripts/doctor.mjs"          # node, ffmpeg/ffprobe, python + edge-tts, browser, which keys are set
```

`python` below means whichever Python 3 the doctor reported (`python3` on macOS/Linux, `python` or `py`
on Windows). The doctor only says whether a key is set, never its value.

Voice provider: if `ELEVENLABS_API_KEY` is set (settings page, env var, or a `.env` file) the
skill uses ElevenLabs; otherwise free Microsoft Edge neural voices. Never ask the user to paste a key
into chat — point them to the settings page (it writes the git-ignored `.env`). Never commit `.env`.

## 0.5 Settings (every run)

Read the user's defaults: `node "$SKILL_DIR/scripts/settings.mjs" show` (never prints the key).
Use them unless the user says otherwise in this request: `brand` (name/handle/accent → `reel.brand`),
`content` (VO language, headline language, target length, niche, series name/promise, end CTA),
`audio`, `captions` (platforms, always-hashtags, emoji level). Details: `references/settings.md`.

- First run, or the user asks to change settings → open the settings page:
  `node "$SKILL_DIR/scripts/settings.mjs"` (run it in the background; it prints a local link and
  opens the browser). Tell them to press **Save**, then continue.
- User gives ElevenLabs voice IDs or links in chat → save each one:
  `node "$SKILL_DIR/scripts/settings.mjs" add-voice <id-or-link> --name "<name>" [--lang <lang>] [--default]`
  (ask for a short name if they didn't give one; IDs are fine as names until then).
- Quick change from chat: `node "$SKILL_DIR/scripts/settings.mjs" set brand.name "CURIO FILES"`.
- New projects go in `output.projects_dir` (one folder per reel, e.g. `<projects_dir>/<slug>`).

## 0.6 Series memory (every new episode)

`node "$SKILL_DIR/scripts/series.mjs" show` reads `<projects_dir>/series.json` (rebuilt automatically after
every final render). It lists the parts made per language, the voice per language, recurring art, and
**what the next episode must pay off**. A new part must: open with a callback to the previous
cliffhanger, keep the brand and per-language voices, reuse recurring art, and set `series.part`/`next`.

## 0.7 Pick the style: show, don't tell (new video or series, or "change the style")

**Auto mode** (`style.auto` is on in settings; `node "$SKILL_DIR/scripts/style.mjs" show`): don't ask. Run
`node "$SKILL_DIR/scripts/style.mjs" pick "<topic>" [--wide]`, put the result in reel.json (`look`, `subtitles.style`,
`audio.music_mood`; or just `"look": "auto"` plus a `"topic"` and the renderer does it) and state it in one line
("Style: newsprint · pop captions · mystery music: history/real event"). Ask only when it reports a tie or no match.
The user can override any single choice; `style.mjs unlock` returns to asking. Offer to lock it once the user has
seen the gallery and says "just pick it yourself". **If they run more than one channel, lock per channel:**
`style.mjs lock --workspace <channel folder>` (writes `<folder>/style.json`); a global `style.mjs lock` also
restyles other channels whose reels don't set a look. A single reel can always use `"look": "auto"` + `"topic"`.

Otherwise the user chooses the look by seeing it. If `"$SKILL_DIR/gallery/overview.jpg"` doesn't exist (or the skill was
updated), build it once: `node "$SKILL_DIR/scripts/gallery.mjs"` (~4 min, offline; `--page` rebuilds the page only).
1. Read `gallery/overview.jpg` (it appears in the chat: looks on paper and dark scenes, caption styles, picture
   finishes), and give the link to `gallery/index.html` (one self-contained page with every option, a short
   description, best uses, the exact setting, and caption clips that play).
2. In writing, recommend 2–3 looks that suit the topic (the gallery's "best for": chalkboard for teaching,
   blueprint for tech, VHS for mysteries, newsprint for history, comic for light topics, collage for real photos,
   case file as the default), plus a caption style and a music mood.
3. Ask with AskUserQuestion: look, captions, music mood (recommended option first). Save the choice in reel.json
   (`look`, `subtitles.style`, `audio.music_mood`); offer to make it the series default (settings `animation.look`,
   `subtitles`, `audio.music_mood`).
4. When the user asks to change a style later, show the gallery again, apply, and re-run `--stills` so they see it
   on their own video before the final render.

## 1. Ideas (when the user has no topic, or asks for ideas)

**Read `learnings.md` first** if the workspace has one (`node "$SKILL_DIR/scripts/analytics.mjs" report` builds it):
it says which hooks, looks, lengths and scene types hold *this* audience. Lean ideas and scripts toward what works
there, and say so when you do.

Read `references/story-engine.md` → "Idea engine". Produce an **idea slate** of 8–10 ideas in a table:
title · hook line (first 2 s, spoken) · the twist · the Part-2 cliffhanger · score /25
(relatability, stakes/shock, visual-ability, series potential, fact-checkability).
Save it as `<project>/ideas.md`. Recommend the top pick and ask the user to choose
(skip the question if they already gave a topic).

## 2. Research (always — these reels live or die on being true)

Search the web for the mechanism, 2–3 hard numbers, one named study/experiment/year, and the
common myth. Write `<project>/facts.md`: each claim + source URL + confidence. Prefer
"commonly cited estimate", "one theory" wording when evidence is soft. Health topics: include one
safety line (e.g. "Bitten? Get the vaccine at once.") and never give treatment advice beyond that.

## 3. Story and script

Follow `references/story-engine.md` → "Beat map" and "Script rules". Write `<project>/script.md` as a
table: `# · VO line · on-screen headline (line1 / PUNCH) · visual idea · curiosity device`.
Then run the **scorecard** in that file and rewrite until it passes (hook ≤ 2 s, an open loop
every ~10 s, one visual idea per line, a cliffhanger that is bigger than the opening question).
Show the script to the user before building unless they asked for a one-shot run.

Language: VO in the user's language/register (Hinglish, Urdu, English...). On-screen headlines are
short English caps by default (as in the source reels) unless the user prefers otherwise.

## 4. Build `reel.json` + art

Create the project folder: `reel.json`, `art/`. Schema and every component are in
`references/reel-json.md` — read it before writing JSON. Start from
`SKILL_DIR/examples/hypnic-jerk/reel.json` (a complete, tested reel).

- One scene per VO line (2–5 s). Alternate `paper` (explaining) and `dark` (tension, reveals, horror).
  A line longer than ~5 s gets `beats` (a second visual mid-line, see reel-json.md).
- Scene types beyond art: stat, bars, notepad, terminal, labfile, question, **newspaper**, **compare**,
  **timeline**; overlays include **lens** (zoom callout on the main art) and **pins** (map markers).
- Same object in several scenes → give each the same `"image_key"`, so it's one picture everywhere.
- Every scene needs motion within 0.3 s and a payoff synced to a spoken word (`"at": "word:fall"`).
- AI illustrations first, when available: run `node "$SKILL_DIR/scripts/imagegen.mjs" --check`. If
  it says `available`, give hero objects an `image_prompt` (subject only, since the style adds the look) **plus** an `svg_file`
  fallback. Run `node "$SKILL_DIR/scripts/imagegen.mjs" <project>` **before the first stills pass** (stills
  don't generate images; un-generated ones show their hand-drawn fallback and are listed loudly at the end of
  the render output and in its JSON as `ai_images_missing`), then review with
  `art-preview.mjs <project>/art/gen` and re-roll weak ones (`image_seed`). A person who appears in
  several scenes goes in `reel.characters` (with a `look`), and each object showing them gets
  `"character": "<name>"`, so it's the same face and clothes every time. Use `image_ref` to keep one
  object consistent across scenes. See `references/visual-style.md` → "AI illustrations".
- Art: follow `references/visual-style.md` → "Drawing objects". First reuse the library
  (`"svg_file": "@lib/heart.svg"`; list it with `ls "$SKILL_DIR/assets/art"`). Draw new objects in
  layers (silhouette clip → kit gradient → hatched shadow side → highlight → `class="draw"` details →
  rough ink outline). If the user supplies images or an image tool is available, use PNG cutouts.
- **Art review (required for new drawings):**
  `node "$SKILL_DIR/scripts/art-preview.mjs" <project>/art --dark --sketch`, then Read the sheet and
  fix weak drawings before building scenes. Save strong new pieces to `assets/art/` for reuse.
  AI images are auto-checked: boxes, frames, uncut backgrounds and missing subjects are re-rolled
  automatically (`images.max_rerolls`); stray captions are removed. Still review the sheet.
- Motion: settings give every reel transitions (auto glitch/whip on theme changes), a slow camera
  push, and film dust on dark scenes. Per scene, pick a stronger `camera` (`crash` on shocks,
  `drift` on fear beats), `"enter": "sketch"` for a key object's first appearance, and
  `headline_fx` for the 2–3 biggest punch words. Don't use every effect in every scene.
- **Collage look** (paper cut-out explainer, optional): `"animation": { "look": "collage" }` turns art into
  grayscale halftone cut-outs with a paper edge on a torn paint block (`backing`: `block` · `disc` · `torn`),
  animates on twos (stop-motion, pieces "boil" a little) and uses a marker-scribble wipe on theme changes.
  Pair it with `image_style: "archival"` (black-and-white documentary photos that cut out cleanly) and one
  `ransom` overlay on the payoff word. See `references/visual-style.md` → "Collage look".
- **Real photos (free licences):** for real things, places, artefacts and historical people, give the
  object `"photo_query": "apollo 11 lunar module"` (plus an `svg_file` fallback) and run
  `node "$SKILL_DIR/scripts/photos.mjs" project <project>`. It searches Openverse (Wikimedia, Flickr CC,
  museums), NASA and the Art Institute of Chicago, keeps only CC0 / public domain / CC BY, and writes the
  credits (`out/credits.txt` after the render; put CC BY credits in the captions). Plain-background photos
  become paper cut-outs (`finish: "collage"`), busy ones a taped photo print (`"print"`); `"torn"` gives
  torn edges. Preview choices with `photos.mjs search "<words>"` and pin the one you want with its
  `"photo_id"` (exact; `"photo_pick": N` also works but depends on the sources' current ranking).
  **Look at every fetched photo** (`node "$SKILL_DIR/scripts/art-preview.mjs" <project>/art/photos`) before
  using it: reject off-topic, low-quality or distressing ones (a dead animal for a "meet this animal" beat)
  and keep the drawing instead.
  If downloading isn't possible, `photos.mjs guide <project>` prints search links and the exact file
  name to save in `art/inbox/`; then `node "$SKILL_DIR/scripts/inbox.mjs" <project>` imports them.
  Never use photos of identifiable living private people, logos, or copyrighted characters (cartoon,
  film or game characters): those aren't "free" even when a site shows them.
- **Gemini, Veo or other apps without an API:** `node "$SKILL_DIR/scripts/inbox.mjs" pack <project>` writes
  `inbox-prompts.md`: each missing picture/clip with the exact prompt and the file name to save. The user
  makes them in the Gemini app (or Whisk, Flow, any tool), drops the files in `art/inbox/`, and
  `inbox.mjs <project>` imports them (pictures get the usual cut-out). Motion: an object with
  `"video_prompt": "..."` shows that clip (muted, looped, frame-exact) once it's imported; any clip can be
  used directly with `"video": "art/clips/x.mp4"`. Don't automate the Gemini website.
- **Quiz / interactive formats:** a "think" scene with no `vo`, a few seconds long, `ambience: "clock"` and a
  `countdown` overlay (ring + digits + a tick each second), then the answer scene.
- **Point at the right spot:** before placing a `lens`, `pins` or anything that points at part of an
  image, run `node "$SKILL_DIR/scripts/grid.mjs" <image>` and Read the `_grid.jpg`; take `fx`/`fy` (0–1)
  or pixel positions from it instead of guessing.

## 5. Voiceover

**Choose the voice first.** Run `python "$SKILL_DIR/scripts/voiceover.py" --list-my-voices`.
If the provider will be ElevenLabs, the list has 2+ voices and `voice.ask_each_reel` is true, ask
the user which voice to use (AskUserQuestion: one option per saved voice, label = name, description
= language · notes · ID; default voice first, marked "(Default)"; up to 4 options, mention the rest
can be typed). Write the pick into `reel.json` → `"voice": {"elevenlabs": {"voice_id": "<id>"}}`
so re-renders stay consistent. With `voice.only_my_voices` on, never use a voice that isn't in the
saved list (the script enforces it). One saved voice, or asking turned off → use the default silently.

```bash
python "$SKILL_DIR/scripts/voiceover.py" <project>            # cached; re-run after editing lines
python "$SKILL_DIR/scripts/tighten.py" <project> 1.14 0.24     # pacing: trim long pauses, speed up (pitch kept)
python "$SKILL_DIR/scripts/voiceover.py" --list-voices edge --lang hi   # browse voices
```

**Tighten the pacing (ElevenLabs especially):** raw ElevenLabs delivery is too slow for reels. `tighten.py`
shortens pauses to `keep` seconds and speeds speech up by `tempo` without changing pitch, remapping the word
timings so animation stays synced. 1.10–1.16 with 0.22–0.28 is the usual range; re-running with new numbers
starts again from the original clips (kept in `build/vo_raw/`). ElevenLabs voiceovers get `[1.14, 0.24]` automatically
when neither reel.json nor settings sets `voice.tighten`; set your own numbers there, or `false` to skip it.

Settings, voice picks per language and delivery tips: `references/voiceover.md`.
Use `vo_tts` on a scene to change pronunciation without changing the on-screen text logic.

## 6. Stills QA → fix → repeat

```bash
node "$SKILL_DIR/scripts/render.mjs" <project> --stills          # one frame per scene + build/contact.jpg
node "$SKILL_DIR/scripts/render.mjs" <project> --at 3.2,7.5      # exact moments
```

**Engagement check:** the stills run ends with a score ("Engagement check: 8/9") and a fix for each
failed rule (hook timing, short hook line, a new visual every 2.5–4 s, nothing held over 5 s, length,
narration speed, keyword headlines, an ending that opens the next question). Fix every ✘ unless the
user has a reason; the rules and their sources are in `references/engagement.md`. Never promise virality.

Look at `build/contact.jpg` (Read the image). Check: headline fits and doesn't touch art, nothing
overlaps the bottom 150 px (platform UI), red is used only for punch/danger, every scene has a clear
focal object, stamps/chips aren't covering the key art. Fix JSON/SVG and re-run until clean.

Also act on the reports the stills run prints (unknown option names come with a "did you mean", art with too little
contrast against its page is flagged, and anything cut off at the frame edge is listed):
- **safe zones**: anything under the platform buttons (right edge) or caption area (bottom ~260 px):
  move it up/left.
- **long scenes**: over `content.max_scene_seconds` on one visual: add `beats`.

## 6.5 Sound pass

Read `references/sound-design.md`. Automatic SFX already cover cuts, stamps, flashes, typing and
writing. Add **at most one directed cue per scene** where the story has a sound-shaped moment
(`sfx: [{at: "word:gunshot", prompt: "...", fallback: "boom"}]`), an `ambience` under fear beats
(heartbeat, clock, night room), and a `riser` before the biggest reveal. Always give AI cues a
`fallback` preset. AI sounds generate only if `audio.ai_sfx` is on (they cost credits once and are
then cached), so mention it to the user when a reel would clearly benefit.

**Real sounds:** with `audio.real_sfx` on (default) the built-in effects use real CC0 recordings
(Freesound via Openverse, downloaded once into `sfx-library/` and reused by every project), with a few takes
per effect for variety. For a specific sound, add a cue `{ "find": "creaky wooden door", "at": "word:door" }`;
for your own file `{ "file": "sfx/door.wav" }`. Users can drop whole sound packs into `sfx-library/`
(file names are the search words). `node scripts/sfx.mjs find "<words>"` pre-fetches and lists a sound.

## 7. Final render

```bash
node "$SKILL_DIR/scripts/render.mjs" <project>               # 1080x1920, 30 fps, -14 LUFS
node "$SKILL_DIR/scripts/render.mjs" <project> --preview     # fast half-res check
```

Outputs in `<project>/out/`: `<slug>.mp4`, `<slug>.srt` (upload as subtitles), `cover.png`
(thumbnail, set with `reel.cover`), `contact.jpg`. Audio = voiceover + automatic and directed SFX + a
low suspense drone, ducked under the voice. `reel.audio.music` swaps the drone for a licensed track.
`--remux` re-mixes the audio without re-rendering frames (use it after sound-only changes).

**GPU first, always: dedicated GPU → integrated graphics → CPU.** Chrome draws on the high-performance
(dedicated) GPU, and the encoder is chosen by a real test encode in tier order: dedicated GPU (NVIDIA
NVENC → AMD AMF → Apple VideoToolbox) → integrated graphics (Intel Quick Sync → VAAPI on Linux → Windows
Media Foundation) → CPU libx264 last. Frames are captured by several browser tabs in parallel
(`--workers N`, default from the CPU thread count), about 2–3× faster than one tab. The first lines of
every render say what was used (`gpu: draw = … · encode = …`, `capture: N parallel tab(s)`); a
`! GPU encoder skipped →` line explains any fallback (an NVIDIA driver older than 610 can't run this
ffmpeg's NVENC: update the driver). `node scripts/doctor.mjs` shows the same. Never add `--disable-gpu`.
Settings: `render.gpu` (`auto` · `nvidia` · `amd` · `apple` · `intel` · `off`), `render.workers`. If the laptop gets
hot or loud, use `--cool` (or `render.profile: "cool"`): 3 tabs, about half the speed; the load line at the end of
each render shows where the work went. Read
`out/contact.jpg` and spot-check 2–3 frames with `--at`, including one mid-transition, before delivering.

- **Subtitles**: `subtitles.burn` (settings or reel) burns word-by-word captions in; Urdu/Hindi cuts show
  Roman text. They move up automatically when a chip sits at the bottom.
- **Cover**: the final render also writes a designed `out/cover.png` (big headline + hero art + PART tag)
  and `out/cover-grid.jpg` (the 3:4 crop the profile grid shows). Set `reel.cover.text` to the most
  clickable 2–4 words; `node render.mjs <project> --cover` remakes only the cover.
- **Music**: `audio.bed` = drone · tension · mystery · pulse · calm · none. Pick by mood (horror →
  tension, curiosity → mystery, investigation → pulse, wonder → calm).

**Re-making an existing reel (new brand, new look, changed lines):** copy the project folder, never edit the
original. Take `reel.json`, `art/` (with `art/gen/` and `art/photos/`), `credits.json`, and `build/vo`,
`build/vo_raw`, `build/timings.json`: unchanged lines then keep their voice clips, and only changed lines (and, on
ElevenLabs, the lines right after them) are voiced again. If the old reel had no burned captions, expect
"subtitle band" warnings in `--stills`: each one says how far up to move that overlay.

## 7.5 Other languages (one command)

Write `lines.<lang>.json` (per scene: `vo` in the native script, `roman` for Roman subtitles, optional
`cues` mapping English cue words to spoken words), then:
`node "$SKILL_DIR/scripts/localize.mjs" <project> --lang ur --lines lines.ur.json`
It copies visuals and AI images, picks the series' voice for that language, places every unmapped
cue at the same spot in the translated line, and writes `<project>-ur/`. Then voiceover → render.
Keep technical words in English where people say them that way.
- **Text on screen:** headlines, chips, tags and the end card stay as in the source unless `lines.<lang>.json`
  replaces them per scene: `"headline"`, `"section"`, `"visual"` (merged, e.g. the end card's `kicker`/`title`/`next`),
  `"overlays"` (by position; `false` leaves one out), and the same inside `"beats"` (by position). localize lists
  what still shows the source's words.
- **Longer lines:** translations usually run longer, so a scene may now hold one visual over 5 s. `--stills` names
  each one with a ready beat (`"at": "word:…"` near the middle); beats only add a visual, so no new voiceover.
- **Another channel:** a top-level `"reel"` block in `lines.<lang>.json` (or `--brand brand.json`, one file per
  channel) sets `brand`, `series`, `cover`, `css`, `title`… With `--out` in the other channel's folder, the voice
  comes from that folder's `series.json` (then the source's, then your default; `--voice` always wins).
- **Urdu / Arabic / Persian voice:** write every spoken line with aerab (zer, zabar, pesh) in that scene's `vo_tts`
  (`--tts tts.ur.json`: scene id → marked line), keep `vo` plain: homographs like جلد (jild "skin" / jald "soon") are
  otherwise misread, while captions and the .srt stay clean. localize checks each marked line strips back to `vo`;
  voiceover.py lists lines without aerab before voicing (`voice.require_diacritics: ["ur"]` in settings stops instead).
- **Cue words:** a cue uses its first word and the first spoken word that matches it; localize warns when that word
  appears more than once in the line (Urdu "دو" in both "دو ہزار دو" and "دوسرا"), so map it to a word said once.

## 7.55 Long videos (16:9, optional)

For a long YouTube video, set `"format": { "width": 1920, "height": 1080 }`. Same engine, same scene types;
the split layout puts headlines left and art right automatically (see reel-json.md → 16:9 recipe).
- **Chapters:** put `"chapter": "Title"` on the first scene of each section (usually its chapter card:
  `headline_style: "center"`, `headline_y: 360`, `headline_size: 170`, dark, ~1.7 s, `transition: "glitch"`).
  The final render writes `out/chapters.txt` in YouTube format (`0:00 …`), ready for the description, and warns
  about anything YouTube would reject (fewer than 3 chapters, a chapter under 10 s).
- **Pronunciation:** `vo_tts` for every year, number and code the voice would misread.
- **End card:** give the last scene `"min": 18` so it covers YouTube's end-screen window (last 5–20 s).
- **Pacing check:** the long-scene warning uses 8 s on 16:9 (5 s on vertical); set `max_scene_seconds` on the
  reel to change it.
- **40+ scenes:** write a small generator script (`build_reel.py`) so positions stay consistent.
- **Render time:** GPU + parallel tabs render 5,000+ frames in a few minutes. Keep the computer awake and
  plugged in during long renders; the progress line shows fps and an ETA and warns if the frame rate collapses
  (sleep or overheating). The cover becomes `out/thumbnail.jpg`.

## 7.57 More visuals: maps, charts, a talking mascot, real music

- **Map** (`visual.type: "map"`): world outlines are bundled (Natural Earth, public domain, offline).
  `highlight: ["PAK", "CHN"]` (ISO codes or names) fills countries, `route: [[lon, lat], ...]` draws a path with a
  travelling dot, `points: [{lon, lat, label}]` drops pins; the view fits automatically (`bounds` to force it).
- **Chart** (`visual.type: "chart"`): a line (or `kind: "bar"`) that draws itself, ending on the final value. Use
  the user's numbers: `"csv": "data/x.csv", "x_col": "year", "y_col": "users"` (or inline `data`), `title`, `unit`.
  Only real, sourced numbers (from facts.md).
- **Talking mascot** (`reel.mascot`): any character image becomes a paper puppet whose jaw moves with the voice.
  Run `grid.mjs` on the image, then `"mascot": { "image": "art/me.png", "mouth": [fx, fy], "chin": fy2 }`
  (mouth = centre of the mouth, chin = bottom of the chin, as 0–1 fractions). `mouth_style: "gap"` cuts the jaw
  out (for drawings with a closed mouth line); the default stretches the lower face (best for photos). `scenes`
  ("all" or a list), `x`, `y`, `w`. A recurring mascot is a strong series identity.
- **Real music** (`audio.music_mood`): suspense · mystery · cinematic · epic · calm · uplifting · playful · scifi ·
  ambient. A free track (CC0 / CC BY, mostly Jamendo) is downloaded once, ducked under the voice, and credited in
  `out/credits.txt` (CC BY credits must go in the description/captions).

## 7.58 Learn from the numbers (after posting)

When the user shares results, import them: `analytics.mjs retention <project> <export.csv>` (YouTube Studio's
retention export), or read the numbers off their insights screenshots (Read the image) and enter them:
`analytics.mjs point <project> 3=78 10=55 30=41` and `analytics.mjs add <project> --views … --avg … --shares …`.
`analytics.mjs show <project>` says which scenes lost viewers (the opening always loses the most: compare it with
their average); `analytics.mjs report` writes `learnings.md` for the whole workspace. Summarise what to do more or
less of, and use it for the next ideas. Don't over-read fewer than ~5 videos.

## 7.59 Batch production (several episodes, e.g. overnight)

Plan the episodes first (ideas → research → scripts → reel.json + captions.md for each, approved by the user), then
`node "$SKILL_DIR/scripts/batch.mjs" run <workspace>`: voiceover → pacing → AI images → photos → final render for
every episode, keeping the computer awake, resuming where it stopped. `batch.mjs status` shows progress; the run ends
with `<workspace>/review.html` (cover, length, engagement score, what to improve, captions, links) for approval.

## 7.6 Hook A/B variants (optional)

Add `"hook_variants": [{ "id": "b", "vo": "...", "headline": [...] }]` to reel.json and run
`node "$SKILL_DIR/scripts/variants.mjs" <project>` (add `--after-vo "<cmd> {dir}"` if the project used a
pacing tool). Only the new hook is voiced; outputs `out/<slug>-hook-b.mp4`. Suggest posting variants
as separate tests and keeping the hook with the better 3-second hold.

## 8. Social captions

Follow `references/social-captions.md` and write `<project>/out/captions.md` with a ready-to-paste
block for Instagram Reels, TikTok, YouTube Shorts (title + description), Facebook Reels, X,
LinkedIn and Threads, plus alt text and a pinned-comment line. Captions must tease, not spoil, the
Part-2 cliffhanger.

## 9. Deliver

Tell the user: video path, duration, voice provider used, captions file, and what to tweak next
(e.g. "switch to ElevenLabs for a richer voice: set ELEVENLABS_API_KEY and re-run step 5 + 7").
Offer the Part-2 script as the next episode — the series engine is the growth engine.

## Rules

- Original work only: never copy another creator's brand name, handle, catchphrases or exact
  scripts. The *style* is a genre; the brand comes from `reel.brand`.
- Facts over drama: dramatize the delivery, never the data. Mark estimates.
- Keep reels 35–75 s (sweet spot 45–60 s), 120–170 spoken words in English.
- GPU first: dedicated GPU, then integrated graphics, then the CPU as the last fallback.
- Don't publish or post anywhere; the user uploads.

---
Created by **Shahzaib Anwar** · [GitHub](https://github.com/ShahzaibAnwar) · [YouTube](https://www.youtube.com/@m.shahzaibanwar) · [LinkedIn](https://www.linkedin.com/in/shahzaibanwar) · [dareecha.pk](https://dareecha.pk) · MIT License
