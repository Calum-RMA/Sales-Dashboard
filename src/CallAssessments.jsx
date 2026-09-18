import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

/* ─── AI CALL ASSESSMENTS ────────────────────────────────────────────────────
   CallGear's AI call scoring, per call and per checklist point.
   Written by eskimo-scraper/callgear-scores.js to two tabs on the same sheet:
     • "Call Scores"  — one row per scored call
     • "Score Points" — one row per checklist point per call (drives the trends)
   On Netlify the requests hit /api/scores and /api/points (see public/_redirects).  */
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const SHEET_ID = "1VBZivRXHMPSwqhjpDL2aHzrJe_iazlfSO_vfwsj9LWw";
const GVIZ = (tab) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
const SCORES_SRC = IS_LOCAL ? GVIZ("Call Scores") : "/api/scores";
const POINTS_SRC = IS_LOCAL ? GVIZ("Score Points") : "/api/points";

/* Short labels for the checklist points (matched on the start of the full text). */
const SHORT = [
  ["the operator greets by time of day", "Greeting: time of day, company, own name"],
  ["operator establishes customers name", "Got the customer's name"],
  ["operator finds out information about the customer", "Customer info (area, current car)"],
  ["found out if there is a part exchange", "Part exchange & finance"],
  ["where did you see us advertised", "Where they saw us advertised"],
  ["car they are wanting interested in", "Car of interest / alternatives"],
  ["asked for the appointment", "Asked for the appointment"],
  ["offered a full video walk through", "Offered a video walk-through"],
  ["sent them the location", "Sent the location"],
  ["if the customer is qualified, asked if they want to reserve", "Reserve & deposit (if qualified)"],
];
const shortName = (full) => {
  const f = String(full || "").trim().toLowerCase();
  const hit = SHORT.find(([k]) => f.startsWith(k));
  if (hit) return hit[1];
  const t = String(full || "").trim();
  return t.length > 46 ? t.slice(0, 44) + "…" : t;
};

/* Miss-rate ramp (one hue, light → dark) for the heat grids. */
const SEQ = ["#1b2530", "#1d3a52", "#1f4f73", "#2a6699", "#3f82bd", "#69a5d8", "#a6cdee"];
const BANDS = [0, 10, 25, 40, 55, 70, 85];
const seqIndex = (rate) => { let i = 0; BANDS.forEach((b, k) => { if (rate >= b) i = k; }); return i; };
const cellStyle = (rate) => { const i = seqIndex(rate); return { background: SEQ[i], color: i >= 4 ? "#0e1216" : "#E2E8F0" }; };

const PANEL = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "20px 22px", marginTop: 22 };
const H = { color: "#F1F5F9", fontSize: 16, fontWeight: 800 };
const SUB = { color: "#64748B", fontSize: 12 };
const TOOLTIP_STYLE = { background: "#14161a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", fontSize: 13 };

/* ─── helpers ───────────────────────────────────────────────────────────────*/
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
const monday = (s) => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoOf(d); };
const fmtDay = (s) => parseISO(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const pctText = (v) => (v == null || isNaN(v) ? "–" : `${Math.round(v)}%`);
const toNum = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; };
const normDate = (v) => {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  const d = new Date(s); return isNaN(d) ? "" : isoOf(d);
};

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((x) => x !== "")).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? "" : r[i]])));
}
async function getText(url) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = await res.text();
  if (/^\s*</.test(t)) throw new Error("sheet not readable");
  return t;
}

