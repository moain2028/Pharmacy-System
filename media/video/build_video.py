#!/usr/bin/env python3
"""
Build the PharmaCore animated explainer (motion graphics + real footage + Arabic narration).

Pipeline
  1. script.md  -> narration per scene (edge-tts, Yemeni Arabic voice) -> audio2/scene_NN.mp3
  2. scenes1.py / scenes2.py -> draw(img, t, T) per scene -> frames rendered in parallel (Pillow + libraqm)
  3. ffmpeg: frames + narration + background music -> explainer.mp4 (1920x1080, 24 fps, h264/aac)

Usage:   python3 build_video.py [--preview]     (--preview renders 12 fps 960x540 quickly)
Deps:    pillow (with raqm), edge-tts, ffmpeg, Noto Kufi/Sans Arabic + DejaVu fonts.
Footage: clips/*.mp4 (AI generated, not committed) -> frames extracted to clipframes/ (see prepare_clips()).
         If clips are missing, scenes fall back to the gradient background automatically.
"""
import asyncio, json, os, re, subprocess, sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AUDIO = ROOT / "audio2"; FRAMES = ROOT / "anim"; CLIPS = ROOT / "clips"
AUDIO.mkdir(exist_ok=True); FRAMES.mkdir(exist_ok=True)
VOICE, VOICE_FALLBACK = "ar-YE-SalehNeural", "ar-SA-HamedNeural"
FPS = 24
PREVIEW = "--preview" in sys.argv
TAIL = 1.0   # seconds of visual hold after narration ends

def parse_script(md: Path):
    rows = []
    for line in md.read_text(encoding="utf-8").splitlines():
        if not re.match(r"^\|\s*\d+\s*\|", line): continue
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(c) < 4: continue
        rows.append({"n": int(c[0]), "name": c[1], "narration": c[3]})
    return rows

async def tts(text, out, voice):
    import edge_tts
    await edge_tts.Communicate(text, voice, rate="-4%").save(str(out))

def ensure_audio(rows):
    async def one(r):
        out = AUDIO / f"scene_{r['n']:02d}.mp3"
        if out.exists(): return
        try: await tts(r["narration"], out, VOICE)
        except Exception as e:
            print("voice fallback:", e); await tts(r["narration"], out, VOICE_FALLBACK)
    async def all_():
        await asyncio.gather(*(one(r) for r in rows))
    asyncio.run(all_())

def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)], capture_output=True, text=True)
    return float(json.loads(r.stdout)["format"]["duration"])

def prepare_clips():
    """Extract 1080p frames (+ blurred variant) from clips/*.mp4 once."""
    for mp4 in sorted(CLIPS.glob("*.mp4")):
        d = ROOT / "clipframes" / mp4.stem
        if not d.exists() or not any(d.iterdir()):
            d.mkdir(parents=True, exist_ok=True)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp4), "-vf", "scale=1920:1080:flags=lanczos", "-q:v", "3", str(d / "%04d.jpg")], check=True)

# ---- frame rendering (worker) ---------------------------------------------------------
_SCENES = None
def _scene_fn(n):
    global _SCENES
    if _SCENES is None:
        import scenes1, scenes2
        _SCENES = {1: scenes1.scene1, 2: scenes1.scene2, 3: scenes1.scene3, 4: scenes1.scene4, 5: scenes1.scene5,
                   6: scenes2.scene6, 7: scenes2.scene7, 8: scenes2.scene8, 9: scenes2.scene9, 10: scenes2.scene10}
    return _SCENES[n]

def render_chunk(args):
    n, T, start_f, end_f, fps, outdir, scale = args
    from PIL import Image
    import anim_lib
    fn = _scene_fn(n)
    for f in range(start_f, end_f):
        t = f / fps
        img = fn(None, t, T)
        anim_lib.bottom_bar(img, t / T)
        img = img.convert("RGB")
        if scale != 1.0:
            img = img.resize((int(1920 * scale), int(1080 * scale)), Image.BILINEAR)
        img.save(outdir / f"{f:05d}.jpg", quality=92, subsampling=0)
    return end_f - start_f

