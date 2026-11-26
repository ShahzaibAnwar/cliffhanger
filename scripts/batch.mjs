#!/usr/bin/env node
/* Batch production: run many episodes start to finish (e.g. overnight), then review them on one page.
     node batch.mjs run [workspace] [--only a,b] [--force] [--steps vo,images,photos,render]
     node batch.mjs status [workspace]
     node batch.mjs review [workspace]          rebuild <workspace>/review.html
   Every project folder with a reel.json in the workspace is an episode; add "batch": false to a reel.json to skip it.
   Steps per episode: voiceover (+ tighten if voice.tighten) → AI images → real photos → final render.
   Finished episodes are skipped on the next run (resume after a stop); --force redoes them.
   Keeps the computer awake while running (Windows / macOS / Linux). Claude writes the scripts and reel.json files
   first (and gets them approved); this only produces. Nothing is published. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './settings-lib.mjs';
import { pythonCmd } from './doctor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const STATE = ws => path.join(ws, 'batch-state.json');

function episodes(ws, only) {
  return fs.readdirSync(ws, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => ({ name: d.name, dir: path.join(ws, d.name), reel: readJson(path.join(ws, d.name, 'reel.json')) }))
    .filter(e => e.reel && e.reel.batch !== false && (!only || only.includes(e.name)));
}

// keep the machine awake while this process runs
function keepAwake() {
  try {
    if (process.platform === 'win32') {
      const ps = `Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; while ($true) { [W.P]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null; Start-Sleep -Seconds 30; if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break } }`;
      return spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore', detached: false });
    }
    if (process.platform === 'darwin') return spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    return spawn('systemd-inhibit', ['--what=idle:sleep', '--why=Cliffhanger batch render', 'sleep', 'infinity'], { stdio: 'ignore' });
  } catch { return null; }
}

function step(cmd, args, log) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.appendFileSync(log, `\n$ ${path.basename(cmd)} ${args.map(a => path.basename(String(a))).join(' ')}\n${r.stdout || ''}${r.stderr || ''}`);
  return { ok: r.status === 0, secs: Math.round((Date.now() - t0) / 1000), tail: ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-3).join(' | ') };
}

async function run(ws, { only, force, steps }) {
  const eps = episodes(ws, only), state = readJson(STATE(ws)) || {};
  const todo = eps.filter(e => force || state[e.name]?.status !== 'done');
  if (!todo.length) { console.log('Nothing to do: every episode is done (use --force to redo).'); return review(ws); }
  console.log(`Batch: ${todo.length} episode(s) in ${ws}${eps.length > todo.length ? ` (${eps.length - todo.length} already done)` : ''}`);
  const awake = keepAwake();
  const py = pythonCmd() || 'python', node = process.execPath, t0 = Date.now();
  const want = s => !steps || steps.includes(s);
  try {
    for (const [i, e] of todo.entries()) {
      const log = path.join(e.dir, 'build', 'batch.log'); fs.mkdirSync(path.dirname(log), { recursive: true }); fs.writeFileSync(log, `batch ${new Date().toISOString()}\n`);
      const st = state[e.name] = { status: 'running', started: new Date().toISOString(), steps: {} };
      fs.writeFileSync(STATE(ws), JSON.stringify(state, null, 1));
      const elapsed = (Date.now() - t0) / 1000, eta = i ? elapsed / i * (todo.length - i) : null;
      console.log(`\n[${i + 1}/${todo.length}] ${e.name}${eta ? `  (about ${Math.round(eta / 60)} min left)` : ''}`);
      const plan = [
        ['vo', () => step(py, [path.join(HERE, 'voiceover.py'), e.dir], log)],
        ['images', () => JSON.stringify(e.reel).includes('image_prompt') || JSON.stringify(e.reel).includes('bg_prompt') ? step(node, [path.join(HERE, 'imagegen.mjs'), e.dir], log) : { ok: true, secs: 0, skipped: true }],
        ['photos', () => JSON.stringify(e.reel).includes('photo_query') ? step(node, [path.join(HERE, 'photos.mjs'), 'project', e.dir], log) : { ok: true, secs: 0, skipped: true }],
        ['render', () => step(node, [path.join(HERE, 'render.mjs'), e.dir], log)],
      ];
      let failed = null;
      for (const [name, fn] of plan) {
        if (!want(name)) continue;
        process.stdout.write(`   ${name.padEnd(7)} … `);
        const r = fn(); st.steps[name] = r.skipped ? 'skipped' : r.ok ? `ok (${r.secs}s)` : 'failed';
        console.log(r.skipped ? 'skipped' : r.ok ? `ok (${r.secs}s)` : `FAILED: ${r.tail}`);
        // a failed image/photo step is not fatal: the render falls back to drawings and lists what's missing
        if (!r.ok && (name === 'vo' || name === 'render')) { failed = name; break; }
      }
      st.status = failed ? 'failed' : 'done'; st.finished = new Date().toISOString(); if (failed) st.error = `${failed} failed: see ${path.relative(ws, log)}`;
      fs.writeFileSync(STATE(ws), JSON.stringify(state, null, 1));
    }
  } finally { if (awake) try { awake.kill(); } catch { /* gone */ } }
  console.log(`\nBatch finished in ${Math.round((Date.now() - t0) / 60000)} min.`);
  review(ws);
}

