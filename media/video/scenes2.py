"""Scenes 6–10 of the explainer."""
from anim_lib import *
from scenes1 import footage, CX, CY

# ------------------------------------------------------------------ 6 atomic posting
def scene6(img_unused, t, T):
    if t < 4.5:
        img = footage("pharmacy_counter", t, dim=0.35)
        p = ease_out(prog(t, 0.4, 0.8))
        vignette_panel(img, (W - 900, 840, W - 100, 970), 0.6 * p)
        text(img, "ماذا يحدث عند ترحيل الفاتورة؟", fb(46), W - 140, 870, TEXT, p)
        f = 1 - ease_in_out(prog(t, 3.7, 0.8))
        if f < 1: img = Image.blend(img, background(), 1 - f)
        return img
    img = background(); tt = t - 4.5
    chapter(img, "الترحيل الذري", 5, tt, GREEN)
    center = (CX + 250, 470)
    pc = ease_back(prog(tt, 0.2, 0.8))
    # invoice
    card(img, (center[0] - 160, center[1] - 190, center[0] + 160, center[1] + 190), pc, pc, fill=SURFACE, outline=PRIMARY, glow=PRIMARY)
    icon(img, "receipt", center[0], center[1] - 70, 130, PRIMARY, pc)
    text(img, "فاتورة بيع", frb(34), center[0], center[1] + 30, TEXT, pc, "ct")
    text(img, "ترحيل", fb(30), center[0], center[1] + 90, GREEN, pc, "ct")
    targets = [("box", "خصم الكميات من الدفعات", (center[0] - 560, 300), AMBER, 1.2),
               ("doc", "قيد محاسبي متوازن", (center[0] - 560, 640), VIOLET, 3.2),
               ("cash", "تحديث الصندوق أو دين العميل", (center[0] + 560, 300), GREEN, 5.4),
               ("shield", "أثر في سجل التدقيق", (center[0] + 560, 640), ROSE, 7.4)]
    for ic, cap, pos, col, st in targets:
        pa = ease_out(prog(tt, st, 0.9))
        if pa <= 0: continue
        sx = 1 if pos[0] > center[0] else -1
        arrow(img, (center[0] + sx * 175, center[1] + (pos[1] - center[1]) * 0.25), (pos[0] - sx * 140, pos[1]), pa, col, 7, 24)
        pb = ease_back(prog(tt, st + 0.6, 0.8))
        if pb > 0:
            card(img, (pos[0] - 130, pos[1] - 130, pos[0] + 130, pos[1] + 130), pb, pb, fill=SURFACE, outline=col)
            icon(img, ic, pos[0], pos[1] - 45, 96, col, pb)
            paragraph(img, cap, frb(25), pos[0] + 112, pos[1] + 35, 224, TEXT, pb)
    # "one transaction" ring
    pr = prog(tt, 9.5, 2.2)
    if pr > 0:
        ring(img, center, 395, ease_in_out(pr), GREEN, 10, mix(SURFACE2, BG0, 0.3), 0.9)
    pt = ease_out(prog(tt, 11.5, 0.8))
    if pt > 0:
        L = Layer(820, 90); rrect(L.d, (0, 0, 819, 89), 20, fill=rgba(GREEN, 235)); L.put(img, center[0] - 410, 905, pt)
        text(img, "عملية واحدة: إما تنجح كلها… أو لا يُسجَّل شيء", fb(36), center[0] + 380, 920, BG0, pt)
    # state machine (left column)
    ps = ease_out(prog(tt, 15.5, 1.0))
    if ps > 0:
        x = 230
        states = [("مسودة", MUTED, "doc"), ("مرحّلة", GREEN, "lock"), ("معكوسة", AMBER, "sync")]
        card(img, (60, 170, 400, 990), ps, 1, fill=mix(SURFACE, BG0, 0.3), outline=SURFACE2)
        text(img, "دورة حياة الفاتورة", frb(28), x, 190, TEXT, ps, "ct")
        for i, (nm, col, ic) in enumerate(states):
            y = 300 + i * 230
            pi = ease_back(prog(tt, 16 + i * 1.6, 0.7))
            if i > 0: arrow(img, (x, y - 150), (x, y - 70), ease_out(prog(tt, 16 + i * 1.6 - 0.6, 0.6)), col, 5, 18)
            dot(img, (x, y), 58, mix(SURFACE2, col, 0.25), pi)
            icon(img, ic, x, y, 60, col, pi)
            text(img, nm, frb(28), x, y + 65, TEXT, pi, "ct")
        pe = ease_out(prog(tt, 21.5, 0.8))
        if pe > 0:
            text(img, "لا تعديل بعد الترحيل", frb(24), x, 920, ROSE, pe, "ct")
            text(img, "التصحيح = مرتجع أو قيد عكسي", fr(22), x, 955, MUTED, pe, "ct")
    return img

