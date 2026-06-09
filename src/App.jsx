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
const EXCLUDE = ["unassigned leads","unassigned calls","unassigned","finance rma","rma marketing","dashboard rma","totals"];
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

/* ─── COLOURS ─────────────────────────────────────────────────────────────────*/
const KNOWN_COLORS = { Cameron:"#3B82F6", Dan:"#10B981", Kat:"#EC4899", Tom:"#8B5CF6", Adil:"#EF4444", Gustav:"#F97316" };
const COLOR_PALETTE = [
  "#3B82F6","#10B981","#F59E0B","#EC4899","#8B5CF6","#06B6D4","#EF4444","#F97316",
  "#6366F1","#14B8A6","#A855F7","#EAB308","#0EA5E9","#F43F5E","#22C55E","#D946EF",
  "#84CC16","#FB7185","#2DD4BF","#C084FC","#FBBF24","#60A5FA","#4ADE80","#FB923C"
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
const TOOLTIP_STYLE = { background:"#1E293B", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, color:"#F1F5F9", fontSize:12 };

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
          background: value===o.value ? "#4F6EF7" : "transparent",
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
    color: on ? "#fff" : "#94A3B8", background: on ? "#4F6EF7" : "rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)"
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
          background:"#0F1729", border:"1px solid rgba(255,255,255,0.14)", borderRadius:14, padding:8, boxShadow:"0 18px 50px rgba(0,0,0,0.5)" }}>
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
  color: on ? "#F1F5F9" : "#94A3B8", fontSize:13, background: on ? "rgba(79,110,247,0.12)" : "transparent"
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
    { key:"enquiries",   title:"Unique Customers", color:"#6366F1", num:(x)=>fmtNum(x.enquiries) },
    { key:"snapCells",   title:"Snap Cells",       color:"#3B82F6", num:(x)=>fmtNum(x.snapCells),   sub:(x)=>`${pct(x.snapRate)} of enquiries`,  target:TARGETS.snap },
    { key:"appointments",title:"Appointments",     color:"#06B6D4", num:(x)=>fmtNum(x.appointments),sub:(x)=>`${pct(x.apptRate)} of enquiries`, target:TARGETS.appt },
    { key:"apptsKept",   title:"Appts Kept",       color:"#8B5CF6", num:(x)=>fmtNum(x.apptsKept),   sub:(x)=>`${pct(x.keptRate)} of booked`,    target:TARGETS.kept },
    { key:"quotes",      title:"Quotes",           color:"#10B981", num:(x)=>fmtNum(x.quotes),      sub:(x)=>`${pct(x.quoteRate)} of enquiries`,target:TARGETS.quote },
    { key:"orders",      title:"Total Orders",     color:"#EC4899", num:(x)=>fmtNum(x.orders),      sub:(x)=>`${pct(x.orderRate)} order rate`,  target:TARGETS.order },
    { key:"outbound",    title:"Outbound Calls",   color:"#F97316", num:(x)=>fmtNum(x.outbound) },
    { key:"inbound",     title:"Inbound Calls",    color:"#14B8A6", num:(x)=>fmtNum(x.inbound) },
    { key:"connected",   title:"Connected Calls",  color:"#F59E0B", num:(x)=>fmtNum(x.connected), sub:connSub, targetText:connTargetText },
  ];
  const METRIC_TABS = [
    ["enquiries","Customers"],["snapCells","Snap Cells"],["appointments","Appts"],
    ["quotes","Quotes"],["orders","Orders"],["outbound","Outbound"],["inbound","Inbound"],["connected","Connected"],
  ];

  const noDaily = (gran === "day" || gran === "week") && (!dailyOk || daily.length === 0);

  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(1200px 600px at 70% -10%, #1B2440 0%, #0B1020 55%)", color:"#E2E8F0", fontFamily:"Inter, system-ui, sans-serif", padding:"28px 28px 60px" }}>
      <div style={{ maxWidth:1280, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
          <div>
            <div style={{ color:"#6366F1", fontWeight:800, fontSize:13, letterSpacing:"0.2em" }}>RMA MOTORS · CRM ANALYTICS</div>
            <h1 style={{ margin:"6px 0 4px", fontSize:34, fontWeight:900, color:"#F8FAFC", letterSpacing:"-0.02em" }}>Customer Journey KPI Dashboard</h1>
            <div style={{ color:"#64748B", fontSize:13 }}>
              {loading ? "Loading…" : error ? <span style={{color:"#EF4444"}}>Error: {error}</span> :
              <>Live · {refreshed ? refreshed.toLocaleTimeString() : ""} · {monthly.length} monthly rows · {daily.length} daily rows</>}
            </div>
          </div>
          <button onClick={load} style={{ background:"rgba(99,102,241,0.18)", border:"1px solid rgba(99,102,241,0.5)", color:"#C7D2FE", borderRadius:12, padding:"10px 18px", fontSize:13, fontWeight:700, cursor:"pointer" }}>⟳ Refresh</button>
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
            {idx < periods.length - 1 && <button onClick={()=>setPeriodIdx(null)} style={{ background:"none", border:"none", color:"#6366F1", fontSize:12, fontWeight:700, cursor:"pointer" }}>Jump to latest →</button>}
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
                  <div style={{ color:"#34D399", fontSize:14, fontWeight:600 }}>All monitored sales reps are meeting their targets for this period. 🎉</div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {improvements.map(r => (
                      <div key={r.person} style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", padding:"10px 12px", background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.18)", borderRadius:12 }}>
                        <span style={{ display:"flex", alignItems:"center", gap:8, minWidth:150, color:"#F1F5F9", fontWeight:700, fontSize:14 }}>
                          <span style={{ width:9, height:9, borderRadius:9, background:PERSON_COLORS[r.person], display:"inline-block" }} />{r.person}
                        </span>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          {r.flags.map(f => (
                            <span key={f.label} style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.3)", color:"#FCA5A5", borderRadius:8, padding:"4px 9px", fontSize:12, fontWeight:600 }}>
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
                      background: trendMetric===k ? "#4F6EF7" : "rgba(255,255,255,0.05)",
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
                    {trendData.map((d,i) => <Cell key={i} fill={d.isCurrent ? "#4F6EF7" : "rgba(79,110,247,0.35)"} />)}
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
                        <td style={{ padding:"9px 10px", color:"#FBBF24", fontWeight:700 }}>{fmtNum(p.connected)}</td>
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
