#!/usr/bin/env node
/* One-command language versions.
     node localize.mjs <source-project> --lang ur --lines lines.ur.json [--out <dir>] [--voice <elevenlabs id>] [--brand brand.json] [--tts tts.ur.json]

   lines.<lang>.json (Claude writes it):  { "<scene id>": { "vo": "...", "roman": "...", "cues": { "frozen": "جم" } }, ... }
   Another channel or brand: a top-level "reel" block is merged into reel.json (brand, series, cover, css, look,
   subtitles…), and each scene can replace its own text: "headline", "section", "chapter", "visual" (merged: end card
   kicker/title/next…), "overlays" (by position: [{ "text": "…" }, {}, { "kicker": "…", "text": "…" }] or { "2": {…} }; false leaves one out),
   and "beats": [{ "headline": …, "overlays": […], "visual": {…} }, …] (by position) for the text inside beats.
   --brand brand.json: the same as a "reel" block, kept in one file per channel (lines' own "reel" block wins).
   --tts tts.ur.json: { "<scene id>": "<the line with aerab>" } → each scene's vo_tts (what the voice reads; captions
   keep vo). Each is checked to strip back to the same words as vo. Urdu / Arabic / Persian lines without aerab are
   listed (homographs like جلد, jild / jald, get misread).
   - vo:    the spoken line in the target language (native script; English terms in Latin are fine)
   - roman: optional romanised line → out/<slug>-roman.srt
   - cues:  optional, English cue word → target word. Cue words you don't map are placed automatically at the
            same relative position in the line ("vo:0.42"), using the source voiceover's word timings.
   Visuals, art (and AI images in art/gen) are copied unchanged; headlines stay as they are.
   Voice: --voice, else the series' voice for this language (series.json in the destination's workspace, then the
   source's), else your default. */
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
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const merge = (a, b) => { if (!isObj(a) || !isObj(b)) return b; const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v; return o; };
// channel / brand changes: --brand file, then lines' own "reel" block (a scene can't be called "reel" then)
const brandFile = opt('brand'), reelBlock = isObj(lines.reel) && !reel.scenes.some(s => s.id === 'reel') ? lines.reel : null;
const changed = [];
for (const b of [brandFile ? read(path.resolve(brandFile)) : null, reelBlock]) if (b) { Object.assign(reel, merge(reel, b)); changed.push(...Object.keys(b)); }
if (reelBlock) delete lines.reel;
const timings = fs.existsSync(path.join(src, 'build', 'timings.json')) ? read(path.join(src, 'build', 'timings.json')).scenes : {};
const out = path.resolve(opt('out', path.join(path.dirname(src), `${reel.slug || path.basename(src)}-${lang}`)));