# ------------------------------------------------------------------ 7 architecture
LAYERS = [("واجهة المستخدم", "React + Tauri — سطح مكتب / ويب / موبايل", PRIMARY, "monitor"),
          ("واجهة برمجية موحّدة API", "NestJS — نفس العقد لكل الواجهات", GREEN, "sync"),
          ("طبقة المجال", "قواعد العمل: دفعات، FEFO، قيود، صلاحيات", VIOLET, "gear"),
          ("قاعدة البيانات", "PostgreSQL / SQLite — سجلات لا تُعدَّل + RLS", AMBER, "db")]

def scene7(img_unused, t, T):
    img = background()
    chapter(img, "المعمارية", 6, t, VIOLET)
    phase2 = ease_in_out(prog(t, 13.5, 1.2))   # layers shrink to left, modes appear right
    text(img, "من الداخل: طبقات واضحة", fb(56), W - 120, 140, TEXT, ease_out(prog(t, 0.2, 0.8)) * (1 - phase2))
    text(img, "نفس الكود… ثلاثة أوضاع تشغيل", fb(56), W - 120, 140, TEXT, phase2)
    # layers stack
    x1 = lerp(W - 200, 700, phase2); x0 = lerp(200, 90, phase2)
    y0 = lerp(260, 300, phase2); lh = lerp(170, 140, phase2); gap = lerp(24, 16, phase2)
    for i, (nm, sub, col, ic) in enumerate(LAYERS):
        p = ease_out(prog(t, 1.0 + i * 2.6, 0.9))
        if p <= 0: continue
        ya = y0 + i * (lh + gap) + lerp(-60, 0, p)
        card(img, (x0, ya, x1, ya + lh), p, 1, fill=mix(SURFACE, col, 0.08), outline=col)
        icon(img, ic, x1 - 90, ya + lh / 2, lerp(90, 64, phase2), col, p)
        text(img, nm, fb(lerp(40, 30, phase2)), x1 - 170, ya + lerp(30, 20, phase2), TEXT, p)
        text(img, sub, fr(lerp(28, 20, phase2)), x1 - 170, ya + lerp(95, 72, phase2), MUTED, p * (1 - phase2 * 0.3))
        if i > 0:
            # data flow dots between layers
            for k in range(2):
                ph = ((t * 0.5) + k / 2) % 1
                dot(img, ((x0 + x1) / 2 + (k - 0.5) * 60, lerp(ya - gap, ya, ph)), 5, col, p * 0.8)
    # modes
    if phase2 > 0:
        modes = [("laptop", "خفيف", "جهاز واحد · SQLite · بدون سيرفر", GREEN, 0),
                 ("server", "سيرفر محلي", "عدة أجهزة في الصيدلية · PostgreSQL", PRIMARY, 1),
                 ("cloud", "سحابة", "عدة فروع · مزامنة · لوحة المالك", VIOLET, 2)]
        for ic, nm, sub, col, i in modes:
            p = ease_back(prog(t, 14.5 + i * 2.0, 0.8))
            if p <= 0: continue
            cx = W - 420; cy = 330 + i * 230
            card(img, (cx - 500, cy - 95, cx + 300, cy + 95), p, p, fill=SURFACE, outline=col)
            icon(img, ic, cx + 210, cy, 100, col, p)
            text(img, nm, fb(38), cx + 120, cy - 70, TEXT, p)
            text(img, sub, fr(26), cx + 120, cy + 5, MUTED, p)
        # upgrade arrow
        pu = ease_out(prog(t, 21.0, 1.0))
        if pu > 0:
            arrow(img, (W - 1060, 420), (W - 1060, 740), pu, GREEN, 8, 26, dashed=False)
            L = Layer(260, 60); rrect(L.d, (0, 0, 259, 59), 14, fill=rgba(GREEN, 230)); L.put(img, W - 1190, 560, pu)
            text(img, "ترقية بلا إعادة بناء", frb(24), W - 940, 572, BG0, pu)
    return img

