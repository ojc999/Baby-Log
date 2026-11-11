require('./harness.js');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('No <script> block found in index.html'); process.exit(1); }
const src = m[1];
// expose internals for testing
eval(src + '\n;global.__api = {parseMessage, add, undo, entries:()=>entries, setEntries:v=>{entries=v}, dirty:()=>dirty, jsonlFor, mergeForeign, sleepIntervals, daySG, isoSG, hhmm, dur, describe, label, stamp, cfg, setAbs:v=>{absTime=v}, setOff:v=>{offsetMin=v}, CATS, SHEETS, CAT_OF, LABELS, numOrNull, pumpOf, pumpStats, parsePumpNotes, splitTop_, readSession_, dayFromDM_, statsOf, addsJoin, addsSplit, addsWords, takesAdds, ADDS, dosesIn};');
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

console.log('\n--- tummy time is its own category ---');
t('it has a catalogue entry', !!A.CATS.tummy, true);
t('its buttons route to it, not to More', A.CAT_OF.tummy, 'tummy');
t('it is no longer offered inside More',
  JSON.stringify(A.CATS.more.groups).indexOf('tummy'), -1);
t('the timed button still has its amount picker', !!A.SHEETS.tummy, true);
t('and an untimed button that carries no value',
  A.CATS.tummy.groups.some(g => g.items.some(i => i.t === 'tummy' && !i.sheet)), true);
t('a sheet button can be relabelled without changing what is stored',
  A.SHEETS.tummy.title, 'Tummy time');
t('an untimed entry describes without minutes',
  A.describe({type:'tummy',subtype:'',value:null,unit:'',note:''}), 'Tummy time');
t('a timed one keeps them',
  A.describe({type:'tummy',subtype:'',value:10,unit:'min',note:''}), 'Tummy time 10 min');

console.log('\n--- the vomit button sits where you look for it ---');
(function () {
  var g = A.CATS.feed.groups;
  var vomitAt = g.findIndex(x => x.items.some(i => i.t === 'vomit'));
  var pumpAt  = g.findIndex(x => x.items.some(i => i.sheet === 'pump'));
  t('it is on the Feed screen', vomitAt > -1, true);
  t('directly after the feed buttons, not below Mum', vomitAt < pumpAt, true);
  t('and full width', g[vomitAt].cols, 1);
  t('it logs its own type, never a feed',
    A.describe({type:'vomit',subtype:'',value:null,unit:'',note:''}), 'Vomit');
  t('which is filed under Feed for reading back', A.CAT_OF.vomit, 'feed');
})();

console.log('\n--- hygiene lives inside More ---');
t('it is no longer a category of its own', !!A.CATS.hygiene, false);
t('its entries route to More', A.CAT_OF.hygiene, 'more');
t("the bot's old bath type goes there too", A.CAT_OF.bath, 'more');
t('and its buttons are offered inside More',
  JSON.stringify(A.CATS.more.groups).indexOf('hygiene') > -1, true);
t('all six survived the move',
  JSON.stringify(A.CATS.more.groups).match(/"t":"hygiene"/g).length, 6);

console.log('\n--- the five tiles on the home screen ---');
t('four categories plus More', Object.keys(A.CATS).join(','), 'sleep,feed,nappy,tummy,more');

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

// The archive format's field names and order, as a synthetic row held inline. Deliberately
// not a read of the real archive: that made the suite unrunnable anywhere but one laptop,
// and real entries must never reach this repo. Inline rather than a fixture file because
// .gitignore excludes *.jsonl here on purpose, and that guard should stay absolute.
// Keep in step with docs/background.md §6.
const real = JSON.parse('{"ts":"2026-01-02T03:14:00+08:00","sender":"EXAMPLE","type":"sleep",' +
  '"subtype":"start","value":null,"unit":"","note":"","raw":"asleep now","msg_id":"web-example-0001"}');
// The three fields the pump tab added, appended after msg_id and written onto every row.
const ADDED = ['dur_min','ml_l','ml_r','pump_dev','added'];
const out = A.jsonlFor('2026-10-01').trim().split('\n').map(JSON.parse);
t('export has all three incl deleted', out.length, 3);
t('the original nine come first, in the original order',
  JSON.stringify(Object.keys(out[0]).slice(0, 9)), JSON.stringify(Object.keys(real)));
