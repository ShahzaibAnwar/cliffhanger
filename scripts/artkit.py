"""Procedural helpers for drawing reel art in the kit's layered style (references/visual-style.md).

Smooth silhouettes, fur, tapered limbs and the full shading stack come from a few calls, so drawings
come out like engravings instead of hand-placed clip art. Use from a small script in the project:

    import sys; sys.path.insert(0, r"<skill>/scripts")
    from artkit import *

    body = [(150, 250), (300, 200), (450, 230), (500, 320), (300, 370), (160, 330)]
    d = furry_path(body, amp=14, seed=4, skip=lambda x, y: y > 330)    # belly stays smooth
    art = shaded("body", d, "#7D8798",
                 shade=[(380, 360, 200, 80, "kit-hatch"), (420, 380, 120, 50, "kit-hatch-r")],
                 highlight=(280, 230, 110, 22))
    save("art/critter.svg", art, fit_viewbox(body, pad=40))

Then review it:  node scripts/art-preview.mjs <project>/art --dark --sketch

  catmull(pts)          dense points on a smooth Catmull-Rom spline through a few points
  smooth_path(pts)      that spline as an SVG path (closed by default)
  furry_path(pts, ...)  the same silhouette with tufts of fur along the outward normal;
                        skip(x, y) -> True keeps a stretch smooth (belly, face)
  tube(centre, w0, w1)  outline points of a tapering tube along a centre line (limbs, tails);
                        pass them to smooth_path, or furry_path for a bottle-brush tail
  shaded(id, d, base, shade, highlight, details)
                        the kit layering in one call: clip, base fill, hatched shadow, highlight,
                        detail strokes, then the ink outline
  outline(d)            ink outline; furry outlines (> 40 curves) get a thinner line and no
                        kit-rough, or they read as a heavy black smudge
  fit_viewbox(pts)      a viewBox around points plus padding (fur, whiskers and strokes need room)
  save(path, body, vb)  write the SVG

Run `python artkit.py --demo out.svg` for a sample drawing that uses all of them.
"""
import io
import math
import os
import random
import sys

INK = "#2b2420"

__all__ = ["INK", "f1", "catmull", "smooth_path", "furry_path", "tube", "outline", "shaded", "fit_viewbox", "save"]


def f1(v):
    """Compact number: one decimal, no trailing zeros."""
    return f"{v:.1f}".rstrip("0").rstrip(".")


def catmull(pts, closed=True, n=12):
    """Dense points along a Catmull-Rom spline through pts (n points per segment)."""
    out, m = [], len(pts)
    for i in (range(m) if closed else range(m - 1)):
        p0 = pts[(i - 1) % m] if closed or i > 0 else pts[0]
        p1, p2 = pts[i], pts[(i + 1) % m]
        p3 = pts[(i + 2) % m] if closed or i + 2 < m else pts[-1]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    if not closed:
        out.append(tuple(pts[-1]))
    return out


def smooth_path(pts, closed=True):
    d = catmull(pts, closed, 10)
    return "M" + " L".join(f"{f1(x)} {f1(y)}" for x, y in d) + (" Z" if closed else "")


def furry_path(pts, amp=14, every=3, seed=1, closed=True, outward=1, skip=None):
    """Silhouette through pts with tufts of fur sticking out along the outward normal.
    amp: tuft length; every: spline points per tuft (smaller = denser fur); skip(x, y) -> True keeps
    that stretch smooth. outward=-1 flips the tufts inward."""
    rnd = random.Random(seed)
    d = catmull(pts, closed, 16)
    m = len(d)
    area = sum(d[i][0] * d[(i + 1) % m][1] - d[(i + 1) % m][0] * d[i][1] for i in range(m))
    sgn = (1 if area > 0 else -1) * outward          # normals point away from the inside
    segs = [f"M{f1(d[0][0])} {f1(d[0][1])}"]
    i = 0
    while i < m - (0 if closed else 1):
        j = (i + every) if closed else min(i + every, m - 1)
        a, b = d[i % m], d[j % m]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        tx, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = ty / ln * sgn, -tx / ln * sgn
        if skip and skip(mx, my):
            segs.append(f"L{f1(b[0])} {f1(b[1])}")
        else:
            h = amp * (0.6 + 0.6 * rnd.random())
            lean = 0.35 * ln * (rnd.random() - 0.3)
            tip = (mx + nx * h + tx / ln * lean, my + ny * h + ty / ln * lean)
            segs.append(f"Q{f1(a[0] + nx * h * .25)} {f1(a[1] + ny * h * .25)} {f1(tip[0])} {f1(tip[1])}")
            segs.append(f"Q{f1(b[0] + nx * h * .15)} {f1(b[1] + ny * h * .15)} {f1(b[0])} {f1(b[1])}")
        i = j
        if closed and i >= m:
            break
    return " ".join(segs) + (" Z" if closed else "")


