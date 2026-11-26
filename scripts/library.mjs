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
// Same query → same list in the same order, every time (fixed request sizes, fixed source order, stable sort),
// so a "photo_pick" chosen from `photos.mjs search` downloads exactly that picture.
const AIC_FIELDS = 'id,title,image_id,artist_title,thumbnail,term_titles,subject_titles,classification_titles';
const ovItem = r => ({ id: 'ov-' + r.id, source: r.source || 'openverse', title: r.title || '', creator: r.creator || '', licence: r.license, licence_version: r.license_version || '',
  url: r.url, page: r.foreign_landing_url || r.url, w: r.width || 0, h: r.height || 0, tags: (r.tags || []).map(t => t.name).join(' ') });
const nasaItem = it => {
  const d = it.data?.[0] || {}, href = it.links?.[0]?.href;
  return href ? { id: 'nasa-' + d.nasa_id, source: 'NASA', title: d.title || '', creator: d.photographer || d.secondary_creator || 'NASA', licence: 'public-domain', licence_version: '',
    url: href.replace(/~(thumb|medium|small)\.jpg$/, '~large.jpg'), fallback_url: href, page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, w: 0, h: 0,
    tags: [...(d.keywords || []), d.description || ''].join(' ').slice(0, 600) } : null;
};
const aicItem = (d, iiif) => d.image_id ? { id: 'aic-' + d.id, source: 'Art Institute of Chicago', title: d.title || '', creator: d.artist_title || '', licence: 'cc0', licence_version: '1.0',
  url: `${iiif}/${d.image_id}/full/843,/0/default.jpg`, headers: { 'AIC-User-Agent': 'cliffhanger-skill/1.0' }, page: `https://www.artic.edu/artworks/${d.id}`,
  w: d.thumbnail?.width || 0, h: d.thumbnail?.height || 0, tags: [...(d.term_titles || []), ...(d.subject_titles || []), ...(d.classification_titles || [])].join(' ') } : null;

// share of query words found in the title and the source's own subject tags (singular/plural tolerant)
export function relevance(q, c) {
  const qs = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
  if (!qs.length) return 1;
  const hay = ` ${(c.title + ' ' + (c.tags || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return qs.filter(w => hay.includes(' ' + w) || hay.includes(' ' + w.replace(/(es|s)$/, ''))).length / qs.length;
}
const STOP = new Set(['the', 'and', 'with', 'from', 'for', 'photo', 'image', 'picture', 'view', 'of']);

export async function searchImages(q, { licence = 'safe', source = 'all', n = 12 } = {}) {
  const lic = LICENCES[licence] || LICENCES.safe;
  const want = k => source === 'all' || source === k;
  const [ov, nasa, aic] = await Promise.allSettled([
    want('openverse') ? getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=${lic.join(',')}&page_size=20&mature=false`).then(j => (j.results || []).map(ovItem)) : [],
    want('nasa') ? getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`).then(j => (j.collection?.items || []).slice(0, 20).map(nasaItem).filter(Boolean)) : [],
    want('aic') ? getJson(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&query[term][is_public_domain]=true&fields=${AIC_FIELDS}&limit=12`)
      .then(j => (j.data || []).map(d => aicItem(d, j.config?.iiif_url || 'https://www.artic.edu/iiif/2')).filter(Boolean)) : [],
  ]);
  const errs = [ov, nasa, aic].filter(r => r.status === 'rejected').map(r => r.reason?.message);
  const all = [ov, nasa, aic].flatMap(r => r.status === 'fulfilled' ? r.value : []);          // fixed source order
  if (!all.length && errs.length) throw new Error('image search failed: ' + errs.join('; '));
  for (const c of all) c.relevance = relevance(q, c);
  // off-topic results (museum full-text search returns paintings for animal names) are dropped;
  // if nothing matches at all, keep the list but mark it so the caller can warn
  const need = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).length <= 2 ? 1 : 0.6;   // short queries: every word
  const onTopic = all.filter(c => c.relevance >= need);
  const list = onTopic.length ? onTopic : all.map(c => ({ ...c, off_topic: true }));
  const score = c => c.relevance * 3 + (Math.min(c.w || 1600, 3000) / 3000) + (needsCredit(c.licence) ? 0 : 0.25) - (c.w && c.w < 700 ? 1 : 0);
  return list.sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, n);
}

// One exact picture by the id `photos.mjs search` printed (ov-…, nasa-…, aic-…): no ranking involved.
export async function imageById(id) {
  if (id.startsWith('ov-')) return ovItem(await getJson(`https://api.openverse.org/v1/images/${encodeURIComponent(id.slice(3))}/`));
  if (id.startsWith('nasa-')) { const j = await getJson(`https://images-api.nasa.gov/search?nasa_id=${encodeURIComponent(id.slice(5))}`); const c = nasaItem(j.collection?.items?.[0] || {}); if (c) return c; }
  if (id.startsWith('aic-')) { const j = await getJson(`https://api.artic.edu/api/v1/artworks/${encodeURIComponent(id.slice(4))}?fields=${AIC_FIELDS}`); const c = aicItem(j.data || {}, j.config?.iiif_url || 'https://www.artic.edu/iiif/2'); if (c) return c; }
  throw new Error('unknown photo_id ' + id);
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

// ---------- music (Jamendo, ccMixter, Wikimedia via Openverse) ----------
export const MOODS = {
  suspense: ['suspense', 'tension'], mystery: ['mystery', 'dark ambient'], cinematic: ['cinematic', 'filmscore'], epic: ['epic'],
  calm: ['piano', 'calm'], uplifting: ['uplifting', 'inspiring'], playful: ['playful', 'quirky'], scifi: ['electronic', 'space ambient'], ambient: ['ambient'],
};
const VOCAL = /\b(feat|ft\.|vocal|vocals|song|lyrics|sing|singer|rap|remix|karaoke|choir)\b/i;
export async function searchMusic(mood, { licence = 'safe', minS = 60, maxS = 480 } = {}) {
  const lic = (LICENCES[licence] || LICENCES.safe).filter(l => l !== 'pdm');
  const qs = MOODS[mood] || [mood], out = [], seen = new Set();
  for (const q of qs) {
    let j; try { j = await getJson(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&license=${lic.join(',')}&source=jamendo,ccmixter,wikimedia_audio&page_size=20&mature=false`); } catch { continue; }
    for (const r of j.results || []) {
      const d = (r.duration || 0) / 1000;
      if (!r.url || seen.has(r.id) || d < minS || d > maxS || VOCAL.test(r.title || '')) continue;
      seen.add(r.id);
      out.push({ id: 'ov-' + r.id, source: r.source, title: r.title || mood, creator: r.creator || '', licence: r.license, licence_version: r.license_version || '', url: r.url, page: r.foreign_landing_url || r.url, dur: d,
        genres: (r.genres || []).join(',') });
    }
  }
  return out.sort((a, b) => (/filmscore|ambient|classical|soundtrack|electronic/i.test(b.genres) - /filmscore|ambient|classical|soundtrack|electronic/i.test(a.genres)) || (a.id < b.id ? -1 : 1));
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
