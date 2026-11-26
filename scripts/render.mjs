#!/usr/bin/env node
/* Cliffhanger renderer.
   node render.mjs <project-dir> [--stills] [--at 3.2,7] [--preview] [--no-audio] [--fps 30] [--quality 90] [--workers N]

   --stills    QA mode: one PNG per scene + contact sheet (seconds, not minutes)
   --at a,b    capture PNG frames at these absolute times
   --preview   half resolution, 15 fps — fast full-motion check
   --workers N parallel capture tabs (default: auto from CPU threads; settings render.workers)
   default     full render (1080x1920, or reel.format.width x height, e.g. 1920x1080) with mixed audio -> out/<slug>.mp4 + .srt + contact.jpg */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gpuPref, browserGpuArgs, pickEncoder as pickEncoderFor } from './gpu.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const proj = path.resolve(args.find(a => !a.startsWith('--')) || '.');
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const reelPath = path.join(proj, 'reel.json');
if (!fs.existsSync(reelPath)) { console.error('No reel.json in ' + proj); process.exit(1); }
const reel = JSON.parse(fs.readFileSync(reelPath, 'utf8'));
const { loadSettings, deepMerge } = await import('./settings-lib.mjs');
const SETTINGS = loadSettings();                 // user defaults; reel.json values win
// a channel's own style lock: <workspace>/style.json ({ auto, map }) overrides settings.style for reels in that folder
try { const ws = JSON.parse(fs.readFileSync(path.join(path.dirname(proj), 'style.json'), 'utf8')); SETTINGS.style = { ...(SETTINGS.style || {}), ...ws }; } catch { /* none */ }
// automatic style: "look": "auto" (or no look while settings.style.auto is on) → look + caption style + music mood
// from the topic, via the style map; anything the reel sets itself is kept
if (reel.look === 'auto' || (!reel.look && !reel.animation?.look && SETTINGS.style?.auto && (!SETTINGS.animation?.look || SETTINGS.animation.look === 'auto'))) {
  const { pickStyle, styleMap } = await import('./style.mjs');
  const wide = (+reel.format?.width || 1080) > (+reel.format?.height || 1920);
  const text = [reel.topic, reel.niche, reel.title, reel.series?.name, ...(reel.scenes || []).slice(0, 3).map(x => [].concat(x.headline || []).join(' ') + ' ' + (x.vo || ''))].filter(Boolean).join(' ');
  const r = pickStyle(text, { wide, map: styleMap(SETTINGS) });
  reel.look = r.look;
  if (!reel.subtitles?.style) reel.subtitles = { ...(reel.subtitles || {}), style: r.captions };
  if (!reel.audio?.music_mood && !reel.audio?.music && r.music_mood) reel.audio = { ...(reel.audio || {}), music_mood: r.music_mood };
  console.log(`style: auto → ${r.look} · captions ${r.captions} · music ${r.music_mood || 'bed'}  (${r.why})`);
}
reel.brand = deepMerge(SETTINGS.brand || {}, reel.brand || {});
reel.audio = deepMerge(SETTINGS.audio || {}, reel.audio || {});
if (!reel.audio.music) reel.audio.music = null;
const ANIM = deepMerge(SETTINGS.animation || {}, reel.animation || {});
const LIB = path.join(path.dirname(HERE), 'assets', 'art');        // "@lib/brain.svg" -> shared art library
const build = path.join(proj, 'build'); const outDir = path.join(proj, 'out');
fs.mkdirSync(build, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
const timingsPath = path.join(build, 'timings.json');
const timings = fs.existsSync(timingsPath) ? JSON.parse(fs.readFileSync(timingsPath, 'utf8')) : { scenes: {} };
if (!fs.existsSync(timingsPath)) console.warn('! No build/timings.json — run voiceover.py first. Estimating durations from word count.');

// ---------- timeline ----------
let t = 0, fig = 0;
const WPS = reel.voice?.words_per_sec || 2.7;
const scenes = reel.scenes.map((s0, i) => {
  const s = JSON.parse(JSON.stringify(s0));
  s.id = s.id || 's' + (i + 1);
  s.theme = s.theme || 'paper';
  const vo = timings.scenes[s.id];
  const words = String(s.vo || '').trim().split(/\s+/).filter(Boolean).length;
  const voDur = vo ? vo.duration : (s.vo ? words / WPS : 0);
  const lead = s.lead != null ? s.lead : 0;
  s.vo_dur = voDur;
  s.dur = s.duration != null ? s.duration : Math.max(s.min || 1.0, lead + voDur + (s.pad != null ? s.pad : 0.08));
  s.start = +t.toFixed(3); s.end = +(t + s.dur).toFixed(3); t += s.dur;
  s.vo_at = s.start + lead;
  s.words = vo && vo.words ? vo.words.map(w => ({ w: w.w, s: w.s + lead, e: w.e + lead })) : [];
  if (s.chrome !== false && s.theme !== 'photo' && s.visual?.type !== 'endcard') s.fig = ++fig;
  return s;
});
const TOTAL = +(t + (reel.tail != null ? reel.tail : 0.25)).toFixed(3);
scenes[scenes.length - 1].end = TOTAL;

// restore punctuation/casing on TTS word timings from the script (needed for subtitles and SRT)
const nzw = x => String(x).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
for (const s of scenes) {
  if (!s.words.length || !s.vo) continue;
  const toks = String(s.vo).split(/\s+/).filter(Boolean); let k = 0;
  s.words = s.words.map(w => { for (let j = k; j < Math.min(toks.length, k + 4); j++) { const a = nzw(toks[j]), b = nzw(w.w); if (a && b && (a === b || a.startsWith(b) || b.startsWith(a))) { k = j + 1; return { ...w, w: toks[j] }; } } return w; });
}

// time spec in Node (same rules as the engine): number | "40%" | "word:x(+0.2)" | "vo:0.4" | "end-0.5"
function atTime(s, spec, def = 0) {
  if (spec == null) spec = def;
  if (typeof spec === 'number') return s.start + Math.max(0, Math.min(spec, s.dur - 0.05));
  let str = String(spec).trim(), off = 0; const mo = str.match(/^(.+?)([+-]\d*\.?\d+)$/);
  if (mo && !/^[+-]?\d*\.?\d+$/.test(str)) { str = mo[1]; off = parseFloat(mo[2]); }
  let r = 0.4 * s.dur;
  if (/^\d*\.?\d+$/.test(str)) r = parseFloat(str);
  else if (str.endsWith('%')) r = parseFloat(str) / 100 * s.dur;
  else if (str === 'end') r = s.dur;
  else if (str.startsWith('vo:')) r = (s.vo_at - s.start) + parseFloat(str.slice(3)) * (s.vo_dur || s.dur);
  else if (str.startsWith('word:')) { const n = nzw(str.slice(5)); const w = s.words.find(x => { const m = nzw(x.w); return m === n || (n.length >= 3 && m.startsWith(n)); }); if (w) r = w.s; }
  return s.start + Math.max(0.2, Math.min(r + off, s.dur - 0.3));
}

// beats: one spoken line, several visuals. scene.beats = [{at, visual?, overlays?, headline?, theme?, ...}]
const sceneCountBeforeBeats = scenes.length;
{
  const out = [];
  for (const s of scenes) {
    if (!Array.isArray(s.beats) || !s.beats.length) { out.push(s); continue; }
    const cuts = s.beats.map(b => ({ b, t: atTime(s, b.at, '50%') })).sort((x, y) => x.t - y.t);
    const parent = { ...s }; delete parent.beats; parent.end = cuts[0].t; parent.dur = parent.end - parent.start; out.push(parent);
    cuts.forEach((c, i) => {
      const end = i + 1 < cuts.length ? cuts[i + 1].t : s.end;
      const sub = { ...JSON.parse(JSON.stringify(s)), ...JSON.parse(JSON.stringify(c.b)) };
      delete sub.beats; delete sub.at;
      Object.assign(sub, { id: `${s.id}~${i + 1}`, _beatOf: s.id, start: c.t, end, dur: end - c.t, vo: undefined, vo_roman: undefined,
        words: s.words.map(w => ({ ...w, s: w.s - (c.t - s.start), e: w.e - (c.t - s.start) })), vo_at: s.vo_at,
        transition: c.b.transition || 'cut', overlays: c.b.overlays || [], sfx: c.b.sfx || [], ambience: c.b.ambience || null, cut_sfx: c.b.cut_sfx ?? false });
      if (!c.b.headline) sub.headline_static = true;
      out.push(sub);
    });
  }
  scenes.length = 0; scenes.push(...out);
}

// burned-in subtitle chunks
const SUBS = deepMerge({ burn: false, style: 'word', size: 60, max_words: 4, lang: 'auto' }, deepMerge(SETTINGS.subtitles || {}, reel.subtitles || {}));
function subtitleChunks() {
  const END = /(\.\.\.|[.?!,;:۔؟،।])$/, chunks = [], maxW = SUBS.max_words || 4;
  const sent = tt => { const o = []; let c = []; for (const w of String(tt).split(/\s+/).filter(Boolean)) { c.push(w); if (/(\.\.\.|[.?!۔؟।])$/.test(w)) { o.push(c); c = []; } } if (c.length) o.push(c); return o; };
  for (const s of scenes) {
    if (s._beatOf || !s.vo) continue;
    const useRoman = s.vo_roman && SUBS.lang !== 'vo';
    let words = [];
    if (useRoman) {        // roman text, spread over the timing of the matching native sentences
      const rs = sent(s.vo_roman), us = sent(s.vo), W = s.words;
      const aligned = W.length && rs.length === us.length && W.length === us.reduce((n, u) => n + u.length, 0);
      let spans = [[s.vo_at - s.start, s.vo_at - s.start + s.vo_dur]], groups = [rs.flat()];
      if (aligned) { let i = 0; spans = us.map(u => { const a = W[i].s, b = W[i + u.length - 1].e; i += u.length; return [a, b]; }); groups = rs; }
      groups.forEach((g, gi) => { const [a, b] = spans[gi]; g.forEach((w, k) => words.push({ w, s: s.start + a + (b - a) * k / g.length, e: s.start + a + (b - a) * (k + 1) / g.length })); });
    } else words = s.words.map(w => ({ w: w.w, s: s.start + w.s, e: s.start + w.e }));
    let cur = [];
    const flush = () => { if (cur.length) chunks.push({ t0: cur[0].s - 0.05, t1: cur[cur.length - 1].e, words: cur }); cur = []; };
    for (const w of words) { cur.push(w); if (cur.length >= maxW || END.test(w.w)) flush(); }
    flush();
  }
  for (let i = 0; i + 1 < chunks.length; i++) chunks[i].t1 = Math.min(Math.max(chunks[i].t1, chunks[i].t0 + 0.5), chunks[i + 1].t0);
  return chunks;
}

// ---------- resolve assets (svg_file -> inline svg with scoped ids, image paths -> file urls) ----------
let svgN = 0;
function scopeSvg(svg) {
  const k = ++svgN;
  svg = svg.replace(/<\?xml[^>]*>/, '').replace(/<!DOCTYPE[^>]*>/i, '');
  const ids = [...new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];
  for (const id of ids) {
    const n = `a${k}_${id}`;
    svg = svg.split(`id="${id}"`).join(`id="${n}"`).split(`#${id})`).join(`#${n})`).split(`"#${id}"`).join(`"#${n}"`);
  }
  return svg;
}
function resolveAssets(o) {
  if (Array.isArray(o)) return o.forEach(resolveAssets);
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    if (k === 'fallback_svg_file') {             // hand-drawn backup for a generated image
      const p = String(o[k]).startsWith('@lib/') ? path.join(LIB, o[k].slice(5)) : path.resolve(proj, o[k]);
      if (fs.existsSync(p)) o.fallback_svg = scopeSvg(fs.readFileSync(p, 'utf8'));
      delete o[k];
    } else if (k === 'image' && typeof o[k] === 'string' && !/^(https?|data|file):/.test(o[k]) && (o.fallback_svg_file !== undefined || o.fallback_svg)) {
      const p = path.resolve(proj, o[k]);       // generated image missing on disk → use the drawing
      if (!fs.existsSync(p)) {
        console.warn('! image missing, using hand-drawn fallback: ' + o[k]); delete o.image; o.blend = null;
        if (o.fallback_svg_file !== undefined) { o.svg_file = o.fallback_svg_file; resolveAssets(o); } else o.svg = o.fallback_svg;
      } else o[k] = pathToFileURL(p).href;
    } else if (k === 'svg_file') {
      const p = String(o[k]).startsWith('@lib/') ? path.join(LIB, o[k].slice(5)) : path.resolve(proj, o[k]);
      if (!fs.existsSync(p)) { console.error('Missing svg_file: ' + p); process.exit(1); }
      o.svg = scopeSvg(fs.readFileSync(p, 'utf8')); delete o.svg_file;
    } else if ((k === 'image' || k === 'bg_image' || k === 'video') && typeof o[k] === 'string' && !/^(https?|data|file):/.test(o[k])) {
      const p = String(o[k]).startsWith('@lib/') ? path.join(LIB, o[k].slice(5)) : path.resolve(proj, o[k]);
      if (!fs.existsSync(p)) { console.error('Missing image: ' + p); process.exit(1); }
      o[k] = pathToFileURL(p).href;
    } else if (k === 'svg' && typeof o[k] === 'string') {
      o[k] = scopeSvg(o[k]);
    } else resolveAssets(o[k]);
  }
}
let AI_MISSING = [];
{ // AI illustrations (image_prompt / bg_prompt) → generated files; svg_file stays as fallback
  const { resolveGenerated } = await import('./imagegen.mjs');
  AI_MISSING = resolveGenerated(scenes, proj, SETTINGS.images || {}, reel.characters || null);
  const { resolvePhotos } = await import('./photos.mjs');
  const { resolveClips } = await import('./inbox.mjs');
  AI_MISSING.push(...resolvePhotos(scenes, proj), ...resolveClips(scenes, proj));
  if (AI_MISSING.length) console.warn(`! ${AI_MISSING.length} AI image(s) not generated yet (using svg_file fallback where given). Run: node scripts/imagegen.mjs "${proj}"\n  ` + AI_MISSING.join('\n  '));
}
// repeated as the last thing printed, so it can't scroll away unnoticed
const aiMissingNote = () => { if (AI_MISSING.length) console.warn(`\n!!! ${AI_MISSING.length} picture(s)/clip(s) are missing: these scenes show the hand-drawn fallback.\n!!! Run  node scripts/imagegen.mjs "${proj}"  (AI images),  node scripts/photos.mjs project "${proj}"  (photos),\n!!! or  node scripts/inbox.mjs pack "${proj}"  for a list to make by hand, then render again.`); };
// unknown option names used to pass silently ("motion": "sway"): warn with the closest valid name
{
  const KNOWN = {
    enter: ['fade', 'fadeUp', 'fadeDown', 'pop', 'slam', 'slideL', 'slideR', 'slideUp', 'spring', 'swing', 'drop', 'zoom', 'blur', 'wipe', 'wipeDown', 'stick', 'sketch', 'none'],
    motion: ['float', 'hover', 'kenburns', 'kenout', 'drift', 'pulse', 'spin', 'shiver', 'flutter', 'none'],
    transition: ['auto', 'cut', 'whip', 'slide', 'zoom', 'glitch', 'flash', 'page', 'scribble'],
    camera: ['push', 'pull', 'pan', 'tilt', 'drift', 'crash', 'none'],
    look: ['auto', 'case-file', 'collage', 'chalkboard', 'blueprint', 'comic', 'vhs', 'newsprint'],
    finish: ['collage', 'print', 'torn', 'none'],
    theme: ['paper', 'dark', 'photo'],
  };
  const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); return d[a.length][b.length]; };
  const ALIAS = { sway: 'flutter', wobble: 'flutter', wave: 'flutter', bob: 'float', wipe: 'scribble', fadein: 'fade', fade_in: 'fade', slidein: 'slideUp', bounce: 'drop', shake: 'shiver', dissolve: 'cut', kenburn: 'kenburns' };
  const near = (v, list) => (ALIAS[String(v).toLowerCase()] && list.includes(ALIAS[String(v).toLowerCase()])) ? ALIAS[String(v).toLowerCase()] : list.slice().sort((x, y) => dist(v, x) - dist(v, y))[0];
  const warned = new Set(), check = (where, key, val) => {
    if (val == null || val === '' || typeof val !== 'string' || !KNOWN[key] || KNOWN[key].includes(val)) return;
    const msg = `! ${where}: unknown ${key} "${val}" (did you mean "${near(val, KNOWN[key])}"? valid: ${KNOWN[key].join(', ')})`;
    if (!warned.has(msg)) { warned.add(msg); console.warn(msg); }
  };
  check('reel', 'look', reel.look); check('animation', 'look', ANIM.look); check('animation', 'transition', ANIM.transition); check('animation', 'camera', ANIM.camera);
  if (SUBS.burn && !['word', 'karaoke', 'pop', 'box', 'tape', 'line'].includes(SUBS.style)) console.warn(`! subtitles: unknown style "${SUBS.style}" (valid: word, karaoke, pop, box, tape, line)`);
  if (reel.audio?.music_mood) import('./library.mjs').then(({ MOODS }) => { if (!MOODS[reel.audio.music_mood] && reel.audio.music_mood !== 'none') console.warn(`! audio: unknown music_mood "${reel.audio.music_mood}" (valid: ${Object.keys(MOODS).join(', ')})`); });
  const walk = (o, where) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, where));
    if (!o || typeof o !== 'object') return;
    for (const k of ['enter', 'motion', 'finish']) check(where, k, o[k]);
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'svg') walk(v, where);
  };
  for (const sc of reel.scenes) { const w = `scene "${sc.id || '?'}"`; for (const k of ['transition', 'camera', 'look', 'theme']) check(w, k, sc[k]); walk([sc.visual, sc.overlays, sc.beats], w); }
}
// talking mascot: how loud the voice is on every frame (0..1), from the voiceover clips
let MOUTH = null;
if (reel.mascot && (reel.mascot.image || reel.mascot.svg_file)) {
  MOUTH = [];
  for (const s of scenes) {
    const vo = timings.scenes[s.id]; if (!vo || s._beatOf) continue;
    const f = path.resolve(proj, vo.file); if (!fs.existsSync(f)) continue;
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'aresample=8000,asetnsamples=n=267:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const db = [...(r.stderr || '').matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map(m => m[1] === '-inf' ? -90 : +m[1]);
    db.forEach((d, i) => { const k = Math.round((s.vo_at + i / 30) * 30); MOUTH[k] = +Math.max(0, Math.min(1, (d + 48) / 30)).toFixed(2); });
  }
  for (let i = 0; i < MOUTH.length; i++) if (MOUTH[i] == null) MOUTH[i] = 0;
}
// maps need the bundled world outlines; charts can read a CSV ("csv": "data/x.csv", "x_col": "year", "y_col": "deaths")
let GEO = null;
for (const s of scenes) for (const v of [s.visual, ...(s.beats || []).map(b => b.visual)].filter(Boolean)) {
  if (v.type === 'map' && !GEO) GEO = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'assets', 'geo', 'world-110m.json'), 'utf8'));
  if (v.type === 'map' && v.bounds && Math.min(v.bounds[2] - v.bounds[0], v.bounds[3] - v.bounds[1]) < 6)
    console.warn(`! scene "${s.id}": map zoomed to city level; the bundled outlines are coarse (1:110m) there. Zoom out, or use a photo/illustrated map for this scene.`);
  if (v.type === 'chart' && v.csv && !v.data) {
    const rows = fs.readFileSync(path.resolve(proj, v.csv), 'utf8').trim().split(/\r?\n/).map(l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim()));
    const head = rows.shift(), xi = v.x_col ? head.indexOf(v.x_col) : 0, yi = v.y_col ? head.indexOf(v.y_col) : 1;
    if (xi < 0 || yi < 0) { console.error(`chart: column "${xi < 0 ? v.x_col : v.y_col}" not in ${v.csv} (columns: ${head.join(', ')})`); process.exit(1); }
    v.data = rows.filter(r => r[yi] !== '' && !isNaN(+r[yi].replace(/[, ]/g, ''))).map(r => ({ x: r[xi], y: +r[yi].replace(/[, ]/g, '') }));
    if (v.last) v.data = v.data.slice(-v.last);
  }
}
// an explicit image/clip wins over svg_file; the drawing becomes its fallback (shown if the file is missing or fails)
(function mediaFirst(o) {
  if (Array.isArray(o)) return o.forEach(mediaFirst);
  if (!o || typeof o !== 'object') return;
  if ((o.image || o.video) && o.svg_file && o.fallback_svg_file === undefined) { o.fallback_svg_file = o.svg_file; delete o.svg_file; delete o.svg; }
  if (o.video && typeof o.video === 'string' && !/^(https?|data|file):/.test(o.video) && !fs.existsSync(path.resolve(proj, o.video)) && o.fallback_svg_file !== undefined) {
    console.warn('! clip missing, using hand-drawn fallback: ' + o.video); delete o.video; o.svg_file = o.fallback_svg_file; delete o.fallback_svg_file;
  }
  for (const k of Object.keys(o)) if (k !== 'svg') mediaFirst(o[k]);
})(scenes);
resolveAssets(scenes);
if (reel.mascot) resolveAssets(reel.mascot);

