# Settings

User defaults live in `settings.json` in the skill folder (git-ignored, created on first save).
Missing keys fall back to `settings.example.json`. A reel's `reel.json` overrides both, so
precedence is: **example defaults → settings.json → reel.json**.

## Ways to edit

| how | command |
|---|---|
| Settings page (browser) | `node scripts/settings.mjs` — local only (127.0.0.1, one-time token link), tabs: Voice · Brand · Content · Audio · Captions |
| Show | `node scripts/settings.mjs show` (API key shown only as set/not set) |
| Add an ElevenLabs voice | `node scripts/settings.mjs add-voice <id-or-link> --name "Deep narrator" --lang Hindi --default` |
| Remove a voice | `node scripts/settings.mjs remove-voice <id>` |
| Any value | `node scripts/settings.mjs set content.target_seconds 45` (values are JSON-parsed: `true`, `0.1`, `["a"]`) |

Voice links that work: a bare 20-character ID, `…/voice-library?voiceId=<id>`, or any
ElevenLabs URL whose last 20-character segment is the voice ID.

**Voice Library voices** must be in the account's *My Voices* before the API can speak with them.
When a key is set, adding a voice on the settings page checks it automatically. It fills in the
name and language, and for a library voice it shows **Add to My Voices**, which needs a key with the
"Voices: write" permission; otherwise click ➕ on elevenlabs.io. If a voiceover fails with
"can't use voice", this is the fix.

Models: `eleven_multilingual_v2` (default), `eleven_v4`, `eleven_v3`, `eleven_turbo_v2_5`,
`eleven_flash_v2_5`, or any custom model ID. If a model rejects request stitching or some voice
settings, `voiceover.py` retries automatically with a simpler request.

## Keys

