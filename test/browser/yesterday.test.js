// Reaching yesterday from the middle of today. Clock pinned to 10:00 Singapore on 15 Oct.
//
// The picker rolled a time back a day only when it looked like the future, so at 10:00 a
// feed at 08:00 yesterday silently landed on today and nothing could say otherwise. The
// yesterday chip makes the whole of yesterday reachable; times after the current clock
// still roll back on their own, so logging last night's feed after midnight needs no
// extra tap.
//
// Verified to fail before the fix: without `dayBack`, "an 08:00 feed yesterday" returns
// 2026-10-15.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
(async()=>{
  await new Promise(r=>srv.listen(8900,r));
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true,timezoneId:'Asia/Singapore'});
  const page=await ctx.newPage();
  await page.clock.install({ time: new Date('2026-10-15T02:00:00Z') });   // 10:00 SGT, 15 Oct
  await page.goto('http://localhost:8900/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(400);
  console.log('app thinks it is', await page.evaluate(()=>daySG(Date.now())+' '+hhmm(Date.now())));
  console.log();
  const probe = async (hm, back) => page.evaluate(([h,bk])=>{
    absTime=h; dayBack=bk||0; const s=isoSG(stamp()); absTime=''; dayBack=0; return s; }, [hm, back]);
  for (const hm of ['08:00','09:30','10:30','14:00','22:00','23:59']) {
    const got = await probe(hm);
    console.log('   pick ' + hm + '  ->  ' + got.slice(0,16) + (got.slice(8,10)==='14' ? '   (yesterday)' : '   (today)'));
  }
  console.log();
  console.log('   with the yesterday chip armed:');
  for (const hm of ['08:00','09:30','14:00']) {
    console.log('   pick ' + hm + '  ->  ' + (await probe(hm,1)).slice(0,16));
  }
  console.log();
  t('a 14:00 feed yesterday is reachable without the chip', (await probe('14:00')).slice(0,10), '2026-10-14');
  t('an 08:00 feed yesterday needs the chip, and works', (await probe('08:00',1)).slice(0,10), '2026-10-14');
  t('at the time typed', (await probe('08:00',1)).slice(11,16), '08:00');
  t('09:30 yesterday too', (await probe('09:30',1)).slice(0,16), '2026-10-14T09:30');
  t('without the chip 08:00 still means today', (await probe('08:00')).slice(0,10), '2026-10-15');
  t('the chip never produces a future time', (await probe('23:59',1)).slice(0,10), '2026-10-14');

  console.log('--- through the actual buttons ---');
  await page.click('[data-go="feed"]');
  await page.fill('#when-time','08:00'); await page.waitForTimeout(150);
  await page.click('#when-yest'); await page.waitForTimeout(150);
  t('the chip reads as pressed', await page.getAttribute('#when-yest','aria-pressed'), 'true');
  t('and the row says what will happen', (await page.textContent('#when-lbl')).trim(), 'yesterday 08:00');
  await page.click('[data-sheet="bottle"]'); await page.waitForTimeout(200);
  await page.click('#sheet-save'); await page.waitForTimeout(600);
  const row = await page.evaluate(()=>{const r=entries[entries.length-1];return r.ts;});
  console.log('   saved as', row);
  t('the entry lands on yesterday morning', row.slice(0,16), '2026-10-14T08:00');
  t('and the row disarms itself afterwards', await page.evaluate(()=>dayBack), 0);
  t('the label is back to When', (await page.textContent('#when-lbl')).trim(), 'When');
  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
