#!/usr/bin/env node
/* Series memory: one series.json per workspace, built from the projects in it.
     node series.mjs sync [workspace]     rebuild series.json from every project's reel.json (keeps your manual notes)
     node series.mjs show [workspace]     what's been made + what the next episode must pay off
   workspace defaults to settings.output.projects_dir. render.mjs runs `sync` after each final render. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './settings-lib.mjs';

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

export function syncSeries(ws) {
  const S = loadSettings();
  const voiceName = id => (S.voice?.elevenlabs?.voices || []).find(v => v.voice_id === id)?.name || id;
  const file = path.join(ws, 'series.json');
  const old = readJson(file) || { series: {} };
  const out = { updated: new Date().toISOString(), series: {} };
  for (const d of fs.readdirSync(ws, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const reel = readJson(path.join(ws, d.name, 'reel.json'));
    if (!reel?.series?.name) continue;
    const name = reel.series.name;
    const sr = out.series[name] ||= { brand: reel.brand, voices: {}, parts: {}, recurring_art: [], notes: old.series?.[name]?.notes || '' };
    const lang = reel.voice?.elevenlabs?.language_code || (reel.voice?.edge?.voice || 'en').slice(0, 2);
    const provider = reel.voice?.provider || 'auto';
    const vid = reel.voice?.elevenlabs?.voice_id;
    const part = String(reel.series.part);
    const scenes = reel.scenes || [];
    const spoken = scenes.filter(s => s.vo && s.visual?.type !== 'endcard');
    const outDir = path.join(ws, d.name, 'out');
    const video = fs.existsSync(outDir) ? fs.readdirSync(outDir).find(f => f.endsWith('.mp4') && !/_preview|hook-/.test(f)) : null;
    const p = sr.parts[part] ||= { title: reel.title.replace(/\s*\(.*\)$/, ''), next: reel.series.next || null, versions: {} };
    p.versions[lang] = {
      project: d.name, voice: vid ? `${voiceName(vid)} (${vid})` : `edge ${reel.voice?.edge?.voice || ''}`,
      video: video ? `${d.name}/out/${video}` : null,
      hook: spoken[0]?.vo_roman || spoken[0]?.vo || '', cliffhanger: spoken[spoken.length - 1]?.vo_roman || spoken[spoken.length - 1]?.vo || '',
      published: old.series?.[name]?.parts?.[part]?.versions?.[lang]?.published || false,
    };
    if (lang === 'en' || !p.cliffhanger_en) { p.next = reel.series.next || p.next; if (lang === 'en') p.cliffhanger_en = p.versions[lang].cliffhanger; }
    if (vid) { const cur = sr.voices[lang]; if (!cur || Number(part) >= cur.part) sr.voices[lang] = { part: Number(part), voice_id: vid, name: voiceName(vid), model: reel.voice?.elevenlabs?.model_id, provider }; }
    const arts = new Set(JSON.stringify(scenes).match(/"svg_file":"art\/[^"]+"/g) || []);
    sr._art = sr._art || {};
    for (const a of arts) { const n = a.slice(16, -1); (sr._art[n] ||= new Set()).add(part); }
  }
  for (const sr of Object.values(out.series)) {
    sr.recurring_art = Object.entries(sr._art || {}).filter(([, v]) => v.size > 1).map(([k, v]) => `${k} (parts ${[...v].sort().join(', ')})`);
    delete sr._art;
    const nums = Object.keys(sr.parts).map(Number).sort((a, b) => a - b);
    const last = sr.parts[nums[nums.length - 1]];
    sr.next_episode = last ? { part: nums[nums.length - 1] + 1, title: last.next, must_pay_off: last.cliffhanger_en || Object.values(last.versions)[0]?.cliffhanger, languages_to_make: Object.keys(last.versions) } : null;
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
}

// true when this file was run directly (also through a symlink/junction, e.g. ~/.claude/skills/cliffhanger)
function isMainModule(url) {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; }
}
if (process.argv[1] && isMainModule(import.meta.url)) {
  const [cmd = 'show', wsArg] = process.argv.slice(2);
  const ws = path.resolve(wsArg || loadSettings().output?.projects_dir || '.');
  const data = syncSeries(ws);
  if (cmd === 'sync') { console.log(`series.json updated in ${ws}: ${Object.keys(data.series).join(', ') || 'no series found'}`); process.exit(0); }
  for (const [name, sr] of Object.entries(data.series)) {
    console.log(`\n# ${name} · ${sr.brand?.name || ''} ${sr.brand?.handle || ''}`);
    console.log(`voices: ${Object.entries(sr.voices).map(([l, v]) => `${l} = ${v.name}`).join(' · ')}`);
    for (const n of Object.keys(sr.parts).map(Number).sort((a, b) => a - b)) {
      const p = sr.parts[n];
      console.log(`Part ${n}: ${p.title}  [${Object.entries(p.versions).map(([l, v]) => `${l}${v.video ? ' ✓' : ' (not rendered)'}${v.published ? ' published' : ''}`).join(', ')}]  → next: ${p.next || '?'}`);
    }
    if (sr.recurring_art.length) console.log(`recurring art: ${sr.recurring_art.join(' · ')}`);
    if (sr.next_episode) console.log(`\nNEXT: Part ${sr.next_episode.part} "${sr.next_episode.title}". Must pay off: "${sr.next_episode.must_pay_off}". Make in: ${sr.next_episode.languages_to_make.join(', ')}`);
    if (sr.notes) console.log(`notes: ${sr.notes}`);
  }
}
