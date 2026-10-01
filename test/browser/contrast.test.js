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
    await ctx.addInitScript(()=>{
      const TZ='Asia/Singapore';
      const iso=ms=>{const f=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
        const o={};f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);
        return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`;};
      const now=Date.now();
      const mk=(mins,sender,own,type,subtype,value,unit,note,raw)=>{const ms=now-mins*60000;
        return {ms,ts:iso(ms),sender,type,subtype,value,unit,note,raw,msg_id:'seed-'+mins,own,device:own?'simon-phone':'wife-phone'};};
      localStorage.setItem('babylog.entries.v2',JSON.stringify([
        mk(495,'Wife',false,'feed','breast',22,'min','left','bf 22 left'),
        mk(150,'Simon',true,'hygiene','bath',null,'','','bath'),
        mk(90,'Simon',true,'feed','breast',18,'min','right','bf 18 right'),
        mk(45,'Simon',true,'nappy','both',null,'','','both'),
        mk(20,'Simon',true,'deleted','',null,'','','mis-tap'),
      ]));
      localStorage.setItem('babylog.cfg.v2',JSON.stringify({who:'Simon',device:'simon-phone',repo:'me/d',branch:'main',token:''}));
    });
    const page=await ctx.newPage();
    await page.goto('http://localhost:8768/',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(400);
    await page.screenshot({path:`${SH}/${scheme}-home.png`});
    await page.click('[data-go="sleep"]'); await page.waitForTimeout(250);
    await page.screenshot({path:`${SH}/${scheme}-sleep.png`});
    // The amount sheet and the correction box only exist once opened, and a pressed chip
    // is a different colour pair from an unpressed one. Both were unchecked before.
    await page.click('#cat-back');
    await page.click('[data-go="feed"]'); await page.click('[data-sheet="breast"]');
    await page.waitForTimeout(300);
    // contrast of every bit of text against its own background
    let low = await page.evaluate(()=>{
      const out=[];
      const bgOf=el=>{let n=el;while(n){const c=getComputedStyle(n).backgroundColor;
        if(c&&!/rgba\(0, 0, 0, 0\)|transparent/.test(c))return c;n=n.parentElement}return 'rgb(255,255,255)'};
      for(const el of document.querySelectorAll('button,h1,h2,h3,b,span,dt,dd,p,td,th,em,small,code,label')){
        const txt=(el.textContent||'').trim(); if(!txt||el.children.length)continue;
        const r=el.getBoundingClientRect(); if(r.width<2||r.height<2)continue;
        const cs=getComputedStyle(el);
        out.push({txt:txt.slice(0,20),fg:cs.color,bg:bgOf(el),size:parseFloat(cs.fontSize),weight:cs.fontWeight});
      }
      return out;
    });
    // the correction box
    await page.click('#sheet-cancel').catch(()=>{});
    await page.click('#tab-sum'); await page.waitForTimeout(300);
    await page.evaluate(()=>{ const b=document.querySelector('#sum-timeline [data-fix]'); b&&b.click(); });
    await page.waitForTimeout(300);
    const low2 = await page.evaluate(()=>{
      const out=[];
      const bgOf=el=>{let n=el;while(n){const c=getComputedStyle(n).backgroundColor;
        if(c&&!/rgba\(0, 0, 0, 0\)|transparent/.test(c))return c;n=n.parentElement}return 'rgb(255,255,255)'};
      for(const el of document.querySelectorAll('#fix button,#fix h3,#fix p,#fix label,#toast span,#toast button')){
        const txt=(el.textContent||'').trim(); if(!txt||el.children.length)continue;
        const r=el.getBoundingClientRect(); if(r.width<2||r.height<2)continue;
        const cs=getComputedStyle(el);
        out.push({txt:txt.slice(0,20),fg:cs.color,bg:bgOf(el),size:parseFloat(cs.fontSize),weight:cs.fontWeight});
      }
      return out;
    });
    low.push(...low2);
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