t('and the added ones come after, in order',
  JSON.stringify(Object.keys(out[0]).slice(9)), JSON.stringify(ADDED));
t('nothing else crept in', Object.keys(out[0]).length, 14);
t('the number ones are null on a row that has no use for them',
  ['dur_min','ml_l','ml_r'].every(k => out[0][k] === null), true);
t('and the text ones are empty strings, not null',
  [out[0].pump_dev, out[0].added].join('|'), '|');
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

console.log('\n--- the pump tab: a session carries two numbers, not one ---');
A.setEntries([]);
const pbase = Date.UTC(2026, 9, 31, 1, 0);          // 09:00 SG, 31 Oct
const ps = A.add('pump', '', 65, 'ml', '', 'pump 65 ml', pbase, {ml_l: 30, ml_r: 35});
t('the volume is the value', ps.value, 65);
t('each side is its own field', ps.ml_l + '/' + ps.ml_r, '30/35');
t('an empty box is null, not zero', A.add('pump','',40,'ml','','pump 40',pbase+60000,{}).ml_l, null);
t('they survive the export',
  JSON.parse(A.jsonlFor('2026-10-31').trim().split('\n')[0]).ml_l, 30);
// dur_min is no longer collected - the minutes that matter are his at the breast - but it
// stays in the contract so the archive keeps one shape and the rows that have it keep it.
t('pump duration is no longer written', ps.dur_min, null);
t('which machine is its own field, not a subtype',
  A.add('pump','',50,'ml','','p',pbase+120000,{pump_dev:'imani'}).pump_dev, 'imani');
t('so a power pump on the Imani can say both',
  A.describe({type:'pump',subtype:'power',value:50,unit:'ml',note:'',pump_dev:'imani'}),
  'Power pumped 50 ml · Imani');
t('and a hand expression names no machine',
  A.describe({type:'pump',subtype:'hand',value:8,unit:'ml',note:'',pump_dev:''}),
  'Hand expressed 8 ml');
t('but the field is still exported',
  'dur_min' in JSON.parse(A.jsonlFor('2026-10-31').trim().split('\n')[0]), true);
t('and a row that already carries one still reads back',
  A.describe({type:'pump',subtype:'',value:65,unit:'ml',note:'',dur_min:20}),
  'Mum expressed 65 ml in 20 min');
t('describe names the split',
  A.describe({type:'pump',subtype:'',value:65,unit:'ml',note:'',ml_l:30,ml_r:35}),
  'Mum expressed 65 ml (L 30 / R 35)');
t('and leaves out what was not recorded',
  A.describe({type:'pump',subtype:'',value:65,unit:'ml',note:''}), 'Mum expressed 65 ml');
t('hand expression has its own label', A.label({type:'pump',subtype:'hand'}), 'Hand expressed');
t('so does a power pump', A.label({type:'pump',subtype:'power'}), 'Power pumped');
t('an old row with no subtype still reads', A.label({type:'pump',subtype:''}), 'Mum expressed');

console.log('\n--- a day\u2019s pump figures ---');
A.setEntries([]);
A.add('pump', '',      60, 'ml', '', 'p', pbase);
A.add('pump', 'power', 30, 'ml', '', 'p', pbase + 3600000);
A.add('pump', 'hand',  10, 'ml', '', 'p', pbase + 7200000);
A.add('feed', 'breast', 25, 'min', 'left', 'bf', pbase + 1800000);
A.add('feed', 'breast', 15, 'min', 'right', 'bf', pbase + 9000000);
A.add('feed', 'breast', null, '', '', 'bf', pbase + 10800000);   // logged without minutes
A.add('feed', 'expressed', 80, 'ml', '', 'ebm 80', pbase + 5400000);
const st = A.pumpStats('2026-10-31');
t('three sessions', st.n, 3);
t('volumes summed', st.ml, 100);
t('expressed milk he drank is not counted as production', st.ml === 100, true);
t('time at the breast comes from the breastfeeds', st.latchMin, 40);
t('every breastfeed is counted, timed or not', st.latches, 3);
t('and the untimed one is flagged rather than treated as zero', st.untimedLatch, 1);
t('how long she spent at the pump is not among the figures', 'mins' in st, false);
t('a day with nothing is empty, not an error', A.pumpStats('2026-10-30').n, 0);

