import React, { useState, useMemo } from "react";

// RMA Motors — Spec Finder + Ad Builder (brand-aligned to RMA guidelines)
// Search web specs → confirm features → finance auto-calc → ad template.

// Brand palette (RMA Core Element Brand Guide)
const CHARCOAL = "#2b2b2b";
const BLUE = "#004f8a";
const LBLUE = "#91c7e8";
const RED = "#ed2624";
const BRAND_RED = RED;
const FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';

const REGIONS = ["GCC", "European", "American", "Japanese", "Canadian"];
const CAR_PROTECT = 2999;
const SMART_PROTECT = 3999;
const FLAT_RATE = 3.5;
const CURRENT_YEAR = new Date().getFullYear();

const field = (v) => (v && String(v).trim() ? String(v).trim() : "");
const cleanFeature = (s) => String(s).replace(/\s*\((?:standard|optional|std|opt)\)\s*/gi, "").trim();
const num = (v) => { const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return isNaN(n) ? 0 : n; };
const commas = (s) => { const d = String(s).replace(/\D/g, ""); return d ? Number(d).toLocaleString("en-US") : ""; };

function financeYears(age) {
  if (age <= 7) return 5;
  if (age === 8) return 4;
  if (age === 9) return 3;
  if (age === 10) return 2;
  if (age === 11) return 1;
  return 0;
}

function calcFinance(form, ad) {
  const year = parseInt(String(form.year).replace(/\D/g, ""), 10);
  const price = num(ad.cashPrice);
  if (!year || !price) return null;
  const age = CURRENT_YEAR - year;
  const years = financeYears(age);
  if (years === 0) return { eligible: false, age };
  const months = years * 12;
  const addons = (ad.carProtect ? CAR_PROTECT : 0) + (ad.smartProtect ? SMART_PROTECT : 0);
  const principal = price + addons;
  const emi = Math.round((principal * (1 + (FLAT_RATE / 100) * years)) / months);
  return { eligible: true, age, years, months, emi, principal };
}

function BrandSwoosh({ className }) {
  const d = "M0,82 C70,82 72,26 165,30 C258,34 250,86 330,58";
  const lines = [[BLUE, 0], [LBLUE, 7], ["#ffffff", 14], [RED, 21]];
  return (
    <svg viewBox="0 0 330 110" className={className} fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {lines.map(([c, dy], i) => (
        <path key={i} d={d} stroke={c} strokeWidth="3" strokeLinecap="round" transform={`translate(0 ${dy})`} />
      ))}
    </svg>
  );
}

