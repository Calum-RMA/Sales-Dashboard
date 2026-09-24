const fs = require('fs');
const path = process.argv[2] || 'src/CallAssessments.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path); process.exit(1); }
if (s.includes('colorScheme: "dark"') && s.includes('background: "#1b1e23", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.14)"')) { console.error('Already patched.'); process.exit(1); }
const find = `  const selectStyle = {
    background: "rgba(255,255,255,0.05)", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 600,
  };`;
const repl = `  const selectStyle = {
    background: "#1b1e23", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 600, colorScheme: "dark",
  };`;
const n = s.split(find).length - 1;
if (n !== 1) { console.error("ABORT: found " + n + " (need 1)"); process.exit(1); }
fs.writeFileSync(path + '.bak', s);
s = s.replace(find, repl);
fs.writeFileSync(path, s);
console.log('Patched CallAssessments.jsx — dark dropdowns.');
