import { useState, useMemo, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from "recharts";

/* ─── DATA SOURCE ────────────────────────────────────────────────────────────
   Two tabs on the scraped Google Sheet:
     • "Dashboard" — one row per person per MONTH  (full history, drives Month view)
     • "Daily"     — one row per person per DAY    (drives Day & Week views)
   On Netlify the requests hit /api/data and /api/daily, proxied to the sheet via
   public/_redirects (avoids CORS). On localhost we go through a CORS proxy.        */
const IS_LOCAL  = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const SHEET_ID  = "1VBZivRXHMPSwqhjpDL2aHzrJe_iazlfSO_vfwsj9LWw";
const GVIZ      = (tab) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${tab}`;
const MONTH_SRC = IS_LOCAL ? GVIZ("Dashboard") : "/api/data";
const DAILY_SRC = IS_LOCAL ? GVIZ("Daily")     : "/api/daily";

/* ─── CONSTANTS ──────────────────────────────────────────────────────────────*/
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Aggregate / non-salesperson rows we never want in the team picker or totals.
const EXCLUDE = ["finance rma","rma marketing","dashboard rma","totals"];
const isStaff = (name) => name && !EXCLUDE.includes(name.trim().toLowerCase());

// Conversion targets (rates).
const TARGETS = { snap:0.50, appt:0.33, kept:0.66, quote:0.30, order:0.20 };
const CONNECTED_PER_DAY = 40;   // connected-calls target, per sales rep per working day

// Sales reps we actively monitor — targets apply to these. Matched by first name so it works
// whether the sheet stores "Kat Durham" or "Katherine Durham", "Kaz"/"Kazeem", "Dan"/"Daniel".
const SALES_FIRST      = ["kazeem","kaz","roger","kat","katherine","cameron","cam","daniel","dan","sean"];
const PURCHASING_FIRST = ["richardo","ricardo","gordon","barry","ahmed","sean"];   // Sean is both
const firstName   = (name) => (name||"").toLowerCase().trim().split(/\s+/)[0];
const isSalesRep  = (name) => SALES_FIRST.includes(firstName(name));
const isPurchaser = (name) => PURCHASING_FIRST.includes(firstName(name));
const isWeekday   = (d) => { const g = d.getDay(); return g >= 1 && g <= 5; };

/* ─── RMA BRAND PALETTE ───────────────────────────────────────────────────────
   Charcoal #2b2b2b · Blue #004f8a · Light blue #91c7e8 · Red #ed2624 · White.
   ACCENT is the primary interactive colour (active controls, links, highlights). */
const RMA = {
  charcoal:"#23262b", charcoalDeep:"#15171b",
  blue:"#004f8a", blueBright:"#1f7fc4", blueLight:"#91c7e8",
  red:"#ed2624", white:"#ffffff",
  panel:"rgba(255,255,255,0.04)", panel2:"rgba(255,255,255,0.03)",
  line:"rgba(255,255,255,0.10)", lineSoft:"rgba(255,255,255,0.07)",
  ink:"#f4f6f8", inkDim:"#c5c9cf", inkFaint:"#8a8f97",
};
const ACCENT = RMA.red;          // primary interactive accent
const ACCENT_SOFT = "rgba(237,38,36,0.16)";
const ACCENT_LINE = "rgba(237,38,36,0.45)";

/* ─── COLOURS ─────────────────────────────────────────────────────────────────*/
// Per-person palette, derived from the RMA colours (blue / light-blue / red / steel / white tints).
const KNOWN_COLORS = { Cameron:"#1f7fc4", Dan:"#91c7e8", Kat:"#ed2624", Tom:"#5a93c4", Adil:"#c74038", Gustav:"#7fb2d8" };
const COLOR_PALETTE = [
  "#1f7fc4","#91c7e8","#ed2624","#5a93c4","#c74038","#004f8a","#b9dcf0","#e06b66",
  "#3f8fcf","#7fb2d8","#d83a33","#2e6fa8","#a7d2ec","#cf524b","#6aa6d2","#1a5f96",
  "#f0a09b","#4a86bd","#9ec9e6","#d14e47","#67a3cf","#2b6ba0","#c0deef","#e2554f"
];
const PERSON_COLORS = new Proxy({}, {
  get(_, name) {
    if (typeof name !== "string") return "#94A3B8";
    if (KNOWN_COLORS[name]) return KNOWN_COLORS[name];
    let h = 0; for (let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
    return COLOR_PALETTE[h % COLOR_PALETTE.length];
  }
});

/* ─── SMALL HELPERS ───────────────────────────────────────────────────────────*/
const pct    = (v) => v == null || isNaN(+v) ? "0.0%" : `${(+v*100).toFixed(1)}%`;
const fmtNum = (v) => (isNaN(+v) || v == null ? 0 : +v).toLocaleString();
const pad2   = (n) => (n < 10 ? "0" : "") + n;
const TOOLTIP_STYLE = { background:"#1b1e23", border:"1px solid rgba(255,255,255,0.12)", borderRadius:10, color:RMA.ink, fontSize:12 };

function splitCSVLine(l) {
  const cols = []; let cur = "", inQ = false;
  for (let i=0;i<l.length;i++) {
    const ch = l[i];
    if (ch === '"') { if (inQ && l[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
    else cur += ch;
  }
  cols.push(cur);
  return cols.map(c => c.trim());
}

// Build a column-index lookup from a CSV header row, then a row->object mapper.
function makeRowParser(headerLine) {
  const header = splitCSVLine(headerLine).map(h => h.toLowerCase());
  const col = (re) => header.findIndex(h => re.test(h));
  const idx = {
    person:       col(/sales\s*person/),
    month:        col(/^month$/),
    date:         col(/^date$/),
    enquiries:    col(/unique\s*customer/),
    snapCells:    col(/snap\s*cell/),
    appointments: col(/^appointments?$/),
    apptsKept:    col(/appts?\s*kept|appointments?\s*kept/),
    quotes:       col(/^quotes?$/),
    orders:       col(/total\s*orders/),
    outbound:     col(/outbound/),
    inbound:      col(/inbound/),
    connected:    col(/connected/),
  };
  const num = (cols, i) => {
    if (i == null || i < 0) return 0;
    const v = parseFloat(String(cols[i] || "0").replace(/[^0-9.-]/g, ""));
    return isNaN(v) ? 0 : v;
  };
  return { idx, num };
}

const METRIC_KEYS = ["enquiries","snapCells","appointments","apptsKept","quotes","orders","outbound","inbound","connected"];

function parseMonthly(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (!lines.length) return [];
  let h = lines.findIndex(l => /sales\s*person/i.test(l)); if (h < 0) h = 0;
  const { idx, num } = makeRowParser(lines[h]);
  const out = [];
  for (let r = h+1; r < lines.length; r++) {
    const cols = splitCSVLine(lines[r]);
    const person = (cols[idx.person] || "").trim();
    if (!person || !isStaff(person)) continue;
    const label = (cols[idx.month] || "").trim();         // "June 2026"
    const parts = label.split(/\s+/);
    const mi = MONTH_NAMES.findIndex(mn => mn.toLowerCase().slice(0,3) === (parts[0]||"").toLowerCase().slice(0,3));
    const year = parseInt(parts[1], 10);
    if (mi < 0 || !year) continue;
    const row = { person, year, monthIdx: mi };
    METRIC_KEYS.forEach(k => row[k] = num(cols, idx[k]));
    out.push(row);
  }
  return out;
}

function parseDaily(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (!lines.length) return [];
  let h = lines.findIndex(l => /sales\s*person/i.test(l)); if (h < 0) h = 0;
  const { idx, num } = makeRowParser(lines[h]);
  const out = [];
  for (let r = h+1; r < lines.length; r++) {
    const cols = splitCSVLine(lines[r]);
    const person = (cols[idx.person] || "").trim();
    if (!person || !isStaff(person)) continue;
    let dISO = (cols[idx.date] || "").trim();
    // Accept YYYY-MM-DD; also tolerate D/M/YYYY or M/D/YYYY if Sheets reformatted it.
    let dObj = null;
    let m = dISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) { dObj = new Date(+m[1], +m[2]-1, +m[3]); }
    else { const t = new Date(dISO); if (!isNaN(t.getTime())) { dObj = t; dISO = `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}`; } }
    if (!dObj) continue;
    const row = { person, dateISO: dISO, dateObj: dObj };
    METRIC_KEYS.forEach(k => row[k] = num(cols, idx[k]));
    out.push(row);
  }
  return out;
}

function calcMetrics(rows) {
  const s = (k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  const enq=s("enquiries"), snap=s("snapCells"), appt=s("appointments"),
        kept=s("apptsKept"), quot=s("quotes"), ord=s("orders"),
        out=s("outbound"), inb=s("inbound"), conn=s("connected");
  return {
    enquiries:enq, snapCells:snap, appointments:appt, apptsKept:kept, quotes:quot, orders:ord, outbound:out, inbound:inb, connected:conn,
    snapRate:  enq ? snap/enq : 0,
    apptRate:  enq ? appt/enq : 0,
    keptRate:  appt? kept/appt: 0,
    quoteRate: enq ? quot/enq : 0,
    orderRate: enq ? ord/enq  : 0,
  };
}

/* ─── DATE / PERIOD HELPERS ───────────────────────────────────────────────────*/
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
function weekStart(d) { const x = new Date(d); const off = (x.getDay()+6)%7; x.setDate(x.getDate()-off); x.setHours(0,0,0,0); return x; }
const dayLabel  = (d) => `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
const dayShort  = (d) => `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
function weekLabel(start) { const e = new Date(start); e.setDate(e.getDate()+6); return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} – ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}`; }

