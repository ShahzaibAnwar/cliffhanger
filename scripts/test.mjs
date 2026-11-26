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

t('scripts run through a linked install (~/.claude/skills is usually a link)', () => {
  const link = path.join(os.tmpdir(), `cliff-link-${process.pid}`);
  try { fs.unlinkSync(link); } catch { /* none left over */ }       // unlink only: never delete through a link
  fs.symlinkSync(ROOT, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const out = sh(process.execPath, [path.join(link, 'scripts', 'imagegen.mjs'), '--styles']);
    if (!/engraving/.test(out)) throw new Error('imagegen.mjs printed nothing when run through a link');
    const sf = sh(process.execPath, [path.join(link, 'scripts', 'sfx.mjs')]);
    if (!/whoosh/.test(sf)) throw new Error('sfx.mjs printed nothing when run through a link');
    return 'imagegen, sfx respond';
  } finally { try { fs.unlinkSync(link); } catch { /* gone */ } }
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

const { prepare } = await import('./photos.mjs');
const { findSound } = await import('./sfx.mjs');
const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'cliff-media-'));
const { alignWords } = await import('./align.mjs');
t('captions keep the script words when vo_tts differs', () => {
  const mk = s => s.split(' ').map((w, i) => ({ w, s: i, e: i + 0.9 }));
  const cases = [['In 2007, they flew.', 'IN TWO THOUSAND SEVEN they flew.', 'In|2007,|they|flew.', [1, 3.9]],
    ['This is WonderByte.', 'This is Wonder Byte.', 'This|is|WonderByte.', [2, 3.9]],
    ['NASA flew it on Foton-M3.', 'Nasa flew it on Foton M three.', 'NASA|flew|it|on|Foton-M3.', [4, 6.9]]];
  for (const [vo, said, want, span] of cases) {
    const r = alignWords(vo, mk(said)), got = r.map(w => w.w).join('|');
    if (got !== want) throw new Error(`"${said}" → ${got}, expected ${want}`);
    const w = r.find(x => /\d|Byte/.test(x.w)); if (Math.abs(w.s - span[0]) > 0.01 || Math.abs(w.e - span[1]) > 0.01) throw new Error(`${w.w} timed ${w.s}-${w.e}, expected ${span}`);
  }
  return 'numbers, joined words and re-spellings take the spoken timing';
});
const { relevance, creditLine } = await import('./library.mjs');
t('credit lines name the licence version once', () => {
  const l = creditLine({ title: 'Tardigrade', creator: 'X', licence: 'cc0', licence_version: '1.0', source: 'Flickr', page: 'https://example.org' });
  if (/1\.0.*1\.0/.test(l)) throw new Error(l);
  return l.split(' · ')[1];
});
t('photo search keeps on-topic results only', () => {
  const cases = [['naked mole rat', { title: 'Naked Mole Rats' }, 1], ['greenland shark', { title: 'Bowl Depicting Shark', tags: 'ceramics' }, 0.5],
    ['axolotl', { title: 'Self-Portrait', tags: 'painting portrait' }, 0], ['axolotl', { title: 'IMG_2231', tags: 'axolotl amphibian' }, 1]];
  for (const [q, c, want] of cases) { const r = relevance(q, c); if (Math.abs(r - want) > 0.01) throw new Error(`relevance("${q}", "${c.title}") = ${r}, expected ${want}`); }
  return 'title and tags matched; off-topic museum hits rejected';
});
t('photo prep: plain background → cut-out, busy → print', () => {
  const plain = path.join(tmpProj, 'plain.png'), busy = path.join(tmpProj, 'busy.png');
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=0xEDEDED:s=600x600', '-vf', 'drawbox=x=180:y=150:w=240:h=300:color=0x553311:t=fill', '-frames:v', '1', plain]);
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=600x600', '-frames:v', '1', busy]);
  const a = prepare(plain, path.join(tmpProj, 'a')), b = prepare(busy, path.join(tmpProj, 'b'));
  if (a.kind !== 'cutout') throw new Error('plain background was not cut out: ' + JSON.stringify(a));
  if (b.kind !== 'print') throw new Error('busy photo was cut out: ' + JSON.stringify(b));
  return 'cut-out + print';
});
await (async () => {
  const sdir = path.join(tmpProj, 'sfx'); fs.mkdirSync(sdir, { recursive: true });
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=300:d=0.5', path.join(sdir, 'creaky-door-01.wav')]);
  const r = await findSound('creaky door', { proj: tmpProj, allowNetwork: false });
  t('own sounds are found by their file names', () => { if (!r || !/creaky-door-01/.test(r.file)) throw new Error('project sfx/ file not matched'); return 'sfx/creaky-door-01.wav'; });
})();
t('video clips play frame-exact', () => {
  const proj = path.join(tmpProj, 'clip'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true });
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x360:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(proj, 'art', 'c.mp4')]);
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ title: 'clip', scenes: [{ id: 'c', duration: 3, headline: ['CLIP'], visual: { type: 'art', video: 'art/c.mp4', finish: 'print', motion: 'none' } }] }));
  const out = sh(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--at', '0.5,2.0']);
  if (/\[page error\]/.test(out)) throw new Error('page errors');
  const [f1, f2] = ['01.png', '02.png'].map(f => fs.readFileSync(path.join(proj, 'build', 'stills', f)));
  if (f1.equals(f2)) throw new Error('the clip did not move between 0.5 s and 2.0 s');
  return 'moves between frames';
});
process.on('exit', () => { try { fs.rmSync(tmpProj, { recursive: true, force: true }); } catch { /* temp */ } });

