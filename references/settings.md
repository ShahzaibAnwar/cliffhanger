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
| `voice.elevenlabs.voices` | `[{voice_id, name, language, notes}]` |
| `voice.elevenlabs.default_voice_id` | used when not asking / only one voice |
| `voice.elevenlabs.model_id, stability, similarity_boost, style, speed` | delivery defaults |
| `voice.edge.voice, rate` | free fallback voice |
| `brand.name, handle, accent` | red tag on every scene, end card, caption CTAs |
| `content.vo_language, headline_language` | e.g. "Hinglish" VO with "English" headlines |
| `content.target_seconds, niche, series_name, series_promise, end_cta` | story defaults |
| `audio.bed` (`drone`/`none`), `bed_volume`, `music`, `music_volume`, `sfx`, `lufs` | mix defaults |
| `captions.platforms, always_hashtags, emoji` (`none`/`light`/`heavy`) | captions.md defaults |
| `images.provider` | `auto` (Cloudflare first, Gemini second) · `cloudflare` · `gemini` · `off` |
| `images.style` | default look: `auto` (engraving; engraving-dark on dark scenes) · `engraving` · `diagram` · `photo` · `xray` |
| `images.cloudflare_model, cloudflare_steps, gemini_model, feather` | provider models (FLUX schnell, up to 8 steps; Gemini 2.5 Flash Image) and soft-edge option |
| `images.cloudflare_ref_model` | model used when there is a reference image (`character`, `image_ref`): `@cf/black-forest-labs/flux-2-klein-4b` (default) or `flux-2-klein-9b` |
| `audio.ai_sfx, sfx_volume` | AI sound effects on/off, effects level |
| `animation.transition, camera, film_fx, sketch_art, headline_fx` | motion defaults |
| `output.projects_dir` | where new reel project folders go; also where `series.json` lives |
| `subtitles.burn, style, lang, y, size, max_words` | burned-in subtitles |
| `content.max_scene_seconds` | stills check warns above this (add beats) |
| `images.max_rerolls` | automatic AI image re-rolls when the quality check fails |
| `audio.bed, ai_music, music_prompt` | background mood / AI music |
| `render.gpu` | **GPU first** (default `auto`): browser draws on the discrete graphics card; video encodes on NVIDIA NVENC → Intel QSV → AMD AMF, CPU (libx264) only if none works. Force one with `nvidia` / `intel` / `amd`, or `off` for CPU only. Env `CLIFFHANGER_GPU` overrides |

Image keys (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`) are also stored in `.env`
through the settings page → **Images**, which also has a "Try it" button that generates a test image.

The ElevenLabs key is not stored in settings.json. The settings page writes it to `.env` in the
skill folder (git-ignored); an `ELEVENLABS_API_KEY` environment variable takes priority.
