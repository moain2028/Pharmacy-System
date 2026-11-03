import { chromium } from "playwright";
const base = "http://localhost:3100";
const routes = ["/", "/pos", "/sales", "/returns", "/customers", "/items", "/inventory", "/expiry", "/purchasing", "/suppliers", "/payables", "/cash", "/expenses", "/reports", "/accounting", "/users", "/settings"];
const vps = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } };
const b = await chromium.launch();
let bad = 0;
for (const [vn, vp] of Object.entries(vps)) {
  const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 800, hasTouch: vp.width < 800 });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("JS: " + e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  p.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url().replace(base, "")}`); });
  await p.goto(base + "/login", { waitUntil: "networkidle" });
  if (process.env.THEME) await p.evaluate((t) => localStorage.setItem("pharmacore.prefs", JSON.stringify({ state: { theme: t, digits: "latn", density: "comfortable" }, version: 0 })), process.env.THEME);
  await p.fill('input[autocomplete="username"]', "1"); await p.fill('input[type="password"]', "1"); await p.click('form button.btn-primary'); await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const r of routes) {
    errs.length = 0;
    await p.goto(base + r, { waitUntil: "networkidle" }); await p.waitForTimeout(400);
    const info = await p.evaluate(() => {
      const main = document.querySelector("main");
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const placeholder = !!document.querySelector('[data-placeholder]') || /قريبًا|Coming soon/.test(main?.textContent ?? "");
      const alerts = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim().slice(0, 80));
      const small = [...document.querySelectorAll("button, a[href]")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 32 && getComputedStyle(el).display !== "none"; }).length;
      const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; const [r, g, b] = m.map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = (el) => { let e = el; while (e && e !== document.documentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
      let lowContrast = 0;
      for (const el of document.querySelectorAll("main h1, main h2, main td, main th, main p, main span, main a, main button")) {
        if (!el.textContent.trim() || el.closest(".sr-only")) continue; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
        const l1 = lum(getComputedStyle(el).color), l2 = lum(bgOf(el)); if (l1 === null || l2 === null) continue;
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (ratio < 3) lowContrast++;
      }
      return { overflow, placeholder, alerts, textLen: (main?.textContent ?? "").trim().length, small, lowContrast };
    });
    const flags = [];
    if (errs.length) flags.push(...errs);
    if (info.overflow) flags.push("HORIZONTAL OVERFLOW");
    if (info.placeholder) flags.push("PLACEHOLDER");
    if (info.alerts.length) flags.push("alert: " + info.alerts.join(" | "));
    if (info.textLen < 20) flags.push("EMPTY PAGE");
    if (vn === "phone" && info.small > 0) flags.push(`${info.small} small tap targets (<32px)`);
    if (info.lowContrast > 0) flags.push(`${info.lowContrast} low-contrast text nodes (<3:1)`);
    if (flags.length) bad++;
    console.log(`${flags.length ? "✗" : "✓"} ${vn.padEnd(7)} ${r.padEnd(12)} ${flags.join(" ; ")}`);
    await p.screenshot({ path: `/tmp/crawl-${vn}-${r.replace(/\//g, "_") || "home"}.png` });
  }
  await ctx.close();
}
await b.close();
console.log(bad ? `\n${bad} route/viewport combos flagged (${process.env.THEME ?? "light"})` : `\nALL CLEAN (${process.env.THEME ?? "light"})`);
