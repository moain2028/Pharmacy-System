import { chromium } from "playwright";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
await p.goto("http://localhost:3100/login", { waitUntil: "networkidle" }); await p.evaluate(() => localStorage.setItem("pharmacore.prefs", JSON.stringify({ state: { theme: "dark", digits: "latn", density: "comfortable" }, version: 0 }))); await p.fill('input[autocomplete="username"]', "1"); await p.fill('input[type="password"]', "1"); await p.click('form button.btn-primary'); await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await p.goto("http://localhost:3100/pos", { waitUntil: "networkidle" }); await p.waitForTimeout(500);
console.log(await p.evaluate(() => {
  const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; const [r, g, b] = m.map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let e = el; while (e && e !== document.documentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const out = [];
  for (const el of document.querySelectorAll("main h1, main h2, main td, main th, main p, main span, main a, main button")) {
    if (!el.textContent.trim()) continue; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const c = getComputedStyle(el).color, bg = bgOf(el); const l1 = lum(c), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 3) out.push({ text: el.textContent.trim().slice(0, 40), cls: el.className.toString().slice(0, 80), c, bg, ratio: ratio.toFixed(2) });
  }
  return JSON.stringify(out);
}));
await b.close();