# ------------------------------------------------------------------ 8 security + licensing
def scene8(img_unused, t, T):
    img = background()
    chapter(img, "الأمن والترخيص", 7, t, ROSE)
    text(img, "حماية المنتج… وحماية العميل", fb(56), W - 120, 140, TEXT, ease_out(prog(t, 0.2, 0.8)))
    # licensing flow (top)
    steps = [("key", "مفتاح ترخيص موقّع رقمياً", AMBER), ("fingerprint", "مرتبط ببصمة الجهاز", VIOLET),
             ("wifi_off", "تفعيل بدون إنترنت", ROSE), ("unlock", "المزايا تُفتح حسب الباقة", GREEN)]
    for i, (ic, cap, col) in enumerate(steps):
        p = ease_back(prog(t, 1.0 + i * 2.0, 0.8))
        if p <= 0: continue
        cx = W - 300 - i * 430; cy = 360
        if i > 0: arrow(img, (cx + 300, cy), (cx + 130, cy), ease_out(prog(t, 0.6 + i * 2.0, 0.6)), MUTED, 5, 18, dashed=True)
        dot(img, (cx, cy), 95, SURFACE, p); ring(img, (cx, cy), 95, 1, col, 6, col, p)
        icon(img, ic, cx, cy, 90, col, p, p)
        paragraph(img, cap, frb(26), cx + 150, cy + 120, 300, TEXT, p)
    # RBAC matrix (bottom)
    pm = ease_out(prog(t, 10.0, 1.0))
    if pm > 0:
        y0 = lerp(H + 20, 600, pm)
        card(img, (120, y0, W - 120, y0 + 400), pm, 1, fill=mix(SURFACE, BG0, 0.3), outline=SURFACE2)
        text(img, "صلاحيات حسب الدور — وكل عملية مسجّلة باسم من قام بها", fb(34), W - 170, y0 + 20, TEXT, pm)
        roles = ["المالك", "المدير", "الكاشير", "المحاسب"]
        perms = [("بيع وطباعة فاتورة", [1, 1, 1, 0]), ("خصم / إلغاء بعد الترحيل", [1, 1, 0, 0]),
                 ("استلام مشتريات وتعديل أسعار", [1, 1, 0, 0]), ("التقارير المالية والأرباح", [1, 1, 0, 1]),
                 ("إدارة المستخدمين والترخيص", [1, 0, 0, 0])]
        colx = [W - 820, W - 1050, W - 1280, W - 1510]
        for j, r in enumerate(roles):
            text(img, r, frb(26), colx[j] + 60, y0 + 90, PRIMARY, pm, "ct")
        for i, (pn, vals) in enumerate(perms):
            pr = ease_out(prog(t, 11.5 + i * 1.2, 0.5))
            if pr <= 0: continue
            y = y0 + 150 + i * 48
            text(img, pn, fr(26), W - 170, y, TEXT, pr)
            for j, v in enumerate(vals):
                icon(img, "check" if v else "cross", colx[j] + 60, y + 22, 34, GREEN if v else mix(ROSE, BG0, 0.5), pr, ease_back(pr))
    return img

