const fs = require('fs');
const path = process.argv[2] || 'src/CallAssessments.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path); process.exit(1); }
if (s.includes('scoreBand')) { console.error('Already patched. No changes made.'); process.exit(1); }
const edits = [
  { find: '  const [dir, setDir] = useState("");',
    repl: '  const [dir, setDir] = useState("");\n  const [scoreBand, setScoreBand] = useState("");   // "" = all; else "20-30" style band' },
  { find: '  const lowest = useMemo(() => cur.slice().sort((a, b) => a.score - b.score).slice(0, 12), [cur]);',
    repl: '  const lowest = useMemo(() => {\n    const sorted = cur.slice().sort((a, b) => a.score - b.score);\n    if (!scoreBand) return sorted.slice(0, 12);\n    const [lo, hi] = scoreBand.split("-").map(Number);\n    return sorted.filter((c) => c.score >= lo && (hi >= 100 ? c.score <= 100 : c.score < hi)).slice(0, 200);\n  }, [cur, scoreBand]);' },
  { find: '        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>\n          <div style={H}>Lowest-scoring calls</div>\n          <div style={SUB}>the 12 lowest scores in this period, with the AI summary</div>\n        </div>',
    repl: '        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>\n          <div>\n            <div style={H}>{scoreBand ? `Calls scoring ${scoreBand.split("-").join("–")}%` : "Lowest-scoring calls"}</div>\n            <div style={SUB}>{scoreBand ? `${lowest.length} call${lowest.length === 1 ? "" : "s"} in this band, lowest first` : "the 12 lowest scores in this period, with the AI summary"}</div>\n          </div>\n          <select value={scoreBand} onChange={(e) => setScoreBand(e.target.value)} style={selectStyle}>\n            <option value="">Lowest 12 (default)</option>\n            {[["0-10","0–10%"],["10-20","10–20%"],["20-30","20–30%"],["30-40","30–40%"],["40-50","40–50%"],["50-60","50–60%"],["60-70","60–70%"],["70-80","70–80%"],["80-90","80–90%"],["90-100","90–100%"]].map(([v, lbl]) => (\n              <option key={v} value={v}>{lbl}</option>\n            ))}\n          </select>\n        </div>' },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error("ABORT: found " + n + " for: " + e.find.slice(0,45)); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched CallAssessments.jsx — score-band filter added to the calls table.');
