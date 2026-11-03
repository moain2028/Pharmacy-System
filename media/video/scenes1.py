"""Scenes 1–5 of the explainer (each: draw(img, t, T))."""
from anim_lib import *

CX, CY = W // 2, H // 2

def footage(name, t, dim=0.5, zoom=1.0, speed=0.6, blur=False):
    if blur:
        global CLIPFRAMES
    try:
        if blur:
            import anim_lib
            old = anim_lib.CLIPFRAMES
            anim_lib.CLIPFRAMES = ROOT / "clipframes_blur"
            anim_lib._clip_list.cache_clear()
            img = clip_frame(name, t, speed, dim, zoom)
            anim_lib.CLIPFRAMES = old; anim_lib._clip_list.cache_clear()
            return img
        return clip_frame(name, t, speed, dim, zoom)
    except Exception:
        return background()

def label_icon(img, name, cx, cy, caption, color, p, size=96, fsize=32, sub=None, subcolor=MUTED):
    """Icon popping in with caption below."""
    if p <= 0: return
    s = ease_back(p)
    icon(img, name, cx, cy, size, color, p, s)
    text(img, caption, frb(fsize), cx, cy + size * 0.75, TEXT, p, "ct")
    if sub: text(img, sub, fr(fsize - 6), cx, cy + size * 0.75 + fsize + 10, subcolor, p, "ct")

# ------------------------------------------------------------------ 1 intro
def scene1(img_unused, t, T):
    img = footage("pharmacy_exterior", t, dim=0.25 + 0.3 * ease_in_out(prog(t, 5, 3)), zoom=1.0 + 0.04 * t / T)
    # title
    p1 = ease_out(prog(t, 1.0, 1.0))
    if p1 > 0:
        vignette_panel(img, (W - 1320, 160, W - 120, 600), 0.55 * p1)
        text(img, "PharmaCore", fl(120, True), W - 180, lerp(230, 190, p1), WHITE, p1)
        text(img, "نظام إدارة الصيدليات", fb(70), W - 180, lerp(400, 360, p1), PRIMARY, p1)
        p1b = ease_out(prog(t, 2.0, 1.0))
        text(img, "مخطط المشروع — ماذا نبني، كيف يعمل، وأين وصلنا", fr(40), W - 180, 480, MUTED, p1b)
    # three features
    feats = [("wifi_off", "يعمل بدون إنترنت", ROSE), ("key", "ملكية دائمة بلا اشتراك", AMBER), ("layers", "قابل للتوسع والبيع لأي صيدلية", GREEN)]
    for i, (ic, cap, col) in enumerate(feats):
        p = ease_out(prog(t, 8 + i * 2.6, 0.8))
        if p <= 0: continue
        x1 = W - 160 - i * 560; x0 = x1 - 520
        y0 = 720
        card(img, (x0, y0, x1, y0 + 150), p, lerp(0.9, 1, p), fill=mix(SURFACE, BG0, 0.2), outline=col)
        icon(img, ic, x1 - 90, y0 + 75, 80, col, p, ease_back(p))
        paragraph(img, cap, frb(32), x1 - 170, y0 + 40, 330, TEXT, p)
    return img

