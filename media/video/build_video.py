#!/usr/bin/env python3
"""
Build the PharmaCore explainer video:
  slides (Pillow, Arabic RTL shaping) + narration (edge-tts, Yemeni Arabic voice) + ffmpeg.

Usage:  python3 build_video.py            -> media/video/explainer.mp4
Deps:   pillow, arabic-reshaper, python-bidi, edge-tts, ffmpeg, Noto Kufi/Sans Arabic fonts
"""
import asyncio, json, os, re, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "frames"; AUDIO = ROOT / "audio"
FRAMES.mkdir(exist_ok=True); AUDIO.mkdir(exist_ok=True)
W, H = 1920, 1080
VOICE = "ar-YE-SalehNeural"   # Yemeni Arabic male; fallback ar-SA-HamedNeural
FONT_B = "/usr/share/fonts/truetype/noto/NotoKufiArabic-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"
FONT_LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

BG, SURFACE, PRIMARY, ACCENT, TEXT, MUTED = "#0F172A", "#1E293B", "#0EA5E9", "#22C55E", "#F8FAFC", "#94A3B8"

def parse_script(md: Path):
    slides = []
    for line in md.read_text(encoding="utf-8").splitlines():
        if not re.match(r"^\|\s*\d+\s*\|", line): continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3: continue
        num, slide, narration = cells[0], cells[1], cells[2]
        parts = [p.strip() for p in slide.split("·")]
        title = re.sub(r"\*\*", "", parts[0]).strip()
        bullets = [re.sub(r"\*\*", "", p) for p in parts[1:]]
        slides.append({"n": int(num), "title": title, "bullets": bullets, "narration": narration})
    return slides

from PIL import features as _pf
_RAQM = _pf.check("raqm")
def ar(text: str) -> str:
    # With libraqm, Pillow shapes Arabic natively; pre-shaping would double-process.
    return text if _RAQM else get_display(arabic_reshaper.reshape(text))
def _dir(text): return "rtl" if (_RAQM and has_arabic(text)) else None

def has_arabic(s): return bool(re.search(r"[\u0600-\u06FF]", s))

_LATIN_CACHE = {}
def _latin_font(size, bold=False):
    key=(size,bold)
    if key not in _LATIN_CACHE:
        path = FONT_LATIN.replace("DejaVuSans.ttf","DejaVuSans-Bold.ttf") if bold else FONT_LATIN
        _LATIN_CACHE[key] = ImageFont.truetype(path, int(size*0.92))
    return _LATIN_CACHE[key]

_AR_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
_LAT_RE = re.compile(r"[A-Za-z]")
def _runs(text):
    """Split into (text, is_arabic) runs. Arabic letters -> Arabic font (raqm RTL);
    everything else (Latin, digits, symbols) -> Latin font. Spaces attach to the current run.
    Runs are placed sequentially right-to-left, which preserves visual order for RTL lines."""
    runs=[]; cur=""; cur_ar=None
    for ch in text:
        if ch == " " and cur_ar is not None:
            cur += ch; continue
        kind = bool(_AR_RE.match(ch))
        if cur_ar is None: cur, cur_ar = ch, kind
        elif kind == cur_ar: cur += ch
        else: runs.append((cur, cur_ar)); cur, cur_ar = ch, kind
    if cur: runs.append((cur, cur_ar))
    return runs

def _measure(d, text, font):
    """Width of mixed text drawn run-by-run."""
    total=0
    for run, is_ar in _runs(text):
        f = font if is_ar else _latin_font(font.size, "Bold" in font.path)
        kw = {"direction":"rtl"} if (is_ar and _RAQM) else {}
        total += d.textlength(run, font=f, **kw)
    return total

def draw_rtl_text(d, xy_right, text, font, fill):
    """Draw mixed Arabic/Latin text right-aligned at (x_right, y), RTL run order."""
    x, y = xy_right
    for run, is_ar in _runs(text):
        f = font if is_ar else _latin_font(font.size, "Bold" in font.path)
        kw = {"direction":"rtl"} if (is_ar and _RAQM) else {}
        shaped = run if (is_ar and _RAQM) or not is_ar else ar(run)
        w = d.textlength(shaped, font=f, **kw)
        base = y + int(font.size * 1.05)   # common baseline for Arabic & Latin runs
        d.text((x - w, base), shaped, font=f, fill=fill, anchor="ls", **kw)
        x -= w

