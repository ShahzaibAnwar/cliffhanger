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
const SUBS = deepMerge({ burn: false, style: 'word', y: 1500, size: 60, max_words: 4, lang: 'auto' }, deepMerge(SETTINGS.subtitles || {}, reel.subtitles || {}));
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
    } else if ((k === 'image' || k === 'bg_image') && typeof o[k] === 'string' && !/^(https?|data|file):/.test(o[k])) {
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
  if (AI_MISSING.length) console.warn(`! ${AI_MISSING.length} AI image(s) not generated yet (using svg_file fallback where given). Run: node scripts/imagegen.mjs "${proj}"\n  ` + AI_MISSING.join('\n  '));
}
// repeated as the last thing printed, so it can't scroll away unnoticed
const aiMissingNote = () => { if (AI_MISSING.length) console.warn(`\n!!! ${AI_MISSING.length} AI image(s) were NOT generated: these scenes show the hand-drawn fallback.\n!!! Run  node scripts/imagegen.mjs "${proj}"  and render again.`); };
resolveAssets(scenes);

// canvas size: vertical by default; reel.format.width/height switches it (e.g. 1920x1080 for long-form)
const W = parseInt(reel.format?.width || 1080, 10), H = parseInt(reel.format?.height || 1920, 10), WIDE = W > H;
const data = {
  size: { w: W, h: H }, layout: reel.layout || null,
  brand: Object.assign({ name: 'YOUR BRAND', accent: '#C8302A' }, reel.brand || {}),
  scenes, total: TOTAL,
  transition: ANIM.transition || 'auto', camera: ANIM.camera || 'push', film_fx: ANIM.film_fx !== false,
  art_enter: ANIM.sketch_art ? 'sketch' : (ANIM.art_enter || 'fadeUp'), headline_fx: ANIM.headline_fx || null,
  // collage look (from paper cut-out explainers): cut-out finish, stop-motion on twos, scribble wipes
  finish: ANIM.finish || (ANIM.look === 'collage' ? 'collage' : null),
  stop_motion: ANIM.stop_motion != null ? ANIM.stop_motion : (ANIM.look === 'collage' ? 2 : null),
  backing: ANIM.backing || null, backing_color: ANIM.backing_color || null, transition_color: ANIM.transition_color || null,
  subtitles: SUBS.burn ? SUBS : null, subs: SUBS.burn ? subtitleChunks() : [],
};
const css = fs.readFileSync(path.join(HERE, 'engine', 'engine.css'), 'utf8');
const js = fs.readFileSync(path.join(HERE, 'engine', 'engine.js'), 'utf8');
const fontsUrl = reel.fonts_url || 'https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@600;700&family=JetBrains+Mono:wght@500;600;700&family=Playfair+Display:wght@900&display=block';
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
  return out;
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
    : scenes.map((s, i) => ({ tt: Math.min(s.end - 0.05, s.start + Math.max(s.dur * 0.82, s.dur - 0.35)), name: `${String(i + 1).padStart(2, '0')}`, id: s.id }));
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
  const chs = chaptersText();
  console.log(JSON.stringify({ mode: 'stills', dir, contact, total: TOTAL, frames: shots.map(s => `${s.name}.png = ${s.id} @${s.tt.toFixed(2)}s`),
    scene_starts: scenes.map(s => `${s.id} ${s.start.toFixed(2)}${s.transition ? ' ' + s.transition : ''}`),
    ...(chs ? { chapters: chs.text.trim().split('\n'), chapter_warnings: chs.warn } : {}),
    ...(AI_MISSING.length ? { ai_images_missing: AI_MISSING } : {}) }, null, 1));
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
  const { PRESETS, presetFile, aiSfx } = await import('./sfx.mjs');
  const inputs = []; const chains = []; const voLabels = []; const fxLabels = []; let nIn = 0;
  const add = (f, loop) => { if (loop) inputs.push('-stream_loop', '-1'); inputs.push('-i', f); return nIn++; };
  const ms = x => Math.max(0, Math.round(x * 1000));
  for (const s of voScenes) {
    const k = add(path.resolve(proj, timings.scenes[s.id].file));
    chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms(s.vo_at)}:all=1[v${k}]`); voLabels.push(`[v${k}]`);
  }
  if (audioCfg.sfx !== false) {
    let aiOk = audioCfg.ai_sfx === true, aiUsed = 0, aiFell = 0;
    for (const e of events) {
      if (e.t >= TOTAL) continue;
      let file = null;
      if (e.prompt) {
        const r = await aiSfx(e, { allowNetwork: aiOk });            // cached sounds are reused even when ai_sfx is off
        if (r === 'DENIED') { aiOk = false; } else if (r) { file = r; aiUsed++; }
        if (!file) { aiFell++; file = presetFile(e.fallback && PRESETS[e.fallback] ? e.fallback : (PRESETS[e.type] ? e.type : 'swish'), sfxDir); }
      } else file = presetFile(e.type, sfxDir);
      if (!file) continue;
      const k = add(file, e.loop);
      const d = e.dur || (e.loop ? 4 : null);
      const trim = d ? `atrim=0:${Math.max(0.1, Math.min(d, TOTAL - e.t)).toFixed(3)},afade=t=out:st=${Math.max(0, Math.min(d, TOTAL - e.t) - 0.12).toFixed(3)}:d=0.12,` : '';
      const fadeIn = e.loop ? 'afade=t=in:d=0.3,' : '';
      chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim}${fadeIn}volume=${(e.vol * (audioCfg.sfx_volume ?? 1)).toFixed(3)},adelay=${ms(e.t)}:all=1[x${k}]`); fxLabels.push(`[x${k}]`);
    }
    if (aiUsed || aiFell) console.log(`sfx: ${aiUsed} AI sounds${aiFell ? `, ${aiFell} fell back to presets${audioCfg.ai_sfx ? '' : ' (AI sound effects are off in settings)'}` : ''}`);
  }
  let bedLabel = null;
  if (audioCfg.music) {
    const k = add(path.resolve(proj, audioCfg.music));
    chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,atrim=0:${TOTAL},volume=${audioCfg.music_volume},afade=t=out:st=${Math.max(0, TOTAL - 1.5)}:d=1.5[bedraw]`);
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
const chs = preview ? null : chaptersText();
let chaptersPath = null;
if (chs) { chaptersPath = path.join(outDir, 'chapters.txt'); fs.writeFileSync(chaptersPath, chs.text); for (const w of chs.warn) console.warn('! chapters: ' + w); }
console.log(JSON.stringify({ video: finalPath, srt: srtPath, contact: sheet, duration: TOTAL, fps, frames: nFrames, ...(chaptersPath ? { chapters: chaptersPath } : {}), ...(AI_MISSING.length ? { ai_images_missing: AI_MISSING } : {}) }, null, 1));
aiMissingNote();