def render_scene(n, T, fps, scale):
    outdir = FRAMES / f"scene_{n:02d}"
    outdir.mkdir(exist_ok=True)
    for old in outdir.glob("*.jpg"): old.unlink()
    total = int(T * fps)
    workers = max(1, os.cpu_count() or 2)
    step = max(1, -(-total // (workers * 3)))
    jobs = [(n, T, s, min(s + step, total), fps, outdir, scale) for s in range(0, total, step)]
    with ProcessPoolExecutor(workers) as ex:
        list(ex.map(render_chunk, jobs))
    return outdir, total

# ---- assembly -------------------------------------------------------------------------
FOOTAGE_AUDIO = {1: ("pharmacy_exterior", 0), 2: ("pharmacy_ledger", 0), 5: ("pharmacy_receiving", 0),
                 6: ("pharmacy_counter", 0), 9: ("pharmacy_stocktake", 0), 10: ("pharmacy_owner", 0)}

def build_segment(n, T, fps, outdir, scale):
    mp3 = AUDIO / f"scene_{n:02d}.mp3"
    seg = ROOT / f"seg_{n:02d}.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(outdir / "%05d.jpg"), "-i", str(mp3)]
    filt = f"[1:a]apad=pad_dur={TAIL + 0.5},atrim=0:{T:.3f},volume=1.0[nar]"
    amix_in = "[nar]"; k = 2
    fa = FOOTAGE_AUDIO.get(n)
    if fa and (CLIPS / f"{fa[0]}.wav").exists():
        cmd += ["-stream_loop", "-1", "-i", str(CLIPS / f"{fa[0]}.wav")]
        filt += f";[{k}:a]atrim=0:{T:.3f},volume=0.25,afade=t=in:d=0.5,afade=t=out:st={max(0, T - 1.5):.2f}:d=1.5[amb]"
        amix_in += "[amb]"; k += 1
    filt += f";{amix_in}amix=inputs={k - 1}:duration=first:normalize=0[a]"
    cmd += ["-filter_complex", filt, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{T:.3f}", str(seg)]
    subprocess.run(cmd, check=True)
    return seg

def main():
    rows = parse_script(ROOT / "script.md")
    print(f"{len(rows)} scenes; preview={PREVIEW}")
    ensure_audio(rows)
    prepare_clips()
    fps = 12 if PREVIEW else FPS
    scale = 0.5 if PREVIEW else 1.0
    only = [int(x) for x in os.environ.get("SCENES", "").split(",") if x]
    segs = []
    for r in rows:
        n = r["n"]
        if only and n not in only: continue
        T = duration(AUDIO / f"scene_{n:02d}.mp3") + TAIL
        outdir, total = render_scene(n, T, fps, scale)
        seg = build_segment(n, T, fps, outdir, scale)
        segs.append(seg); print(f"  scene {n:02d}: {T:.1f}s, {total} frames")
    if only: print("partial build:", [s.name for s in segs]); return
    lst = ROOT / "concat.txt"; lst.write_text("".join(f"file '{p.name}'\n" for p in segs))
    joined = ROOT / "joined.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)], check=True)
    out = ROOT / ("explainer_preview.mp4" if PREVIEW else "explainer.mp4")
    bgm = CLIPS / "bgm_explainer.mp3"
    total = duration(joined)
    if bgm.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(joined), "-stream_loop", "-1", "-i", str(bgm),
                        "-filter_complex", f"[1:a]volume=0.13,afade=t=in:d=2,afade=t=out:st={total - 4:.2f}:d=4[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]",
                        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)], check=True)
        joined.unlink()
    else:
        joined.rename(out)
    for p in segs: p.unlink()
    lst.unlink()
    print("OK ->", out, f"{duration(out):.0f}s")

if __name__ == "__main__": main()