// canvas size: vertical by default; reel.format.width/height switches it (e.g. 1920x1080 for long-form)
const W = parseInt(reel.format?.width || 1080, 10), H = parseInt(reel.format?.height || 1920, 10), WIDE = W > H;
// timeline for analytics.mjs: what was on screen when (written to build/, copied to out/ on the final render)
const TIMELINE = { total: TOTAL, look: reel.look || ANIM.look || 'case-file', captions: SUBS.burn ? (SUBS.style || 'word') : null,
  hook: (scenes.find(x => x.vo) || {}).vo || '', format: `${W}x${H}`,
  scenes: scenes.map(x => ({ id: x.id, start: x.start, end: x.end, visual: x.visual?.type || null, beat: !!x._beatOf, theme: x.theme,
    headline: [].concat(x.headline || []).join(' ').slice(0, 60) || undefined })) };
fs.writeFileSync(path.join(build, 'timeline.json'), JSON.stringify(TIMELINE, null, 1));
const data = {
  size: { w: W, h: H }, layout: reel.layout || null, geo: GEO ? { countries: GEO.countries } : null, mascot: reel.mascot || null, mouth: MOUTH,
  brand: Object.assign({ name: 'YOUR BRAND', accent: '#C8302A' }, reel.brand || {}),
  scenes, total: TOTAL,
  transition: ANIM.transition || 'auto', camera: ANIM.camera || 'push', film_fx: ANIM.film_fx !== false,
  art_enter: ANIM.sketch_art ? 'sketch' : (ANIM.art_enter || 'fadeUp'), headline_fx: ANIM.headline_fx || null,
  // collage look (from paper cut-out explainers): cut-out finish, stop-motion on twos, scribble wipes
  look: reel.look || (ANIM.look !== 'auto' ? ANIM.look : null) || null,              // case-file (default) · collage · chalkboard · blueprint · comic · vhs · newsprint
  finish: ANIM.finish || ((reel.look || ANIM.look) === 'collage' ? 'collage' : null),
  stop_motion: ANIM.stop_motion != null ? ANIM.stop_motion : ((reel.look || ANIM.look) === 'collage' ? 2 : null),
  backing: ANIM.backing || null, backing_color: ANIM.backing_color || null, transition_color: ANIM.transition_color || null,
  subtitles: SUBS.burn ? SUBS : null, subs: SUBS.burn ? subtitleChunks() : [],
};
const css = fs.readFileSync(path.join(HERE, 'engine', 'engine.css'), 'utf8');
const js = fs.readFileSync(path.join(HERE, 'engine', 'engine.js'), 'utf8');
const fontsUrl = reel.fonts_url || 'https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@600;700&family=JetBrains+Mono:wght@500;600;700&family=Playfair+Display:ital,wght@0,900;1,700&family=Bangers&family=Cabin+Sketch:wght@700&family=Special+Elite&display=block';
const pageHtml = d => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fontsUrl}">
<style>${css}html,body,#stage{width:${W}px;height:${H}px}.ovsvg{width:${W}px;height:${H}px}.cmp-vs{left:${W / 2}px}${reel.css || ''}</style></head><body><div id="stage"></div>
<script>window.REEL=${JSON.stringify(d).replace(/</g, '\\u003c')};</script><script>${js}</script></body></html>`;
const html = pageHtml(data);
const htmlPath = path.join(build, 'index.html');
fs.writeFileSync(htmlPath, html);

// ---------- GPU first (see gpu.mjs): dedicated GPU → integrated graphics → CPU ----------
const GPU = gpuPref(SETTINGS);
const GPU_ARGS = browserGpuArgs(GPU);
const pickEncoder = prev => pickEncoderFor(prev, GPU);

// ---------- browser ----------
const { chromium } = await import('playwright-core');
async function launch() {
  const tries = [];
  if (process.env.CHROME_PATH) tries.push({ executablePath: process.env.CHROME_PATH });
  tries.push({}, { channel: 'chrome' }, { channel: 'msedge' }, { channel: 'chromium' });
  for (const o of tries) {
    try { return await chromium.launch({ ...o, args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--hide-scrollbars', ...GPU_ARGS] }); } catch (e) { /* try next */ }
  }
  throw new Error('No Chromium found. Install Google Chrome or set CHROME_PATH.');
}
const preview = flag('preview');
const scale = preview ? 0.5 : parseFloat(opt('scale', '1'));
const fps = parseInt(opt('fps', preview ? '15' : String(reel.format?.fps || 30)), 10);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
// parallel capture: frames are independent (window.__seek is stateless), so N tabs render them at once
const WORKERS = Math.max(1, Math.min(12, parseInt(opt('workers', SETTINGS.render?.workers || 0), 10) || Math.max(2, Math.min(8, Math.floor((await import('node:os')).cpus().length / 3)))));
const gpuName = await page.evaluate(() => { try { const g = document.createElement('canvas').getContext('webgl'), e = g && g.getExtension('WEBGL_debug_renderer_info');
  return g ? String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl').replace(/^ANGLE \([^,]*,\s*/, '').replace(/\s*\(0x[0-9A-F]+\).*$/i, '') : 'software'; } catch { return 'unknown'; } });
if (GPU !== 'off' && /intel|swiftshader|software|microsoft basic/i.test(gpuName) && GPU !== 'intel') console.warn(`! browser is drawing on ${gpuName}, not a discrete GPU`);
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', e => console.log('[page error]', e.message));
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await page.evaluate(() => window.__ready);
const fontsOk = await page.evaluate(() => document.fonts.check('400 100px Anton'));
if (!fontsOk) console.warn('! Anton font not loaded (offline?). Falling back to system fonts.');
const events = await page.evaluate(() => window.__events);
const fellBack = await page.evaluate(() => window.__fallbacks || 0);
if (fellBack) console.warn(`! ${fellBack} image(s) failed to load in the browser; their hand-drawn fallback was used.`);
const cdp = await page.context().newCDPSession(page);
async function grabOn(pg, session, time, type = 'jpeg', quality = parseInt(opt('quality', '90'), 10)) {
  await pg.evaluate(tt => window.__seek(tt), time);
  const r = await session.send('Page.captureScreenshot', { format: type, quality: type === 'jpeg' ? quality : undefined, optimizeForSpeed: true });
  return Buffer.from(r.data, 'base64');
}
const grab = (time, type, quality) => grabOn(page, cdp, time, type, quality);
const extraBrowsers = [];
async function openWorkers(n) {
  const out = [{ pg: page, cdp }];
  const PROCS = Math.max(1, parseInt(process.env.CLIFFHANGER_BROWSERS || SETTINGS.render?.browsers || '1', 10));
  const extra = await Promise.all(Array.from({ length: Math.min(PROCS, n) - 1 }, () => launch()));
  extraBrowsers.push(...extra);
  await Promise.all(Array.from({ length: n - 1 }, async (_, i) => {
    const host = [browser, ...extra][(i + 1) % Math.min(PROCS, n)];
    const pg = await host.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
    pg.on('pageerror', e => console.log('[page error]', e.message));
    await pg.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await pg.evaluate(() => window.__ready);
    out.push({ pg, cdp: await pg.context().newCDPSession(pg) });
  }));
  // every extra tab must draw burned captions exactly like the main tab (a tab that doesn't is reloaded, then dropped)
  const subs = data.subs || [];
  if (subs.length && out.length > 1) {
    const c = subs[Math.floor(subs.length / 2)], probeT = c.words[0].s + 0.05;
    const want = await page.evaluate(tt => window.__subsProbe(tt), probeT);
    for (let i = out.length - 1; i >= 1; i--) {
      let got = await out[i].pg.evaluate(tt => window.__subsProbe(tt), probeT);
      if (got !== want) {
        console.warn(`! capture tab ${i + 1}: captions differ from the main tab (${got} vs ${want}); reloading it`);
        await out[i].pg.reload({ waitUntil: 'load' }); await out[i].pg.evaluate(() => window.__ready);
        got = await out[i].pg.evaluate(tt => window.__subsProbe(tt), probeT);
        if (got !== want) { console.warn(`! capture tab ${i + 1}: still different, not using it`); await out[i].pg.close(); out.splice(i, 1); }
      }
    }
  }
  return out;
}

// ---------- engagement check (rules + sources: references/engagement.md) ----------
// Measurable things that move retention. It can't promise virality; it catches what reliably loses viewers.
function engagementCheck() {
  const out = [], add = (ok, rule, detail, fix) => out.push({ ok, rule, detail, fix: ok ? undefined : fix });
  const main = scenes.filter(x => !x._beatOf), first = main[0] || {};
  const words = main.flatMap(x => (x.words || []).map(w => ({ ...w, abs: x.start + w.s })));
  const firstWord = words.length ? words[0].abs : (first.vo ? first.vo_at : null);
  // 1. hook: narration starts at once
  if (firstWord != null) add(firstWord <= 0.6, 'Hook starts immediately', `first word at ${firstWord.toFixed(2)} s`, 'start the voice by 0.5 s: no intro, logo or silence at the start (lead: 0)');
  // 2. hook line: short curiosity line (best ~9 words in informational niches)
  const hookWords = String(first.vo || '').trim().split(/\s+/).filter(Boolean).length;
  if (hookWords) add(hookWords <= 14, 'Short hook line', `${hookWords} words in the first line`, 'cut the first line to a 6–12 word question or surprising claim');
  // 3. headline on screen within 1 s
  const hl = first.headline && (Array.isArray(first.headline) ? first.headline.length : 1);
  add(!!hl, 'Headline on screen at once', hl ? 'first scene has a headline' : 'first scene has no headline', 'give scene 1 a headline that states the question (works on mute)');
  // 4. pacing: a new visual every 2.5–4 s, nothing held longer than 5 s (8 s on 16:9 long-form)
  const ordered = [...scenes].sort((a, b) => a.start - b.start);
  const shots = ordered.map((x, i, arr) => (i + 1 < arr.length ? arr[i + 1].start : TOTAL) - x.start)
    .filter((d, i) => d > 0.05 && !(i === ordered.length - 1 && (WIDE || ordered[i].visual?.type === 'endcard')));   // end card holds on purpose
  const avg = shots.reduce((a, b) => a + b, 0) / Math.max(1, shots.length), longest = Math.max(...shots), cap = WIDE ? 8 : 5;
  add(avg >= 2 && avg <= (WIDE ? 6 : 4.5), 'Visual changes every 2.5–4 s', `average ${avg.toFixed(1)} s per visual`, avg < 2 ? 'slow down: under 2 s per shot lowers retention (too fast to follow)' : 'add "beats" (a new visual mid-line) so something changes every 2.5–4 s');
  add(longest <= cap + 0.5, `No visual held over ${cap} s`, `longest ${longest.toFixed(1)} s`, 'split the longest scene with beats or a cut-in (lens, chip, stamp)');
  // 5. length
  if (!WIDE) add(TOTAL >= 30 && TOTAL <= 90, 'Length 30–90 s (best 45–60)', `${TOTAL.toFixed(0)} s`, TOTAL > 180 ? 'over 3:00 is not shown to non-followers on Reels and is the Shorts maximum: cut it down' : TOTAL < 30 ? 'very short: data favour 30–60 s for reach' : 'aim for 45–60 s; trim weaker beats');
  // 6. narration pace
  const speech = main.reduce((a, x) => a + (x.vo_dur || 0), 0), nWords = main.reduce((a, x) => a + String(x.vo || '').trim().split(/\s+/).filter(Boolean).length, 0);
  if (speech > 5 && nWords) { const wpm = nWords / speech * 60; add(wpm >= 140 && wpm <= 215, 'Narration 160–190 words/min', `${wpm.toFixed(0)} wpm`, wpm < 140 ? 'too slow: run tighten.py (e.g. 1.14 0.24) or cut words' : 'too fast to follow: add pauses or split lines'); }
  // 7. headlines are keywords, not the transcript (redundant on-screen text hurts learning)
  const norm = x => String(x).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\u0900-\u097f ]/g, ' ').split(/\s+/).filter(Boolean);
  const copied = main.filter(x => x.headline && x.vo && (() => { const h = norm([].concat(x.headline).join(' ')), v = norm(x.vo); return h.length >= 6 && h.filter(w => v.includes(w)).length / h.length > 0.9 && h.length >= v.length * 0.7; })());
  add(!copied.length, 'Headlines are keywords, not the transcript', copied.length ? `${copied.length} scene(s) repeat the narration word for word` : 'short keyword headlines', `shorten: ${copied.slice(0, 3).map(x => x.id).join(', ')}`);
  // 8. ending opens a new question (Part 2) or loops back
  const last = [...main].reverse().find(x => x.vo) || {};
  const opens = /\?\s*$/.test(String(last.vo || '').trim()) || !!reel.series?.next || /part\s*2|next|tomorrow|follow/i.test(String(last.vo || ''));
  if (!WIDE) add(opens, 'Ending opens the next question', opens ? 'ends on a question / Part 2 tease' : 'ending closes everything', 'end on the new, related question Part 2 will answer (last 5 s)');
  // 9. 16:9: end card long enough for YouTube end screens (5–20 s)
  if (WIDE) { const endDur = (main[main.length - 1] || {}).dur || 0; add(endDur >= 8, 'End card covers the end screen', `last scene ${endDur.toFixed(1)} s`, 'give the end card "min": 18 so YouTube end-screen elements fit'); }
  const score = out.filter(x => x.ok).length;
  return { score: `${score}/${out.length}`, checks: out };
}
function printEngagement(e) {
  console.log(`\nEngagement check: ${e.score}  (rules and sources: references/engagement.md)`);
  for (const c of e.checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.rule}: ${c.detail}${c.ok ? '' : '\n      → ' + c.fix}`);
}

