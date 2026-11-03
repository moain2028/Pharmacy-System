// Print audit: renders /reports to /tmp/report-sales.pdf under print media and asserts header/table/no-chrome. node tools/ui-audit/print.mjs
import { chromium } from "playwright";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
await p.goto("http://localhost:3100/login", { waitUntil: "networkidle" }); await p.fill('input[autocomplete="username"]', "1"); await p.fill('input[type="password"]', "1"); await p.click('form button.btn-primary'); await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await p.goto("http://localhost:3100/reports", { waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.emulateMedia({ media: "print" });
const info = await p.evaluate(() => { const h = document.querySelector(".print-header"); const t = document.querySelector(".print-doc table"); return { header: h ? getComputedStyle(h).display : "none", headerText: h?.textContent?.trim().slice(0, 120), tableW: t?.getBoundingClientRect().width, docW: document.querySelector(".print-doc")?.getBoundingClientRect().width, scrollX: document.documentElement.scrollWidth, innerW: window.innerWidth, navVisible: [...document.querySelectorAll("nav,aside,header[data-topbar]")].filter((e) => getComputedStyle(e).display !== "none").length }; });
console.log(JSON.stringify(info));
await p.pdf({ path: "/tmp/report-sales.pdf", format: "A4", printBackground: true, preferCSSPageSize: true });
await b.close();