# ------------------------------------------------------------------ 2 problem
def scene2(img_unused, t, T):
    if t < 9:
        img = footage("pharmacy_ledger", t, dim=0.35, zoom=1.0 + 0.03 * t / 9)
        p = ease_out(prog(t, 0.6, 0.8))
        vignette_panel(img, (W - 1000, 820, W - 100, 960), 0.6 * p)
        text(img, "اليوم: الورقة والقلم… أو برنامج لا يعرف تاريخ الانتهاء", fb(44), W - 140, 850, TEXT, p)
        # fade out
        f = 1 - ease_in_out(prog(t, 8.2, 0.8))
        if f < 1: img = Image.blend(img, background(), 1 - f)
        return img
    img = background()
    chapter(img, "المشكلة الحقيقية", 1, t - 9, ROSE)
    tt = t - 9
    # same medicine, 3 batches
    text(img, "نفس الدواء… ثلاث دفعات مختلفة", fb(56), W - 120, 150, TEXT, ease_out(prog(tt, 0, 0.8)))
    lots = [("دفعة 1", "ينتهي 03/2026", "شراء 800", AMBER), ("دفعة 2", "ينتهي 09/2026", "شراء 850", PRIMARY), ("دفعة 3", "ينتهي 01/2027", "شراء 900", VIOLET)]
    for i, (name, exp, cost, col) in enumerate(lots):
        p = ease_out(prog(tt, 1.2 + i * 1.3, 0.8))
        if p <= 0: continue
        cx = W - 320 - i * 400
        y = lerp(420, 380, p)
        card(img, (cx - 175, y - 20, cx + 175, y + 300), p, 1, fill=SURFACE, outline=col)
        icon(img, "pill", cx, y + 70, 110, col, p, ease_back(p))
        text(img, name, frb(36), cx, y + 140, TEXT, p, "ct")
        text(img, exp, fr(30), cx, y + 190, col, p, "ct")
        text(img, cost, fr(30), cx, y + 232, MUTED, p, "ct")
    # questions
    qs = [("كم الربح الحقيقي هذا الشهر؟", 6.5), ("ما الذي سينتهي صلاحيته قريباً؟", 8.5)]
    for i, (q, st) in enumerate(qs):
        p = ease_out(prog(tt, st, 0.8))
        if p <= 0: continue
        y = 760 + i * 95
        icon(img, "warning", W - 170, y + 30, 56, ROSE, p, ease_back(p))
        text(img, q, fb(44), W - 230, y, TEXT, p)
    # power / internet cut
    p = ease_out(prog(tt, 12.5, 0.8))
    if p > 0:
        flick = 0.65 + 0.35 * (1 if (int(tt * 7) % 5) else 0.2)
        card(img, (100, 380, 560, 900), p, 1, fill=mix(SURFACE, BG0, 0.3), outline=ROSE)
        icon(img, "wifi_off", 330, 520, 130, PRIMARY, p * flick, 1)
        text(img, "انقطاع الإنترنت", frb(34), 330, 620, TEXT, p, "ct")
        # power bolt
        L = Layer(200, 200); d = L.d
        d.polygon([(110, 10), (40, 110), (95, 110), (75, 190), (160, 80), (105, 80), (130, 10)], fill=rgba(AMBER, int(255 * flick)))
        L.put(img, 230, 660, p)
        text(img, "انقطاع الكهرباء", frb(34), 330, 860 - 20, TEXT, p, "ct")
    return img