function chaptersText() {
  const ch = scenes.filter(s => s.chapter && !s._beatOf).map(s => ({ t: s.start, title: String(s.chapter) }));
  if (!ch.length) return null;
  if (ch[0].t > 0.5) ch.unshift({ t: 0, title: reel.chapter_intro || 'Intro' });
  ch[0].t = 0;
  const fmt = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`; };
  const warn = [];
  if (ch.length < 3) warn.push('YouTube needs at least 3 chapters');
  ch.forEach((c, i) => { const end = i + 1 < ch.length ? ch[i + 1].t : TOTAL; if (end - c.t < 10) warn.push(`"${c.title}" is shorter than 10 s (YouTube minimum)`); });
  return { text: ch.map(c => `${fmt(c.t)} ${c.title}`).join('\n') + '\n', warn };
}
const slug = (reel.slug || reel.title || path.basename(proj)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reel';
const ff = (a, quiet = true) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', quiet ? 'error' : 'info', '-y', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error('ffmpeg failed:', a.join(' ').slice(0, 300), '\n', r.stderr); throw new Error('ffmpeg failed'); }
  return r;
};

// ---------- designed cover: big headline + hero visual + series tag (out/cover.png, out/cover-grid.jpg) ----------
async function makeCover() {
  const cv = reel.cover || {};
  const cs = scenes.find(x => x.id === cv.scene) || scenes.find(x => x.visual && x.visual.type !== 'endcard') || scenes[0];
  const sc = JSON.parse(JSON.stringify(cs));
  Object.assign(sc, { id: 'cover', start: 0, end: 3, dur: 3, vo_at: 0, vo_dur: 0, words: [], transition: 'cut', camera: 'none',
    headline_static: true, headline_fx: null, sfx: [], ambience: null, film_fx: false, beats: undefined, chrome: true });
  sc.theme = cv.theme || cs.theme;
  sc.headline = cv.text || cs.headline || [reel.title.toUpperCase()];
  sc.headline_size = cv.size || 150; sc.headline_y = cv.y || 250; sc.headline_style = cv.headline_style || (sc.theme === 'photo' ? 'label' : '');
  if (reel.series?.name) { sc.section = reel.series.name; sc.fig = reel.series.part; }
  if (sc.visual) Object.assign(sc.visual, { at: 0, enter: 'none', motion: 'none', reveal_at: 0, mystery: cv.keep_mystery ? sc.visual.mystery : false }, cv.visual || {});
  const keep = (sc.overlays || []).filter(o => cv.keep_overlays || o.type === 'art')       // illustrations are part of the picture
    .map(o => ({ ...o, at: 0, enter: 'none', reveal_at: 0, mystery: false, sfx: undefined }));
  if (reel.series?.part) keep.push({ type: 'tag', kicker: String(reel.series.name || '').toUpperCase(), text: `PART ${reel.series.part}`, x: cv.tag_x || 270, y: cv.tag_y || (WIDE ? H - 170 : 1560), rot: -4, at: 0, enter: 'none' });
  sc.overlays = keep;
  const d = { ...data, scenes: [sc], total: 3, subs: [], subtitles: null, transition: 'cut', camera: 'none' };
  const cp = path.join(build, 'cover.html'); fs.writeFileSync(cp, pageHtml(d));
  const pg = await browser.newPage({ viewport: { width: W, height: H } });
  await pg.goto(pathToFileURL(cp).href, { waitUntil: 'load' }); await pg.evaluate(() => window.__ready);
  await pg.evaluate(() => window.__seek(2.95));
  const png = path.join(outDir, 'cover.png'); await pg.screenshot({ path: png }); await pg.close();
  if (WIDE) ff(['-i', png, '-vf', 'scale=1280:720', '-frames:v', '1', '-update', '1', '-q:v', '2', path.join(outDir, 'thumbnail.jpg')]);   // YouTube thumbnail (1280x720)
  else ff(['-i', png, '-vf', 'crop=1080:1440:0:240', '-frames:v', '1', '-update', '1', '-q:v', '3', path.join(outDir, 'cover-grid.jpg')]);   // what the profile grid shows
  return png;
}
if (flag('cover')) { const c = await makeCover(); await browser.close(); console.log(JSON.stringify({ cover: c, grid: path.join(outDir, WIDE ? 'thumbnail.jpg' : 'cover-grid.jpg') }, null, 1)); process.exit(0); }

// ---------- QA modes ----------
if (flag('stills') || opt('at')) {
  const dir = path.join(build, 'stills'); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.rmSync(path.join(dir, f), { force: true });
  const shots = opt('at')
    ? opt('at').split(',').map(Number).map((tt, i) => ({ tt, name: `${String(i + 1).padStart(2, '0')}`, id: tt + 's' }))
    : scenes.map((s, i) => {
        let tt = Math.min(s.end - 0.05, s.start + Math.max(s.dur * 0.82, s.dur - 0.35));
        if (data.subs?.length) {      // burned captions: pick a moment inside the scene's last caption, so stills show them
          const c = [...data.subs].reverse().find(c => c.t0 >= s.start - 0.05 && c.t0 < s.end - 0.2);
          if (c) tt = Math.min(s.end - 0.05, c.words[c.words.length - 1].e + 0.02);
        }
        return { tt, name: `${String(i + 1).padStart(2, '0')}`, id: s.id };
      });
  for (const sh of shots) fs.writeFileSync(path.join(dir, sh.name + '.png'), await grab(sh.tt, 'png'));
  const safe = opt('at') ? [] : await page.evaluate(() => window.__safeCheck());
  await browser.close();
  const maxScene = reel.max_scene_seconds || (WIDE ? Math.max(8, SETTINGS.content?.max_scene_seconds || 0) : SETTINGS.content?.max_scene_seconds || 5);
  const long = scenes.filter(x => !x._beatOf && x.visual?.type !== 'endcard' && x.dur > maxScene && !scenes.some(y => y._beatOf === x.id));
  if (safe.length) { console.warn(`! ${safe.length} element(s) in platform UI zones (covered by buttons/captions on Instagram/TikTok):`); for (const w of safe) console.warn(`   - ${w.scene}: "${w.what}" → ${w.zone}`); }
  if (long.length) { console.warn(`! ${long.length} scene(s) longer than ${maxScene}s on one visual (add "beats" for a new visual mid-line):`); for (const x of long) console.warn(`   - ${x.id}: ${x.dur.toFixed(1)}s`); }
  const cols = Math.min(6, shots.length), rows = Math.ceil(shots.length / cols);
  const contact = path.join(build, 'contact.jpg');
  ff(['-framerate', '1', '-start_number', '1', '-i', path.join(dir, '%02d.png'), '-vf', `scale=300:-1,tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', '-update', '1', contact]);
  const chs = chaptersText(), eng = opt('at') ? null : engagementCheck();
  console.log(JSON.stringify({ mode: 'stills', dir, contact, total: TOTAL, frames: shots.map(s => `${s.name}.png = ${s.id} @${s.tt.toFixed(2)}s`),
    scene_starts: scenes.map(s => `${s.id} ${s.start.toFixed(2)}${s.transition ? ' ' + s.transition : ''}`),
    ...(chs ? { chapters: chs.text.trim().split('\n'), chapter_warnings: chs.warn } : {}),
    ...(AI_MISSING.length ? { ai_images_missing: AI_MISSING } : {}), ...(eng ? { engagement: eng.score } : {}) }, null, 1));
  if (eng) printEngagement(eng);
  aiMissingNote();
  process.exit(0);
}