console.log('\n--- reading up a page of notes ---');
// Synthetic lines in the shape the notebook is written in. Not real records.
const NOW = Date.parse('2026-10-31T18:00:00+08:00');
A.setEntries([]);
const r1 = A.parsePumpNotes('3 Oct: 12mL hand expression', NOW);
t('one day read', r1.days.length, 1);
t('the year is this one', r1.days[0].day, '2026-10-03');
t('hand expression is read as such', r1.days[0].sessions[0].how, 'hand');
t('and its volume', r1.days[0].sessions[0].ml, 12);

const r2 = A.parsePumpNotes('4 Oct: 11mL x2 pump', NOW);
t('"x2" is two pumps in the sitting', r2.days[0].sessions[0].pumps, 2);
t('and twice the volume', r2.days[0].sessions[0].ml, 22);

const r3 = A.parsePumpNotes('5 Oct: 22mL pump (no overnight latch), 33mL (power pump after latching)', NOW);
t('a comma outside brackets splits sessions', r3.days[0].sessions.length, 2);
t('the day total adds up', r3.days[0].ml, 55);
t('power pump is read from inside the bracket', r3.days[0].sessions[1].how, 'power');

const r4 = A.parsePumpNotes('6 Oct: 44mL (2h after feed, 7mL from hand expression)', NOW);
t('a comma inside brackets does not', r4.days[0].sessions.length, 1);
t('a volume inside the bracket is not added to the session', r4.days[0].sessions[0].ml, 44);
t('and does not make it a hand expression', r4.days[0].sessions[0].how, '');
t('the bracket is kept as the note', /7mL from hand expression/.test(r4.days[0].sessions[0].note), true);
t('and the whole line is kept as raw',
  r4.days[0].sessions[0].raw, '44mL (2h after feed, 7mL from hand expression)');

const r5 = A.parsePumpNotes('7 Oct: 21mL + 13mL + 6mL (2h after latching, 11/10mL, 6/7mL, 3/3mL)', NOW);
t('several volumes in one sitting are one session', r5.days[0].sessions.length, 1);
t('summed', r5.days[0].sessions[0].ml, 40);
t('and counted', r5.days[0].sessions[0].pumps, 3);
// one pair per pump, each adding up to its own pump, so the sides account for the sitting
t('left is the sum of the first of each pair', r5.days[0].sessions[0].ml_l, 20);
t('and right the second', r5.days[0].sessions[0].ml_r, 20);

console.log('\n--- the side split is taken only when it accounts for the session ---');
const s1 = A.parsePumpNotes('18 Oct: 61mL (2h after latch, 28/33mL)', NOW).days[0].sessions[0];
t('a single pair that adds up is read as left then right', s1.ml_l + '/' + s1.ml_r, '28/33');
const s2 = A.parsePumpNotes('19 Oct: 71mL (3h after pump, 26/40mL, 5mL from hand expression)', NOW).days[0].sessions[0];
t('a pair that leaves millilitres unaccounted for records no side', s2.ml_l, null);
t('and the session total is still right', s2.ml, 71);
const s3 = A.parsePumpNotes('20 Oct: 66mL + 16mL + 6mL (4h, 36/30mL, 6/10mL, 6mL hand expression)', NOW).days[0].sessions[0];
t('one pair short of the pumps records no side', s3.ml_l, null);
const s4 = A.parsePumpNotes('21 Oct: 41mL (2h after feed, 9mL from hand expression)', NOW).days[0].sessions[0];
t('no pair at all records no side', s4.ml_l, null);

console.log('\n--- which machine ---');
t('an ordinary pump is taken as the Spectra, as she said to assume',
  A.parsePumpNotes('22 Oct: 51mL pump', NOW).days[0].sessions[0].kit, 'spectra');
t('a line naming the other one is read',
  A.parsePumpNotes('23 Oct: 51mL pump (on the Imani)', NOW).days[0].sessions[0].kit, 'imani');
t('a hand expression names no machine',
  A.parsePumpNotes('24 Oct: 7mL hand expression', NOW).days[0].sessions[0].kit, '');
t('a power pump is still a machine', 
  A.parsePumpNotes('25 Oct: 31mL (power pump after latch)', NOW).days[0].sessions[0].kit, 'spectra');

const r6 = A.parsePumpNotes('8 Oct: 23/41mL (2h after latch, 11/30mL)', NOW);
t('an ambiguous reading before the bracket is left unread', r6.days[0].sessions.length, 0);
t('and reported as unread rather than dropped', r6.days[0].unread.length, 1);

