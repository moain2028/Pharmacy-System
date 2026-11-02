# ADR-012: واجهة React واحدة لكل المنصات (Web / PWA / Tauri Desktop / Mobile wrapper)

- **الحالة:** Accepted — 2026-11-03
- **المتطلبات:** NFR-PORT-001، CH (معين: "تطبيق وديسكتوب وكل شي")

## السياق
فريق صغير لا يستطيع صيانة 3 واجهات. المستخدمون يحتاجون ديسكتوب (الكاشير)، ويب (LAN)، وجوال (المالك).

## القرار
- `apps/web` SPA واحدة (React) مصممة Responsive + RTL + Keyboard-first.
- **Desktop:** Tauri 2 يغلّفها مع sidecar.
- **PWA:** نفس البناء للمتصفح/الجوال للقراءة.
- **Mobile store app (لاحقاً):** Tauri 2 Mobile أو Capacitor لنفس البناء.
- فروق المنصة عبر `platform` adapter (طباعة، تخزين آمن، بصمة) — لا تفرّع في مكونات الواجهة.
- Design System في `packages/ui` مشترك.

## البدائل المرفوضة
React Native/Flutter منفصل: قاعدة كود ثانية. Electron: ثقيل.

## النتائج
- ✅ تكلفة صيانة واحدة؛ تجربة موحدة.
- ⚠️ تجربة الجوال الأصلية (كاميرا كقارئ) تُضاف عبر plugin عند الحاجة.
