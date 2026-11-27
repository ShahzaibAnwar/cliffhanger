#!/usr/bin/env node
/* Cliffhanger sound effects.
   Presets are synthesized with ffmpeg (free, offline, deterministic).
   AI cues ({prompt: "..."}) use the ElevenLabs Sound Effects API and are cached in <skill>/sfx-cache/
   so each unique sound is paid for once and reused by every reel.

     node sfx.mjs list                         preset names + descriptions
     node sfx.mjs preview [out.wav]            all presets back-to-back (listen to pick)
     node sfx.mjs gen "glass shattering" [--dur 1.5] [--influence 0.5] [--loop]   test an AI cue (uses credits) */
import fs from 'node:fs';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');   // some networks time out on the IPv6 route to Cloudflare/ElevenLabs
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readKey, SKILL_DIR } from './settings-lib.mjs';

export const CACHE_DIR = path.join(SKILL_DIR, 'sfx-cache');

// name: [description, lavfi graph]. Multi-source graphs end in [out0].
export const PRESETS = {
  swish: ['soft air swish (default cut)', `anoisesrc=d=0.45:c=pink:a=0.6:r=48000,highpass=f=700,lowpass=f=6500,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.27`],
  whoosh: ['fast whoosh (whip transition)', `anoisesrc=d=0.6:c=pink:a=0.9:r=48000,bandpass=f=1400:t=h:w=2200,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.3`],
  whoosh_low: ['deep whoosh (zoom transition)', `anoisesrc=d=0.9:c=brown:a=0.9:r=48000,lowpass=f=900,afade=t=in:d=0.5:curve=exp,afade=t=out:st=0.5:d=0.4`],
  paper: ['paper slide / page turn', `anoisesrc=d=0.5:c=white:a=0.45:r=48000,highpass=f=2200,lowpass=f=9000,volume='0.4+0.6*abs(sin(2*PI*14*t))':eval=frame,afade=t=in:d=0.08,afade=t=out:st=0.25:d=0.25`],
  pop: ['bubbly pop (chips, tags)', `aevalsrc=exprs='0.7*sin(2*PI*(1300*exp(-t*25)+320)*t)*exp(-t*26)':s=48000:d=0.2`],
  ding: ['soft bell ding (callouts)', `aevalsrc=exprs='0.45*sin(2*PI*1760*t)*exp(-t*5)+0.2*sin(2*PI*2637*t)*exp(-t*8)+0.1*sin(2*PI*3520*t)*exp(-t*12)':s=48000:d=1.3`],
  thud: ['low thud', `aevalsrc=exprs='0.95*sin(2*PI*(40+120*exp(-t*16))*t)*exp(-t*6.5)':s=48000:d=0.9`],
  impact: ['punchy hit: sub + crack (stamps)', `aevalsrc=exprs='0.9*sin(2*PI*(38+140*exp(-t*20))*t)*exp(-t*5.5)':s=48000:d=1.1[a];anoisesrc=d=0.25:c=white:a=0.7:r=48000,lowpass=f=4000,afade=t=out:st=0.01:d=0.22[b];[a][b]amix=inputs=2:normalize=0[out0]`],
  boom: ['cinematic boom (flashes, reveals)', `aevalsrc=exprs='0.9*sin(2*PI*(32+60*exp(-t*8))*t)*exp(-t*2.2)':s=48000:d=2.4[a];anoisesrc=d=1.2:c=brown:a=0.6:r=48000,lowpass=f=600,afade=t=out:st=0.05:d=1.1[b];[a][b]amix=inputs=2:normalize=0[out0]`],
  braam: ['dark horror "braam" (entering dark scenes)', `aevalsrc=exprs='(0.5*sin(2*PI*49*t)+0.35*sin(2*PI*98.3*t+2*sin(2*PI*3*t))+0.22*sin(2*PI*147*t)+0.12*sin(2*PI*196.5*t))*min(1,t*14)*exp(-t*1.2)':s=48000:d=3,lowpass=f=1100,acompressor=threshold=0.2:ratio=4`],
  riser: ['tension riser (before a reveal)', `anoisesrc=d=2.2:c=pink:a=0.5:r=48000,highpass=f=500,afade=t=in:d=2.1:curve=exp[a];aevalsrc=exprs='0.25*sin(2*PI*(180+500*t*t)*t)*t/2.2':s=48000:d=2.2[b];[a][b]amix=inputs=2:normalize=0[out0]`],
  heartbeat: ['heartbeat lub-dub (loop it)', `aevalsrc=exprs='sin(2*PI*52*t)*exp(-t*16)+0.75*sin(2*PI*46*(t-0.24))*exp(-(t-0.24)*16)*gte(t,0.24)':s=48000:d=0.95,lowpass=f=180,volume=1.3`],
  clock: ['clock ticking (loop it)', `aevalsrc=exprs='(random(0)*2-1)*exp(-mod(t,0.5)*380)':s=48000:d=4,highpass=f=1800`],
  buzz: ['insect buzz (mosquitoes, flies)', `aevalsrc=exprs='0.3*sin(2*PI*560*t+3*sin(2*PI*7*t))*(0.65+0.35*sin(2*PI*11*t))+0.12*sin(2*PI*1120*t+3*sin(2*PI*7*t))':s=48000:d=4,bandpass=f=700:t=h:w=900`],
  glitch: ['digital glitch (glitch transition)', `aevalsrc=exprs='0.5*(random(0)*2-1)*gt(sin(2*PI*23*t),0.2)+0.35*sin(2*PI*880*t)*gt(sin(2*PI*31*t),0)+0.3*sin(2*PI*120*t)*gt(sin(2*PI*17*t),0.5)':s=48000:d=0.4`],
  shutter: ['camera shutter', `aevalsrc=exprs='(random(0)*2-1)*(exp(-t*220)+0.7*exp(-abs(t-0.07)*260)*gte(t,0.07))':s=48000:d=0.25,highpass=f=1200`],
  tick_roll: ['counter ticks (count-ups)', `aevalsrc=exprs='0.5*(random(0)*2-1)*exp(-mod(t,0.055)*600)':s=48000:d=4,highpass=f=1200`],
  typing: ['keyboard typing (terminals)', `aevalsrc=exprs='0.6*(random(0)*2-1)*exp(-mod(t,0.085)*420)':s=48000:d=6,highpass=f=1500`],
  scribble: ['pencil scribble (notepad, sketch art)', `anoisesrc=d=6:c=brown:a=0.5:r=48000,highpass=f=1800,lowpass=f=7000,volume='0.55+0.45*sin(2*PI*8*t)':eval=frame`],
  scratch: ['pencil strike-through', `anoisesrc=d=0.45:c=white:a=0.5:r=48000,bandpass=f=3200:t=h:w=2600,afade=t=out:st=0.12:d=0.33`],
  water: ['water drip / plip', `aevalsrc=exprs='0.6*sin(2*PI*(700+900*exp(-t*30))*t)*exp(-t*18)':s=48000:d=0.35`],
};