const r7 = A.parsePumpNotes('9 Oct: 51mL (3h after pump at 4am), 27mL (power pump)', NOW);
t('a stated time with am/pm is used', A.hhmm(r7.days[0].sessions[0].ms), '04:00');
t('and is not marked as placed', !!r7.days[0].sessions[0].guessed, false);
t('one with no time is placed and says so', !!r7.days[0].sessions[1].guessed, true);
t('sessions come out in time order', r7.days[0].sessions[0].ms < r7.days[0].sessions[1].ms, true);

const r8 = A.parsePumpNotes('10 Oct: 19mL pump (after 6+h from last feed, 19mm flanges)', NOW);
t('a number that is not a time is not read as one', !!r8.days[0].sessions[0].guessed, true);

const r9 = A.parsePumpNotes('Breastfeeding\n11 Oct: 31mL pump,\n17mL pump (power pump after latch)', NOW);
t('a wrapped line belongs to the day above it', r9.days[0].sessions.length, 2);
t('a heading is reported as not a day', r9.unread.length, 1);
t('and does not become an entry', r9.days.length, 1);

const r10 = A.parsePumpNotes('32 Foo: 10mL pump', NOW);
t('a line with no readable date is unread', r10.unread.length, 1);
t('and makes no day', r10.days.length, 0);

const r11 = A.parsePumpNotes('25 Dec: 10mL pump', NOW);
t('a date later in this year belongs to last year', r11.days[0].day, '2025-12-25');

const r12 = A.parsePumpNotes('31 Oct: 15mL pump, 15mL pump, 15mL pump, 15mL pump', NOW);
t('placed times never land in the future',
  r12.days[0].sessions.every(s => s.ms <= NOW), true);

const r14 = A.parsePumpNotes('12 Oct: 18mL pump | midnight latch without top up', NOW);
t('words after the volume are kept when there is no bracket',
  r14.days[0].sessions[0].note, 'midnight latch without top up');
t('and the method word is not repeated in them', /pump/.test(r14.days[0].sessions[0].note), false);

const r15 = A.parsePumpNotes('13 Oct: 29mL (at 11.30pm) | 2 daytime latches', NOW);
t('text after the bracket closes is kept too',
  r15.days[0].sessions[0].note, 'at 11.30pm · 2 daytime latches');
t('and no stray bracket comes with it', /\)/.test(r15.days[0].sessions[0].note), false);
t('the time in it is still read', A.hhmm(r15.days[0].sessions[0].ms), '23:30');

const r16 = A.parsePumpNotes('14 Oct: 33mL (2h after latch, 18/15mL. 44mL after power pumping)', NOW);
t('a volume left in the note is flagged for checking', r16.days[0].sessions[0].stray, '44 ml');
t('but the session that was read is still saved', r16.days[0].sessions[0].ml, 33);
const r17 = A.parsePumpNotes('15 Oct: 36mL (2h after feed, 7mL from hand expression)', NOW);
t('a few ml of hand expression inside a pump is not flagged', r17.days[0].sessions[0].stray, '');
const r18 = A.parsePumpNotes('16 Oct: 41mL (2h after latch, 19/22mL)', NOW);
t('neither is half of a left/right split', r18.days[0].sessions[0].stray, '');

A.setEntries([]);
A.add('pump', '', 50, 'ml', '', 'p', Date.parse('2026-10-20T10:00:00+08:00'), {});
const r13 = A.parsePumpNotes('20 Oct: 60mL pump\n21 Oct: 70mL pump', NOW);
t('a day that already has sessions is marked as such', r13.days[0].had, 1);
t('and one that does not, is not', r13.days[1].had, 0);

console.log('\n--- what goes into a bottle ---');
t('nothing added is an empty string', A.addsJoin({}), '');
t('one of them', A.addsJoin({simeticone:true}), 'simeticone');
t('the other', A.addsJoin({biogaia:true}), 'biogaia');
// the pair must have one spelling, whichever order they were tapped in
t('both, tapped either way, spell the same',
  A.addsJoin({simeticone:true,biogaia:true}), A.addsJoin({biogaia:true,simeticone:true}));