def tube(centre, w0, w1, n=8):
    """Outline points of a tube along a centre line, tapering from width w0 to w1."""
    c = catmull(centre, False, n)
    left, right = [], []
    for i, (x, y) in enumerate(c):
        a, b = c[max(i - 1, 0)], c[min(i + 1, len(c) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = -ty / ln, tx / ln
        w = (w0 + (w1 - w0) * i / max(len(c) - 1, 1)) / 2
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left[::2] + right[::-1][::2]


def outline(d, w=None, rough=True, extra=""):
    """Ink outline. Furry outlines (> 40 curves) default to a thinner line without kit-rough."""
    furry = d.count("Q") > 40
    if w is None:
        w = 3.6 if furry else 6
    rf = ' filter="url(#kit-rough)"' if rough and not furry else ""
    return (f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{f1(w)}" stroke-linejoin="round" '
            f'stroke-linecap="round"{rf}{extra}/>')


def shaded(cid, d, base, shade=(), highlight=None, details="", ink=True):
    """The kit layering in one call.
    cid: unique id for the clip; d: silhouette path; base: a colour or "url(#kit-flesh)" etc.
    shade: [(cx, cy, rx, ry, pattern), ...] ellipses on the shadow side (lower right), e.g. kit-hatch
    then kit-hatch-r for the deepest part; highlight: (cx, cy, rx, ry), upper left;
    details: extra SVG drawn inside the clip (stripes, folds, veins; class="draw" draws them on)."""
    hs = "".join(f'<ellipse cx="{f1(cx)}" cy="{f1(cy)}" rx="{f1(rx)}" ry="{f1(ry)}" fill="url(#{pat})"/>'
                 for cx, cy, rx, ry, pat in shade)
    hl = "" if not highlight else (f'<ellipse cx="{f1(highlight[0])}" cy="{f1(highlight[1])}" rx="{f1(highlight[2])}" '
                                   f'ry="{f1(highlight[3])}" fill="#fff" opacity=".3"/>')
    return (f'<clipPath id="{cid}"><path d="{d}"/></clipPath>'
            f'<g clip-path="url(#{cid})"><path d="{d}" fill="{base}"/>{hs}{hl}{details}</g>'
            + (outline(d) if ink else ""))


def fit_viewbox(pts, pad=30):
    """viewBox string around points, with padding for fur, whiskers and outline strokes."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0 = min(xs) - pad, min(ys) - pad
    return f"{f1(x0)} {f1(y0)} {f1(max(xs) + pad - x0)} {f1(max(ys) + pad - y0)}"


def save(path, body, vb, defs=""):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><defs>{defs}</defs>{body}</svg>')
    return path


def demo(path):
    """A furry critter with a bottle-brush tail, tapered legs and an eye: every helper in use."""
    body = [(150, 250), (230, 200), (340, 190), (450, 210), (510, 270), (500, 340), (420, 370), (300, 372), (190, 360), (140, 310)]
    tail = tube([(500, 280), (560, 250), (600, 190), (610, 130)], 46, 30)
    legs = "".join(shaded(f"leg{i}", smooth_path(tube([(x, 340), (x - 4, 400), (x - 10, 440)], 34, 24)), "#6E7787",
                          shade=[(x + 14, 420, 20, 60, "kit-hatch")]) for i, x in enumerate((210, 260, 400, 450)))
    art = (shaded("tail", furry_path(tail, amp=12, every=2, seed=3), "#7D8798", shade=[(610, 200, 30, 120, "kit-hatch")])
           + legs
           + shaded("body", furry_path(body, amp=14, seed=4, skip=lambda x, y: y > 345), "#7D8798",
                    shade=[(380, 360, 200, 80, "kit-hatch"), (430, 380, 120, 50, "kit-hatch-r")],
                    highlight=(280, 230, 110, 22),
                    details=f'<path class="draw" d="M260 220 q 6 40 0 70 M320 210 q 6 44 0 76 M380 214 q 6 44 0 76" fill="none" stroke="#5B6474" stroke-width="9" stroke-linecap="round"/>')
           + f'<circle cx="190" cy="262" r="15" fill="#D9F05A" stroke="{INK}" stroke-width="3.5"/>'
           f'<circle cx="187" cy="262" r="8" fill="#111"/><circle cx="183" cy="257" r="3" fill="#fff"/>')
    return save(path, art, fit_viewbox(body + tail + [(200, 460), (450, 460)], pad=34))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--demo":
        print(demo(sys.argv[2]))
    else:
        print(__doc__)
