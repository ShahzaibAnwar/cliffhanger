#!/usr/bin/env node
/* 3D close-ups for reels: renders a three.js page to a PNG (transparent unless --bg), to use as an
   art "image". For surfaces, depth and macro views that 2D drawings do badly (skin, cells, terrain).

     node three-render.mjs <page.html | @three/<template>> <out.png> [--w 1200] [--h 800] [--bg F1EBDF] [--set k=v,k=v]

   Templates (assets/three/):  skin  (goosebump skin close-up; --set raised=0 for relaxed skin)
                               cells (red blood cells; --set color=7FB3D5,n=20)
   --bg      solid background colour (hex, no #). On dark scenes a paper background (F1EBDF) plus
             "feather": true reads as a clean magnifier view; dark details vanish on a transparent PNG.
   --set     extra query parameters for the page (each template lists its own).

   three.js is not a dependency of the skill. It is looked up in scripts/node_modules, the global npm
   folder and ~/node_modules. If none has it, installing it is a download (the user's call):
     cd scripts && npm install three

   A page of your own: load three with  import * as THREE from 'three';  under
   <script type="importmap">{"imports":{"three":"__THREE__"}}</script>  (filled in here), read w/h/bg from
   the query string, light it from the upper left like the drawings, and set document.title = 'done'
   after the last render (or 'error: …'). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const skip = new Set(['--w', '--h', '--bg', '--set'].flatMap(o => { const i = args.indexOf(o); return i >= 0 ? [args[i + 1]] : []; }));
const [src, out] = args.filter(a => !a.startsWith('--') && !skip.has(a));
if (!src || !out) { console.error('usage: node three-render.mjs <page.html|@three/skin> <out.png> [--w 1200] [--h 800] [--bg F1EBDF] [--set k=v,...]'); process.exit(1); }

function findThree() {
  const tries = [];
  try { tries.push(path.dirname(createRequire(path.join(HERE, 'x.js')).resolve('three/package.json'))); } catch { /* not local */ }
  const g = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (g.status === 0 && g.stdout.trim()) tries.push(path.join(g.stdout.trim(), 'three'));
  tries.push(path.join(os.homedir(), 'node_modules', 'three'));
  for (const t of tries) { const m = path.join(t, 'build', 'three.module.js'); if (fs.existsSync(m)) return { dir: t, module: m }; }
  return null;
}
const three = findThree();
if (!three) {
  console.error('three.js is not installed (looked in scripts/node_modules, the global npm folder and ~/node_modules).\n' +
    'Installing it is a download, so ask the user first; then:  cd "' + HERE + '" && npm install three');
  process.exit(2);
}

const page = src.startsWith('@three/') ? path.join(path.dirname(HERE), 'assets', 'three', src.slice(7).replace(/\.html$/, '') + '.html') : path.resolve(src);
if (!fs.existsSync(page)) { console.error('no such page: ' + page); process.exit(1); }
const W = parseInt(opt('w', '1200'), 10), H = parseInt(opt('h', '800'), 10);
const tmpDir = path.join(path.dirname(HERE), 'sfx-cache', 'three'); fs.mkdirSync(tmpDir, { recursive: true });
const tmp = path.join(tmpDir, path.basename(page));
fs.writeFileSync(tmp, fs.readFileSync(page, 'utf8').split('__THREE__').join(pathToFileURL(three.module).href));

const q = new URLSearchParams({ w: String(W), h: String(H) });
if (opt('bg')) q.set('bg', opt('bg').replace(/^#/, ''));
for (const kv of String(opt('set', '')).split(',').filter(Boolean)) { const [k, ...v] = kv.split('='); q.set(k.trim(), v.join('=').trim()); }

const { chromium } = await import('playwright-core');
const launchArgs = ['--allow-file-access-from-files', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
let browser; for (const o of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) { try { browser = await chromium.launch({ ...o, args: launchArgs }); break; } catch { /* next */ } }
if (!browser) { console.error('could not start a browser (run: node scripts/doctor.mjs)'); process.exit(1); }
const p = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(pathToFileURL(tmp).href + '?' + q.toString());
try { await p.waitForFunction(() => document.title === 'done' || document.title.startsWith('error'), null, { timeout: 30000 }); }
catch { errors.push('the page never set document.title = "done"'); }
const title = await p.title();
if (title !== 'done') { await browser.close(); console.error('three.js page failed: ' + [title, ...errors].filter(Boolean).join(' | ')); process.exit(1); }
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await p.screenshot({ path: path.resolve(out), omitBackground: !opt('bg') });
await browser.close();
if (errors.length) console.warn('! page messages: ' + errors.join(' | '));
console.log(path.resolve(out));
