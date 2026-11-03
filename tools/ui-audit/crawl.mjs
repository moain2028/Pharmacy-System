// UI audit: node tools/ui-audit/crawl.mjs  (needs: npm i -D playwright && npx playwright install chromium; API on :3100 with DEMO_MODE=true)
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
  await p.goto(base + "/login", { waitUntil: "networkidle" }); await p.fill('input[autocomplete="username"]', "1"); await p.fill('input[type="password"]', "1"); await p.click('form button.btn-primary'); await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const r of routes) {
    errs.length = 0;
    await p.goto(base + r, { waitUntil: "networkidle" }); await p.waitForTimeout(400);
    const info = await p.evaluate(() => {
      const main = document.querySelector("main");
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const placeholder = !!document.querySelector('[data-placeholder]') || /قريبًا|Coming soon/.test(main?.textContent ?? "");
      const alerts = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim().slice(0, 80));
      const small = [...document.querySelectorAll("button, a[href]")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 32 && getComputedStyle(el).display !== "none"; }).length;
      return { overflow, placeholder, alerts, textLen: (main?.textContent ?? "").trim().length, small };
    });
    const flags = [];
    if (errs.length) flags.push(...errs);
    if (info.overflow) flags.push("HORIZONTAL OVERFLOW");
    if (info.placeholder) flags.push("PLACEHOLDER");
    if (info.alerts.length) flags.push("alert: " + info.alerts.join(" | "));
    if (info.textLen < 20) flags.push("EMPTY PAGE");
    if (vn === "phone" && info.small > 0) flags.push(`${info.small} small tap targets (<32px)`);
    if (flags.length) bad++;
    console.log(`${flags.length ? "✗" : "✓"} ${vn.padEnd(7)} ${r.padEnd(12)} ${flags.join(" ; ")}`);
    await p.screenshot({ path: `/tmp/crawl-${vn}-${r.replace(/\//g, "_") || "home"}.png` });
  }
  await ctx.close();
}
await b.close();
console.log(bad ? `\n${bad} route/viewport combos flagged` : "\nALL CLEAN");