// Background beds, synthesized for any length (free, no licensing). name: [description, (D) => lavfi graph]
const NOTE = (semis, root = 261.63) => `${root}*pow(2,(${semis})/12)`;
const seq = (arr, rate) => { // pick arr[floor(t*rate) mod n] inside an ffmpeg expression
  const n = arr.length; let e = String(arr[n - 1]);
  for (let i = n - 2; i >= 0; i--) e = `if(eq(mod(floor(t*${rate}),${n}),${i}),${arr[i]},${e})`;
  return e;
};
export const BEDS = {
  drone: ['low suspense drone (default)', D => `aevalsrc=exprs='0.34*sin(2*PI*55*t)*(0.65+0.35*sin(2*PI*0.11*t))+0.2*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.07*t+1))+0.1*sin(2*PI*110.6*t)+0.05*sin(2*PI*164.8*t)*sin(2*PI*0.23*t)':s=48000:d=${D},lowpass=f=520`],
  tension: ['slow heartbeat pulse + thin high string (horror, fear beats)', D => `aevalsrc=exprs='0.55*sin(2*PI*48*t)*exp(-mod(t,1.05)*9)+0.4*sin(2*PI*44*t)*exp(-mod(t-0.26,1.05)*9)*gte(mod(t,1.05),0.26)+0.05*sin(2*PI*392*t)*(0.5+0.5*sin(2*PI*0.09*t))+0.035*sin(2*PI*415.3*t)*(0.5+0.5*sin(2*PI*0.06*t+2))':s=48000:d=${D},lowpass=f=2200`],
  mystery: ['music-box arpeggio over a soft pad (curious, eerie)', D => `aevalsrc=exprs='0.22*sin(2*PI*${NOTE(seq([0, 3, 7, 10, 12, 10, 7, 3], 2.5), 523.25)}*t)*exp(-mod(t*2.5,1)*3.2)+0.06*sin(2*PI*130.81*t)*(0.6+0.4*sin(2*PI*0.08*t))+0.045*sin(2*PI*155.56*t)*(0.6+0.4*sin(2*PI*0.05*t+1))':s=48000:d=${D},aecho=0.8:0.6:260|430:0.3|0.2,lowpass=f=4000`],
  pulse: ['ticking electronic pulse (investigation, countdown)', D => `aevalsrc=exprs='0.35*sin(2*PI*55*t)*exp(-mod(t,0.5)*10)+0.25*(random(0)*2-1)*exp(-mod(t+0.25,0.5)*120)+0.05*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*0.25*t))':s=48000:d=${D},highpass=f=35,lowpass=f=6000`],
  calm: ['gentle documentary arpeggio (wonder, explainer)', D => `aevalsrc=exprs='0.16*sin(2*PI*${NOTE(seq([0, 4, 7, 11, 14, 11, 7, 4, -3, 0, 4, 9, 12, 9, 4, 0], 2), 261.63)}*t)*exp(-mod(t*2,1)*2.2)+0.05*sin(2*PI*130.81*t)+0.04*sin(2*PI*196*t)*(0.5+0.5*sin(2*PI*0.07*t))':s=48000:d=${D},aecho=0.8:0.7:320|520:0.3|0.22,lowpass=f=3500`],
};
export function bedFile(name, D, dir) {
  const b = BEDS[name]; if (!b) return null;
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `bed-${name}-${Math.ceil(D)}.wav`);
  const gain = { drone: 0, tension: 4, mystery: 14, pulse: 8, calm: 12 }[name] || 0;      // even out loudness between moods
  if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', b[1](Math.ceil(D)), '-af', `volume=${gain}dB,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, Math.ceil(D) - 1.8)}:d=1.8`, '-ac', '2', '-ar', '48000', f]);
  return f;
}
// Optional AI music (ElevenLabs Music, paid plans). Cached by prompt+length. Returns a file or null.
export async function aiMusic(prompt, seconds) {
  const out = path.join(CACHE_DIR, 'music-' + crypto.createHash('sha1').update(prompt + '|' + Math.ceil(seconds)).digest('hex').slice(0, 14) + '.mp3');
  if (fs.existsSync(out)) return out;
  const key = readKey(); if (!key) return null;
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt + '. Instrumental only, no vocals, suitable as a quiet background bed under narration.', music_length_ms: Math.min(300000, Math.ceil(seconds + 2) * 1000) }) });
    if (!r.ok) { console.warn(`! AI music failed (${r.status}): ${(await r.text()).slice(0, 160)} (using a built-in bed)`); return null; }
    fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    console.log('  + AI music: ' + prompt); return out;
  } catch (e) { console.warn('! AI music failed: ' + e.message); return null; }
}

