/* Cliffhanger render engine.
   Builds every scene from window.REEL, then exposes window.__seek(t) which puts the
   page in the exact state for time t (seconds). Deterministic: no timers, no rAF —
   render.mjs calls __seek for every frame and screenshots. */
(function () {
  'use strict';
  const D = window.REEL;
  // canvas size: vertical 1080x1920 unless the reel sets format.width/height (e.g. 1920x1080 for long-form)
  const W = (D.size && D.size.w) || 1080, H = (D.size && D.size.h) || 1920, WIDE = W > H;
  const stage = document.getElementById('stage');
  const scenes = D.scenes;
  const events = [];             // sound-effect cues, read by render.mjs
  window.__events = events;
  let S = null;                  // scene currently being built

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const E = {
    out: p => 1 - Math.pow(1 - p, 3),
    inq: p => p * p,
    io: p => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    bounce: p => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + .75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + .9375; return n * (p -= 2.625 / d) * p + .984375; },
  };
  function h(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

  // ---------- timing ----------
  // A time spec is relative to the scene: 1.2 | "40%" | "word:breath" | "word:breath+0.2" | "end-0.5"
  function wordTime(s, target) {
    const tgt = norm(String(target).split(/\s+/)[0]);
    if (!tgt) return null;
    const ws = s.words || [];
    for (const w of ws) {
      const n = norm(w.w);
      if (n && (n === tgt || (n.startsWith(tgt) && tgt.length >= 3) || (tgt.startsWith(n) && n.length >= 4))) return w.s;
    }
    const vo = String(s.vo || '').toLowerCase();
    const i = vo.indexOf(String(target).toLowerCase());
    if (i >= 0 && vo.length) return (i / vo.length) * (s.vo_dur || s.dur);
    return null;
  }
  function T(spec, def) {
    const s = S;
    if (spec === undefined || spec === null || spec === '') spec = def;
    if (spec === undefined || spec === null) spec = 0;
    let r;
    if (typeof spec === 'number') r = spec;
    else {
      spec = String(spec).trim();
      let off = 0;
      const mo = spec.match(/^(.+?)([+-]\d*\.?\d+)$/);
      if (mo && !/^[+-]?\d*\.?\d+$/.test(spec)) { spec = mo[1]; off = parseFloat(mo[2]); }
      if (/^\d*\.?\d+$/.test(spec)) r = parseFloat(spec);
      else if (spec.endsWith('%')) r = parseFloat(spec) / 100 * s.dur;
      else if (spec === 'end') r = s.dur;
      else if (spec === 'start') r = 0;
      else if (spec.startsWith('vo:')) r = ((s.vo_at || s.start) - s.start) + parseFloat(spec.slice(3)) * (s.vo_dur || s.dur);   // relative spot in the spoken line
      else if (spec.startsWith('word:')) { const w = wordTime(s, spec.slice(5)); r = w == null ? 0.4 * s.dur : w; }
      else r = 0;
      r += off;
    }
    return s.start + clamp(r, 0, Math.max(0, s.dur - 0.04));
  }

  // ---------- animation registry ----------
  function A(el, type, t0, dur, p) { const a = { el, type, t0, dur: dur == null ? 0.45 : dur, p: p || {} }; S._anims.push(a); return a; }
  function C(el, type, p) { S._conts.push({ el, type, p: p || {} }); }
  // A cue is a preset name ("impact") or {prompt:"glass shattering", dur, fallback:"impact", vol} (AI sound, cached)
  function sfx(type, t, vol, dur, extra) {
    const x = extra || {};
    events.push({ type, t, vol: vol == null ? 0.5 : vol, dur: dur != null ? dur : x.dur, prompt: x.prompt, fallback: x.fallback, loop: !!x.loop, influence: x.influence });
  }
  function cue(c, t, defVol) {
    if (!c) return;
    if (typeof c === 'string') return sfx(c, t, defVol);
    sfx(c.type || (c.prompt ? 'ai' : 'pop'), t, c.vol != null ? c.vol : defVol, c.dur, c);
  }
  function enter(el, spec, defStyle, defAt, defDur, pre, rot) {
    const style = spec.enter || defStyle;
    const t0 = T(spec.at, defAt);
    const a = A(el, 'in', t0, spec.dur != null ? spec.dur : defDur, { style, pre: pre || '', rot: rot || 0 });
    el.style.transform = `${pre || ''} rotate(${rot || 0}deg)`;
    if (spec.until != null) A(el, 'out', T(spec.until), 0.22);
    if (spec.sfx) cue(spec.sfx, t0, spec.sfx_vol != null ? spec.sfx_vol : 0.5);
    return a;
  }

  function apply(a, t, s) {
    const el = a.el, P = a.p;
    const p = a.dur > 0 ? clamp((t - a.t0) / a.dur, 0, 1) : (t >= a.t0 ? 1 : 0);
    switch (a.type) {
      case 'in': {
        if (t < a.t0) { el.style.opacity = 0; if (P.style === 'wipe') el.style.clipPath = 'inset(-30% 100% -30% -5%)'; return; }
        const e = E.out(p); let o = 1, tr = '';
        switch (P.style) {
          case 'fade': o = e; break;
          case 'fadeUp': o = e; tr = `translateY(${(1 - e) * 60}px)`; break;
          case 'fadeDown': o = e; tr = `translateY(${-(1 - e) * 60}px)`; break;
          case 'pop': o = clamp(p * 3, 0, 1); tr = `scale(${0.35 + 0.65 * E.back(p)})`; break;
          case 'slam': o = clamp(p * 3, 0, 1); tr = `scale(${2.5 - 1.5 * E.inq(p)})`; break;
          case 'slideL': tr = `translateX(${-(1 - e) * 1150}px)`; el.style.filter = p < 1 ? `blur(${Math.sin(p * Math.PI) * 7}px)` : ''; break;
          case 'slideR': tr = `translateX(${(1 - e) * 1150}px)`; el.style.filter = p < 1 ? `blur(${Math.sin(p * Math.PI) * 7}px)` : ''; break;
          case 'slideUp': tr = `translateY(${(1 - e) * 1400}px)`; el.style.filter = p < 1 ? `blur(${Math.sin(p * Math.PI) * 7}px)` : ''; break;
          case 'spring': o = clamp(p * 4, 0, 1); tr = `scale(${1 - Math.exp(-6 * p) * Math.cos(14 * p) * 0.6})`; break;
          case 'swing': o = clamp(p * 3, 0, 1); tr = `rotate(${Math.exp(-5 * p) * Math.cos(12 * p) * -14}deg) translateY(${(1 - e) * 40}px)`; break;
          case 'drop': o = clamp(p * 4, 0, 1); tr = `translateY(${-(1 - E.bounce(p)) * 900}px)`; break;
          case 'zoom': o = e; tr = `scale(${1.4 - 0.4 * e})`; break;
          case 'stick': tr = `scale(${1.25 - 0.25 * clamp(p * 1.0, 0, 1)})`; break;
          case 'blur': o = e; el.style.filter = p < 1 ? `blur(${(1 - e) * 26}px)` : ''; break;
          case 'wipe': el.style.clipPath = p < 1 ? `inset(-30% ${(1 - E.io(p)) * 105}% -30% -5%)` : 'none'; break;
          case 'wipeDown': el.style.clipPath = p < 1 ? `inset(-5% -5% ${(1 - E.io(p)) * 105}% -5%)` : 'none'; break;
          default: break;
        }
        el.style.opacity = o;
        el.style.transform = `${P.pre} ${tr} rotate(${P.rot}deg)`;
        break;
      }
      case 'out': if (t >= a.t0) el.style.opacity = (parseFloat(el.style.opacity) || 0) * (1 - p); break;
      case 'opacity': el.style.opacity = t < a.t0 ? P.a : P.a + (P.b - P.a) * E.io(p); break;
      case 'type': {
        const n = t < a.t0 ? 0 : Math.round(P.text.length * p);
        el.textContent = P.text.slice(0, n);
        break;
      }
      case 'count': {
        const v = P.from + (P.to - P.from) * E.out(t < a.t0 ? 0 : p);
        el.textContent = P.prefix + P.fmt.format(Math.round(v)) + P.suffix;
        break;
      }
      case 'draw': el.style.strokeDashoffset = P.len * (1 - (t < a.t0 ? 0 : E.io(p))); break;
      case 'fillo': el.style.fillOpacity = t < a.t0 ? 0 : P.base * E.io(p); break;
      case 'width': { const f = P.from || 0; el.style.width = (t < a.t0 ? f : f + (P.to - f) * E.out(p)) + (P.unit || '%'); break; }
      case 'blink': el.style.opacity = t < a.t0 ? 0 : (Math.floor((t - a.t0) * 2.6) % 2 ? 0 : 1); break;
      case 'shake': if (t >= a.t0 && t <= a.t0 + a.dur) { const k = P.amp * (1 - p); s._shk.x += Math.sin(t * 95) * k; s._shk.y += Math.cos(t * 77) * k; } break;
      case 'flash': el.style.opacity = (t >= a.t0 && p < 1) ? (1 - p) * (P.max || 0.8) : 0; break;
    }
  }
  function applyC(c, t, s) {
    const P = c.p, el = c.el, q = (t - s.start) / s.dur;
    switch (c.type) {
      case 'float': el.style.transform = `translateY(${Math.sin(t * 1.5 + P.ph) * 9}px) rotate(${Math.sin(t * 1.05 + P.ph) * 0.7}deg)`; break;
      case 'hover': el.style.transform = `translate(${Math.sin(t * 1.3 + P.ph) * 16 + Math.sin(t * 17) * 2.5}px,${Math.sin(t * .9 + P.ph) * 12 + Math.cos(t * 13) * 2.5}px)`; break;
      case 'kenburns': el.style.transform = `scale(${1 + (P.amt || 0.08) * q})`; break;
      case 'kenout': el.style.transform = `scale(${1 + (P.amt || 0.08) * (1 - q)})`; break;
      case 'drift': el.style.transform = `translate(${(P.dx || 0) * q}px,${(P.dy || 0) * q}px)`; break;
      case 'pulse': el.style.transform = `scale(${1 + (P.amp || 0.04) * Math.sin(t * (P.sp || 6))})`; break;
      case 'spin': el.style.transform = `rotate(${(t - s.start) * (P.deg || 20)}deg)`; break;
      case 'shiver': el.style.transform = `translate(${Math.sin(t * 61) * 2}px,${Math.cos(t * 53) * 2}px)`; break;
      default: break;
    }
  }

  // ---------- paper shapes ----------
  function roughShape(kind, seed) {
    const pts = [], r = k => rnd(seed * 13.7 + k);
    if (kind === 'disc') {
      for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, rr = 47 + (r(i) - 0.5) * 3.2; pts.push([50 + Math.cos(a) * rr, 50 + Math.sin(a) * rr]); }
    } else {                                  // block / torn: a painted rectangle with brushy, torn edges
      const n = 14, amp = kind === 'torn' ? 2.6 : 1.4;
      for (let i = 0; i <= n; i++) pts.push([i / n * 100, 1.5 + (r(i) - 0.5) * amp]);
      for (let i = 0; i <= n; i++) pts.push([98.5 + (r(i + 40) - 0.5) * amp, i / n * 100]);
      for (let i = n; i >= 0; i--) pts.push([i / n * 100, 98.5 + (r(i + 80) - 0.5) * amp]);
      for (let i = n; i >= 0; i--) pts.push([1.5 + (r(i + 120) - 0.5) * amp, i / n * 100]);
    }
    return 'polygon(' + pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(',') + ')';
  }

  // ---------- objects (art) ----------
  function obj(spec, parent, defs) {
    const o = Object.assign({ x: W / 2, y: Math.round(H * 0.615), w: WIDE ? 760 : 820, rot: 0, motion: 'float', enter: D.art_enter || 'fadeUp', at: 0.05, dur: 0.6, shadow: true }, defs || {}, spec);
    const wrap = h('div', 'obj', parent);
    wrap.style.left = o.x + 'px'; wrap.style.top = o.y + 'px'; wrap.style.width = o.w + 'px';
    if (o.z) wrap.style.zIndex = o.z;
    if (o.feather && o.image) wrap.classList.add('feather');
    if (o.adapt && o.image) wrap.classList.add('adapt-' + o.adapt);     // shared image shown on the opposite theme
    if (o.fallback_svg) wrap._fallback = o.fallback_svg;
    // collage look (paper cut-out): grayscale + halftone dots + paper sticker edge, on a torn paint block
    const finish = o.finish || S.finish || D.finish;
    const backing = o.backing || (finish === 'collage' && o.backing !== false && o.backing !== 'none' ? (S.backing || D.backing || 'block') : null);
    if (backing && backing !== 'none') {
      const bk = h('div', 'backing ' + backing, wrap);
      bk.style.background = o.backing_color || S.backing_color || D.backing_color || 'var(--paint)';
      bk.style.clipPath = roughShape(backing, (o.x * 7 + o.y * 3) % 997);
      bk.style.transform = `translate(-50%,-50%) rotate(${o.backing_rot != null ? o.backing_rot : -2.5}deg) scale(${o.backing_scale || 1})`;
      enter(bk, { at: o.at, enter: 'slam', dur: 0.28 }, 'slam', o.at, 0.28, 'translate(-50%,-50%)', o.backing_rot != null ? o.backing_rot : -2.5);
      cue('paper', T(o.at, 0.05), 0.25);
    }
    if (finish === 'collage') wrap.classList.add('finish-collage');
    if (o.blend && finish !== 'collage') wrap.style.mixBlendMode = o.blend;    // collage cut-outs are opaque paper
    const inner = h('div', 'inner', wrap);
    const content = o.svg || (o.image ? `<img src="${o.image}" alt="">` : (o.html || ''));
    const clean = h('div', 'clean', inner, content);
    if (finish === 'collage' && o.halftone === false) wrap.classList.add('no-ht');
    if (o.shadow && S.theme !== 'photo' && finish !== 'collage') wrap.insertBefore(h('div', 'gshadow'), inner);
    const sketch = o.enter === 'sketch' && !!o.svg;
    enter(wrap, o, sketch ? 'fade' : o.enter, o.at, sketch ? 0.12 : o.dur, 'translate(-50%,-50%)', o.rot);
    if (sketch) {        // whiteboard effect: every outline draws itself, then colour and hatching fade in
      const ts = T(o.at, 0.05), total = o.sketch_dur || 1.4;
      sfx('scribble', ts, 0.2, total * 0.75);
      S._layout.push(() => sketchify(clean, ts, total));
    }
    if (o.mystery) {
      const pix = h('div', 'pix', inner, content);
      pix.style.filter = 'url(#cf-pixelate)';
      if (o.reveal_at != null) {
        const tr = T(o.reveal_at);
        A(clean, 'opacity', tr, 0.5, { a: 0, b: 1 });
        A(pix, 'opacity', tr, 0.5, { a: 1, b: 0 });
        sfx('pop', tr, 0.35);
      } else clean.style.opacity = 0;
    }
    if (o.motion && o.motion !== 'none') C(inner, o.motion, { ph: (o.x + o.y) % 7, dx: o.dx, dy: o.dy, amt: o.amt, deg: o.deg });
    // stroke draw-on for elements marked class="draw" inside the SVG
    const t0 = o.draw_at != null ? T(o.draw_at) - 0.15 : T(o.at, 0.05);
    if (!sketch) S._layout.push(() => {
      const lines = clean.querySelectorAll('.draw');
      const stag = Math.min(o.draw_stagger || 0.06, 1.2 / Math.max(1, lines.length));   // any count finishes in ~1.2 s
      lines.forEach((p, i) => {
        if (!p.getTotalLength) return;
        const len = p.getTotalLength();
        p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
        A(p, 'draw', t0 + 0.15 + i * stag, o.draw_dur || 0.9, { len });
      });
    });
    return wrap;
  }

  function sketchify(root, t0, total) {
    const els = [...root.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon,text,use,image')]
      .filter(el => !el.closest('defs,pattern,clipPath,mask,marker,symbol'));
    const strokes = [], fills = [], fades = [];
    els.forEach(el => {
      if (/^(text|use|image)$/i.test(el.tagName)) { fades.push(el); return; }
      const cs = getComputedStyle(el);
      const dashed = cs.strokeDasharray && cs.strokeDasharray !== 'none';
      const hasStroke = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0 && !dashed;
      if (hasStroke) strokes.push(el);
      if ((cs.fill && cs.fill !== 'none') || !hasStroke) fills.push(el);
    });
    strokes.forEach((el, i) => {
      let len = 0; try { len = el.getTotalLength(); } catch (e) { /* not measurable */ }
      if (!len) { fades.push(el); return; }
      el.style.strokeDasharray = len; el.style.strokeDashoffset = len;
      A(el, 'draw', t0 + (i / Math.max(1, strokes.length)) * total * 0.65, Math.min(0.7, total * 0.45), { len });
    });
    fills.forEach(el => {
      const base = parseFloat(getComputedStyle(el).fillOpacity); el.style.fillOpacity = 0;
      A(el, 'fillo', t0 + total * 0.5, total * 0.4, { base: isNaN(base) ? 1 : base });
    });
    fades.forEach(el => { el.style.opacity = 0; A(el, 'opacity', t0 + total * 0.55, total * 0.35, { a: 0, b: 1 }); });
  }

  // ---------- headline ----------
  function headline(s, sc) {
    const lines = Array.isArray(s.headline) ? s.headline : (s.headline ? [s.headline] : []);
    if (!lines.length) return;
    const hl = h('div', 'hl ' + (s.headline_style || (s.theme === 'photo' ? 'label' : '')), sc);
    if (s.headline_y != null) hl.style.top = s.headline_y + 'px';
    const maxChars = Math.max(...lines.map(l => String(l).length));
    let size = s.headline_size || Math.min(s.theme === 'photo' ? 96 : 128, Math.floor(910 / (maxChars * 0.47)));
    hl.style.fontSize = size + 'px';
    if (hl.classList.contains('label')) enter(hl, { at: 0 }, 'wipe', 0, 0.35, '', -1.1);
    const accentLine = s.accent_line != null ? s.accent_line : 1;
    const punchDef = s.punch_at != null ? s.punch_at : null;
    let cursor = 0;                       // search VO words in order
    const ws = s.words || [];
    let punchT = null;
    lines.forEach((ln, i) => {
      const L0 = h('span', 'ln' + (i === accentLine ? ' l2' : ''), hl);
      const L = h('span', 'lt', L0);
      if (i === accentLine) S._punchLine = L;
      String(ln).split(/\s+/).filter(Boolean).forEach((w, j) => {
        const sp = h('span', 'w', L, esc(w));
        L.appendChild(document.createTextNode(' '));
        let t = null;
        if (s.headline_static) t = s.start - 1;                         // continuing beat: already on screen
        else if (i === accentLine && punchDef != null) t = T(punchDef) + j * 0.08;
        else if (i === 0 && s.headline_at != null) t = T(s.headline_at) + j * 0.07;
        else {
          const n = norm(w);
          for (let k = cursor; k < ws.length && n; k++) {
            const wn = norm(ws[k].w);
            if (wn && (wn === n || (wn.startsWith(n) && n.length >= 3) || (n.startsWith(wn) && wn.length >= 3))) { t = s.start + Math.max(0, ws[k].s - 0.08); cursor = k + 1; break; }
          }
          if (t == null) t = i === 0 ? s.start + j * 0.07 : T('40%') + j * 0.08;
        }
        if (i !== accentLine && !s.headline_static) t = Math.min(t, s.start + 0.9 + j * 0.07);   // setup line is never late
        A(sp, 'in', t, 0.3, { style: i === accentLine ? 'pop' : 'fadeUp', pre: '', rot: 0 });
        if (i === accentLine && punchT == null) punchT = t;
      });
    });
    // punch emphasis: "underline" (hand-drawn red stroke) | "marker" (highlighter swipe) | "shake"
    const fx = s.headline_fx || D.headline_fx;
    const PL = S._punchLine; S._punchLine = null;
    if (fx && PL && punchT != null) {
      if (fx === 'underline') {
        const u = sv('svg', { class: 'hl-ul', viewBox: '0 0 100 12', preserveAspectRatio: 'none' }, PL);
        sv('path', { d: 'M1 8 C 20 3, 45 10, 62 6 S 88 3, 99 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 9, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, u);
        A(u, 'in', punchT + 0.25, 0.35, { style: 'wipe', pre: '', rot: 0 });     // wipe, not dash: the svg is stretched
        sfx('scratch', punchT + 0.25, 0.25);
      } else if (fx === 'marker' && s.theme === 'paper') {
        const m = h('i', 'hl-mk', PL); A(m, 'width', punchT + 0.2, 0.4, { to: 104 });
      } else if (fx === 'shake') {
        A(S._shaker, 'shake', punchT + 0.05, 0.25, { amp: 10 });
      }
    }
    S._layout.push(() => {                // shrink to fit
      const avail = hl.clientWidth - (hl.classList.contains('label') ? 72 : 0);
      let guard = 40;
      while (guard-- > 0 && [...hl.querySelectorAll('.ln')].some(l => l.scrollWidth > avail + 2)) { size -= 4; hl.style.fontSize = size + 'px'; }
    });
  }

  // ---------- visuals ----------
  const V = {
    art(v, sc) { S._mainArt = { el: obj(v, sc), spec: v }; },
    // newspaper clipping: masthead, date line, headline, columns of text with highlighted lines
    newspaper(v, sc) {
      const c = h('div', 'news', sc); c.style.left = (v.x || W / 2) + 'px'; c.style.top = (v.y || Math.round(H * 0.6)) + 'px'; if (v.w) c.style.width = v.w + 'px';
      h('div', 'news-mast', c, esc(v.masthead || 'The Daily Record'));
      h('div', 'news-meta', c, `<span>${esc(v.date || '')}</span><span>${esc(v.issue || '')}</span>`);
      h('div', 'news-head', c, esc(v.headline || ''));
      const body = h('div', 'news-body', c), hl = new Set(v.highlight || [1, 2]);
      let n = 0; const marks = [];
      for (let col = 0; col < 3; col++) {
        const C2 = h('div', 'news-col', body);
        for (let i = 0; i < (v.lines || 9); i++, n++) {
          const l = h('i', hl.has(n) ? 'hot' : '', C2); l.style.width = (62 + rnd(n * 3.1) * 36) + '%';
          if (hl.has(n)) marks.push(l);
        }
      }
      enter(c, v, 'drop', 0.1, 0.6, 'translate(-50%,-50%)', v.rot != null ? v.rot : -2);
      const th = T(v.highlight_at, '45%');
      marks.forEach((m, i) => { const w = parseFloat(m.style.width); m.style.width = '0'; A(m, 'width', th + i * 0.12, 0.4, { to: w }); });
      sfx('paper', T(v.at, 0.1), 0.35);
    },
    // side-by-side comparison: two objects, labels, values, "VS"
    compare(v, sc) {
      const y = v.y || 1100;
      [['left', 280, 'slideL'], ['right', 800, 'slideR']].forEach(([k, x, en], i) => {
        const o = v[k]; if (!o) return;
        if (o.svg || o.image) obj(Object.assign({ x, y, w: o.w || 400, motion: 'float', enter: en, at: (o.at != null ? o.at : 0.1 + i * 0.35) }, o), sc);
        const lab = h('div', 'cmp-lab', sc, `<b>${esc(o.label || '')}</b><span>${esc(o.value || '')}</span>`);
        lab.style.left = x + 'px'; lab.style.top = (y + (o.label_dy || 300)) + 'px';
        enter(lab, { at: o.at != null ? o.at : 0.3 + i * 0.35 }, 'fadeUp', 0, 0.4, 'translate(-50%,0)', 0);
        if (v.winner === k) { const u = h('i', 'cmp-win', lab); A(u, 'width', T(v.winner_at, '70%'), 0.4, { to: 100 }); sfx('scratch', T(v.winner_at, '70%'), 0.3); }
      });
      const vs = h('div', 'cmp-vs', sc, esc(v.vs || 'VS')); vs.style.top = (y - 60) + 'px';
      enter(vs, { at: v.vs_at != null ? v.vs_at : 0.6 }, 'slam', 0, 0.22, 'translate(-50%,0)', -4);
      sfx('impact', T(v.vs_at, 0.6) + 0.2, 0.4);
    },
    // vertical timeline: dated points appear one by one along a line that draws itself
    timeline(v, sc) {
      const x = v.x || 190, y0 = v.y || 620, items = v.items || [], gap = v.gap || Math.min(240, (H * 0.833 - y0) / Math.max(1, items.length));
      const svg = sv('svg', { class: 'ovsvg', viewBox: `0 0 ${W} ${H}` }, sc);
      const len = gap * Math.max(0, items.length - 1) + 40;
      const ln = sv('line', { x1: x, y1: y0, x2: x, y2: y0 + len, stroke: 'currentColor', 'stroke-width': 6, class: 'tl-line' }, svg);
      const t0 = T(v.at, 0.1);
      S._layout.push(() => { ln.style.strokeDasharray = len; ln.style.strokeDashoffset = len; A(ln, 'draw', t0, Math.max(0.8, items.length * 0.5), { len }); });
      items.forEach((it, i) => {
        const row = h('div', 'tl-row', sc); row.style.left = (x - 22) + 'px'; row.style.top = (y0 + i * gap - 22) + 'px';
        row.innerHTML = `<i class="tl-dot"></i><div><b>${esc(it.year || it.label || '')}</b><span>${esc(it.text || '')}</span></div>`;
        const ti = it.at != null ? T(it.at) : t0 + 0.2 + i * (v.stagger || 0.6);
        A(row, 'in', ti, 0.4, { style: 'fadeUp', pre: '', rot: 0 }); sfx('pop', ti, 0.2);
      });
    },
    stat(v, sc) {
      const box = h('div', 'stat', sc); box.style.top = (v.y || 640) + 'px';
      const num = h('div', 'num', box), lab = h('div', 'lab', box, esc(v.label || ''));
      if (v.color) num.style.color = v.color;
      enter(box, v, 'fadeUp', 0.05, 0.45);
      const m = String(v.value).match(/^([^\d]*)([\d,.]+)(.*)$/);
      if (m && v.count !== false) {
        const digits = m[2].replace(/,/g, '');
        const indian = /\d,\d\d,\d{3}/.test(m[2]);
        const fmt = new Intl.NumberFormat(indian ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 });
        A(num, 'count', T(v.at, 0.05), v.count_dur || 1.2, { from: 0, to: parseFloat(digits), prefix: m[1], suffix: m[3], fmt });
        sfx('tick_roll', T(v.at, 0.05), 0.12, v.count_dur || 1.2);
      } else num.textContent = v.value;
      if (v.art) obj(Object.assign({ y: 1300, w: 640, mystery: true }, v.art), sc);
    },
    bars(v, sc) {
      const box = h('div', 'bars', sc); box.style.top = (v.y || 640) + 'px';
      const max = v.max || Math.max(...v.rows.map(r => r.value));
      v.rows.forEach((r, i) => {
        const row = h('div', 'bar-row' + (r.mystery ? ' mystery' : ''), box);
        const ico = h('div', 'bar-ico', row, r.svg || (r.image ? `<img src="${r.image}">` : ''));
        if (r.mystery) ico.style.filter = 'url(#cf-pixelate)';
        const col = h('div', 'bar-col', row);
        h('div', 'bar-lab', col, esc(r.label));
        h('div', 'bar-val', col, esc(r.display || r.value));
        const fill = h('div', 'bar-fill', h('div', 'bar-track', col));
        const t0 = r.at != null ? T(r.at) : T(v.at, 0.1) + i * (v.stagger || 0.55);
        A(row, 'in', t0, 0.4, { style: 'fadeUp', pre: '', rot: 0 });
        A(fill, 'width', t0 + 0.2, 0.8, { to: Math.max(1.5, r.value / max * 100) });
        if (r.mystery) sfx('thud', t0 + 0.2, 0.35);
      });
    },
    notepad(v, sc) { notepad(v, sc); },
    terminal(v, sc) { terminal(v, sc, v); },
    labfile(v, sc) { labfile(v, sc); },
    question(v, sc) {
      const q = h('div', 'qmark', sc, esc(v.mark || '?')); q.style.top = (v.y || 560) + 'px';
      enter(q, v, 'zoom', 0.05, 0.5);
      C(q, 'pulse', { amp: 0.015, sp: 3 });
      if (v.art) obj(Object.assign({ y: 1150, w: 360, z: 3 }, v.art), sc);
    },
    endcard(v, sc) {
      const e = h('div', 'end', sc); if (v.y) e.style.top = v.y + 'px';
      const parts = [];
      if (v.kicker) parts.push(h('div', 'k', e, esc(v.kicker)));
      if (v.title) parts.push(h('div', 't', e, esc(v.title)));
      if (v.sub) parts.push(h('div', 's', e, esc(v.sub)));
      if (v.brand !== false) parts.push(h('div', 'b', e, esc(v.brand || D.brand.name)));
      if (v.next) { const n = h('div', 'next', h('div', '', e)); h('small', '', n, esc(v.next_label || 'NEXT PART')); h('span', '', n, esc(v.next)); parts.push(n); }
      if (v.cta !== false) { const f = h('div', 'follow', h('div', '', e), esc(v.cta || 'Follow')); parts.push(f); C(f, 'pulse', { amp: 0.035, sp: 5 }); }
      const t0 = T(v.at, 0.05);
      parts.forEach((p, i) => {
        const isT = p.classList.contains('t'), isF = p.classList.contains('follow');
        A(p, 'in', t0 + i * 0.32, 0.45, { style: isT ? 'blur' : isF ? 'pop' : 'fadeUp', pre: '', rot: p.classList.contains('next') ? -1 : 0 });
        if (isT) sfx('thud', t0 + i * 0.32, 0.45);
        if (isF) sfx('pop', t0 + i * 0.32, 0.4);
      });
    },
    none() {},
  };

  function terminal(v, sc, pos) {
    const box = h('div', 'term', sc);
    box.style.left = (pos.x || W / 2) + 'px'; box.style.top = (pos.y || Math.round(H * 0.78)) + 'px';
    if (pos.w) box.style.width = pos.w + 'px';
    const line = h('div', '', box);
    h('span', '', line, '&gt; ' + esc(v.prompt ? v.prompt + ': ' : ''));
    const typed = h('span', '', line), cur = h('span', 'cur', line, '_');
    const a = enter(box, v, 'fadeUp', 0.1, 0.35, 'translate(-50%,-50%)', pos.rot || 0);
    const tt = a.t0 + 0.3, td = v.type_dur || Math.max(0.5, (v.text || '').length * 0.07);
    A(typed, 'type', tt, td, { text: v.text || '' });
    A(cur, 'blink', a.t0);
    sfx('typing', tt, 0.22, td);
    if (v.progress != null) { const pr = h('i', '', h('div', 'prog', box)); A(pr, 'width', tt + td, v.progress_dur || 1.4, { to: v.progress * 100 }); }
    return box;
  }
  function labfile(v, sc) {
    const c = h('div', 'labfile', sc);
    c.style.left = (v.x || 760) + 'px'; c.style.top = (v.y || 1150) + 'px'; if (v.w) c.style.width = v.w + 'px';
    if (v.kicker) h('div', 'k', c, esc(v.kicker));
    h('div', 't', c, esc(v.title || ''));
    (v.rows || []).forEach(r => h('div', 'r', c, esc(r[0]) + ': ' + (r[2] ? '<b>' + esc(r[1]) + '</b>' : esc(r[1]))));
    enter(c, v, 'slideR', 0.1, 0.55, 'translate(-50%,-50%)', v.rot != null ? v.rot : 1.5);
    sfx('swish', T(v.at, 0.1), 0.3);
  }

  // ---------- notepad with a pencil that actually writes ----------
  function notepad(v, sc) {
    const pad = h('div', 'notepad', sc);
    pad.style.top = (v.y || 640) + 'px';
    const rows = Math.max(v.min_rows || 4, (v.lines || []).length);
    pad.style.minHeight = (110 + rows * 100 + 70) + 'px';
    if (v.title) h('div', 'np-title', pad, esc(v.title));
    const a0 = enter(pad, v, 'fadeUp', 0.05, 0.45, '', v.rot != null ? v.rot : -1.2);
    let tcur = a0.t0 + 0.4;
    const segs = [];   // pencil path segments (filled in layout pass)
    const todo = [];
    (v.lines || []).forEach((ln) => {
      const row = h('div', 'np-row', pad);
      let box = null;
      if (ln.box || ln.mark) box = h('span', 'np-box', row);
      const tx = h('span', 'np-text', row);
      const t = h('span', 't', tx, esc(ln.text));
      const tw = ln.at != null ? T(ln.at) : tcur;
      const wd = ln.write_dur || Math.max(0.35, String(ln.text).length * 0.055);
      A(t, 'in', tw, wd, { style: 'wipe', pre: '', rot: 0 });
      todo.push({ kind: 'write', el: t, t0: tw, dur: wd });
      sfx('scribble', tw, 0.25, wd);
      tcur = tw + wd + 0.15;
      if (ln.highlight) { const hl = h('i', 'np-hl', tx); const th = T(ln.highlight_at, ln.highlight_at == null ? null : 0) ; const t0 = ln.highlight_at != null ? th : tcur; A(hl, 'width', t0, 0.45, { to: 104 }); tcur = t0 + 0.5; }
      if (ln.strike) {
        const st = h('i', 'np-strike', tx);
        const t0 = ln.strike_at != null ? T(ln.strike_at) : tcur;
        A(st, 'width', t0, 0.35, { to: 106 });
        todo.push({ kind: 'strike', el: tx, t0, dur: 0.35 }); sfx('scratch', t0, 0.35); tcur = t0 + 0.45;
      }
      if (ln.circle) {
        const s2 = sv('svg', { class: 'np-circ', viewBox: '0 0 100 40', preserveAspectRatio: 'none' }, tx);
        const el = sv('ellipse', { cx: 50, cy: 20, rx: 48, ry: 18, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2, 'vector-effect': 'non-scaling-stroke', class: 'draw' }, s2);
        el.style.strokeWidth = '6px';
        const t0 = ln.circle_at != null ? T(ln.circle_at) : tcur;
        S._layout.push(() => { const len = el.getTotalLength() * 1.02; el.style.strokeDasharray = len; el.style.strokeDashoffset = len; A(el, 'draw', t0, 0.5, { len }); });
        tcur = t0 + 0.55;
      }
      if (ln.replace) {
        const nw = h('span', 'np-new', tx, esc(ln.replace));
        const t0 = ln.replace_at != null ? T(ln.replace_at) : tcur;
        A(nw, 'in', t0, 0.5, { style: 'wipe', pre: '', rot: -3 });
        todo.push({ kind: 'write', el: nw, t0, dur: 0.5 }); tcur = t0 + 0.6;
      }
      if (ln.mark && box) {
        const s2 = sv('svg', { viewBox: '0 0 78 78' }, box);
        const d = ln.mark === 'check' ? 'M14 40 L32 60 L66 12' : 'M14 14 L64 64 M64 14 L14 64';
        const pth = sv('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s2);
        const t0 = ln.mark_at != null ? T(ln.mark_at) : tcur;
        S._layout.push(() => { const len = pth.getTotalLength(); pth.style.strokeDasharray = len; pth.style.strokeDashoffset = len; A(pth, 'draw', t0, 0.3, { len }); });
        todo.push({ kind: 'mark', el: box, t0, dur: 0.3 }); sfx('scratch', t0, 0.3); tcur = t0 + 0.4;
      }
    });
    if (v.pencil === false) return;
    const pencil = h('div', 'pencil', sc, PENCIL);
    S._layout.push(() => {
      const sr = stage.getBoundingClientRect();
      todo.sort((a, b) => a.t0 - b.t0).forEach(td => {
        const r = td.el.getBoundingClientRect();
        const y = r.top - sr.top + r.height * 0.62, x0 = r.left - sr.left, x1 = r.right - sr.left;
        if (td.kind === 'mark') segs.push({ t0: td.t0, dur: td.dur, x0: x0 + 6, y0: r.top - sr.top + 8, x1: x1 - 6, y1: r.bottom - sr.top - 8 });
        else segs.push({ t0: td.t0, dur: td.dur, x0, y0: y, x1, y1: y - (td.kind === 'strike' ? 10 : 0) });
      });
    });
    S._pencils.push({ el: pencil, segs });
  }
  function applyPencil(pc, t) {
    const g = pc.segs; if (!g.length) return;
    const first = g[0], last = g[g.length - 1], end = last.t0 + last.dur;
    let x, y, o = 1;
    if (t < first.t0 - 0.35 || t > end + 0.6) { pc.el.style.opacity = 0; return; }
    if (t < first.t0) { const q = E.out((t - (first.t0 - 0.35)) / 0.35); x = first.x0 + 400 * (1 - q); y = first.y0 + 300 * (1 - q); }
    else if (t > end) { const q = E.inq((t - end) / 0.6); x = last.x1 + 500 * q; y = last.y1 + 350 * q; }
    else {
      let i = g.findIndex(s => t >= s.t0 && t <= s.t0 + s.dur);
      if (i >= 0) { const s = g[i], q = (t - s.t0) / s.dur; x = s.x0 + (s.x1 - s.x0) * q; y = s.y0 + (s.y1 - s.y0) * q + Math.sin(t * 40) * 4; }
      else { // gliding between segments
        i = g.findIndex(s => s.t0 > t); const a = g[i - 1], b = g[i];
        const q = E.io(clamp((t - (a.t0 + a.dur)) / Math.max(0.01, b.t0 - (a.t0 + a.dur)), 0, 1));
        x = a.x1 + (b.x0 - a.x1) * q; y = a.y1 + (b.y0 - a.y1) * q - Math.sin(q * Math.PI) * 30;
      }
    }
    pc.el.style.opacity = o;
    pc.el.style.transform = `translate(${x}px,${y - 22}px) rotate(-38deg)`;
  }
  // solid fills only: a gradient defined inside another (hidden) scene would not paint
  const PENCIL = `<svg viewBox="0 0 300 44" width="300" height="44">
    <path d="M0 22 L14 18 L14 26 Z" fill="#2a2a2a"/><path d="M14 18 L54 4 L54 40 L14 26 Z" fill="#E9C9A0"/>
    <path d="M54 4 H272 V16 H54 Z" fill="#E0473C"/><path d="M54 16 H272 V30 H54 Z" fill="#C2271F"/><path d="M54 30 H272 V40 H54 Z" fill="#8E1A14"/>
    <path d="M54 16 H272" stroke="rgba(255,255,255,.25)" stroke-width="3"/><rect x="272" y="4" width="28" height="36" rx="3" fill="#BDBDBD"/><path d="M276 4 v36 M284 4 v36 M292 4 v36" stroke="#999" stroke-width="2"/></svg>`;

  // ---------- art kit: shared defs any SVG can use via url(#kit-…) ----------
  const hatch = (id, ang, gap, col, op, w) => `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})"><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${col}" stroke-width="${w}" opacity="${op}"/></pattern>`;
  const lin = (id, a, b, op1 = 1, op2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}" stop-opacity="${op1}"/><stop offset="1" stop-color="${b}" stop-opacity="${op2}"/></linearGradient>`;
  const rad = (id, a, b, op1 = 1, op2 = 1, cx = .4, cy = .35, r = .75) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${a}" stop-opacity="${op1}"/><stop offset="1" stop-color="${b}" stop-opacity="${op2}"/></radialGradient>`;
  const ART_KIT = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    ${hatch('kit-hatch', 45, 9, '#2b2420', .35, 1.6)}${hatch('kit-hatch-r', -45, 9, '#2b2420', .35, 1.6)}
    ${hatch('kit-hatch-fine', 40, 6, '#2b2420', .25, 1.1)}${hatch('kit-hatch-dense', 45, 5, '#2b2420', .5, 1.4)}
    ${hatch('kit-hatch-light', 45, 9, '#EFEAE0', .3, 1.5)}${hatch('kit-hatch-red', 45, 8, '#8E1A14', .45, 1.5)}
    <pattern id="kit-cross" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V9M0 0H9" stroke="#2b2420" stroke-width="1.3" opacity=".35"/></pattern>
    <pattern id="kit-stipple" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r="1.1" fill="#2b2420" opacity=".4"/><circle cx="7" cy="8" r=".9" fill="#2b2420" opacity=".35"/><circle cx="8" cy="2" r=".7" fill="#2b2420" opacity=".3"/></pattern>
    ${lin('kit-skin', '#F2D4B8', '#D4A27C')}${rad('kit-skin-r', '#F4DAC0', '#CF9C74')}
    ${rad('kit-flesh', '#F6D6CC', '#D3918A')}${rad('kit-organ', '#EE7D6E', '#A3312A')}
    ${lin('kit-blood', '#DA3A30', '#861812')}${rad('kit-bone', '#FBF5E8', '#D6C6A6')}
    ${lin('kit-xray', '#9FD0FF', '#4E86C8', .45, .15)}${lin('kit-metal', '#F6F7F8', '#8E959C')}
    ${lin('kit-glass', '#FFFFFF', '#DDE8EE', .6, .15)}${lin('kit-water', '#CFE8F6', '#79B0D6', .85, .9)}
    ${lin('kit-wood', '#A06A47', '#6B4A33')}${lin('kit-leaf', '#97B27B', '#5D784B')}${lin('kit-cloth', '#AFC2D4', '#6E879F')}
    ${rad('kit-glow-red', '#FF4A3A', '#FF4A3A', .7, 0, .5, .5, .5)}${rad('kit-glow-blue', '#9FD0FF', '#9FD0FF', .7, 0, .5, .5, .5)}
    ${rad('kit-glow-warm', '#FFF2C0', '#FF9A3D', 1, 0, .5, .5, .5)}${rad('kit-shade', '#000', '#000', 0, .32, .35, .3)}
    <filter id="kit-rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
    <filter id="kit-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-opacity=".22"/></filter>
    <filter id="kit-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs></svg>`;

  // ---------- overlays ----------
  function overlay(o, sc, svgLayer) {
    const x = o.x != null ? o.x : W / 2, y = o.y != null ? o.y : Math.round(H * 0.78), rot = o.rot || 0;
    const place = (el, defEnter, defDur) => {
      el.style.left = x + 'px'; el.style.top = y + 'px';
      return enter(el, o, defEnter, 0.2, defDur || 0.4, o.anchor === 'left' ? 'translate(0,-50%)' : 'translate(-50%,-50%)', rot);
    };
    switch (o.type) {
      case 'art': obj(o, sc, { w: 400, motion: 'none', shadow: false }); break;
      case 'chip': { const e = h('div', 'ov chip ' + (o.style || ''), sc, esc(o.text)); place(e, 'pop', 0.35); sfx('pop', T(o.at, 0.2), 0.18); break; }
      case 'stamp': {
        const e = h('div', 'ov stamp ' + (o.size || ''), sc, esc(o.text));
        const a = place(e, 'slam', 0.22);
        if (!o.sfx) sfx('impact', a.t0 + 0.2, 0.6);
        A(S._shaker, 'shake', a.t0 + 0.2, 0.28, { amp: 14 });
        break;
      }
      case 'tag': { const e = h('div', 'ov tag ' + (o.style || ''), sc); if (o.kicker) h('small', '', e, esc(o.kicker)); h('span', '', e, esc(o.text)); place(e, 'slideL', 0.45); sfx('swish', T(o.at, 0.2), 0.25); break; }
      case 'caption': { const e = h('div', 'ov cap', sc, esc(o.text)); place(e, 'fade', 0.5); break; }
      case 'big': { const e = h('div', 'ov big ' + (o.style || ''), sc, esc(o.text)); if (o.size) e.style.fontSize = o.size + 'px'; place(e, 'pop', 0.35); break; }
      case 'counter': {
        const e = h('div', 'ov big ' + (o.style || 'red'), sc); if (o.size) e.style.fontSize = o.size + 'px';
        const a = place(e, 'pop', 0.3);
        const m = String(o.value).match(/^([^\d]*)([\d,.]+)(.*)$/);
        const indian = /\d,\d\d,\d{3}/.test(m[2]);
        A(e, 'count', a.t0, o.count_dur || 1, { from: 0, to: parseFloat(m[2].replace(/,/g, '')), prefix: m[1], suffix: m[3], fmt: new Intl.NumberFormat(indian ? 'en-IN' : 'en-US') });
        break;
      }
      case 'terminal': terminal(o, sc, o); break;
      case 'labfile': labfile(o, sc); break;
      case 'progress': {
        const e = h('div', 'ov prog-ov', sc, esc(o.text || '')); const fill = h('i', '', h('div', 'tr', e));
        if (o.color) fill.style.background = o.color;
        const a = place(e, 'fadeUp', 0.35);
        A(fill, 'width', o.fill_at != null ? T(o.fill_at) : a.t0 + 0.3, o.fill_dur || 1.6, { from: (o.from || 0) * 100, to: (o.value != null ? o.value : 0.7) * 100 });
        break;
      }
      case 'callout': case 'circle': {
        const r = o.r || 90;
        const c = sv('circle', { cx: x, cy: y, r, fill: 'none', stroke: o.color || 'var(--accent)', 'stroke-width': o.stroke || 8 }, svgLayer);
        S._layout.push(() => { const len = 2 * Math.PI * r; c.style.strokeDasharray = len; c.style.strokeDashoffset = len; A(c, 'draw', T(o.at, 0.3), 0.5, { len }); });
        if (!o.sfx) sfx('ding', T(o.at, 0.3) + 0.35, 0.16);
        if (o.text) { const e = h('div', 'ov chip red', sc, esc(o.text)); e.style.left = (o.tx != null ? o.tx : x) + 'px'; e.style.top = (o.ty != null ? o.ty : y + r + 50) + 'px'; enter(e, { at: o.label_at != null ? o.label_at : o.at, enter: 'pop' }, 'pop', 0.5, 0.3, 'translate(-50%,-50%)', 0); }
        break;
      }
      case 'arrow': {
        const x1 = o.x1, y1 = o.y1, x2 = o.x2, y2 = o.y2;
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18, my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
        const ang = Math.atan2(y2 - my, x2 - mx), L = 34;
        const d = `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2} M${x2 - L * Math.cos(ang - 0.45)} ${y2 - L * Math.sin(ang - 0.45)} L${x2} ${y2} L${x2 - L * Math.cos(ang + 0.45)} ${y2 - L * Math.sin(ang + 0.45)}`;
        const p = sv('path', { d, fill: 'none', stroke: o.color || 'var(--accent)', 'stroke-width': o.stroke || 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': o.dashed ? '18 14' : '' }, svgLayer);
        S._layout.push(() => { if (o.dashed) { A(p, 'in', T(o.at, 0.3), 0.6, { style: 'fade', pre: '', rot: 0 }); return; } const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; A(p, 'draw', T(o.at, 0.3), o.dur || 0.6, { len }); });
        break;
      }
      case 'ecg': {
        const w = o.w || 820, x0 = x - w / 2; let d = `M${x0} ${y}`;
        const beats = o.beats || 3;
        for (let b = 0; b < beats; b++) { const bx = x0 + (b + 0.5) * w / beats; d += ` L${bx - 60} ${y} L${bx - 40} ${y - 20} L${bx - 25} ${y + 10} L${bx - 8} ${y - 110} L${bx + 10} ${y + 70} L${bx + 26} ${y} `; }
        d += ` L${x0 + w} ${y}`;
        const p = sv('path', { d, fill: 'none', stroke: o.color || 'var(--accent)', 'stroke-width': 6, 'stroke-linejoin': 'round' }, svgLayer);
        S._layout.push(() => { const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; A(p, 'draw', T(o.at, 0.2), o.dur || 1.6, { len }); });
        break;
      }
      case 'path': {   // free-form drawn path in canvas coordinates
        const p = sv('path', { d: o.d, fill: 'none', stroke: o.color || 'var(--accent)', 'stroke-width': o.stroke || 6, 'stroke-linecap': 'round', 'stroke-dasharray': o.dashed ? '16 14' : '' }, svgLayer);
        S._layout.push(() => { if (o.dashed) { A(p, 'in', T(o.at, 0.2), 0.8, { style: 'wipe', pre: '', rot: 0 }); return; } const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; A(p, 'draw', T(o.at, 0.2), o.dur || 0.9, { len }); });
        break;
      }
      case 'lens': {   // magnifier callout: a circle showing a zoomed part of the main illustration
        const M = S._mainArt; if (!M) break;
        const r = o.r || 170, zoom = o.zoom || 2.6, fx = o.fx != null ? o.fx : 0.5, fy = o.fy != null ? o.fy : 0.5, sr0 = o.src_r || 46;
        const lens = h('div', 'lens', sc); lens.style.width = lens.style.height = 2 * r + 'px'; lens.style.left = x + 'px'; lens.style.top = y + 'px';
        const src = M.el.querySelector('.clean').innerHTML
          .replace(/id="([^"]+)"/g, 'id="lz_$1"').replace(/#([A-Za-z0-9_-]+)\)/g, (m, id) => (/^(kit-|cf-)/.test(id) ? m : '#lz_' + id + ')'));
        const inner = h('div', 'lens-in', lens, src);
        const ring = sv('circle', { r: sr0, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 7 }, svgLayer);
        const link = sv('line', { stroke: 'var(--accent)', 'stroke-width': 4, 'stroke-dasharray': '10 8' }, svgLayer);
        const ta = T(o.at, 0.6);
        S._layout.push(() => {
          const sr = stage.getBoundingClientRect(), ar = M.el.querySelector('.clean').getBoundingClientRect();
          const w = ar.width * zoom, hh = ar.height * zoom;
          inner.style.width = w + 'px'; inner.style.left = (r - fx * w) + 'px'; inner.style.top = (r - fy * hh) + 'px';
          const sx = ar.left - sr.left + fx * ar.width, sy = ar.top - sr.top + fy * ar.height;
          ring.setAttribute('cx', sx); ring.setAttribute('cy', sy);
          const ang = Math.atan2(y - sy, x - sx);
          link.setAttribute('x1', sx + Math.cos(ang) * sr0); link.setAttribute('y1', sy + Math.sin(ang) * sr0);
          link.setAttribute('x2', x - Math.cos(ang) * r); link.setAttribute('y2', y - Math.sin(ang) * r);
          const L = 2 * Math.PI * sr0; ring.style.strokeDasharray = L; ring.style.strokeDashoffset = L; A(ring, 'draw', ta, 0.4, { len: L });
        });
        A(link, 'in', ta + 0.3, 0.3, { style: 'fade', pre: '', rot: 0 });
        A(lens, 'in', ta + 0.35, 0.45, { style: 'pop', pre: 'translate(-50%,-50%)', rot: 0 });
        sfx('ding', ta + 0.4, 0.2);
        if (o.text) { const e = h('div', 'ov chip red', sc, esc(o.text)); e.style.left = x + 'px'; e.style.top = (y + r + 40) + 'px'; A(e, 'in', ta + 0.7, 0.3, { style: 'pop', pre: 'translate(-50%,-50%)', rot: 0 }); }
        break;
      }
      case 'pins': {   // map / diagram pins that drop in with labels
        (o.items || []).forEach((p, i) => {
          const pin = h('div', 'pin', sc, '<svg viewBox="0 0 40 56"><path d="M20 54 C 8 34, 2 26, 2 19 A 18 18 0 1 1 38 19 C 38 26, 32 34, 20 54 Z" fill="var(--accent)" stroke="#2b2420" stroke-width="2.5"/><circle cx="20" cy="19" r="7" fill="#fff"/></svg>' + (p.label ? '<span>' + esc(p.label) + '</span>' : ''));
          pin.style.left = p.x + 'px'; pin.style.top = p.y + 'px';
          const ti = p.at != null ? T(p.at) : T(o.at, 0.3) + i * (o.stagger || 0.45);
          A(pin, 'in', ti, 0.5, { style: 'drop', pre: 'translate(-50%,-100%)', rot: 0 }); sfx('pop', ti + 0.35, 0.22);
        });
        break;
      }
      case 'ransom': {   // letters cut from different papers, stuck down one per frame
        const r = h('div', 'ov ransom', sc);
        r.style.left = (o.x != null ? o.x : W / 2) + 'px'; r.style.top = (o.y != null ? o.y : Math.round(H * 0.5)) + 'px';
        if (o.align !== 'left') r.style.transform = 'translateX(-50%)';
        const size = o.size || 130, t0 = T(o.at, 0.1), every = o.every || 1 / 30;
        const looks = ['rn-a', 'rn-b', 'rn-c', 'rn-d', 'rn-e'];
        [...String(o.text || '')].forEach((ch, i) => {
          if (ch === ' ') { h('span', 'rn-sp', r).style.width = size * 0.35 + 'px'; return; }
          const L = h('span', 'rn ' + looks[(i * 3 + 1) % looks.length], r, esc(ch));
          L.style.fontSize = (size * (0.9 + rnd(i * 7.3 + size) * 0.22)).toFixed(0) + 'px';
          const rot = (rnd(i * 3.1 + 2) - 0.5) * 12, dy = (rnd(i * 5.7 + 4) - 0.5) * size * 0.18;
          A(L, 'in', t0 + i * every * 2, 0.1, { style: 'stick', pre: `translateY(${dy.toFixed(1)}px)`, rot });
          if (i % 2 === 0) sfx('pop', t0 + i * every * 2, 0.12);
        });
        break;
      }
      case 'flash': { const f = h('div', 'flash', sc); A(f, 'flash', T(o.at, 0), o.dur || 0.25, { max: o.max || 0.85 }); cue(o.sfx || 'boom', T(o.at, 0), o.sfx_vol != null ? o.sfx_vol : 0.45); break; }
      default: console.warn('unknown overlay', o.type);
    }
  }

  // ---------- build ----------
  document.documentElement.style.setProperty('--accent', D.brand.accent || '#C8302A');
  const defs = h('div', '', stage);
  defs.innerHTML = `<svg width="0" height="0" style="position:absolute"><filter id="cf-pixelate" x="0" y="0" width="100%" height="100%">
    <feFlood x="12" y="12" height="2" width="2"/><feComposite width="30" height="30"/><feTile result="a"/>
    <feComposite in="SourceGraphic" in2="a" operator="in"/><feMorphology operator="dilate" radius="15"/></filter>
    <filter id="cf-halftone" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="g"/>
      <feComponentTransfer in="g" result="gc"><feFuncR type="linear" slope="1.28" intercept="-0.1"/><feFuncG type="linear" slope="1.28" intercept="-0.1"/><feFuncB type="linear" slope="1.28" intercept="-0.1"/></feComponentTransfer>
      <feImage href="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6'%3E%3Ccircle cx='3' cy='3' r='1.45' fill='%23151412'/%3E%3C/svg%3E" x="0" y="0" width="6" height="6" result="dot"/>
      <feTile in="dot" result="dots"/>
      <feComposite in="dots" in2="SourceAlpha" operator="in" result="dm"/>
      <feColorMatrix in="dm" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.4 0" result="dm2"/>
      <feBlend in="dm2" in2="gc" mode="multiply"/></filter></svg>` + ART_KIT;

  const TD = { cut: 0, whip: 0.3, slide: 0.42, zoom: 0.34, glitch: 0.24, flash: 0.22, page: 0.5, scribble: 0.62 };
  const TSFX = { whip: 'whoosh', slide: 'paper', zoom: 'whoosh_low', glitch: 'glitch', flash: 'boom', page: 'paper', scribble: 'scribble' };
  const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  scenes.forEach((s, i) => {
    S = s; s._anims = []; s._conts = []; s._layout = []; s._pencils = []; s._shk = { x: 0, y: 0 }; s._boil = [];
    const sc = h('div', 'scene theme-' + s.theme, stage);
    s._el = sc;
    const shaker = h('div', 'shaker', sc); s._shaker = shaker;
    const bg = h('div', 'bg', shaker); s._bg = bg;
    // transition into this scene
    const prev = scenes[i - 1];
    let tr = s.transition || D.transition || 'auto';
    if (tr === 'auto') tr = !prev ? 'cut' : prev.theme !== s.theme ? (D.finish === 'collage' ? 'scribble' : s.theme === 'dark' ? 'glitch' : 'whip') : 'cut';
    s._tr = TD[tr] != null ? tr : 'cut'; s._td = prev ? TD[s._tr] : 0;
    if (s._tr === 'scribble' && prev) {      // marker scribble that covers the old scene, then wipes off
      const rows = 7, bh = H / rows; let d = `M ${-80} ${bh * 0.4}`;
      for (let k = 0; k < rows; k++) {
        const y = bh * (k + 0.5), x0 = k % 2 ? W + 80 : -80, x1 = k % 2 ? -80 : W + 80, teeth = 5;
        for (let j = 1; j <= teeth; j++) { const x = x0 + (x1 - x0) * j / teeth; d += ` L ${x.toFixed(0)} ${(y + (j % 2 ? -bh * 0.35 : bh * 0.35) + (rnd(i * 9 + k * 5 + j) - 0.5) * 40).toFixed(0)}`; }
      }
      const svg = sv('svg', { class: 'scrib', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, sc);
      const pth = sv('path', { d, fill: 'none', stroke: s.transition_color || D.transition_color || 'var(--paint)', 'stroke-width': bh * 1.55, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      sc._scrib = { svg, pth, len: 0 };
      s._layout.push(() => { sc._scrib.len = pth.getTotalLength(); pth.style.strokeDasharray = sc._scrib.len; pth.style.strokeDashoffset = sc._scrib.len; });
    }
    if (prev && s.cut_sfx !== false) {
      if (TSFX[s._tr]) sfx(TSFX[s._tr], s.start - (s._tr === 'whip' ? 0.08 : 0), 0.4);
      else sfx('swish', s.start, 0.16);
      if (s.theme === 'dark' && prev.theme !== 'dark') sfx('braam', s.start, 0.22);
    }
    // film life on dark scenes: dust specks, a scratch, light flicker
    s._specks = [];
    if (s.theme === 'dark' && D.film_fx !== false && s.film_fx !== false) {
      for (let k = 0; k < 22; k++) { const d = h('i', 'speck', sc); const sz = 2 + rnd(i * 50 + k) * 4; d.style.width = d.style.height = sz + 'px'; s._specks.push({ el: d, a: rnd(i * 91 + k), b: rnd(i * 37 + k * 3), c: rnd(i * 13 + k * 7) }); }
      s._scratch = h('i', 'scratch', sc);
    }
    // scene-level sound cues and ambience
    (s.sfx || []).forEach(c => cue(c, T(c.at, 0), 0.5));
    if (s.ambience) cue(Object.assign({ loop: true, dur: s.dur, vol: 0.22 }, typeof s.ambience === 'string' ? { type: s.ambience } : s.ambience), s.start, 0.22);
    if (s.theme === 'photo' && s.bg_image) {
      const im = h('img', 'photo', bg); im.src = s.bg_image;
      C(im, s.bg_motion || 'kenburns', { amt: 0.09 });
      h('div', 'photo-shade', bg);
    }
    if (s.theme !== 'photo') {
      const holes = h('div', 'holes', bg);
      [0.17, 0.33, 0.49, 0.65, 0.81].forEach(f => { const d = h('i', '', holes); d.style.top = (f * H) + 'px'; });
      if (s.theme === 'dark') h('div', 'sprocket', bg);
    }
    if (s.chrome !== false && s.theme !== 'photo') {
      const m = h('div', 'meta', shaker);
      h('span', '', m, esc(s.section || ''));
      h('span', '', m, s.fig ? 'FIG. ' + s.fig : '');
      h('div', 'brand', shaker, esc(D.brand.name || ''));
    }
    headline(s, shaker);
    const v = s.visual || { type: 'none' };
    (V[v.type] || V.none)(v, shaker);
    const svgLayer = sv('svg', { class: 'ovsvg', viewBox: `0 0 ${W} ${H}` }, shaker);
    (s.overlays || []).forEach(o => overlay(o, shaker, svgLayer));
    s._grain = h('div', 'grain', sc);
  });
  S = null;

  // ---------- ready: fonts, images, layout pass ----------
  window.__ready = (async () => {
    try {
      await Promise.all(['400 100px Anton', '500 30px "JetBrains Mono"', '600 30px "JetBrains Mono"', '700 60px Caveat', '600 40px Caveat']
        .map(f => document.fonts.load(f).catch(() => null)));
      await document.fonts.ready;
    } catch (e) { /* fall back to system fonts */ }
    await Promise.all([...document.images].map(im => im.decode ? im.decode().catch(() => null) : null));
    // any image that failed to load → swap in its hand-drawn fallback (or hide it cleanly)
    document.querySelectorAll('.obj').forEach(w => {
      const im = w.querySelector('.clean img'); if (!im || (im.complete && im.naturalWidth > 0)) return;
      const fb = w._fallback;
      w.querySelectorAll('.clean,.pix').forEach(c => { c.innerHTML = fb || ''; });
      w.classList.remove('feather'); w.style.mixBlendMode = '';
      window.__fallbacks = (window.__fallbacks || 0) + 1;
    });
    for (const s of scenes) {
      S = s; s._el.style.display = 'block';
      if (s.stop_motion != null ? s.stop_motion : D.stop_motion) s._boil = [...s._el.querySelectorAll('.obj,.ov,.hl,.backing')];
      for (const f of s._layout) f();
      s._el.style.display = 'none';
    }
    S = null;
    if (subsEl) {
      const base = SUB.y || 1500, hgt = (SUB.size || 60) * 2.5;
      const cands = [base, base - 150, base - 300, base + 120, 1180];
      for (const s of scenes) {
        window.__seek(Math.max(s.start, s.end - 0.06));
        const rects = [...s._el.querySelectorAll('.ov,.term,.labfile,.np-row,.stat .num,.stat .lab,.bar-row,.end > *')]
          .map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
        s._subY = cands.find(y => !rects.some(r => r.bottom > y - 6 && r.top < y + hgt)) ?? base;
      }
      for (const s of scenes) s._el.style.display = 'none';
    }
    events.sort((a, b) => a.t - b.t);
    return true;
  })();

  // ---------- per-frame ----------
  function camera(s, t) {
    const q = clamp((t - s.start) / s.dur, 0, 1), mode = s.camera || D.camera || 'push';
    switch (mode) {
      case 'push': return `scale(${1 + 0.035 * E.io(q)})`;
      case 'pull': return `scale(${1.04 - 0.035 * E.io(q)})`;
      case 'pan': return `scale(1.05) translateX(${(0.5 - q) * 30}px)`;
      case 'tilt': return `scale(1.05) translateY(${(0.5 - q) * 40}px)`;
      case 'drift': return `scale(1.03) translate(${Math.sin(t * 0.5) * 8}px,${Math.cos(t * 0.4) * 6}px)`;
      case 'crash': return `scale(${1 + 0.12 * Math.exp(-6 * q)})`;
      default: return '';
    }
  }
  function frame(s, t) {
    s._shk.x = 0; s._shk.y = 0;
    // stop-motion: hold every pose for N frames (2 = "on twos"), like paper animated by hand.
    // Texture (grain, dust) keeps moving every frame, so it still feels alive.
    const sm = s.stop_motion != null ? s.stop_motion : D.stop_motion;
    const ts = sm ? s.start + Math.floor((t - s.start) * 30 / sm + 1e-6) * sm / 30 : t;
    for (const a of s._anims) apply(a, ts, s);
    for (const c of s._conts) applyC(c, ts, s);
    for (const p of s._pencils) applyPencil(p, ts);
    if (sm && s._boil.length) {               // boil: hand-placed pieces shift a hair every 0.2 s
      const st = Math.floor((t - s.start) * 5);
      s._boil.forEach((el, k) => { el.style.translate = `${((rnd(st * 31 + k * 7) - 0.5) * 3).toFixed(2)}px ${((rnd(st * 17 + k * 11) - 0.5) * 3).toFixed(2)}px`; el.style.rotate = `${((rnd(st * 13 + k * 5) - 0.5) * 0.6).toFixed(2)}deg`; });
    }
    s._shaker.style.transform = `translate(${s._shk.x}px,${s._shk.y}px) ${camera(s, ts)}`;
    const f = Math.floor(t * 24);                       // living grain: re-seed texture every frame
    s._grain.style.backgroundPosition = `${Math.floor(rnd(f) * 260)}px ${Math.floor(rnd(f + 7) * 260)}px`;
    if (s._specks.length) {
      for (const k of s._specks) {
        const y = ((k.b * H - (t - s.start) * (25 + k.c * 60)) % H + H) % H;
        const x = k.a * W + Math.sin(t * 0.7 + k.b * 9) * 25;
        k.el.style.transform = `translate(${x}px,${y}px)`;
        k.el.style.opacity = rnd(f * 3 + k.a * 999) < 0.55 ? 0 : 0.15 + 0.4 * k.c;
      }
      const sx = rnd(Math.floor(t * 6) + s.start * 10);
      s._scratch.style.left = (sx * W) + 'px'; s._scratch.style.opacity = sx < 0.35 ? 1 : 0;
      s._bg.style.filter = `brightness(${1 + 0.05 * (rnd(f + 3) - 0.5)})`;
    }
  }
  function transition(type, A_, B, p, t) {
    const e = E.io(p);
    switch (type) {
      case 'whip': { const b = Math.sin(p * Math.PI) * 22;
        A_.style.transform = `translateX(${-e * W}px)`; B.style.transform = `translateX(${(1 - e) * W}px)`;
        A_.style.filter = B.style.filter = `blur(${b}px)`; break; }
      case 'slide': case 'page':
        B.style.transform = `translateY(${(1 - E.out(p)) * H}px) rotate(${(1 - E.out(p)) * (type === 'page' ? 6 : 0)}deg)`;
        B.style.boxShadow = '0 -30px 60px rgba(0,0,0,.35)'; A_.style.filter = `brightness(${1 - 0.4 * p})`; break;
      case 'zoom':
        A_.style.transform = `scale(${1 + e * 0.6})`; A_.style.opacity = 1 - e; A_.style.filter = `blur(${e * 12}px)`;
        B.style.transform = `scale(${0.82 + 0.18 * e})`; B.style.opacity = e; break;
      case 'glitch': {
        const f = Math.floor(t * 30), j = (rnd(f) - 0.5) * 60;
        const showB = p > 0.55 || f % 2 === 0;
        const rgb = `drop-shadow(${8 + j / 6}px 0 0 rgba(255,0,60,.75)) drop-shadow(${-8 - j / 6}px 0 0 rgba(0,220,255,.75))`;
        B.style.opacity = showB ? 1 : 0; B.style.transform = `translateX(${(1 - p) * j}px)`; B.style.filter = p < 0.9 ? rgb : '';
        A_.style.transform = `translateX(${-j}px)`; A_.style.filter = rgb;
        if (p < 0.6 && f % 3 === 1) { const a = rnd(f + 1) * 70; B.style.clipPath = `inset(${a}% 0 ${Math.max(0, 85 - a - rnd(f + 2) * 25)}% 0)`; B.style.opacity = 1; }
        break; }
      case 'flash': A_.style.opacity = 0; B.style.filter = `brightness(${1 + (1 - E.out(p)) * 3})`; break;
      case 'scribble': {
        const sc_ = B._scrib, cover = 0.55, step = Math.floor(p * 20) / 20;     // drawn on twos
        if (!sc_) break;
        const sh = B.querySelector('.shaker');
        if (step < cover) {
          sh.style.visibility = 'hidden';
          sc_.pth.style.strokeDashoffset = sc_.len * (1 - E.io(step / cover));
          sc_.svg.style.clipPath = 'none';
        } else {
          A_.style.opacity = 0; sh.style.visibility = '';
          sc_.svg.style.clipPath = 'none';           // the marker retracts along its own stroke, revealing the scene
          sc_.pth.style.strokeDashoffset = -sc_.len * E.io((step - cover) / (1 - cover));
        }
        break; }
    }
  }
  // ---------- burned-in subtitles (one layer over all scenes) ----------
  const SUB = D.subtitles && D.subtitles.burn ? D.subtitles : null;
  let subsEl = null, subCur = null;
  if (SUB && (D.subs || []).length) {
    subsEl = h('div', 'subs ' + (SUB.style || 'word'), stage);
    subsEl.style.top = (SUB.y || 1500) + 'px';
    if (SUB.size) subsEl.style.fontSize = SUB.size + 'px';
  }
  function drawSubs(t) {
    if (!subsEl) return;
    const c = D.subs.find(x => t >= x.t0 && t < x.t1 + 0.12) || null;
    if (c !== subCur) {
      subCur = c;
      if (c) { const sc = scenes.find(x => c.t0 + 0.06 >= x.start && c.t0 + 0.06 < x.end) || scenes[0]; subsEl.style.top = (sc._subY || SUB.y || 1500) + 'px'; }
      subsEl.innerHTML = c ? '<span class="sl">' + c.words.map(w => '<i>' + esc(w.w) + '</i>').join(' ') + '</span>' : '';
    }
    if (!c) return;
    const ws = subsEl.querySelectorAll('i');
    c.words.forEach((w, i) => { ws[i].className = t >= w.s ? (t < w.e + 0.05 ? 'on now' : 'on') : ''; });
    const p = clamp((t - c.t0) / 0.14, 0, 1);
    subsEl.firstChild.style.transform = `scale(${0.92 + 0.08 * E.back(p)})`; subsEl.firstChild.style.opacity = p;
  }

  // ---------- safe-zone check (platform UI covers these areas) ----------
  window.__safeCheck = function () {
    const Z = WIDE
      ? [{ n: 'player controls / progress bar', x0: 0, y0: H - 110, x1: W, y1: H }, { n: 'channel watermark corner', x0: W - 200, y0: H - 230, x1: W, y1: H - 110 }]
      : [{ n: 'top bar', x0: 0, y0: 0, x1: 1080, y1: 120 }, { n: 'caption / username area', x0: 0, y0: 1660, x1: 1080, y1: 1920 },
         { n: 'like / comment / share buttons', x0: 970, y0: 1040, x1: 1080, y1: 1660 }];
    const out = [];
    const hit = (r, z) => Math.max(0, Math.min(r.right, z.x1) - Math.max(r.left, z.x0)) * Math.max(0, Math.min(r.bottom, z.y1) - Math.max(r.top, z.y0));
    for (const s of scenes) {
      window.__seek(Math.max(s.start, s.end - 0.06));
      s._el.querySelectorAll('.hl,.ov,.term,.labfile,.stat .num,.notepad,.bars,.end .follow,.end .next,.obj .clean > *').forEach(el => {
        const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).opacity === '0') return;
        const isArt = el.closest('.obj'); const area = r.width * r.height;
        for (const z of Z) { const a = hit(r, z); if (a > (isArt ? area * 0.2 : area * (z.x0 > 900 ? 0.08 : 0.03))) out.push({ scene: s.id, zone: z.n, what: (isArt ? 'illustration' : (el.innerText || el.className).replace(/\s+/g, ' ').trim().slice(0, 40)) }); }
      });
      if (subsEl) {                                           // overlays fighting with subtitles
        const sy = s._subY || SUB.y || 1500, band = { x0: 60, x1: 1020, y0: sy - 4, y1: sy + (SUB.size || 60) * 2.4 };
        s._el.querySelectorAll('.ov,.term,.labfile').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && hit(r, band) > 0) out.push({ scene: s.id, zone: 'subtitle band', what: (el.innerText || el.className).replace(/\s+/g, ' ').trim().slice(0, 40) }); });
      }
    }
    return out;
  };

  window.__seek = function (t) {
    let idx = scenes.findIndex(x => t >= x.start && t < x.end);
    if (idx < 0) idx = t < 0 ? 0 : scenes.length - 1;
    const s = scenes[idx], prev = scenes[idx - 1];
    const inTr = !!(prev && s._td > 0 && t < s.start + s._td);
    for (const x of scenes) {
      const vis = x === s || (inTr && x === prev);
      x._el.style.display = vis ? 'block' : 'none';
      if (vis) { const st = x._el.style; st.transform = st.filter = st.opacity = st.clipPath = st.boxShadow = ''; st.zIndex = x === s ? 2 : 1; }
      if (x._el._scrib) { x._el._scrib.svg.style.clipPath = 'inset(0 0 0 101%)'; const sh = x._el.querySelector('.shaker'); if (sh) sh.style.visibility = ''; }
    }
    frame(s, t);
    if (inTr) { frame(prev, t); transition(s._tr, prev._el, s._el, (t - s.start) / s._td, t); }
    drawSubs(t);
    return s.id;
  };
})();
