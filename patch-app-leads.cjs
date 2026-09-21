// Adds the "Leads & Funnel" tab to the Customer Journey dashboard.
// Run from ~/my-dashboard:  node patch-app-leads.js
// Backs up App.jsx first, and aborts without changes if anything doesn't match exactly.
const fs = require('fs');
const path = process.argv[2] || 'src/App.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error(`Can't read ${path} — run this from the my-dashboard folder.`); process.exit(1); }

if (s.includes('EskimoLeads')) { console.error('Already patched (EskimoLeads is present). No changes made.'); process.exit(1); }

const edits = [
  { find: 'import CallAssessments from "./CallAssessments.jsx";',
    repl: 'import CallAssessments from "./CallAssessments.jsx";\nimport EskimoLeads from "./EskimoLeads.jsx";' },
  { find: '{[["journey","Customer Journey"],["scores","AI Call Assessments"]].map(([k,lbl]) => (',
    repl: '{[["journey","Customer Journey"],["leads","Leads & Funnel"],["scores","AI Call Assessments"]].map(([k,lbl]) => (' },
  { find: '{tab === "scores" && <CallAssessments refreshKey={refreshed ? refreshed.getTime() : 0} />}',
    repl: '{tab === "scores" && <CallAssessments refreshKey={refreshed ? refreshed.getTime() : 0} />}\n        {tab === "leads" && <EskimoLeads refreshKey={refreshed ? refreshed.getTime() : 0} />}' },
];
for (const e of edits) {
  const n = s.split(e.find).length - 1;
  if (n !== 1) { console.error(`ABORT: expected exactly 1 match, found ${n}, for:\n  ${e.find.slice(0, 70)}...`); process.exit(1); }
}
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log(`Patched ${path} (backup at ${path}.bak). Added the "Leads & Funnel" tab.`);