const ff = a => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
};

export function presetFile(name, dir) {
  const p = PRESETS[name]; if (!p) return null;
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name + '.wav');
  if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', p[1], '-ac', '2', '-ar', '48000', f]);
  return f;
}

export function aiCachePath(c) {
  const h = crypto.createHash('sha1').update(JSON.stringify([c.prompt, c.dur ? +(+c.dur).toFixed(2) : null, c.influence ?? 0.45, !!c.loop])).digest('hex').slice(0, 16);
  return path.join(CACHE_DIR, h + '.mp3');
}

// Returns a file path, or null (caller falls back to a preset). Never throws.
export async function aiSfx(c, { allowNetwork = true } = {}) {
  const out = aiCachePath(c);
  if (fs.existsSync(out)) return out;
  if (!allowNetwork) return null;
  const key = readKey(); if (!key) return null;
  const body = { text: c.prompt, prompt_influence: c.influence ?? 0.45 };
  if (c.dur) body.duration_seconds = Math.min(30, Math.max(0.5, +c.dur));
  if (c.loop) body.loop = true;
  try {
    let r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok && body.loop && (r.status === 400 || r.status === 422)) {          // older models: no loop flag
      delete body.loop;
      r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!r.ok) { const t = await r.text(); console.warn(`! AI sound "${c.prompt}" failed (${r.status}): ${t.slice(0, 160)}`); return r.status === 401 || r.status === 403 ? 'DENIED' : null; }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    fs.writeFileSync(out.replace(/\.mp3$/, '.json'), JSON.stringify(c, null, 1));
    console.log(`  + AI sound: "${c.prompt}"`);
    return out;
  } catch (e) { console.warn(`! AI sound "${c.prompt}" failed: ${e.message}`); return null; }
}