export default function SpecToAd() {
  const [form, setForm] = useState({ year: "", make: "", model: "", trim: "", region: "GCC" });
  const [ad, setAd] = useState({
    kilometers: "", cashPrice: "", service: "", warranty: "",
    servicePack: "", servicePackDetails: "",
    payment: "finance", carProtect: false, smartProtect: false,
  });
  const [modified, setModified] = useState(false);
  const [manualText, setManualText] = useState("");

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [specs, setSpecs] = useState([]);
  const [overview, setOverview] = useState("");
  const [sources, setSources] = useState([]);

  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState([]);
  const [custom, setCustom] = useState("");

  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [genError, setGenError] = useState("");
  const [copied, setCopied] = useState(false);

  const setV = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const touch = () => { if (status === "approved") setStatus("ready"); };
  const setA = (k) => (e) => { setAd((a) => ({ ...a, [k]: e.target.value })); touch(); };
  const setNumA = (k) => (e) => { const v = commas(e.target.value); setAd((a) => ({ ...a, [k]: v })); touch(); };
  const setAv = (k, v) => { setAd((a) => ({ ...a, [k]: v })); touch(); };

  function reset() {
    setForm({ year: "", make: "", model: "", trim: "", region: "GCC" });
    setAd({ kilometers: "", cashPrice: "", service: "", warranty: "", servicePack: "", servicePackDetails: "", payment: "finance", carProtect: false, smartProtect: false });
    setModified(false); setManualText("");
    setSearchLoading(false); setSearchError("");
    setSpecs([]); setOverview(""); setSources([]);
    setCandidates([]); setSelected([]); setCustom("");
    setDescription(""); setStatus("draft"); setGenError(""); setCopied(false);
  }

  const carLabel = [form.year, form.make, form.model, form.trim].filter((x) => x && x.trim()).join(" ");
  const canSearch = form.year.trim() && form.make.trim() && form.model.trim();

  const yearNum = parseInt(String(form.year).replace(/\D/g, ""), 10);
  const vehAge = yearNum ? CURRENT_YEAR - yearNum : null;
  const financeEligible = vehAge === null ? true : financeYears(vehAge) > 0;
  const financeMode = financeEligible && ad.payment === "finance";
  const fin = calcFinance(form, ad);

  const manualLines = modified ? manualText.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [];
  const allFeatures = Array.from(new Set([...selected, ...manualLines]));

  const toggle = (f) => { setSelected((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f])); touch(); };
  const addCustom = () => {
    const v = field(custom);
    if (v) { setCandidates((c) => (c.includes(v) ? c : [...c, v])); setSelected((s) => (s.includes(v) ? s : [...s, v])); }
    setCustom("");
  };

  async function searchSpecs() {
    if (!canSearch) return;
    setSearchLoading(true); setSearchError(""); setSpecs([]); setOverview(""); setSources([]); setCandidates([]); setSelected([]);
    const prompt = [
      `Find accurate specifications and equipment for: ${carLabel}, ${form.region} market.`,
      "Search the web for factual data from reputable sources (manufacturer, autoevolution, Edmunds, carsguide, etc.).",
      "Return ONLY a JSON object (no code fences, no commentary) with this shape:",
      `{ "overview":"one or two factual sentences",`,
      `  "specifications":[{"label":"Engine","value":"..."},{"label":"Power","value":"..."},{"label":"Torque","value":"..."},{"label":"Transmission","value":"..."},{"label":"Drivetrain","value":"..."},{"label":"0-100 km/h","value":"..."},{"label":"Top speed","value":"..."},{"label":"Fuel economy","value":"..."},{"label":"Body type","value":"..."},{"label":"Seats","value":"..."}],`,
      `  "features":["8 to 15 notable features, concise, plain names only with NO '(standard)' or '(optional)' labels"],`,
      `  "sources":[{"title":"name","url":"https://..."}] }`,
      "Only include rows you actually find. Never invent figures. Keep values short.",
    ].join("\n");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 2048,
          system: "You are a meticulous vehicle specifications researcher. You use web search to find accurate, market-correct data and never fabricate figures.",
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      if (!res.ok) throw new Error("Search failed (" + res.status + ")");
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
      const parsed = a !== -1 && b !== -1 ? JSON.parse(clean.slice(a, b + 1)) : null;
      if (!parsed) throw new Error("Couldn't read the results. Try again or adjust the details.");
      setOverview(parsed.overview || "");
      setSpecs((parsed.specifications || []).filter((s) => s && s.value && !/^n\/?a$/i.test(String(s.value).trim())));
      const feats = (parsed.features || []).map((f) => (typeof f === "string" ? f : f && (f.name || f.value || ""))).map(cleanFeature).filter(Boolean);
      setCandidates(Array.from(new Set(feats)));
      setSelected([]);
      setSources((parsed.sources || []).filter((s) => s && s.url));
    } catch (e) {
      setSearchError(e.message || "Something went wrong searching for specs.");
    } finally { setSearchLoading(false); }
  }

  async function generate() {
    setStatus("generating"); setGenError("");
    const financed = financeMode && fin && fin.eligible;
    const prompt = [
      "Write an enticing used-car advert intro paragraph for this vehicle.",
      `Vehicle: ${carLabel}${modified ? " (modified)" : ""}`,
      `Market: ${form.region}`,
      `Mileage: ${field(ad.kilometers) ? ad.kilometers + " km" : "not specified"}`,
      ...(field(ad.service) ? [`Service history: ${ad.service}`] : []),
      ...(field(ad.warranty) ? [`Warranty: ${ad.warranty}`] : []),
      ...(ad.servicePack === "Yes" ? [`Service pack: ${field(ad.servicePackDetails) || "available"}`] : []),
      `Payment: ${financed ? "finance available" : "cash only"}`,
      `Confirmed features: ${allFeatures.length ? allFeatures.join(", ") : "none listed"}`,
      "",
      "Requirements:",
      "- A flowing paragraph (no bullet list), confident, upbeat and promotional British English for a UAE audience.",
      "- Open with a hook, weave in 2-3 standout confirmed features, and end with a short call to action.",
      "- Stay relentlessly positive. NEVER include negative, cautionary, hedging or apologetic wording of any kind — never advise caution and never point out anything as missing or lacking.",
      "- Only mention service history or warranty if they are provided above. If they are not provided, do NOT mention them at all and never state or imply that they are missing.",
      "- Only reference confirmed features or traits genuinely typical of this model; never invent options, packages or figures.",
      "- Return ONLY the paragraph — no heading, bullets, quotes or markdown.",
    ].join("\n");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: "You are a senior automotive copywriter for RMA Motors, a prestige used-car dealership in Dubai, UAE. RMA is upbeat, confident and enthusiast-led — 'the enthusiasts empowering everyone to achieve their motoring dreams'.",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error("Request failed (" + res.status + ")");
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!text) throw new Error("No description came back. Try again.");
      setDescription(text); setStatus("ready");
    } catch (e) {
      setGenError(e.message || "Couldn't generate the description."); setStatus(description ? "ready" : "draft");
    }
  }

  const adText = useMemo(() => buildAdText(form, carLabel, ad, financeMode, description, allFeatures), [form, carLabel, ad, financeMode, description, allFeatures]);

  async function copyAd() {
    try { await navigator.clipboard.writeText(adText); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setGenError("Couldn't copy — select the preview text manually."); }
  }

  const statusMeta = {
    draft: { label: "Draft", cls: "bg-neutral-200 text-neutral-700" },
    generating: { label: "Writing description…", cls: "bg-amber-100 text-amber-800" },
    ready: { label: "Ready for approval", cls: "bg-sky-100 text-sky-800" },
    approved: { label: "Approved", cls: "bg-green-100 text-green-800" },
  }[status];

  const inputCls = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-[#004f8a] focus:ring-1 focus:ring-[#004f8a] placeholder:text-neutral-400";
  const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500";
  const card = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";
  const primaryBtn = "rounded-md px-8 py-2.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
  const stepNum = "mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white";
  const h2 = "mb-3 text-sm font-semibold uppercase tracking-wide";
  const toggleBtn = (on) => "rounded-md border px-6 py-2 text-sm font-medium transition " + (on ? "text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100");

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900" style={{ fontFamily: FONT }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,300;0,400;0,500;0,600;0,700;1,700&display=swap');`}</style>

      {/* Brand header */}
      <header className="relative overflow-hidden text-white" style={{ backgroundColor: CHARCOAL }}>
        <BrandSwoosh className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-72 -translate-x-1/2 opacity-50 sm:block" />
        <div className="relative z-10 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span style={{ color: RED }} className="text-2xl font-bold italic leading-none tracking-tight">RMA</span>
              <span className="flex flex-col leading-none">
                <span className="text-2xl font-light tracking-[0.18em] text-white">MOTORS</span>
                <span className="self-end text-[9px] font-light tracking-[0.4em] text-neutral-300">DUBAI</span>
              </span>
            </div>
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.25em] text-neutral-400">Sports &amp; Prestige Cars</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-300">Spec Finder &amp; Ad Builder</span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
            </div>
            <button onClick={reset} title="Clear everything and start a new car" className="rounded-md border border-neutral-600 px-3 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700">↻ New car</button>
          </div>
        </div>
        <div style={{ height: "4px", background: `linear-gradient(90deg, ${BLUE} 0%, ${LBLUE} 38%, #ffffff 62%, ${RED} 100%)` }} />
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-5 py-6">
        {/* Step 1 */}
        <div className={card}>
          <h2 className={h2}><span className={stepNum} style={{ backgroundColor: BLUE }}>1</span>Find the car</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div><label className={labelCls}>Year</label><input className={inputCls} value={form.year} onChange={setV("year")} placeholder="2021" /></div>
            <div><label className={labelCls}>Make</label><input className={inputCls} value={form.make} onChange={setV("make")} placeholder="BMW" /></div>
            <div><label className={labelCls}>Model</label><input className={inputCls} value={form.model} onChange={setV("model")} placeholder="M4" /></div>
            <div><label className={labelCls}>Trim</label><input className={inputCls} value={form.trim} onChange={setV("trim")} placeholder="Competition" /></div>
            <div><label className={labelCls}>Market</label><select className={inputCls} value={form.region} onChange={setV("region")}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          </div>
          <button onClick={searchSpecs} disabled={!canSearch || searchLoading} style={{ backgroundColor: RED }} className={"mt-4 " + primaryBtn}>
            {searchLoading ? "Searching the web…" : "Search specs"}
          </button>
          {!canSearch && <p className="mt-2 text-xs text-neutral-500">Add at least year, make and model.</p>}
          {searchError && <p className="mt-2 text-xs" style={{ color: RED }}>{searchError}</p>}
        </div>

        {/* Step 2 */}
        {(candidates.length > 0 || specs.length > 0) && (
          <div className={card}>
            <h2 className={h2}><span className={stepNum} style={{ backgroundColor: BLUE }}>2</span>Confirm features &amp; extras</h2>
            {overview && <p className="mb-3 ml-7 text-xs text-neutral-500">{overview}</p>}
            {specs.length > 0 && (
              <div className="mb-4 ml-7 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
                {specs.map((s, i) => (
                  <div key={i} className="flex justify-between gap-4 border-b border-neutral-100 py-1 text-xs">
                    <span className="text-neutral-500">{s.label}</span><span className="text-right font-medium text-neutral-800">{s.value}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mb-2 ml-7 text-xs text-neutral-500">Tick every feature that's actually on this car, and add any optional extras the search missed.</p>
            <div className="ml-7 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {candidates.map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
                  <input type="checkbox" checked={selected.includes(f)} onChange={() => toggle(f)} className="h-4 w-4" style={{ accentColor: RED }} />{f}
                </label>
              ))}
            </div>

            <div className="ml-7 mt-3 border-t border-neutral-100 pt-3">
              <label className={labelCls}>Add an optional extra</label>
              <div className="flex gap-2">
                <input className={inputCls} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} placeholder="e.g. Individual paint, B&O sound, tow bar" />
                <button onClick={addCustom} className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100">Add</button>
              </div>
            </div>

            <div className="ml-7 mt-3 border-t border-neutral-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <label className={labelCls + " mb-0"}>Modified vehicle?</label>
                <div className="flex gap-2">
                  <button onClick={() => setModified(true)} style={modified ? { backgroundColor: RED, borderColor: RED } : {}} className={toggleBtn(modified)}>Yes</button>
                  <button onClick={() => setModified(false)} style={!modified ? { backgroundColor: RED, borderColor: RED } : {}} className={toggleBtn(!modified)}>No</button>
                </div>
              </div>
              {modified && (
                <div className="mt-2">
                  <textarea className={inputCls + " h-28 resize-y"} value={manualText} onChange={(e) => { setManualText(e.target.value); touch(); }} placeholder={"Type or paste the car's key features / modifications — one per line, e.g.\nStage 2 tune\nAkrapovič exhaust\nKW coilovers\nForged wheels"} />
                  <p className="mt-1 text-xs text-neutral-500">Each line becomes a Key Features bullet. Combined with any ticked features above.</p>
                </div>
              )}
            </div>

            <p className="ml-7 mt-3 text-xs text-neutral-500">{allFeatures.length} feature{allFeatures.length === 1 ? "" : "s"} in the ad</p>
          </div>
        )}

        {/* Step 3 */}
        {candidates.length > 0 && (
          <div className={card}>
            <h2 className={h2}><span className={stepNum} style={{ backgroundColor: BLUE }}>3</span>Ad details</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Kilometers</label><input className={inputCls} value={ad.kilometers} onChange={setNumA("kilometers")} inputMode="numeric" placeholder="42,000" /></div>
              <div><label className={labelCls}>Cash price (AED)</label><input className={inputCls} value={ad.cashPrice} onChange={setNumA("cashPrice")} inputMode="numeric" placeholder="285,000" /></div>
            </div>

            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <label className={labelCls}>Payment</label>
              <div className="flex gap-2">
                <button onClick={() => financeEligible && setAv("payment", "finance")} disabled={!financeEligible} style={financeMode ? { backgroundColor: RED, borderColor: RED } : {}} className={toggleBtn(financeMode) + (!financeEligible ? " opacity-40 cursor-not-allowed" : "")}>Finance available</button>
                <button onClick={() => setAv("payment", "cash")} style={!financeMode ? { backgroundColor: RED, borderColor: RED } : {}} className={toggleBtn(!financeMode)}>Cash only</button>
              </div>
              {!financeEligible && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">This vehicle is {vehAge} years old — finance isn't available for 12+ year cars. Cash only.</p>
              )}
              {financeMode && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
                      <input type="checkbox" checked={ad.carProtect} onChange={(e) => setAv("carProtect", e.target.checked)} className="h-4 w-4" style={{ accentColor: RED }} />
                      RMA Car Protect <span className="text-neutral-500">(+AED 2,999)</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
                      <input type="checkbox" checked={ad.smartProtect} onChange={(e) => setAv("smartProtect", e.target.checked)} className="h-4 w-4" style={{ accentColor: RED }} />
                      RMA SMART Protect <span className="text-neutral-500">(+AED 3,999)</span>
                    </label>
                  </div>
                  {fin && fin.eligible && (
                    <div className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
                      <div className="flex justify-between"><span className="text-neutral-500">Finance / month</span><span className="font-semibold" style={{ color: RED }}>AED {fin.emi.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-500">Over</span><span className="font-medium">{fin.months} months ({fin.years} {fin.years === 1 ? "year" : "years"})</span></div>
                      <p className="mt-1 text-xs text-neutral-400">Auto-calculated · {fin.age}-yr-old vehicle · 0% down · flat 3.5%{(ad.carProtect || ad.smartProtect) ? " · incl. protect plan" : ""}</p>
                    </div>
                  )}
                  {!fin && <p className="text-xs text-neutral-500">Enter year and cash price to calculate the monthly finance.</p>}
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={labelCls}>Service history</label><input className={inputCls} value={ad.service} onChange={setA("service")} placeholder="Full BMW service history" /></div>
              <div className="col-span-2"><label className={labelCls}>Warranty</label><input className={inputCls} value={ad.warranty} onChange={setA("warranty")} placeholder="Available until 2026" /></div>
              <div className="col-span-2">
                <label className={labelCls}>Service Pack Available</label>
                <div className="flex gap-2">
                  {["Yes", "No"].map((opt) => {
                    const on = ad.servicePack === opt;
                    return <button key={opt} onClick={() => { const val = on ? "" : opt; setAd((a) => ({ ...a, servicePack: val, servicePackDetails: val === "Yes" ? a.servicePackDetails : "" })); touch(); }} style={on ? { backgroundColor: RED, borderColor: RED } : {}} className={toggleBtn(on)}>{opt}</button>;
                  })}
                </div>
                {ad.servicePack === "Yes" && (
                  <input className={inputCls + " mt-2"} value={ad.servicePackDetails} onChange={setA("servicePackDetails")} placeholder="Service pack details (e.g. 3-year / 45,000 km RMA service pack included)" />
                )}
              </div>
            </div>

            <button onClick={generate} disabled={status === "generating"} style={{ backgroundColor: RED }} className={"mt-4 w-full " + primaryBtn}>
              {status === "generating" ? "Building ad…" : description ? "Rebuild ad" : "Add to ad template"}
            </button>
            {genError && <p className="mt-2 text-xs" style={{ color: RED }}>{genError}</p>}
          </div>
        )}

        {/* Step 4 */}
        {description && (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
              <span className="flex items-center text-xs font-medium uppercase tracking-wide text-neutral-500"><span className={stepNum} style={{ backgroundColor: BLUE }}>4</span>Ad preview · what gets posted</span>
              <div className="flex items-center gap-2">
                <button onClick={copyAd} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100">{copied ? "Copied ✓" : "Copy ad text"}</button>
                <button onClick={() => setStatus("approved")} disabled={status !== "ready"} style={{ backgroundColor: status === "ready" || status === "approved" ? BLUE : undefined }} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-neutral-300">{status === "approved" ? "Approved ✓" : "Approve"}</button>
              </div>
            </div>
            <div className="px-6 py-5">
              <AdPreview form={form} carLabel={carLabel} ad={ad} financeMode={financeMode} features={allFeatures} description={description} onEditDesc={(v) => { setDescription(v); if (status === "approved") setStatus("ready"); }} />
            </div>
          </div>
        )}

        <footer className="space-y-1 pt-2 text-center text-xs text-neutral-400">
          <p className="italic">The enthusiasts empowering everyone to achieve their motoring dreams.</p>
          <p>RMA Used Cars LLC · Showroom 3, Speedex Center, Dubai Investment Park 1, Dubai · rmamotors.com · @rmamotorsdubai</p>
        </footer>
      </main>
    </div>
  );
}

