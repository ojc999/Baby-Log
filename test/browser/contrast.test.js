const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const SH=process.env.SHOTS||path.join(require('os').tmpdir(),'baby-log-shots');
fs.mkdirSync(SH,{recursive:true});
// WCAG relative luminance + contrast ratio
const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05)};
const parse=s=>{const m=s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);return m?[+m[1],+m[2],+m[3]]:null};
(async()=>{
  await new Promise(r=>server.listen(8768,r));
  const b=await chromium.launch();
  for (const scheme of ['dark','light']) {
    const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true,colorScheme:scheme,timezoneId:'Asia/Singapore'});
    const page=await ctx.newPage();
    await page.goto('http://localhost:8768/',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(400);
    await page.screenshot({path:`${SH}/${scheme}-home.png`});
    await page.click('[data-go="sleep"]'); await page.waitForTimeout(250);
    await page.screenshot({path:`${SH}/${scheme}-sleep.png`});
    // contrast of every bit of text against its own background
    const low = await page.evaluate(()=>{
      const out=[];
      const bgOf=el=>{let n=el;while(n){const c=getComputedStyle(n).backgroundColor;
        if(c&&!/rgba\(0, 0, 0, 0\)|transparent/.test(c))return c;n=n.parentElement}return 'rgb(255,255,255)'};
      for(const el of document.querySelectorAll('button,h1,h2,b,span,dt,dd,p,td,th,em,small,code')){
        const txt=(el.textContent||'').trim(); if(!txt||el.children.length)continue;
        const r=el.getBoundingClientRect(); if(r.width<2||r.height<2)continue;
        const cs=getComputedStyle(el);
        out.push({txt:txt.slice(0,20),fg:cs.color,bg:bgOf(el),size:parseFloat(cs.fontSize),weight:cs.fontWeight});
      }
      return out;
    });
    const bad=[];
    for(const o of low){const f=parse(o.fg),g=parse(o.bg); if(!f||!g)continue;
      const r=ratio(f,g); const large=o.size>=24||(o.size>=18.66&&+o.weight>=700);
      const need=large?3:4.5; if(r<need) bad.push(`${o.txt} ${r.toFixed(2)}:1 (needs ${need})`);}
    console.log(`${scheme}: ${low.length} text nodes checked, ${bad.length} below WCAG AA`);
    for(const x of [...new Set(bad)].slice(0,12)) console.log('   ', x);
    await ctx.close();
  }
  await b.close(); server.close();
})();