function status(ws) {
  const state = readJson(STATE(ws)) || {};
  for (const e of episodes(ws)) { const s = state[e.name]; console.log(`${(s?.status || 'not run').padEnd(8)} ${e.name}${s?.error ? '  ← ' + s.error : ''}`); }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function review(ws) {
  const state = readJson(STATE(ws)) || {};
  const cards = episodes(ws).map(e => {
    const out = path.join(e.dir, 'out'), slug = (e.reel.slug || e.reel.title || e.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const mp4 = [path.join(out, slug + '.mp4')].concat(fs.existsSync(out) ? fs.readdirSync(out).filter(f => f.endsWith('.mp4') && !f.includes('preview')).map(f => path.join(out, f)) : []).find(f => fs.existsSync(f));
    const cover = ['cover.png', 'thumbnail.jpg'].map(f => path.join(out, f)).find(f => fs.existsSync(f));
    const eng = readJson(path.join(out, 'engagement.json')), tl = readJson(path.join(out, 'timeline.json'));
    const caps = fs.existsSync(path.join(out, 'captions.md')) ? fs.readFileSync(path.join(out, 'captions.md'), 'utf8').slice(0, 600) : '';
    const credits = fs.existsSync(path.join(out, 'credits.txt')) ? fs.readFileSync(path.join(out, 'credits.txt'), 'utf8').split('\n').length - 2 : 0;
    const s = state[e.name] || {};
    const fails = (eng?.checks || []).filter(c => !c.ok).map(c => `<li>${esc(c.rule)}: ${esc(c.detail)}</li>`).join('');
    const rel = f => f ? encodeURI('file:///' + f.replace(/\\/g, '/')) : '';
    return `<article class="ep ${esc(s.status || 'new')}"><div class="cov">${cover ? `<img src="${rel(cover)}" alt="">` : '<div class="none">no cover yet</div>'}</div>
<div class="txt"><h2>${esc(e.reel.title || e.name)}</h2><p class="meta">${esc(s.status || 'not run')}${tl ? ` · ${tl.total.toFixed(0)} s · ${esc(tl.look)}` : ''}${eng ? ` · engagement ${esc(eng.score)}` : ''}${credits > 0 ? ` · ${credits} credit(s)` : ''}</p>
${mp4 ? `<p><a href="${rel(mp4)}">▶ open video</a> · <a href="${rel(out)}">folder</a></p>` : ''}${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
${fails ? `<details><summary>To improve</summary><ul>${fails}</ul></details>` : ''}${caps ? `<details><summary>Captions</summary><pre>${esc(caps)}</pre></details>` : ''}</div></article>`;
  });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Batch review</title>
<style>:root{--bg:#F4F1EA;--fg:#1B1A18;--mut:#6E6A62;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#141312;--fg:#EEE9DF;--mut:#9C968B;--card:#1E1D1B}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:20px 16px}
.ep{display:grid;grid-template-columns:160px 1fr;gap:16px;background:var(--card);border-radius:12px;padding:12px;margin:0 0 14px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ep.failed{outline:2px solid #C8302A}.cov img{width:160px;border-radius:8px;display:block}.none{width:160px;height:120px;display:grid;place-items:center;color:var(--mut);border:1px dashed var(--mut);border-radius:8px}
h2{margin:0 0 4px;font-size:18px}.meta{color:var(--mut);margin:0 0 6px}.err{color:#C8302A}pre{white-space:pre-wrap;font-size:13px}a{color:inherit}
@media (max-width:560px){.ep{grid-template-columns:1fr}.cov img,.none{width:100%}}</style></head><body><main><h1>Batch review</h1>
<p class="meta">${cards.length} episode(s) in ${esc(ws)} · built ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</p>${cards.join('\n')}</main></body></html>`;
  const f = path.join(ws, 'review.html'); fs.writeFileSync(f, html); console.log(`review: ${f}`); return f;
}

function isMainModule(url) { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; } }
if (process.argv[1] && isMainModule(import.meta.url)) {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : null; };
  const cmd = a[0], ws = path.resolve(a.find((x, i) => i > 0 && !x.startsWith('--') && a[i - 1] !== '--only' && a[i - 1] !== '--steps') || loadSettings().output?.projects_dir || '.');
  if (cmd === 'run') await run(ws, { only: opt('only')?.split(','), force: a.includes('--force'), steps: opt('steps')?.split(',') });
  else if (cmd === 'status') status(ws);
  else if (cmd === 'review') review(ws);
  else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '').trim());
}