// ---------- real recordings: local library + free CC0 sounds (Freesound via Openverse) ----------
// Resolution for a cue: { file } (your own) → <project>/sfx/ and sfx-library/ (matched by filename words)
// → a CC0 recording downloaded once into sfx-library/ (reused by every project) → AI sound → synthesized preset.
// Drop your own packs (wav/mp3/ogg/flac) into sfx-library/ (any subfolder): file names are the search words.
export const LIB_DIR = process.env.CLIFF_SFX_LIBRARY ? path.resolve(process.env.CLIFF_SFX_LIBRARY) : path.join(SKILL_DIR, 'sfx-library');   // env: tests use a small library
const AUDIO = /\.(wav|mp3|ogg|flac|m4a|aiff?)$/i;
// what each built-in effect sounds like in real life (used when audio.real_sfx is on)
// natural length of each effect when a real recording stands in for it (seconds)
export const REAL_DUR = { swish: 0.6, whoosh: 0.9, whoosh_low: 1.2, paper: 1, pop: 0.4, ding: 1.2, thud: 0.8, impact: 1.2, boom: 2.5, braam: 3,
  riser: 3, heartbeat: 1.3, clock: 2, buzz: 1.5, glitch: 0.8, shutter: 0.6, typing: 1.6, scribble: 1.2, scratch: 1.2, water: 1.5 };
export const REAL = {
  swish: 'swish', whoosh: 'whoosh swoosh', whoosh_low: 'deep whoosh', paper: 'paper rustle', pop: 'pop', ding: 'ding bell',
  thud: 'thud', impact: 'impact hit', boom: 'cinematic boom', braam: 'cinematic braam', riser: 'riser', heartbeat: 'heartbeat',
  clock: 'clock ticking', buzz: 'electric buzz', glitch: 'glitch', shutter: 'camera shutter', typing: 'keyboard typing',
  scribble: 'pencil scribble', scratch: 'pencil writing on paper', water: 'water splash',
};
const words = s => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(w => w.length > 1);
function listAudio(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listAudio(p)); else if (AUDIO.test(e.name)) out.push(p);
  }
  return out;
}
function readIndex() { try { return JSON.parse(fs.readFileSync(path.join(LIB_DIR, 'index.json'), 'utf8')); } catch { return {}; } }
function matches(query, dirs) {
  const q = words(query); if (!q.length) return [];
  const idx = readIndex();
  return dirs.flatMap(listAudio).map(f => {
    const meta = idx[path.basename(f)], w = new Set([...words(path.relative(LIB_DIR, f)), ...(meta ? words(meta.query + ' ' + meta.title) : [])]);
    return { f, hits: q.filter(x => w.has(x)).length };
  }).filter(m => m.hits === q.length).map(m => m.f).sort();
}
// Trim leading silence, keep at most `max` s, fade out, even loudness.
function processClip(src, out, max = 6) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af',
    `silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:${max},afade=t=out:st=${Math.max(0, max - 0.25)}:d=0.25,loudnorm=I=-20:TP=-2:LRA=11`,
    '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '3', out], { encoding: 'utf8' });
  return r.status === 0;
}
// Returns { file, credit } or null. variant picks among several takes (so repeated cues don't sound identical).
export async function findSound(query, { proj = null, allowNetwork = true, variant = 0, licence = 'cc0', takes = 3 } = {}) {
  findSound.lastWhy = '';                           // why nothing came back (read by render.mjs)
  const dirs = [proj && path.join(proj, 'sfx'), LIB_DIR].filter(Boolean);
  let have = matches(query, dirs);
  if (have.length < takes && allowNetwork) {
    try {
      const { searchSounds, download } = await import('./library.mjs');
      const idx = readIndex();
      const all = await searchSounds(query, { licence, n: 8, maxSeconds: 40 });
      const cands = all.filter(c => !Object.values(idx).some(x => x.id === c.id));
      if (!all.length) findSound.lastWhy = 'no match on Freesound/Openverse';
      let got = 0, failed = 0;
      for (const c of cands) {                    // the next result when one fails (403s happen), until there are enough takes
        if (have.length + got >= takes) break;
        const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        const raw = path.join(CACHE_DIR, 'dl-' + c.id.replace(/[^\w-]/g, '') + path.extname(new URL(c.url).pathname || '.mp3'));
        const out = path.join(LIB_DIR, `${slug}-${c.id.replace(/[^\w-]/g, '').slice(-10)}.mp3`);
        fs.mkdirSync(LIB_DIR, { recursive: true });
        let ok = false;
        for (let a = 0; a < 2 && !ok; a++) { try { await download(c.url, raw); ok = true; } catch (e) { if (a) { failed++; findSound.lastWhy = `download failed (${e.message.slice(0, 40)})`; } else await new Promise(r => setTimeout(r, 800)); } }
        if (!ok) continue;
        if (!processClip(raw, out)) { failed++; findSound.lastWhy = 'could not process the download'; continue; }
        got++;
        fs.rmSync(raw, { force: true });
        idx[path.basename(out)] = { query, id: c.id, title: c.title, creator: c.creator, licence: c.licence, licence_version: c.licence_version, source: c.source, page: c.page };
        fs.mkdirSync(LIB_DIR, { recursive: true }); fs.writeFileSync(path.join(LIB_DIR, 'index.json'), JSON.stringify(idx, null, 1));
        console.log(`  + sound "${query}": ${c.title.slice(0, 50)} (${c.licence}, ${c.source})`);
      }
      have = matches(query, dirs);
      if (failed && !have.length) findSound.lastWhy = `${failed} download(s) failed (${findSound.lastWhy || ''})`;
    } catch (e) { findSound.lastWhy = `search failed: ${e.message.slice(0, 80)}`; }
  } else if (!have.length && !allowNetwork) findSound.lastWhy = 'not in the library and offline';
  if (!have.length) return null;
  const file = have[Math.abs(variant) % have.length], meta = readIndex()[path.basename(file)];
  return { file, credit: meta ? { title: meta.title, creator: meta.creator, licence: meta.licence, licence_version: meta.licence_version, source: meta.source, page: meta.page } : null };
}

