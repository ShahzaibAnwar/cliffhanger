#!/usr/bin/env node
/* Art review sheet: renders SVG illustrations on the real paper / dark backgrounds (with the art kit
   loaded) so they can be judged and fixed before they go into a reel.

     node art-preview.mjs <file.svg|folder> [...more] [--dark] [--sketch] [--out sheet.png] [--cols 4]

   --dark    add a tile on the dark theme for each drawing
   --sketch  add a mid-draw frame (how it looks while the "sketch" entrance draws it) */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lintSvg, overflowProbe, overflowMessage } from './artlint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const LIB = path.join(path.dirname(HERE), 'assets', 'art');
const skip = new Set(['--out', '--cols'].flatMap(o => { const i = args.indexOf(o); return i >= 0 ? [args[i + 1]] : []; }));
let files = args.filter(a => !a.startsWith('--') && !skip.has(a)).flatMap(a => {
  const p = a.startsWith('@lib') ? path.join(LIB, a.slice(5)) : path.resolve(a);
  return fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => /\.(svg|png|jpe?g|webp)$/i.test(f) && !/\.orig\./.test(f)).sort().map(f => path.join(p, f)) : [p];
});
if (!files.length) { console.error('usage: node art-preview.mjs <svg|folder> [--dark] [--sketch]'); process.exit(1); }

let n = 0;
const scope = svg => { const k = ++n; svg = svg.replace(/<\?xml[^>]*>/, '');
  for (const id of new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))) svg = svg.split(`id="${id}"`).join(`id="p${k}_${id}"`).split(`#${id})`).join(`#p${k}_${id})`).split(`"#${id}"`).join(`"#p${k}_${id}"`);
  return svg; };

const D = 1.8, scenes = [], shots = [];
let t = 0;
for (const f of files) {
  const name = path.basename(f).replace(/\.[^.]+$/, '');
  const isImg = !f.endsWith('.svg');
  let svg = null, w = 820, themes = ['paper', ...(flag('dark') ? ['dark'] : [])], blendFor = () => null;
  if (isImg) {   // generated image: show it on the background its style was made for
    const side = f.replace(/\.[^.]+$/, '.json'); const meta = fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')) : {};
    themes = meta.bg === 'dark' ? ['dark'] : ['paper'];
    blendFor = th => (meta.bg === 'full' ? null : th === 'dark' ? 'screen' : 'multiply');
  } else {
    svg = fs.readFileSync(f, 'utf8');
    const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1]?.split(/[\s,]+/).map(Number);
    w = vb ? Math.round(Math.min(820, 1060 * vb[2] / vb[3])) : 820;   // fit tall drawings in the tile
  }
  for (const theme of themes) {
    const visual = isImg
      ? { type: 'art', image: pathToFileURL(f).href, blend: blendFor(theme), w: 900, y: 1000, motion: 'none', enter: 'none', at: 0, shadow: false }
      : { type: 'art', svg: scope(svg), w, y: 1000, motion: 'none', enter: flag('sketch') ? 'sketch' : 'none', at: 0, sketch_dur: 1.4 };
    scenes.push({ id: name + '-' + theme, theme, chrome: false, start: t, end: t + D, dur: D, words: [], visual,
      overlays: [{ type: 'caption', text: name.slice(0, 40) + (theme === 'dark' ? ' · dark' : ''), x: 540, y: 1700, at: 0, enter: 'none' }] });
    if (flag('sketch') && !isImg) shots.push(t + 0.75);
    shots.push(t + D - 0.05); t += D;
  }
}
const data = { brand: { name: '', accent: '#C8302A' }, scenes, total: t, transition: 'cut', camera: 'none', film_fx: false };
const css = fs.readFileSync(path.join(HERE, 'engine', 'engine.css'), 'utf8');
const js = fs.readFileSync(path.join(HERE, 'engine', 'engine.js'), 'utf8');
const tmp = path.join(path.dirname(HERE), 'sfx-cache', 'art-preview'); fs.mkdirSync(tmp, { recursive: true });
const html = path.join(tmp, 'index.html');
fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@600;700&family=JetBrains+Mono:wght@500;600;700&display=block"><style>${css}</style></head><body><div id="stage"></div><script>window.REEL=${JSON.stringify(data).replace(/</g, '\\u003c')};</script><script>${js}</script></body></html>`);

const { chromium } = await import('playwright-core');
let browser; for (const o of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) { try { browser = await chromium.launch({ ...o, args: ['--ignore-gpu-blocklist', '--force_high_performance_gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])] }); break; } catch { /* next */ } }
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', e => console.log('[page error]', e.message));
await page.goto(pathToFileURL(html).href); await page.evaluate(() => window.__ready);
for (const f of fs.readdirSync(tmp)) if (f.endsWith('.png')) fs.rmSync(path.join(tmp, f));
for (let i = 0; i < shots.length; i++) {
  await page.evaluate(x => window.__seek(x), shots[i]);
  await page.screenshot({ path: path.join(tmp, String(i + 1).padStart(3, '0') + '.png'), clip: { x: 0, y: 380, width: 1080, height: 1400 } });
}
// drawing checks: flat clip-art, text inside the art, ink past the viewBox (cut off in a reel)
const warns = [];
for (const f of files) if (f.endsWith('.svg')) {
  const svg = fs.readFileSync(f, 'utf8'), name = path.basename(f);
  warns.push(...lintSvg(svg, name));
  const m = overflowMessage(name, await page.evaluate(overflowProbe, svg)); if (m) warns.push(m);
}
await browser.close();
if (warns.length) { console.warn(`! ${warns.length} drawing warning(s):`); for (const w of warns) console.warn('   - ' + w); }
const cols = parseInt(opt('cols', String(Math.min(4, shots.length))), 10), rows = Math.ceil(shots.length / cols);
const out = path.resolve(opt('out', path.join(tmp, 'sheet.png')));
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-start_number', '1', '-i', path.join(tmp, '%03d.png'),
  '-vf', `scale=360:-1,tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', '-update', '1', out], { encoding: 'utf8' });
if (r.status) { console.error(r.stderr); process.exit(1); }
console.log(out);
