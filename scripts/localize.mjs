#!/usr/bin/env node
/* One-command language versions.
     node localize.mjs <source-project> --lang ur --lines lines.ur.json [--out <dir>] [--voice <elevenlabs id>]

   lines.<lang>.json (Claude writes it):  { "<scene id>": { "vo": "...", "roman": "...", "cues": { "frozen": "جم" } }, ... }
   - vo:    the spoken line in the target language (native script; English terms in Latin are fine)
   - roman: optional romanised line → out/<slug>-roman.srt
   - cues:  optional, English cue word → target word. Cue words you don't map are placed automatically at the
            same relative position in the line ("vo:0.42"), using the source voiceover's word timings.
   Visuals, art (and AI images in art/gen) are copied unchanged; headlines stay as they are.
   Voice: --voice, else the series' voice for this language (series.json), else your default. */
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from './settings-lib.mjs';

const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const src = path.resolve(a.find(x => !x.startsWith('--')) || '.');
const lang = opt('lang'); const linesPath = opt('lines');
if (!lang || !linesPath) { console.error('usage: node localize.mjs <source-project> --lang ur --lines lines.ur.json [--out dir] [--voice id]'); process.exit(1); }
const LANG = { ur: 'Urdu/Hindi', hi: 'Hindi', ar: 'Arabic', es: 'Spanish', fr: 'French', tr: 'Turkish', bn: 'Bengali', pa: 'Punjabi', en: 'English' };
const EDGE = { ur: 'ur-PK-AsadNeural', hi: 'hi-IN-MadhurNeural', ar: 'ar-SA-HamedNeural', es: 'es-MX-JorgeNeural', fr: 'fr-FR-HenriNeural', tr: 'tr-TR-AhmetNeural', bn: 'bn-BD-PradeepNeural', en: 'en-US-AndrewMultilingualNeural' };

const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const reel = read(path.join(src, 'reel.json'));
const lines = read(path.resolve(linesPath));
const timings = fs.existsSync(path.join(src, 'build', 'timings.json')) ? read(path.join(src, 'build', 'timings.json')).scenes : {};
const out = path.resolve(opt('out', path.join(path.dirname(src), `${reel.slug || path.basename(src)}-${lang}`)));

// voice for this language
let voiceId = opt('voice');
if (!voiceId) {
  const sj = path.join(path.dirname(src), 'series.json');
  if (fs.existsSync(sj) && reel.series?.name) voiceId = read(sj).series?.[reel.series.name]?.voices?.[lang]?.voice_id;
}
if (!voiceId) voiceId = loadSettings().voice?.elevenlabs?.default_voice_id || reel.voice?.elevenlabs?.voice_id;

const norm = w => String(w).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}']+/gu, '');
function autoPos(sceneId, vo, word) {                 // relative position of an English cue word in its line
  const T = timings[sceneId];
  const n = norm(word);
  if (T?.words?.length) {
    const w = T.words.find(x => { const m = norm(x.w); return m === n || (n.length >= 3 && m.startsWith(n)) || (m.length >= 4 && n.startsWith(m)); });
    if (w) return Math.max(0, Math.min(0.98, w.s / T.duration));
  }
  const toks = String(vo || '').split(/\s+/); const i = toks.findIndex(t => norm(t).startsWith(n));
  return i >= 0 ? i / Math.max(1, toks.length) : 0.4;
}
let explicit = 0, auto = 0;
const missing = [];
for (const s of reel.scenes) {
  const L = lines[s.id];
  if (!L) { if (s.vo) missing.push(s.id); continue; }
  const srcVo = s.vo; const cmap = Object.fromEntries(Object.entries(L.cues || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const remap = o => {
    if (Array.isArray(o)) return o.map(remap);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
    if (typeof o === 'string' && o.startsWith('word:')) {
      const m = o.match(/^word:(.+?)([+-]\d*\.?\d+)?$/); const w = m[1], off = m[2] || '';
      if (cmap[w.toLowerCase()]) { explicit++; return `word:${cmap[w.toLowerCase()]}${off}`; }
      auto++; return `vo:${autoPos(s.id, srcVo, w).toFixed(3)}${off}`;
    }
    return o;
  };
  for (const k of ['headline_at', 'punch_at', 'visual', 'overlays', 'sfx', 'ambience', 'beats', 'subtitles']) if (s[k] !== undefined) s[k] = remap(s[k]);
  s.vo = L.vo; if (L.roman) s.vo_roman = L.roman; else delete s.vo_roman;
  delete s.vo_tts;
}
if (missing.length) { console.error('Missing lines for scenes: ' + missing.join(', ')); process.exit(1); }

reel.slug = `${reel.slug || path.basename(src)}-${lang}`;
reel.title = `${reel.title} (${LANG[lang] || lang})`;
reel.voice = reel.voice || {};
reel.voice.elevenlabs = { ...(reel.voice.elevenlabs || {}), voice_id: voiceId, language_code: lang };
reel.voice.edge = { voice: EDGE[lang] || reel.voice.edge?.voice, rate: '+6%' };

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'reel.json'), JSON.stringify(reel, null, 1) + '\n');
fs.copyFileSync(path.resolve(linesPath), path.join(out, `lines.${lang}.json`));
if (fs.existsSync(path.join(src, 'art'))) fs.cpSync(path.join(src, 'art'), path.join(out, 'art'), { recursive: true });
const rows = reel.scenes.map((s, i) => `| ${i + 1} | ${s.vo || ''} | ${s.vo_roman || ''} | ${(s.headline || []).join(' / ') || 'end card'} |`);
fs.writeFileSync(path.join(out, 'script.md'), `# ${reel.title}\n\nBuilt from \`${path.basename(src)}\` with localize.mjs. Visuals and facts are identical to the source (see its facts.md).\nVoice: ElevenLabs ${voiceId} (${lang}).\n\n| # | spoken | roman | headline |\n|---|---|---|---|\n${rows.join('\n')}\n`);
console.log(`${out}\n  ${reel.scenes.length} scenes · cues: ${explicit} mapped by you, ${auto} placed automatically · voice ${voiceId}\n  next: voiceover.py → (tighten) → render.mjs   (Roman subtitles are written automatically when lines have "roman")`);