// ---------- music beds from free tracks (by mood) ----------
// One track per reel (chosen from the mood's list by the reel's name, so re-renders keep it); cached in sfx-library/music/.
// avoid: file names (basename) used by other recent reels in the same workspace: skipped while another track of this mood exists
// suspense, mystery and other quiet beds skip rock-tagged tracks unless music_avoid_default is false (tags are often
// vague: "metal" is left out because ambient stems get tagged "deathmetal")
export const QUIET_MOODS = ['suspense', 'mystery', 'calm', 'ambient', 'scifi', 'cinematic'];
export const LOUD_TAGS = ['rock', 'punk', 'grunge', 'guitar'];
export async function findMusic(mood, { key = '', allowNetwork = true, avoid = [], prefer = '', avoidTags = [], defaultAvoid = true } = {}) {
  const dir = path.join(LIB_DIR, 'music'), idxFile = path.join(dir, 'index.json');
  let idx = {}; try { idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch { /* new */ }
  const tags = avoidTags.map(t => String(t).toLowerCase()).filter(Boolean);       // "music_avoid": ["rock", "guitar"]
  const loud = defaultAvoid && QUIET_MOODS.includes(mood) ? LOUD_TAGS : [];
  const ok = (m, f = '') => !tags.some(t => `${m.genres || ''} ${m.title || ''} ${f}`.toLowerCase().includes(t))   // genre, title word or file name
    && !loud.some(t => String(m.genres || '').toLowerCase().includes(t));
  let have = Object.entries(idx).filter(([f, m]) => m.mood === mood && ok(m, f) && fs.existsSync(path.join(dir, f)));
  const want = Math.min(8, 4 + have.filter(([f]) => avoid.includes(f)).length);      // keep 4 fresh choices beside the recently used ones
  if (have.length < want && allowNetwork) {
    try {
      const { searchMusic, download } = await import('./library.mjs');
      const cands = (await searchMusic(mood)).filter(c => ok(c) && !Object.values(idx).some(m => m.id === c.id));
      fs.mkdirSync(dir, { recursive: true });
      for (const c of cands.slice(0, want - have.length)) {
        const raw = path.join(CACHE_DIR, 'dl-music-' + c.id.replace(/[^\w-]/g, '').slice(-12));
        const name = `${mood}-${c.id.replace(/[^\w-]/g, '').slice(-10)}.mp3`;
        try { await download(c.url, raw); } catch (e) { console.warn(`! music download failed (${c.title.slice(0, 40)}): ${e.message}`); continue; }
        const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', 'loudnorm=I=-20:TP=-2:LRA=11', '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '3', path.join(dir, name)]);
        fs.rmSync(raw, { force: true });
        if (r.status !== 0) continue;
        idx[name] = { mood, ...c }; fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
        console.log(`  + music (${mood}): "${c.title.slice(0, 50)}" by ${c.creator || 'unknown'} (${c.licence}, ${c.source})`);
      }
      have = Object.entries(idx).filter(([f, m]) => m.mood === mood && ok(m, f) && fs.existsSync(path.join(dir, f)));
    } catch (e) { console.warn(`! music search "${mood}" failed: ${e.message.slice(0, 120)}`); }
  }
  if (!have.length) return null;
  have.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const fresh = have.filter(([f]) => !avoid.includes(f)), skipped = fresh.length && fresh.length < have.length ? have.filter(([f]) => avoid.includes(f)).map(([f]) => f) : [];
  if (fresh.length) have = fresh;
  const h = [...String(key)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const [f, m] = have.find(([x]) => x === prefer) || have[h % have.length];
  return { file: path.join(dir, f), skipped, genres: m.genres || '', credit: { title: m.title, creator: m.creator, licence: m.licence, licence_version: m.licence_version, source: m.source, page: m.page } };
}