# ------------------------------------------------------------------ 3 what we build (hub)
def scene3(img_unused, t, T):
    img = background()
    chapter(img, "ماذا نبني؟", 2, t, PRIMARY)
    text(img, "نظام واحد… ثلاث واجهات", fb(56), W - 120, 130, TEXT, ease_out(prog(t, 0.2, 0.8)))
    hub = (CX, 650)
    nodes = [("laptop", "سطح المكتب", "جهاز الصيدلية — يعمل بدون إنترنت", (CX - 620, 650), GREEN, 3.5),
             ("monitor", "ويب", "سيرفر محلي أو سحابة", (CX, 290), PRIMARY, 7.0),
             ("phone", "موبايل", "المالك يتابع من أي مكان", (CX + 620, 650), VIOLET, 10.0)]
    # hub
    ph = ease_back(prog(t, 1.2, 0.9))
    if ph > 0:
        ring(img, hub, 150, 1, SURFACE2, 10, SURFACE2, ph)
        dot(img, hub, 140, mix(SURFACE, BG0, 0.2), ph)
        icon(img, "db", hub[0], hub[1] - 20, 120, PRIMARY, ph, ph, rot=0)
        text(img, "القلب المشترك", frb(32), hub[0], hub[1] + 60, TEXT, ph, "ct")
        text(img, "قواعد العمل + البيانات", fr(24), hub[0], hub[1] + 100, MUTED, ph, "ct")
    for ic, name, sub, pos, col, st in nodes:
        pa = prog(t, st, 1.0)
        if pa <= 0: continue
        # connector
        ang = math.atan2(pos[1] - hub[1], pos[0] - hub[0])
        p1 = (hub[0] + math.cos(ang) * 170, hub[1] + math.sin(ang) * 170)
        p2 = (pos[0] - math.cos(ang) * 150, pos[1] - math.sin(ang) * 150)
        line(img, [p1, p2], mix(col, BG0, 0.3), 6, ease_out(pa))
        # moving sync dots both directions
        if t > st + 1:
            for k in range(3):
                ph_ = ((t - st) * 0.35 + k / 3) % 1
                q = (lerp(p1[0], p2[0], ph_), lerp(p1[1], p2[1], ph_))
                dot(img, q, 8, col, 0.9)
                q2 = (lerp(p2[0], p1[0], (ph_ + 0.5) % 1), lerp(p2[1], p1[1], (ph_ + 0.5) % 1))
                dot(img, q2, 6, mix(col, WHITE, 0.5), 0.7)
        pb = ease_back(prog(t, st + 0.3, 0.9))
        dot(img, pos, 130, mix(SURFACE, BG0, 0.2), pb)
        ring(img, pos, 130, 1, col, 8, col, pb)
        icon(img, ic, pos[0], pos[1] - 15, 110, col, pb, pb)
        if pos[1] < 400:
            text(img, name, frb(34), pos[0] + 160, pos[1] - 40, TEXT, pb, "lt")
            text(img, sub, fr(26), pos[0] + 160, pos[1] + 10, MUTED, pb, "lt")
        else:
            text(img, name, frb(34), pos[0], pos[1] + 150, TEXT, pb, "ct")
            text(img, sub, fr(26), pos[0], pos[1] + 195, MUTED, pb, "ct")
    # badge
    p = ease_out(prog(t, 15, 1))
    if p > 0:
        card(img, (CX - 560, 940, CX + 560, 1040), p, 1, fill=mix(SURFACE, GREEN, 0.15), outline=GREEN)
        icon(img, "shield", CX + 490, 990, 60, GREEN, p)
        text(img, "البيانات تبقى عند العميل — والمزامنة تحدث عند توفر الاتصال", frb(34), CX + 430, 960, TEXT, p)
    return img

# ------------------------------------------------------------------ 4 modules + engine
MODULES = [("pill", "أصناف ومخزون", PRIMARY), ("cart", "مبيعات ومرتجعات", GREEN), ("truck", "مشتريات وموردون", AMBER),
           ("cash", "صندوق ومصروفات", VIOLET), ("user", "ديون العملاء والموردين", ROSE), ("barcode", "باركود وجرد", PRIMARY),
           ("chart", "تقارير وأرباح", GREEN), ("calendar", "تنبيهات الانتهاء", AMBER)]

