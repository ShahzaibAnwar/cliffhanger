#!/usr/bin/env node
/* Hand-off folder for media made or found outside the skill (Gemini app, Veo/Flow, your own downloads).
     node inbox.mjs pack <project>     write <project>/inbox-prompts.md: every missing picture and clip, with the
                                       exact prompt to paste (Gemini app / any image tool / Veo) and the file name to save
     node inbox.mjs <project>          import everything in <project>/art/inbox/:
        <AI image name>.png|jpg        → art/gen/ (cut out like a generated image; matches an "image_prompt")
        <photo name>.jpg|png           → art/photos/ (cut out when the background is plain; matches a "photo_query")
        <clip name>.mp4|webm|mov       → art/clips/ (matches a "video_prompt"; muted, used as moving art)
        anything else                  → art/photos/<name>.png|jpg or art/clips/<name>.mp4, printed so you can use it as "image"/"video"
     Options for credits of your own downloads: --licence cc0|by|pdm|own --by "Author" --source "https://..."
   No automation of the Gemini website: you paste the prompts yourself (it keeps you inside Google's terms and
   doesn't break when their page changes). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect as collectAI, genKey, findGenerated, fullPrompt, STYLES, postProcess, makeCharacterResolver } from './imagegen.mjs';
import { photoKey, prepare } from './photos.mjs';
import { addCredit, slugify, hash } from './library.mjs';
import { loadSettings } from './settings-lib.mjs';

const IMG = /\.(png|jpe?g|webp)$/i, VID = /\.(mp4|webm|mov|m4v)$/i;
export function clipKey(spec, proj) {
  const q = String(spec.video_prompt).trim();
  const base = path.join(proj, 'art', 'clips', `${slugify(q)}-${hash(q.toLowerCase())}`);
  return { q, base, inboxName: path.basename(base) };
}
export const findClip = base => ['.mp4', '.webm', '.mov', '.m4v'].map(e => base + e).find(f => fs.existsSync(f)) || null;

function walk(reel, key) {
  const out = [];
  for (const s of reel.scenes || []) {
    const visit = o => {
      if (Array.isArray(o)) return o.forEach(visit);
      if (!o || typeof o !== 'object') return;
      if (o[key]) out.push({ spec: o, scene: s.id, theme: s.theme });
      for (const k of Object.keys(o)) if (k !== 'svg') visit(o[k]);
    };
    visit(s.visual); visit(s.overlays); visit(s.beats);
  }
  return out;
}

// Used by render.mjs: point objects with "video_prompt" at their clip; returns the ones still missing.
export function resolveClips(scenes, proj) {
  const missing = [];
  for (const it of walk({ scenes }, 'video_prompt')) {
    const f = findClip(clipKey(it.spec, proj).base), o = it.spec;
    if (f) { o.video = path.relative(proj, f).replace(/\\/g, '/'); if (o.svg_file) o.fallback_svg_file = o.svg_file; delete o.svg_file; delete o.svg; delete o.image; }
    else missing.push(`${it.scene}: clip "${it.spec.video_prompt}" → save as art/inbox/${clipKey(it.spec, proj).inboxName}.mp4`);
  }
  return missing;
}

function pack(proj) {
  const reel = JSON.parse(fs.readFileSync(path.join(proj, 'reel.json'), 'utf8'));
  const cfg = loadSettings().images || {}, who = makeCharacterResolver(reel.characters, proj, cfg);
  const W = reel.format?.width || 1080, H = reel.format?.height || 1920, wide = W > H;
  const lines = [`# Media to make for "${reel.title || path.basename(proj)}"`, '',
    `Paste each prompt into the Gemini app (or any image/video tool you have access to), download the result and save it in`,
    `\`${path.join(proj, 'art', 'inbox')}\` with the file name shown. Then run \`node scripts/inbox.mjs "${proj}"\`.`, ''];
  let n = 0;
  const ai = collectAI(reel).map(it => ({ ...it, spec: who(it) })).filter(it => !findGenerated(genKey(it.spec, it.theme, cfg, proj).base));
  if (ai.length) lines.push('## Pictures', '');
  for (const it of ai) {
    const k = genKey(it.spec, it.theme, cfg, proj), st = STYLES[k.style];
    lines.push(`### ${++n}. ${it.scene} → \`${path.basename(k.base)}.png\``, '',
      `Aspect: ${st.bg === 'full' ? (wide ? '16:9' : '9:16') : '1:1'}${it.spec.image_ref ? ` · attach the reference image \`${it.spec.image_ref}\` and say "same person/object as the attached image"` : ''}`, '',
      '```', fullPrompt(it.spec, k.style), '```', '');
  }
  const clips = walk(reel, 'video_prompt').filter(it => !findClip(clipKey(it.spec, proj).base));
  if (clips.length) lines.push('## Motion clips (Veo in the Gemini app, Flow, or any video tool)', '');
  for (const it of clips) {
    const k = clipKey(it.spec, proj);
    lines.push(`### ${++n}. ${it.scene} → \`${k.inboxName}.mp4\``, '',
      `${wide ? '16:9' : '9:16'}, 4–8 seconds, no text, no music needed (the video is muted).`, '', '```',
      `${k.q}. Smooth, slow camera move, single continuous shot. No text, captions, logos or watermark.`, '```', '');
  }
  const photos = walk(reel, 'photo_query').filter(it => !['.png', '.jpg', '.jpeg', '.webp'].some(e => fs.existsSync(photoKey(it.spec, proj).base + e)));
  if (photos.length) lines.push('## Real photos (find, don\'t generate)', '', `Run \`node scripts/photos.mjs project "${proj}"\` first; for anything it can't fetch, \`node scripts/photos.mjs guide "${proj}"\` prints search links.`, '');
  for (const it of photos) lines.push(`- ${it.scene}: "${it.spec.photo_query}" → \`${photoKey(it.spec, proj).inboxName}.jpg\``);
  if (!n && !photos.length) { console.log('Nothing missing: every picture and clip is on disk.'); return null; }
  const out = path.join(proj, 'inbox-prompts.md');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  fs.mkdirSync(path.join(proj, 'art', 'inbox'), { recursive: true });
  console.log(`${n} item(s) to make → ${out}\nInbox folder: ${path.join(proj, 'art', 'inbox')}`);
  return out;
}

function importInbox(proj, credit) {
  const inbox = path.join(proj, 'art', 'inbox');
  if (!fs.existsSync(inbox)) { console.log(`No inbox yet. Create ${inbox} and put files in it.`); return; }
  const reel = JSON.parse(fs.readFileSync(path.join(proj, 'reel.json'), 'utf8'));
  const cfg = loadSettings().images || {}, who = makeCharacterResolver(reel.characters, proj, cfg);
  const ai = new Map(collectAI(reel).map(it => { const sp = who(it); const k = genKey(sp, it.theme, cfg, proj); return [path.basename(k.base), { k, st: STYLES[k.style] }]; }));
  const photos = new Map(walk(reel, 'photo_query').map(it => { const k = photoKey(it.spec, proj); return [k.inboxName, k]; }));
  const clips = new Map(walk(reel, 'video_prompt').map(it => { const k = clipKey(it.spec, proj); return [k.inboxName, k]; }));
  const files = fs.readdirSync(inbox).filter(f => IMG.test(f) || VID.test(f));
  if (!files.length) { console.log('Inbox is empty.'); return; }
  const done = path.join(inbox, 'imported'); fs.mkdirSync(done, { recursive: true });
  const cred = { title: '', creator: credit.by || '', licence: credit.licence || 'user-supplied', licence_version: '', source: credit.source ? new URL(credit.source).hostname : 'your file', page: credit.source || '' };
  for (const f of files) {
    const src = path.join(inbox, f), name = f.replace(/\.[^.]+$/, ''), ext = path.extname(f).toLowerCase();
    let msg;
    if (VID.test(f)) {
      const k = clips.get(name); const base = k ? k.base : path.join(proj, 'art', 'clips', slugify(name));
      fs.mkdirSync(path.dirname(base), { recursive: true }); fs.copyFileSync(src, base + ext);
      msg = k ? `clip for "${k.q}"` : `clip → use "video": "${path.relative(proj, base + ext).replace(/\\/g, '/')}"`;
      addCredit(proj, 'clip', path.relative(proj, base + ext).replace(/\\/g, '/'), { ...cred, title: k ? k.q : name });
    } else if (ai.has(name)) {
      const { k, st } = ai.get(name), orig = k.base + '.orig' + ext.replace('.jpeg', '.jpg');
      fs.mkdirSync(path.dirname(orig), { recursive: true }); fs.copyFileSync(src, orig);
      const out = k.base + (st.bg === 'full' ? ext.replace('.jpeg', '.jpg') : '.png');
      const q = postProcess(orig, out, st.bg, st.cut);
      fs.writeFileSync(k.base + '.json', JSON.stringify({ provider: 'manual (inbox)', style: k.style, qa: q.ok ? 'pass' : 'fail: ' + q.reason }, null, 1));
      msg = `AI picture → ${path.relative(proj, out)}${q.ok ? '' : '  (check it: ' + q.reason + ')'}`;
    } else {
      const k = photos.get(name), base = k ? k.base : path.join(proj, 'art', 'photos', slugify(name));
      fs.mkdirSync(path.dirname(base), { recursive: true });
      const raw = base + '.orig' + ext.replace('.jpeg', '.jpg'); fs.copyFileSync(src, raw);
      const r = prepare(raw, base);
      fs.writeFileSync(base + '.json', JSON.stringify({ query: k ? k.q : name, kind: r.kind, foreground: r.foreground, manual: true, ...cred, title: k ? k.q : name }, null, 1));
      const outFile = ['.png', '.jpg'].map(e => base + e).find(x => fs.existsSync(x));
      addCredit(proj, 'photo', path.relative(proj, outFile).replace(/\\/g, '/'), { ...cred, title: k ? k.q : name });
      msg = k ? `photo for "${k.q}" (${r.kind === 'cutout' ? 'cut-out' : 'photo print'})` : `photo → use "image": "${path.relative(proj, outFile).replace(/\\/g, '/')}" (${r.kind})`;
    }
    fs.renameSync(src, path.join(done, f));
    console.log(`  + ${f}: ${msg}`);
  }
  if (!credit.licence) console.log(`\nCredits: record where your own files came from, e.g.\n  node scripts/inbox.mjs "${proj}" --licence cc0 --by "Author" --source "https://..."  (before importing)\nor edit ${path.join(proj, 'credits.json')}.`);
}

function isMainModule(url) { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; } }
if (process.argv[1] && isMainModule(import.meta.url)) {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : undefined; };
  if (a[0] === 'pack') { pack(path.resolve(a[1] || '.')); process.exit(0); }
  const proj = a.find(x => !x.startsWith('--') && ![opt('licence'), opt('by'), opt('source')].includes(x));
  if (!proj) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '').trim()); process.exit(0); }
  importInbox(path.resolve(proj), { licence: opt('licence'), by: opt('by'), source: opt('source') });
}
