#!/usr/bin/env node
/* Copyright-free photos for reels: find, download, cut out, credit.
     node photos.mjs search "apollo 11 lunar module" [--source all|openverse|nasa|aic] [--licence safe|sa|cc0]
     node photos.mjs project <project>              fetch every "photo_query" in reel.json that isn't on disk yet
     node photos.mjs guide <project>                no download possible? prints search links + the file name to save
   In reel.json, any art object can ask for a real photo:
     { "type": "art", "photo_query": "apollo 11 lunar module", "photo_pick": 0, "svg_file": "@lib/eye.svg" }
   Plain backgrounds are cut out (shown as paper cut-outs, finish "collage"); busy ones stay whole and are shown as
   a photo print (finish "print"). Set "finish" yourself to override ("collage" · "print" · "torn" · "none").
   Files land in <project>/art/photos/, credits in <project>/credits.json (render writes out/credits.txt).
   Manual files: save them as art/inbox/<name shown by guide>.jpg and run  node inbox.mjs <project>. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { searchImages, imageById, download, addCredit, creditLine, slugify, hash, needsCredit } from './library.mjs';
import { floodKnockout, cleanSpecks, autoTrim, libraryFallback } from './imagegen.mjs';

export function photoKey(spec, proj) {
  const q = String(spec.photo_query).trim();
  const base = path.join(proj, 'art', 'photos', `${slugify(q)}-${hash(spec.photo_id ? 'id|' + spec.photo_id : [q.toLowerCase(), spec.photo_pick || 0, spec.photo_source || 'all'].join('|'))}`);
  return { q, base, inboxName: path.basename(base) };
}
const findFile = base => ['.png', '.jpg', '.jpeg', '.webp'].map(e => base + e).find(f => fs.existsSync(f)) || null;
export function photoMeta(base) { try { return JSON.parse(fs.readFileSync(base + '.json', 'utf8')); } catch { return {}; } }

function collect(reel) {
  const out = [];
  for (const s of reel.scenes || []) {
    const visit = o => {
      if (Array.isArray(o)) return o.forEach(visit);
      if (!o || typeof o !== 'object') return;
      if (o.photo_query) out.push({ spec: o, scene: s.id });
      for (const k of Object.keys(o)) if (k !== 'svg') visit(o[k]);
    };
    visit(s.visual); visit(s.overlays); visit(s.beats);
  }
  return out;
}

// Cut out when the background is plain enough; otherwise keep the whole photo (shown as a print).
// Plain background? The image border must be fairly uniform (studio backdrop, sky, paper), else a cut-out goes ragged.
export function borderPlain(src) {
  const S = 160;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', `scale=${S}:${S},format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: S * S + 64 });
  if (r.status !== 0 || !r.stdout || r.stdout.length < S * S) return { plain: false, std: 99 };
  // texture, not brightness spread: mean difference between neighbouring pixels in a 6 px border band
  // (a smooth vignette or sky gradient stays low; a busy room or crowd scores high)
  const px = r.stdout, inBand = (x, y) => x < 6 || y < 6 || x >= S - 6 || y >= S - 6;
  let sum = 0, n = 0;
  for (let y = 0; y < S - 1; y++) for (let x = 0; x < S - 1; x++) if (inBand(x, y)) {
    const i = y * S + x; sum += Math.abs(px[i] - px[i + 1]) + Math.abs(px[i] - px[i + S]); n += 2;
  }
  const tex = sum / Math.max(n, 1);
  return { plain: tex < 4, std: +tex.toFixed(2) };
}

export function prepare(src, base, { force } = {}) {
  const cut = base + '.png';
  const bp = borderPlain(src);
  const ok = force === 'print' ? false : (bp.plain || force === 'cutout') && floodKnockout(src, cut);
  let kind = 'print', fg = 1;
  if (ok) {
    const st = spawnSync('ffmpeg', ['-hide_banner', '-i', cut, '-vf', 'alphaextract,format=gray,scale=200:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = (st.stderr || '').match(/YAVG=([\d.]+)/); fg = m ? +m[1] / 255 : 1;
    // photos carry dust, stars and sensor noise: drop detached bits under 2% of the main subject (AI art uses 0.4%)
    if (fg > 0.08 && fg < 0.8) { cleanSpecks(cut, 0.02); autoTrim(cut); kind = 'cutout'; }
    else fs.rmSync(cut, { force: true });
  }
  if (kind === 'print') {
    fs.rmSync(cut, { force: true });
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', base + '.jpg']);
  }
  return { kind, foreground: +fg.toFixed(2), border_std: bp.std };
}

// Used by render.mjs: point objects at their photos; returns the queries still missing.
export function resolvePhotos(scenes, proj) {
  const missing = [];
  for (const it of collect({ scenes })) {
    const k = photoKey(it.spec, proj), f = findFile(k.base);
    const o = it.spec;
    if (!o.svg_file && !o.svg) { const lib = libraryFallback(k.q); if (lib) o.svg_file = lib; }
    if (f) {
      const meta = photoMeta(k.base);
      o.image = path.relative(proj, f).replace(/\\/g, '/');
      if (o.svg_file) o.fallback_svg_file = o.svg_file;                       // used if the photo fails to load
      delete o.svg_file; delete o.svg;
      if (!o.finish) o.finish = meta.kind === 'cutout' ? 'collage' : 'print';
      if (o.shadow == null) o.shadow = false;
    } else missing.push(`${it.scene}: photo "${k.q}" → ${o.svg_file ? 'hand-drawn ' + o.svg_file : 'nothing shown'} (fetch: node scripts/photos.mjs project, or save as art/inbox/${k.inboxName}.jpg)`);
  }
  return missing;
}

async function fetchOne(spec, proj, { licence = 'safe' } = {}) {
  const k = photoKey(spec, proj);
  // "photo_id" (printed by `photos.mjs search`) downloads exactly that picture; otherwise "photo_pick" from the ranked list
  const cands = spec.photo_id ? [await imageById(spec.photo_id)] : await searchImages(k.q, { licence: spec.photo_licence || licence, source: spec.photo_source || 'all', n: 12 });
  if (!cands.length) throw new Error('no free-licence photo found; try other words, or use guide');
  const pick = spec.photo_id ? 0 : Math.min(spec.photo_pick || 0, cands.length - 1);
  for (const c of [cands[pick], ...(spec.photo_id ? [] : cands.filter((_, i) => i !== pick))]) {
    const raw = k.base + '.orig' + (path.extname(new URL(c.url).pathname) || '.jpg').replace(/\.jpeg$/, '.jpg').slice(0, 5);
    try { await download(c.url, raw, 3, c.headers); } catch { if (c.fallback_url) { try { await download(c.fallback_url, raw, 3, c.headers); } catch { continue; } } else continue; }
    const r = prepare(raw, k.base);
    fs.writeFileSync(k.base + '.json', JSON.stringify({ query: k.q, kind: r.kind, foreground: r.foreground, ...c }, null, 1));
    addCredit(proj, 'photo', path.relative(proj, findFile(k.base)).replace(/\\/g, '/'), c);
    return { c, kind: r.kind };
  }
  throw new Error('all candidates failed to download');
}

function guide(items, proj) {
  const q = s => encodeURIComponent(s);
  console.log(`Save each picture into ${path.join(proj, 'art', 'inbox')} with the name shown, then run: node scripts/inbox.mjs "${proj}"\n`);
  for (const it of items) {
    const k = photoKey(it.spec, proj);
    console.log(`• ${it.scene}: "${k.q}"  →  art/inbox/${k.inboxName}.jpg`);
    console.log(`    Openverse (CC0 / CC BY):     https://openverse.org/search/image?q=${q(k.q)}&license=cc0,pdm,by`);
    console.log(`    Wikimedia Commons:           https://commons.wikimedia.org/w/index.php?search=${q(k.q)}&title=Special:MediaSearch&type=image`);
    console.log(`    NASA (space, science):       https://images.nasa.gov/search?q=${q(k.q)}`);
    console.log(`    Art Institute of Chicago:    https://www.artic.edu/collection?q=${q(k.q)}&is_public_domain=1`);
    console.log(`    Unsplash / Pexels (free licence, no NC): https://unsplash.com/s/photos/${q(k.q)}  https://www.pexels.com/search/${q(k.q)}/`);
  }
  console.log(`\nPick photos with a plain background if you want paper cut-outs. Note the licence and author of each:\n` +
    `the inbox import asks you to confirm them so the credits stay correct. Avoid NC/ND licences, logos, and\n` +
    `identifiable living people; for historical people use genuine public-domain photos.`);
}

function isMainModule(url) { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; } }
if (process.argv[1] && isMainModule(import.meta.url)) {
  const a = process.argv.slice(2), cmd = a[0], opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  if (cmd === 'search') {
    const list = await searchImages(a[1], { licence: opt('licence', 'safe'), source: opt('source', 'all'), n: +opt('n', 10) });
    list.forEach((c, i) => console.log(`${String(i).padStart(2)}  ${c.licence.padEnd(13)} ${(c.w ? c.w + 'x' + c.h : '?').padEnd(10)} ${c.source.padEnd(14)} ${c.title.slice(0, 60)}${c.off_topic ? '  [off-topic]' : ''}\n      "photo_id": "${c.id}"   ${c.page}`));
    console.log(list.length ? '\nUse one with "photo_query" + "photo_id": "<id>" in reel.json (exact), or "photo_pick": <number>.' : 'Nothing found with a free licence; try simpler words.');
    process.exit(0);
  }
  if (cmd === 'project' || cmd === 'guide') {
    const proj = path.resolve(a[1] || '.');
    const reel = JSON.parse(fs.readFileSync(path.join(proj, 'reel.json'), 'utf8'));
    const items = collect(reel).filter(it => !findFile(photoKey(it.spec, proj).base));
    if (!items.length) { console.log('All photos are on disk.'); process.exit(0); }
    if (cmd === 'guide') { guide(items, proj); process.exit(0); }
    let ok = 0; const failed = [];
    for (const it of items) {
      try {
        const r = await fetchOne(it.spec, proj, { licence: opt('licence', 'safe') }); ok++;
        console.log(`  + ${it.scene}: ${r.kind === 'cutout' ? 'cut-out' : 'photo print'} · ${creditLine(r.c)}${needsCredit(r.c.licence) ? '  (credit required)' : ''}`);
        if (!it.spec.photo_id) console.log(`      pin this exact photo: "photo_id": "${r.c.id}"`);
        if (r.c.off_topic || (r.c.relevance != null && r.c.relevance < 1)) console.warn(`      ! check it: the title doesn't match every word of "${it.spec.photo_query}"`);
      }
      catch (e) { failed.push(it); console.warn(`  ! ${it.scene}: "${it.spec.photo_query}": ${e.message}`); }
    }
    console.log(`photos: ${ok} downloaded, ${failed.length} failed`);
    if (failed.length) { console.log(''); guide(failed, proj); }
    process.exit(failed.length && !ok ? 1 : 0);
  }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '').trim());
}