def scene4(img_unused, t, T):
    img = background()
    chapter(img, "الوحدات", 3, t, GREEN)
    shift = ease_in_out(prog(t, 17, 1.4))   # grid moves up to reveal engine
    title_a = 1 - shift
    text(img, "للمستخدم: نظام تجاري بسيط وواضح", fb(56), W - 120, 150, TEXT, ease_out(prog(t, 0.2, 0.8)) * title_a)
    text(img, "الواجهة التجارية", fb(40), W - 120, 110, TEXT, shift)
    # grid 4x2
    gx0 = W - 200; gy0 = lerp(300, 200, shift)
    cw, chh, gap = 380, 230 * lerp(1, 0.78, shift), 40
    for i, (ic, name, col) in enumerate(MODULES):
        p = ease_back(prog(t, 1.0 + i * 1.7, 0.7))
        if p <= 0: continue
        r, c = divmod(i, 4)
        x1 = gx0 - c * (cw + gap); x0 = x1 - cw
        y0 = gy0 + r * (chh + gap * lerp(1, 0.5, shift)); y1 = y0 + chh
        card(img, (x0, y0, x1, y1), p, p, fill=SURFACE, outline=mix(col, BG0, 0.4))
        isz = lerp(90, 60, shift)
        icon(img, ic, (x0 + x1) / 2, y0 + chh * 0.42, isz, col, p, 1)
        text(img, name, frb(lerp(30, 26, shift)), (x0 + x1) / 2, y1 - lerp(70, 50, shift), TEXT, p, "ct")
    # engine
    pe = ease_out(prog(t, 18.5, 1.0))
    if pe > 0:
        y0 = lerp(H + 50, 760, pe); y1 = y0 + 230
        card(img, (120, y0, W - 120, y1), pe, 1, fill=mix(SURFACE, VIOLET, 0.12), outline=VIOLET, glow=VIOLET)
        # gears
        for k, (gx, gs, sp) in enumerate(((330, 120, 1), (440, 80, -1.5), (250, 70, -1.7))):
            icon(img, "gear", gx, y0 + 115 + (k == 1) * 40 - (k == 2) * 50, gs, VIOLET, pe, 1, rot=t * 40 * sp)
        text(img, "في الخلفية: محرك محاسبي كامل بالقيد المزدوج", fb(44), W - 200, y0 + 35, TEXT, pe)
        text(img, "كل عملية تُسجَّل تلقائياً وبصمت — لا يحتاج الصيدلي معرفة أي مصطلح محاسبي", fr(30), W - 200, y0 + 105, MUTED, pe)
        # toggle accounting_full
        pt = ease_out(prog(t, 27.5, 0.8))
        on = ease_in_out(prog(t, 29.5, 0.6))
        if pt > 0:
            tx = W - 200; ty = y0 + 165
            text(img, "الشاشات المحاسبية الكاملة:", fr(28), tx, ty, TEXT, pt)
            L = Layer(120, 56)
            rrect(L.d, (0, 0, 118, 54), 27, fill=rgba(mix(SURFACE2, GREEN, on)))
            kx = lerp(6, 66, on)
            L.d.ellipse((kx, 6, kx + 44, 50), fill=rgba(WHITE))
            L.put(img, tx - 540, ty + 4, pt)
            text(img, "accounting_full", fl(26), tx - 560, ty + 8, mix(MUTED, GREEN, on), pt)
            text(img, "تُفتح لاحقاً لمن يحتاجها" if on > 0.5 else "مغلقة افتراضياً", fr(26), tx - 820, ty + 6, mix(MUTED, GREEN, on), pt)
    return img

# ------------------------------------------------------------------ 5 lots + FEFO + ledger
LOTS = [("دفعة A", "03/2026", 800, 50, AMBER), ("دفعة B", "09/2026", 850, 40, PRIMARY), ("دفعة C", "01/2027", 900, 60, VIOLET)]

