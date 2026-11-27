/* Drawing checks shared by art-preview.mjs and render.mjs --stills.

   lintSvg(svg, name)     static checks: flat clip-art (no kit shading, no own gradients, no clip),
                          <text> inside the art
   overflowProbe(svg)     runs IN THE PAGE (page.evaluate): rasterises the drawing with a wide margin
                          around its viewBox and measures how far the ink runs past it (that part is
                          cut off in a reel). Returns { left, right, top, bottom, fit, vb } in viewBox units.
   overflowMessage(name, r)  turns a probe result into a warning, or null */

const solidFills = svg => [...svg.matchAll(/\bfill\s*[=:]\s*"?\s*(#[0-9a-f]{3,8}|rgb|hsl|[a-z]+)/gi)]
  .map(m => m[1].toLowerCase()).filter(f => !['none', 'transparent', 'url', 'currentcolor', 'inherit'].includes(f)).length;

export function lintSvg(svg, name) {
  const out = [], s = String(svg || '');
  if (!s.includes('<svg')) return out;
  // flat clip-art: several solid fills and nothing that gives volume (kit gradients/hatching, own gradients, a clip)
  const kit = /url\(#kit-/.test(s), own = /<(linear|radial)Gradient|<pattern/i.test(s), clip = /<clipPath/i.test(s);
  if (!kit && !own && !clip && solidFills(s) >= 3)
    out.push(`${name}: flat clip-art (solid fills only: no kit gradient or hatching, no clipPath). Draw it in layers: silhouette clip, kit gradient, hatched shadow, highlight, rough outline (references/visual-style.md → Drawing objects; python scripts/artkit.py has helpers)`);
  const texts = [...s.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  if (texts.length || /<text\b/i.test(s))
    out.push(`${name}: text inside the drawing${texts.length ? ` ("${texts.slice(0, 3).join('", "').slice(0, 60)}")` : ''}: put words in overlays (label, chip, tape), which stay sharp, translatable and on-style`);
  return out;
}

export async function overflowProbe(svg) {
  const m = String(svg).match(/<svg\b[^>]*\bviewBox="([^"]+)"/i); if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/[\s,]+/).map(Number); if (!(w > 0 && h > 0)) return null;
  const P = 0.6, X = x - w * P, Y = y - h * P, W = w * (1 + 2 * P), H = h * (1 + 2 * P);
  const S = Math.min(2, 2000 / Math.max(W, H));                 // pixels per viewBox unit
  // the art kit (hatching, gradients, glows that fade out) is copied in from the page, so the ink is measured as drawn
  const kitDefs = document.getElementById('kit-rough')?.parentElement?.innerHTML || '';
  let probe = String(svg).replace(/<\?xml[^>]*>/, '');
  if (!kitDefs) probe = probe.replace(/\sfilter="url\(#kit-[^)]*\)"/g, '').replace(/url\(#kit-[^)]*\)/g, '#888');
  probe = probe.replace(/<svg\b([^>]*)>/i, (_, a) => {
    a = a.replace(/\s(width|height|viewBox)="[^"]*"/gi, '');
    if (!/xmlns=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${a} viewBox="${X} ${Y} ${W} ${H}" width="${Math.round(W * S)}" height="${Math.round(H * S)}" overflow="visible"><defs>${kitDefs}</defs>`;
  });
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(probe);
  try { await img.decode(); } catch { return null; }
  const cw = Math.round(W * S), ch = Math.round(H * S);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, cw, ch);
  let d; try { d = g.getImageData(0, 0, cw, ch).data; } catch { return null; }
  let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (d[(j * cw + i) * 4 + 3] > 60) {
    if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
  }
  if (x1 < 0) return null;
  const ux0 = X + x0 / S, ux1 = X + (x1 + 1) / S, uy0 = Y + y0 / S, uy1 = Y + (y1 + 1) / S;
  const r = v => Math.round(v);
  return { left: r(x - ux0), right: r(ux1 - (x + w)), top: r(y - uy0), bottom: r(uy1 - (y + h)), vb: [x, y, w, h],
    fit: [r(Math.min(x, ux0) - 4), r(Math.min(y, uy0) - 4), r(Math.max(x + w, ux1) - Math.min(x, ux0) + 8), r(Math.max(y + h, uy1) - Math.min(y, uy0) + 8)] };
}

export function overflowMessage(name, r) {
  if (!r) return null;
  const [, , w, h] = r.vb, tol = v => Math.max(4, v * 0.015);   // anti-aliased outline edges are fine
  const sides = [['left', r.left, w], ['right', r.right, w], ['top', r.top, h], ['bottom', r.bottom, h]].filter(([, v, d]) => v > tol(d));
  if (!sides.length) return null;
  return `${name}: the drawing runs past its viewBox (${sides.map(([s, v]) => `${s} ${v}`).join(', ')} units), and that part is cut off in the reel: use viewBox="${r.fit.join(' ')}"`;
}