# ------------------------------------------------------------------ 9 where we are
DELIVERABLES = ["بحث معمّق: أنظمة عالمية ومحلية ومفتوحة المصدر", "وثيقة متطلبات ~100 متطلب (ISO 29148)",
                "نموذج المجال: 12 سياقاً وقواعد ثابتة", "معمارية موثّقة (C4) + 12 قرار معماري",
                "نموذج بيانات + قواعد ترحيل محاسبية مختبرة", "تصميم الأمن والترخيص", "خطة تسليم وتسعير وسجل مخاطر"]
MILESTONES = [("M0", "اعتماد + جلسة العميل", "الآن"), ("M1", "الأساس", "أسبوعان"), ("M2", "مخزون ومبيعات", "3 أسابيع"),
              ("M3", "صندوق وتقارير", "3 أسابيع"), ("M4", "اختبار وتجربة", "أسبوعان"), ("M5", "تسليم وتدريب", "أسبوعان")]

def scene9(img_unused, t, T):
    if t < 4.0:
        img = footage("pharmacy_stocktake", t, dim=0.35)
        p = ease_out(prog(t, 0.4, 0.8))
        vignette_panel(img, (W - 700, 840, W - 100, 970), 0.6 * p)
        text(img, "أين وصلنا الآن؟", fb(50), W - 140, 866, TEXT, p)
        f = 1 - ease_in_out(prog(t, 3.2, 0.8))
        if f < 1: img = Image.blend(img, background(), 1 - f)
        return img
    img = background(); tt = t - 4.0
    chapter(img, "أين وصلنا", 8, tt, PRIMARY)
    # deliverables checklist (right)
    text(img, "المرحلة الأولى — التخطيط والتصميم", fb(44), W - 120, 140, TEXT, ease_out(prog(tt, 0, 0.8)))
    for i, d_ in enumerate(DELIVERABLES):
        p = ease_out(prog(tt, 1.0 + i * 1.9, 0.6))
        if p <= 0: continue
        y = 215 + i * 48
        pc = ease_back(prog(tt, 1.6 + i * 1.9, 0.5))
        icon(img, "check", W - 160, y + 22, 36, GREEN, pc, pc)
        text(img, d_, fr(27), W - 210, y, TEXT, p)
    # progress ring
    pr = prog(tt, 1.0, 14)
    ring(img, (W - 1100, 380), 100, 0.9 * ease_in_out(pr), GREEN, 20, SURFACE2, ease_out(prog(tt, 0.5, 0.8)))
    text(img, f"{int(90 * ease_in_out(pr))}%", fl(58, True), W - 1100, 342, TEXT, ease_out(prog(tt, 0.5, 0.8)), "ct")
    text(img, "من المرحلة الأولى", fr(22), W - 1100, 500, MUTED, ease_out(prog(tt, 0.5, 0.8)), "ct")
    # repo as memory
    pm = ease_out(prog(tt, 15.0, 0.9))
    if pm > 0:
        card(img, (120, 250, 660, 500), pm, 1, fill=mix(SURFACE, PRIMARY, 0.1), outline=PRIMARY)
        icon(img, "db", 585, 315, 64, PRIMARY, pm)
        text(img, "مستودع واحد = ذاكرة المشروع", frb(29), 520, 285, TEXT, pm)
        paragraph(img, "كل البحث والقرارات والحالة موثّقة — أي جلسة جديدة تكمل من حيث توقفنا", fr(24), 630, 360, 480, MUTED, pm)
    # timeline
    pt = ease_out(prog(tt, 19.0, 1.0))
    if pt > 0:
        y = 720
        line(img, [(140, y), (W - 140, y)], SURFACE2, 8, pt)
        n = len(MILESTONES)
        for i, (code, nm, dur) in enumerate(MILESTONES):
            x = W - 220 - i * ((W - 440) / (n - 1))
            pi = ease_back(prog(tt, 19.5 + i * 0.9, 0.6))
            if pi <= 0: continue
            col = GREEN if i == 0 else (PRIMARY if i < 4 else VIOLET)
            dot(img, (x, y), 26, col if i == 0 else SURFACE, pi); ring(img, (x, y), 26, 1, col, 5, col, pi)
            text(img, code, fl(26, True), x, y + 40, col, pi, "ct")
            text(img, nm, frb(24), x, y + 78, TEXT, pi, "ct")
            text(img, dur, fr(20), x, y + 114, MUTED, pi, "ct")
        # "we are here" marker
        ph = ease_back(prog(tt, 25.0, 0.8))
        if ph > 0:
            x = W - 220; bob = math.sin(tt * 4) * 5
            L = Layer(220, 90); rrect(L.d, (0, 0, 219, 64), 16, fill=rgba(GREEN)); L.d.polygon([(96, 63), (124, 63), (110, 84)], fill=rgba(GREEN))
            L.put(img, x - 110, y - 135 + bob, ph)
            text(img, "نحن هنا", fb(28), x, y - 130 + bob, BG0, ph, "ct")
    # what's needed now
    pn = ease_out(prog(tt, 28.0, 1.0))
    if pn > 0:
        card(img, (120, 862, W - 120, 1052), pn, 1, fill=mix(SURFACE, AMBER, 0.12), outline=AMBER)
        icon(img, "flag", W - 190, 957, 70, AMBER, pn)
        text(img, "المطلوب الآن:", fb(34), W - 260, 880, AMBER, pn)
        items = [("اعتماد التقنيات", W - 560, 880), ("اعتماد التسعير", W - 900, 880),
                 ("جلسة مع العميل لإغلاق الأسئلة المفتوحة", W - 560, 934), ("ثم البناء الفعلي: الأساس ← المخزون والمبيعات ← الصندوق والتقارير ← التسليم والتدريب", W - 260, 988)]
        for i, (it, xs, ys) in enumerate(items):
            pi = ease_out(prog(tt, 29.0 + i * 1.2, 0.6))
            col = GREEN if i == 3 else TEXT
            text(img, ("← " if i == 3 else "• ") + it, frb(28), xs, ys, col, pi)
    return img

