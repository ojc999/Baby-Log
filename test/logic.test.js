require('./harness.js');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('No <script> block found in index.html'); process.exit(1); }
const src = m[1];
// expose internals for testing
eval(src + '\n;global.__api = {parseMessage, add, undo, entries:()=>entries, setEntries:v=>{entries=v}, dirty:()=>dirty, jsonlFor, mergeForeign, sleepIntervals, daySG, isoSG, hhmm, dur, describe, label, stamp, cfg, setAbs:v=>{absTime=v}, setOff:v=>{offsetMin=v}, CATS, SHEETS, CAT_OF, LABELS};');
const A = global.__api;
let fail = 0;
const t = (n, got, want) => { const ok = String(got) === String(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + ' -> ' + got + (ok ? '' : '   expected: ' + want)); };

console.log('--- parser: the original 21 cases, against the copy inside index.html ---');
const now = new Date(2026, 9, 15, 3, 0, 0).getTime();
const cases = [
  ['down','sleep/start'],['asleep','sleep/start'],['up','sleep/end'],['woke','sleep/end'],
  ['30ml','feed/bottle 30 ml'],['60 ml formula','feed/formula 60 ml'],['bf 20','feed/breast 20 min'],
  ['latched 15 mins','feed/breast 15 min'],['poo','nappy/dirty'],['pee','nappy/wet'],['both','nappy/both'],
  ['pee + poo','nappy/wet | nappy/dirty'],['3.4kg','measure/weight 3.4 kg'],['head 35cm','measure/head 35 cm'],
  ['50cm','measure/length 50 cm'],['temp 37.8','measure/temp 37.8 C'],
  ['30ml then down','feed/bottle 30 ml | sleep/start'],['no','undo'],['rash on cheek','UNMATCHED']
];
for (const [inp, want] of cases) {
  const r = A.parseMessage(inp, now);
  const got = r.matched ? r.events.map(e => e.type + (e.subtype ? '/' + e.subtype : '') +
    (e.value !== '' ? ' ' + e.value : '') + (e.unit ? ' ' + e.unit : '')).join(' | ') : 'UNMATCHED';
  t(JSON.stringify(inp), got, want);
}
t('"down -20" is 20 min back', Math.round((now - A.parseMessage('down -20', now).events[0].ts)/60000), 20);
t('"up @0214" is 02:14', new Date(A.parseMessage('up @0214', now).events[0].ts).getHours(), 2);

console.log('\n--- the consuming-keyword trap ---');
const nt = A.parseMessage('note why is he not pooping', now);
t('stays one note', nt.events.length, 1);
t('type is note', nt.events[0].type, 'note');
t('no nappy logged', nt.events.map(e=>e.type).includes('nappy'), false);
t('words kept intact', nt.events[0].note, 'why is he not pooping');

console.log('\n--- every catalogue button maps to a known label ---');
let unlabelled = [];
for (const [k, c] of Object.entries(A.CATS))
  for (const g of c.groups) for (const it of g.items) {
    if (it.t !== undefined) { const key = it.t + '/' + it.s;
      if (!A.LABELS[key]) unlabelled.push(key);
      if (!A.CAT_OF[it.t]) unlabelled.push('CAT_OF:' + it.t); }
    if (it.sheet) { const sc = A.SHEETS[it.sheet];
      if (!sc) unlabelled.push('SHEET:' + it.sheet);
      else if (!A.LABELS[sc.t + '/' + sc.s]) unlabelled.push(sc.t + '/' + sc.s); }
  }
t('unlabelled buttons', unlabelled.join(',') || 'none', 'none');

console.log('\n--- writing, undo, and the export schema ---');
A.cfg.who = 'Simon'; A.cfg.device = 'simon-phone';
A.setEntries([]);
const base = Date.UTC(2026, 9, 1, 11, 30);           // 19:30 SG
A.add('feed', 'bottle', 60, 'ml', '', 'bottle 60 ml', base);
A.add('sleep', 'start', '', '', '', 'asleep now', base + 3600000);
const e3 = A.add('nappy', 'dirty', '', '', '', 'dirty', base + 7200000);
t('three entries', A.entries().length, 3);
t('day marked dirty', !!A.dirty()['2026-10-01'], true);
A.undo(e3.msg_id);
t('undo keeps the row', A.entries().length, 3);
t('undo marks it deleted', A.entries().find(r=>r.msg_id===e3.msg_id).type, 'deleted');