function Card({ title, color, value, sub }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94A3B8", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: color, display: "inline-block" }} />{title}
      </div>
      <div style={{ color: "#fff", fontSize: 30, fontWeight: 800, margin: "8px 0 2px", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: "#64748B", fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
function Delta({ now, before, unit = " pts", invert = false, compact = false }) {
  if (now == null || before == null || isNaN(now) || isNaN(before)) return <span style={{ color: "#64748B", fontSize: 12 }}>{compact ? "–" : "no previous period"}</span>;
  const d = Math.round(now - before);
  if (d === 0) return <span style={{ color: "#64748B", fontSize: 12, fontWeight: 700 }}>{compact ? "→ 0" : "→ no change"}</span>;
  const good = invert ? d < 0 : d > 0;
  return <span style={{ color: good ? "#4ade80" : "#f4a6a3", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}{unit}{compact ? "" : " vs previous"}</span>;
}

/* ─── component ─────────────────────────────────────────────────────────────*/
export default function CallAssessments({ refreshKey = 0 }) {
  const [scores, setScores] = useState([]);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("30");   // 7 | 30 | 90 | all
  const [rep, setRep] = useState("");
  const [dir, setDir] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [a, b] = await Promise.all([getText(SCORES_SRC), getText(POINTS_SRC)]);
        if (!alive) return;
        setScores(parseCSV(a).map((r) => ({
          date: normDate(r["date"]), time: r["time"], id: String(r["call id"] || "").trim(),
          rep: (r["sales person"] || "").trim(), dir: (r["direction"] || "").trim(), scen: (r["scenario"] || "").trim(),
          score: toNum(r["score %"]), target: toNum(r["target %"]), passed: String(r["passed"]).trim().toLowerCase() === "yes",
          hit: toNum(r["points hit"]), total: toNum(r["points total"]), missed: r["missed points"] || "",
          talk: toNum(r["talk secs"]), number: r["number"] || "", summary: r["summary"] || "",
        })).filter((c) => c.date && c.score != null));
        setPoints(parseCSV(b).map((r) => ({
          date: normDate(r["date"]), id: String(r["call id"] || "").trim(), rep: (r["sales person"] || "").trim(),
          dir: (r["direction"] || "").trim(), no: toNum(r["point no"]), point: (r["point"] || "").trim(),
          imp: (r["importance"] || "").trim(), hit: String(r["hit"]).trim() === "1",
        })).filter((p) => p.date && p.point));
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const reps = useMemo(() => [...new Set(scores.map((c) => c.rep).filter(Boolean))].sort(), [scores]);

  const range = useMemo(() => {
    const today = isoOf(new Date());
    if (period === "all") {
      const first = scores.reduce((m, c) => (!m || c.date < m ? c.date : m), "") || today;
      return { from: first, to: today, prevFrom: null, prevTo: null, days: Math.round((parseISO(today) - parseISO(first)) / 864e5) + 1 };
    }
    const n = Number(period), from = addDays(today, -(n - 1));
    return { from, to: today, prevFrom: addDays(from, -n), prevTo: addDays(from, -1), days: n };
  }, [period, scores]);

  const dims = (x, ignoreRep) => (ignoreRep || !rep || x.rep === rep) && (!dir || x.dir === dir);
  const within = (x, a, b) => a && x.date >= a && x.date <= b;

  const cur = useMemo(() => scores.filter((c) => dims(c) && within(c, range.from, range.to)), [scores, range, rep, dir]);
  const prev = useMemo(() => (range.prevFrom ? scores.filter((c) => dims(c) && within(c, range.prevFrom, range.prevTo)) : []), [scores, range, rep, dir]);
  const pCur = useMemo(() => points.filter((p) => dims(p) && within(p, range.from, range.to)), [points, range, rep, dir]);
  const pPrev = useMemo(() => (range.prevFrom ? points.filter((p) => dims(p) && within(p, range.prevFrom, range.prevTo)) : []), [points, range, rep, dir]);

  const avg = (a) => (a.length ? a.reduce((s, x) => s + x.score, 0) / a.length : null);
  const missStats = (list) => {
    const m = new Map();
    for (const p of list) {
      if (!m.has(p.point)) m.set(p.point, { point: p.point, no: p.no, imp: p.imp, n: 0, miss: 0 });
      const s = m.get(p.point); s.n++; if (!p.hit) s.miss++;
      if (p.no != null && (s.no == null || p.no < s.no)) s.no = p.no;
    }
    for (const s of m.values()) s.rate = s.n ? (s.miss / s.n) * 100 : null;
    return m;
  };

  const curMiss = useMemo(() => missStats(pCur), [pCur]);
  const prevMiss = useMemo(() => missStats(pPrev), [pPrev]);
  const missList = useMemo(() => [...curMiss.values()].sort((a, b) => b.rate - a.rate), [curMiss]);
  const pointOrder = useMemo(() => [...curMiss.values()].sort((a, b) => (a.no || 0) - (b.no || 0)), [curMiss]);

  const daily = range.days <= 14;
  const bucketKeys = useMemo(() => {
    const keys = [];
    if (daily) { for (let d = range.from; d <= range.to; d = addDays(d, 1)) keys.push(d); }
    else { for (let d = monday(range.from); d <= range.to; d = addDays(d, 7)) keys.push(d); }
    return keys;
  }, [range, daily]);
  const keyOf = (date) => (daily ? date : monday(date));

  const trendData = useMemo(() => {
    const agg = new Map(bucketKeys.map((k) => [k, { n: 0, sum: 0, pass: 0 }]));
    cur.forEach((c) => { const a = agg.get(keyOf(c.date)); if (a) { a.n++; a.sum += c.score; if (c.passed) a.pass++; } });
    return bucketKeys.map((k) => {
      const a = agg.get(k);
      return { name: daily ? fmtDay(k) : `w/c ${fmtDay(k)}`, score: a.n ? Math.round(a.sum / a.n) : null, calls: a.n, pass: a.n ? Math.round((a.pass / a.n) * 100) : null };
    });
  }, [cur, bucketKeys, daily]);

  const target = (cur.find((c) => c.target != null) || {}).target ?? 70;
  const avgCur = avg(cur), avgPrev = avg(prev);
  const passCur = cur.length ? (cur.filter((c) => c.passed).length / cur.length) * 100 : null;
  const passPrev = prev.length ? (prev.filter((c) => c.passed).length / prev.length) * 100 : null;
  const topMiss = missList.filter((s) => s.n >= 3)[0];

  const repRows = useMemo(() => {
    const allCur = scores.filter((c) => dims(c, true) && within(c, range.from, range.to));
    const allPrev = range.prevFrom ? scores.filter((c) => dims(c, true) && within(c, range.prevFrom, range.prevTo)) : [];
    const allPts = points.filter((p) => dims(p, true) && within(p, range.from, range.to));
    return [...new Set(allCur.map((c) => c.rep))].sort().map((name) => {
      const a = allCur.filter((c) => c.rep === name), b = allPrev.filter((c) => c.rep === name);
      const top = [...missStats(allPts.filter((p) => p.rep === name)).values()].sort((x, y) => y.rate - x.rate)[0];
      return { rep: name, n: a.length, av: avg(a), bv: avg(b), pass: (a.filter((c) => c.passed).length / a.length) * 100, top };
    }).sort((x, y) => y.av - x.av);
  }, [scores, points, range, dir]);

  const repGrid = useMemo(() => {
    const allPts = points.filter((p) => dims(p, true) && within(p, range.from, range.to));
    const names = [...new Set(allPts.map((p) => p.rep))].sort();
    const cells = new Map(), calls = new Map();
    allPts.forEach((p) => {
      const k = `${p.point}|${p.rep}`, c = cells.get(k) || { n: 0, miss: 0 };
      c.n++; if (!p.hit) c.miss++; cells.set(k, c);
      if (!calls.has(p.rep)) calls.set(p.rep, new Set()); calls.get(p.rep).add(p.id);
    });
    return { names, cells, calls };
  }, [points, range, dir]);

  const timeGrid = useMemo(() => {
    const cells = new Map();
    pCur.forEach((p) => { const k = `${p.point}|${keyOf(p.date)}`, c = cells.get(k) || { n: 0, miss: 0 }; c.n++; if (!p.hit) c.miss++; cells.set(k, c); });
    return cells;
  }, [pCur, bucketKeys, daily]);

  const lowest = useMemo(() => cur.slice().sort((a, b) => a.score - b.score).slice(0, 12), [cur]);

  const segBtn = (active) => ({
    background: active ? "#ed2624" : "rgba(255,255,255,0.05)", color: active ? "#fff" : "#94A3B8",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  });
  const selectStyle = {
    background: "rgba(255,255,255,0.05)", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 600,
  };
  const th = { color: "#64748B", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 10px", textAlign: "left", fontWeight: 700 };
  const rowh = { ...th, color: "#E2E8F0", textTransform: "none", letterSpacing: 0, fontSize: 12, fontWeight: 500, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  if (loading) return <div style={{ textAlign: "center", color: "#64748B", padding: "60px 0" }}>Loading call assessments…</div>;
  if (error) return (
    <div style={{ ...PANEL, color: "#FDBA74" }}>
      Couldn’t load the call scores ({error}). The “Call Scores” and “Score Points” tabs are written by
      <code style={{ color: "#FCD34D" }}> node callgear-scores.js</code> in the scraper folder — run it once, then hit Refresh.
    </div>
  );
  if (!scores.length) return (
    <div style={{ ...PANEL, color: "#FDBA74" }}>
      No scored calls yet. Run <code style={{ color: "#FCD34D" }}>node callgear-scores.js --from=2026-08-18</code> in the scraper folder to backfill, then hit Refresh.
    </div>
  );

  return (
    <>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "22px 0 4px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setPeriod(v)} style={segBtn(period === v)}>{lbl}</button>
          ))}
        </div>
        <select value={rep} onChange={(e) => setRep(e.target.value)} style={selectStyle}>
          <option value="">All salespeople</option>
          {reps.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={dir} onChange={(e) => setDir(e.target.value)} style={selectStyle}>
          <option value="">Inbound &amp; outbound</option>
          <option value="Inbound">Inbound</option>
          <option value="Outbound">Outbound</option>
        </select>
        <div style={{ ...SUB, marginLeft: "auto" }}>
          {scores.length} scored calls on file · {fmtDay(range.from)} – {fmtDay(range.to)}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
        <Card title="Average Score" color="#1f7fc4" value={pctText(avgCur)} sub={<>Target {target}% · <Delta now={avgCur} before={avgPrev} /></>} />
        <Card title="Pass Rate" color="#91c7e8" value={pctText(passCur)} sub={<>{cur.filter((c) => c.passed).length} of {cur.length} passed · <Delta now={passCur} before={passPrev} /></>} />
        <Card title="Calls Scored" color="#5a93c4" value={cur.length} sub={`previous period ${prev.length}`} />
        <Card title="Most Missed Point" color="#ed2624"
          value={<span style={{ fontSize: 17, lineHeight: 1.25, display: "block" }}>{topMiss ? shortName(topMiss.point) : "–"}</span>}
          sub={topMiss ? `Missed on ${Math.round(topMiss.rate)}% of calls (${topMiss.miss} of ${topMiss.n})` : null} />
      </div>

      {/* Score trend */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <div style={H}>Score trend · by {daily ? "day" : "week"}</div>
          <div style={SUB}>average score per {daily ? "day" : "week"} · dashed line = {target}% pass target</div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trendData} margin={{ top: 6, right: 10, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" stroke="#64748B" fontSize={11} />
            <YAxis stroke="#64748B" fontSize={11} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#fff", fontWeight: 700, marginBottom: 2 }} itemStyle={{ color: "#fff" }}
              formatter={(v, n, p) => [`${v}% · ${p.payload.calls} call${p.payload.calls === 1 ? "" : "s"} · ${p.payload.pass}% passed`, "Average"]} />
            <ReferenceLine y={target} stroke="#94A3B8" strokeDasharray="5 4" />
            <Line type="monotone" dataKey="score" stroke="#91c7e8" strokeWidth={2} dot={{ r: 4, fill: "#91c7e8", strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Missed points + by salesperson */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18 }}>
        <div style={PANEL}>
          <div style={{ ...H, marginBottom: 4 }}>What is being missed</div>
          <div style={{ ...SUB, marginBottom: 14 }}>share of scored calls missing each point, and the change vs the previous period</div>
          {missList.length === 0 ? <div style={SUB}>No checklist data in this period.</div> : missList.map((s) => {
            const p = prevMiss.get(s.point);
            const d = p && p.n >= 3 && s.n >= 3 ? Math.round(s.rate - p.rate) : null;
            return (
              <div key={s.point} title={s.point} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 220px) 1fr 76px", gap: 10, alignItems: "center", padding: "5px 0" }}>
                <div style={{ color: "#E2E8F0", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {shortName(s.point)}<span style={{ color: "#64748B", fontSize: 10, textTransform: "uppercase", marginLeft: 6 }}>{s.imp}</span>
                </div>
                <div style={{ height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(1, s.rate)}%`, height: "100%", background: "#1f7fc4", borderRadius: "0 4px 4px 0" }} />
                </div>
                <div style={{ textAlign: "right", color: "#fff", fontSize: 13, fontWeight: 600 }}>
                  {Math.round(s.rate)}%{d != null && d !== 0 && <span style={{ color: d < 0 ? "#4ade80" : "#f4a6a3", fontSize: 11, marginLeft: 5 }}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={PANEL}>
          <div style={{ ...H, marginBottom: 4 }}>By salesperson</div>
          <div style={{ ...SUB, marginBottom: 14 }}>average score and pass rate, with the change vs the previous period</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>
                <th style={th}>Salesperson</th><th style={{ ...th, textAlign: "right" }}>Calls</th><th style={{ ...th, textAlign: "right" }}>Avg</th>
                <th style={{ ...th, textAlign: "right" }}>Pass</th><th style={th}>Change</th><th style={th}>Most missed</th>
              </tr></thead>
              <tbody>
                {repRows.map((r) => (
                  <tr key={r.rep} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#fff" }}>
                    <td style={{ padding: "9px 10px", color: "#E2E8F0", fontWeight: 600, whiteSpace: "nowrap" }}>{r.rep}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>{r.n}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "#91c7e8", fontWeight: 700 }}>{pctText(r.av)}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>{pctText(r.pass)}</td>
                    <td style={{ padding: "9px 10px" }}><Delta now={r.av} before={r.bv} unit=" pts" compact /></td>
                    <td style={{ padding: "9px 10px", color: "#94A3B8", fontSize: 12 }} title={r.top ? r.top.point : ""}>
                      {r.top ? `${shortName(r.top.point)} (${Math.round(r.top.rate)}%)` : "–"}
                    </td>
                  </tr>
                ))}
                {repRows.length === 0 && <tr><td colSpan={6} style={{ padding: 18, textAlign: "center", color: "#64748B" }}>No scored calls in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Missed-point trend */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <div style={H}>Missed-point trend</div>
          <div style={SUB}>% of calls missing each point per {daily ? "day" : "week"} · darker = missed more often · rows that stay dark are the habits to coach</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 12, width: "100%" }}>
            <thead><tr>
              <th />{bucketKeys.map((k) => <th key={k} style={{ ...th, textAlign: "center", whiteSpace: "nowrap" }}>{fmtDay(k)}</th>)}
              <th style={{ ...th, textAlign: "center" }}>Overall</th>
            </tr></thead>
            <tbody>
              {pointOrder.map((s) => (
                <tr key={s.point}>
                  <th style={rowh} title={s.point}>{shortName(s.point)}</th>
                  {bucketKeys.map((k) => {
                    const c = timeGrid.get(`${s.point}|${k}`);
                    if (!c) return <td key={k} style={{ textAlign: "center", color: "#3f4650", padding: "7px 4px" }}>·</td>;
                    const rate = (c.miss / c.n) * 100;
                    return <td key={k} title={`${shortName(s.point)} · ${daily ? fmtDay(k) : "w/c " + fmtDay(k)}: missed on ${c.miss} of ${c.n} calls`}
                      style={{ ...cellStyle(rate), textAlign: "center", padding: "7px 4px", borderRadius: 4, minWidth: 44 }}>{Math.round(rate)}</td>;
                  })}
                  <td style={{ ...cellStyle(s.rate), textAlign: "center", padding: "7px 4px", borderRadius: 4, fontWeight: 800 }}>{Math.round(s.rate)}</td>
                </tr>
              ))}
              {pointOrder.length === 0 && <tr><td style={{ padding: 18, color: "#64748B" }}>No checklist data in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap", ...SUB }}>
          Missed on:{BANDS.map((b, i) => <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 22, height: 10, borderRadius: 2, background: SEQ[i], display: "inline-block" }} />{b}{i === BANDS.length - 1 ? "%+" : ""}</span>)} · blank = no calls
        </div>
      </div>

      {/* Coaching grid */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <div style={H}>Coaching grid · salesperson × point</div>
          <div style={SUB}>% of each person’s calls missing each point in this period</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 12, width: "100%" }}>
            <thead><tr>
              <th />{repGrid.names.map((n) => (
                <th key={n} style={{ ...th, textAlign: "center", whiteSpace: "nowrap" }}>
                  {n.split(" ")[0]}<br /><span style={{ fontSize: 10, fontWeight: 500 }}>{repGrid.calls.get(n).size} calls</span>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {pointOrder.map((s) => (
                <tr key={s.point}>
                  <th style={rowh} title={s.point}>{shortName(s.point)}</th>
                  {repGrid.names.map((n) => {
                    const c = repGrid.cells.get(`${s.point}|${n}`);
                    if (!c) return <td key={n} style={{ textAlign: "center", color: "#3f4650", padding: "7px 4px" }}>·</td>;
                    const rate = (c.miss / c.n) * 100;
                    return <td key={n} title={`${n} · ${shortName(s.point)}: missed on ${c.miss} of ${c.n} calls`}
                      style={{ ...cellStyle(rate), textAlign: "center", padding: "7px 4px", borderRadius: 4, minWidth: 44 }}>{Math.round(rate)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lowest-scoring calls */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <div style={H}>Lowest-scoring calls</div>
          <div style={SUB}>the 12 lowest scores in this period, with the AI summary</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>
              <th style={th}>When</th><th style={th}>Salesperson</th><th style={{ ...th, textAlign: "right" }}>Score</th>
              <th style={th}>Missed</th><th style={th}>AI summary</th>
            </tr></thead>
            <tbody>
              {lowest.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#fff", verticalAlign: "top" }}>
                  <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                    {fmtDay(c.date)} {c.time}
                    <div style={{ color: "#64748B", fontSize: 11 }}>{c.dir} · {c.number}</div>
                  </td>
                  <td style={{ padding: "9px 10px", color: "#E2E8F0", fontWeight: 600, whiteSpace: "nowrap" }}>{c.rep}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: c.passed ? "#4ade80" : "#f4a6a3", fontWeight: 700 }}>{pctText(c.score)}</td>
                  <td style={{ padding: "9px 10px", color: "#94A3B8", fontSize: 12, maxWidth: 300 }}>
                    <b style={{ color: "#E2E8F0" }}>{c.missed ? c.missed.split("|").length : 0} missed:</b>{" "}
                    {c.missed ? c.missed.split("|").map((m) => shortName(m)).join(" · ") : "–"}
                  </td>
                  <td style={{ padding: "9px 10px", color: "#94A3B8", fontSize: 12, maxWidth: 380 }}>{c.summary || "–"}</td>
                </tr>
              ))}
              {lowest.length === 0 && <tr><td colSpan={5} style={{ padding: 18, textAlign: "center", color: "#64748B" }}>No scored calls in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...SUB, marginTop: 14 }}>
        Source: CallGear AI Call Assessment, via the “Call Scores” and “Score Points” tabs. Only calls matching an active CallGear
        scenario are scored (inbound only until the outbound scenario is switched on). Small samples swing a lot — read per-person
        figures alongside the call count.
      </div>
    </>
  );
}
