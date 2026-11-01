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
    // Seed a realistic day before loading. An empty app hides most of its own UI - the
    // timeline rows, the undo buttons, the summary tables - so an empty page is the one
    // state worth testing least. The undo button being under the tap-target floor was
    // missed exactly this way.
    await ctx.addInitScript(() => {
      const TZ = 'Asia/Singapore';
      const dayOf = ms => new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(ms));
      const iso = ms => { const f = new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
        const o={}; f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);
        return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`; };
      const H = 3600000, now = Date.now();
      const mk = (mins, sender, own, type, subtype, value, unit, note, raw) => {
        const ms = now - mins*60000;
        return { ms, ts: iso(ms), sender, type, subtype, value, unit, note, raw,
                 msg_id: 'seed-'+mins+'-'+type, own, device: own ? 'simon-phone' : 'wife-phone' };
      };
      const rows = [
        mk(620,'Simon',true ,'sleep','start',null,'','','asleep now'),
        mk(500,'Simon',true ,'sleep','end'  ,null,'','','up'),
        mk(495,'Wife' ,false,'feed','breast',22,'min','left','bf 22 left'),
        mk(430,'Simon',true ,'nappy','dirty',null,'','','poo'),
        mk(300,'Wife' ,false,'feed','bottle',90,'ml','','90ml'),
        mk(240,'Simon',true ,'pump','',120,'ml','','expressed 120'),
        mk(180,'Simon',true ,'measure','weight',3.84,'kg','','3.84kg'),
        mk(150,'Wife' ,false,'hygiene','bath',null,'','','bath'),
        mk(90 ,'Simon',true ,'feed','breast',18,'min','right','bf 18 right'),
        mk(45 ,'Simon',true ,'nappy','both',null,'','','both'),
        mk(20 ,'Simon',true ,'note','',null,'','','','note a bit unsettled after the feed'),
        mk(10 ,'Simon',true ,'deleted','',null,'','','mis-tap'),
      ];
      localStorage.setItem('babylog.entries.v2', JSON.stringify(rows));
      localStorage.setItem('babylog.dirty.v2', JSON.stringify({[dayOf(now)]: true}));
      localStorage.setItem('babylog.cfg.v2', JSON.stringify(
        {who:'Simon', device:'simon-phone', repo:'me/data', branch:'main', token:''}));
    });

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

    // Rows only exist once there is data: check their controls too.
    await page.click('#tab-sum'); await page.waitForTimeout(300);
    // Only the visible pane: a .row-x inside a hidden pane measures 0x0 and is not a finding.
    const rowBtns = await page.evaluate(() => [...document.querySelectorAll('.pane:not([hidden]) .row-x')]
      .map(el => { const r = el.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height)}; })
      .filter(b => b.w > 0 || b.h > 0));
    for (const b of rowBtns) if (b.w < 44 || b.h < 44) { note(name, `undo button on a log row is ${b.w}x${b.h}px (<44) - and it is destructive`); break; }
    // Either phone may strike out the other's entries now, so a row from the other phone
    // carrying controls is correct. What would be wrong is a struck-out row still
    // offering them, or a live row offering only one of the pair.
    const odd = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.pane:not([hidden]) .row')];
      let bad = 0;
      for (const r of rows) {
        const del = !!r.querySelector('[data-del]'), fix = !!r.querySelector('[data-fix]');
        if (r.classList.contains('del')) { if (del || fix) bad++; }
        else if (del !== fix) bad++;
      }
      return bad; });
    if (odd) note(name, `${odd} row(s) with a mismatched set of controls`);

    // Two ids the same means getElementById silently hands every caller the first one,
    // and a whole panel can end up rendered inside a button with every test still green.
    const dupIds = await page.evaluate(() => {
      const seen = {}, dup = [];
      document.querySelectorAll('[id]').forEach(el => {
        if (seen[el.id]) dup.push(el.id); else seen[el.id] = 1; });
      return [...new Set(dup)]; });
    for (const d of dupIds) note(name, `duplicate id #${d} — getElementById returns only the first`);

    // Pump tab: the chart and the notes box are the widest things in the app
    await page.click('#tab-pump'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-pump.png`, fullPage: true });
    // Fill the notes box and read it, so the preview is on screen when the pane is measured.
    await page.evaluate(() => {
      document.querySelector('#pm-imp').value =
        '12 Oct: 11mL hand expression\n' +
        '13 Oct: 22mL pump (no overnight latch), 33mL (power pump after a long latch)\n' +
        '14 Oct: 23/41mL (2h after latch, 11/30mL)';
      document.querySelector('#pm-imp-read').click(); });
    await page.waitForTimeout(400);
    // The panes are the scrollers, not the document, so documentElement.scrollWidth stays
    // at the viewport width however far a child spills. Measure the pane itself.
    const m5 = await page.evaluate(() => {
      const p = document.querySelector('#pane-pump');
      return { scrollW: p.scrollWidth, clientW: p.clientWidth,
               docW: document.documentElement.scrollWidth }; });
    if (m5.scrollW > m5.clientW + 1) note(name, `horizontal overflow inside Pump pane: ${m5.scrollW} > ${m5.clientW}`);
    if (m5.docW > 375 && name === 'iphone-se') note(name, `page itself overflows on Pump: ${m5.docW}`);
    const pumpSmall = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#pane-pump button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.width < 44 || r.height < 44) out.push(`${Math.round(r.width)}x${Math.round(r.height)}px : ${(el.textContent||el.id).trim().slice(0,24)}`);
      }
      return out; });
    for (const sm of pumpSmall) note(name, `tap target ${sm} (<44) on Pump`);
    // a bar whose fill is wider than its track means a day is being drawn off the edge
    const overfull = await page.evaluate(() => [...document.querySelectorAll('#pump-bars .bfill')]
      .filter(f => f.getBoundingClientRect().width > f.parentElement.getBoundingClientRect().width + 1).length);
    if (overfull) note(name, `${overfull} bar fill(s) wider than their track`);

    // Book tab
    await page.click('#tab-book'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-book.png`, fullPage: true });
    const m4 = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    if (m4.scrollW > m4.clientW + 1) note(name, `horizontal overflow on Book: ${m4.scrollW} > ${m4.clientW}`);

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
