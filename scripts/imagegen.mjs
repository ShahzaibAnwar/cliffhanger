#!/usr/bin/env node
/* Cliffhanger AI illustrations — free tiers of Cloudflare Workers AI (FLUX schnell) and Google Gemini.

   In reel.json, any art object can ask for an image instead of (or as well as) an SVG:
     { "type": "art", "image_prompt": "human brain, side view", "image_style": "engraving", "svg_file": "@lib/brain.svg" }
   and a photo scene can ask for a background:  { "theme": "photo", "bg_prompt": "mosquito on a bedroom wall at night" }
   svg_file stays as the fallback when the image hasn't been generated.

     node imagegen.mjs <project>                    generate every missing image (cached in <project>/art/gen/)
     node imagegen.mjs <project> --force            regenerate all
     node imagegen.mjs --test "a glass of water" [--style engraving] [--provider cloudflare|gemini] [--out f.png]
     node imagegen.mjs --styles                     list styles

   Same person in every scene: define reel.characters = { "sleeper": { "look": "..." } } and put
   "character": "sleeper" on each object. The first image of that character becomes the reference for the
   rest (Cloudflare FLUX.2 [klein], free; or Gemini).

   Provider "auto": Cloudflare if configured (FLUX schnell, or FLUX.2 when there is a reference image),
   else Gemini. Keys: settings page (node settings.mjs) → Images, or env vars
   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, GEMINI_API_KEY. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readEnv, loadSettings } from './settings-lib.mjs';

const NO_TEXT = 'Absolutely no text, letters, numbers, captions, labels, signatures or watermark. No border, no frame, no plate lines, no box around the subject.';
// bg: what the image background will be → how it blends into the reel (multiply on paper, screen on dark)
export const STYLES = {
  engraving: { bg: 'light', d: 'vintage medical engraving, cross-hatching (paper scenes)',
    p: s => `Vintage scientific engraving illustration of ${s}. Detailed cross-hatching and fine ink line work, muted natural colours with deep red accents, in the style of 19th-century scientific engraving. One isolated subject, centred, on a plain flat off-white paper background with a generous empty margin. ${NO_TEXT}` },
  'engraving-dark': { bg: 'dark', d: 'same engraving look on black (dark scenes)',
    p: s => `Vintage scientific engraving illustration of ${s}. Detailed cross-hatching and fine line work in warm cream and deep red tones. One isolated subject, centred, on a pure solid black background with a generous empty margin. ${NO_TEXT}` },
  diagram: { bg: 'light', d: 'anatomical cutaway, ink + watercolour (paper)',
    p: s => `Hand-drawn anatomical cutaway diagram of ${s}, vintage textbook illustration, confident ink outlines with soft watercolour shading in flesh pinks and deep reds. Isolated and centred on a plain off-white paper background with a generous empty margin. ${NO_TEXT}` },
  xray: { bg: 'dark', d: 'glowing blue x-ray (dark scenes)',
    p: s => `Glowing translucent blue x-ray radiograph of ${s}, fine medical detail, soft cyan glow. Isolated and centred on a pure solid black background with a generous empty margin. ${NO_TEXT}` },
  photo: { bg: 'light', d: 'photoreal studio cutout (paper)',
    p: s => `Photorealistic studio photograph of ${s}. Isolated and centred on a plain pure white background, soft even lighting, sharp focus, generous empty margin. ${NO_TEXT}` },
  'photo-dark': { bg: 'dark', d: 'photoreal with rim light on black (dark scenes)',
    p: s => `Photorealistic photograph of ${s}, dramatic rim light, isolated and centred on a pure solid black background, generous empty margin. ${NO_TEXT}` },
  cinematic: { bg: 'full', aspect: '9:16', d: 'full-bleed moody photo (photo-theme backgrounds)',
    p: s => `Cinematic moody photograph: ${s}. Shallow depth of field, warm practical lamp light, subtle film grain, vertical 9:16 composition with empty space in the top third for a headline. ${NO_TEXT}` },
};

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function styleFor(spec, theme, cfg) {
  if (spec.image_style) return spec.image_style;
  if (spec._bg) return 'cinematic';
  const base = cfg.style && cfg.style !== 'auto' ? cfg.style : 'engraving';
  if (theme === 'dark') return STYLES[base + '-dark'] ? base + '-dark' : (STYLES[base].bg === 'dark' ? base : 'engraving-dark');
  return STYLES[base].bg === 'dark' && STYLES[base.replace(/-dark$/, '')] ? base.replace(/-dark$/, '') : base;
}
function fileHash(p) { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10); }

// Deterministic identity of an image request (provider-independent, so renders find it later).
export function genKey(spec, theme, cfg, proj) {
  const style = styleFor(spec, theme, cfg);
  if (!STYLES[style]) throw new Error(`unknown image_style "${style}" (see: node imagegen.mjs --styles)`);
  const ref = spec.image_ref ? path.resolve(proj, spec.image_ref) : null;
  const h = crypto.createHash('sha1').update(JSON.stringify([spec.image_prompt, style, spec.image_seed ?? 0, ref && fs.existsSync(ref) ? fileHash(ref) : null])).digest('hex').slice(0, 10);
  return { style, ref, hash: h, base: path.join(proj, 'art', 'gen', `${slug(spec.image_prompt)}-${h}`) };
}
export function findGenerated(base) {
  for (const ext of ['.png', '.jpg', '.webp']) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

// Walk a reel: every object with image_prompt (and scene bg_prompt) → {spec, theme, setImage(rel)}
// "image_key" shares ONE generated picture across scenes (paper and dark alike): the first object with that
// key and an image_prompt defines it; later objects can carry just the key.
export function collect(reel) {
  const out = [], canon = {};
  for (const s of reel.scenes) {
    const theme = s.theme || 'paper';
    if (s.bg_prompt) out.push({ spec: { image_prompt: s.bg_prompt, image_style: s.bg_style || 'cinematic', image_seed: s.bg_seed, _bg: true }, theme, useTheme: theme, target: s, key: 'bg_image', scene: s.id });
    const visit = o => {
      if (Array.isArray(o)) return o.forEach(visit);
      if (!o || typeof o !== 'object') return;
      if (o.image_prompt || o.image_key) {
        let spec = o, th = theme;
        if (o.image_key) {
          if (!canon[o.image_key] && o.image_prompt) canon[o.image_key] = { spec: o, theme };
          if (canon[o.image_key]) ({ spec, theme: th } = canon[o.image_key]);
        }
        if (spec.image_prompt) out.push({ spec, theme: th, useTheme: theme, target: o, key: 'image', scene: s.id });
      }
      for (const k of Object.keys(o)) if (k !== 'svg') visit(o[k]);
    };
    visit(s.visual); visit(s.overlays); visit(s.beats);
  }
  return out;
}

// Hand-drawn library fallback chosen by keyword when an AI object has no svg_file of its own.
const LIB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'art');
const LIB_WORDS = [['heart', /\bheart|cardi/], ['brain', /\bbrain|cerebr|neuro(?!n)/], ['neuron', /\bneuron|nerve cell|axon|synap/],
  ['eye', /\beye|retina|pupil|iris/], ['skull', /\bskull|skeleton|bone|death/], ['dna', /\bdna|gene|helix|chromosom/],
  ['virus', /\bvirus|viral|germ|bacteri|pathogen|infect|microb/], ['syringe', /\bsyringe|needle|inject|vaccin/],
  ['glass', /\bglass|water|drink|thirst/], ['magnifier', /\bmagnif|lens|investigat|clue/], ['arm', /\barm\b|hand|wrist|skin|reach/]];
export function libraryFallback(prompt) {
  const t = String(prompt || '').toLowerCase();
  for (const [name, re] of LIB_WORDS) if (re.test(t) && fs.existsSync(path.join(LIB_DIR, name + '.svg'))) return '@lib/' + name + '.svg';
  return null;
}

// ---------- characters: same person across scenes ----------
// reel.characters = { "sleeper": { "look": "young woman, wavy brown hair, cream long-sleeved pyjamas", "ref": "auto" | "none" | "art/x.png" } }
// An object with "character": "sleeper" gets the look added to its prompt; with ref "auto" (default) the FIRST
// generated image of that character becomes the reference image for every later one (FLUX.2 on Cloudflare, or Gemini).
export function makeCharacterResolver(characters, proj, cfg) {
  const anchors = {};
  return (it) => {
    const name = it.spec.character, c = name && characters ? characters[name] : null;
    if (!c) return it.spec;
    const s = { ...it.spec, image_prompt: it.spec.image_prompt + (c.look ? `. The person: ${c.look}` : '') };
    if (!s.image_ref && c.ref && c.ref !== 'auto' && c.ref !== 'none') s.image_ref = c.ref;
    else if (!s.image_ref && c.ref !== 'none') {
      const a = anchors[name];
      if (!a) anchors[name] = { spec: s, theme: it.theme };
      else if (a.spec !== s) {
        const ak = genKey(a.spec, a.theme, cfg, proj);
        const src = ['.orig.jpg', '.orig.png', '.orig.webp'].map(e => ak.base + e).find(f => fs.existsSync(f)) || findGenerated(ak.base);
        if (src && !(it.spec.image_key && it.spec.image_key === a.spec.image_key)) s.image_ref = path.relative(proj, src).replace(/\\/g, '/');
      }
    }
    return s;
  };
}

// Used by render.mjs: point objects at their generated files; returns the list still missing.
// Fallback chain, always: generated image → the object's svg_file → a matching library drawing → nothing (warned).
export function resolveGenerated(scenes, proj, cfg = {}, characters = null) {
  const missing = [], who = makeCharacterResolver(characters, proj, cfg);
  for (const it of collect({ scenes })) {
    it.spec = who(it);
    const k = genKey(it.spec, it.theme, cfg, proj), f = findGenerated(k.base);
    const o = it.target;
    if (it.key !== 'bg_image' && !o.svg_file && !o.svg) { const lib = libraryFallback(it.spec.image_prompt); if (lib) o.svg_file = lib; }
    if (!f) { missing.push(`${it.scene}: ${it.spec.image_prompt} → ${it.key === 'bg_image' ? 'dark background' : (o.svg_file ? 'hand-drawn ' + o.svg_file : 'NO FALLBACK (add svg_file)')}`); continue; }
    const rel = path.relative(proj, f).replace(/\\/g, '/');
    if (it.key === 'bg_image') { it.target.bg_image = rel; continue; }
    const bg = STYLES[k.style].bg;
    o.image = rel;
    if (o.svg_file) o.fallback_svg_file = o.svg_file;                         // swapped in if the image fails to load
    delete o.svg_file; delete o.svg;
    const onDark = it.useTheme === 'dark';
    if (o.blend == null) o.blend = bg === 'dark' && onDark ? 'screen' : bg !== 'dark' && !onDark ? 'multiply' : 'normal';
    if (bg !== 'full' && (bg === 'dark') !== onDark) o.adapt = onDark ? 'dark' : 'paper';   // shared image on the "other" theme
    if (o.feather == null) o.feather = cfg.feather === true;                  // optional extra: soft oval edge
    if (o.enter === 'sketch') o.enter = 'blur';                                // sketch needs SVG strokes; "develop" instead
  }
  return missing;
}

// ---------- providers ----------
// FLUX.2 [klein]/[dev] on Workers AI: multipart form, up to 4 reference images (each under 512x512).
async function cloudflareFlux2(prompt, cfg, refPath) {
  const acct = readEnv('CLOUDFLARE_ACCOUNT_ID'), tok = readEnv('CLOUDFLARE_API_TOKEN');
  const model = /flux-2/.test(cfg.cloudflare_model || '') ? cfg.cloudflare_model : (cfg.cloudflare_ref_model || '@cf/black-forest-labs/flux-2-klein-4b');
  const form = new FormData();
  form.append('prompt', refPath ? `Keep the exact same person as in image 0: same face, same hair, same clothing and body. ${prompt}` : prompt);
  form.append('width', '1024'); form.append('height', '1024');
  if (refPath) {
    const tmp = path.join(os.tmpdir(), `cf-ref-${process.pid}-${Date.now()}.png`);
    const r0 = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', refPath, '-vf', 'scale=500:500:force_original_aspect_ratio=decrease', '-frames:v', '1', tmp]);
    if (r0.status !== 0) throw new Error('could not prepare the reference image');
    form.append('input_image_0', new Blob([fs.readFileSync(tmp)], { type: 'image/png' }), 'ref.png'); fs.rmSync(tmp, { force: true });
  }
  let r;
  for (let k = 0; k < 3; k++) {
    r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form });
    if (r.ok || !/NSFW|flagged/i.test(await r.clone().text())) break;
  }
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) throw new Error(`Cloudflare ${model} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  if (ct.startsWith('image/')) return { buf: Buffer.from(await r.arrayBuffer()), ext: ct.includes('png') ? '.png' : '.jpg' };
  const j = await r.json(); const img = j.result?.image || j.result?.images?.[0];
  if (!img) throw new Error('Cloudflare: ' + JSON.stringify(j.errors || j).slice(0, 300));
  return { buf: Buffer.from(img, 'base64'), ext: '.png' };
}
async function cloudflare(prompt, cfg, seed, refPath) {
  const acct = readEnv('CLOUDFLARE_ACCOUNT_ID'), tok = readEnv('CLOUDFLARE_API_TOKEN');
  if (!acct || !tok) throw new Error('Cloudflare account ID / API token not set');
  if (refPath || /flux-2/.test(cfg.cloudflare_model || '')) return cloudflareFlux2(prompt, cfg, refPath);
  const model = cfg.cloudflare_model || '@cf/black-forest-labs/flux-1-schnell';
  // seed isn't accepted by every model; a new image_seed still re-rolls because it changes the cache key
  const call = body => fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = await call({ prompt, steps: Math.min(8, cfg.cloudflare_steps || 6) });
  for (let k = 0; k < 2 && r.status === 400; k++) {                      // false "NSFW" flags are random: retry; else drop options
    const t = await r.clone().text();
    r = /NSFW/i.test(t) ? await call({ prompt, steps: Math.min(8, cfg.cloudflare_steps || 6) }) : await call({ prompt });
  }
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) throw new Error(`Cloudflare ${r.status}: ${(await r.text()).slice(0, 300)}`);
  if (ct.startsWith('image/')) return { buf: Buffer.from(await r.arrayBuffer()), ext: ct.includes('png') ? '.png' : '.jpg' };
  const j = await r.json();
  if (!j.success || !j.result?.image) throw new Error('Cloudflare: ' + JSON.stringify(j.errors || j).slice(0, 300));
  return { buf: Buffer.from(j.result.image, 'base64'), ext: '.jpg' };
}
async function gemini(prompt, cfg, aspect, refPath) {
  const key = readEnv('GEMINI_API_KEY');
  if (!key) throw new Error('Gemini API key not set');
  const model = cfg.gemini_model || 'gemini-2.5-flash-image';
  const parts = [];
  if (refPath) {
    const ext = path.extname(refPath).toLowerCase();
    parts.push({ inlineData: { mimeType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(refPath).toString('base64') } });
    prompt = `Using the attached image as the reference for the subject's exact look and drawing style: ${prompt}`;
  }
  parts.push({ text: prompt });
  const call = gen => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gen }) });
  let r = await call({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect || '1:1' } });
  if (r.status === 400) r = await call({ responseModalities: ['TEXT', 'IMAGE'] });     // older models: no imageConfig
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 429 && /FreeTier/.test(t)) { noteStatus('gemini', { no_free_quota: true, model }); throw new Error(`Gemini: this key has no free quota for ${model}. Google's image models need billing turned on (aistudio.google.com → Billing). Cloudflare Workers AI is the free option.`); }
    throw new Error(`Gemini ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const p = (j.candidates?.[0]?.content?.parts || []).find(x => x.inlineData || x.inline_data);
  if (!p) throw new Error('Gemini returned no image: ' + JSON.stringify(j.promptFeedback || j.candidates?.[0]?.finishReason || j).slice(0, 300));
  noteStatus('gemini', null);
  const d = p.inlineData || p.inline_data, mt = d.mimeType || d.mime_type || 'image/png';
  return { buf: Buffer.from(d.data, 'base64'), ext: mt.includes('jpeg') ? '.jpg' : mt.includes('webp') ? '.webp' : '.png' };
}
// Light-background images: sample the corner colour and key it out → transparent PNG (no halo on paper).
import { spawnSync } from 'node:child_process';
export function knockOutBackground(src, dst, similarity = 0.14) {
  const px = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', 'crop=24:24:4:4,scale=1:1:flags=area', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  if (px.status !== 0 || !px.stdout || px.stdout.length < 3) return false;
  const hex = [...px.stdout.subarray(0, 3)].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `format=rgba,colorkey=0x${hex}:${similarity}:0.12`, '-frames:v', '1', dst], { encoding: 'utf8' });
  return r.status === 0;
}
// Crop empty (transparent) margins so the subject fills the slot it's given; keeps a small border.
export function autoTrim(file, marginPct = 0.04) {
  const [W, H] = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim().split(',').map(Number);
  if (!W || !H) return false;
  // exact bounding box of pixels with real opacity (thin legs, antennae and hairs count)
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: W * H + 1024 });
  if (raw.status !== 0 || !raw.stdout || raw.stdout.length < W * H) return false;
  const A = raw.stdout; let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let yy = 0; yy < H; yy++) { const row = yy * W; for (let xx = 0; xx < W; xx++) if (A[row + xx] > 60) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; y1 = yy; } }
  if (x1 < 0) return false;
  let x = x0, y = y0, w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w >= W * 0.97 && h >= H * 0.97) return false;
  const mx = Math.round(Math.max(w, h) * marginPct);
  x = Math.max(0, x - mx); y = Math.max(0, y - mx); w = Math.min(W - x, w + 2 * mx); h = Math.min(H - y, h + 2 * mx);
  const tmp = file.replace(/\.png$/, '.trim.png');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', tmp], { encoding: 'utf8' });
  if (r.status !== 0) return false;
  fs.renameSync(tmp, file); return true;
}
// Remove small disconnected specks (stray caption letters, page numbers, signatures) from a cut-out PNG.
// Keeps every connected piece bigger than minFrac of the largest piece, so legs, tails and steam survive.
export function cleanSpecks(file, minFrac = 0.004) {
  const [W, H] = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim().split(',').map(Number);
  if (!W || !H) return 0;
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: W * H * 4 + 1024 });
  if (raw.status !== 0 || raw.stdout.length < W * H * 4) return 0;
  const px = Buffer.from(raw.stdout), N = W * H, lab = new Int32Array(N), sizes = [0];
  const solid = i => px[i * 4 + 3] > 40;
  let n = 0;
  for (let i = 0; i < N; i++) {                     // label 8-connected components (iterative flood fill)
    if (lab[i] || !solid(i)) continue;
    n++; let size = 0; const st = [i]; lab[i] = n;
    while (st.length) {
      const p = st.pop(); size++; const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (!lab[q] && solid(q)) { lab[q] = n; st.push(q); }
      }
    }
    sizes.push(size);
  }
  const keepMin = Math.max(30, Math.max(...sizes) * minFrac);
  let removed = 0;
  for (let i = 0; i < N; i++) { const l = lab[i]; if (l && sizes[l] < keepMin) { px[i * 4 + 3] = 0; removed++; } else if (!l && px[i * 4 + 3]) px[i * 4 + 3] = 0; }
  if (!removed) return 0;
  const tmp = file.replace(/\.png$/, '.clean.png');
  const w = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', tmp], { input: px, maxBuffer: 1 << 24 });
  if (w.status !== 0) return 0;
  fs.renameSync(tmp, file); return removed;
}
// orig → transparent, cleaned, trimmed PNG used by reels (light and dark styles alike; full-bleed backgrounds untouched)
// Judge a cut-out PNG before trimming: catches frames/boxes the AI drew, backgrounds that didn't key out,
// and missing subjects. Returns {ok, reason}.
export function assessCutout(file) {
  const [W, H] = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim().split(',').map(Number);
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: W * H + 1024 });
  if (!W || raw.status !== 0) return { ok: true };
  const A = raw.stdout, on = (x, y) => A[y * W + x] > 60;
  let total = 0, border = 0, borderN = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  const band = Math.round(Math.min(W, H) * 0.012);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = on(x, y), edge = x < band || y < band || x >= W - band || y >= H - band;
    if (edge) { borderN++; if (o) border++; }
    if (o) { total++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  if (total / (W * H) < 0.015) return { ok: false, reason: 'subject missing or tiny' };
  if (border / borderN > 0.18) return { ok: false, reason: 'background not removed at the edges' };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (total / (bw * bh) > 0.93 && bw > W * 0.3 && bh > H * 0.3) return { ok: false, reason: 'solid box behind the subject' };
  // boxes and frames: a natural subject rarely fills straight across 3+ edges of its own bounding box
  const rowF = y => { let c = 0; for (let x = x0; x <= x1; x++) if (on(x, y)) c++; return c / bw; };
  const colF = x => { let c = 0; for (let y = y0; y <= y1; y++) if (on(x, y)) c++; return c / bh; };
  const edge = fs => Math.max(...fs) > 0.7 ? 1 : 0;
  const lines = edge([0, 1, 2, 3].map(i => rowF(y0 + i))) + edge([0, 1, 2, 3].map(i => rowF(y1 - i)))
    + edge([0, 1, 2, 3].map(i => colF(x0 + i))) + edge([0, 1, 2, 3].map(i => colF(x1 - i)));
  if (lines >= 3) return { ok: false, reason: 'box or frame around the subject' };
  return { ok: true };
}
export function postProcess(orig, out, bg) {
  if (bg === 'full') { fs.copyFileSync(orig, out); return { ok: true }; }
  if (!knockOutBackground(orig, out, bg === 'dark' ? 0.1 : 0.14)) { fs.copyFileSync(orig, out); return { ok: true }; }
  cleanSpecks(out);
  const q = assessCutout(out);
  autoTrim(out);
  return q;
}
// Remember provider problems (e.g. Gemini key with no free image quota) so --check can be honest.
const STATUS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sfx-cache', 'provider-status.json');
export function noteStatus(provider, info) {
  let all = {}; try { all = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { /* none yet */ }
  if (info) all[provider] = { ...info, at: new Date().toISOString() }; else delete all[provider];
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true }); fs.writeFileSync(STATUS_FILE, JSON.stringify(all, null, 1));
}
export function providerStatus() { try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { return {}; } }
export function availableProviders() {
  return { cloudflare: !!(readEnv('CLOUDFLARE_ACCOUNT_ID') && readEnv('CLOUDFLARE_API_TOKEN')), gemini: !!readEnv('GEMINI_API_KEY') };
}

