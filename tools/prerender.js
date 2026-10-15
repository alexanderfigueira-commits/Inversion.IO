// Bakes the Portuguese (index.html) and English (en/index.html) pages as static HTML,
// so search engines can read every word without running scripts.
// Run after editing index.html:  node tools/prerender.js   (needs the "playwright" package)
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
let playwright;
try { playwright = require('playwright'); }
catch (e) { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'index.html');
const SITE = 'https://www.feel2zone.pt/';

(async () => {
  const browser = await playwright.chromium.launch();
  const out = {};
  for (const l of ['pt', 'en']) {
    const page = await browser.newPage();
    await page.goto('file://' + src);
    await page.evaluate(l => setLang(l), l);
    out[l] = '<!doctype html>\n' + (await page.evaluate(() => document.documentElement.outerHTML)).replace(/\s+<\/body>/, '\n<\/body>').trimEnd() + '\n';
    await page.close();
  }
  await browser.close();

  let en = out.en
    .replace('<link rel="canonical" href="' + SITE + '">', '<link rel="canonical" href="' + SITE + 'en/">')
    .replace('<meta property="og:url" content="' + SITE + '">', '<meta property="og:url" content="' + SITE + 'en/">')
    .replace(/(src|href)="(logo\.(?:webp|gif))"/g, '$1="../$2"');
  fs.mkdirSync(path.join(root, 'en'), { recursive: true });
  fs.writeFileSync(path.join(root, 'en', 'index.html'), en);
  fs.writeFileSync(src, out.pt);
  console.log('wrote index.html (pt) and en/index.html (en)');
})();
