#!/usr/bin/env node
/* Smoke test: no API keys, no network calls to paid services.
     node scripts/test.mjs      (or: cd scripts && npm test)
   1. every script parses   2. settings and reel examples are valid JSON   3. character references resolve
   4. the component gallery renders one still per scene with no page errors */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const [f1, f2] = ['at-0.5s.png', 'at-2s.png'].map(f => fs.readFileSync(path.join(proj, 'build', 'stills', f)));
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
t('drawing checks: flat clip-art, text in art, cut-off ink; artkit, view crop, --at names', () => {
  const proj = path.join(tmpProj, 'artchk'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true });
  const run = a => { const r = spawnSync(a[0], a.slice(1), { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 }); if (r.status !== 0) throw new Error(a.join(' ') + ' failed: ' + (r.stderr || r.stdout).slice(-400)); return (r.stdout || '') + (r.stderr || ''); };
  // v1-style clip-art: flat fills, a label inside, a label that runs off the right edge
  fs.writeFileSync(path.join(proj, 'art', 'flat.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><ellipse cx="200" cy="170" rx="150" ry="90" fill="#C4C9D2" stroke="#2b2420" stroke-width="5"/><circle cx="90" cy="120" r="40" fill="#E9A3B8"/><circle cx="80" cy="160" r="8" fill="#111"/><text x="300" y="60" font-size="40" fill="#2b2420">NEW HAIR</text></svg>');
  run(['python', path.join(HERE, 'artkit.py'), '--demo', path.join(proj, 'art', 'kit.svg')]);
  const out = run([process.execPath, path.join(HERE, 'art-preview.mjs'), path.join(proj, 'art'), '--out', path.join(proj, 'sheet.png')]);
  if (!/flat\.svg: flat clip-art/.test(out)) throw new Error('flat clip-art not flagged');
  if (!/flat\.svg: text inside the drawing \("NEW HAIR"\)/.test(out)) throw new Error('text in art not flagged');
  if (!/flat\.svg: the drawing runs past its viewBox \(right \d+/.test(out)) throw new Error('cut-off label not flagged:\n' + out);
  if (/kit\.svg:/.test(out)) throw new Error('the artkit demo drawing got warnings:\n' + out);
  // library drawings stay clean
  const lib = run([process.execPath, path.join(HERE, 'art-preview.mjs'), path.join(ROOT, 'assets', 'art'), '--out', path.join(proj, 'lib.png')]);
  if (/drawing warning/.test(lib)) throw new Error('library drawings have warnings:\n' + lib);
  // --stills repeats the checks; --at frames are named by time and keep the stills set
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ scenes: [
    { id: 'a', duration: 2, headline: ['FLAT'], visual: { type: 'art', svg_file: 'art/flat.svg', w: 700 } },
    { id: 'b', duration: 2, headline: ['CLOSE', 'UP'], visual: { type: 'art', svg_file: '@lib/arm.svg', view: '130 84 765 150', w: 1000 } }] }));
  const st = run([process.execPath, path.join(HERE, 'render.mjs'), proj, '--stills']);
  if (!/drawing warning\(s\)/.test(st) || !/art\/flat\.svg: flat clip-art/.test(st)) throw new Error('--stills did not check the drawing');
  if (/@lib\/arm\.svg:/.test(st)) throw new Error('library arm flagged in --stills');
  run([process.execPath, path.join(HERE, 'render.mjs'), proj, '--at', '0.5,3']);
  const dir = path.join(proj, 'build', 'stills');
  for (const f of ['01.png', '02.png', 'at-0.5s.png', 'at-3s.png']) if (!fs.existsSync(path.join(dir, f))) throw new Error('missing still ' + f + ' (have ' + fs.readdirSync(dir).join(', ') + ')');
  // "view" crops the drawing: the same scene without it must look different
  const p2 = path.join(tmpProj, 'artchk2'); fs.mkdirSync(p2, { recursive: true });
  fs.writeFileSync(path.join(p2, 'reel.json'), JSON.stringify({ scenes: [{ id: 'a', duration: 2, headline: ['FLAT'], visual: { type: 'art', svg_file: '@lib/arm.svg', w: 700 } },
    { id: 'b', duration: 2, headline: ['CLOSE', 'UP'], visual: { type: 'art', svg_file: '@lib/arm.svg', w: 1000 } }] }));
  run([process.execPath, path.join(HERE, 'render.mjs'), p2, '--at', '3']);
  if (fs.readFileSync(path.join(dir, 'at-3s.png')).equals(fs.readFileSync(path.join(p2, 'build', 'stills', 'at-3s.png')))) throw new Error('"view" made no difference');
  return 'v1-style art flagged 3 ways, artkit demo + library clean, --stills checks, view crop, at-<t>s.png kept beside 01.png';
});
t('3D close-ups render (three.js, when installed)', () => {
  const o = path.join(tmpProj, 'three', 'cells.png');
  const r = spawnSync(process.execPath, [path.join(HERE, 'three-render.mjs'), '@three/cells', o, '--w', '400', '--h', '300'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 16 << 20 });
  if (r.status === 2 && /not installed/.test(r.stderr)) return 'skipped: three.js not installed (that is a download, the user\'s call)';
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).slice(-400));
  const a = spawnSync('ffmpeg', ['-v', 'error', '-i', o, '-vf', 'alphaextract,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 }).stdout?.[0];
  if (!(a > 10 && a < 245)) throw new Error('expected a transparent PNG with cells on it (mean alpha ' + a + ')');
  const s2 = spawnSync(process.execPath, [path.join(HERE, 'three-render.mjs'), '@three/skin', path.join(tmpProj, 'three', 'skin.png'), '--w', '400', '--h', '300', '--bg', 'F1EBDF'], { encoding: 'utf8', cwd: ROOT });
  if (s2.status !== 0) throw new Error('skin template failed: ' + (s2.stderr || '').slice(-300));
  return 'cells (transparent) + skin (paper background)';
});
t('ink auto keeps dark hair, caption band covers art and compare labels, cut-ins split long shots', () => {
  const proj = path.join(tmpProj, 'why04'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true }); fs.mkdirSync(path.join(proj, 'build'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'art', 'mic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 600"><clipPath id="c"><rect x="40" y="10" width="120" height="580" rx="40"/></clipPath><g clip-path="url(#c)"><rect width="200" height="600" fill="url(#kit-metal)"/></g><rect x="40" y="10" width="120" height="580" rx="40" fill="none" stroke="#2b2420" stroke-width="6"/></svg>');
  fs.writeFileSync(path.join(proj, 'art', 'head.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><clipPath id="h"><circle cx="200" cy="220" r="150"/></clipPath><g clip-path="url(#h)"><rect width="400" height="400" fill="url(#kit-skin)"/></g><path d="M60 200 C 60 60, 340 60, 340 200 L 300 150 L 100 150 Z" fill="#3B2A22"/><circle cx="150" cy="240" r="12" fill="#111"/><circle cx="250" cy="240" r="12" fill="#111"/><circle cx="200" cy="220" r="150" fill="none" stroke="#111" stroke-width="6"/></svg>');
  const LONG = 'This is a long line that keeps going on and on so the scene lasts well over five seconds on screen today friends';
  const reel = { title: 'w4', subtitles: { burn: true }, scenes: [
    { id: 'mic', vo: 'The studio mic sits here and it is tall.', headline: ['THE', 'MIC'], visual: { type: 'art', svg_file: 'art/mic.svg', w: 420, y: 1020 } },
    { id: 'cmp', vo: 'What the mic hears versus what you hear.', headline: ['TWO', 'VOICES'], visual: { type: 'compare', left: { svg_file: 'art/mic.svg', label: 'WHAT THE MIC HEARS', w: 120 }, right: { svg_file: 'art/mic.svg', label: 'WHAT YOU HEAR', w: 120 } } },
    { id: 'hair', theme: 'dark', vo: 'Your head bone carries it.', headline: ['HEAD', 'BONE'], visual: { type: 'art', svg_file: 'art/head.svg', ink: 'auto', w: 700 } },
    { id: 'stamped', vo: LONG, headline: ['STAMP'], overlays: [{ type: 'stamp', text: 'TRUE', at: '50%' }] },
    { id: 'plain', vo: LONG, headline: ['PLAIN'] }] };
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify(reel));
  const tm = {}; for (const x of reel.scenes) { const w = x.vo.split(/\s+/); tm[x.id] = { file: 'build/none.mp3', duration: w.length * 0.37 + 0.3, words: w.map((q, i) => ({ w: q, s: i * 0.37, e: i * 0.37 + 0.32 })) }; }
  fs.writeFileSync(path.join(proj, 'build', 'timings.json'), JSON.stringify({ scenes: tm }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error('render failed: ' + all.slice(-300));
  if (!/mic: "art art\/mic\.svg" → subtitle band/.test(all)) throw new Error('art in the caption band not flagged');
  if (!/cmp: "WHAT THE MIC HEARS" → subtitle band/.test(all)) throw new Error('compare label in the caption band not flagged');
  if (/hair:.*low contrast/.test(all)) throw new Error('dark hair with a light outline flagged as low contrast');
  if (/- stamped:/.test(all) || !/- plain:/.test(all)) throw new Error('a mid-line stamp should split the shot (and only that scene)');
  // pixels: hair stays brown, eyes stay dark, the outline turns light (still 03, art centred at x 540)
  const px = (x, y) => spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(proj, 'build', 'stills', '03.png'), '-vf', `crop=4:4:${x - 2}:${y - 2},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 }).stdout?.[0];
  const hair = px(540, 1020), eye = px(453, 1247), line = Math.max(...[946, 950, 954].map(y => px(540, y)));
  if (!(hair < 90)) throw new Error('dark hair turned light (' + hair + ')');
  if (!(eye < 70)) throw new Error('eye on the skin turned light (' + eye + ')');
  if (!(line > 150)) throw new Error('outline on the dark page stayed dark (' + line + ')');
  return 'mic + compare label in the band, hair not flagged, stamp splits the shot';
});
t('localize: late punch words get punch_at, new beats from the lines file, beats block for long scenes', () => {
  const srcP = path.join(tmpProj, 'loc-src'), out = path.join(tmpProj, 'loc-src-ur'); fs.mkdirSync(srcP, { recursive: true });
  fs.writeFileSync(path.join(srcP, 'reel.json'), JSON.stringify({ title: 'Voice', scenes: [
    { id: 'hook', vo: 'Why does your voice sound weird on a mic?', headline: ['WHY', 'MIC'] },
    { id: 'long', vo: 'Because inside your head the bones carry the low notes to your ears and nobody else ever hears that part at all', headline: ['BONES'] }] }));
  const lp = path.join(tmpProj, 'lines.ur.json');
  fs.writeFileSync(lp, JSON.stringify({
    hook: { vo: 'آپ کی آواز عجیب کیوں لگتی ہے جب سنیں MIC', headline: ['KYUN', 'MIC'] },
    long: { vo: 'کیونکہ آپ کے سر کے اندر ہڈیاں نیچے سر کانوں تک لے جاتی ہیں اور یہ حصہ کوئی اور کبھی نہیں سنتا بالکل بھی نہیں', beats: [{ at: 'word:ہڈیاں', visual: { type: 'art', svg_file: '@lib/skull.svg' } }] } }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'localize.mjs'), srcP, '--lang', 'ur', '--lines', lp, '--out', out], { encoding: 'utf8', cwd: ROOT });
  const log = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error('localize failed: ' + log.slice(-300));
  const o = JSON.parse(fs.readFileSync(path.join(out, 'reel.json'), 'utf8')), hook = o.scenes.find(x => x.id === 'hook'), lg = o.scenes.find(x => x.id === 'long');
  if (hook.punch_at !== 0.6 || !/punch line said late in 1 line/.test(log)) throw new Error('late punch word not given punch_at: ' + hook.punch_at);
  if (!lg.beats || lg.beats.length !== 1 || lg.beats[0].visual.svg_file !== '@lib/skull.svg') throw new Error('new beat from the lines file not added');
  // the beats block: the long scene without its beat, voiced slowly, gets a ready lines.ur.json block
  delete lg.beats; fs.writeFileSync(path.join(out, 'reel.json'), JSON.stringify(o));
  fs.mkdirSync(path.join(out, 'build'), { recursive: true });
  const tm = {}; for (const x of o.scenes) { const w = x.vo.split(/\s+/); tm[x.id] = { file: 'build/none.mp3', duration: w.length * 0.45 + 0.3, words: w.map((q, i) => ({ w: q, s: i * 0.45, e: i * 0.45 + 0.4 })) }; }
  fs.writeFileSync(path.join(out, 'build', 'timings.json'), JSON.stringify({ scenes: tm }));
  const st = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), out, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  if (st.status !== 0) throw new Error('render failed: ' + (st.stderr || '').slice(-300));
  const bf = path.join(out, 'build', 'beats.ur.json');
  if (!fs.existsSync(bf)) throw new Error('no beats.ur.json block written');
  const b = JSON.parse(fs.readFileSync(bf, 'utf8'));
  if (!b.long?.beats?.[0]?.at) throw new Error('beats block has no "at" for the long scene: ' + JSON.stringify(b));
  return `punch_at 0.6 on a verb-final line, beat added, block → ${b.long.beats[0].at}`;
});
t('match-cut montage, sliding headline, first-frame cover, music skips a silent intro', () => {
  const proj = path.join(tmpProj, 'ideas'); fs.mkdirSync(path.join(proj, 'build'), { recursive: true }); fs.mkdirSync(path.join(proj, 'audio'), { recursive: true });
  const reel = { title: 'ideas', audio: { music: 'audio/track.wav', bed: 'none' }, scenes: [
    { id: 'hook', lead: 1, vo: 'A whole town could not stop dancing.', headline: ['WHOLE TOWN', 'DANCING'], headline_style: 'slide' },
    { id: 'papers', vo: 'Every paper called it the dancing plague.', headline: ['EVERY', 'PAPER'],
      visual: { type: 'matchcut', word: 'plague', pages: ['Dancing plague grips Strasbourg', 'Strange plague spreads', 'Doctors baffled by plague', 'Plague of dancers reaches 400'] } }] };
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify(reel));
  // voice: a tone per scene; music: 2.5 s of silence, then a tone
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=2.6:sample_rate=48000', path.join(proj, 'audio', 'v.wav')]);
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=2.5', '-f', 'lavfi', '-i', 'sine=f=660:d=6:sample_rate=48000', '-filter_complex', '[1]aformat=channel_layouts=stereo[t];[0][t]concat=n=2:v=0:a=1', path.join(proj, 'audio', 'track.wav')]);
  const tm = {}; for (const x of reel.scenes) { const w = x.vo.split(/\s+/); tm[x.id] = { file: 'audio/v.wav', duration: 2.6, words: w.map((q, i) => ({ w: q, s: i * 0.33, e: i * 0.33 + 0.3 })) }; }
  fs.writeFileSync(path.join(proj, 'build', 'timings.json'), JSON.stringify({ scenes: tm }));
  const run = a => { const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, ...a], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 }); const all = (r.stdout || '') + (r.stderr || ''); if (r.status !== 0 || /\[page error\]/.test(all)) throw new Error('render ' + a.join(' ') + ' failed: ' + all.slice(-400)); return all; };
  if (!/frame 0 is the empty page/.test(run(['--stills']))) throw new Error('empty first frame not mentioned');
  // the sliding strip moves between two words; the montage cuts between pages
  run(['--at', '1.4,2.1,3.75,4.05']);
  const st = f => fs.readFileSync(path.join(proj, 'build', 'stills', f));
  if (st('at-1.4s.png').equals(st('at-2.1s.png'))) throw new Error('sliding headline did not move');
  if (st('at-3.75s.png').equals(st('at-4.05s.png'))) throw new Error('match-cut pages did not change');
  // full render with "first_frame": "cover": frame 0 is the cover; the music is audible before the voice starts (lead 1 s)
  reel.first_frame = 'cover'; fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify(reel));
  run([]);
  const mp4 = path.join(proj, 'out', fs.readdirSync(path.join(proj, 'out')).find(f => f.endsWith('.mp4')));
  const g = (a, f) => spawnSync('ffmpeg', ['-v', 'error', '-i', a, ...f, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 }).stdout;
  const f0 = g(mp4, ['-vf', 'select=eq(n\\,0),scale=54:96', '-frames:v', '1']), cv = g(path.join(proj, 'out', 'cover.png'), ['-vf', 'scale=54:96']);
  let d = 0; for (let i = 0; i < f0.length; i++) d += Math.abs(f0[i] - cv[i]); d /= f0.length;
  if (!(d < 6)) throw new Error('frame 0 is not the cover (mean difference ' + d.toFixed(1) + ')');
  const vol = spawnSync('ffmpeg', ['-hide_banner', '-i', mp4, '-af', 'atrim=0.4:0.9,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/mean_volume: (-?[\d.]+) dB/);
  if (!vol || +vol[1] < -60) throw new Error('music still silent before the voice (' + (vol && vol[1]) + ' dB): its silent intro was not skipped');
  return `first-frame note, strip slides, pages cut, frame 0 = cover (Δ ${d.toFixed(1)}), music at ${vol[1]} dB before the voice`;
});
t('busy drawings read whole, still reels warned, entrance sounds, music genres shown', () => {
  const proj = path.join(tmpProj, 'motion'); fs.mkdirSync(path.join(proj, 'art'), { recursive: true });
  // 340 pale bumps drawn before the dark outline: the contrast check must reach the outline (it stopped at 300 shapes)
  let bumps = ''; for (let i = 0; i < 340; i++) bumps += `<circle cx="${60 + (i % 34) * 15}" cy="${80 + Math.floor(i / 34) * 14}" r="5" fill="#EFE6D6"/>`;
  fs.writeFileSync(path.join(proj, 'art', 'bumpy.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 260"><rect x="40" y="60" width="520" height="160" rx="60" fill="#EDE3D2"/>${bumps}<rect x="40" y="60" width="520" height="160" rx="60" fill="none" stroke="#2b2420" stroke-width="6"/></svg>`);
  const sc = [{ id: 'bumpy', duration: 2.5, headline: ['BUMPY'], visual: { type: 'art', svg_file: 'art/bumpy.svg', w: 800 } }];
  for (let i = 0; i < 4; i++) sc.push({ id: 'still' + i, duration: 2.5, headline: ['STILL ' + i], visual: { type: 'art', svg_file: '@lib/brain.svg', motion: 'none', enter: 'fadeUp' } });
  sc.push({ id: 'slide', duration: 2.5, headline: ['SLIDE'], visual: { type: 'art', svg_file: '@lib/arm.svg', enter: 'slideL', at: 0.5 } });
  sc.push({ id: 'drop', duration: 2.5, headline: ['DROP'], visual: { type: 'art', svg_file: '@lib/glass.svg', enter: 'drop', at: 0.3 } });
  sc.push({ id: 'own', duration: 2.5, headline: ['OWN'], visual: { type: 'art', svg_file: '@lib/eye.svg', enter: 'spring', sfx: { find: 'cat hiss', fallback: 'pop' } } });
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ title: 'motion', audio: { music_mood: 'suspense' }, scenes: sc }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error('render failed: ' + all.slice(-300));
  if (/bumpy: "illustration" → low contrast/.test(all)) throw new Error('a pale drawing with a dark outline flagged as low contrast');
  if (!/4\/8 drawings are still/.test(all)) throw new Error('still drawings not warned:\n' + all.slice(-600));
  if (!/the same entrance \("fadeUp"\) in \d+ scenes in a row/.test(all)) throw new Error('repeated entrance not warned');
  const ev = JSON.parse(fs.readFileSync(path.join(proj, 'build', 'sfx.json'), 'utf8'));
  const near = (type, t) => ev.some(e => e.type === type && Math.abs(e.t - t) < 0.5);
  const s5 = 2.5 * 5, s6 = 2.5 * 6, s7 = 2.5 * 7;   // fixed 2.5 s scenes
  if (!near('whoosh', s5 + 0.5)) throw new Error('slideL made no whoosh: ' + JSON.stringify(ev.filter(e => e.t > s5 - 0.2 && e.t < s6)));
  if (!near('thud', s6 + 0.3 + 0.33)) throw new Error('drop made no thud as it landed');
  if (ev.some(e => e.type === 'pop' && Math.abs(e.t - (s7 + 0.11)) < 0.2) || !ev.some(e => e.find === 'cat hiss')) throw new Error('an object with its own sfx should use it instead');
  if (fs.existsSync(path.join(ROOT, 'sfx-library', 'music', 'index.json')) && !/music \(this reel\): ".+" by .+ · .+\.mp3/.test(all)) throw new Error('the chosen music track is not shown');
  return 'outline past 300 shapes counts, 4/8 still + repeated entrance warned, whoosh/thud/own find cue';
});
t('find sounds that fail are reported (skipped, or their fallback); credits list only what this render mixes', () => {
  const proj = path.join(tmpProj, 'credits'); fs.mkdirSync(path.join(proj, 'build'), { recursive: true }); fs.mkdirSync(path.join(proj, 'audio'), { recursive: true });
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=2:sample_rate=48000', path.join(proj, 'audio', 'v.wav')]);
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=330:d=4:sample_rate=48000', path.join(proj, 'audio', 'bed.wav')]);
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ title: 'credits', audio: { music: 'audio/bed.wav' }, scenes: [
    { id: 'a', vo: 'One two three.', headline: ['ONE'], sfx: [{ find: 'zzqx unicorn burp', at: 0.3 }, { find: 'qqzx glass dragon', fallback: 'pop', at: 0.8 }] }] }));
  fs.writeFileSync(path.join(proj, 'build', 'timings.json'), JSON.stringify({ scenes: { a: { file: 'audio/v.wav', duration: 2, words: ['One', 'two', 'three.'].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 })) } } }));
  fs.writeFileSync(path.join(proj, 'credits.json'), JSON.stringify([{ kind: 'music', file: 'music: playful-old.mp3', title: 'Old track' }, { kind: 'sound', file: 'sfx/old-hiss.mp3', title: 'old hiss' }, { kind: 'photo', file: 'art/p.jpg', title: 'kept photo', licence: 'cc0', source: 'test', page: 'https://example.org' }]));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--offline'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error('render failed: ' + all.slice(-400));
  if (!/"zzqx unicorn burp" at 0\.3 s → skipped: not in the library and offline/.test(all)) throw new Error('missing find sound not reported as skipped:\n' + all.slice(-500));
  if (!/"qqzx glass dragon" at 0\.8 s → pop \(its fallback\)/.test(all)) throw new Error('find fallback not reported');
  const cr = JSON.parse(fs.readFileSync(path.join(proj, 'credits.json'), 'utf8'));
  if (cr.some(c => c.kind === 'music' || c.kind === 'sound')) throw new Error('stale music/sound credits kept: ' + JSON.stringify(cr));
  if (!cr.some(c => c.kind === 'photo')) throw new Error('a photo credit was removed');
  return 'skipped + fallback reported with the reason; old music and sound credits dropped, photo kept';
});
t('quiet music moods skip rock-tagged tracks; loud tags warn inside compound tags', () => {
  const lib = path.join(tmpProj, 'lib'), md = path.join(lib, 'music'); fs.mkdirSync(md, { recursive: true });
  const tracks = { 'suspense-a.mp3': 'ambient,filmscore,rock', 'suspense-b.mp3': 'psychedelicrock', 'suspense-c.mp3': 'ambient,downtempo' };
  const idx = {}; for (const [f, g] of Object.entries(tracks)) { sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=200:d=1', path.join(md, f)]); idx[f] = { mood: 'suspense', id: 'x-' + f, title: 'T ' + f, creator: 'c', licence: 'cc0', source: 'test', page: 'https://example.org', genres: g }; }
  fs.writeFileSync(path.join(md, 'index.json'), JSON.stringify(idx));
  const env = { ...process.env, CLIFF_SFX_LIBRARY: lib };
  const pick = (opts) => spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'sfx.mjs')).href)}); const out = []; for (const key of 'abcdefghij') { const r = await m.findMusic('suspense', { key, allowNetwork: false, ...${JSON.stringify(opts)} }); out.push(r && r.genres); } console.log(JSON.stringify(out));`], { encoding: 'utf8', env });
  const on = JSON.parse(pick({}).stdout || '[]'), off = JSON.parse(pick({ defaultAvoid: false }).stdout || '[]');
  if (!on.length || on.some(g => /rock/.test(g))) throw new Error('suspense picked a rock-tagged track: ' + JSON.stringify(on));
  if (!off.some(g => /rock/.test(g))) throw new Error('music_avoid_default false should allow them again: ' + JSON.stringify(off));
  // the warning: a compound tag ("psychedelicrock") still warns, even with an unrelated music_avoid entry
  const proj = path.join(tmpProj, 'loud'); fs.mkdirSync(proj, { recursive: true });
  for (const key of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']) {
    fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify({ title: key, audio: { music_mood: 'suspense', music_avoid_default: false, music_avoid: ['suspense-a.mp3', 'suspense-c.mp3'] }, scenes: [{ id: 'a', duration: 1, headline: ['A'] }] }));
    const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills', '--offline'], { encoding: 'utf8', cwd: ROOT, env, maxBuffer: 64 << 20 });
    const all = (r.stdout || '') + (r.stderr || '');
    const shown = (all.match(/music \(this reel\): .* · (suspense-\w\.mp3)/) || [])[1];
    const kept = JSON.parse(fs.readFileSync(path.join(proj, 'credits.json'), 'utf8')).find(c => c.kind === 'music')?.file;
    if (!shown || kept !== 'music: ' + shown) throw new Error(`--stills showed ${shown} but kept ${kept} for the render`);
    fs.rmSync(path.join(proj, 'credits.json'));      // each key picks afresh
    if (/music \(this reel\): "T suspense-b\.mp3"/.test(all)) {
      if (!/looks like rock \(tags: psychedelicrock/.test(all)) throw new Error('psychedelicrock did not warn:\n' + all.slice(-400));
      return 'rock-tagged skipped by default (10 keys), allowed with music_avoid_default false, "psychedelicrock" warns';
    }
  }
  throw new Error('the psychedelicrock track was never picked');
});
t('Urdu question ending counts, effects on a line\'s last word warned, localize names a split line', () => {
  const proj = path.join(tmpProj, 'kfc'); fs.mkdirSync(path.join(proj, 'build'), { recursive: true });
  const reel = { title: 'kfc', scenes: [
    { id: 'pad', vo: 'They asked for chicken that was fried', headline: ['THE', 'ORDER'], visual: { type: 'notepad', lines: [{ text: 'grilled chicken', strike_at: 'word:fried', replace: 'fried', replace_at: 'word:fried' }] } },
    { id: 'end', vo: 'سچ یا ڈرامہ؟ کمنٹ میں بتائیں۔', headline: ['SACH?'] }] };
  fs.writeFileSync(path.join(proj, 'reel.json'), JSON.stringify(reel));
  const tm = {}; for (const x of reel.scenes) { const w = x.vo.split(/\s+/); tm[x.id] = { file: 'build/none.mp3', duration: w.length * 0.35 + 0.2, words: w.map((q, i) => ({ w: q, s: i * 0.35, e: i * 0.35 + 0.3 })) }; }
  fs.writeFileSync(path.join(proj, 'build', 'timings.json'), JSON.stringify({ scenes: tm }));
  const r = spawnSync(process.execPath, [path.join(HERE, 'render.mjs'), proj, '--stills'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
  const all = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error('render failed: ' + all.slice(-300));
  if (/ending closes everything/.test(all)) throw new Error('an Urdu question (؟) at the end was not counted');
  if (!/pad: notepad line 1 strike_at "word:fried" fires 0\.\d+ s before the cut/.test(all)) throw new Error('strike on the last word not warned:\n' + all.slice(-500));
  // localize: the source split a line into two scenes; the lines file still has both sentences in the first
  const src = path.join(tmpProj, 'split-src'); fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'reel.json'), JSON.stringify({ title: 'split', scenes: [{ id: 'hook', vo: 'He asked a robot for chicken.' }, { id: 'count', vo: 'About fifteen times.' }] }));
  const lp = path.join(tmpProj, 'lines.split.json');
  fs.writeFileSync(lp, JSON.stringify({ hook: { vo: 'اس نے روبوٹ سے چکن مانگا۔ تقریباً پندرہ بار۔' } }));
  const l = spawnSync(process.execPath, [path.join(HERE, 'localize.mjs'), src, '--lang', 'ur', '--lines', lp, '--out', path.join(tmpProj, 'split-ur')], { encoding: 'utf8', cwd: ROOT });
  const lo = (l.stdout || '') + (l.stderr || '');
  if (l.status === 0 || !/- count: "About fifteen times\."/.test(lo) || !/"hook" in the lines file has 2 sentences where the source has 1/.test(lo)) throw new Error('missing split line not explained:\n' + lo.slice(-500));
  return '؟ ending passes, last-word strike warned, split line named with a hint';
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