// voice for this language: --voice, else the series' voice in the destination workspace (a new channel), then the source's
let voiceId = opt('voice'), voiceFrom = voiceId ? '--voice' : '';
if (!voiceId && reel.series?.name) for (const ws of [...new Set([path.dirname(out), path.dirname(src)])]) {
  const sj = path.join(ws, 'series.json');
  const v = fs.existsSync(sj) ? read(sj).series?.[reel.series.name]?.voices?.[lang]?.voice_id : null;
  if (v) { voiceId = v; voiceFrom = `series "${reel.series.name}" in ${sj}`; break; }
}
if (!voiceId) { voiceId = loadSettings().voice?.elevenlabs?.default_voice_id || reel.voice?.elevenlabs?.voice_id; voiceFrom = 'your default voice (no series voice for this language: pass --voice, or add one to series.json)'; }

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
let explicit = 0, auto = 0, overridden = 0;
const missing = [], warnings = [], noAerab = [], earlyPunch = [], srcById = {};
let addedBeats = 0;
const TTS = opt('tts') ? read(path.resolve(opt('tts'))) : {};
const norm2 = w => String(w).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');   // the engine's word match
for (const s of reel.scenes) {
  const L = lines[s.id];
  srcById[s.id] = s.vo;
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
  const tts = TTS[s.id] ?? L.vo_tts;
  if (tts) {
    s.vo_tts = tts;
    // the marked line must say the same words as vo: strip aerab, tatweel and punctuation, then compare word by word
    const bare = t => String(t).replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').normalize('NFC').split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]+/gu, '')).filter(Boolean);
    const A = bare(L.vo), B = bare(tts);
    const k = A.findIndex((w, i) => w !== B[i]);
    if (k >= 0 || A.length !== B.length) { const i = k >= 0 ? k : Math.min(A.length, B.length); warnings.push(`${s.id}: vo_tts doesn't match vo at word ${i + 1}: "${A[i] ?? '(end)'}" in vo, "${B[i] ?? '(end)'}" in vo_tts (fine if respelled on purpose for the voice; otherwise a word is missing or changed)`); }
  } else delete s.vo_tts;
  if (['ur', 'ar', 'fa'].includes(lang) && /[\u0600-\u06FF]/.test(s.vo_tts || L.vo) && !/[\u064B-\u0652\u0670]/.test(s.vo_tts || L.vo)) noAerab.push(s.id);
  // text the viewer reads, for this language / channel: the scene, and each of its beats ("beats": [{…}, {…}] by position)
  const applyText = (tgt, Lx, where) => {
    for (const k of ['headline', 'section', 'chapter', 'punch_at', 'headline_static']) if (Lx[k] !== undefined) { tgt[k] = Lx[k]; overridden++; }
    if (isObj(Lx.visual)) { tgt.visual = merge(tgt.visual || {}, Lx.visual); overridden++; }
    if (Lx.overlays) {
      const ov = Array.isArray(tgt.overlays) ? tgt.overlays : [];
      const ent = Array.isArray(Lx.overlays) ? Lx.overlays.map((v, i) => [i, v]) : Object.entries(Lx.overlays).map(([i, v]) => [+i, v]);
      const drop = new Set();
      for (const [i, v] of ent) if (v === false || (isObj(v) && Object.keys(v).length)) {
        if (!ov[i]) { warnings.push(`${where}: overlay ${i} doesn't exist (it has ${ov.length})`); continue; }
        if (v === false) drop.add(i); else ov[i] = merge(ov[i], v);           // false: leave that overlay out
        overridden++;
      }
      if (drop.size) tgt.overlays = ov.filter((_, i) => !drop.has(i));
    }
  };
  applyText(s, L, s.id);
  if (Array.isArray(L.beats)) L.beats.forEach((Lb, i) => {
    if (!isObj(Lb) || !Object.keys(Lb).length) return;
    if (!s.beats?.[i]) {        // a new beat for this language (translations run longer): needs "at" and a "visual"
      const n = s.beats?.length || 0;
      if (i === n && Lb.at != null && isObj(Lb.visual) && Object.keys(Lb.visual).length) { (s.beats = s.beats || []).push(Lb); addedBeats++; return; }
      warnings.push(`${s.id}: beat ${i} doesn't exist (the scene has ${n})${i === n ? '; a new beat needs "at" and a "visual"' : ''}`); return;
    }
    applyText(s.beats[i], Lb, `${s.id} beat ${i}`);
  });
  // verb-final languages (Urdu, Hindi…) often say the punch word at the end of the line: without punch_at, line 1
  // of the headline would sit alone until then. Show the punch line early unless the lines file decides.
  const HL = Array.isArray(s.headline) ? s.headline : null, ai = s.accent_line != null ? s.accent_line : 1;
  if (HL && HL.length >= 2 && HL[ai] && s.punch_at == null && !s.headline_static) {
    const vt = String(L.vo).split(/\s+/).filter(Boolean).map(norm2), first = norm2(String(HL[ai]).split(/\s+/)[0]);
    const at = first ? vt.findIndex(m => m && (m === first || (m.startsWith(first) && first.length >= 3) || (first.startsWith(m) && m.length >= 4))) : -1;
    if (at >= 0 && at / Math.max(1, vt.length) > 0.5) { s.punch_at = 0.6; earlyPunch.push(s.id); }
  }
  // a cue must point at one place: the engine takes the cue's first word and the first spoken word that matches it
  const toks = String(L.vo).split(/\s+/).filter(Boolean), tn = toks.map(norm2);
  const hits = w => { const n = norm2(w); return n ? tn.map((m, i) => (m && (m === n || (m.startsWith(n) && n.length >= 3) || (n.startsWith(m) && m.length >= 4)) ? i : -1)).filter(i => i >= 0) : []; };
  for (const [k, v] of Object.entries(L.cues || {})) {
    const words = String(v).split(/\s+/).filter(Boolean), first = words[0], h = hits(first);
    const better = words.find(w => hits(w).length === 1);
    if (!h.length) warnings.push(`${s.id}: cue "${k}" → "${v}" isn't in the line, so it falls back to 40% of the scene`);
    else if (h.length > 1) warnings.push(`${s.id}: cue "${k}" → "${v}" uses "${first}", which matches ${h.map(i => `"${toks[i]}" (word ${i + 1})`).join(' and ')}; the first one wins${better && better !== first ? `: map it to "${better}"` : ': map it to a word that appears once'}`);
  }
}
if (missing.length) {                 // name them, and spot a translation that still holds a line the source split off
  const sent = t => String(t || '').split(/[.!?؟۔।]+/).map(x => x.trim()).filter(Boolean).length;
  console.error(`Missing lines for ${missing.length} scene(s) in ${path.basename(linesPath)}:`);
  for (const id of missing) {
    const i = reel.scenes.findIndex(x => x.id === id), src = reel.scenes[i], prev = reel.scenes[i - 1], Lp = prev && lines[prev.id];
    let hint = '';
    if (Lp && sent(Lp.vo) > sent(srcById[prev.id])) hint = `
     "${prev.id}" in the lines file has ${sent(Lp.vo)} sentences where the source has ${sent(srcById[prev.id])}: the source split that line, so move the sentence that matches "${String(src.vo).slice(0, 30)}" into "${id}"`;
    console.error(`   - ${id}: "${String(src.vo).slice(0, 60)}"${hint}`);
  }
  process.exit(1);
}