def wrap_rtl(d, text, font, max_w):
    words = text.split(); lines=[]; cur=""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if _measure(d, t, font) <= max_w: cur = t
        else: lines.append(cur); cur = w_
    if cur: lines.append(cur)
    return lines

def render_slide(s, total):
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    # top accent bar + side rail
    d.rectangle([0, 0, W, 10], fill=PRIMARY)
    d.rectangle([W-18, 0, W, H], fill=SURFACE)
    # header
    f_title = ImageFont.truetype(FONT_B, 74 if len(s["title"]) < 30 else 58)
    f_bullet = ImageFont.truetype(FONT_R, 44)
    f_small = ImageFont.truetype(FONT_LATIN, 26)
    f_brand = ImageFont.truetype(FONT_LATIN, 30)
    margin = 110
    # brand
    d.text((margin, 40), "PharmaCore", font=f_brand, fill=PRIMARY)
    d.text((margin, 78), "Pharmacy Management Platform  ·  Project Plan", font=f_small, fill=MUTED)
    # slide counter
    cnt = f"{s['n']:02d} / {total:02d}"
    d.text((W - margin - 40 - d.textlength(cnt, font=f_small), 50), cnt, font=f_small, fill=MUTED)
    # title block
    y = 200
    for line in wrap_rtl(d, s["title"], f_title, W - 2*margin - 40):
        draw_rtl_text(d, (W - margin - 40, y), line, f_title, TEXT); y += f_title.size + 18
    d.rectangle([W - margin - 40 - 260, y + 6, W - margin - 40, y + 14], fill=ACCENT)
    y += 70
    # bullets
    for b in s["bullets"]:
        lines = wrap_rtl(d, b, f_bullet, W - 2*margin - 140)
        # bullet dot
        d.ellipse([W - margin - 40 - 22, y + 22, W - margin - 40 - 2, y + 42], fill=PRIMARY)
        for i, line in enumerate(lines):
            draw_rtl_text(d, (W - margin - 40 - 50, y), line, f_bullet, TEXT if i == 0 else MUTED); y += f_bullet.size + 16
        y += 14
    # footer
    d.rectangle([0, H-70, W, H], fill=SURFACE)
    d.text((margin, H-50), "github.com/moain2028/Pharmacy-System  ·  docs/  ·  AGENTS.md", font=f_small, fill=MUTED)
    out = FRAMES / f"slide_{s['n']:02d}.png"; img.save(out); return out

async def tts(text, out, voice):
    import edge_tts
    await edge_tts.Communicate(text, voice, rate="-5%").save(str(out))

def duration(path):
    r = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","json",str(path)],capture_output=True,text=True)
    return float(json.loads(r.stdout)["format"]["duration"])

def main():
    slides = parse_script(ROOT / "script.md"); total = len(slides)
    print(f"{total} slides")
    segs = []
    for s in slides:
        png = render_slide(s, total)
        mp3 = AUDIO / f"slide_{s['n']:02d}.mp3"
        if not mp3.exists():
            try: asyncio.run(tts(s["narration"], mp3, VOICE))
            except Exception as e:
                print("voice fallback:", e); asyncio.run(tts(s["narration"], mp3, "ar-SA-HamedNeural"))
        dur = duration(mp3) + 0.8
        seg = ROOT / f"seg_{s['n']:02d}.mp4"
        subprocess.run(["ffmpeg","-y","-loglevel","error","-loop","1","-i",str(png),"-i",str(mp3),
                        "-c:v","libx264","-tune","stillimage","-pix_fmt","yuv420p","-r","24",
                        "-c:a","aac","-b:a","160k","-shortest","-t",f"{dur:.2f}",
                        "-af","apad=pad_dur=0.8",str(seg)],check=True)
        segs.append(seg); print(f"  slide {s['n']:02d}: {dur:.1f}s")
    lst = ROOT / "concat.txt"; lst.write_text("".join(f"file '{p.name}'\n" for p in segs))
    out = ROOT / "explainer.mp4"
    subprocess.run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(lst),"-c","copy",str(out)],check=True)
    for p in segs: p.unlink()
    lst.unlink()
    print("OK ->", out, f"{duration(out):.0f}s")

if __name__ == "__main__": main()
