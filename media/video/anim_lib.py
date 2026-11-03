#!/usr/bin/env python3
"""
anim_lib — tiny motion-graphics toolkit on top of Pillow (libraqm for Arabic shaping).

Provides: easing, RTL/mixed text rendering with alpha, temporary layers (fade/scale/slide),
vector icons, arrows with progress, real-footage backgrounds (frames extracted by ffmpeg),
and a shared dark background.
"""
import math, re
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, features

ROOT = Path(__file__).resolve().parent
CLIPFRAMES = ROOT / "clipframes"
W, H = 1920, 1080
FPS = 24

FONT_B = "/usr/share/fonts/truetype/noto/NotoKufiArabic-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"
FONT_RB = "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf"
FONT_LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_LATIN_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# palette
BG0, BG1 = (11, 18, 32), (17, 27, 51)
SURFACE = (30, 41, 59)
SURFACE2 = (44, 58, 84)
PRIMARY = (14, 165, 233)     # sky
GREEN = (34, 197, 94)
AMBER = (245, 158, 11)
ROSE = (244, 63, 94)
VIOLET = (139, 92, 246)
TEXT = (248, 250, 252)
MUTED = (148, 163, 184)
WHITE = (255, 255, 255)

_RAQM = features.check("raqm")

# ---------------------------------------------------------------- easing
def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def lerp(a, b, p): return a + (b - a) * p
def prog(t, start, dur):
    """0..1 progress of an animation starting at `start` lasting `dur` seconds."""
    if dur <= 0: return 1.0 if t >= start else 0.0
    return clamp((t - start) / dur)
def ease_out(p): return 1 - (1 - p) ** 3
def ease_in_out(p): return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2
def ease_back(p):
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2
def pulse(t, period=1.6): return 0.5 + 0.5 * math.sin(2 * math.pi * t / period)

def rgba(c, a=255): return (c[0], c[1], c[2], int(a))
def mix(c1, c2, p): return tuple(int(lerp(c1[i], c2[i], p)) for i in range(3))

# ---------------------------------------------------------------- fonts
@lru_cache(maxsize=None)
def font(path, size): return ImageFont.truetype(path, int(size))
def fb(size): return font(FONT_B, size)
def fr(size): return font(FONT_R, size)
def frb(size): return font(FONT_RB, size)
def fl(size, bold=False): return font(FONT_LATIN_B if bold else FONT_LATIN, size)

# ---------------------------------------------------------------- mixed RTL text
_AR_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
def has_arabic(s): return bool(_AR_RE.search(s))

def _runs(text):
    runs = []; cur = ""; cur_ar = None
    for ch in text:
        if ch == " " and cur_ar is not None:
            cur += ch; continue
        kind = bool(_AR_RE.match(ch))
        if cur_ar is None: cur, cur_ar = ch, kind
        elif kind == cur_ar: cur += ch
        else: runs.append((cur, cur_ar)); cur, cur_ar = ch, kind
    if cur: runs.append((cur, cur_ar))
    return runs

def _latin_for(f):
    bold = "Bold" in f.path
    return fl(int(f.size * 0.92), bold)

def measure(text, f):
    d = ImageDraw.Draw(Image.new("L", (4, 4)))
    total = 0
    for run, is_ar in _runs(text):
        ff = f if is_ar else _latin_for(f)
        kw = {"direction": "rtl"} if (is_ar and _RAQM) else {}
        total += d.textlength(run, font=ff, **kw)
    return total

def _draw_rtl(d, x_right, y, text, f, fill):
    x = x_right
    base = y + int(f.size * 1.05)
    for run, is_ar in _runs(text):
        ff = f if is_ar else _latin_for(f)
        kw = {"direction": "rtl"} if (is_ar and _RAQM) else {}
        w = d.textlength(run, font=ff, **kw)
        d.text((x - w, base), run, font=ff, fill=fill, anchor="ls", **kw)
        x -= w

def wrap(text, f, max_w):
    words = text.split(); lines = []; cur = ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if measure(t, f) <= max_w: cur = t
        else:
            if cur: lines.append(cur)
            cur = w_
    if cur: lines.append(cur)
    return lines