export async function generate(spec, theme, cfg, proj, { provider } = {}) {
  const k = genKey(spec, theme, cfg, proj), st = STYLES[k.style];
  const av = availableProviders();
  let order = [];
  const want = provider || spec.image_provider || cfg.provider || 'auto';
  if (want === 'off') throw new Error('AI images are turned off in settings (Images → Provider).');
  if (want === 'cloudflare' || want === 'gemini') order = [want];
  else order = ['cloudflare', 'gemini'];                        // FLUX.2 on Cloudflare handles references too
  order = order.filter(p => av[p]);
  if (!order.length) throw new Error('No image provider configured. Add a Cloudflare or Gemini key in the settings page (node scripts/settings.mjs → Images).');
  const prompt = st.p(spec.image_prompt);
  const seed = spec.image_seed ?? (parseInt(k.hash.slice(0, 6), 16) % 100000);
  let lastErr;
  const tries = 1 + Math.max(0, cfg.max_rerolls ?? 2);
  for (const p of order) {
    try {
      let file, q, attempt = 0;
      for (; attempt < tries; attempt++) {      // automatic re-roll when the quality check fails
        const res = p === 'cloudflare' ? await cloudflare(prompt, cfg, seed + attempt * 7919, k.ref) : await gemini(prompt, cfg, st.aspect, k.ref);
        fs.mkdirSync(path.dirname(k.base), { recursive: true });
        // keep the original; reels use a cut-out, trimmed PNG (backgrounds stay full-frame)
        const orig = k.base + '.orig' + res.ext;
        fs.writeFileSync(orig, res.buf);
        file = k.base + (st.bg === 'full' ? res.ext : '.png');
        q = postProcess(orig, file, st.bg);
        if (q.ok) break;
        console.warn(`  ↻ ${spec.image_prompt.slice(0, 50)}: ${q.reason}${attempt + 1 < tries ? ', re-rolling' : ', keeping the last try (review it)'}`);
      }
      fs.writeFileSync(k.base + '.json', JSON.stringify({ prompt: spec.image_prompt, style: k.style, bg: st.bg, provider: p, seed, ref: spec.image_ref || null, attempts: Math.min(attempt + 1, tries), qa: q.ok ? 'pass' : 'fail: ' + q.reason, full_prompt: prompt }, null, 1));
      return { file, provider: p, style: k.style, qa: q };
    } catch (e) { lastErr = e; if (order.length > 1) console.warn(`  ! ${p} failed (${e.message.slice(0, 160)}), trying next provider`); }
  }
  throw lastErr;
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  const cfg = loadSettings().images || {};
  if (a.includes('--check')) {
    const av = availableProviders(), st = providerStatus();
    const gem = !av.gemini ? 'not set' : st.gemini?.no_free_quota ? `key set, but no free image quota (seen ${st.gemini.at.slice(0, 10)}); needs billing` : 'ready';
    const usable = cfg.provider !== 'off' && (av.cloudflare || (av.gemini && !st.gemini?.no_free_quota));
    console.log(JSON.stringify({ ai_images: usable ? 'available' : 'unavailable', setting: cfg.provider || 'auto', cloudflare: av.cloudflare ? 'ready' : 'not set', gemini: gem }));
    process.exit(0);
  }
  if (a.includes('--styles')) { for (const [k, v] of Object.entries(STYLES)) console.log(`${k.padEnd(15)} ${v.d}`); process.exit(0); }
  if (a.includes('--test')) {
    const prompt = opt('test'); const tmp = path.resolve(opt('out') ? path.dirname(opt('out')) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sfx-cache', 'image-test'));
    const spec = { image_prompt: prompt, image_style: opt('style', 'engraving'), image_seed: opt('seed') ? +opt('seed') : undefined };
    try {
      const r = await generate(spec, 'paper', cfg, tmp, { provider: opt('provider') });
      let f = r.file; if (opt('out')) { fs.copyFileSync(f, path.resolve(opt('out'))); f = path.resolve(opt('out')); }
      console.log(`${r.provider} · ${r.style} → ${f}`);
    } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
    process.exit(0);
  }
  const proj = path.resolve(a.find(x => !x.startsWith('--')) || '.');
  const reel = JSON.parse(fs.readFileSync(path.join(proj, 'reel.json'), 'utf8'));
  const items = collect(reel);
  if (!items.length) { console.log('No image_prompt / bg_prompt in this reel.'); process.exit(0); }
  console.log(`providers: ${Object.entries(availableProviders()).map(([k, v]) => `${k} ${v ? 'ready' : 'not set'}`).join(', ')}`);
  let made = 0, cached = 0, failed = 0;
  if (a.includes('--reprocess')) {        // redo cut-out + trim from the saved originals, no API calls
    const who0 = makeCharacterResolver(reel.characters, proj, cfg);
    for (const it of items) {
      it.spec = who0(it);
      const k = genKey(it.spec, it.theme, cfg, proj), st = STYLES[k.style];
      const orig = ['.orig.jpg', '.orig.png', '.orig.webp', '.jpg', '.webp'].map(e => k.base + e).find(f => fs.existsSync(f));
      if (!orig) continue;
      let src = orig;
      if (!/\.orig\./.test(orig)) { src = k.base + '.orig' + path.extname(orig); fs.renameSync(orig, src); }
      postProcess(src, k.base + (st.bg === 'full' ? path.extname(src) : '.png'), st.bg);
      console.log(`  ~ ${it.scene}: reprocessed`);
    }
    process.exit(0);
  }
  const who = makeCharacterResolver(reel.characters, proj, cfg);
  for (const it of items) {
    it.spec = who(it);
    const k = genKey(it.spec, it.theme, cfg, proj);
    const have = findGenerated(k.base);
    if (have && !a.includes('--force')) { cached++; console.log(`  = ${it.scene}: ${it.spec.image_prompt} (cached)`); continue; }
    try {
      const r = await generate(it.spec, it.theme, cfg, proj);
      made++; console.log(`  + ${it.scene}: ${it.spec.image_prompt.slice(0, 90)}  [${r.provider} · ${r.style}${it.spec.image_ref ? ' · ref ' + path.basename(it.spec.image_ref) : ''}] → ${path.relative(proj, r.file)}`);
    } catch (e) { failed++; console.warn(`  ! ${it.scene}: ${it.spec.image_prompt} — ${e.message.slice(0, 200)}`); }
  }
  console.log(`images: ${made} new, ${cached} cached, ${failed} failed${failed ? ' (those scenes fall back to their svg_file)' : ''}`);
  console.log(`review: node scripts/art-preview.mjs "${path.join(proj, 'art', 'gen')}"`);
  process.exit(failed && !made && !cached ? 1 : 0);
}
