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
t('hold scenes and carried overlays', () => {
  const proj = path.join(tmpProj, 'hold'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'art', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#fff" stroke="#111" stroke-width="6"/><circle cx="320" cy="100" r="18" fill="#111"/></svg>');
  const vis = { type: 'art', svg_file: 'art/card.svg', w: 800, y: 1000, shadow: false };
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ scenes: [
    { id: 'intro', duration: 3, headline: ['LOOK'], visual: { type: 'art', svg_file: 'art/card.svg', w: 300 } },
    { id: 'a', hold: true, duration: 3, headline: ['STARE'], visual: vis, overlays: [{ type: 'chip', text: 'KEEP STARING', x: 540, y: 1400, carry: true }] },
    { id: 'b', hold: true, duration: 7, headline: ['STARE'], visual: vis, overlays: [{ type: 'chip', text: 'OWN CHIP', x: 560, y: 1405 }, { type: 'countdown', from: 3, at: 0.2, tick: false, y: 600 }] },
    { id: 'c', duration: 3, headline: ['DONE'], visual: { type: 'art', svg_file: 'art/card.svg', w: 300 }, overlays: [{ type: 'chip', text: 'LAST', x: 560, y: 1405 }] },
    { id: 'end', duration: 3, visual: { type: 'endcard', kicker: 'TOMORROW', title: 'GOOSEBUMPSXX', next: 'Why?' } }] }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (/\[page error\]/.test(all) || r.status !== 0) throw new Error('render failed: ' + all.slice(-400));
  if (!/b: "KEEP STARING" → overlaps or touches "OWN CHIP"/.test(all)) throw new Error('the carried chip is not in the next hold scene');
  if (/c: "KEEP STARING"/.test(all)) throw new Error('the chip was carried past a change of visual');
  if (!/1 intentional hold not counted/.test(all)) throw new Error('a 7 s hold scene still counts as held too long');
  if (/b: 7\.0s/.test(all)) throw new Error('hold scene listed as too long');
  if (/end: "GOOSEBUMPSXX[^"]*" → off canvas/.test(all)) throw new Error('long end-card title runs off the frame');
  return 'chip carried while the visual stays, hold not counted as too long, long end-card title fits';
});
t('ink auto keeps dark details on light shapes; page labels are checked', () => {
  const proj = path.join(tmpProj, 'ink'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true });
  // a white "ghost" with a big dark eye in its middle, and a dark label on the page under it
  fs.writeFileSync(path.join(proj, 'art', 'ghost.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260"><rect x="20" y="20" width="160" height="160" fill="#FFFFFF"/><rect x="60" y="60" width="80" height="80" fill="#111111"/><text x="100" y="240" text-anchor="middle" font-size="36" fill="#111111">FEAR</text></svg>');
  const sc = ink => ({ id: ink ? 'inked' : 'plain', theme: 'dark', duration: 2, camera: 'none', headline: ['GHOST'], visual: { type: 'art', svg_file: 'art/ghost.svg', w: 400, x: 540, y: 960, enter: 'none', at: 0, motion: 'none', shadow: false, ...(ink ? { ink: 'auto' } : {}) } });
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ film_fx: false, scenes: [sc(true), sc(false)] }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error('render failed: ' + all.slice(-300));
  if (!/plain: "illustration" → 1 label\(s\) in the drawing blend into the page \("FEAR"\)/.test(all)) throw new Error('dark label on a dark page not flagged');
  if (/inked: "illustration" → .*label/.test(all)) throw new Error('ink auto did not lighten the page label');
  // the eye sits at the centre of the art: it must still be dark after ink auto (the ghost keeps its face)
  const px = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(proj, 'build', 'stills', '01.png'), '-vf', 'crop=4:4:538:' + (960 - 2 - 0) + ',scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 });
  const v = px.stdout?.[0];
  if (v == null) throw new Error('could not read the still');
  if (v > 90) throw new Error(`the eye on the white shape was recoloured (brightness ${v})`);
  return `eye stays dark (brightness ${v}), page label lightened, label check fires without ink`;
});
t('caption styles: own class names, a gap between words', () => {
  const css = fs.readFileSync(path.join(HERE, 'engine', 'engine.css'), 'utf8');
  // the caption box carries the style name as a class ("subs tape"): a bare .tape{…} rule elsewhere would restyle it
  const names = ['word', 'karaoke', 'pop', 'box', 'tape', 'line'];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) for (const sel of m[1].split(',').map(x => x.trim())) {
    const n = names.find(n => sel === '.' + n);
    if (n) throw new Error(`a bare ".${n}" rule also styles the "${n}" caption box`);
  }
  if (!/\.subs i\{[^}]*display:inline-block[^}]*margin:0 \.1/.test(css)) throw new Error('caption words lost their margin (the outline paints over a plain space)');
  return 'no clashes; words keep a margin';
});
t('Urdu aerab: missing marks found, marked text checked against vo', () => {
  // voiceover.py: which lines would be voiced without aerab (no audio is made here)
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const scenes = [{ id: 'bare', vo: 'یہ جلد ہے' }, { id: 'marked', vo: 'یہ جلد ہے', vo_tts: 'یہ جِلْد ہے' }, { id: 'en', vo: 'Skin' }];
  const r = spawnSync(py, ['-c', `import json,sys; sys.path.insert(0, ${JSON.stringify(HERE)}); import voiceover; print(json.dumps(voiceover.lines_without_aerab(json.loads(sys.stdin.read()))))`], { input: JSON.stringify(scenes), encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) throw new Error(r.stderr.slice(-300));
  if (JSON.parse(r.stdout).join() !== 'bare') throw new Error('expected only "bare", got ' + r.stdout);
  // localize --tts: the marked line must strip back to vo
  const ws = path.join(tmpProj, 'aerab'), srcP = path.join(ws, 'ep'); fs.mkdirSync(srcP, { recursive: true });
  fs.writeFileSync(path.join(srcP, 'reel.json'), JSON.stringify({ title: 'Skin', scenes: [{ id: 'a', vo: 'This is skin.' }, { id: 'b', vo: 'Soon.' }, { id: 'c', vo: 'Plain.' }] }));
  const lp = path.join(ws, 'lines.ur.json'), tp = path.join(ws, 'tts.ur.json');
  fs.writeFileSync(lp, JSON.stringify({ a: { vo: 'یہ جلد ہے۔' }, b: { vo: 'جلد آئے گا۔' }, c: { vo: 'سادہ۔' } }));
  fs.writeFileSync(tp, JSON.stringify({ a: 'یہ جِلْد ہے۔', b: 'جَلْد آئیں گے۔' }));
  const L = spawnSync(process.execPath, [path.join(HERE, 'localize.mjs'), srcP, '--lang', 'ur', '--lines', lp, '--tts', tp, '--voice', 'test-voice', '--out', path.join(ws, 'ep-ur')], { encoding: 'utf8', cwd: ROOT });
  const all = (L.stdout || '') + (L.stderr || '');
  if (L.status !== 0) throw new Error(all.slice(-300));
  const o = JSON.parse(fs.readFileSync(path.join(ws, 'ep-ur', 'reel.json'), 'utf8'));
  if (o.scenes[0].vo_tts !== 'یہ جِلْد ہے۔' || o.scenes[0].vo !== 'یہ جلد ہے۔') throw new Error('vo_tts / vo not set as expected');
  if (/a: vo_tts doesn't match/.test(all)) throw new Error('a matching marked line was reported');
  if (!/b: vo_tts doesn't match vo at word 2: "آئے" in vo, "آئیں" in vo_tts/.test(all)) throw new Error('a mismatched marked line was not reported\n' + all);
  if (!/1 line\(s\) have no aerab \(c\)/.test(all)) throw new Error('the line without aerab was not listed');
  return 'bare line found; --tts applied; mismatch at word 2 reported';
});
t('localize: channel block, text overrides, cue warnings, destination voice', () => {
  const ws1 = path.join(tmpProj, 'loc-a'), ws2 = path.join(tmpProj, 'loc-b'), srcP = path.join(ws1, 'ep1');
  fs.mkdirSync(srcP, { recursive: true }); fs.mkdirSync(ws2, { recursive: true });
  fs.writeFileSync(path.join(srcP, 'reel.json'), JSON.stringify({ title: 'Onions', brand: { name: 'A' }, series: { name: 'S1' }, scenes: [
    { id: 'hook', vo: 'Why do onions make you cry?', headline: ['WHY', 'ONIONS'], overlays: [{ type: 'tag', kicker: 'SERIES A', text: 'EP 01', at: 'word:cry' }, { type: 'big', text: '?' }] },
    { id: 'mid', vo: 'Yawns spread.', headline: ['YAWNS'], beats: [{ at: '50%', overlays: [{ type: 'chip', text: 'DID YOU YAWN?' }] }] },
    { id: 'end', vo: 'Follow.', visual: { type: 'endcard', kicker: 'TOMORROW', title: 'YAWNS', next: 'Why yawn?' } }] }));
  fs.writeFileSync(path.join(ws2, 'series.json'), JSON.stringify({ series: { 'S2': { voices: { ur: { voice_id: 'dest-voice-ur' } } } } }));
  const lp = path.join(tmpProj, 'lines.ur.json');
  fs.writeFileSync(lp, JSON.stringify({ reel: { brand: { name: 'B' }, series: { name: 'S2' }, title: 'Pyaz' },
    hook: { vo: 'دو بار دو آنسو کیوں آتے ہیں؟', cues: { cry: 'دو' }, headline: ['KYUN', 'PYAZ'], overlays: [{ kicker: 'SILSILA B' }, false] },
    mid: { vo: 'جمائی پھیلتی ہے۔', beats: [{ overlays: [{ text: 'JAMAAI AAYI?' }] }] },
    end: { vo: 'فالو کریں۔', visual: { title: 'JAMAAI' } } }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'localize.mjs'), srcP, '--lang', 'ur', '--lines', lp, '--out', path.join(ws2, 'ep1-ur')], { encoding: 'utf8', cwd: ROOT });
  const all = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error(all.slice(-400));
  const o = JSON.parse(fs.readFileSync(path.join(ws2, 'ep1-ur', 'reel.json'), 'utf8')), [h, m, e] = o.scenes;
  if (m.beats[0].overlays[0].text !== 'JAMAAI AAYI?') throw new Error('beat overlay override not applied');
  if (!/mid headline/.test(all) || /mid beat 0 chip/.test(all)) throw new Error('leftover list wrong for beats');
  if (o.brand.name !== 'B' || o.series.name !== 'S2' || o.title !== 'Pyaz') throw new Error('reel block not applied: ' + JSON.stringify([o.brand, o.series, o.title]));
  if (h.headline[0] !== 'KYUN' || h.overlays.length !== 1 || h.overlays[0].kicker !== 'SILSILA B' || h.overlays[0].text !== 'EP 01') throw new Error('overlay overrides wrong: ' + JSON.stringify(h.overlays));
  if (e.visual.title !== 'JAMAAI' || e.visual.kicker !== 'TOMORROW') throw new Error('end card merge wrong');
  if (o.voice.elevenlabs.voice_id !== 'dest-voice-ur') throw new Error('voice not taken from the destination series.json');
  if (!/cue "cry" → "دو" uses "دو", which matches/.test(all)) throw new Error('repeated cue word not warned');
  return 'brand/series/title, overlays (merge + drop), beats, end card, destination voice, cue warning';
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