_TCACHE = {}
def text_img(text, f, fill=TEXT):
    """RGBA image containing the text (right-aligned, RTL-aware)."""
    key = (text, f.path, f.size, fill)
    if key in _TCACHE: return _TCACHE[key]
    w = int(measure(text, f)) + 12
    h = int(f.size * 1.75)
    layer = Image.new("RGBA", (max(w, 1), h), (0, 0, 0, 0))
    _draw_rtl(ImageDraw.Draw(layer), w - 6, int(f.size * 0.12), text, f, fill)
    if len(_TCACHE) > 600: _TCACHE.clear()
    _TCACHE[key] = layer
    return layer

def blit(base, layer, x, y, alpha=1.0, anchor="rt", scale=1.0):
    """Composite RGBA layer onto base. anchor: 'rt' (x is right), 'lt' (x is left), 'ct' (x is center).
    y is always top.  scale pops around the anchor point."""
    if alpha <= 0.002: return
    if scale != 1.0 and scale > 0:
        nw, nh = max(1, int(layer.width * scale)), max(1, int(layer.height * scale))
        layer = layer.resize((nw, nh), Image.LANCZOS)
    if alpha < 0.998:
        a = layer.getchannel("A").point(lambda v: int(v * alpha))
        layer = layer.copy(); layer.putalpha(a)
    if anchor == "rt": px = x - layer.width
    elif anchor == "ct": px = x - layer.width // 2
    else: px = x
    base.alpha_composite(layer, (int(px), int(y)))

def text(base, s, f, x, y, fill=TEXT, alpha=1.0, anchor="rt", scale=1.0):
    blit(base, text_img(s, f, fill), x, y, alpha, anchor, scale)

def paragraph(base, s, f, x, y, max_w, fill=TEXT, alpha=1.0, anchor="rt", gap=10):
    for line in wrap(s, f, max_w):
        text(base, line, f, x, y, fill, alpha, anchor); y += f.size + gap
    return y

# ---------------------------------------------------------------- layers
class Layer:
    """Temporary transparent canvas; draw then .put() with alpha/scale/offset."""
    def __init__(self, w, h):
        self.w, self.h = int(w), int(h)
        self.img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
    def put(self, base, x, y, alpha=1.0, scale=1.0, anchor="lt"):
        blit(base, self.img, x, y, alpha, anchor, scale)

def rrect(d, box, r, fill=None, outline=None, width=2):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

def card(base, box, alpha=1.0, scale=1.0, fill=SURFACE, outline=None, r=28, glow=None):
    x0, y0, x1, y1 = box
    L = Layer(x1 - x0 + 40, y1 - y0 + 40)
    if glow:
        rrect(L.d, (10, 10, L.w - 10, L.h - 10), r + 8, fill=rgba(glow, 60))
        L.img = L.img.filter(ImageFilter.GaussianBlur(10)); L.d = ImageDraw.Draw(L.img)
    rrect(L.d, (20, 20, L.w - 20, L.h - 20), r, fill=rgba(fill), outline=rgba(outline) if outline else None, width=3)
    if scale != 1.0:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        nw, nh = L.w * scale, L.h * scale
        L.put(base, cx - nw / 2, cy - nh / 2, alpha, scale)
    else:
        L.put(base, x0 - 20, y0 - 20, alpha)