| key | meaning |
|---|---|
| `voice.provider` | `auto` (ElevenLabs if key, else Edge) · `elevenlabs` · `edge` |
| `voice.ask_each_reel` | Claude asks which saved voice to use before each voiceover |
| `voice.only_my_voices` | refuse ElevenLabs voices that aren't in `voice.elevenlabs.voices` |
| `voice.require_diacritics` | languages whose voice lines must carry aerab, e.g. `["ur"]`: voiceover.py stops before voicing a line without zer/zabar/pesh (otherwise it only warns; `--force-bare` voices them anyway) |
| `voice.tighten` | `[tempo, keep]`, e.g. `[1.14, 0.24]`: run `tighten.py` after every voiceover (faster delivery, shorter pauses, pitch kept). Empty = `[1.14, 0.24]` on ElevenLabs, off on Edge; `false` = off. reel.json's `voice.tighten` wins |
| `voice.elevenlabs.voices` | `[{voice_id, name, language, notes}]` |
| `voice.elevenlabs.default_voice_id` | used when not asking / only one voice |
| `voice.elevenlabs.model_id, stability, similarity_boost, style, speed` | delivery defaults |
| `voice.edge.voice, rate` | free fallback voice |
| `brand.name, handle, accent` | red tag on every scene, end card, caption CTAs |
| `content.vo_language, headline_language` | e.g. "Hinglish" VO with "English" headlines |
| `content.target_seconds, niche, series_name, series_promise, end_cta` | story defaults |
| `audio.bed` (`drone`/`none`), `bed_volume`, `music`, `music_volume`, `sfx`, `lufs` | mix defaults |
| `captions.platforms, always_hashtags, emoji` (`none`/`light`/`heavy`) | captions.md defaults |
| `images.ai_label` | `true` or a text: every AI-generated picture gets a small "AI ILLUSTRATION" mark in its corner (reel.json `"ai_label"` overrides; off by default) |
| `images.provider` | `auto` (Cloudflare first, Gemini second) · `cloudflare` · `gemini` · `off` |
| `images.style` | default look: `auto` (engraving; engraving-dark on dark scenes) · `engraving` · `diagram` · `photo` · `xray` |
| `images.cloudflare_model, cloudflare_steps, gemini_model, feather` | provider models (FLUX schnell, up to 8 steps; Gemini 2.5 Flash Image) and soft-edge option |
| `images.cloudflare_ref_model` | model used when there is a reference image (`character`, `image_ref`): `@cf/black-forest-labs/flux-2-klein-4b` (default) or `flux-2-klein-9b` |
| `audio.ai_sfx, sfx_volume` | AI sound effects on/off, effects level |
| `animation.transition, camera, film_fx, sketch_art, headline_fx` | motion defaults |
| `output.projects_dir` | where new reel project folders go; also where `series.json` lives |
| `subtitles.burn, style, lang, y, size, max_words` | burned-in subtitles; style `word` · `karaoke` · `pop` · `box` · `tape` · `line` |
| `style.auto, style.map` | automatic style per video: `auto: true` picks look + caption style + music mood from the topic using `map` (`[{look, keywords, captions: {vertical, wide}, music_mood}]`; built-in default shown by `node scripts/style.mjs show`). captions picked by auto style are burned in (set `captions.burn: false` in a map entry, or `subtitles.burn: false` in a reel, to keep them off). `style.mjs lock` / `unlock` switch it for every channel; `--workspace <dir>` writes `<dir>/style.json` so only that channel's reels are affected |
| `animation.look` | default look (`auto` = pick per topic): `case-file` · `collage` · `chalkboard` · `blueprint` · `comic` · `vhs` · `newsprint` (see `gallery/index.html`) |
| `audio.music_mood` | free real music by mood: `suspense` · `mystery` · `cinematic` · `epic` · `calm` · `uplifting` · `playful` · `scifi` · `ambient` (empty = synthesized bed). A track used by one of the last 5 reels in the same workspace folder is skipped while another exists (`audio.music_avoid_recent`: how many reels back, 0 = off); a re-render keeps its own track. `audio.music_avoid`: genres, title words or file names to skip (`["rock", "guitar", "playful-32bf544e2a.mp3"]`; genre tags are often vague, so name a track you've heard and didn't like). `--stills` prints the track this reel will get (title, creator, genres, file) |
| `content.max_scene_seconds` | stills check warns above this (add beats). 16:9 uses at least 8; `reel.max_scene_seconds` overrides per reel |
| `images.max_rerolls` | automatic AI image re-rolls when the quality check fails |
| `audio.bed, ai_music, music_prompt` | background mood / AI music |
| `audio.real_sfx` | `true` (default): built-in effects use real CC0 recordings from the shared `sfx-library/` (downloaded once); `false` = synthesized only |
| `render.gpu` | **GPU first** (default `auto`): browser draws on the dedicated graphics card; the encoder goes dedicated GPU (NVIDIA NVENC → AMD AMF → Apple VideoToolbox) → integrated graphics (Intel Quick Sync → VAAPI → Windows Media Foundation) → CPU libx264 last. Force one with `nvidia` / `amd` / `apple` / `intel`, or `off` for CPU only. Env `CLIFFHANGER_GPU` overrides |
| `render.profile` | `cool`: 3 capture tabs (quieter, cooler laptop; about half the speed). `--cool` does the same for one render. Every render ends with a load line (CPU %, GPU %, encoder %, max GPU °C) |
| `render.workers` | parallel capture tabs (default: CPU threads ÷ 3, 2–8). `--workers N` per render |
| `render.browsers` | spread the tabs over this many browser processes (default 1; more is slightly faster and uses much more memory). Env `CLIFFHANGER_BROWSERS` |
| `animation.look` | `collage`: cut-out finish + stop-motion on twos + scribble wipes on theme changes |
| `animation.finish, stop_motion, backing, backing_color, transition_color` | the collage parts one by one (`finish: "collage"`, `stop_motion: 2`, `backing: "block"/"disc"/"torn"`) |

Image keys (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`) are also stored in `.env`
through the settings page → **Images**, which also has a "Try it" button that generates a test image.

The ElevenLabs key is not stored in settings.json. The settings page writes it to `.env` in the
skill folder (git-ignored); an `ELEVENLABS_API_KEY` environment variable takes priority.
