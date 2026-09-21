const fs = require('fs');
const path = process.argv[2] || 'src/EskimoLeads.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path); process.exit(1); }
if (s.includes('"New Opportunity"')) { console.error('Already patched.'); process.exit(1); }
const edits = [
  { find: 'const STAGES = ["New", "Contacted", "Quoted", "Appointment", "Sale agreed", "Deposit received", "Sale complete"];',
    repl: 'const STAGES = ["New Opportunity", "Pending", "Contacted", "Quoted", "Appointment", "Sale agreed", "Deposit received", "Sale complete"];' },
  { find: '  "New": "#5a93c4", "Contacted": "#1f7fc4", "Quoted": "#91c7e8", "Appointment": "#6ee7b7",',
    repl: '  "New Opportunity": "#5a93c4", "Pending": "#7d9cc0", "Contacted": "#1f7fc4", "Quoted": "#91c7e8", "Appointment": "#6ee7b7",' },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error("ABORT: found " + n + " for: " + e.find.slice(0,40)); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched EskimoLeads.jsx — funnel now has New Opportunity + Pending.');