def scene5(img_unused, t, T):
    if t < 5.5:
        img = footage("pharmacy_receiving", t, dim=0.35)
        p = ease_out(prog(t, 0.5, 0.8))
        vignette_panel(img, (W - 980, 840, W - 100, 970), 0.6 * p)
        text(img, "كل استلام من المورد = دفعة مستقلة", fb(46), W - 140, 870, TEXT, p)
        f = 1 - ease_in_out(prog(t, 4.7, 0.8))
        if f < 1: img = Image.blend(img, background(), 1 - f)
        return img
    img = background()
    tt = t - 5.5
    chapter(img, "الدفعات و FEFO", 4, tt, AMBER)
    text(img, "الصنف: باراسيتامول 500", fb(44), W - 120, 130, TEXT, ease_out(prog(tt, 0, 0.8)))
    # truck arrives
    ptr = ease_out(prog(tt, 0.2, 1.4))
    if ptr < 1: icon(img, "truck", lerp(-150, 330, ptr), 700, 140, AMBER, 1 - ease_in_out(prog(tt, 2.2, 0.6)))
    # sale event
    sale_t = 8.5
    ps = ease_out(prog(tt, sale_t, 0.8))
    sold = int(30 * ease_in_out(prog(tt, sale_t + 2.0, 1.6)))
    # lots
    for i, (name, exp, cost, qty, col) in enumerate(LOTS):
        p = ease_back(prog(tt, 1.2 + i * 1.1, 0.7))
        if p <= 0: continue
        x1 = W - 150 - i * 430; x0 = x1 - 400; y0 = 230; y1 = 560
        chosen = (i == 0 and ps > 0)
        outline = GREEN if chosen else mix(col, BG0, 0.3)
        card(img, (x0, y0, x1, y1), p, p, fill=SURFACE, outline=outline, glow=GREEN if chosen else None)
        icon(img, "box", x1 - 70, y0 + 60, 70, col, p)
        text(img, name, frb(34), x1 - 130, y0 + 30, TEXT, p)
        text(img, f"ينتهي {exp}", fr(28), x1 - 30, y0 + 120, col, p)
        text(img, f"سعر الشراء {cost}", fr(28), x1 - 30, y0 + 165, MUTED, p)
        q = qty - (sold if i == 0 else 0)
        text(img, "الكمية", fr(26), x1 - 30, y0 + 225, MUTED, p)
        text(img, str(q), fl(64, True), x0 + 40, y0 + 205, GREEN if chosen and sold else TEXT, p, "lt")
        if chosen:
            text(img, "الأقرب انتهاءً ← FEFO", frb(26), (x0 + x1) / 2, y1 - 48, GREEN, ps, "ct")
    # sale request card
    if ps > 0:
        x1 = W - 1460; x0 = 120; y0 = 230
        card(img, (x0, y0, x1, y0 + 330), ps, 1, fill=mix(SURFACE, GREEN, 0.1), outline=GREEN)
        icon(img, "receipt", (x0 + x1) / 2, y0 + 80, 90, GREEN, ps)
        text(img, "طلب بيع", frb(34), (x0 + x1) / 2, y0 + 140, TEXT, ps, "ct")
        text(img, "30 حبة", fb(48), (x0 + x1) / 2, y0 + 190, GREEN, ps, "ct")
        pc = ease_out(prog(tt, sale_t + 3.8, 0.8))
        text(img, f"التكلفة = 30 × 800 = {fmt_num(24000)}", fr(26), (x0 + x1) / 2, y0 + 265, AMBER, pc, "ct")
        # arrow to lot A
        arrow(img, (x1 + 10, y0 + 120), (W - 560, y0 + 120), ease_out(prog(tt, sale_t + 0.6, 0.9)), GREEN, 7, 24)
    # ledger
    pl = ease_out(prog(tt, 17.5, 0.9))
    if pl > 0:
        y0 = lerp(H + 40, 620, pl)
        card(img, (120, y0, W - 120, y0 + 420), pl, 1, fill=mix(SURFACE, BG0, 0.3), outline=SURFACE2)
        icon(img, "lock", W - 200, y0 + 50, 60, ROSE, pl)
        text(img, "سجل حركات المخزون — stock_movements", fb(36), W - 260, y0 + 22, TEXT, pl)
        text(img, "يُضاف فقط · لا تعديل · لا حذف · الرصيد يُشتق منه", fr(26), W - 260, y0 + 78, MUTED, pl)
        rows = [("استلام", "دفعة A", "+50", "800", GREEN), ("استلام", "دفعة B", "+40", "850", GREEN),
                ("استلام", "دفعة C", "+60", "900", GREEN), ("بيع", "دفعة A", "-30", "800", ROSE)]
        hdr = ["النوع", "الدفعة", "الكمية", "التكلفة"]
        cols = [W - 200, W - 560, W - 920, W - 1280]
        for j, hname in enumerate(hdr):
            text(img, hname, frb(24), cols[j], y0 + 135, MUTED, pl)
        for i, (typ, lot, q, c, col) in enumerate(rows):
            pr = ease_out(prog(tt, 19 + i * 1.6, 0.6))
            if pr <= 0: continue
            y = y0 + 175 + i * 54
            L = Layer(W - 300, 48); rrect(L.d, (0, 0, L.w - 1, 47), 10, fill=rgba(SURFACE, 200)); L.put(img, 150, y - 4, pr)
            text(img, typ, fr(28), cols[0], y, col, pr); text(img, lot, fr(28), cols[1], y, TEXT, pr)
            text(img, q, fl(28, True), cols[2], y + 4, col, pr); text(img, c, fl(28), cols[3], y + 4, MUTED, pr)
            text(img, f"#{1001 + i}", fl(22), 190, y + 10, MUTED, pr, "lt")
        # attempted edit denied
        pd = ease_out(prog(tt, 26.5, 0.6))
        if pd > 0:
            L = Layer(520, 70); rrect(L.d, (0, 0, 519, 69), 16, fill=rgba(ROSE, 230)); L.put(img, 160, y0 + 30, pd)
            icon(img, "cross", 205, y0 + 65, 40, WHITE, pd, color2=ROSE)
            text(img, "UPDATE / DELETE → مرفوض", frb(26), 660, y0 + 48, WHITE, pd)
    return img
