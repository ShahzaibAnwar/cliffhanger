# Sound design

Sound carries half the suspense. The renderer mixes four layers, ducks everything under the voice,
and masters to ‑14 LUFS:

1. **Voiceover** (always on top)
2. **Bed**: a generated mood (`audio.bed`: drone, tension, mystery, pulse, calm), AI music (`audio.ai_music` + `music_prompt`, ElevenLabs paid plans, cached), or your own file (`audio.music`)
3. **Automatic SFX**: placed by the engine on visual events
4. **Directed SFX**: per-scene `sfx` cues and `ambience`, written by Claude in the sound pass

## Automatic SFX (no work needed)

| event | sound |
|---|---|
| hard cut | `swish` (quiet) |
| whip / zoom / glitch / slide transition | `whoosh` / `whoosh_low` / `glitch` / `paper` |
| entering a dark scene from paper | `braam` (low horror hit) |
| stamp | `impact` + screen shake |
| flash overlay | `boom` |
| callout ring | `ding` |
| chip / tag / mystery reveal | `pop` / `swish` / `pop` |
| counter, terminal typing, notepad writing, strike, sketch art | `tick_roll`, `typing`, `scribble`, `scratch`, `scribble` |
| end card title / Follow button | `thud` / `pop` |

## Built-in presets (free, offline)

`node scripts/sfx.mjs list` prints them; `node scripts/sfx.mjs preview out.wav` renders them all to
one file so you can listen and pick. Presets: swish, whoosh, whoosh_low, paper, pop, ding, thud, impact,
boom, braam, riser, heartbeat, clock, buzz, glitch, shutter, tick_roll, typing, scribble, scratch,
water.

## AI sound effects (ElevenLabs)

Any cue can describe a sound in words instead of naming a preset:

```json
"sfx": [
  { "at": "word:gunshot", "prompt": "single gunshot in a small room, sharp, close", "dur": 1.2, "fallback": "boom", "vol": 0.7 },
  { "at": 0.4, "prompt": "mosquito buzzing close to the ear, passing left to right", "dur": 2.5, "fallback": "buzz" }
],
"ambience": { "prompt": "quiet bedroom at night, clock ticking, faint wind", "vol": 0.18, "fallback": "clock" }
```

- Generation only runs when `audio.ai_sfx` is true in settings and an ElevenLabs key is set.
  Otherwise, and on any API error, the `fallback` preset is used, so a render never fails over sound.
- Each unique (prompt, duration, loop) is generated once and cached in `sfx-cache/`, then reused
  by every future reel for free.
- Test a sound alone: `node scripts/sfx.mjs gen "glass shattering on tile" --dur 1.5`.
- Prompt style: say what it is, where it is and how it feels: "deep cinematic impact with a long
  reverb tail", "paper being torn slowly, close mic". Keep `dur` short for hits (0.6–1.5 s) and
  2–6 s for textures. `"loop": true` (set automatically for ambience) makes it seamless.

## The sound pass (Claude, after the stills QA)

Go scene by scene and add, at most, **one directed cue per scene** where the story has a
sound-shaped moment:

- Literal sounds the viewer imagines: a gunshot, a bite, a heartbeat, water, a door, a scream far away.
- Tension: `riser` 2 s before a big reveal, `heartbeat` ambience under a fear beat, `clock` under a countdown.
- Silence is a cue too: on the biggest reveal, set `cut_sfx: false`, add no other cue, and let the
  voice land with only the drone under it.

Don't stack more than three sounds in one second, and keep any one cue's `vol` at 0.8 or below.

## Music beds

`node scripts/sfx.mjs beds out.wav` plays all five, 12 s each. drone: low suspense (default) ·
tension: slow heartbeat + thin string (horror) · mystery: music-box arpeggio (curiosity) · pulse: ticking
(investigation, countdowns) · calm: gentle arpeggio (wonder). All are levelled to the same loudness and
ducked under the voice.

## Real recordings and your own sound library

- `audio.real_sfx` (default on): every built-in effect (whoosh, impact, heartbeat, clock, typing, paper,
  pencil, glitch, braam…) is played from a real CC0 recording instead of the synthesized one. The first
  render downloads up to 3 takes per effect from Freesound (through Openverse; CC0 only, no key needed),
  trims the silence, evens the loudness and stores them in `sfx-library/` for every later project. Takes
  rotate so repeated cues don't sound identical. Offline, or with `--offline`, the synthesized presets play.
- Any cue can ask for a specific sound: `{ "find": "thunder rumble", "at": "word:storm", "vol": 0.5, "dur": 2 }`.
- Your own file: `{ "file": "sfx/door.wav" }` (path inside the project). A project's `sfx/` folder and
  `sfx-library/` are searched by file name first, so drop in sound packs (Sonniss GDC bundles,
  purchased libraries) and name files by what they are.
- Order for every cue: your file → your folders → real CC0 recording → ElevenLabs AI sound (if on) → preset.
- Credits for downloaded sounds are added to the project's `credits.json` (CC0 needs none, but it's recorded).
- `node scripts/sfx.mjs find "glass shatter"` pre-fetches a sound; `node scripts/sfx.mjs library` lists the library.