const { parseRetention } = await import('./analytics.mjs');
t('retention import (CSV with % positions or seconds)', () => {
  const a = parseRetention('Video position (%),Absolute audience retention (%)\n0,100\n50,60\n100,35', 60);
  const b = parseRetention('time,retention\n0:00,1\n0:30,0.55\n1:00,0.3', 60);
  if (a[1].t !== 30 || a[1].r !== 60 || b[1].t !== 30 || b[1].r !== 55) throw new Error(JSON.stringify({ a, b }));
  return 'YouTube export + generic CSV';
});
t('looks, map and chart render', () => {
  const proj = path.join(tmpProj, 'vis'); fs.mkdirSync(path.join(proj, 'data'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'data', 'u.csv'), 'year,n\n2020,1\n2021,3\n2022,6\n');
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ title: 'vis', look: 'comic', scenes: [
    { id: 'm', duration: 2, headline: ['MAP'], visual: { type: 'map', highlight: ['PAK'], route: [[67, 24.9], [116.4, 39.9]], points: [{ lon: 67, lat: 24.9, label: 'Karachi' }] } },
    { id: 'c', theme: 'dark', look: 'blueprint', duration: 2, headline: ['CHART'], visual: { type: 'chart', csv: 'data/u.csv', x_col: 'year', y_col: 'n', unit: 'M' },
      overlays: [{ type: 'countdown', from: 2, at: 0.1 }] }] }));
  const out = sh(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--at', '1.8,3.8']);
  if (/\[page error\]/.test(out)) throw new Error('page errors');
  return 'comic + blueprint, map + CSV chart + countdown';
});
t('stills check: contrast, touching labels, map names, late punch lines', () => {
  const proj = path.join(tmpProj, 'lowc'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'art', 'dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect x="40" y="40" width="320" height="320" fill="#141826" stroke="#10131F" stroke-width="6"/><circle cx="200" cy="200" r="90" fill="#1A1F33" stroke="#0E1120" stroke-width="6"/><circle cx="200" cy="200" r="30" fill="#161A2A"/><path d="M60 300 L340 300" stroke="#121624" stroke-width="8"/></svg>');
  fs.writeFileSync(path.join(proj, 'art', 'outlined.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect x="40" y="40" width="320" height="320" fill="#EFE8D6" stroke="#111" stroke-width="8"/><circle cx="200" cy="200" r="90" fill="#E8E0CC" stroke="#111" stroke-width="8"/><circle cx="200" cy="200" r="30" fill="#F2EEE6" stroke="#111" stroke-width="6"/></svg>');
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ scenes: [
    { id: 'a', theme: 'dark', duration: 2, headline: ['DARK', 'ART'], visual: { type: 'art', svg_file: 'art/dark.svg', w: 700 } },
    { id: 'b', theme: 'paper', duration: 2, headline: ['OUTLINED'], visual: { type: 'art', svg_file: 'art/outlined.svg', w: 700 },
      overlays: [{ type: 'chip', text: 'LEFT CHIP', x: 400, y: 900 }, { type: 'chip', text: 'RIGHT CHIP', x: 560, y: 905, style: 'red' }] },
    { id: 'm', theme: 'dark', look: 'blueprint', duration: 4, headline: ['POINT', 'NEMO'], punch_at: 3.5, visual: { type: 'map', bounds: [-180, -70, -65, 5], highlight: ['Chille'] } }] }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (!/- a: "illustration" → low contrast/.test(all)) throw new Error('dark art on a dark page not flagged');
  if (/- b: "illustration" → low contrast/.test(all)) throw new Error('outlined pale art on paper flagged');
  if (!/overlaps or touches "RIGHT CHIP"/.test(all)) throw new Error('touching chips not flagged');
  if (!/highlight "Chille".*did you mean "Chile"/.test(all)) throw new Error('unknown map highlight not flagged');
  if (!/m: "NEMO" appears 3\.5 s in/.test(all)) throw new Error('late punch line not flagged');
  return 'dark-on-dark flagged, outlined art passes, touching chips, unknown map name, late punch line flagged';
});
const { pickStyle } = await import('./style.mjs');
t('auto style picks a look from the topic', () => {
  const cases = [['the dancing plague, a real epidemic', 'newsprint'], ['unsolved signal from space? no: the unsolved wow signal', null], ['fun facts about axolotl animals', 'comic'], ['quantum gravity', 'case-file']];
  for (const [q, want] of cases) { const r = pickStyle(q); if (want && r.look !== want) throw new Error(`"${q}" → ${r.look}, expected ${want}`); }
  if (!pickStyle('the unsolved wow signal').look) throw new Error('no look');
  return 'topic → look, default when nothing matches';
});
t('component gallery renders (stills)', () => {
  const out = sh(process.execPath, [path.join(HERE, 'render.mjs'), path.join(ROOT, 'examples', 'component-gallery'), '--stills']);
  if (/\[page error\]/.test(out)) throw new Error('page errors:\n' + out.split('\n').filter(l => l.includes('[page error]')).join('\n'));
  const a0 = out.indexOf('{'), j = JSON.parse(out.slice(a0, out.indexOf('\n}', a0) + 2));   // JSON summary, before the engagement report
  for (const f of j.frames) { const p = path.join(j.dir, f.split(' ')[0]); if (!fs.existsSync(p) || fs.statSync(p).size < 20000) throw new Error('blank or missing still ' + f); }
  if (!fs.existsSync(j.contact)) throw new Error('no contact sheet');
  return `${j.frames.length} scenes → ${path.relative(ROOT, j.contact)}`;
});

console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
