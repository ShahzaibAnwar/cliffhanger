# Voiceover

`scripts/voiceover.py` synthesizes **one clip per scene** and records word timings, so every
scene is exactly as long as its line and headlines/stamps can land on spoken words.
Clips are cached by (provider, settings, text) — editing one line only regenerates that line,
which matters on paid ElevenLabs credits.

## ElevenLabs (best)

Set `ELEVENLABS_API_KEY` as an environment variable or put `ELEVENLABS_API_KEY=...` in a `.env`
file inside the project folder (add `.env` to `.gitignore`). Then `"provider": "auto"` picks it.

- Endpoint: `POST /v1/text-to-speech/{voice_id}/with-timestamps` (character alignment → word times).
- Request stitching: each line is sent with `previous_text` / `next_text`, so the delivery flows
  like one take even though clips are separate (disabled automatically for `eleven_v3`).
- Models: `eleven_multilingual_v2` (default, 29 languages incl. Hindi & Urdu), `eleven_turbo_v2_5` /
  `eleven_flash_v2_5` (cheaper/faster), `eleven_v3` (most expressive; supports audio tags like `[whispers]`).
- Default voice `nPczCjzI2devNBz1zQrb` (premade "Brian", deep narrator). List yours:
  `python scripts/voiceover.py --list-voices elevenlabs`.
- Narration settings that suit this genre: `stability 0.30–0.45` (lower = more dramatic),
  `similarity_boost 0.8`, `style 0.3–0.5`, `speed 1.0–1.1`.
- Optional `language_code` (e.g. "hi", "ur") to force the language on multilingual models.

## Edge neural voices (free fallback)

No key needed (`pip install edge-tts`). Good voices:

| language | voices |
|---|---|
| English (US) | `en-US-AndrewMultilingualNeural` (warm narrator, default), `en-US-GuyNeural`, `en-US-BrianMultilingualNeural`, `en-US-AvaMultilingualNeural` |
| English (UK/IN) | `en-GB-RyanNeural`, `en-IN-PrabhatNeural` |
| Hindi | `hi-IN-MadhurNeural` (male), `hi-IN-SwaraNeural` (female) |
| Urdu | `ur-PK-AsadNeural` (male), `ur-PK-UzmaNeural` (female), `ur-IN-SalmanNeural` |
| Arabic | `ar-SA-HamedNeural` |
| Spanish | `es-MX-JorgeNeural`, `es-ES-AlvaroNeural` |

`rate` "+5%"…"+12%" gives the punchy reel pace. Avoid `pitch` (the service rejects many values;
the script retries without it). The free service throttles bursts; the script backs off and retries.

## Writing for the ear

- Hinglish/Urdu-English: write VO in the native script (Devanagari / Urdu) with English technical
  words left in Latin script — TTS pronounces both correctly. Keep on-screen headlines in English caps.
- "..." creates a suspense pause; a full stop is a beat; a comma is a breath.
- Spell numbers the way they should be said if the voice gets them wrong ("seven lakh", "seventy percent").
- Use `vo_tts` for pronunciation-only changes (acronyms: "H I V", names, units).
- Read the whole script aloud once: if a line needs two breaths, split it into two scenes.

## Troubleshooting

- `NoAudioReceived` (edge): throttling or bad pitch/rate — the script retries; wait a minute if it persists.
- ElevenLabs 401: key wrong/missing. 422: bad voice_id or settings. 429: concurrency/quota.
- Words not matching for `word:` cues: the engine falls back to text position; use a number instead.