// ---------- CLI ----------
// true when this file was run directly (also through a symlink/junction, e.g. ~/.claude/skills/cliffhanger)
function isMainModule(url) {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; }
}
if (process.argv[1] && isMainModule(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
  if (cmd === 'find') {          // node sfx.mjs find "door creak" [--takes 3] [--licence cc0|safe]
    const q = rest.filter(x => !x.startsWith('--') && x !== opt('takes') && x !== opt('licence')).join(' ');
    const r = await findSound(q, { takes: +opt('takes', 3), licence: opt('licence', 'cc0') });
    console.log(r ? `ready: use { "find": "${q}" } in a sfx cue  (${path.relative(SKILL_DIR, r.file)})` : 'nothing found; try simpler words, or drop your own file into sfx-library/');
  } else if (cmd === 'music') {   // node sfx.mjs music suspense  → downloads a few tracks for that mood
    const { MOODS } = await import('./library.mjs');
    if (!rest[0]) { console.log('moods: ' + Object.keys(MOODS).join(', ')); }
    else { const r = await findMusic(rest[0], { key: rest[1] || '' }); console.log(r ? `ready: "audio": { "music_mood": "${rest[0]}" }  (${path.relative(SKILL_DIR, r.file)})` : 'no track found; try another mood'); }
  } else if (cmd === 'library') {
    const files = listAudio(LIB_DIR); console.log(`${files.length} sounds in ${LIB_DIR}`);
    for (const f of files) console.log('  ' + path.relative(LIB_DIR, f));
  } else if (cmd === 'list' || !cmd) {
    for (const [k, [d]] of Object.entries(PRESETS)) console.log(`${k.padEnd(11)} ${d}`);
    console.log('\nmusic beds (audio.bed):'); for (const [k, [d]] of Object.entries(BEDS)) console.log(`${k.padEnd(11)} ${d}`);
  } else if (cmd === 'beds') {
    const dir = path.join(CACHE_DIR, 'presets'); const files = Object.keys(BEDS).map(k => bedFile(k, 12, dir));
    const out = path.resolve(rest[0] || 'beds-preview.wav'); const list = path.join(dir, 'beds.txt');
    fs.writeFileSync(list, files.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', out]); console.log(`${out}\norder (12 s each): ${Object.keys(BEDS).join(', ')}`);
  } else if (cmd === 'preview') {
    const dir = path.join(CACHE_DIR, 'presets');
    const files = Object.keys(PRESETS).map(k => presetFile(k, dir));
    const out = path.resolve(rest[0] || 'sfx-preview.wav');
    const list = path.join(dir, 'list.txt');
    const gap = path.join(dir, '_gap.wav'); ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.6', gap]);
    fs.writeFileSync(list, files.flatMap(f => [`file '${f.replace(/\\/g, '/')}'`, `file '${gap.replace(/\\/g, '/')}'`]).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', out]);
    console.log(`${out}\norder: ${Object.keys(PRESETS).join(', ')}`);
  } else if (cmd === 'gen') {
    const f = await aiSfx({ prompt: rest[0], dur: opt('dur') ? +opt('dur') : undefined, influence: opt('influence') ? +opt('influence') : undefined, loop: rest.includes('--loop') });
    console.log(f && f !== 'DENIED' ? f : 'failed (see warning above; is the key allowed to use Sound Effects?)');
  }
}
