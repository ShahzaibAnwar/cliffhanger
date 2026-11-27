#!/usr/bin/env node
/* Style gallery: renders a real sample of every look, caption style, picture finish and layout into
   <skill>/gallery/ (index.html to browse, overview.jpg to show in chat, one image or clip per option).
     node gallery.mjs                 build everything (about 1–2 minutes; offline, no API calls)
     node gallery.mjs --only looks    looks | captions | finishes | layouts
     node gallery.mjs --page          rebuild index.html / overview.jpg from the existing samples
     node gallery.mjs --lock          from now on pick the style automatically from each topic (style.mjs lock)
   Claude shows this before a new video or series, so the user picks a style by seeing it, not by name. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'gallery'), WORK = path.join(OUT, '_work');

export const LOOKS = [
  { id: 'case-file', name: 'Case file', d: 'Notebook paper and dark film, two-tone condensed headlines, stamps and a red pencil. The default: serious, investigative, curiosity.', best: 'science, body, mysteries' },
  { id: 'collage', name: 'Paper collage', d: 'Halftone paper cut-outs on torn yellow paint, stop-motion on twos, marker-scribble wipes, ransom-note words.', best: 'history, culture, explainers with real photos' },
  { id: 'chalkboard', name: 'Chalkboard', d: 'Green slate in a wooden frame with chalk lettering. Feels like a lesson from a favourite teacher.', best: 'education, maths, "how it works"' },
  { id: 'blueprint', name: 'Blueprint', d: 'Blue drafting grid with white lines and a yellow accent. Engineering and inventions.', best: 'tech, machines, space, inventions' },
  { id: 'comic', name: 'Comic', d: 'Halftone dots, bold comic lettering in caption panels, thick ink outlines.', best: 'fun facts, animals, kids, light topics' },
  { id: 'vhs', name: 'VHS tape', d: 'Old tape: scanlines, colour bleed and a PLAY display. Nostalgic and a little eerie.', best: 'unsolved cases, urban legends, the 80s/90s' },
  { id: 'newsprint', name: 'Newsprint', d: 'A newspaper page: serif headlines between rules, column lines, typewriter labels.', best: 'history, "on this day", real events' },
];
export const CAPTIONS = [
  { id: 'word', name: 'Word by word', d: 'Thick-outlined words; the one being spoken turns yellow.' },
  { id: 'karaoke', name: 'Karaoke', d: 'The whole line is visible; a colour fill sweeps through each word as it is spoken.' },
  { id: 'pop', name: 'Pop-in keywords', d: 'Words pop in one by one; key words (in the headline, or long words) are bigger and yellow.' },
  { id: 'box', name: 'Highlight box', d: 'The spoken word sits in an accent-coloured box (the short-form app look).' },
  { id: 'tape', name: 'Tape label', d: 'Words on a strip of white tape; the spoken word turns the accent colour.' },
  { id: 'line', name: 'Plain line', d: 'The whole line at once, no word highlighting. Calm and readable.' },
];
export const FINISHES = [
  { id: 'none', name: 'Plain', d: 'The picture as it is (AI images blend into the paper).' },
  { id: 'collage', name: 'Paper cut-out', d: 'Grayscale halftone cut-out with a paper edge on a paint shape.' },
  { id: 'print', name: 'Photo print', d: 'A photo with a white border and two strips of tape; it sways gently.' },
  { id: 'torn', name: 'Torn paper', d: 'Torn-paper edges with a soft shadow.' },
];

const sh = (args, opts = {}) => spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), ...args], { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });
const ffm = a => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { encoding: 'utf8' });
const write = (dir, reel, timings) => {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'art'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reel.json'), JSON.stringify(reel, null, 1));
  if (timings) { fs.mkdirSync(path.join(dir, 'build'), { recursive: true }); fs.writeFileSync(path.join(dir, 'build', 'timings.json'), JSON.stringify(timings)); }
};
const stills = (dir, at) => { const r = sh([dir, '--at', at.join(',')]); if (/\[page error\]/.test(r.stdout || '')) console.warn('! page error in ' + path.basename(dir)); return at.map(t => path.join(dir, 'build', 'stills', `at-${+Number(t).toFixed(2)}s.png`)); };
const thumb = (src, dst, w = 540) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); ffm(['-i', src, '-vf', `scale=${w}:-1`, '-q:v', '3', dst]); return dst; };
// fake word timings so captions can be shown without a voiceover
const fakeWords = (text, t0 = 0.25, wps = 2.6) => text.split(/\s+/).map((w, i) => ({ w, s: +(t0 + i / wps).toFixed(3), e: +(t0 + (i + 0.85) / wps).toFixed(3) }));
const brand = { name: 'YOUR BRAND', accent: '#C8302A' };
const SAMPLE_ART = (() => { const d = path.join(ROOT, 'examples', 'hypnic-jerk', 'art', 'gen'); const f = fs.existsSync(d) && fs.readdirSync(d).find(x => /full-human-body-standing-front-view-ar.*\.png$/.test(x) && !x.includes('.orig.')); return f ? path.join(d, f) : null; })();

function looks() {
  const items = [];
  for (const L of LOOKS) {
    const dir = path.join(WORK, 'look-' + L.id);
    write(dir, { title: L.name, brand, look: L.id, animation: { camera: 'none', film_fx: true }, scenes: [
      { id: 'p', theme: 'paper', duration: 2.4, section: 'Case 01', headline: ['WHY DOES', 'THIS HAPPEN?'], visual: { type: 'art', svg_file: '@lib/brain.svg', w: 720, motion: 'none' },
        overlays: [{ type: 'chip', text: 'FIG 01 · THE BRAIN', x: 540, y: 1560, at: 0.1 }] },
      { id: 'd', theme: 'dark', duration: 2.4, section: 'The twist', headline: ['THE ANSWER', 'IS WEIRD'], visual: { type: 'art', svg_file: '@lib/eye.svg', w: 700, motion: 'none' },
        overlays: [{ type: 'stamp', text: 'CONFIRMED', x: 760, y: 1500, rot: -8, at: 0.2 }] }] });
    const [a, b] = stills(dir, [2.2, 4.6]);
    items.push({ ...L, paper: thumb(a, path.join(OUT, 'looks', `${L.id}-paper.jpg`)), dark: thumb(b, path.join(OUT, 'looks', `${L.id}-dark.jpg`)), use: `"look": "${L.id}"` });
    console.log(`  look: ${L.id}`);
  }
  return items;
}

function captions() {
  const items = [], text = 'Your brain thinks you are falling, so it jerks you awake.';
  for (const C of CAPTIONS) {
    const dir = path.join(WORK, 'cap-' + C.id);
    write(dir, { title: 'cap', brand, subtitles: { burn: true, style: C.id }, animation: { camera: 'none' }, scenes: [
      { id: 'c', theme: 'paper', vo: text, headline: ['YOUR BRAIN', 'IS FALLING'], headline_at: 0, punch_at: 0, visual: { type: 'art', svg_file: '@lib/brain.svg', w: 620, y: 1000, motion: 'none' } }] },
      { provider: 'sample', scenes: { c: { file: 'build/vo/none.mp3', duration: 4.2, words: fakeWords(text) } } });
    const [st] = stills(dir, [1.9]);
    const r = sh([dir, '--no-audio', '--fps', '30', '--workers', '4']);
    const mp4 = path.join(dir, 'out', 'cap.mp4');
    const clip = path.join(OUT, 'captions', `${C.id}.mp4`); fs.mkdirSync(path.dirname(clip), { recursive: true });
    if (fs.existsSync(mp4)) ffm(['-i', mp4, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', clip]);
    else console.warn('! caption clip failed for ' + C.id + ': ' + (r.stderr || '').slice(-200));
    items.push({ ...C, still: thumb(st, path.join(OUT, 'captions', `${C.id}.jpg`)), clip: fs.existsSync(clip) ? clip : null, use: `"subtitles": { "burn": true, "style": "${C.id}" }` });
    console.log(`  captions: ${C.id}`);
  }
  return items;
}

function finishes() {
  const items = [];
  const dir = path.join(WORK, 'finishes');
  write(dir, { title: 'fin', brand, animation: { camera: 'none' }, scenes: FINISHES.map(F => ({ id: F.id, theme: 'paper', duration: 2, headline: [F.name.toUpperCase()],
    visual: SAMPLE_ART ? { type: 'art', image: 'art/sample.png', finish: F.id === 'none' ? undefined : F.id, w: F.id === 'print' || F.id === 'torn' ? 600 : 560, motion: 'none', blend: F.id === 'none' ? 'multiply' : undefined }
                       : { type: 'art', svg_file: '@lib/arm.svg', finish: F.id === 'none' ? undefined : F.id, w: 600, motion: 'none' } })) });
  if (SAMPLE_ART) fs.copyFileSync(SAMPLE_ART, path.join(dir, 'art', 'sample.png'));
  const shots = stills(dir, FINISHES.map((_, i) => i * 2 + 1.8));
  FINISHES.forEach((F, i) => items.push({ ...F, img: thumb(shots[i], path.join(OUT, 'finishes', `${F.id}.jpg`)), use: F.id === 'none' ? '(default)' : `"finish": "${F.id}"` }));
  console.log('  finishes');
  return items;
}

function layouts() {
  const dir = path.join(WORK, 'wide');
  write(dir, { title: 'wide', brand, format: { width: 1920, height: 1080 }, animation: { camera: 'none' }, scenes: [
    { id: 'w', theme: 'paper', duration: 2.4, section: 'Chapter 1', headline: ['16:9 LONG', 'VIDEO'], visual: { type: 'art', svg_file: '@lib/brain.svg', w: 600, motion: 'none' },
      overlays: [{ type: 'chip', text: 'HEADLINE LEFT · ART RIGHT', y: 820, at: 0.1 }] }] });
  const [w] = stills(dir, [2.2]);
  const v = path.join(OUT, 'looks', 'case-file-paper.jpg');
  console.log('  layouts');
  return [{ id: 'vertical', name: 'Vertical 9:16', d: 'Reels, TikTok, Shorts (1080 × 1920).', img: fs.existsSync(v) ? v : null, use: '(default)' },
    { id: 'wide', name: 'Wide 16:9', d: 'Long YouTube videos: headline left, art right, chapters and a thumbnail.', img: thumb(w, path.join(OUT, 'layouts', 'wide.jpg'), 960), use: '"format": { "width": 1920, "height": 1080 }' }];
}

// media embedded as data URIs: the page is one self-contained file that works anywhere (preview panes, email, upload)
const rel = f => {
  if (!f || !fs.existsSync(f)) return '';
  const mime = f.endsWith('.mp4') ? 'video/mp4' : f.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function page(g) {
  const card = (title, d, media, use, extra = '') => `<figure class="card">${media}<figcaption><b>${esc(title)}</b><p>${esc(d)}</p>${extra}<code>${esc(use)}</code></figcaption></figure>`;
  const img = f => f ? `<img src="${rel(f)}" alt="">` : '';
  const sec = (h, intro, cards) => cards.length ? `<section><h2>${h}</h2><p class="intro">${intro}</p><div class="grid">${cards.join('')}</div></section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cliffhanger styles</title>
<style>:root{--bg:#F4F1EA;--fg:#1B1A18;--mut:#6E6A62;--card:#fff;--acc:#C8302A}@media (prefers-color-scheme:dark){:root{--bg:#141312;--fg:#EEE9DF;--mut:#9C968B;--card:#1E1D1B}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}header,section{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;font-size:28px}h2{margin:24px 0 4px}.intro{color:var(--mut);margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.card{margin:0;background:var(--card);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)}.card img,.card video{display:block;width:100%;height:auto;background:#000}
.pair{display:grid;grid-template-columns:1fr 1fr}.card figcaption{padding:10px 12px 14px}.card p{margin:4px 0 8px;color:var(--mut);font-size:14px}.card small{display:block;color:var(--mut);margin-bottom:8px}
code{display:block;font:12px ui-monospace,Consolas,monospace;background:rgba(127,127,127,.12);padding:6px 8px;border-radius:6px;overflow-wrap:anywhere}</style></head><body>
<header><h1>Cliffhanger styles</h1><p class="intro">Every look, caption style, picture finish and layout, rendered by the skill itself. Tell Claude which you like (by name), or copy the setting under each card into reel.json or settings.</p></header>
${sec('Looks', 'The overall visual world. Each is shown on a light (explain) scene and a dark (tension) scene.', g.looks.map(L => card(L.name, L.d, `<div class="pair">${img(L.paper)}${img(L.dark)}</div>`, L.use, `<small>Best for: ${esc(L.best)}</small>`)))}
${sec('Captions', 'Burned-in subtitles. They move, so each has a short clip.', g.captions.map(C => card(C.name, C.d, C.clip ? `<video src="${rel(C.clip)}" poster="${rel(C.still)}" muted loop autoplay playsinline></video>` : img(C.still), C.use)))}
${sec('Picture finishes', 'How an illustration or photo sits on the page.', g.finishes.map(F => card(F.name, F.d, img(F.img), F.use)))}
${sec('Layouts', 'Vertical for short-form, wide for long YouTube videos.', g.layouts.map(Y => card(Y.name, Y.d, img(Y.img), Y.use)))}
</body></html>`;
}

function overview(g) {         // one image Claude can show in chat: looks row (paper), captions row, finishes row
  const rows = [g.looks.map(l => l.paper), g.looks.map(l => l.dark), g.captions.map(c => c.still), g.finishes.map(f => f.img)].filter(r => r.length && r.every(Boolean));
  const tiles = rows.map((r, i) => { const o = path.join(WORK, `row${i}.jpg`); ffm([...r.flatMap(f => ['-i', f]), '-filter_complex', r.map((_, k) => `[${k}]scale=240:427,setsar=1[t${k}]`).join(';') + ';' + r.map((_, k) => `[t${k}]`).join('') + `hstack=${r.length}`, o]); return o; });
  const W = Math.max(...rows.map(r => r.length)) * 240, out = path.join(OUT, 'overview.jpg');
  ffm([...tiles.flatMap(f => ['-i', f]), '-filter_complex', tiles.map((_, k) => `[${k}]pad=${W}:427:0:0:white[r${k}]`).join(';') + ';' + tiles.map((_, k) => `[r${k}]`).join('') + `vstack=${tiles.length}`, '-q:v', '3', out]);
  return out;
}

function isMainModule(url) { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; } }
if (process.argv[1] && isMainModule(import.meta.url)) {
  const a = process.argv.slice(2), only = a.includes('--only') ? a[a.indexOf('--only') + 1] : a.includes('--page') ? 'page' : null;
  if (a.includes('--lock')) {          // after seeing the gallery: pick styles automatically from now on (same as style.mjs lock)
    const r = spawnSync(process.execPath, [path.join(HERE, 'style.mjs'), 'lock'], { encoding: 'utf8' }); process.stdout.write(r.stdout || r.stderr || ''); process.exit(r.status || 0);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const prevPath = path.join(OUT, 'gallery.json');
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : {};
  const t0 = Date.now();
  console.log('Building the style gallery…');
  const g = {
    looks: !only || only === 'looks' ? looks() : prev.looks || [],
    captions: !only || only === 'captions' ? captions() : prev.captions || [],
    finishes: !only || only === 'finishes' ? finishes() : prev.finishes || [],
    layouts: !only || only === 'layouts' ? layouts() : prev.layouts || [],
  };
  fs.writeFileSync(prevPath, JSON.stringify(g, null, 1));
  fs.writeFileSync(path.join(OUT, 'index.html'), page(g));
  const ov = overview(g);
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(JSON.stringify({ gallery: path.join(OUT, 'index.html'), overview: ov, url: pathToFileURL(path.join(OUT, 'index.html')).href,
    seconds: Math.round((Date.now() - t0) / 1000), looks: g.looks.map(l => l.id), captions: g.captions.map(c => c.id), finishes: g.finishes.map(f => f.id) }, null, 1));
}
