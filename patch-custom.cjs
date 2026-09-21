const fs = require('fs');
const path = process.argv[2] || 'src/EskimoLeads.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path); process.exit(1); }
if (s.includes('customFrom')) { console.error('Already patched. No changes made.'); process.exit(1); }
const edits = [
  { find: `  const [rep, setRep] = useState("");`,
    repl: `  const [rep, setRep] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");` },
  { find: `  const range = useMemo(() => {
    const today = isoOf(new Date());
    if (period === "all") {
      const first = leads.reduce((m, l) => (!m || l.created < m ? l.created : m), "") || today;
      return { from: first, to: today, days: Math.round((parseISO(today) - parseISO(first)) / 864e5) + 1 };
    }
    const n = Number(period);
    return { from: addDays(today, -(n - 1)), to: today, days: n };
  }, [period, leads]);`,
    repl: `  const range = useMemo(() => {
    const today = isoOf(new Date());
    if (period === "custom") {
      const a = customFrom || addDays(today, -29);
      const b = customTo || today;
      const from = a <= b ? a : b, to = a <= b ? b : a;
      return { from, to, days: Math.round((parseISO(to) - parseISO(from)) / 864e5) + 1 };
    }
    if (period === "all") {
      const first = leads.reduce((m, l) => (!m || l.created < m ? l.created : m), "") || today;
      return { from: first, to: today, days: Math.round((parseISO(today) - parseISO(first)) / 864e5) + 1 };
    }
    const n = Number(period);
    return { from: addDays(today, -(n - 1)), to: today, days: n };
  }, [period, leads, customFrom, customTo]);` },
  { find: `        <div style={{ display: "flex", gap: 6 }}>
          {[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setPeriod(v)} style={segBtn(period === v)}>{lbl}</button>
          ))}
        </div>`,
    repl: `        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setPeriod(v)} style={segBtn(period === v)}>{lbl}</button>
          ))}
          <button onClick={() => { setPeriod("custom"); if (!customFrom) setCustomFrom(addDays(isoOf(new Date()), -29)); if (!customTo) setCustomTo(isoOf(new Date())); }} style={segBtn(period === "custom")}>Custom</button>
          {period === "custom" && (
            <>
              <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...selectStyle, colorScheme: "dark" }} />
              <span style={{ color: "#64748B", fontSize: 12 }}>to</span>
              <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} style={{ ...selectStyle, colorScheme: "dark" }} />
            </>
          )}
        </div>` },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error("ABORT: found " + n + " for: " + e.find.slice(0,45)); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched EskimoLeads.jsx — Custom date range added.');