function paymentBlock(form, ad, financeMode) {
  const fin = calcFinance(form, ad);
  const financed = financeMode && fin && fin.eligible;
  const lines = [`Cash: ${field(ad.cashPrice) ? "AED " + ad.cashPrice : ""}`, ""];
  if (financed) lines.push(`Finance: AED ${fin.emi.toLocaleString()} / ${fin.months} months | 0% Down Payment`, "");
  else lines.push("Cash Sale Only", "");
  lines.push("All Prices Are VAT Inclusive*", "");
  if (financed) {
    const p = [];
    if (ad.carProtect) p.push("RMA Car Protect");
    if (ad.smartProtect) p.push("RMA SMART Protect");
    if (p.length) lines.push(`🔵 Included in your monthly EMI is ${p.join(" & ")} Plan!!`, "");
  }
  return lines;
}

function carInfoLines(form, ad) {
  const lines = [
    `Kilometers: ${field(ad.kilometers)}`, "",
    `Regional Specifications: ${field(form.region)}`,
  ];
  if (field(ad.service)) lines.push("", `Service: ${field(ad.service)}`);
  if (field(ad.warranty)) lines.push("", `Warranty: ${field(ad.warranty)}`);
  if (ad.servicePack === "Yes") lines.push("", `Service Pack: ${field(ad.servicePackDetails) || "Available"}`);
  return lines;
}