// ---------- full render: video ----------
const nFrames = Math.ceil(TOTAL * fps);
const silent = path.join(build, preview ? 'video_preview.mp4' : 'video.mp4');
if (flag('remux') && fs.existsSync(silent)) { console.log('--remux: reusing ' + silent); await browser.close(); }
else {
const encoder = pickEncoder(preview);
console.log(`gpu: draw = ${gpuName} · encode = ${encoder.name}`);
for (const w of encoder.why) console.warn(`! GPU encoder skipped → ${w}`);
const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
  ...encoder.args, '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
const workers = await openWorkers(Math.min(WORKERS, Math.max(1, Math.ceil(nFrames / 30))));
console.log(`capture: ${workers.length} parallel tab(s)`);
// workers grab frames in any order; the writer feeds ffmpeg strictly in order, with a bounded buffer
const ready = new Map(); let next = 0, written = 0, wake = null, lastTick = 0, slowWarned = false;
const RUN = 4;                                    // each tab renders short runs of consecutive frames
const LIMIT = workers.length * RUN * 2;
const waitFor = () => new Promise(r => { wake = r; });
const poke = () => { if (wake) { const w = wake; wake = null; w(); } };
const writer = (async () => {
  while (written < nFrames) {
    if (!ready.has(written)) { await waitFor(); continue; }
    const buf = ready.get(written); ready.delete(written); written++; poke();
    if (!enc.stdin.write(buf)) await once(enc.stdin, 'drain');
    if (written % (fps * 5) === 0) {
      const now = Date.now(), el = (now - t0) / 1000, rate = written / Math.max(el, 0.001);
      const recent = (fps * 5) / Math.max((now - (lastTick || t0)) / 1000, 0.001); lastTick = now;
      if (written > fps * 15 && recent < rate * 0.25 && !slowWarned) { slowWarned = true; console.warn(`\n! rendering slowed to ${recent.toFixed(1)} fps (was ${rate.toFixed(1)}): is the computer going to sleep or overheating? Keep it awake and plugged in.`); }
      const eta = (nFrames - written) / Math.max(rate, 0.001);
      process.stdout.write(`\rframe ${written}/${nFrames}  ${el.toFixed(0)}s  ${rate.toFixed(1)} fps  ETA ${eta >= 60 ? Math.floor(eta / 60) + 'm ' : ''}${Math.round(eta % 60)}s   `);
    }
  }
})();
await Promise.all(workers.map(async w => {
  while (true) {
    while (next - written > LIMIT) await new Promise(r => setTimeout(r, 4));
    const f0 = next; next += RUN;
    if (f0 >= nFrames) return;
    for (let f = f0; f < Math.min(f0 + RUN, nFrames); f++) { ready.set(f, await grabOn(w.pg, w.cdp, f / fps)); poke(); }
  }
}));
await writer;
for (const w of workers.slice(1)) await w.pg.close();
for (const b of extraBrowsers) await b.close();
enc.stdin.end(); await once(enc, 'close');
if (!preview) { try { await makeCover(); } catch (e) { console.warn('! cover failed: ' + e.message); } }
await browser.close();
const secs = (Date.now() - t0) / 1000;
console.log(`\rvideo frames done: ${nFrames} in ${secs.toFixed(0)}s (${(nFrames / secs).toFixed(1)} fps, ${workers.length} tab(s), ${encoder.name})`);
}

