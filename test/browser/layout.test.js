// Renders index.html in Chromium at real phone viewports and reports usability problems.
// Not committed: the app must stay dependency-free. This is a dev-time check.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'baby-log-shots');
fs.mkdirSync(SHOTS, {recursive:true});
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};

const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  res.end(fs.readFileSync(f));
});

const VIEWPORTS = [
  ['iphone-se',      375, 667, 2],   // smallest iPhone still in use
  ['iphone-15',      393, 852, 3],
  ['iphone-15-promax',430, 932, 3],
  ['pixel-7',        412, 915, 2.6],
  ['android-small',  360, 640, 2],   // common budget Android
];

(async () => {
  await new Promise(r => server.listen(8765, r));
  const browser = await chromium.launch();
  const problems = [];
  const note = (vp,msg) => { problems.push(vp+': '+msg); };

  for (const [name,w,h,dsf] of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport:{width:w,height:h}, deviceScaleFactor:dsf, isMobile:true, hasTouch:true,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      timezoneId:'Asia/Singapore',
    });
    // Block Google Fonts so we see the real offline/airplane-mode rendering too
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    // A failed Google Fonts request is not an app error - the font is cosmetic and the
    // stack falls back to the system one. Behind a corporate proxy it always fails.
    page.on('console', m => { if (m.type()==='error' && !/fonts\.(googleapis|gstatic)\.com|ERR_CERT/.test(m.text())) errs.push('console: '+m.text()); });
    await page.goto('http://localhost:8765/', { waitUntil:'networkidle' });
    await page.waitForTimeout(400);

    // --- layout metrics ---
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        compatMode: document.compatMode,
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        innerW: window.innerWidth, visualW: window.visualViewport ? Math.round(window.visualViewport.width) : null,
        scale: window.visualViewport ? window.visualViewport.scale : null,
        bodyFont: getComputedStyle(document.body).fontSize,
      };
    });
    if (m.compatMode !== 'CSS1Compat') note(name, 'QUIRKS MODE (no doctype) - compatMode='+m.compatMode);
    if (m.innerW !== w) note(name, `viewport not honoured: window.innerWidth=${m.innerW}, device width=${w} (missing viewport meta?)`);
    if (m.scrollW > m.clientW + 1) note(name, `horizontal overflow: scrollWidth=${m.scrollW} > clientWidth=${m.clientW}`);

    // --- tap target sizes: anything interactive under 44x44 CSS px ---
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button,input,textarea,[role=tab]')) {
        if (el.offsetParent === null && el.tagName !== 'BODY') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 44 || r.width < 44) out.push({
          what: (el.id || el.className || el.tagName) + ' "' + (el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,22) + '"',
          w: Math.round(r.width), h: Math.round(r.height)
        });
      }
      return out;
    });
    for (const s of small) note(name, `tap target ${s.w}x${s.h}px (<44) : ${s.what}`);

    // --- does the bottom tab bar sit above the home-screen indicator? ---
    const tabs = await page.evaluate(() => {
      const n = document.querySelector('.tabs'); if (!n) return null;
      const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
      return { position: cs.position, bottom: cs.bottom, paddingBottom: cs.paddingBottom,
               usesSafeArea: /env\(|safe-area/.test(cs.paddingBottom) , top: Math.round(r.top), h: Math.round(r.height) };
    });

    await page.screenshot({ path: `${SHOTS}/${name}-home.png` });

    // --- walk into Feed and log a bottle ---
    await page.click('[data-go="feed"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-feed.png` });

    const m2 = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    if (m2.scrollW > m2.clientW + 1) note(name, `horizontal overflow on Feed pane: ${m2.scrollW} > ${m2.clientW}`);

    // Summary tab
    await page.click('#tab-sum'); await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-summary.png`, fullPage: true });
    const m3 = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    if (m3.scrollW > m3.clientW + 1) note(name, `horizontal overflow on Summary: ${m3.scrollW} > ${m3.clientW}`);

    // Setup tab
    await page.click('#tab-set'); await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-setup.png`, fullPage: true });

    // font-size of text inputs: <16px makes iOS Safari zoom on focus
    const inputs = await page.evaluate(() => [...document.querySelectorAll('input[type=text],input[type=password],input[type=time],textarea')]
      .map(el => ({ id: el.id, fs: parseFloat(getComputedStyle(el).fontSize) })).filter(x => x.fs < 16));
    for (const i of inputs) note(name, `input #${i.id} font-size ${i.fs}px (<16px makes iOS Safari zoom the page on focus)`);

    if (errs.length) for (const e of [...new Set(errs)]) note(name, 'JS ERROR: '+e);
    if (name === 'iphone-se') console.log('metrics', JSON.stringify(m), '\ntabs', JSON.stringify(tabs));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log('\n===== PROBLEMS ('+problems.length+') =====');
  const uniq = [...new Set(problems.map(p=>p.replace(/^[a-z0-9-]+: /,'')))];
  console.log(problems.join('\n'));
  console.log('\n--- distinct issues: '+uniq.length+' ---');
})();