function buildAdText(form, carLabel, ad, financeMode, description, features) {
  const titleLine = [carLabel || "Vehicle title", field(ad.service), field(ad.warranty)].filter(Boolean).join(" / ");
  const featureLines = features.length ? ["", "Key Features:", ...features.map((f) => "• " + f)] : [];
  return [
    titleLine, "",
    ...paymentBlock(form, ad, financeMode),
    "Call now to learn more!!", "",
    "------ Contact Us ------", "",
    "🔴 Book a Test Drive | Reserve | Purchase Online", "",
    "📲 Sales | 04 821 9702", "",
    "------ RMA PPF ------", "",
    "Detailing | Ceramic Paint Protection | PPF (Clear, Matt, Colour) | Window Tints", "",
    "📲 RMA PPF – 04 821 9774", "",
    "🔵 Every model for sale has been prepared to the highest of standards with an ULTIMATE Detailing Package worth AED 2,500", "",
    "------ Car Info ------", "",
    ...carInfoLines(form, ad), "",
    description || "",
    ...featureLines, "",
    "------ Sell Your Car ------", "",
    "The easiest way to sell your car in the UAE!", "",
    "Just click the link below to fill out our online evaluation form:",
    "https://www.rmamotors.com/sell/", "",
    "• 100% free! No obligations",
    "• Hassle free! Transaction completed in 30 mins",
    "• Secure! Instant Cash Payment",
    "• Loan Settlement! We close your bank loans",
    "• Save Time! No trips to the Traffic Department", "",
    "------ About Us ------", "",
    "Our mission statement: We are the enthusiasts empowering everyone to achieve their motoring dreams!", "",
    "We are both experts and enthusiasts in the buying and sales process. Our reputation in customer service and quality of cars is second to none. Our carefully selected team of enthusiasts trained in technical, mechanical and sales of prestige used cars have decades of experience in the motor industry. We are here to make the process of buying and selling a used car with confidence in the UAE as simple as possible.", "",
    "Website: http://www.rmamotors.com",
    "Facebook: https://www.facebook.com/rmamotorsdubai/",
    "Instagram: @rmamotorsdubai",
  ].join("\n");
}

