import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/* ─── ESKIMO LEADS & FUNNEL ──────────────────────────────────────────────────
   Live car-buying leads from the Eskimo BI API, written every 5 min by
   eskimo-scraper/eskimo-bi.js to the "Eskimo Leads" tab (one row per lead).
   Columns: Lead ID, Date Created, Date Updated, Salesperson, Source,
            Source Group, Status, Stage, Updated, Team.
   Volume/sources/allocation are by lead CREATION date; the funnel is each
   lead's CURRENT stage, so it's a live pipeline, not a daily-event count.
   On Netlify the request hits /api/leads (add it to public/_redirects).      */
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const SHEET_ID = "1VBZivRXHMPSwqhjpDL2aHzrJe_iazlfSO_vfwsj9LWw";
const GVIZ = (tab) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
const LEADS_SRC = IS_LOCAL ? GVIZ("Eskimo Leads") : "/api/leads";

/* Funnel order (a lead sits in exactly one stage). Lost is shown apart. */
const STAGES = ["New Opportunity", "Pending", "Contacted", "Quoted", "Appointment", "Sale agreed", "Deposit received", "Sale complete"];
const STAGE_COLOR = {
  "New Opportunity": "#5a93c4", "Pending": "#7d9cc0", "Contacted": "#1f7fc4", "Quoted": "#91c7e8", "Appointment": "#6ee7b7",
  "Sale agreed": "#fbbf24", "Deposit received": "#fb923c", "Sale complete": "#4ade80", "Lost": "#f4a6a3", "Other": "#64748B",
};
const WON = new Set(["Sale complete"]);
const COMMITTED = new Set(["Deposit received", "Sale complete"]);           // money down or done
const APPT_PLUS = new Set(["Appointment", "Sale agreed", "Deposit received", "Sale complete"]);

