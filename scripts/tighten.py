"""Tighten voiceover clips: shorten long pauses to `keep` seconds, then speed speech up by `tempo` (pitch kept).
Word timings are remapped piecewise, so word-synced animation stays in sync.

    python tighten.py <project> [tempo=1.14] [keep=0.24] [min_sil=0.32]

Idempotent: each clip records {"tight": [keep, tempo]} in build/timings.json, and a pristine copy is kept in
build/vo_raw/, so it can be re-run with new numbers (it always starts again from the original clip). Clips that
voiceover.py regenerates come back without the marker and are backed up fresh.
ElevenLabs pacing is usually too slow for reels: 1.10-1.16 with keep 0.22-0.28 is the usual range.
Set voice.tighten = [tempo, keep] (settings or reel.json) to have voiceover.py run this automatically."""
import json, os, re, shutil, subprocess, sys
for _s in (sys.stdout, sys.stderr):          # Urdu / Hindi scene names must not crash a cp1252 Windows console
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def dur_of(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", p],
                                capture_output=True, text=True).stdout)


def tighten(proj, tempo=1.14, keep=0.24, min_sil=0.32, quiet=False):
    tempo = min(2.0, max(0.5, float(tempo)))
    tp = os.path.join(proj, "build", "timings.json")
    if not os.path.exists(tp):
        sys.exit("no build/timings.json: run voiceover.py first")
    raw_dir = os.path.join(proj, "build", "vo_raw")
    os.makedirs(raw_dir, exist_ok=True)
    T = json.load(open(tp, encoding="utf-8"))
    for sid, sc in T["scenes"].items():
        if not sc.get("file"):
            continue
        mp3 = os.path.join(proj, sc["file"])
        if not os.path.exists(mp3):
            continue
        raw = os.path.join(raw_dir, os.path.basename(mp3))
        rawj = raw + ".json"
        if sc.get("tight") == [keep, tempo] and os.path.exists(raw):
            continue
        if not sc.get("tight") or not os.path.exists(raw):          # fresh clip from voiceover.py -> back it up
            shutil.copy(mp3, raw)
            json.dump({"words": sc["words"], "duration": sc["duration"]}, open(rawj, "w", encoding="utf-8"), ensure_ascii=False)
        base = json.load(open(rawj, encoding="utf-8"))
        D = dur_of(raw)
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", raw, "-af", f"silencedetect=noise=-38dB:d={min_sil}", "-f", "null", "-"],
                           capture_output=True, text=True).stderr
        st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r)]
        en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r)]
        sil = []
        for a, b in zip(st, en):
            a = max(a, 0.0)
            if a < 0.05:               # leading silence: trim to 0.05
                sil.append((0.0, b, 0.05))
            elif b >= D - 0.02:        # trailing silence: trim to 0.12
                sil.append((a, b, 0.12))
            else:
                sil.append((a, b, keep))
        segs, cur = [], 0.0            # keep-segments in the source timeline
        for a, b, k in sil:
            if a - cur > 0.001:
                segs.append((cur, a))
            if k > 0:
                segs.append((a, a + k / 2))
                segs.append((b - k / 2, b))
            cur = b
        if D - cur > 0.001:
            segs.append((cur, D))
        segs = [(a, b) for a, b in segs if b - a > 0.0005] or [(0.0, D)]

        def remap(t):
            out = 0.0
            for a, b in segs:
                if t <= a:
                    return out
                if t <= b:
                    return out + (t - a)
                out += b - a
            return out

        sel = "+".join(f"between(t,{a:.4f},{b:.4f})" for a, b in segs)
        tmp = mp3 + ".tmp.mp3"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af",
                        f"aselect='{sel}',asetpts=N/SR/TB,atempo={tempo:.4f}", "-c:a", "libmp3lame", "-b:a", "160k", tmp], check=True)
        os.replace(tmp, mp3)
        sc["duration"] = round(dur_of(mp3), 3)
        sc["words"] = [{"w": w["w"], "s": round(remap(w["s"]) / tempo, 3), "e": round(remap(w["e"]) / tempo, 3)} for w in base["words"]]
        sc["tight"] = [keep, tempo]
        sc.pop("tempo", None)
        if not quiet:
            print(f"  {sid}: {D:.2f}s -> {sc['duration']:.2f}s")
    json.dump(T, open(tp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(s.get("duration", 0) for s in T["scenes"].values())
    print(f"tighten: tempo {tempo}, pauses {keep}s, total speech {total:.1f}s")
    return total


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    a = sys.argv[1:]
    tighten(a[0], float(a[1]) if len(a) > 1 else 1.14, float(a[2]) if len(a) > 2 else 0.24, float(a[3]) if len(a) > 3 else 0.32)
