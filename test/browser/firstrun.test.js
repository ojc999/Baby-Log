// The unconfigured app, in a browser tab and as a home-screen app. On iOS those two have
// separate storage, which is the commonest way this app looks broken: set it up in Safari,
// add it to the home screen, and the home-screen copy opens empty - no token, and none of
// the entries you just watched arrive. The app has to say which of the two you are in.
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
  await new Promise(r=>srv.listen(8810,r));
  const b=await chromium.launch();
  const SH=process.env.SHOTS||path.join(require('os').tmpdir(),'baby-log-shots');
  fs.mkdirSync(SH,{recursive:true});

  for (const [name, standalone] of [['browser',false],['homescreen',true]]) {
    const ctx=await b.newContext({viewport:{width:375,height:667},isMobile:true,timezoneId:'Asia/Singapore'});
    if (standalone) await ctx.addInitScript(()=>{ Object.defineProperty(window.navigator,'standalone',{get:()=>true}); });
    const page=await ctx.newPage();
    await page.goto('http://localhost:8810/',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(400);
    const strip=((await page.textContent('#sync-txt'))||'').trim();
    await page.click('#tab-set'); await page.waitForTimeout(300);
    const first=((await page.textContent('#firstrun'))||'').trim();
    console.log('\n['+name+']');
    console.log('   strip   :', strip);
    console.log('   banner  :', first.slice(0,150)+'…');
    if (standalone) {
      t('names the home-screen storage split', /own storage/.test(first), true);
      t('says nothing is lost', /Nothing is lost/.test(first), true);
      t('strip says home screen', /Home screen app/.test(strip), true);
    } else {
      t('tells you to install first', /do that .{0,12}first/.test(first), true);
      t('strip is the ordinary one', /Not connected/.test(strip), true);
    }
    await page.screenshot({path:`${SH}/${name}.png`});

    // once set up, the banner must get out of the way
    await page.fill('#in-who','Wife'); await page.fill('#in-device','wife-phone');
    await page.fill('#in-repo','me/d'); await page.fill('#in-token','github_pat_X');
    await page.waitForTimeout(300);
    t('banner goes once configured', await page.isHidden('#firstrun'), true);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