# ------------------------------------------------------------------ 10 outro
def scene10(img_unused, t, T):
    img = footage("pharmacy_owner", t, dim=0.3 + 0.3 * ease_in_out(prog(t, 8, 3)), zoom=1.0 + 0.03 * t / T)
    results = [("box", "تعرف ما لديها", PRIMARY), ("calendar", "تعرف ما سينتهي", AMBER), ("chart", "تعرف كم ربحت", GREEN)]
    for i, (ic, cap, col) in enumerate(results):
        p = ease_back(prog(t, 0.8 + i * 1.6, 0.8))
        if p <= 0: continue
        cx = W - 320 - i * 560; cy = 300
        card(img, (cx - 230, cy - 90, cx + 230, cy + 90), p, p, fill=mix(SURFACE, BG0, 0.2), outline=col)
        icon(img, ic, cx + 150, cy, 90, col, p)
        text(img, cap, fb(36), cx + 70, cy - 28, TEXT, p)
    p = ease_out(prog(t, 7.0, 1.0))
    if p > 0:
        vignette_panel(img, (CX - 700, 560, CX + 700, 900), 0.6 * p)
        text(img, "منتج قابل للبيع لصيدليات كثيرة — بنفس الجودة", fb(44), CX, 590, TEXT, p, "ct")
        text(img, "PharmaCore", fl(110, True), CX, 660, WHITE, ease_out(prog(t, 8.5, 1.0)), "ct")
        text(img, "هذا هو المخطط — وهذا ما نعمل عليه الآن", fr(36), CX, 810, PRIMARY, ease_out(prog(t, 10.5, 1.0)), "ct")
    fade = ease_in_out(prog(t, T - 1.2, 1.2))
    if fade > 0: img = Image.blend(img, Image.new("RGBA", (W, H), BG0 + (255,)), fade)
    return img