// The field names and order of the archive format, as a synthetic row. Deliberately not a
// read of the real archive: that made the suite unrunnable anywhere but one laptop, and
// real entries must never reach this repo. Keep in step with docs/background.md §6.
const real = JSON.parse(fs.readFileSync(__dirname + '/schema-fixture.jsonl','utf8').trim().split('\n')[0]);
const out = A.jsonlFor('2026-10-01').trim().split('\n').map(JSON.parse);
t('export has all three incl deleted', out.length, 3);
t('field names and order match archive', JSON.stringify(Object.keys(out[0])), JSON.stringify(Object.keys(real)));
t('ts carries +08:00', /\+08:00$/.test(out[0].ts), true);
t('ts is SG wall clock', out[0].ts, '2026-10-01T19:30:00+08:00');
t('absent value is null', out[1].value, null);
t('no internal fields leak', ['own','ms','device'].some(k => k in out[0]), false);

console.log('\n--- backdating ---');
A.setOff(45); A.setAbs('');
const bd = A.stamp();
t('offset backdates 45 min', Math.round((Date.now() - bd)/60000), 45);
A.setOff(0); A.setAbs('02:14');
t('explicit time gives 02:14 SG', A.hhmm(A.stamp()), '02:14');
t('explicit time is in the past', A.stamp() <= Date.now() + 60000, true);
A.setAbs('');

console.log('\n--- a pull from the other phone replaces only that phone/day ---');
A.setEntries([]);
A.cfg.device = 'simon-phone';
A.add('feed','bottle',60,'ml','','x', Date.UTC(2026,9,1,4,0));
A.mergeForeign('{"ts":"2026-09-30T08:00:00+08:00","sender":"W","type":"nappy","subtype":"wet","value":null,"unit":"","note":"","raw":"pee","msg_id":"w-old"}\n','wife-phone','2026-09-30');
A.mergeForeign('{"ts":"2026-10-01T09:00:00+08:00","sender":"W","type":"feed","subtype":"breast","value":20,"unit":"min","note":"","raw":"bf 20","msg_id":"w-1"}\n','wife-phone','2026-10-01');
t('own + both foreign days kept', A.entries().length, 3);
// re-pull today only: must replace today's wife rows, keep her 30 Sep row
A.mergeForeign('{"ts":"2026-10-01T09:00:00+08:00","sender":"W","type":"feed","subtype":"breast","value":25,"unit":"min","note":"","raw":"bf 25","msg_id":"w-1"}\n{"ts":"2026-10-01T12:00:00+08:00","sender":"W","type":"nappy","subtype":"both","value":null,"unit":"","note":"","raw":"both","msg_id":"w-2"}\n','wife-phone','2026-10-01');
t('re-pull does not duplicate', A.entries().filter(r=>r.msg_id==='w-1').length, 1);
t('re-pull updates the value', A.entries().find(r=>r.msg_id==='w-1').value, 25);
t('her earlier day survives', A.entries().filter(r=>r.msg_id==='w-old').length, 1);
t('our own entry survives', A.entries().filter(r=>r.own).length, 1);
t('export excludes her rows', A.jsonlFor('2026-10-01').trim().split('\n').length, 1);

console.log('\n--- sleep pairing leaves gaps visible ---');
const si = A.sleepIntervals([
  {type:'sleep',subtype:'start',ms:0},{type:'sleep',subtype:'end',ms:90*60000},
  {type:'sleep',subtype:'start',ms:200*60000},
  {type:'sleep',subtype:'start',ms:300*60000},{type:'sleep',subtype:'end',ms:330*60000}
]);
t('pairs', si.pairs.length, 2);
t('unpaired reported', si.unpaired.length, 1);
t('total slept', A.dur(si.pairs.reduce((a,p)=>a+p.ms,0)), '2h 0m');

console.log('\n--- labels for the new hygiene subtypes ---');
for (const s of ['bath','wipe','nails','hair','cord','cream'])
  t('hygiene/'+s, A.label({type:'hygiene',subtype:s}) !== 'hygiene', true);
t('describe adds units', A.describe({type:'feed',subtype:'bottle',value:60,unit:'ml',note:''}), 'Bottle 60 ml');
t('describe adds side', A.describe({type:'feed',subtype:'breast',value:20,unit:'min',note:'left'}), 'Breastfeed 20 min, left');
t('describe temp degree', A.describe({type:'measure',subtype:'temp',value:37.8,unit:'C',note:''}), 'Temperature 37.8°C');

console.log(fail ? '\n======== ' + fail + ' FAILURES ========' : '\n======== ALL PASS ========');
process.exit(fail ? 1 : 0);