/* ─── UI COMPONENTS ───────────────────────────────────────────────────────────*/
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display:"inline-flex", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:3, gap:2 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          background: value===o.value ? "#ed2624" : "transparent",
          color: value===o.value ? "#fff" : "#94A3B8",
          border:"none", borderRadius:9, padding:"7px 16px", fontSize:13, fontWeight:700, cursor:"pointer", transition:"all .15s"
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Stepper({ label, sub, onPrev, onNext, canPrev, canNext }) {
  const btn = (enabled) => ({
    background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color: enabled?"#F1F5F9":"#475569",
    borderRadius:10, width:38, height:38, fontSize:18, cursor: enabled?"pointer":"not-allowed", lineHeight:"1"
  });
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
      <button style={btn(canPrev)} disabled={!canPrev} onClick={onPrev}>‹</button>
      <div style={{ textAlign:"center", minWidth:200 }}>
        <div style={{ color:"#F1F5F9", fontSize:18, fontWeight:800 }}>{label}</div>
        {sub && <div style={{ color:"#64748B", fontSize:12 }}>{sub}</div>}
      </div>
      <button style={btn(canNext)} disabled={!canNext} onClick={onNext}>›</button>
    </div>
  );
}

function TeamDropdown({ allPeople, salesPeople, purchasingPeople, mode, picked, setMode, setPicked }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const allOn = mode === "all";
  const isChecked = (p) => allOn || picked.includes(p);
  const toggle = (p) => {
    if (allOn) { setMode("custom"); setPicked(allPeople.filter(x => x !== p)); return; }
    const next = picked.includes(p) ? picked.filter(x => x !== p) : [...picked, p];
    if (next.length === allPeople.length) { setMode("all"); setPicked([]); }
    else setPicked(next);
  };
  const sameSet = (a,b) => a.length === b.length && a.length > 0 && a.every(x => b.includes(x));
  const selectAll  = () => { setMode("all"); setPicked([]); };
  const selectGroup = (group) => { setMode("custom"); setPicked(group.slice()); };
  const headLabel = allOn ? "All staff"
    : picked.length === 0 ? "None selected"
    : sameSet(picked, salesPeople) ? "Sales team"
    : sameSet(picked, purchasingPeople) ? "Purchasing"
    : `${picked.length} selected`;
  const presetStyle = (on) => ({
    flex:1, textAlign:"center", padding:"7px 6px", borderRadius:9, cursor:"pointer", fontSize:12, fontWeight:700,
    color: on ? "#fff" : "#94A3B8", background: on ? "#ed2624" : "rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)"
  });
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(o=>!o)} style={{
        background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.12)", color:"#F1F5F9",
        borderRadius:12, padding:"9px 16px", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:8
      }}>
        <span style={{ color:"#64748B", fontWeight:600 }}>Team:</span> {headLabel}
        <span style={{ color:"#64748B", fontSize:11 }}>▾</span>
      </button>
      {open && (
        <div style={{ position:"absolute", top:"110%", right:0, zIndex:50, width:260, maxHeight:380, overflowY:"auto",
          background:"#1b1e23", border:"1px solid rgba(255,255,255,0.14)", borderRadius:14, padding:8, boxShadow:"0 18px 50px rgba(0,0,0,0.5)" }}>
          <div style={{ display:"flex", gap:6, marginBottom:4 }}>
            <div onClick={selectAll} style={presetStyle(allOn)}>All staff</div>
            <div onClick={() => selectGroup(salesPeople)} style={presetStyle(!allOn && sameSet(picked, salesPeople))}>Sales</div>
            <div onClick={() => selectGroup(purchasingPeople)} style={presetStyle(!allOn && sameSet(picked, purchasingPeople))}>Purchasing</div>
          </div>
          <div style={{ height:1, background:"rgba(255,255,255,0.08)", margin:"6px 4px" }} />
          {allPeople.map(p => (
            <label key={p} style={rowStyle(isChecked(p))}>
              <input type="checkbox" checked={isChecked(p)} onChange={() => toggle(p)} />
              <span style={{ width:8, height:8, borderRadius:8, background:PERSON_COLORS[p], display:"inline-block" }} />
              <span>{p}</span>
              {isSalesRep(p) && <span style={{ marginLeft:"auto", color:"#64748B", fontSize:10 }}>sales</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
const rowStyle = (on) => ({
  display:"flex", alignItems:"center", gap:9, padding:"7px 8px", borderRadius:9, cursor:"pointer",
  color: on ? "#F1F5F9" : "#94A3B8", fontSize:13, background: on ? "rgba(237,38,36,0.12)" : "transparent"
});

function Delta({ curr, prev, label }) {
  if (prev == null) return <span style={{ color:"#475569", fontSize:12 }}>—</span>;
  const d = curr - prev;
  const up = d > 0, down = d < 0;
  const c = up ? "#10B981" : down ? "#EF4444" : "#64748B";
  const arrow = up ? "▲" : down ? "▼" : "—";
  const cp = prev > 0 ? `${(Math.abs(d)/prev*100).toFixed(0)}%` : `${Math.abs(d)}`;
  return <span style={{ color:c, fontSize:12, fontWeight:700 }}>{arrow} {cp} <span style={{ color:"#64748B", fontWeight:500 }}>{label}</span></span>;
}

function KPICard({ title, value, sub, color, target, targetText, curr, prev, prevLabel, lastYear, lastYearLabel }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:"18px 22px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ color:"#94A3B8", fontSize:11, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:30, fontWeight:800, color:"#F1F5F9", letterSpacing:"-0.02em" }}>{value}</div>
      {sub && <div style={{ color:"#64748B", fontSize:12, marginTop:3 }}>{sub}</div>}
      {targetText
        ? <div style={{ color:"#64748B", fontSize:11, marginTop:6 }}>Target: {targetText}</div>
        : target != null && <div style={{ color:"#64748B", fontSize:11, marginTop:6 }}>Target: {pct(target)}</div>}
      <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:3 }}>
        {curr != null && <Delta curr={curr} prev={prev} label={prevLabel} />}
        {lastYear != null && <Delta curr={curr} prev={lastYear} label={lastYearLabel} />}
      </div>
    </div>
  );
}

/* ─── APP ─────────────────────────────────────────────────────────────────────*/
export default function App() {
  const [monthly, setMonthly]   = useState([]);
  const [daily, setDaily]       = useState([]);
  const [dailyOk, setDailyOk]   = useState(true);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [refreshed, setRefreshed] = useState(null);

  const [gran, setGran]         = useState("day");      // day | week | month
  const [periodIdx, setPeriodIdx] = useState(null);     // null = latest
  const [mode, setMode]         = useState("all");      // team: all | custom
  const [picked, setPicked]     = useState([]);
  const [trendMetric, setTrendMetric] = useState("enquiries");

  async function load() {
    setLoading(true); setError(null);
    const get = async (url) => {
      const u = IS_LOCAL ? `https://api.allorigins.win/raw?url=${encodeURIComponent(url + "&t=" + Date.now())}` : `${url}?t=${Date.now()}`;
      const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text();
    };
    try {
      const mText = await get(MONTH_SRC);
      setMonthly(parseMonthly(mText));
      try { const dText = await get(DAILY_SRC); const d = parseDaily(dText); setDaily(d); setDailyOk(true); }
      catch { setDaily([]); setDailyOk(false); }
      setRefreshed(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setPeriodIdx(null); }, [gran]);   // jump to latest when granularity changes

  // People list (sales staff only), union of both sources.
  const allPeople = useMemo(() => {
    const s = new Set();
    monthly.forEach(r => s.add(r.person));
    daily.forEach(r => s.add(r.person));
    return [...s].filter(isStaff).sort();
  }, [monthly, daily]);

  // Monitored groups. Sales = the reps we track targets for; Purchasing = the rest (no
  // targets yet) — refine the membership once exact names are confirmed.
  const salesPeople      = useMemo(() => allPeople.filter(isSalesRep),  [allPeople]);
  const purchasingPeople = useMemo(() => allPeople.filter(isPurchaser), [allPeople]);

  const inTeam = (p) => mode === "all" || picked.includes(p);

  // Build the ordered list of periods for the current granularity.
  const periods = useMemo(() => {
    if (gran === "month") {
      // Prefer daily data for any month that has it (keeps Day/Week/Month consistent);
      // fall back to the monthly tab for months with no daily coverage yet.
      const dailyByMonth = new Map();
      daily.forEach(r => {
        if (!inTeam(r.person)) return;
        const key = `${r.dateObj.getFullYear()}-${r.dateObj.getMonth()}`;
        if (!dailyByMonth.has(key)) dailyByMonth.set(key, []);
        dailyByMonth.get(key).push(r);
      });
      const monthlyByMonth = new Map();
      monthly.forEach(r => {
        if (!inTeam(r.person)) return;
        const key = `${r.year}-${r.monthIdx}`;
        if (!monthlyByMonth.has(key)) monthlyByMonth.set(key, []);
        monthlyByMonth.get(key).push(r);
      });
      const keys = new Set([...monthlyByMonth.keys(), ...dailyByMonth.keys()]);
      return [...keys].map(key => {
        const parts = key.split("-");
        const year = +parts[0], monthIdx = +parts[1];
        const fromDaily = dailyByMonth.has(key);
        const rows = fromDaily ? dailyByMonth.get(key) : monthlyByMonth.get(key);
        return { key, year, monthIdx, rows, fromDaily };
      })
        .sort((a,b) => a.year!==b.year ? a.year-b.year : a.monthIdx-b.monthIdx)
        .map(p => ({ ...p, label:`${MONTH_NAMES[p.monthIdx]} ${p.year}`, sub: p.fromDaily ? null : "from monthly totals", axis:`${MONTH_SHORT[p.monthIdx]} ${String(p.year).slice(2)}` }));
    }
    // day / week from daily rows
    const rows = daily.filter(r => inTeam(r.person));
    if (gran === "day") {
      const map = new Map();
      rows.forEach(r => { if (!map.has(r.dateISO)) map.set(r.dateISO, { key:r.dateISO, dateObj:r.dateObj, rows:[] }); map.get(r.dateISO).rows.push(r); });
      return [...map.values()].sort((a,b)=>a.dateObj-b.dateObj)
        .map(p => ({ ...p, label:dayLabel(p.dateObj), sub:null, axis:dayShort(p.dateObj) }));
    }
    // week
    const map = new Map();
    rows.forEach(r => { const ws = weekStart(r.dateObj); const key = isoOf(ws); if (!map.has(key)) map.set(key, { key, dateObj:ws, rows:[] }); map.get(key).rows.push(r); });
    return [...map.values()].sort((a,b)=>a.dateObj-b.dateObj)
      .map(p => ({ ...p, label:`Week of ${dayShort(p.dateObj)}`, sub:weekLabel(p.dateObj), axis:dayShort(p.dateObj) }));
  }, [gran, monthly, daily, mode, picked]);

  const idx     = periodIdx == null ? periods.length - 1 : Math.min(periodIdx, periods.length - 1);
  const current = periods[idx];
  const prev    = idx > 0 ? periods[idx-1] : null;
  const prevLabel = gran === "day" ? "vs prev day" : gran === "week" ? "vs prev week" : "vs prev month";

  // Year-on-year (month view only): same month, previous year.
  const lastYearPeriod = useMemo(() => {
    if (gran !== "month" || !current) return null;
    return periods.find(p => p.monthIdx === current.monthIdx && p.year === current.year - 1) || null;
  }, [gran, periods, current]);

  const m  = current ? calcMetrics(current.rows) : null;
  const mp = prev    ? calcMetrics(prev.rows)    : null;
  const my = lastYearPeriod ? calcMetrics(lastYearPeriod.rows) : null;

  // Per-person breakdown for the current period.
  const perPerson = useMemo(() => {
    if (!current) return [];
    const map = new Map();
    current.rows.forEach(r => {
      if (!map.has(r.person)) map.set(r.person, { person:r.person, ...Object.fromEntries(METRIC_KEYS.map(k=>[k,0])) });
      const o = map.get(r.person); METRIC_KEYS.forEach(k => o[k] += (+r[k]||0));
    });
    return [...map.values()].sort((a,b)=> b.orders-a.orders || b.enquiries-a.enquiries);
  }, [current]);

  // Working days (Mon–Fri) covered by the current period — used to scale the connected-calls
  // count target (40 per rep per working day). Weekend-only days carry no connected target.
  const workingDays = useMemo(() => {
    if (!current) return 0;
    const s = new Set();
    current.rows.forEach(r => { if (r.dateObj && isWeekday(r.dateObj)) s.add(r.dateISO); });
    return s.size;
  }, [current]);
  const activePeople = current ? new Set(current.rows.map(r => r.person)).size : 0;
  const connTargetText = `${CONNECTED_PER_DAY}/day per rep`;
  const connSub = (x) => {
    const denom = activePeople * Math.max(workingDays, 1);
    return `${denom ? Math.round(x.connected/denom) : 0}/day per rep avg`;
  };

  // Areas for improvement: for each monitored sales rep in the current selection, flag any
  // target they're under for this period (rates vs target %, connected vs 40 × working days).
  const hasSalesInView = current ? current.rows.some(r => isSalesRep(r.person)) : false;
  const improvements = useMemo(() => {
    if (!current) return [];
    const reps = new Map();
    current.rows.forEach(r => {
      if (!isSalesRep(r.person)) return;
      if (!reps.has(r.person)) reps.set(r.person, { person:r.person, ...Object.fromEntries(METRIC_KEYS.map(k=>[k,0])) });
      const o = reps.get(r.person); METRIC_KEYS.forEach(k => o[k] += (+r[k]||0));
    });
    const connTarget = CONNECTED_PER_DAY * workingDays;
    const list = [];
    reps.forEach(o => {
      const rate = (n,d) => d ? n/d : 0;
      const checks = [
        { label:"Snap rate",  actual:rate(o.snapCells,o.enquiries),   target:TARGETS.snap,  pctType:true },
        { label:"Appt rate",  actual:rate(o.appointments,o.enquiries),target:TARGETS.appt,  pctType:true },
        { label:"Kept rate",  actual:rate(o.apptsKept,o.appointments),target:TARGETS.kept,  pctType:true },
        { label:"Quote rate", actual:rate(o.quotes,o.enquiries),      target:TARGETS.quote, pctType:true },
        { label:"Order rate", actual:rate(o.orders,o.enquiries),      target:TARGETS.order, pctType:true },
      ];
      if (connTarget > 0) checks.push({ label:"Connected calls", actual:o.connected, target:connTarget, pctType:false });
      const flags = checks.filter(c => c.actual < c.target).map(c => ({
        label:c.label,
        actual: c.pctType ? pct(c.actual) : fmtNum(c.actual),
        target: c.pctType ? pct(c.target) : fmtNum(c.target),
      }));
      if (flags.length) list.push({ person:o.person, flags });
    });
    return list.sort((a,b) => b.flags.length - a.flags.length);
  }, [current, workingDays]);

  // Trend across the last N periods for the selected metric.
  const TREND_N = gran === "day" ? 14 : gran === "week" ? 8 : 12;
  const trendData = useMemo(() => {
    const slice = periods.slice(Math.max(0, periods.length - TREND_N));
    return slice.map((p, i) => ({ name:p.axis, value: calcMetrics(p.rows)[trendMetric] || 0, isCurrent: (periods.length - slice.length + i) === idx }));
  }, [periods, trendMetric, idx, TREND_N]);

  const KPI_DEFS = [
    { key:"enquiries",   title:"Unique Customers", color:"#ed2624", num:(x)=>fmtNum(x.enquiries) },
    { key:"snapCells",   title:"Snap Cells",       color:"#1f7fc4", num:(x)=>fmtNum(x.snapCells),   sub:(x)=>`${pct(x.snapRate)} of enquiries`,  target:TARGETS.snap },
    { key:"appointments",title:"Appointments",     color:"#91c7e8", num:(x)=>fmtNum(x.appointments),sub:(x)=>`${pct(x.apptRate)} of enquiries`, target:TARGETS.appt },
    { key:"apptsKept",   title:"Appts Kept",       color:"#5a93c4", num:(x)=>fmtNum(x.apptsKept),   sub:(x)=>`${pct(x.keptRate)} of booked`,    target:TARGETS.kept },
    { key:"quotes",      title:"Quotes",           color:"#7fb2d8", num:(x)=>fmtNum(x.quotes),      sub:(x)=>`${pct(x.quoteRate)} of enquiries`,target:TARGETS.quote },
    { key:"orders",      title:"Total Orders",     color:"#ed2624", num:(x)=>fmtNum(x.orders),      sub:(x)=>`${pct(x.orderRate)} order rate`,  target:TARGETS.order },
    { key:"outbound",    title:"Outbound Calls",   color:"#3f8fcf", num:(x)=>fmtNum(x.outbound) },
    { key:"inbound",     title:"Inbound Calls",    color:"#b9dcf0", num:(x)=>fmtNum(x.inbound) },
    { key:"connected",   title:"Connected Calls",  color:"#c74038", num:(x)=>fmtNum(x.connected), sub:connSub, targetText:connTargetText },
  ];
  const METRIC_TABS = [
    ["enquiries","Customers"],["snapCells","Snap Cells"],["appointments","Appts"],
    ["quotes","Quotes"],["orders","Orders"],["outbound","Outbound"],["inbound","Inbound"],["connected","Connected"],
  ];

  const noDaily = (gran === "day" || gran === "week") && (!dailyOk || daily.length === 0);

  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(1000px 560px at 84% -12%, rgba(0,79,138,0.34), transparent 60%), radial-gradient(820px 520px at 2% 116%, rgba(237,38,36,0.16), transparent 58%), linear-gradient(180deg, #23262b, #15171b)", color:RMA.inkDim, fontFamily:"'Archivo', system-ui, -apple-system, sans-serif", padding:"28px 28px 60px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,900&display=swap');`}</style>
      <div style={{ maxWidth:1280, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:10 }}>
              {/* RMA Motors wordmark lockup */}
              <div style={{ display:"flex", flexDirection:"column", lineHeight:1, justifyContent:"center" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:"0.3em" }}>
                  <span style={{ fontWeight:900, fontStyle:"italic", fontSize:22, letterSpacing:"-0.015em", color:RMA.white }}>RMA</span>
                  <span style={{ fontWeight:300, fontSize:22, letterSpacing:"0.02em", color:RMA.white, textTransform:"uppercase" }}>Motors</span>
                </div>
                <div style={{ alignSelf:"flex-end", marginTop:3, fontWeight:400, fontSize:8, letterSpacing:"0.6em", textIndent:"0.6em", textTransform:"uppercase", color:RMA.white, opacity:0.9 }}>Dubai</div>
              </div>
              <div style={{ width:1, height:30, background:RMA.line }} />
              <div style={{ fontWeight:700, fontSize:12, letterSpacing:"0.26em", textTransform:"uppercase", color:RMA.blueLight }}>Customer Journey</div>
            </div>
            <div style={{ color:ACCENT, fontWeight:700, fontSize:12, letterSpacing:"0.3em", textTransform:"uppercase" }}>CRM Analytics</div>
            <h1 style={{ margin:"6px 0 4px", fontSize:34, fontWeight:800, color:RMA.white, letterSpacing:"0.005em", textTransform:"uppercase" }}>Customer Journey KPI Dashboard</h1>
            <div style={{ color:RMA.inkFaint, fontSize:13 }}>
              {loading ? "Loading…" : error ? <span style={{color:ACCENT}}>Error: {error}</span> :
              <>Live · {refreshed ? refreshed.toLocaleTimeString() : ""} · {monthly.length} monthly rows · {daily.length} daily rows</>}
            </div>
          </div>
          <button onClick={load} style={{ background:ACCENT_SOFT, border:`1px solid ${ACCENT_LINE}`, color:"#f7b4b1", borderRadius:12, padding:"10px 18px", fontSize:13, fontWeight:700, cursor:"pointer" }}>⟳ Refresh</button>
        </div>

        {/* Controls */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:16, margin:"22px 0 8px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
            <Segmented value={gran} onChange={setGran} options={[{value:"day",label:"Day"},{value:"week",label:"Week"},{value:"month",label:"Month"}]} />
            {current && (
              <Stepper
                label={current.label} sub={current.sub}
                canPrev={idx > 0} canNext={idx < periods.length - 1}
                onPrev={() => setPeriodIdx(idx - 1)} onNext={() => setPeriodIdx((periodIdx==null?periods.length-1:idx) + 1)}
              />
            )}
            {idx < periods.length - 1 && <button onClick={()=>setPeriodIdx(null)} style={{ background:"none", border:"none", color:"#ed2624", fontSize:12, fontWeight:700, cursor:"pointer" }}>Jump to latest →</button>}
          </div>
          <TeamDropdown allPeople={allPeople} salesPeople={salesPeople} purchasingPeople={purchasingPeople} mode={mode} picked={picked} setMode={setMode} setPicked={setPicked} />
        </div>

        {/* No-daily hint */}
        {noDaily && (
          <div style={{ background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.35)", borderRadius:14, padding:"16px 20px", margin:"18px 0", color:"#FDBA74", fontSize:14 }}>
            No daily data yet for this view. Run the daily backfill in the scraper
            (<code style={{color:"#FCD34D"}}>node scraper.js --daily-from=2026-06-01 --daily-to=2026-06-07</code>),
            then hit Refresh. The Month view works from your existing data in the meantime.
          </div>
        )}

        {/* KPI cards */}
        {m && !noDaily && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:14, marginTop:18 }}>
              {KPI_DEFS.map(def => (
                <KPICard key={def.key} title={def.title} color={def.color}
                  value={def.num(m)} sub={def.sub ? def.sub(m) : null} target={def.target} targetText={def.targetText}
                  curr={m[def.key]} prev={mp ? mp[def.key] : null} prevLabel={prevLabel}
                  lastYear={my ? my[def.key] : null} lastYearLabel="YoY" />
              ))}
            </div>

            {/* Areas for improvement */}
            {hasSalesInView && (
              <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"20px 22px", marginTop:22 }}>
                <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:14 }}>
                  <div style={{ color:"#F1F5F9", fontSize:16, fontWeight:800 }}>Areas for improvement · {current.label}</div>
                  <div style={{ color:"#64748B", fontSize:12 }}>
                    vs targets{workingDays > 0 ? ` · connected = ${CONNECTED_PER_DAY}/day × ${workingDays} working day${workingDays===1?"":"s"} = ${fmtNum(CONNECTED_PER_DAY*workingDays)}` : ""}
                  </div>
                </div>
                {improvements.length === 0 ? (
                  <div style={{ color:"#91c7e8", fontSize:14, fontWeight:600 }}>All monitored sales reps are meeting their targets for this period. 🎉</div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {improvements.map(r => (
                      <div key={r.person} style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", padding:"10px 12px", background:"rgba(237,38,36,0.07)", border:"1px solid rgba(237,38,36,0.22)", borderRadius:12 }}>
                        <span style={{ display:"flex", alignItems:"center", gap:8, minWidth:150, color:"#F1F5F9", fontWeight:700, fontSize:14 }}>
                          <span style={{ width:9, height:9, borderRadius:9, background:PERSON_COLORS[r.person], display:"inline-block" }} />{r.person}
                        </span>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          {r.flags.map(f => (
                            <span key={f.label} style={{ background:"rgba(237,38,36,0.14)", border:"1px solid rgba(237,38,36,0.4)", color:"#f4a6a3", borderRadius:8, padding:"4px 9px", fontSize:12, fontWeight:600 }}>
                              {f.label}: {f.actual} <span style={{ color:"#94A3B8", fontWeight:500 }}>/ {f.target}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Trend chart */}
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"20px 22px", marginTop:22 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginBottom:14 }}>
                <div style={{ color:"#F1F5F9", fontSize:16, fontWeight:800 }}>
                  Trend · last {Math.min(TREND_N, periods.length)} {gran === "day" ? "days" : gran === "week" ? "weeks" : "months"}
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {METRIC_TABS.map(([k,lbl]) => (
                    <button key={k} onClick={()=>setTrendMetric(k)} style={{
                      background: trendMetric===k ? "#ed2624" : "rgba(255,255,255,0.05)",
                      color: trendMetric===k ? "#fff" : "#94A3B8", border:"1px solid rgba(255,255,255,0.1)",
                      borderRadius:9, padding:"5px 11px", fontSize:12, fontWeight:700, cursor:"pointer" }}>{lbl}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendData} margin={{ top:6, right:6, left:-12, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill:"rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="value" radius={[5,5,0,0]}>
                    {trendData.map((d,i) => <Cell key={i} fill={d.isCurrent ? "#ed2624" : "rgba(237,38,36,0.35)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Per-person breakdown */}
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"20px 22px", marginTop:22 }}>
              <div style={{ color:"#F1F5F9", fontSize:16, fontWeight:800, marginBottom:14 }}>By salesperson · {current.label}</div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:760 }}>
                  <thead>
                    <tr style={{ color:"#64748B", textAlign:"right", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                      <th style={{ textAlign:"left", padding:"8px 10px" }}>Salesperson</th>
                      <th style={{ padding:"8px 10px" }}>Customers</th><th style={{ padding:"8px 10px" }}>Snap</th>
                      <th style={{ padding:"8px 10px" }}>Appts</th><th style={{ padding:"8px 10px" }}>Kept</th>
                      <th style={{ padding:"8px 10px" }}>Quotes</th><th style={{ padding:"8px 10px" }}>Orders</th>
                      <th style={{ padding:"8px 10px" }}>Outbound</th><th style={{ padding:"8px 10px" }}>Inbound</th><th style={{ padding:"8px 10px" }}>Connected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perPerson.map(p => (
                      <tr key={p.person} style={{ borderTop:"1px solid rgba(255,255,255,0.06)", textAlign:"right" }}>
                        <td style={{ textAlign:"left", padding:"9px 10px", color:"#E2E8F0", fontWeight:600 }}>
                          <span style={{ display:"inline-block", width:8, height:8, borderRadius:8, background:PERSON_COLORS[p.person], marginRight:8 }} />{p.person}
                        </td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.enquiries)}</td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.snapCells)}</td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.appointments)}</td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.apptsKept)}</td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.quotes)}</td>
                        <td style={{ padding:"9px 10px", color:"#F1F5F9", fontWeight:700 }}>{fmtNum(p.orders)}</td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.outbound)}</td>
                        <td style={{ padding:"9px 10px" }}>{fmtNum(p.inbound)}</td>
                        <td style={{ padding:"9px 10px", color:"#91c7e8", fontWeight:700 }}>{fmtNum(p.connected)}</td>
                      </tr>
                    ))}
                    {perPerson.length === 0 && <tr><td colSpan={10} style={{ padding:"18px", textAlign:"center", color:"#64748B" }}>No data for this selection.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!loading && !m && !noDaily && (
          <div style={{ textAlign:"center", color:"#64748B", padding:"60px 0" }}>
            {mode === "custom" && picked.length === 0
              ? "No staff selected — pick people from the Team dropdown (top right)."
              : "No data to display."}
          </div>
        )}
      </div>
    </div>
  );
}