t('and that spelling is alphabetical', A.addsJoin({biogaia:true,simeticone:true}), 'biogaia+simeticone');
t('it reads back as a set', JSON.stringify(A.addsSplit('biogaia+simeticone')),
  JSON.stringify({biogaia:true,simeticone:true}));
t('an empty one reads back empty', JSON.stringify(A.addsSplit('')), '{}');
t('and it is shown in words', A.addsWords('biogaia+simeticone'), 'BioGaia + Simeticone');

t('a formula feed can take them', A.takesAdds('feed','formula'), true);
t('so can expressed milk', A.takesAdds('feed','expressed'), true);
t('a breastfeed cannot', A.takesAdds('feed','breast'), false);
t('nor can a nappy', A.takesAdds('nappy','wet'), false);
t('the retired bottle still can, so old rows stay correctable',
  A.takesAdds('feed','bottle'), true);

A.setEntries([]);
const fa = A.add('feed','formula',90,'ml','','formula 90', Date.parse('2026-11-01T10:00:00+08:00'),
                 {added:'biogaia+simeticone'});
t('it is stored as its own field, not in the note', fa.added, 'biogaia+simeticone');
t('and the note is left alone', fa.note, '');
t('it survives the export',
  JSON.parse(A.jsonlFor('2026-11-01').trim().split('\n')[0]).added, 'biogaia+simeticone');
t('describe names what went in',
  A.describe({type:'feed',subtype:'formula',value:90,unit:'ml',note:'',added:'simeticone'}),
  'Formula 90 ml · with Simeticone');
t('and both when both did',
  A.describe({type:'feed',subtype:'expressed',value:60,unit:'ml',note:'',added:'biogaia+simeticone'}),
  'Expressed milk 60 ml · with BioGaia + Simeticone');
t('a feed with nothing added reads as before',
  A.describe({type:'feed',subtype:'formula',value:90,unit:'ml',note:''}), 'Formula 90 ml');

console.log('\n--- counting the doses ---');
const DAY = '2026-11-03T';
const dr = [
  {type:'feed',subtype:'formula',  added:'simeticone'},
  {type:'feed',subtype:'expressed',added:'biogaia+simeticone'},
  {type:'feed',subtype:'formula',  added:'simeticone'},
  {type:'feed',subtype:'breast',   added:''},
  {type:'feed',subtype:'formula'},                       // older row, no field at all
  {type:'nappy',subtype:'wet',     added:''}
];
const dc = A.dosesIn(dr);
t('each feed carrying it counts once', dc.simeticone, 3);
t('a feed carrying both counts for each', dc.biogaia, 1);
t('a feed with nothing added counts for neither', dc.simeticone + dc.biogaia, 4);
t('and a row written before the field existed does not break it', !!A.dosesIn([{type:'feed'}]), true);
t('an empty set counts zero, not undefined', JSON.stringify(A.dosesIn([])),
  JSON.stringify({simeticone:0, biogaia:0}));
// one feed with one dose is one dose, however many times it is counted
t('counting is per feed, not per millilitre',
  A.dosesIn([{type:'feed',added:'simeticone',value:200}]).simeticone, 1);

A.setEntries([]);
A.add('feed','formula',90,'ml','','f', Date.parse(DAY+'08:00:00+08:00'), {added:'simeticone'});
A.add('feed','formula',90,'ml','','f', Date.parse(DAY+'12:00:00+08:00'), {added:'biogaia+simeticone'});
A.add('feed','breast', 20,'min','left','f', Date.parse(DAY+'16:00:00+08:00'));
const sd = A.statsOf();
t('the whole record counts them too', sd.doses.simeticone, 2);
t('and the other one separately', sd.doses.biogaia, 1);
t('an undone feed takes its dose with it', (()=>{
  const last = A.entries().filter(r=>r.added==='biogaia+simeticone')[0];
  A.undo(last.msg_id);
  return A.statsOf().doses.simeticone; })(), 1);

console.log('\n--- the bottle button is gone, the rows are not ---');
t('no Bottle picker', !!A.SHEETS.bottle, false);
t('and no Bottle button in the feed catalogue',
  JSON.stringify(A.CATS.feed.groups).indexOf('bottle'), -1);
t('but feed/bottle still has a label, for the rows already logged under it',
  A.label({type:'feed',subtype:'bottle'}), 'Bottle');
t('and still describes', A.describe({type:'feed',subtype:'bottle',value:60,unit:'ml',note:''}),
  'Bottle 60 ml');
