const fs = require('fs');
const path = process.argv[2] || 'src/CallAssessments.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path); process.exit(1); }
if (s.includes('c.listen')) { console.error('Already patched. No changes made.'); process.exit(1); }
const edits = [
  { find: '          talk: toNum(r["talk secs"]), number: r["number"] || "", summary: r["summary"] || "",',
    repl: '          talk: toNum(r["talk secs"]), number: r["number"] || "", summary: r["summary"] || "", listen: (r["listen"] || "").trim(),' },
  { find: '                    <div style={{ color: "#64748B", fontSize: 11 }}>{c.dir} · {c.number}</div>',
    repl: '                    <div style={{ color: "#64748B", fontSize: 11 }}>{c.dir} · {c.number}</div>\n                    {c.listen && <a href={c.listen} target="_blank" rel="noopener noreferrer" style={{ color: "#91c7e8", fontSize: 11, fontWeight: 700, textDecoration: "none" }}>▶ Listen</a>}' },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error("ABORT: found " + n + " for: " + e.find.slice(0,45)); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched CallAssessments.jsx — Listen link added to lowest-scoring calls.');
