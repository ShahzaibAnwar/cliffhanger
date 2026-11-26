/* Free-licence media library: search, licence filter, download, credits. Shared by photos.mjs and sfx.mjs.
   Sources (no account or key needed):
     Openverse (api.openverse.org)  images + audio from Wikimedia Commons, Flickr, museums, Freesound, ...
     NASA Image Library             space/science photos (NASA media is generally not copyrighted)
     Art Institute of Chicago       public-domain artworks (CC0)
   Licence policy: only licences that allow commercial use and changes.
     safe (default)  CC0, Public Domain Mark, CC BY (BY needs a credit line, written automatically)
     sa              also CC BY-SA (share-alike: your video may have to carry the same licence, so opt in only)
   NC and ND licences are never used. */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
dns.setDefaultResultOrder('ipv4first');

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'cliffhanger-skill/1.0' };      // generic: no personal details in requests

export const LICENCES = { safe: ['cc0', 'pdm', 'by'], sa: ['cc0', 'pdm', 'by', 'by-sa'], cc0: ['cc0', 'pdm'] };
const LICENCE_NAME = { cc0: 'CC0 1.0 (public domain)', pdm: 'Public Domain Mark', by: 'CC BY', 'by-sa': 'CC BY-SA', 'public-domain': 'Public domain' };
export const needsCredit = lic => /^by/.test(lic);

export async function getJson(url, tries = 3) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 && k < tries - 1) { await new Promise(res => setTimeout(res, 2500 * (k + 1))); continue; }
      if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
      return await r.json();
    } catch (e) { if (k >= tries - 1) throw e; await new Promise(res => setTimeout(res, 900 * (k + 1))); }
  }
}
export async function download(url, out, tries = 3, headers = {}) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers }, redirect: 'follow' });
      if (!r.ok) throw new Error(`download ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) throw new Error('download too small');
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf);
      return out;
    } catch (e) { if (k >= tries - 1) throw e; await new Promise(res => setTimeout(res, 900 * (k + 1))); }
  }
}

// ---------- images ----------
export async function searchImages(q, { licence = 'safe', source = 'all', n = 12 } = {}) {
  const lic = LICENCES[licence] || LICENCES.safe, out = [];
  const tasks = [];
  if (source === 'all' || source === 'openverse') tasks.push((async () => {
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=${lic.join(',')}&page_size=${Math.min(20, n * 2)}&mature=false`);
    for (const r of j.results || []) out.push({ id: 'ov-' + r.id, source: r.source || 'openverse', title: r.title || q, creator: r.creator || '', licence: r.license, licence_version: r.license_version || '',
      url: r.url, page: r.foreign_landing_url || r.url, w: r.width || 0, h: r.height || 0 });
  })());
  if (source === 'all' || source === 'nasa') tasks.push((async () => {
    const j = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`);
    for (const it of (j.collection?.items || []).slice(0, n)) {
      const d = it.data?.[0] || {}, href = it.links?.[0]?.href; if (!href) continue;
      out.push({ id: 'nasa-' + d.nasa_id, source: 'NASA', title: d.title || q, creator: d.photographer || d.secondary_creator || 'NASA', licence: 'public-domain', licence_version: '',
        url: href.replace(/~(thumb|medium|small)\.jpg$/, '~large.jpg'), fallback_url: href, page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, w: 0, h: 0 });
    }
  })());
  if (source === 'all' || source === 'aic') tasks.push((async () => {
    const j = await getJson(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&query[term][is_public_domain]=true&fields=id,title,image_id,artist_title,thumbnail&limit=${n}`);
    const iiif = j.config?.iiif_url || 'https://www.artic.edu/iiif/2';
    for (const d of j.data || []) if (d.image_id) out.push({ id: 'aic-' + d.id, source: 'Art Institute of Chicago', title: d.title || q, creator: d.artist_title || '', licence: 'cc0', licence_version: '1.0',
      url: `${iiif}/${d.image_id}/full/843,/0/default.jpg`, headers: { 'AIC-User-Agent': 'cliffhanger-skill/1.0' }, page: `https://www.artic.edu/artworks/${d.id}`, w: d.thumbnail?.width || 0, h: d.thumbnail?.height || 0 });
  })());
  const res = await Promise.allSettled(tasks);
  const errs = res.filter(r => r.status === 'rejected').map(r => r.reason?.message);
  if (!out.length && errs.length) throw new Error('image search failed: ' + errs.join('; '));
  // rank: bigger and closer to the query first; public domain before attribution
  const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const score = c => (Math.min(c.w || 1600, 3000) / 3000) + words.filter(w => (c.title || '').toLowerCase().includes(w)).length * 0.4 + (needsCredit(c.licence) ? 0 : 0.25) - (c.w && c.w < 700 ? 1 : 0);
  return out.sort((a, b) => score(b) - score(a)).slice(0, n);
}

// ---------- audio ----------
export async function searchSounds(q, { licence = 'cc0', n = 8, maxSeconds = 60 } = {}) {
  const lic = LICENCES[licence] || LICENCES.cc0;
  const j = await getJson(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&license=${lic.join(',')}&source=freesound&page_size=${Math.min(20, n * 3)}&mature=false`);
  return (j.results || []).filter(r => r.url && (!r.duration || r.duration <= maxSeconds * 1000))
    .map(r => ({ id: 'ov-' + r.id, source: r.source || 'freesound', title: r.title || q, creator: r.creator || '', licence: r.license, licence_version: r.license_version || '',
      url: r.url, page: r.foreign_landing_url || r.url, dur: (r.duration || 0) / 1000 }))
    .sort((a, b) => (a.dur || 9) - (b.dur || 9))          // short, clean one-shots first
    .slice(0, n);
}

// ---------- credits ----------
export function creditLine(c) {
  const lic = LICENCE_NAME[c.licence] || c.licence.toUpperCase();
  return `"${c.title}"${c.creator ? ' by ' + c.creator : ''} · ${lic}${c.licence_version ? ' ' + c.licence_version : ''} · ${c.source} · ${c.page}`;
}
// Credits for one project: <project>/credits.json (machine) → written to out/credits.txt by render.mjs
export function addCredit(proj, kind, file, c) {
  const p = path.join(proj, 'credits.json');
  let all = []; try { all = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* new */ }
  all = all.filter(x => x.file !== file);
  all.push({ kind, file, title: c.title, creator: c.creator, licence: c.licence, licence_version: c.licence_version, source: c.source, page: c.page });
  fs.writeFileSync(p, JSON.stringify(all, null, 1));
}
export function readCredits(proj) { try { return JSON.parse(fs.readFileSync(path.join(proj, 'credits.json'), 'utf8')); } catch { return []; } }

export const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
export const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