const PANEL = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "20px 22px", marginTop: 22 };
const H = { color: "#F1F5F9", fontSize: 16, fontWeight: 800 };
const SUB = { color: "#64748B", fontSize: 12 };
const TOOLTIP_STYLE = { background: "#14161a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", fontSize: 13 };

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
const monday = (s) => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoOf(d); };
const fmtDay = (s) => parseISO(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const pctText = (v) => (v == null || isNaN(v) ? "–" : `${Math.round(v)}%`);
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

export default function EskimoLeads({ refreshKey = 0 }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("30");     // 7 | 30 | 90 | all
  const [team, setTeam] = useState("");           // "" | Sales | Purchasers
  const [rep, setRep] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const raw = await getText(LEADS_SRC);
        if (!alive) return;
        setLeads(parseCSV(raw).map((r) => ({
          id: String(r["lead id"] || "").trim(),
          created: normDate(r["date created"]),
          rep: (r["salesperson"] || "").trim(),
          team: (r["team"] || "").trim(),
          source: (r["source"] || "").trim(),
          group: (r["source group"] || "").trim() || "Unknown",
          status: (r["status"] || "").trim(),
          stage: (r["stage"] || "").trim() || "Other",
        })).filter((l) => l.created && l.rep));
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const reps = useMemo(() => [...new Set(leads.filter((l) => !team || l.team === team).map((l) => l.rep).filter(Boolean))].sort(), [leads, team]);

  const range = useMemo(() => {
    const today = isoOf(new Date());
    if (period === "all") {
      const first = leads.reduce((m, l) => (!m || l.created < m ? l.created : m), "") || today;
      return { from: first, to: today, days: Math.round((parseISO(today) - parseISO(first)) / 864e5) + 1 };
    }
    const n = Number(period);
    return { from: addDays(today, -(n - 1)), to: today, days: n };
  }, [period, leads]);

  const cur = useMemo(() => leads.filter((l) =>
    l.created >= range.from && l.created <= range.to &&
    (!team || l.team === team) && (!rep || l.rep === rep)
  ), [leads, range, team, rep]);

  const total = cur.length;
  const stageCounts = useMemo(() => {
    const m = {}; [...STAGES, "Lost", "Other"].forEach((s) => (m[s] = 0));
    cur.forEach((l) => { m[l.stage] = (m[l.stage] || 0) + 1; });
    return m;
  }, [cur]);
  const won = cur.filter((l) => WON.has(l.stage)).length;
  const committed = cur.filter((l) => COMMITTED.has(l.stage)).length;
  const lost = stageCounts["Lost"] || 0;
  const live = total - won - lost;                     // still in play (not sold, not lost)
  const topSource = useMemo(() => {
    const m = {}; cur.forEach((l) => (m[l.group] = (m[l.group] || 0) + 1));
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  }, [cur]);

  const sources = useMemo(() => {
    const m = {}; cur.forEach((l) => (m[l.group] = (m[l.group] || 0) + 1));
    return Object.entries(m).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  }, [cur]);

  const daily = range.days <= 14;
  const bucketKeys = useMemo(() => {
    const keys = [];
    if (daily) { for (let d = range.from; d <= range.to; d = addDays(d, 1)) keys.push(d); }
    else { for (let d = monday(range.from); d <= range.to; d = addDays(d, 7)) keys.push(d); }
    return keys;
  }, [range, daily]);
  const keyOf = (date) => (daily ? date : monday(date));
  const trend = useMemo(() => {
    const agg = new Map(bucketKeys.map((k) => [k, 0]));
    cur.forEach((l) => { const k = keyOf(l.created); if (agg.has(k)) agg.set(k, agg.get(k) + 1); });
    return bucketKeys.map((k) => ({ name: daily ? fmtDay(k) : `w/c ${fmtDay(k)}`, leads: agg.get(k) }));
  }, [cur, bucketKeys, daily]);

  const perRep = useMemo(() => {
    const m = new Map();
    cur.forEach((l) => {
      if (!m.has(l.rep)) m.set(l.rep, { rep: l.rep, team: l.team, leads: 0, appt: 0, dep: 0, won: 0, lost: 0 });
      const o = m.get(l.rep); o.leads++;
      if (APPT_PLUS.has(l.stage)) o.appt++;
      if (COMMITTED.has(l.stage)) o.dep++;
      if (WON.has(l.stage)) o.won++;
      if (l.stage === "Lost") o.lost++;
    });
    return [...m.values()].map((o) => ({ ...o, conv: o.leads ? (o.won / o.leads) * 100 : 0 })).sort((a, b) => b.leads - a.leads);
  }, [cur]);

  const teamSplit = useMemo(() => {
    const m = {}; cur.forEach((l) => (m[l.team || "—"] = (m[l.team || "—"] || 0) + 1));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [cur]);

  const segBtn = (active) => ({
    background: active ? "#ed2624" : "rgba(255,255,255,0.05)", color: active ? "#fff" : "#94A3B8",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  });
  const selectStyle = { background: "rgba(255,255,255,0.05)", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 600 };
  const th = { color: "#64748B", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 10px", textAlign: "left", fontWeight: 700 };
  const maxSource = sources.reduce((m, s) => Math.max(m, s.n), 0) || 1;
  const maxStage = STAGES.reduce((m, s) => Math.max(m, stageCounts[s] || 0), 0) || 1;
  const downloadCSV = () => {
    const cols = ["Lead ID", "Date Created", "Salesperson", "Team", "Source", "Source Group", "Status", "Stage"];
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [cols.join(",")];
    cur.forEach((l) => lines.push([l.id, l.created, l.rep, l.team, l.source, l.group, l.status, l.stage].map(q).join(",")));
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-" + (team || "all") + "-" + (rep || "everyone") + "-" + period + "-" + isoOf(new Date()) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div style={{ textAlign: "center", color: "#64748B", padding: "60px 0" }}>Loading leads…</div>;
  if (error) return (
    <div style={{ ...PANEL, color: "#FDBA74" }}>
      Couldn’t load the leads ({error}). The “Eskimo Leads” tab is written by <code style={{ color: "#FCD34D" }}>node eskimo-bi.js</code> in the scraper folder,
      and on the live site it needs a <code style={{ color: "#FCD34D" }}>/api/leads</code> line in <code style={{ color: "#FCD34D" }}>public/_redirects</code>. Add those, then hit Refresh.
    </div>
  );
  if (!leads.length) return (
    <div style={{ ...PANEL, color: "#FDBA74" }}>No leads yet. Run <code style={{ color: "#FCD34D" }}>node eskimo-bi.js</code> in the scraper folder, then hit Refresh.</div>
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
        <select value={team} onChange={(e) => { setTeam(e.target.value); setRep(""); }} style={selectStyle}>
          <option value="">All leads</option>
          <option value="Sales">Sales team</option>
          <option value="Purchasers">Purchasers</option>
          <option value="Unassigned / Other">Unassigned / Other</option>
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)} style={selectStyle}>
          <option value="">Everyone</option>
          {reps.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={downloadCSV} style={segBtn(false)} title="Download the leads matching the current filters, opens in Excel">⤓ Excel ({total})</button>
        <div style={{ ...SUB, marginLeft: "auto" }}>leads by creation date · {fmtDay(range.from)} – {fmtDay(range.to)}</div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
        <Card title="Leads" color="#1f7fc4" value={total} sub={`${teamSplit.map(([t, n]) => `${n} ${t.toLowerCase()}`).join(" · ")}`} />
        <Card title="In pipeline" color="#6ee7b7" value={live} sub={`still in play · ${committed} with a deposit`} />
        <Card title="Sales complete" color="#4ade80" value={won} sub={<>{pctText(total ? (won / total) * 100 : 0)} of leads · {lost} lost</>} />
        <Card title="Top source" color="#91c7e8"
          value={<span style={{ fontSize: 19, lineHeight: 1.25, display: "block" }}>{topSource ? topSource[0] : "–"}</span>}
          sub={topSource ? `${topSource[1]} leads (${pctText((topSource[1] / total) * 100)})` : null} />
      </div>

      {/* Funnel */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <div style={H}>Pipeline funnel</div>
          <div style={SUB}>where these leads sit right now · lost shown separately</div>
        </div>
        {STAGES.map((s) => {
          const n = stageCounts[s] || 0;
          return (
            <div key={s} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 170px) 1fr 92px", gap: 10, alignItems: "center", padding: "5px 0" }}>
              <div style={{ color: "#E2E8F0", fontSize: 13 }}>{s}</div>
              <div style={{ height: 16, borderRadius: 5, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max(1, (n / maxStage) * 100)}%`, height: "100%", background: STAGE_COLOR[s], borderRadius: "0 5px 5px 0" }} />
              </div>
              <div style={{ textAlign: "right", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                {n}<span style={{ color: "#64748B", fontWeight: 500, fontSize: 11, marginLeft: 5 }}>{pctText(total ? (n / total) * 100 : 0)}</span>
              </div>
            </div>
          );
        })}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: 8, paddingTop: 8, display: "grid", gridTemplateColumns: "minmax(120px, 170px) 1fr 92px", gap: 10, alignItems: "center" }}>
          <div style={{ color: "#f4a6a3", fontSize: 13 }}>Lost</div>
          <div style={{ height: 16, borderRadius: 5, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(1, (lost / (maxStage || 1)) * 100)}%`, height: "100%", background: STAGE_COLOR["Lost"], borderRadius: "0 5px 5px 0" }} />
          </div>
          <div style={{ textAlign: "right", color: "#fff", fontSize: 13, fontWeight: 700 }}>{lost}<span style={{ color: "#64748B", fontWeight: 500, fontSize: 11, marginLeft: 5 }}>{pctText(total ? (lost / total) * 100 : 0)}</span></div>
        </div>
      </div>

      {/* Leads over time + sources */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18 }}>
        <div style={PANEL}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <div style={H}>Leads over time</div>
            <div style={SUB}>new leads per {daily ? "day" : "week"}</div>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={trend} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" stroke="#64748B" fontSize={11} />
              <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#fff", fontWeight: 700 }} itemStyle={{ color: "#fff" }} formatter={(v) => [`${v} leads`, ""]} />
              <Line type="monotone" dataKey="leads" stroke="#91c7e8" strokeWidth={2} dot={{ r: 3, fill: "#91c7e8", strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={PANEL}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <div style={H}>Lead sources</div>
            <div style={SUB}>where leads came from in this period</div>
          </div>
          {sources.slice(0, 12).map((s) => (
            <div key={s.name} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 200px) 1fr 64px", gap: 10, alignItems: "center", padding: "4px 0" }}>
              <div style={{ color: "#E2E8F0", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
              <div style={{ height: 13, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max(2, (s.n / maxSource) * 100)}%`, height: "100%", background: "#1f7fc4", borderRadius: "0 4px 4px 0" }} />
              </div>
              <div style={{ textAlign: "right", color: "#fff", fontSize: 13, fontWeight: 600 }}>{s.n}<span style={{ color: "#64748B", fontSize: 11, marginLeft: 4 }}>{pctText((s.n / total) * 100)}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* By salesperson */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <div style={H}>By person</div>
          <div style={SUB}>leads and where they got to · appts+ = reached appointment or beyond</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>
              <th style={th}>Person</th><th style={th}>Team</th>
              <th style={{ ...th, textAlign: "right" }}>Leads</th><th style={{ ...th, textAlign: "right" }}>Appts+</th>
              <th style={{ ...th, textAlign: "right" }}>Deposit+</th><th style={{ ...th, textAlign: "right" }}>Sold</th>
              <th style={{ ...th, textAlign: "right" }}>Lost</th><th style={{ ...th, textAlign: "right" }}>Conv.</th>
            </tr></thead>
            <tbody>
              {perRep.map((r) => (
                <tr key={r.rep} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#fff" }}>
                  <td style={{ padding: "9px 10px", color: "#E2E8F0", fontWeight: 600, whiteSpace: "nowrap" }}>{r.rep}</td>
                  <td style={{ padding: "9px 10px", color: "#94A3B8", fontSize: 12 }}>{r.team || "—"}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700 }}>{r.leads}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right" }}>{r.appt}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: "#fb923c" }}>{r.dep}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: "#4ade80", fontWeight: 700 }}>{r.won}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: "#f4a6a3" }}>{r.lost}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: "#91c7e8", fontWeight: 700 }}>{pctText(r.conv)}</td>
                </tr>
              ))}
              {perRep.length === 0 && <tr><td colSpan={8} style={{ padding: 18, textAlign: "center", color: "#64748B" }}>No leads in this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...SUB, marginTop: 14 }}>
        Source: Eskimo BI API via the “Eskimo Leads” tab, refreshed every 5 minutes. Volume, sources and allocation are counted by lead creation
        date; the funnel shows each lead’s current stage, so it’s a live pipeline snapshot rather than a per-day event count. “Sold” = current
        status Sale complete; a lead sits in one stage at a time, so a completed sale no longer appears under the earlier stages it passed through.
      </div>
    </>
  );
}
