#!/usr/bin/env node
/* Smoke test: no API keys, no network calls to paid services.
     node scripts/test.mjs      (or: cd scripts && npm test)
   1. every script parses   2. settings and reel examples are valid JSON   3. character references resolve
   4. the component gallery renders one still per scene with no page errors */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pythonCmd } from './doctor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let failed = 0;
const t = (name, fn) => {
  try { const r = fn(); console.log(`  ✔ ${name}${r ? '  ' + r : ''}`); }
  catch (e) { failed++; console.log(`  ✘ ${name}\n      ${String(e.message || e).split('\n').slice(0, 6).join('\n      ')}`); }
};
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → exit ${r.status}\n${(r.stderr || r.stdout || '').slice(-800)}`);
  return r.stdout;
};

console.log('Cliffhanger smoke test');

t('scripts parse', () => {
  const files = fs.readdirSync(HERE).filter(f => f.endsWith('.mjs'));
  for (const f of files) sh(process.execPath, ['--check', path.join(HERE, f)]);
  sh(process.execPath, ['--check', path.join(HERE, 'engine', 'engine.js')]);
  const py = pythonCmd();
  if (py) sh(py, ['-c', `import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())`, path.join(HERE, 'voiceover.py')]);
  return `${files.length} node scripts + engine${py ? ' + voiceover.py' : ''}`;
});

t('JSON files are valid', () => {
  const list = ['settings.example.json', 'examples/hypnic-jerk/reel.json', 'examples/component-gallery/reel.json'];
  for (const f of list) JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  return list.length + ' files';
});

t('art library SVGs are well-formed', () => {
  const dir = path.join(ROOT, 'assets', 'art'), svgs = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));
  for (const f of svgs) { const s = fs.readFileSync(path.join(dir, f), 'utf8'); if (!/^\s*<svg[\s>]/.test(s) || !/<\/svg>\s*$/.test(s)) throw new Error(f + ' is not a complete <svg>'); }
  return svgs.length + ' drawings';
});

const { makeCharacterResolver, resolveGenerated } = await import('./imagegen.mjs');
t('character references (offline)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cliff-test-'));
  try {
    const chars = { hero: { look: 'man with a grey beard, blue coat' } };
    const who = makeCharacterResolver(chars, proj, {});
    const a = who({ spec: { image_prompt: 'standing', character: 'hero' }, theme: 'paper' });
    if (!a.image_prompt.includes('grey beard')) throw new Error('look was not added to the prompt');
    if (a.image_ref) throw new Error('the first image must not have a reference');
    const scenes = [{ id: 'x', theme: 'paper', visual: { type: 'art', image_prompt: 'nothing generated yet', svg_file: '@lib/heart.svg' } }];
    const missing = resolveGenerated(scenes, proj, { provider: 'off' }, chars);
    if (missing.length !== 1) throw new Error('missing image was not reported');
    return 'look added, first image is the anchor, fallback kept';
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});

t('component gallery renders (stills)', () => {
  const out = sh(process.execPath, [path.join(HERE, 'render.mjs'), path.join(ROOT, 'examples', 'component-gallery'), '--stills']);
  if (/\[page error\]/.test(out)) throw new Error('page errors:\n' + out.split('\n').filter(l => l.includes('[page error]')).join('\n'));
  const j = JSON.parse(out.slice(out.indexOf('{')));
  for (const f of j.frames) { const p = path.join(j.dir, f.split(' ')[0]); if (!fs.existsSync(p) || fs.statSync(p).size < 20000) throw new Error('blank or missing still ' + f); }
  if (!fs.existsSync(j.contact)) throw new Error('no contact sheet');
  return `${j.frames.length} scenes → ${path.relative(ROOT, j.contact)}`;
});

console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