function Line({ children }) {
  if (children === "") return <div className="h-3" />;
  if (/^------.*------$/.test(children)) return <div className="mt-1 font-semibold uppercase tracking-wide" style={{ color: CHARCOAL }}>{children}</div>;
  return <div className="whitespace-pre-wrap">{children}</div>;
}

function AdPreview({ form, carLabel, ad, financeMode, features, description, onEditDesc }) {
  const titleLine = [carLabel || "Vehicle title", field(ad.service), field(ad.warranty)].filter(Boolean).join(" / ");
  const head = [
    "", ...paymentBlock(form, ad, financeMode),
    "Call now to learn more!!", "",
    "------ Contact Us ------", "",
    "🔴 Book a Test Drive | Reserve | Purchase Online", "",
    "📲 Sales | 04 821 9702", "",
    "------ RMA PPF ------", "",
    "Detailing | Ceramic Paint Protection | PPF (Clear, Matt, Colour) | Window Tints", "",
    "📲 RMA PPF – 04 821 9774", "",
    "🔵 Every model for sale has been prepared to the highest of standards with an ULTIMATE Detailing Package worth AED 2,500", "",
    "------ Car Info ------", "",
    ...carInfoLines(form, ad), "",
  ];
  const tail = [
    "", "------ Sell Your Car ------", "",
    "The easiest way to sell your car in the UAE!", "",
    "Just click the link below to fill out our online evaluation form:",
    "https://www.rmamotors.com/sell/", "",
    "• 100% free! No obligations",
    "• Hassle free! Transaction completed in 30 mins",
    "• Secure! Instant Cash Payment",
    "• Loan Settlement! We close your bank loans",
    "• Save Time! No trips to the Traffic Department", "",
    "------ About Us ------", "",
    "Our mission statement: We are the enthusiasts empowering everyone to achieve their motoring dreams!", "",
    "Website: http://www.rmamotors.com · Facebook: /rmamotorsdubai · Instagram: @rmamotorsdubai",
  ];
  return (
    <div className="text-sm leading-relaxed text-neutral-800">
      <div className="mb-1 text-base font-bold" style={{ color: CHARCOAL }}>{titleLine}</div>
      {head.map((l, i) => <Line key={"h" + i}>{l}</Line>)}
      <textarea value={description} onChange={(e) => onEditDesc(e.target.value)} className="my-2 w-full resize-y rounded-md border border-dashed p-3 text-sm leading-relaxed text-neutral-900 outline-none" style={{ borderColor: LBLUE, backgroundColor: "#f2f8fc" }} rows={Math.max(3, description.split("\n").length + 1)} />
      {features.length > 0 && (
        <div className="my-2">
          <div className="font-semibold" style={{ color: CHARCOAL }}>Key Features:</div>
          {features.map((f) => <div key={f}>• {f}</div>)}
          <p className="mt-1 text-xs text-neutral-400">Edit these via the tickboxes / modified list in step 2.</p>
        </div>
      )}
      {tail.map((l, i) => <Line key={"t" + i}>{l}</Line>)}
    </div>
  );
}
