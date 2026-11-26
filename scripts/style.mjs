#!/usr/bin/env node
/* Automatic style picker: topic → look + caption style + music mood, from a style map in settings.
     node style.mjs pick "why your body jerks awake" [--wide]   what auto mode would choose, and why
     node style.mjs show                                         the current map
     node style.mjs lock [--workspace <dir>]                     turn auto mode on: for every channel (settings.json),
                                                                 or only for one channel's folder (<dir>/style.json)
     node style.mjs unlock [--workspace <dir>]                   back to asking every time
   Several channels? Lock per workspace: a global lock also restyles other channels whose reels don't set a look.
   settings.style = { "auto": true, "map": [ { look, keywords: [...], captions: { vertical, wide }, music_mood }, ... ] }
   A reel with "look": "auto" (or no look while style.auto is on) gets its look, caption style and music mood here,
   unless the reel sets them itself. No match or a tie → the default look (and Claude asks the user). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, SETTINGS_PATH } from './settings-lib.mjs';

export const DEFAULT_MAP = [
  { look: 'case-file', keywords: ['science', 'body', 'brain', 'health', 'medical', 'biology', 'psychology', 'sleep', 'disease', 'mystery', 'mysteries', 'human', 'why', 'nerve', 'heart'], captions: { vertical: 'word', wide: 'pop' }, music_mood: 'mystery', default: true },
  { look: 'collage', keywords: ['history', 'culture', 'archive', 'photo', 'photos', 'ancient', 'famous', 'art', 'artist', 'empire', 'king', 'queen', 'museum'], captions: { vertical: 'pop', wide: 'pop' }, music_mood: 'cinematic' },
  { look: 'chalkboard', keywords: ['teach', 'teaching', 'lesson', 'learn', 'math', 'maths', 'mathematics', 'physics', 'chemistry', 'formula', 'equation', 'explained', 'how it works', 'school', 'exam'], captions: { vertical: 'karaoke', wide: 'line' }, music_mood: 'calm' },
  { look: 'blueprint', keywords: ['tech', 'technology', 'machine', 'machines', 'engineering', 'engine', 'invention', 'inventor', 'space', 'rocket', 'nasa', 'satellite', 'computer', 'ai', 'robot', 'car', 'plane', 'aviation', 'apollo', 'voyager'], captions: { vertical: 'box', wide: 'pop' }, music_mood: 'scifi' },
  { look: 'comic', keywords: ['fun fact', 'fun facts', 'animal', 'animals', 'kids', 'funny', 'weird', 'cute', 'food', 'pets', 'dog', 'cat', 'insect', 'ocean creature'], captions: { vertical: 'pop', wide: 'pop' }, music_mood: 'playful' },
  { look: 'vhs', keywords: ['unsolved', 'eerie', 'creepy', 'urban legend', 'legend', 'paranormal', 'ghost', 'haunted', 'conspiracy', 'disappearance', 'disappeared', 'cold case', 'missing', '80s', '90s', 'horror', 'signal'], captions: { vertical: 'box', wide: 'box' }, music_mood: 'suspense' },
  { look: 'newsprint', keywords: ['news', 'event', 'events', 'on this day', 'real events', 'disaster', 'epidemic', 'plague', 'war', 'crime', 'politics', 'election', 'headline', 'century'], captions: { vertical: 'tape', wide: 'pop' }, music_mood: 'mystery' },
];
export const styleMap = (S = loadSettings()) => (Array.isArray(S.style?.map) && S.style.map.length ? S.style.map : DEFAULT_MAP);

// score each look by how many of its keywords appear in the text (phrases count double); returns the best + reasons
export function pickStyle(text, { wide = false, map = styleMap() } = {}) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ') + ' ';
  const scored = map.map(m => {
    const hits = (m.keywords || []).filter(k => t.includes(' ' + k.toLowerCase() + ' ') || t.includes(' ' + k.toLowerCase() + 's '));
    return { m, hits, score: hits.reduce((a, k) => a + (k.includes(' ') ? 2 : 1), 0) };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0], second = scored[1];
  const fallback = map.find(m => m.default) || map[0];
  const tie = best.score > 0 && second && second.score === best.score;
  const m = best.score > 0 && !tie ? best.m : fallback;
  return {
    look: m.look, captions: (m.captions || {})[wide ? 'wide' : 'vertical'] || 'word', music_mood: m.music_mood || '',
    matched: best.score > 0 && !tie ? best.hits : [], tie: tie ? [best.m.look, second.m.look] : null, fallback: !(best.score > 0) || tie,
    why: best.score === 0 ? `no keyword matched → default "${m.look}"` : tie ? `tie between "${best.m.look}" and "${second.m.look}" (${best.hits.join(', ')} / ${second.hits.join(', ')}) → ask the user` : `matched ${best.hits.map(k => `"${k}"`).join(', ')} → "${m.look}"`,
  };
}

function isMainModule(url) { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; } }
if (process.argv[1] && isMainModule(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'pick') {
    const r = pickStyle(rest.filter(x => !x.startsWith('--')).join(' '), { wide: rest.includes('--wide') });
    console.log(JSON.stringify(r, null, 1));
  } else if (cmd === 'show') {
    const S = loadSettings();
    console.log(`auto: ${S.style?.auto ? 'on' : 'off'}${Array.isArray(S.style?.map) && S.style.map.length ? ' · custom map' : ' · default map'}`);
    for (const m of styleMap(S)) console.log(`  ${m.look.padEnd(11)} captions ${String(m.captions?.vertical).padEnd(8)}/ ${String(m.captions?.wide).padEnd(8)} music ${String(m.music_mood).padEnd(10)} ${m.keywords.slice(0, 8).join(', ')}…`);
  } else if ((cmd === 'lock' || cmd === 'unlock') && rest.includes('--workspace')) {
    const ws = path.resolve(rest[rest.indexOf('--workspace') + 1] || '.'), f = path.join(ws, 'style.json');
    if (!fs.existsSync(ws)) { console.error(`No such folder: ${ws}`); process.exit(1); }
    let s = {}; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* new */ }
    s.auto = cmd === 'lock'; if (cmd === 'lock' && !Array.isArray(s.map)) s.map = styleMap();
    fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
    console.log(cmd === 'lock' ? `Auto style is on for reels in ${ws} only (edit ${f}).` : `Auto style is off for ${ws}.`);
  } else if (cmd === 'lock' || cmd === 'unlock') {
    let s = {}; try { s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* new */ }
    s.style = { ...(s.style || {}), auto: cmd === 'lock' };
    if (cmd === 'lock' && !Array.isArray(s.style.map)) s.style.map = DEFAULT_MAP;      // saved so it can be edited
    saveSettings(s);
    console.log(cmd === 'lock' ? `Auto style is on: each video gets its look, captions and music from the topic (edit style.map in ${path.basename(SETTINGS_PATH)}).` : 'Auto style is off: Claude will show the gallery and ask.');
  } else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '').trim());
}