// ---------- audio ----------
const finalPath = path.join(outDir, `${slug}${preview ? '_preview' : ''}.mp4`);
const audioCfg = Object.assign({ bed: 'drone', bed_volume: 0.07, music: null, music_volume: 0.18, sfx: true, sfx_volume: 1, lufs: -14 }, reel.audio || {});
const voScenes = scenes.filter(s => timings.scenes[s.id] && fs.existsSync(path.resolve(proj, timings.scenes[s.id].file)));
if (flag('no-audio') || !voScenes.length) {
  if (!voScenes.length) console.warn('! No voiceover found — rendering silent video.');
  fs.copyFileSync(silent, finalPath);
} else {
  const sfxDir = path.join(build, 'sfx'); fs.mkdirSync(sfxDir, { recursive: true });
  const { PRESETS, presetFile, aiSfx, findSound, REAL, REAL_DUR } = await import('./sfx.mjs');
  const { addCredit } = await import('./library.mjs');
  const realOn = audioCfg.real_sfx !== false, netOk = !flag('offline');
  let realUsed = 0;
  const inputs = []; const chains = []; const voLabels = []; const fxLabels = []; let nIn = 0;
  const add = (f, loop) => { if (loop) inputs.push('-stream_loop', '-1'); inputs.push('-i', f); return nIn++; };
  const ms = x => Math.max(0, Math.round(x * 1000));
  for (const s of voScenes) {
    const k = add(path.resolve(proj, timings.scenes[s.id].file));
    chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms(s.vo_at)}:all=1[v${k}]`); voLabels.push(`[v${k}]`);
  }
  if (audioCfg.sfx !== false) {
    let aiOk = audioCfg.ai_sfx === true, aiUsed = 0, aiFell = 0;
    for (const [ei, e] of events.entries()) {
      if (e.t >= TOTAL) continue;
      let file = null, natural = null;
      const lib = async q => {                                       // local packs + free CC0 recordings (cached for every project)
        const r = await findSound(q, { proj, allowNetwork: netOk, variant: ei });
        if (!r) return null;
        if (r.credit) addCredit(proj, 'sound', path.relative(proj, r.file).replace(/\\/g, '/'), r.credit);
        realUsed++; return r.file;
      };
      if (e.file) { const p = path.resolve(proj, e.file); if (fs.existsSync(p)) file = p; else console.warn('! sound file missing: ' + e.file); }
      if (!file && e.find) { file = await lib(e.find); if (file) natural = 2.5; }
      if (!file && e.prompt) {
        const r = await aiSfx(e, { allowNetwork: aiOk });            // cached sounds are reused even when ai_sfx is off
        if (r === 'DENIED') { aiOk = false; } else if (r) { file = r; aiUsed++; } else aiFell++;
      }
      if (!file && realOn && REAL[e.type]) { file = await lib(REAL[e.type]); if (file) natural = REAL_DUR[e.type] || 1.5; }
      if (!file) file = presetFile(e.fallback && PRESETS[e.fallback] ? e.fallback : (PRESETS[e.type] ? e.type : 'swish'), sfxDir);
      if (!file) continue;
      const k = add(file, e.loop);
      const d = e.dur || (e.loop ? 4 : natural);
      const trim = d ? `atrim=0:${Math.max(0.1, Math.min(d, TOTAL - e.t)).toFixed(3)},afade=t=out:st=${Math.max(0, Math.min(d, TOTAL - e.t) - 0.12).toFixed(3)}:d=0.12,` : '';
      const fadeIn = e.loop ? 'afade=t=in:d=0.3,' : '';
      chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim}${fadeIn}volume=${(e.vol * (audioCfg.sfx_volume ?? 1)).toFixed(3)},adelay=${ms(e.t)}:all=1[x${k}]`); fxLabels.push(`[x${k}]`);
    }
    if (aiUsed || aiFell || realUsed) console.log(`sfx: ${realUsed} real recordings, ${aiUsed} AI sounds${aiFell ? `, ${aiFell} AI cues fell back${audioCfg.ai_sfx ? '' : ' (AI sound effects are off in settings)'}` : ''}`);
  }
  let bedLabel = null;
  if (!audioCfg.music && audioCfg.music_mood && audioCfg.music_mood !== 'none') {     // free real music by mood (CC0 / CC BY)
    const { findMusic } = await import('./sfx.mjs');
    const r = await findMusic(audioCfg.music_mood, { key: slug, allowNetwork: !flag('offline') });
    if (r) {
      audioCfg.music = r.file; audioCfg.music_volume = audioCfg.music_volume ?? 0.18;
      const { addCredit } = await import('./library.mjs'); if (r.credit) addCredit(proj, 'music', 'music: ' + path.basename(r.file), r.credit);
      console.log(`music: "${r.credit?.title}" by ${r.credit?.creator || 'unknown'} (${r.credit?.licence})`);
    } else console.warn(`! no "${audioCfg.music_mood}" music found; using the ${audioCfg.bed || 'drone'} bed`);
  }
  if (audioCfg.music) {
    const k = add(path.resolve(proj, audioCfg.music));
    chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,atrim=0:${TOTAL},volume=${audioCfg.music_volume},afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, TOTAL - 1.5)}:d=1.5[bedraw]`);
    bedLabel = '[bedraw]';
  } else if (audioCfg.bed && audioCfg.bed !== 'none') {
    const { bedFile, aiMusic } = await import('./sfx.mjs');
    let f = null;
    if (audioCfg.music_prompt && audioCfg.ai_music) f = await aiMusic(audioCfg.music_prompt, TOTAL);
    const k = f ? add(f) : add(bedFile(audioCfg.bed, TOTAL, sfxDir) || bedFile('drone', TOTAL, sfxDir));
    const v = f ? (audioCfg.music_volume ?? 0.18) : audioCfg.bed_volume * 4;
    chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${TOTAL},volume=${v}[bedraw]`); bedLabel = '[bedraw]';
  }
  const g = [...chains];
  g.push(`${voLabels.join('')}amix=inputs=${voLabels.length}:normalize=0:dropout_transition=0,apad,atrim=0:${TOTAL}[vo]`);
  const mixIn = [];
  if (bedLabel) { g.push(`[vo]asplit=2[vo1][vo2]`, `${bedLabel}[vo2]sidechaincompress=threshold=0.02:ratio=9:attack=15:release=380[bed]`); mixIn.push('[vo1]', '[bed]'); }
  else mixIn.push('[vo]');
  if (fxLabels.length) { g.push(`${fxLabels.join('')}amix=inputs=${fxLabels.length}:normalize=0:dropout_transition=0,apad,atrim=0:${TOTAL}[fx]`); mixIn.push('[fx]'); }
  g.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:dropout_transition=0,atrim=0:${TOTAL},loudnorm=I=${audioCfg.lufs}:TP=-1.5:LRA=11,alimiter=limit=0.66:level=false,aresample=48000[out]`);
  const script = path.join(build, 'mix.filter'); fs.writeFileSync(script, g.join(';\n'));
  const mix = path.join(build, 'mix.wav');
  try { ff([...inputs, '-/filter_complex', script, '-map', '[out]', '-ac', '2', mix]); }          // ffmpeg >= 7.1
  catch { ff([...inputs, '-filter_complex_script', script, '-map', '[out]', '-ac', '2', mix]); }  // older ffmpeg
  ff(['-i', silent, '-i', mix, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', finalPath]);
}

// ---------- SRT ----------
const fmtT = x => { const h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, s = Math.floor(x) % 60, ms = Math.round((x % 1) * 1000) % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
const cues = [];
for (const s of scenes) {
  if (!s.vo) continue;
  if (s.words.length) {
    // restore punctuation/casing from the script: TTS word events often drop it
    const toks = String(s.vo).split(/\s+/).filter(Boolean);
    const nz = x => String(x).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
    let k = 0;
    s.words = s.words.map(w => {
      for (let j = k; j < Math.min(toks.length, k + 4); j++) {
        const a = nz(toks[j]), b = nz(w.w);
        if (a && b && (a === b || a.startsWith(b) || b.startsWith(a))) { k = j + 1; return { ...w, w: toks[j] }; }
      }
      return w;
    });
    let chunk = [];
    const flush = () => { if (chunk.length) cues.push([s.start + chunk[0].s, s.start + chunk[chunk.length - 1].e, chunk.map(w => w.w).join(' ')]); chunk = []; };
    for (const w of s.words) { chunk.push(w); if (chunk.length >= 6 || /[.,!?;:।]$/.test(w.w)) flush(); }
    flush();
  } else cues.push([s.vo_at, s.vo_at + s.vo_dur, s.vo]);
}
const srtPath = path.join(outDir, `${slug}.srt`);
fs.writeFileSync(srtPath, cues.map((c, i) => `${i + 1}\n${fmtT(c[0])} --> ${fmtT(Math.max(c[1], c[0] + 0.3))}\n${c[2]}\n`).join('\n'));
// Roman subtitles for non-Latin voiceovers (scene.vo_roman): each Roman sentence takes its native sentence's timing
const romanCues = romanCuesFor(scenes);
if (romanCues.length) fs.writeFileSync(path.join(outDir, `${slug}-roman.srt`), romanCues.map((c, i) => `${i + 1}\n${fmtT(c[0])} --> ${fmtT(Math.max(c[1], c[0] + 0.4))}\n${c[2]}\n`).join('\n'));
function romanCuesFor(list) {
  const END = /(\.\.\.|[.?!۔؟।])$/;
  const sentences = t => { const o = []; let c = []; for (const w of String(t).split(/\s+/).filter(Boolean)) { c.push(w); if (END.test(w)) { o.push(c); c = []; } } if (c.length) o.push(c); return o; };
  const out = [];
  for (const s of list) {
    if (!s.vo_roman || !s.vo) continue;
    const rs = sentences(s.vo_roman), us = sentences(s.vo), W = s.words || [];
    if (W.length && rs.length === us.length && W.length === us.reduce((n, u) => n + u.length, 0)) {
      let i = 0; for (let k = 0; k < rs.length; k++) { out.push([s.start + W[i].s, s.start + W[i + us[k].length - 1].e, rs[k].join(' ')]); i += us[k].length; }
    } else out.push([s.vo_at, s.vo_at + s.vo_dur, s.vo_roman]);
  }
  return out;
}

// ---------- contact sheet of the final file ----------
const sheet = path.join(outDir, 'contact.jpg');
ff(['-i', finalPath, '-vf', `fps=${Math.max(0.2, 24 / TOTAL).toFixed(3)},scale=270:-1,tile=6x4:padding=6:color=white`, '-frames:v', '1', sheet]);
if (reel.series?.name && !preview) {        // keep the workspace's series memory current
  try { const { syncSeries } = await import('./series.mjs'); syncSeries(path.dirname(proj)); } catch (e) { console.warn('! series sync skipped: ' + e.message); }
}
const { readCredits, creditLine } = await import('./library.mjs');
const credits = readCredits(proj);
let creditsPath = null;
if (credits.length && !preview) {
  creditsPath = path.join(outDir, 'credits.txt');
  fs.writeFileSync(creditsPath, 'Credits (paste into the description; CC BY items require it):\n' + credits.map(c => '- ' + creditLine(c)).join('\n') + '\n');
}
if (!preview) {
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(TIMELINE, null, 1));
  fs.writeFileSync(path.join(outDir, 'engagement.json'), JSON.stringify(engagementCheck(), null, 1));   // read by batch.mjs review page
}
const chs = preview ? null : chaptersText();
let chaptersPath = null;
if (chs) { chaptersPath = path.join(outDir, 'chapters.txt'); fs.writeFileSync(chaptersPath, chs.text); for (const w of chs.warn) console.warn('! chapters: ' + w); }
console.log(JSON.stringify({ video: finalPath, srt: srtPath, contact: sheet, duration: TOTAL, fps, frames: nFrames, ...(chaptersPath ? { chapters: chaptersPath } : {}), ...(creditsPath ? { credits: creditsPath } : {}), ...(AI_MISSING.length ? { ai_images_missing: AI_MISSING } : {}) }, null, 1));
aiMissingNote();
