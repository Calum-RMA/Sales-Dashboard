import { useState, useMemo, useEffect } from "react";
import {
  ComposedChart, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell
} from "recharts";

// ─── SHEET URLs (one per year tab) ───────────────────────────────────────────
// On Netlify: requests go to /api/2025 and /api/2026 which are proxied via _redirects
// On localhost: falls back to direct Google Sheets URL via CORS proxy
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const SHEETS = [
  { year: 2025, localUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSzOVZQfpc4PnZFWr8HuUMUz-WfRcR7zpiOybaY3zPw3biGsPcId8LfBK598yYhXg/pub?gid=2051502240&single=true&output=csv", prodUrl: "/api/2025" },
  { year: 2026, localUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSzOVZQfpc4PnZFWr8HuUMUz-WfRcR7zpiOybaY3zPw3biGsPcId8LfBK598yYhXg/pub?gid=268453733&single=true&output=csv",  prodUrl: "/api/2026" },
];

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
// Year is passed in — no guessing needed since each tab = one year
function parseCSV(text, year) {
  const lines = text.split(/\r?\n/);
  const rows  = lines.map(l => {
    const cols = [];
    let cur = "", inQ = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '"') { inQ = !inQ; }
      else if (l[i] === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += l[i];
    }
    cols.push(cur.trim());
    return cols;
  });

  const data    = [];
  let curMonth  = null;
  let colMap    = null;
  let stopped   = false;

  for (const cols of rows) {
    if (stopped) continue;

    const first    = String(cols[0] || "").trim();
    const firstLow = first.toLowerCase();

    // Stop at summary/averages sections
    if (/^(averages|daily averages|targets for)/i.test(firstLow)) {
      stopped = true; continue;
    }

    // Skip sub-period rows like "August 18-24" but NOT year-suffixed headers like "January 2026"
    if (/^[a-zA-Z]+ \d{1,2}/.test(first) && !/^[a-zA-Z]+ \d{4}/.test(first)) continue;

    // Detect month header — match "January", "January 2026", "Jan", "Jan 2026", "March -" etc.
    const cleanFirst = firstLow.replace(/\s*-\s*$/, "").replace(/\s+\d{4}$/, "").trim();
    const mIdx = MONTH_NAMES.findIndex(mn =>
      cleanFirst === mn.toLowerCase() ||
      cleanFirst === mn.toLowerCase().slice(0, 3)
    );
    if (mIdx >= 0) {
      curMonth = MONTH_SHORT[mIdx];
      colMap   = null;
      continue;
    }

    // Detect column header row
    if (cols.some(c => /sales\s*person/i.test(String(c)))) {
      colMap = {};
      cols.forEach((c, i) => {
        const s = String(c).toLowerCase().trim();
        if (/unique.*customer|enquir/i.test(s))                     colMap.enquiries    = i;
        else if (/snap\s*cell/i.test(s))                            colMap.snapCells    = i;
        else if (/appointment.*kept|appointments\s*kept/i.test(s))  colMap.apptsKept    = i;
        else if (/^appointments?\s*$/i.test(s))                     colMap.appointments = i;
        else if (/outbound/i.test(s))                               colMap.outbound     = i;
        else if (/^quotes?\s*$/i.test(s))                           colMap.quotes       = i;
        else if (/total\s*orders/i.test(s))                         colMap.orders       = i;
        else if (/sales\s*person/i.test(s))                         colMap.person       = i;
      });
      continue;
    }

    if (!curMonth || !colMap) continue;

    // Skip total/summary rows
    if (/^(total|q[1-4]|averages|daily|pipeline|targets|setter|closer)/i.test(firstLow) || !first) continue;

    const n = (i) => {
      if (i == null) return 0;
      const v = parseFloat(String(cols[i] || "0").replace(/[^0-9.-]/g, ""));
      return isNaN(v) ? 0 : v;
    };

    const enqVal = n(colMap.enquiries);
    // Skip decimal/zero enquiry rows (averages leaking through)
    if (enqVal === 0 || enqVal !== Math.round(enqVal)) continue;

    data.push({
      year,
      month:     curMonth,
      yearMonth: `${curMonth} ${year}`,
      person:    first,
      enquiries: enqVal,
      snapCells:    n(colMap.snapCells),
      appointments: colMap.appointments != null ? n(colMap.appointments) : 0,
      apptsKept:    colMap.apptsKept    != null ? n(colMap.apptsKept)    : 0,
      outbound:     n(colMap.outbound),
      quotes:       n(colMap.quotes),
      orders:       n(colMap.orders),
    });
  }
  return data;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const PERSON_COLORS = {
  Cameron: "#3B82F6", Dan: "#10B981", Jonny: "#F59E0B",
  Kat: "#EC4899", Tom: "#8B5CF6", Chris: "#06B6D4",
  Adil: "#EF4444", Gustav: "#F97316"
};
const YEAR_COLORS = { 2025: "#6366F1", 2026: "#10B981" };

const pct    = (v) => v == null || isNaN(+v) ? '0.0%' : `${(+v * 100).toFixed(1)}%`;
const fmtNum = (v) => (isNaN(+v) || v == null ? 0 : +v).toLocaleString();

function calcMetrics(rows) {
  const enq  = rows.reduce((s, r) => s + (+r.enquiries    || 0), 0);
  const snap = rows.reduce((s, r) => s + (+r.snapCells    || 0), 0);
  const appt = rows.reduce((s, r) => s + (+r.appointments || 0), 0);
  const kept = rows.reduce((s, r) => s + (+r.apptsKept    || 0), 0);
  const quot = rows.reduce((s, r) => s + (+r.quotes       || 0), 0);
  const ord  = rows.reduce((s, r) => s + (+r.orders       || 0), 0);
  const out  = rows.reduce((s, r) => s + (+r.outbound     || 0), 0);
  return {
    enquiries: enq, snapCells: snap, appointments: appt,
    apptsKept: kept, quotes: quot, orders: ord, outbound: out,
    snapRate:  enq  ? snap / enq  : 0,
    apptRate:  enq  ? appt / enq  : 0,
    keptRate:  appt ? kept / appt : 0,
    quoteRate: enq  ? quot / enq  : 0,
    orderRate: enq  ? ord  / enq  : 0,
    closeRate: quot ? ord  / quot : 0,
  };
}

const TOOLTIP_STYLE = {
  background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10, color: "#F1F5F9", fontSize: 12,
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function KPICard({ title, value, sub, target, color, trend, prevValue, trendLabel }) {
  // trend = numeric delta (curr - prev). Only show if trend is a real number.
  const showMoM  = typeof trend === "number" && isFinite(trend);
  const isUp     = trend > 0;
  const isDown   = trend < 0;
  const tc       = isUp ? "#10B981" : isDown ? "#EF4444" : "#64748B";
  const arrow    = isUp ? "▲" : isDown ? "▼" : "—";
  // % change relative to previous month value
  const prev     = typeof prevValue === "number" && prevValue > 0 ? prevValue : null;
  const changePct = prev ? (Math.abs(trend) / prev * 100).toFixed(1) + "%" : null;
  const changeStr = changePct || (Math.abs(trend) > 0 ? Math.abs(trend).toLocaleString() : "0");

  return (
    <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:"20px 24px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:color, borderRadius:"16px 16px 0 0" }} />
      <div style={{ color:"#94A3B8", fontSize:12, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>{title}</div>
      <div style={{ fontSize:32, fontWeight:800, color:"#F1F5F9", letterSpacing:"-0.02em" }}>{value}</div>
      {sub && <div style={{ color:"#64748B", fontSize:13, marginTop:4 }}>{sub}</div>}
      <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:4 }}>
        {target != null && <span style={{ color:"#64748B", fontSize:12 }}>Target: {pct(target)}</span>}
        {showMoM && (
          <span style={{ color:tc, fontSize:12, fontWeight:700 }}>
            {arrow} {changeStr} {trendLabel || "MoM"}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontSize:13, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569", marginBottom:16, marginTop:8, display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }} />
      {children}
      <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function FilterPill({ label, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? (color+"44") : "rgba(255,255,255,0.05)",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
      color: active ? "#F1F5F9" : "#64748B",
      borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.15s",
    }}>{label}</button>
  );
}


// ─── SANKEY FUNNEL COMPONENT ──────────────────────────────────────────────────
function SankeyFunnel({ data }) {
  const COLORS = ['#4F6EF7','#7C5CF6','#06B6D4','#8B5CF6','#10B981','#F59E0B'];
  const stages = [
    { id:'enq',  label:'Enquiries',    val: data.enquiries    || 0 },
    { id:'snap', label:'Snap Cells',   val: data.snapCells    || 0 },
    { id:'appt', label:'Appointments', val: data.appointments || 0 },
    { id:'kept', label:'Appts Kept',   val: data.apptsKept    || 0 },
    { id:'quot', label:'Quotes',       val: data.quotes       || 0 },
    { id:'ord',  label:'Orders',       val: data.orders       || 0 },
  ].filter(s => s.val > 0);

  const n = stages.length;
  if (n < 2) return null;

  // Layout constants — all fit within 100% width using viewBox
  const VW = 800, VH = 300;
  const NODE_W = 12;
  const LABEL_H = 56;       // space above centre for labels
  const MAX_BAR = VH - LABEL_H - 40; // max bar height
  const MIN_BAR = 4;
  const CY = LABEL_H + MAX_BAR;  // baseline (bottom of tallest bar)
  const PAD = 8;
  const colW = (VW - PAD * 2) / n;

  const maxVal = stages[0].val;

  const nodes = stages.map((s, i) => {
    const barH = Math.max(MIN_BAR, (s.val / maxVal) * MAX_BAR);
    const cx = PAD + i * colW + colW / 2;
    const nx = cx - NODE_W / 2;
    const ny = CY - barH;
    return { ...s, cx, nx, ny, barH, color: COLORS[i % COLORS.length] };
  });

  // Build flows between adjacent nodes
  const flows = nodes.slice(0, -1).map((s, i) => {
    const t = nodes[i + 1];
    // Flow height = size of the smaller (destination) node
    const fh = t.barH;
    const x1 = s.nx + NODE_W;
    const x2 = t.nx;
    const midX = (x1 + x2) / 2;
    const sy1 = CY - fh, sy2 = CY;
    const ty1 = CY - fh, ty2 = CY;
    return {
      d: `M${x1},${sy1} C${midX},${sy1} ${midX},${ty1} ${x2},${ty1} L${x2},${ty2} C${midX},${ty2} ${midX},${sy2} ${x1},${sy2} Z`,
      color: s.color,
    };
  });

  return (
    <div style={{ width:'100%', padding:'8px 0' }}>
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display:'block' }}>
        {/* Flows */}
        {flows.map((f, i) => (
          <path key={i} d={f.d} fill={f.color} fillOpacity={0.18} stroke={f.color} strokeWidth={0.5} strokeOpacity={0.25} />
        ))}
        {/* Nodes + labels */}
        {nodes.map((nd, i) => {
          const prevVal = i > 0 ? nodes[i-1].val : null;
          const convPct = prevVal ? ((nd.val / prevVal) * 100).toFixed(1) + '%' : null;
          const labelY = nd.ny - 8;
          return (
            <g key={nd.id}>
              {/* Bar */}
              <rect x={nd.nx} y={nd.ny} width={NODE_W} height={nd.barH} rx={3} fill={nd.color} />
              {/* Labels above bar */}
              <text x={nd.cx} y={Math.max(14, labelY - 28)} textAnchor="middle" fontSize={10} fill="#64748B" fontFamily="sans-serif" fontWeight={600}>{nd.label.toUpperCase()}</text>
              <text x={nd.cx} y={Math.max(28, labelY - 12)} textAnchor="middle" fontSize={15} fill={nd.color} fontFamily="sans-serif" fontWeight={700}>{nd.val.toLocaleString()}</text>
              {/* Conversion % below bar */}
              {convPct && (
                <text x={nd.cx} y={CY + 16} textAnchor="middle" fontSize={10} fill="#475569" fontFamily="sans-serif">{convPct}</text>
              )}
              {/* Drop-off arrow hint */}
              {i > 0 && (
                <text x={nd.cx} y={CY + 28} textAnchor="middle" fontSize={9} fill="#334155" fontFamily="sans-serif">of prev</text>
              )}
            </g>
          );
        })}
        {/* Bottom axis line */}
        <line x1={PAD} y1={CY + 2} x2={VW - PAD} y2={CY + 2} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [rawData,        setRawData]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [lastRefreshed,  setLastRefreshed]  = useState(null);
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [selectedYears,  setSelectedYears]  = useState([]);
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [activeTab,      setActiveTab]      = useState("overview");

  const togglePerson = p => setSelectedPeople(prev => prev.includes(p) ? prev.filter(x=>x!==p) : [...prev,p]);
  const toggleYear   = y => setSelectedYears(p  => p.includes(y) ? p.filter(x=>x!==y) : [...p,y]);
  const toggleMonth  = m => setSelectedMonths(p => p.includes(m) ? p.filter(x=>x!==m) : [...p,m]);

  // ── Fetch both tabs ──────────────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true); setError(null);
    try {
      const results = await Promise.all(
        SHEETS.map(async ({ year, localUrl, prodUrl }) => {
          let text = null;
          if (IS_LOCAL) {
            // localhost: use CORS proxy
            const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(localUrl + "&t=" + Date.now())}`;
            const res = await fetch(proxied);
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${year} data`);
            text = await res.text();
          } else {
            // Netlify: use redirect proxy (no CORS issue)
            const res = await fetch(`${prodUrl}?t=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${year} data`);
            text = await res.text();
          }
          const parsed = parseCSV(text, year);
          if (parsed.length === 0) throw new Error(`No data parsed for ${year} — check the sheet is published`);
          return parsed;
        })
      );
      setRawData(results.flat());
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const allPeople = useMemo(() => [...new Set(rawData.map(d => d.person))].sort(), [rawData]);
  const allYears  = useMemo(() => [...new Set(rawData.map(d => d.year))].sort(),   [rawData]);
  const allMonths = useMemo(() => MONTH_ORDER.filter(m => rawData.some(d => d.month === m)), [rawData]);

  const filtered = useMemo(() => rawData.filter(d =>
    (selectedPeople.length === 0 || selectedPeople.includes(d.person)) &&
    (selectedYears.length  === 0 || selectedYears.includes(d.year))    &&
    (selectedMonths.length === 0 || selectedMonths.includes(d.month))
  ), [rawData, selectedPeople, selectedYears, selectedMonths]);

  // Monthly trend — grouped by yearMonth, sorted chronologically
  const monthlyTrend = useMemo(() => {
    const grouped = {};
    filtered.forEach(d => {
      if (!grouped[d.yearMonth]) grouped[d.yearMonth] = { year:d.year, month:d.month, rows:[] };
      grouped[d.yearMonth].rows.push(d);
    });
    return Object.entries(grouped)
      .sort(([,a],[,b]) => a.year!==b.year ? a.year-b.year : MONTH_ORDER.indexOf(a.month)-MONTH_ORDER.indexOf(b.month))
      .map(([key,{year,month,rows}]) => {
        const m = calcMetrics(rows);
        // Conversion from kept appointments → orders
        const keptToOrder = m.apptsKept ? m.orders / m.apptsKept : 0;
        return {
          name: key, year, month, ...m,
          snapPct:       +(m.snapRate    *100).toFixed(1),
          quotePct:      +(m.quoteRate   *100).toFixed(1),
          closePct:      +(m.closeRate   *100).toFixed(1),
          orderPct:      +(m.orderRate   *100).toFixed(1),
          keptPct:       +(m.keptRate    *100).toFixed(1),
          keptToOrderPct:+(keptToOrder   *100).toFixed(1),
          apptPct:       +(m.apptRate    *100).toFixed(1),
        };
      });
  }, [filtered]);

  // YoY comparison — same months, different years side by side
  const yoyData = useMemo(() => {
    const months = selectedMonths.length > 0 ? selectedMonths : allMonths;
    return months.map(m => {
      const entry = { month: m };
      allYears.forEach(y => {
        const rows = rawData.filter(d =>
          d.month === m && d.year === y &&
          (selectedPeople.length === 0 || selectedPeople.includes(d.person))
        );
        if (rows.length) {
          const met = calcMetrics(rows);
          entry[`enq_${y}`]   = met.enquiries;
          entry[`orders_${y}`] = met.orders;
          entry[`close_${y}`]  = +(met.closeRate*100).toFixed(1);
          entry[`quote_${y}`]  = +(met.quoteRate*100).toFixed(1);
        }
      });
      return entry;
    }).filter(e => Object.keys(e).length > 1);
  }, [rawData, allMonths, allYears, selectedMonths, selectedPeople]);

  const personSummary = useMemo(() =>
    allPeople.map(person => {
      const rows = filtered.filter(d => d.person === person);
      if (!rows.length) return null;
      return { person, ...calcMetrics(rows), color: PERSON_COLORS[person] || "#94A3B8" };
    }).filter(Boolean),
  [filtered, allPeople]);

  const overall   = useMemo(() => calcMetrics(filtered), [filtered]);
  const lastTwo   = monthlyTrend.slice(-2);
  const hasMoM    = lastTwo.length === 2;
  const momLabel  = hasMoM ? `vs ${lastTwo[0].name}` : "";
  const momPrev   = hasMoM ? lastTwo[0] : null;
  const momCurr   = hasMoM ? lastTwo[1] : null;

  // All MoM deltas — positive = green (improved), negative = red (declined)
  const momSnap      = hasMoM ? (momCurr.snapRate   || 0) - (momPrev.snapRate   || 0) : null;
  const momClose     = hasMoM ? (momCurr.closeRate  || 0) - (momPrev.closeRate  || 0) : null;
  const momOrders    = hasMoM ? (momCurr.orders     || 0) - (momPrev.orders     || 0) : null;
  const momQuote     = hasMoM ? (momCurr.quoteRate  || 0) - (momPrev.quoteRate  || 0) : null;
  const momEnq       = hasMoM ? (momCurr.enquiries    || 0) - (momPrev.enquiries    || 0) : null;
  const momOutbound  = hasMoM ? (momCurr.outbound     || 0) - (momPrev.outbound     || 0) : null;
  const momSnap$     = hasMoM ? (momCurr.snapCells    || 0) - (momPrev.snapCells    || 0) : null;
  const momAppt      = hasMoM ? (momCurr.appointments || 0) - (momPrev.appointments || 0) : null;
  const momKept      = hasMoM ? (momCurr.apptsKept    || 0) - (momPrev.apptsKept    || 0) : null;
  const momQuotes$   = hasMoM ? (momCurr.quotes       || 0) - (momPrev.quotes       || 0) : null;

  const improvements = personSummary.filter(p => p.quoteRate<0.30 || p.closeRate<0.20 || p.snapRate<0.40);

  const COMPARISON_METRICS = ["Enquiries","Snap Cells","Appointments","Appts Kept","Quotes","Orders"];
  const COMPARISON_KEY_MAP = { "Enquiries":"enquiries","Snap Cells":"snapCells","Appointments":"appointments","Appts Kept":"apptsKept","Quotes":"quotes","Orders":"orders" };

  const comparisonChartData = useMemo(() =>
    COMPARISON_METRICS.map(metric => {
      const entry = { metric };
      selectedPeople.forEach(person => {
        const rows = filtered.filter(d => d.person === person);
        const m = rows.length ? calcMetrics(rows) : {};
        entry[person] = m[COMPARISON_KEY_MAP[metric]] || 0;
      });
      return entry;
    }),
  [filtered, selectedPeople]);

  const tabs = [
    { id:"overview",    label:"Overview"             },
    { id:"yoy",         label:"Year on Year"          },
    { id:"funnel",      label:"Funnel Trends"         },
    { id:"team",        label:"Team Performance"      },
    { id:"improvement", label:"Areas for Improvement" },
  ];

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#0B1120", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:48, height:48, border:"3px solid rgba(99,102,241,0.2)", borderTop:"3px solid #6366F1", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <div style={{ color:"#64748B", fontSize:14 }}>Loading 2025 & 2026 data…</div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:"100vh", background:"#0B1120", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}>
      <div style={{ color:"#EF4444", fontSize:18, fontWeight:700 }}>⚠ Could not load data</div>
      <div style={{ color:"#64748B", fontSize:13 }}>{error}</div>
      <button onClick={fetchData} style={{ background:"#6366F1", color:"#fff", border:"none", borderRadius:10, padding:"10px 20px", cursor:"pointer", fontSize:14 }}>Retry</button>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#0B1120", fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", color:"#E2E8F0", paddingBottom:48 }}>

      {/* ── HEADER ── */}
      <div style={{ background:"linear-gradient(135deg,#0F172A 0%,#1E1B4B 50%,#0F172A 100%)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"28px 32px 20px" }}>
        <div style={{ maxWidth:1400, margin:"0 auto" }}>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
            <div>
              <div style={{ fontSize:11, letterSpacing:"0.2em", color:"#6366F1", fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>CRM Analytics · 2025–2026</div>
              <h1 style={{ fontSize:26, fontWeight:900, margin:0, letterSpacing:"-0.02em", color:"#F8FAFC" }}>Customer Journey KPI Dashboard</h1>
              <p style={{ margin:"5px 0 0", color:"#64748B", fontSize:13 }}>
                Live · Refreshed: <span style={{ color:"#94A3B8" }}>{lastRefreshed}</span>
                {" · "}<span style={{ color:"#6366F1" }}>2025: {rawData.filter(d=>d.year===2025).length} records</span>
                {" · "}<span style={{ color:"#10B981" }}>2026: {rawData.filter(d=>d.year===2026).length} records</span>
              </p>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
              <button onClick={fetchData} style={{ background:"rgba(99,102,241,0.15)", border:"1px solid rgba(99,102,241,0.4)", color:"#A5B4FC", borderRadius:10, padding:"8px 16px", fontSize:13, cursor:"pointer", fontWeight:600 }}>⟳ Refresh</button>
            </div>
          </div>

          {/* Filters */}
          <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
            {/* Team */}
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ color:"#475569", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", width:52 }}>Team:</span>
              <FilterPill label="All" active={selectedPeople.length===0} color="#6366F1" onClick={()=>setSelectedPeople([])} />
              {allPeople.map(p=>(
                <FilterPill key={p} label={p} active={selectedPeople.includes(p)} color={PERSON_COLORS[p]||"#94A3B8"} onClick={()=>togglePerson(p)} />
              ))}
              {selectedPeople.length>0 && <span style={{ color:"#94A3B8", fontSize:11 }}>{selectedPeople.join(", ")} selected</span>}
            </div>
            {/* Year */}
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ color:"#475569", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", width:52 }}>Year:</span>
              <FilterPill label="All" active={selectedYears.length===0} color="#6366F1" onClick={()=>setSelectedYears([])} />
              {allYears.map(y=>(
                <FilterPill key={y} label={String(y)} active={selectedYears.includes(y)} color={YEAR_COLORS[y]||"#6366F1"} onClick={()=>toggleYear(y)} />
              ))}
              {selectedYears.length>0 && <span style={{ color:"#94A3B8", fontSize:11 }}>{selectedYears.join(" + ")} selected</span>}
            </div>
            {/* Month */}
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ color:"#475569", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", width:52 }}>Month:</span>
              <FilterPill label="All" active={selectedMonths.length===0} color="#6366F1" onClick={()=>setSelectedMonths([])} />
              {allMonths.map(m=>(
                <FilterPill key={m} label={m} active={selectedMonths.includes(m)} color="#6366F1" onClick={()=>toggleMonth(m)} />
              ))}
              {selectedMonths.length>0 && <span style={{ color:"#94A3B8", fontSize:11 }}>{selectedMonths.length} month{selectedMonths.length>1?"s":""} selected</span>}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", gap:4, marginTop:16, flexWrap:"wrap" }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{ background:activeTab===t.id?"rgba(99,102,241,0.2)":"transparent", border:activeTab===t.id?"1px solid rgba(99,102,241,0.5)":"1px solid transparent", color:activeTab===t.id?"#A5B4FC":"#64748B", borderRadius:10, padding:"7px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1400, margin:"0 auto", padding:"28px 32px 0" }}>

        {/* ── OVERVIEW ── */}
        {activeTab==="overview" && (
          <>
            {/* ── MULTI-PERSON COMPARISON ── */}
            {selectedPeople.length >= 2 && (
              <>
                <SectionHeader>Comparing: {selectedPeople.join(" vs ")}</SectionHeader>

                {/* Per-person scorecards */}
                <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(selectedPeople.length,4)}, 1fr)`, gap:12, marginBottom:24 }}>
                  {selectedPeople.map(person => {
                    const rows = filtered.filter(d => d.person === person);
                    const m = rows.length ? calcMetrics(rows) : calcMetrics([]);
                    const color = PERSON_COLORS[person] || "#94A3B8";
                    const overallConv = m.enquiries ? m.orders / m.enquiries : 0;
                    const apptConv    = m.apptsKept  ? m.orders / m.apptsKept  : 0;
                    return (
                      <div key={person} style={{ background:"rgba(255,255,255,0.04)", border:`2px solid ${color}66`, borderRadius:16, padding:18, position:"relative", overflow:"hidden", minWidth:160 }}>
                        <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:color }} />
                        <div style={{ fontWeight:800, fontSize:16, color, marginBottom:14, textAlign:"center" }}>{person}</div>
                        {[
                          { label:"Unique Customers",  value:fmtNum(m.enquiries),    ok:null },
                          { label:"Snap Cells",         value:`${fmtNum(m.snapCells)} (${pct(m.snapRate)})`,  ok:m.snapRate>=0.40  },
                          { label:"Appointments",       value:fmtNum(m.appointments), ok:null },
                          { label:"Appts Kept",         value:`${fmtNum(m.apptsKept)} (${pct(m.keptRate)})`, ok:null },
                          { label:"Outbound Calls",     value:fmtNum(m.outbound),     ok:null },
                          { label:"Quotes",             value:`${fmtNum(m.quotes)} (${pct(m.quoteRate)})`,   ok:m.quoteRate>=0.30 },
                          { label:"Total Orders",       value:`${fmtNum(m.orders)} (${pct(m.closeRate)})`,   ok:m.closeRate>=0.20 },
                          { label:"divider" },
                          { label:"Overall Conv.",      value:pct(overallConv), ok:null },
                          { label:"Appt Conv.",         value:pct(apptConv),    ok:apptConv>=0.50 },
                        ].map((row,i) =>
                          row.label === "divider"
                            ? <div key={i} style={{ borderTop:"1px solid rgba(255,255,255,0.08)", margin:"8px 0" }} />
                            : <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                                <span style={{ color:"#64748B", fontSize:11 }}>{row.label}</span>
                                <span style={{ fontWeight:700, fontSize:11, color: row.ok===true?"#10B981":row.ok===false?"#EF4444":"#E2E8F0" }}>{row.value}</span>
                              </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Volume comparison chart */}
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:16 }}>
                  <div style={{ fontWeight:700, color:"#E2E8F0", marginBottom:16 }}>Volume Comparison</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={comparisonChartData} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="metric" tick={{ fill:"#94A3B8", fontSize:11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>fmtNum(v)} />
                      <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                      {selectedPeople.map(p=><Bar key={p} dataKey={p} fill={PERSON_COLORS[p]||"#94A3B8"} radius={[4,4,0,0]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Conversion rate comparison chart */}
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:28 }}>
                  <div style={{ fontWeight:700, color:"#E2E8F0", marginBottom:16 }}>Conversion Rate Comparison %</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={["Snap Rate","Quote Rate","Order Rate","Appt Conv."].map(metric => {
                        const rateKey = {"Snap Rate":"snapRate","Quote Rate":"quoteRate","Order Rate":"closeRate"};
                        const entry = { metric };
                        selectedPeople.forEach(person => {
                          const rows = filtered.filter(d=>d.person===person);
                          const m = rows.length ? calcMetrics(rows) : {};
                          entry[person] = metric==="Appt Conv."
                            ? +((m.apptsKept ? m.orders/m.apptsKept : 0)*100).toFixed(1)
                            : +((m[rateKey[metric]]||0)*100).toFixed(1);
                        });
                        return entry;
                      })}
                      margin={{ top:4, right:8, left:-8, bottom:0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="metric" tick={{ fill:"#94A3B8", fontSize:11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>`${Number(v).toFixed(1)}%`} />
                      <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                      {selectedPeople.map(p=><Bar key={p} dataKey={p} fill={PERSON_COLORS[p]||"#94A3B8"} radius={[4,4,0,0]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <SectionHeader>Combined Totals</SectionHeader>
              </>
            )}

            <SectionHeader>Key Performance Indicators</SectionHeader>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))", gap:14, marginBottom:28 }}>
              <KPICard title="Unique Customers"  value={fmtNum(overall.enquiries)}    color="#6366F1" sub="Total enquiries"                        trend={momEnq}     prevValue={momPrev ? (momPrev.enquiries    || 0) : undefined} trendLabel={momLabel} />
              <KPICard title="Snap Cells"         value={fmtNum(overall.snapCells)}    color="#3B82F6" sub={`${pct(overall.snapRate)} of enquiries`} trend={momSnap$}   prevValue={momPrev ? (momPrev.snapCells    || 0) : undefined} trendLabel={momLabel} target={0.40} />
              <KPICard title="Appointments"       value={fmtNum(overall.appointments)} color="#06B6D4" sub={`${pct(overall.apptRate)} of enquiries`} trend={momAppt}    prevValue={momPrev ? (momPrev.appointments || 0) : undefined} trendLabel={momLabel} />
              <KPICard title="Appointments Kept"  value={fmtNum(overall.apptsKept)}    color="#8B5CF6" sub={`${pct(overall.keptRate)} of booked`}    trend={momKept}    prevValue={momPrev ? (momPrev.apptsKept    || 0) : undefined} trendLabel={momLabel} />
              <KPICard title="Outbound Calls"     value={fmtNum(overall.outbound)}     color="#F97316" trend={momOutbound} prevValue={momPrev ? (momPrev.outbound || 0) : undefined} trendLabel={momLabel} />
              <KPICard title="Quotes"             value={fmtNum(overall.quotes)}       color="#10B981" sub={`${pct(overall.quoteRate)} of enquiries`} trend={momQuotes$} prevValue={momPrev ? (momPrev.quotes       || 0) : undefined} trendLabel={momLabel} target={0.30} />
              <KPICard title="Total Orders"       value={fmtNum(overall.orders)}       color="#EC4899" sub={`${pct(overall.closeRate)} order rate`}   trend={momOrders}  prevValue={momPrev ? (momPrev.orders       || 0) : undefined} trendLabel={momLabel} target={0.20} />
            </div>

            {/* ── FUNNEL 1: From Unique Customers ── */}
            <SectionHeader>Conversion Funnel — From Unique Customers</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:16 }}>
              <div style={{ display:"flex", gap:6, alignItems:"stretch", flexWrap:"wrap", marginBottom:20 }}>
                {[
                  { label:"Unique Customers", value:fmtNum(overall.enquiries),    pct:null,              color:"#6366F1" },
                  { label:"Snap Cells",        value:fmtNum(overall.snapCells),    pct:overall.snapRate,  color:"#3B82F6", target:0.40 },
                  { label:"Appointments",      value:fmtNum(overall.appointments), pct:overall.apptRate,  color:"#06B6D4" },
                  { label:"Appts Kept",        value:fmtNum(overall.apptsKept),    pct:overall.keptRate,  color:"#8B5CF6", fromLabel:"of booked" },
                  { label:"Quotes",            value:fmtNum(overall.quotes),       pct:overall.quoteRate, color:"#10B981", target:0.30 },
                  { label:"Total Orders",      value:fmtNum(overall.orders),       pct:overall.orderRate, color:"#EC4899", target:0.20 },
                ].map((step, i, arr) => (
                  <div key={step.label} style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:120 }}>
                    <div style={{ flex:1, background:"rgba(255,255,255,0.04)", border:`1px solid ${step.color}44`, borderRadius:12, padding:"14px 16px", textAlign:"center" }}>
                      <div style={{ color:"#64748B", fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{step.label}</div>
                      <div style={{ fontSize:22, fontWeight:800, color:step.color }}>{step.value}</div>
                      {step.pct != null && (
                        <div style={{ marginTop:4, fontSize:12, fontWeight:700, color: step.target ? (step.pct >= step.target ? "#10B981" : "#EF4444") : "#94A3B8" }}>
                          {pct(step.pct)} {step.fromLabel || "of enquiries"}
                          {step.target && <span style={{ color:"#475569", fontWeight:400 }}> (tgt {pct(step.target)})</span>}
                        </div>
                      )}
                    </div>
                    {i < arr.length-1 && <div style={{ color:"#475569", fontSize:18, fontWeight:700, flexShrink:0 }}>→</div>}
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={monthlyTrend} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>`${Number(v).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                  <Line type="monotone" dataKey="snapPct"  stroke="#3B82F6" strokeWidth={2} dot={false} name="Snap Cell %" />
                  <Line type="monotone" dataKey="apptPct"  stroke="#06B6D4" strokeWidth={2} dot={false} name="Appt %" />
                  <Line type="monotone" dataKey="quotePct" stroke="#10B981" strokeWidth={2} dot={false} name="Quote %" />
                  <Line type="monotone" dataKey="orderPct" stroke="#EC4899" strokeWidth={2} dot={false} name="Order %" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* ── FUNNEL 2: Conversion Rates ── */}
            <SectionHeader>Conversion Rates</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:28 }}>
              <div style={{ display:"flex", gap:6, alignItems:"stretch", flexWrap:"wrap", marginBottom:20 }}>
                {[
                  { label:"Overall Conversion Rate", value:pct(overall.enquiries ? overall.orders/overall.enquiries : 0),      color:"#6366F1", fromLabel:"Unique Customers → Orders",        sub:`${fmtNum(overall.enquiries)} customers → ${fmtNum(overall.orders)} orders` },
                  { label:"Appt Show Rate",          value:pct(overall.appointments ? overall.apptsKept/overall.appointments : 0), color:"#06B6D4", fromLabel:"Appointments → Appointments Kept", sub:`${fmtNum(overall.appointments)} booked → ${fmtNum(overall.apptsKept)} kept` },
                  { label:"Appointment Conversion",  value:pct(overall.apptsKept ? overall.orders/overall.apptsKept : 0),          color:"#8B5CF6", fromLabel:"Appts Kept → Orders",               sub:`${fmtNum(overall.apptsKept)} kept → ${fmtNum(overall.orders)} orders` },
                ].map((step, i, arr) => (
                  <div key={step.label} style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:200 }}>
                    <div style={{ flex:1, background:"rgba(255,255,255,0.04)", border:`1px solid ${step.color}44`, borderRadius:12, padding:"20px 20px", textAlign:"center" }}>
                      <div style={{ color:"#64748B", fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>{step.label}</div>
                      <div style={{ fontSize:36, fontWeight:900, color:step.color, letterSpacing:"-0.02em" }}>{step.value}</div>
                      <div style={{ marginTop:6, fontSize:12, color:"#94A3B8" }}>{step.fromLabel}</div>
                      {step.sub && <div style={{ marginTop:4, fontSize:11, color:"#475569" }}>{step.sub}</div>}
                    </div>
                    {i < arr.length-1 && <div style={{ color:"#475569", fontSize:18, fontWeight:700, flexShrink:0 }}>→</div>}
                  </div>
                ))}
              </div>
              <SankeyFunnel data={overall} />
            </div>
          </>
        )}

        {/* ── YEAR ON YEAR ── */}
        {activeTab==="yoy" && (
          <>
            <SectionHeader>Year on Year — Enquiries by Month</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:24 }}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={yoyData} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill:"#94A3B8", fontSize:12, fontWeight:600 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                  {allYears.map(y=>(
                    <Bar key={y} dataKey={`enq_${y}`} name={`Enquiries ${y}`} fill={YEAR_COLORS[y]||"#6366F1"} radius={[4,4,0,0]} opacity={0.85} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <SectionHeader>Year on Year — Orders by Month</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:24 }}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={yoyData} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill:"#94A3B8", fontSize:12, fontWeight:600 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                  {allYears.map(y=>(
                    <Bar key={y} dataKey={`orders_${y}`} name={`Orders ${y}`} fill={YEAR_COLORS[y]||"#6366F1"} radius={[4,4,0,0]} opacity={0.85} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <SectionHeader>Year on Year — Order Rate % by Month</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:24 }}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={yoyData} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill:"#94A3B8", fontSize:12, fontWeight:600 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>`${Number(v).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                  <ReferenceLine y={20} stroke="#F59E0B44" strokeDasharray="4 4" label={{ value:"Target 20%", fill:"#F59E0B88", fontSize:10 }} />
                  {allYears.map(y=>(
                    <Line key={y} type="monotone" dataKey={`close_${y}`} name={`Order Rate % ${y}`} stroke={YEAR_COLORS[y]||"#6366F1"} strokeWidth={2.5} dot={{ r:4 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* YoY Summary Table */}
            <SectionHeader>Year on Year Summary</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:"left", color:"#64748B", padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>Month</th>
                    {allYears.map(y=><th key={y} colSpan={3} style={{ textAlign:"center", color:YEAR_COLORS[y], padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>{y}</th>)}
                  </tr>
                  <tr>
                    <th style={{ color:"#475569", padding:"4px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}></th>
                    {allYears.map(y=>["Enquiries","Orders","Order Rate"].map(h=>(
                      <th key={y+h} style={{ textAlign:"right", color:"#475569", padding:"4px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:11 }}>{h}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {yoyData.map(row=>(
                    <tr key={row.month} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding:"8px 12px", fontWeight:700, color:"#E2E8F0" }}>{row.month}</td>
                      {allYears.map(y=>(
                        <>
                          <td key={y+"e"} style={{ textAlign:"right", padding:"8px 12px", color:"#94A3B8" }}>{row[`enq_${y}`] != null ? fmtNum(row[`enq_${y}`]) : "—"}</td>
                          <td key={y+"o"} style={{ textAlign:"right", padding:"8px 12px", color:"#94A3B8" }}>{row[`orders_${y}`] != null ? fmtNum(row[`orders_${y}`]) : "—"}</td>
                          <td key={y+"c"} style={{ textAlign:"right", padding:"8px 12px", color: row[`close_${y}`]>=20?"#10B981":"#EF4444" }}>{row[`close_${y}`] != null ? `${row[`close_${y}`]}%` : "—"}</td>
                        </>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── FUNNEL TRENDS ── */}
        {activeTab==="funnel" && (
          <>
            <SectionHeader>Pipeline Conversion by Month</SectionHeader>
            {[
              { key:"snapPct",  label:"Snap Cell Rate %", target:40, color:"#3B82F6" },
              { key:"quotePct", label:"Quote Rate %",      target:30, color:"#10B981" },
              { key:"closePct", label:"Order Rate %",      target:20, color:"#F59E0B" },
            ].map(({ key, label, target, color })=>(
              <div key={key} style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                  <span style={{ fontWeight:700, color:"#E2E8F0" }}>{label}</span>
                  <span style={{ color:"#64748B", fontSize:13 }}>Target: {target}%</span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={monthlyTrend} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill:"#64748B", fontSize:10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill:"#64748B", fontSize:10 }} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>`${Number(v).toFixed(1)}%`} />
                    <ReferenceLine y={target} stroke={color+"88"} strokeDasharray="4 4" />
                    <Bar dataKey={key} name={label} radius={[4,4,0,0]}>
                      {monthlyTrend.map((entry,idx)=>(
                        <Cell key={idx} fill={entry[key]>=target ? color : "#EF4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </>
        )}

        {/* ── TEAM PERFORMANCE ── */}
        {activeTab==="team" && (
          <>
            {/* Multi-person comparison when 2+ selected */}
            {selectedPeople.length >= 2 && (
              <>
                <SectionHeader>Staff Comparison — {selectedPeople.join(" vs ")}</SectionHeader>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:16, marginBottom:28 }}>
                  {selectedPeople.map(person => {
                    const rows = filtered.filter(d => d.person === person);
                    if (!rows.length) return null;
                    const m = calcMetrics(rows);
                    const color = PERSON_COLORS[person] || "#94A3B8";
                    return (
                      <div key={person} style={{ background:"rgba(255,255,255,0.04)", border:`2px solid ${color}55`, borderRadius:16, padding:20, position:"relative", overflow:"hidden" }}>
                        <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:color }} />
                        <div style={{ fontWeight:800, fontSize:18, color, marginBottom:16 }}>{person}</div>
                        {[
                          { label:"Unique Customers",  value:fmtNum(m.enquiries),    bar:null },
                          { label:"Snap Cells",         value:`${fmtNum(m.snapCells)} (${pct(m.snapRate)})`,    bar:m.snapRate,  target:0.40, color:"#3B82F6" },
                          { label:"Appointments",       value:fmtNum(m.appointments), bar:null },
                          { label:"Appointments Kept",  value:`${fmtNum(m.apptsKept)} (${pct(m.keptRate)})`,   bar:m.keptRate,  target:null, color:"#8B5CF6" },
                          { label:"Outbound Calls",     value:fmtNum(m.outbound),     bar:null },
                          { label:"Quotes",             value:`${fmtNum(m.quotes)} (${pct(m.quoteRate)})`,     bar:m.quoteRate, target:0.30, color:"#10B981" },
                          { label:"Total Orders",       value:`${fmtNum(m.orders)} (${pct(m.closeRate)})`,     bar:m.closeRate, target:0.20, color:"#EC4899" },
                        ].map(row => (
                          <div key={row.label} style={{ marginBottom:10 }}>
                            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                              <span style={{ color:"#64748B", fontSize:12 }}>{row.label}</span>
                              <span style={{ fontWeight:700, fontSize:12, color: row.bar!=null ? (row.target ? (row.bar>=row.target?"#10B981":"#EF4444") : "#E2E8F0") : "#E2E8F0" }}>{row.value}</span>
                            </div>
                            {row.bar!=null && (
                              <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:4, height:5, overflow:"hidden", position:"relative" }}>
                                <div style={{ width:`${Math.min(row.bar/0.6*100,100)}%`, height:"100%", background: row.target?(row.bar>=row.target?row.color:"#EF4444"):row.color, borderRadius:4 }} />
                                {row.target && <div style={{ position:"absolute", top:0, bottom:0, left:`${Math.min(row.target/0.6*100,100)}%`, width:2, background:"#FFFFFF33" }} />}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>

                {/* Side-by-side bar chart */}
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:28 }}>
                  <div style={{ fontWeight:700, color:"#E2E8F0", marginBottom:16 }}>Key Metrics Side by Side</div>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={comparisonChartData} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="metric" tick={{ fill:"#94A3B8", fontSize:11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill:"#64748B", fontSize:11 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>fmtNum(v)} />
                      <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                      {selectedPeople.map(person=>(
                        <Bar key={person} dataKey={person} fill={PERSON_COLORS[person]||"#94A3B8"} radius={[4,4,0,0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
            <SectionHeader>Team Conversion Comparison</SectionHeader>
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:24, border:"1px solid rgba(255,255,255,0.07)", marginBottom:24 }}>
              <ResponsiveContainer width="100%" height={Math.max(300, personSummary.length*50)}>
                <BarChart data={personSummary} layout="vertical" margin={{ top:4, right:40, left:60, bottom:4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tick={{ fill:"#64748B", fontSize:11 }} tickFormatter={v=>`${v.toFixed(0)}%`} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="person" tick={{ fill:"#94A3B8", fontSize:12, fontWeight:600 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v=>`${Number(v).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ color:"#94A3B8", fontSize:12 }} />
                  <Bar dataKey={d=>+(d.snapRate *100).toFixed(1)} name="Snap Rate %"  fill="#3B82F6" radius={[0,4,4,0]} />
                  <Bar dataKey={d=>+(d.quoteRate*100).toFixed(1)} name="Quote Rate %" fill="#10B981" radius={[0,4,4,0]} />
                  <Bar dataKey={d=>+(d.closeRate*100).toFixed(1)} name="Order Rate %" fill="#F59E0B" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <SectionHeader>Individual Scorecards</SectionHeader>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))", gap:16 }}>
              {personSummary.map(p=>{
                const score = [p.snapRate>=0.40, p.quoteRate>=0.30, p.closeRate>=0.20].filter(Boolean).length;
                return (
                  <div key={p.person} style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${p.color}33`, borderRadius:16, padding:20, position:"relative", overflow:"hidden" }}>
                    <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:p.color }} />
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                      <div style={{ fontWeight:800, fontSize:16, color:"#F1F5F9" }}>{p.person}</div>
                      <div style={{ background:score===3?"#10B98122":score>=2?"#F59E0B22":"#EF444422", color:score===3?"#10B981":score>=2?"#F59E0B":"#EF4444", borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:700 }}>{score}/3 targets</div>
                    </div>
                    {[
                      { label:"Unique Customers",   value:fmtNum(p.enquiries),    raw:null },
                      { label:"Snap Cells",          value:`${fmtNum(p.snapCells)} (${pct(p.snapRate)})`,  raw:p.snapRate,  target:0.40 },
                      { label:"Appointments",        value:fmtNum(p.appointments), raw:null },
                      { label:"Appointments Kept",   value:`${fmtNum(p.apptsKept)} (${pct(p.keptRate)})`, raw:null },
                      { label:"Outbound Calls",      value:fmtNum(p.outbound),     raw:null },
                      { label:"Quotes",              value:`${fmtNum(p.quotes)} (${pct(p.quoteRate)})`,   raw:p.quoteRate, target:0.30 },
                      { label:"Total Orders",        value:`${fmtNum(p.orders)} (${pct(p.closeRate)})`,   raw:p.closeRate, target:0.20 },
                    ].map(row=>(
                      <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ color:"#64748B", fontSize:13 }}>{row.label}</span>
                        <span style={{ fontWeight:700, fontSize:13, color:row.raw!=null?(row.raw>=row.target?"#10B981":"#EF4444"):"#E2E8F0" }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── IMPROVEMENT ── */}
        {activeTab==="improvement" && (
          <>
            <SectionHeader>Performance vs Targets</SectionHeader>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:20, marginBottom:28 }}>
              {[
                { key:"snapRate",  label:"Snap Cell Rate", target:0.40, color:"#3B82F6" },
                { key:"quoteRate", label:"Quote Rate",      target:0.30, color:"#10B981" },
                { key:"closeRate", label:"Order Rate",      target:0.20, color:"#F59E0B" },
              ].map(({ key, label, target, color })=>(
                <div key={key} style={{ background:"rgba(255,255,255,0.03)", borderRadius:16, padding:20, border:"1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontWeight:700, color:"#E2E8F0", marginBottom:4 }}>{label}</div>
                  <div style={{ color:"#64748B", fontSize:12, marginBottom:14 }}>Target: {pct(target)}</div>
                  {[...personSummary].sort((a,b)=>b[key]-a[key]).map(p=>{
                    const val=p[key], ok=val>=target, barW=Math.min(val/0.70*100,100);
                    return (
                      <div key={p.person} style={{ marginBottom:12 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontSize:13, color:"#94A3B8", fontWeight:600 }}>{p.person}</span>
                          <span style={{ fontSize:13, fontWeight:700, color:ok?"#10B981":"#EF4444" }}>{pct(val)} {ok?"✓":"✗"}</span>
                        </div>
                        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:6, height:8, overflow:"hidden", position:"relative" }}>
                          <div style={{ width:`${barW}%`, height:"100%", background:ok?color:"#EF4444", borderRadius:6 }} />
                          <div style={{ position:"absolute", top:0, bottom:0, left:`${Math.min(target/0.70*100,100)}%`, width:2, background:"#FFFFFF44" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <SectionHeader>Needs Attention</SectionHeader>
            {improvements.length===0 ? (
              <div style={{ textAlign:"center", padding:40, color:"#10B981", fontSize:16, fontWeight:700 }}>🎉 All team members are hitting their targets!</div>
            ):(
              <div style={{ display:"grid", gap:12 }}>
                {improvements.map(p=>{
                  const flags=[
                    p.snapRate <0.40 && { metric:"Snap Rate",  val:p.snapRate,  target:0.40 },
                    p.quoteRate<0.30 && { metric:"Quote Rate", val:p.quoteRate, target:0.30 },
                    p.closeRate<0.20 && { metric:"Order Rate", val:p.closeRate, target:0.20 },
                  ].filter(Boolean);
                  return (
                    <div key={p.person} style={{ background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:14, padding:"14px 20px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                        <span style={{ fontWeight:800, fontSize:15, color:"#F1F5F9" }}>{p.person}</span>
                        <span style={{ color:"#EF4444", fontSize:12, fontWeight:600 }}>{flags.length} metric{flags.length>1?"s":""} below target</span>
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                        {flags.map(f=>(
                          <div key={f.metric} style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:8, padding:"4px 12px", fontSize:12, color:"#FCA5A5" }}>
                            <strong>{f.metric}</strong>: {pct(f.val)} — needs <strong>+{pct(f.target-f.val)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <SectionHeader>Top Performers</SectionHeader>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:16, marginTop:8 }}>
              {[
                { metric:"closeRate", label:"Best Order Rate" },
                { metric:"quoteRate", label:"Best Quote Rate" },
                { metric:"orders",    label:"Most Orders"     },
                { metric:"enquiries", label:"Most Enquiries"  },
              ].map(({ metric, label })=>{
                const top=[...personSummary].sort((a,b)=>b[metric]-a[metric])[0];
                if (!top) return null;
                return (
                  <div key={metric} style={{ background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.2)", borderRadius:14, padding:"16px 20px", textAlign:"center" }}>
                    <div style={{ fontSize:26 }}>🏆</div>
                    <div style={{ color:"#64748B", fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", margin:"6px 0 4px" }}>{label}</div>
                    <div style={{ fontWeight:800, fontSize:17, color:top.color||"#10B981" }}>{top.person}</div>
                    <div style={{ color:"#10B981", fontWeight:700, fontSize:14 }}>{["orders","enquiries"].includes(metric)?fmtNum(top[metric]):pct(top[metric])}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