reel.slug = `${reel.slug || path.basename(src)}-${lang}`;
if (!changed.includes('title')) reel.title = `${reel.title} (${LANG[lang] || lang})`;
reel.voice = reel.voice || {};
reel.voice.elevenlabs = { ...(reel.voice.elevenlabs || {}), voice_id: voiceId, language_code: lang };
reel.voice.edge = { voice: EDGE[lang] || reel.voice.edge?.voice, rate: '+6%' };

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'reel.json'), JSON.stringify(reel, null, 1) + '\n');
fs.copyFileSync(path.resolve(linesPath), path.join(out, `lines.${lang}.json`));
if (fs.existsSync(path.join(src, 'art'))) fs.cpSync(path.join(src, 'art'), path.join(out, 'art'), { recursive: true });
const rows = reel.scenes.map((s, i) => `| ${i + 1} | ${s.vo || ''} | ${s.vo_roman || ''} | ${(s.headline || []).join(' / ') || 'end card'} |`);
fs.writeFileSync(path.join(out, 'script.md'), `# ${reel.title}\n\nBuilt from \`${path.basename(src)}\` with localize.mjs. Visuals and facts are identical to the source (see its facts.md).\nVoice: ElevenLabs ${voiceId} (${lang}).\n\n| # | spoken | roman | headline |\n|---|---|---|---|\n${rows.join('\n')}\n`);
// what the viewer still reads in the source's words (fine for names; otherwise translate it in lines.<lang>.json)
const kept = [];
for (const s of reel.scenes) {
  const L = lines[s.id] || {}, ov = L.overlays || {};
  if (s.headline && L.headline === undefined) kept.push(`${s.id} headline`);
  (s.overlays || []).forEach((o, i) => { if ((o.text || o.kicker) && !(isObj(ov[i]) && Object.keys(ov[i]).length)) kept.push(`${s.id} ${o.type}`); });
  if (s.visual?.type === 'endcard' && !isObj(L.visual)) kept.push(`${s.id} end card`);
  (s.beats || []).forEach((b, bi) => {
    const Lb = (Array.isArray(L.beats) && isObj(L.beats[bi]) ? L.beats[bi] : {}), bov = Lb.overlays || {};
    if (b.headline && Lb.headline === undefined) kept.push(`${s.id} beat ${bi} headline`);
    (b.overlays || []).forEach((o, i) => { if ((o.text || o.kicker) && !(isObj(bov[i]) && Object.keys(bov[i]).length)) kept.push(`${s.id} beat ${bi} ${o.type}`); });
  });
}
if (noAerab.length) warnings.push(`${noAerab.length} line(s) have no aerab (${noAerab.join(', ')}): homographs like جلد may be misread; give them vo_tts with zer/zabar/pesh (--tts tts.${lang}.json)`);
if (earlyPunch.length) console.log(`  punch line said late in ${earlyPunch.length} line(s) (${earlyPunch.join(', ')}): "punch_at": 0.6 shows it early (set "punch_at" or "headline_static" in lines.${lang}.json to choose)`);
if (addedBeats) console.log(`  ${addedBeats} new beat(s) from lines.${lang}.json`);
if (warnings.length) { console.warn(`! ${warnings.length} warning(s):`); for (const w of warnings) console.warn('   - ' + w); }
console.log(`${out}\n  ${reel.scenes.length} scenes · cues: ${explicit} mapped by you, ${auto} placed automatically · ${overridden} text override(s)${changed.length ? ` · reel: ${[...new Set(changed)].join(', ')}` : ''}`);
console.log(`  voice ${voiceId}: ${voiceFrom}`);
if (kept.length) console.log(`  still in the source's words (${kept.length}): ${kept.slice(0, 12).join(', ')}${kept.length > 12 ? ', …' : ''}\n    → to change them: "headline" / "overlays" / "visual" on those scenes in lines.${lang}.json, a "reel" block for brand, series, cover`);
console.log(`  next: voiceover.py → (tighten) → render.mjs   (Roman subtitles are written automatically when lines have "roman")`);
