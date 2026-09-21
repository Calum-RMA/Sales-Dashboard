const fs = require('fs');
const path = process.argv[2] || 'src/CallAssessments.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error(`Can't read ${path} — run from the my-dashboard folder.`); process.exit(1); }
if (s.includes('repAvg')) { console.error('Already patched. No changes made.'); process.exit(1); }
const edits = [
  { find: '  const showingDone = pointMetric === "completed";',
    repl: '  const repAvg = new Map(repRows.map((r) => [r.rep, r.av]));\n  const showingDone = pointMetric === "completed";' },
  { find: '{n.split(" ")[0]}<br /><span style={{ fontSize: 10, fontWeight: 500 }}>{repGrid.calls.get(n).size} calls</span>',
    repl: '{n.split(" ")[0]}<br /><span style={{ fontSize: 10, fontWeight: 500 }}>{repGrid.calls.get(n).size} calls</span><br /><span style={{ fontSize: 11, fontWeight: 800, color: "#91c7e8" }}>{pctText(repAvg.get(n))} avg</span>' },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error(`ABORT: found ${n} matches (need 1) for: ${e.find.slice(0,50)}`); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched CallAssessments.jsx — average score added per rep on the Coaching Grid.');
