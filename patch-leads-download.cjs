const fs = require('fs');
const path = process.argv[2] || 'src/EskimoLeads.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path + " — run from the my-dashboard folder."); process.exit(1); }
if (s.includes('downloadCSV')) { console.error('Already patched. No changes made.'); process.exit(1); }
const edits = [
  { find: `  const maxStage = STAGES.reduce((m, s) => Math.max(m, stageCounts[s] || 0), 0) || 1;`,
    repl: `  const maxStage = STAGES.reduce((m, s) => Math.max(m, stageCounts[s] || 0), 0) || 1;
  const downloadCSV = () => {
    const cols = ["Lead ID", "Date Created", "Salesperson", "Team", "Source", "Source Group", "Status", "Stage"];
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [cols.join(",")];
    cur.forEach((l) => lines.push([l.id, l.created, l.rep, l.team, l.source, l.group, l.status, l.stage].map(q).join(",")));
    const blob = new Blob(["\\uFEFF" + lines.join("\\r\\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-" + (team || "all") + "-" + (rep || "everyone") + "-" + period + "-" + isoOf(new Date()) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };` },
  { find: `        </select>
        <div style={{ ...SUB, marginLeft: "auto" }}>leads by creation date · {fmtDay(range.from)} – {fmtDay(range.to)}</div>`,
    repl: `        </select>
        <button onClick={downloadCSV} style={segBtn(false)} title="Download the leads matching the current filters, opens in Excel">⤓ Excel ({total})</button>
        <div style={{ ...SUB, marginLeft: "auto" }}>leads by creation date · {fmtDay(range.from)} – {fmtDay(range.to)}</div>` },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error("ABORT: found " + n + " matches (need 1) for: " + e.find.slice(0, 45)); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched EskimoLeads.jsx — Excel download button added to the Leads & Funnel tab.');