# ---------------------------------------------------------------- arrows / lines
def arrow(base, p1, p2, progress=1.0, color=PRIMARY, width=6, head=22, alpha=1.0, dashed=False):
    if progress <= 0: return
    x1, y1 = p1; x2, y2 = p2
    ex, ey = lerp(x1, x2, progress), lerp(y1, y2, progress)
    minx, miny = min(x1, ex) - head - 10, min(y1, ey) - head - 10
    maxx, maxy = max(x1, ex) + head + 10, max(y1, ey) + head + 10
    L = Layer(maxx - minx, maxy - miny)
    ox, oy = -minx, -miny
    ang = math.atan2(ey - y1, ex - x1)
    if dashed:
        length = math.hypot(ex - x1, ey - y1); n = int(length // 24)
        for i in range(n):
            a = i * 24; b = min(a + 14, length)
            L.d.line([(x1 + ox + math.cos(ang) * a, y1 + oy + math.sin(ang) * a),
                      (x1 + ox + math.cos(ang) * b, y1 + oy + math.sin(ang) * b)], fill=rgba(color), width=width)
    else:
        L.d.line([(x1 + ox, y1 + oy), (ex + ox - math.cos(ang) * head * 0.6, ey + oy - math.sin(ang) * head * 0.6)], fill=rgba(color), width=width)
    if progress > 0.15:
        tip = (ex + ox, ey + oy)
        l = (ex + ox - math.cos(ang) * head - math.sin(ang) * head * 0.55, ey + oy - math.sin(ang) * head + math.cos(ang) * head * 0.55)
        r = (ex + ox - math.cos(ang) * head + math.sin(ang) * head * 0.55, ey + oy - math.sin(ang) * head - math.cos(ang) * head * 0.55)
        L.d.polygon([tip, l, r], fill=rgba(color))
    L.put(base, minx, miny, alpha)

def line(base, pts, color=MUTED, width=3, alpha=1.0):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    minx, miny = min(xs) - width, min(ys) - width
    L = Layer(max(xs) - minx + width, max(ys) - miny + width)
    L.d.line([(x - minx, y - miny) for x, y in pts], fill=rgba(color), width=width, joint="curve")
    L.put(base, minx, miny, alpha)

def dot(base, c, r, color, alpha=1.0):
    L = Layer(r * 2 + 4, r * 2 + 4)
    L.d.ellipse((2, 2, 2 + r * 2, 2 + r * 2), fill=rgba(color))
    L.put(base, c[0] - r - 2, c[1] - r - 2, alpha)

def ring(base, c, r, p, color=PRIMARY, width=18, track=SURFACE2, alpha=1.0):
    L = Layer(r * 2 + width * 2, r * 2 + width * 2)
    box = (width, width, width + 2 * r, width + 2 * r)
    L.d.arc(box, 0, 360, fill=rgba(track), width=width)
    if p > 0: L.d.arc(box, -90, -90 + 360 * clamp(p), fill=rgba(color), width=width)
    L.put(base, c[0] - r - width, c[1] - r - width, alpha)

# ---------------------------------------------------------------- icons (vector, drawn on a Layer)
def icon(base, name, cx, cy, size=80, color=PRIMARY, alpha=1.0, scale=1.0, color2=None, rot=0.0):
    s = size
    L = Layer(s * 1.6, s * 1.6)
    d = L.d; c = rgba(color); c2 = rgba(color2 or mix(color, WHITE, 0.45))
    ox = oy = s * 0.3
    def P(x, y): return (ox + x * s, oy + y * s)
    def R(x0, y0, x1, y1, r=0, fill=c, outline=None, w=3):
        d.rounded_rectangle([P(x0, y0), P(x1, y1)], radius=r * s, fill=fill, outline=outline, width=w)
    lw = max(3, int(s * 0.07))
    if name == "pill":
        d.rounded_rectangle([P(0.05, 0.3), P(0.95, 0.7)], radius=s * 0.2, fill=c2)
        d.pieslice([P(0.05, 0.3), P(0.45, 0.7)], 90, 270, fill=c)
        d.rectangle([P(0.25, 0.3), P(0.5, 0.7)], fill=c)
    elif name == "box":
        d.polygon([P(0.1, 0.3), P(0.5, 0.1), P(0.9, 0.3), P(0.5, 0.5)], fill=c2)
        d.polygon([P(0.1, 0.3), P(0.5, 0.5), P(0.5, 0.95), P(0.1, 0.75)], fill=c)
        d.polygon([P(0.5, 0.5), P(0.9, 0.3), P(0.9, 0.75), P(0.5, 0.95)], fill=mix(color, BG0, 0.35) + (255,))
    elif name == "doc":
        d.polygon([P(0.15, 0.05), P(0.65, 0.05), P(0.85, 0.25), P(0.85, 0.95), P(0.15, 0.95)], fill=c2)
        d.polygon([P(0.65, 0.05), P(0.65, 0.25), P(0.85, 0.25)], fill=c)
        for i, yy in enumerate((0.42, 0.55, 0.68, 0.81)):
            d.line([P(0.27, yy), P(0.73 if i % 2 == 0 else 0.6, yy)], fill=c, width=lw)
    elif name == "cash":
        R(0.05, 0.25, 0.95, 0.75, 0.06, fill=c2)
        d.ellipse([P(0.36, 0.33), P(0.64, 0.67)], fill=c)
        d.rectangle([P(0.12, 0.33), P(0.2, 0.67)], fill=c); d.rectangle([P(0.8, 0.33), P(0.88, 0.67)], fill=c)
    elif name == "coins":
        for i, yy in enumerate((0.7, 0.55, 0.4)):
            d.ellipse([P(0.15, yy - 0.12), P(0.85, yy + 0.12)], fill=c if i % 2 else c2, outline=rgba(BG0), width=2)
    elif name == "cart":
        d.line([P(0.05, 0.15), P(0.22, 0.15), P(0.35, 0.65), P(0.85, 0.65), P(0.95, 0.3), P(0.28, 0.3)], fill=c, width=lw, joint="curve")
        d.ellipse([P(0.35, 0.75), P(0.49, 0.89)], fill=c); d.ellipse([P(0.7, 0.75), P(0.84, 0.89)], fill=c)
    elif name == "shield":
        d.polygon([P(0.5, 0.05), P(0.9, 0.2), P(0.85, 0.6), P(0.5, 0.95), P(0.15, 0.6), P(0.1, 0.2)], fill=c2)
        d.line([P(0.33, 0.5), P(0.46, 0.63), P(0.7, 0.36)], fill=c, width=lw + 2, joint="curve")
    elif name == "cloud":
        d.ellipse([P(0.1, 0.4), P(0.5, 0.8)], fill=c2); d.ellipse([P(0.3, 0.2), P(0.75, 0.65)], fill=c2)
        d.ellipse([P(0.55, 0.4), P(0.92, 0.8)], fill=c2); d.rectangle([P(0.3, 0.55), P(0.75, 0.8)], fill=c2)
    elif name == "lock":
        d.arc([P(0.28, 0.08), P(0.72, 0.6)], 180, 360, fill=c, width=lw + 2)
        d.line([P(0.28 + 0.035, 0.34), P(0.28 + 0.035, 0.5)], fill=c, width=lw + 2); d.line([P(0.72 - 0.035, 0.34), P(0.72 - 0.035, 0.5)], fill=c, width=lw + 2)
        R(0.15, 0.45, 0.85, 0.95, 0.08, fill=c2)
        d.ellipse([P(0.44, 0.6), P(0.56, 0.72)], fill=c); d.rectangle([P(0.47, 0.66), P(0.53, 0.84)], fill=c)
    elif name == "unlock":
        d.arc([P(0.28, 0.08), P(0.72, 0.6)], 180, 300, fill=c, width=lw + 2)
        d.line([P(0.28 + 0.035, 0.34), P(0.28 + 0.035, 0.5)], fill=c, width=lw + 2)
        R(0.15, 0.45, 0.85, 0.95, 0.08, fill=c2)
        d.ellipse([P(0.44, 0.6), P(0.56, 0.72)], fill=c); d.rectangle([P(0.47, 0.66), P(0.53, 0.84)], fill=c)
    elif name == "gear":
        for i in range(8):
            a = math.radians(i * 45)
            x, y = 0.5 + math.cos(a) * 0.38, 0.5 + math.sin(a) * 0.38
            d.rounded_rectangle([P(x - 0.09, y - 0.09), P(x + 0.09, y + 0.09)], radius=s * 0.03, fill=c)
        d.ellipse([P(0.18, 0.18), P(0.82, 0.82)], fill=c); d.ellipse([P(0.36, 0.36), P(0.64, 0.64)], fill=rgba(SURFACE))
    elif name == "monitor":
        R(0.05, 0.1, 0.95, 0.68, 0.05, fill=c2); R(0.1, 0.15, 0.9, 0.63, 0.03, fill=rgba(BG0))
        d.rectangle([P(0.44, 0.68), P(0.56, 0.82)], fill=c); d.rectangle([P(0.3, 0.82), P(0.7, 0.88)], fill=c)
    elif name == "laptop":
        R(0.12, 0.15, 0.88, 0.68, 0.04, fill=c2); R(0.17, 0.2, 0.83, 0.63, 0.02, fill=rgba(BG0))
        R(0.02, 0.68, 0.98, 0.78, 0.04, fill=c)
    elif name == "phone":
        R(0.3, 0.05, 0.7, 0.95, 0.08, fill=c2); R(0.34, 0.12, 0.66, 0.84, 0.04, fill=rgba(BG0))
        d.ellipse([P(0.47, 0.87), P(0.53, 0.93)], fill=c)
    elif name == "tablet":
        R(0.15, 0.08, 0.85, 0.92, 0.08, fill=c2); R(0.2, 0.14, 0.8, 0.84, 0.04, fill=rgba(BG0))
    elif name == "db":
        d.ellipse([P(0.15, 0.05), P(0.85, 0.3)], fill=c2)
        d.rectangle([P(0.15, 0.17), P(0.85, 0.8)], fill=c)
        d.ellipse([P(0.15, 0.68), P(0.85, 0.93)], fill=c)
        d.arc([P(0.15, 0.37), P(0.85, 0.62)], 0, 180, fill=c2, width=lw); d.arc([P(0.15, 0.55), P(0.85, 0.8)], 0, 180, fill=c2, width=lw)
    elif name == "server":
        for i in range(3):
            yy = 0.08 + i * 0.3
            R(0.1, yy, 0.9, yy + 0.24, 0.04, fill=c2 if i % 2 == 0 else c)
            d.ellipse([P(0.18, yy + 0.08), P(0.26, yy + 0.16)], fill=rgba(GREEN))
    elif name == "wifi":
        for i, r in enumerate((0.9, 0.62, 0.34)):
            d.arc([P(0.5 - r / 2, 0.5 - r / 2 + 0.25), P(0.5 + r / 2, 0.5 + r / 2 + 0.25)], 225, 315, fill=c, width=lw + 1)
        d.ellipse([P(0.44, 0.7), P(0.56, 0.82)], fill=c)
    elif name == "wifi_off":
        for i, r in enumerate((0.9, 0.62, 0.34)):
            d.arc([P(0.5 - r / 2, 0.5 - r / 2 + 0.25), P(0.5 + r / 2, 0.5 + r / 2 + 0.25)], 225, 315, fill=c, width=lw + 1)
        d.ellipse([P(0.44, 0.7), P(0.56, 0.82)], fill=c)
        d.line([P(0.15, 0.15), P(0.85, 0.85)], fill=rgba(ROSE), width=lw + 3)
    elif name == "check":
        d.ellipse([P(0.05, 0.05), P(0.95, 0.95)], fill=c)
        d.line([P(0.28, 0.52), P(0.44, 0.68), P(0.72, 0.36)], fill=rgba(WHITE), width=lw + 3, joint="curve")
    elif name == "cross":
        d.ellipse([P(0.05, 0.05), P(0.95, 0.95)], fill=c)
        d.line([P(0.32, 0.32), P(0.68, 0.68)], fill=rgba(WHITE), width=lw + 3); d.line([P(0.68, 0.32), P(0.32, 0.68)], fill=rgba(WHITE), width=lw + 3)
    elif name == "warning":
        d.polygon([P(0.5, 0.06), P(0.95, 0.9), P(0.05, 0.9)], fill=c)
        d.line([P(0.5, 0.35), P(0.5, 0.62)], fill=rgba(BG0), width=lw + 2); d.ellipse([P(0.45, 0.7), P(0.55, 0.8)], fill=rgba(BG0))
    elif name == "store":
        d.rectangle([P(0.12, 0.4), P(0.88, 0.95)], fill=c2)
        d.polygon([P(0.05, 0.4), P(0.2, 0.12), P(0.8, 0.12), P(0.95, 0.4)], fill=c)
        d.rectangle([P(0.42, 0.65), P(0.58, 0.95)], fill=rgba(BG0))
        d.rectangle([P(0.47, 0.44), P(0.53, 0.62)], fill=rgba(GREEN)); d.rectangle([P(0.41, 0.5), P(0.59, 0.56)], fill=rgba(GREEN))
    elif name == "user":
        d.ellipse([P(0.32, 0.08), P(0.68, 0.44)], fill=c)
        d.pieslice([P(0.1, 0.5), P(0.9, 1.3)], 180, 360, fill=c2)
    elif name == "truck":
        R(0.05, 0.25, 0.6, 0.7, 0.03, fill=c2); R(0.6, 0.4, 0.92, 0.7, 0.03, fill=c)
        d.ellipse([P(0.15, 0.62), P(0.33, 0.8)], fill=c); d.ellipse([P(0.65, 0.62), P(0.83, 0.8)], fill=c)
    elif name == "barcode":
        R(0.05, 0.15, 0.95, 0.85, 0.05, fill=c2)
        x = 0.14
        for wdt in (0.03, 0.05, 0.02, 0.06, 0.03, 0.02, 0.05, 0.03, 0.06, 0.02, 0.04):
            d.rectangle([P(x, 0.25), P(x + wdt, 0.75)], fill=c); x += wdt + 0.03
    elif name == "calendar":
        R(0.08, 0.15, 0.92, 0.92, 0.06, fill=c2); d.rectangle([P(0.08, 0.15), P(0.92, 0.35)], fill=c)
        for r_ in range(2):
            for q in range(4):
                d.rectangle([P(0.18 + q * 0.18, 0.45 + r_ * 0.2), P(0.3 + q * 0.18, 0.57 + r_ * 0.2)], fill=c)
    elif name == "chart":
        for i, hgt in enumerate((0.35, 0.55, 0.45, 0.75, 0.9)):
            d.rectangle([P(0.08 + i * 0.18, 0.95 - hgt), P(0.2 + i * 0.18, 0.95)], fill=c if i % 2 == 0 else c2)
    elif name == "key":
        d.ellipse([P(0.05, 0.3), P(0.45, 0.7)], outline=c, width=lw + 2)
        d.line([P(0.45, 0.5), P(0.95, 0.5)], fill=c, width=lw + 2)
        d.line([P(0.8, 0.5), P(0.8, 0.68)], fill=c, width=lw + 2); d.line([P(0.65, 0.5), P(0.65, 0.64)], fill=c, width=lw + 2)
    elif name == "fingerprint":
        for i, r in enumerate((0.9, 0.7, 0.5, 0.3)):
            d.arc([P(0.5 - r / 2, 0.5 - r / 2), P(0.5 + r / 2, 0.5 + r / 2)], 200, 340 if i % 2 == 0 else 320, fill=c, width=lw)
            d.arc([P(0.5 - r / 2, 0.5 - r / 2), P(0.5 + r / 2, 0.5 + r / 2)], 20, 160 if i % 2 else 140, fill=c, width=lw)
    elif name == "sync":
        d.arc([P(0.1, 0.1), P(0.9, 0.9)], 200, 340, fill=c, width=lw + 2); d.arc([P(0.1, 0.1), P(0.9, 0.9)], 20, 160, fill=c, width=lw + 2)
        d.polygon([P(0.86, 0.22), P(0.98, 0.42), P(0.76, 0.42)], fill=c); d.polygon([P(0.14, 0.78), P(0.02, 0.58), P(0.24, 0.58)], fill=c)
    elif name == "layers":
        for i, yy in enumerate((0.55, 0.4, 0.25)):
            d.polygon([P(0.1, yy + 0.2), P(0.5, yy), P(0.9, yy + 0.2), P(0.5, yy + 0.4)], fill=c if i == 2 else c2, outline=rgba(BG0), width=2)
    elif name == "flag":
        d.line([P(0.2, 0.05), P(0.2, 0.95)], fill=c, width=lw + 1)
        d.polygon([P(0.2, 0.08), P(0.88, 0.25), P(0.2, 0.5)], fill=c2)
    elif name == "clock":
        d.ellipse([P(0.05, 0.05), P(0.95, 0.95)], outline=c, width=lw + 1)
        d.line([P(0.5, 0.5), P(0.5, 0.2)], fill=c, width=lw); d.line([P(0.5, 0.5), P(0.72, 0.6)], fill=c, width=lw)
    elif name == "receipt":
        pts = [P(0.15, 0.05), P(0.85, 0.05)]
        d.rectangle([P(0.15, 0.05), P(0.85, 0.95)], fill=c2)
        for i in range(6): d.polygon([P(0.15 + i * 0.1167, 0.95), P(0.15 + i * 0.1167 + 0.0583, 0.88), P(0.15 + (i + 1) * 0.1167, 0.95)], fill=rgba(0, 0, 0, 0) if False else c2)
        for i, yy in enumerate((0.25, 0.4, 0.55, 0.7)):
            d.line([P(0.28, yy), P(0.72 if i < 3 else 0.5, yy)], fill=c, width=lw)
    elif name == "rocket":
        d.polygon([P(0.5, 0.05), P(0.7, 0.45), P(0.7, 0.75), P(0.3, 0.75), P(0.3, 0.45)], fill=c2)
        d.ellipse([P(0.42, 0.35), P(0.58, 0.51)], fill=c)
        d.polygon([P(0.3, 0.55), P(0.12, 0.8), P(0.3, 0.75)], fill=c); d.polygon([P(0.7, 0.55), P(0.88, 0.8), P(0.7, 0.75)], fill=c)
        d.polygon([P(0.4, 0.75), P(0.6, 0.75), P(0.5, 0.95)], fill=rgba(AMBER))
    else:
        d.ellipse([P(0.1, 0.1), P(0.9, 0.9)], fill=c)
    if rot:
        L.img = L.img.rotate(rot, resample=Image.BICUBIC)
    L.put(base, cx - L.w / 2 * scale, cy - L.h / 2 * scale, alpha, scale)

# ---------------------------------------------------------------- backgrounds
_BG = None
def background():
    global _BG
    if _BG is None:
        img = Image.new("RGB", (W, H), BG0)
        px = img.load()
        # vertical gradient + radial glow top-right
        grad = Image.new("RGB", (1, H))
        for y in range(H):
            grad.putpixel((0, y), mix(BG0, BG1, y / H))
        img = grad.resize((W, H))
        d = ImageDraw.Draw(img)
        for gx in range(0, W, 60):
            for gy in range(0, H, 60):
                d.point((gx, gy), fill=(34, 48, 74))
        glow = Image.new("RGB", (W, H), (0, 0, 0)); gd = ImageDraw.Draw(glow)
        gd.ellipse((W - 900, -500, W + 300, 500), fill=(10, 45, 70))
        gd.ellipse((-400, H - 500, 500, H + 400), fill=(30, 20, 60))
        glow = glow.filter(ImageFilter.GaussianBlur(160))
        img = Image.blend(img, Image.eval(glow, lambda v: v), 0.0)
        from PIL import ImageChops
        img = ImageChops.add(img, glow)
        _BG = img.convert("RGBA")
    return _BG.copy()

@lru_cache(maxsize=None)
def _clip_list(name):
    return sorted((CLIPFRAMES / name).glob("*.jpg"))

def clip_frame(name, t, speed=0.6, dim=0.45, zoom=1.0, pingpong=True):
    """Return RGBA frame of the real-footage clip at time t (slow-motion, darkened)."""
    files = _clip_list(name)
    n = len(files)
    idx = int(t * FPS * speed)
    if pingpong:
        cycle = 2 * (n - 1)
        idx = idx % cycle
        if idx >= n: idx = cycle - idx
    else:
        idx = idx % n
    img = Image.open(files[idx]).convert("RGB")
    if zoom != 1.0:
        zw, zh = int(W / zoom), int(H / zoom)
        x0, y0 = (W - zw) // 2, (H - zh) // 2
        img = img.crop((x0, y0, x0 + zw, y0 + zh)).resize((W, H), Image.BILINEAR)
    if dim > 0:
        img = Image.blend(img, Image.new("RGB", (W, H), BG0), dim)
    return img.convert("RGBA")

def vignette_panel(base, box, alpha=0.78, r=36):
    """Dark translucent panel for text over footage."""
    L = Layer(box[2] - box[0], box[3] - box[1])
    rrect(L.d, (0, 0, L.w - 1, L.h - 1), r, fill=rgba(BG0, int(255 * alpha)))
    L.put(base, box[0], box[1])

def bottom_bar(base, p):
    d = ImageDraw.Draw(base)
    d.rectangle((0, H - 8, W, H), fill=rgba(SURFACE))
    d.rectangle((0, H - 8, int(W * clamp(p)), H), fill=rgba(PRIMARY))

def chapter(base, title, n, t, color=PRIMARY):
    """Chapter tag top-right, slides in."""
    p = ease_out(prog(t, 0, 0.6))
    y = lerp(-80, 44, p)
    f = fb(34)
    w = measure(title, f) + 170
    L = Layer(w + 20, 80)
    rrect(L.d, (0, 0, w, 70), 20, fill=rgba(SURFACE, 220))
    L.d.rectangle((w - 14, 0, w, 70), fill=rgba(color))
    L.d.rounded_rectangle((w - 20, 0, w, 70), radius=20, fill=rgba(color))
    L.d.rectangle((w - 20, 0, w - 8, 70), fill=rgba(color))
    L.put(base, W - 70 - w, y, p)
    text(base, title, f, W - 70 - 44, y + 8, TEXT, p)
    text(base, f"{n:02d}", fl(30, True), W - 70 - w + 30, y + 16, color, p, "lt")

def fmt_num(n): return f"{int(n):,}"