t('breast, formula and EBM are what is left',
  A.CATS.feed.groups.slice(0,2).map(g=>g.items.map(i=>i.sheet).join(',')).join(' | '),
  'breast | formula,expressed');

console.log('\n--- the whole story: everything added up ---');
A.setEntries([]);
const D = d => Date.parse('2026-10-' + String(d).padStart(2,'0') + 'T12:00:00+08:00');
A.add('nappy','wet',  null,'','','n', D(10));
A.add('nappy','dirty',null,'','','n', D(11));
A.add('nappy','both', null,'','','n', D(12));
A.add('feed','bottle',   90,'ml','','f', D(10) + 3600000);
A.add('feed','expressed',60,'ml','','f', D(11) + 3600000);
A.add('feed','breast',   25,'min','left','f', D(12) + 3600000);
A.add('pump','',         80,'ml','','p', D(12) + 7200000);
A.add('tummy','',        10,'min','','t', D(12) + 9000000);
A.add('hygiene','bath',null,'','','b', D(12) + 10800000);
A.add('vomit','',      null,'','','v', D(12) + 12600000);
A.add('measure','weight', 2.8,'kg','','w', D(10));
A.add('measure','weight', 3.5,'kg','','w', D(14));
// a 3-hour sleep, and a start whose end was never logged
A.add('sleep','start',null,'','','s', D(11) + 72000000);
A.add('sleep','end',  null,'','','s', D(11) + 82800000);
A.add('sleep','start',null,'','','s', D(13) + 72000000);
const S = A.statsOf();
t('every nappy counted', S.nappies, 3);
t('"both" counts as wet', S.wet, 2);
t('and as dirty', S.dirty, 2);
t('milk drunk is the millilitre feeds', S.ml, 150);
t('expressing is not added to it', S.ml === 150, true);
t('expressing has its own total', S.pumpMl, 80);
t('time at the breast is kept in minutes', S.breastMin, 25);
t('all three feeds counted', S.feeds, 3);
t('the biggest single feed is found', S.biggest.value, 90);
t('tummy time summed', S.tummyMin, 10);
t('baths counted', S.baths, 1);
t('and what came back up', S.vomits, 1);
t('one complete sleep', S.sleeps, 1);
t('of three hours', A.dur(S.sleepMs), '3h 0m');
t('the longest is that one', A.dur(S.longest.ms), '3h 0m');
t('the sleep with no end is reported, not guessed at', S.unpaired, 1);
t('both weights kept, oldest first', S.weights.map(r=>r.value).join(','), '2.8,3.5');
t('the span runs first day to last', S.span, 5);
// 13 Oct has nothing on it: the 23-hour sleep started on the 11th ends on the 12th, and
// the last sleep start lands on the 14th. The span covers it; the day count does not.
t('a day inside the span with nothing on it is not counted', S.dayCount, 4);
t('every row is attributed', Object.values(S.who).reduce((a,b)=>a+b,0), S.rows);

console.log('\n--- what it leaves out ---');
const undone = A.entries().find(r => r.type === 'nappy');
A.undo(undone.msg_id);
const S2 = A.statsOf();
t('an undone nappy is not counted', S2.nappies, 2);
t('nor is it counted as an entry', S2.rows, S.rows - 1);

console.log('\n--- the small hours ---');
A.setEntries([]);
A.add('feed','bottle',60,'ml','','f', Date.parse('2026-10-20T02:10:00+08:00'));
A.add('nappy','wet',null,'','','n', Date.parse('2026-10-20T03:40:00+08:00'));
A.add('feed','bottle',60,'ml','','f', Date.parse('2026-10-20T05:55:00+08:00'));
A.add('feed','bottle',60,'ml','','f', Date.parse('2026-10-21T06:05:00+08:00'));
A.add('nappy','wet',null,'','','n', Date.parse('2026-10-21T14:00:00+08:00'));
const S3 = A.statsOf();
t('the busiest night is the one with most before 6am', S3.busiestNight.day, '2026-10-20');
t('and counts only those hours', S3.busiestNight.n, 3);
t('06:05 is morning, not night', S3.nights['2026-10-21'] || 0, 0);

console.log(fail ? '\n======== ' + fail + ' FAILURES ========' : '\n======== ALL PASS ========');
process.exit(fail ? 1 : 0);
