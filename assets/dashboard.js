import { loadDashboard, assetURL } from './data.js';
let D;
try { D = await loadDashboard(); }
catch (error) {
  const status = document.getElementById('loadStatus'); status.classList.add('error');
  status.textContent = `Could not load dashboard data: ${error.message}. Check your internet connection and reload, or open this page through a local HTTP server.`;
  throw error;
}
const META = Object.fromEntries(D.manifest.datasets.map(d => [d.id, d]));
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// ------------------------------------------------------------------ palette & theme (reference palette, fixed slot order)
const PAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const DIVERGING = {   // blue (above 0) <-> red (below 0), neutral grey midpoint
  light: [[0, "#7a1f1f"], [0.2, "#e34948"], [0.4, "#f3a3a3"], [0.5, "#f0efec"], [0.6, "#9ec5f4"], [0.8, "#2a78d6"], [1, "#0d366b"]],
  dark:  [[0, "#e66767"], [0.2, "#b94040"], [0.4, "#6b2a2a"], [0.5, "#383835"], [0.6, "#1c3d63"], [0.8, "#3987e5"], [1, "#9ec5f4"]],
};
const FAM_SLOT = { Product: 0, Technology: 1, Science: 2 };
const FAM_LABEL = { Product: "Product", Technology: "Technology", Science: "Knowledge" };
const theme = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const pal = i => PAL[theme()][i % 8];
const tok = () => {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue(n).trim();
  return { surface: g("--surface"), page: g("--page"), text1: g("--text1"), text2: g("--text2"), muted: g("--muted"), grid: g("--grid"), axis: g("--axis") };
};
const famColor = tree => pal(FAM_SLOT[fam(tree)]);
const treeColor = tree => pal(D.trees.indexOf(tree));
const FAM_OF_ROOT = { Technology_PATSTAT: "Technology", Science_Dimensions: "Science" };   // same family, other source
const fam = tree => { const root = tree.split("/")[0]; return FAM_OF_ROOT[root] || root; };
const tag = tree => tree.replace(/\//g, "-");
const treeLabel = tree => META[tree]?.label || (tree === "Product" ? "Product (HS4)" : tree.replace("Technology_PATSTAT/", "Technology (PATSTAT) · ").replace("Science_Dimensions/", "Knowledge (Dimensions) · ").replace("Technology/", "Technology · ").replace("Science/", "Knowledge · ").replace(/\//g, " · "));
const cname = c => D.country_names[c] || c;
const fmt = (v, d = 2) => v == null ? "–" : Number(v).toFixed(d);

// ------------------------------------------------------------------ plotly base layout
function merge(a, b) {
  const o = Object.assign({}, a);
  for (const k in b) o[k] = (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) ? merge(a[k], b[k]) : b[k];
  return o;
}
function lay(extra = {}) {
  const t = tok();
  const ax = { gridcolor: t.grid, zerolinecolor: t.axis, linecolor: t.axis, tickfont: { color: t.muted, size: 11 }, title: { font: { color: t.text2, size: 12 } }, automargin: true };
  return merge({
    paper_bgcolor: t.surface, plot_bgcolor: t.surface,
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.text2, size: 12 },
    margin: { l: 48, r: 14, t: 10, b: 40 },
    xaxis: ax, yaxis: ax,
    hoverlabel: { bgcolor: t.surface, bordercolor: t.axis, font: { color: t.text1, size: 12 } },
    legend: { orientation: "h", y: -0.16, yanchor: "top", font: { size: 11, color: t.text2 }, bgcolor: "rgba(0,0,0,0)" },
    showlegend: false,
  }, extra);
}
const CFG = { displayModeBar: "hover", displaylogo: false, responsive: true, toImageButtonOptions: {format: "png", scale: 2} };
const plotQueues = new Map(), plotVersions = new Map();
function queuePlot(id, draw) {
  const version=(plotVersions.get(id)||0)+1;plotVersions.set(id,version);
  const task=(plotQueues.get(id)||Promise.resolve()).then(async()=>{if(plotVersions.get(id)===version)await draw(document.getElementById(id));}).catch(error=>{
    document.getElementById('loadStatus').textContent=`Chart could not render: ${error.message}. Change the selection to retry.`;
    console.error(error);
  });
  plotQueues.set(id,task);return task;
}
function clearPlot(id,message) {
  return queuePlot(id,el=>{Plotly.purge(el);el.innerHTML=`<div class="empty">${escapeHTML(message)}</div>`;});
}
function plot(id, traces, layout) {
  if(!traces?.length)return clearPlot(id,'No data available for the selected year');
  return queuePlot(id,async el=>{if(el.querySelector('.empty'))el.innerHTML='';await Plotly.react(el,traces,layout,CFG);if(el.getClientRects().length)await Plotly.Plots.resize(el);});
}
function setNote(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

// ------------------------------------------------------------------ data access
const P = D.eci, A = D.aci, N = D.nestedness;
const yIndex = (panel, y) => panel.years.indexOf(+y);
function eciAt(tree, y) {        // Map iso2 -> eci for one tree-year (null if the year is absent)
  const p = P[tree], i = yIndex(p, y);
  if (i < 0) return null;
  const m = new Map();
  p.countries.forEach((c, k) => { const v = p.eci[i][k]; if (v != null) m.set(c, v); });
  return m;
}
function eciSeries(tree, c) {
  const p = P[tree], k = p.countries.indexOf(c);
  if (k < 0) return { x: [], y: [] };
  const x = [], y = [];
  p.years.forEach((yr, i) => { x.push(yr); y.push(p.eci[i][k]); });
  return { x, y };
}
function rank(map) {             // Map -> Map of ranks (1 = highest)
  const r = new Map();
  let previous, position;
  [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, value], i) => { if (i === 0 || value !== previous) position = i + 1; r.set(c, position); previous = value; });
  return r;
}
function spearman(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const rk = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(n);
    for (let i = 0; i < n;) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const a = rk(xs), b = rk(ys), ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}
const allYears = [...new Set(D.trees.flatMap(t => P[t].years))].sort((a, b) => a - b);
const YMIN = allYears[0], YMAX = allYears[allYears.length - 1];
const TECH = D.trees.filter(t => fam(t) === "Technology"), SCI = D.trees.filter(t => fam(t) === "Science");

// ------------------------------------------------------------------ state
const S = {
  year: Math.min(...D.trees.map(t => P[t].years.at(-1))), tech: TECH[0], sci: SCI[0], countries: [...D.countries_default], cslot: new Map(),
  aTree: "Product", aYear: A.Product.years.at(-1), acts: [], aslot: new Map(),
  spTree: "Product", spYear: null, spFig: "space",
  nMeasure: "NODF", nTree: "Product", nFig: "matrix_sorted", nYear: Math.min(2020, YMAX),
  xYear: Math.min(...D.trees.map(t => P[t].years.at(-1))),
};
// colour follows the entity: a slot is handed out once and kept while the entity stays selected
function slotFor(map, key, list) {
  if (map.has(key)) return map.get(key);
  const used = new Set([...map.values()]);
  let s = 0; while (used.has(s) && s < 8) s++;
  map.set(key, s); return s;
}
function dropSlot(map, key) { map.delete(key); }

// ------------------------------------------------------------------ generic controls
function fillSelect(id, items, value, label = x => x) {
  const el = document.getElementById(id); el.innerHTML = "";
  items.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = label(v); el.appendChild(o); });
  el.value = value;
}
function bindRange(id, lblId, years, value, onchange) {
  const el = document.getElementById(id), lbl = document.getElementById(lblId);
  el.min = years[0]; el.max = years[years.length - 1]; el.step = 1; el.value = value; lbl.textContent = value;
  el.oninput = () => { lbl.textContent = el.value; onchange(+el.value); };
  return el;
}
function chips(containerId, keys, labelOf, colorOf, onRemove) {
  const box = document.getElementById(containerId); box.innerHTML = "";
  keys.forEach(k => {
    const c = document.createElement("span"); c.className = "chip";
    c.innerHTML = `<i style="background:${colorOf(k)}"></i>${escapeHTML(labelOf(k))} <button aria-label="Remove selection" title="Remove">×</button>`;
    c.querySelector("button").onclick = () => onRemove(k);
    box.appendChild(c);
  });
}
function table(containerId, cols, rows, sortState) {
  // cols: [{k, label, num}] ; rows: array of objects ; click on a header sorts
  const box = document.getElementById(containerId);
  const st = sortState || { k: cols[0].k, dir: 1 };
  const sorted = [...rows].sort((a, b) => { const x = a[st.k], y = b[st.k]; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * st.dir; });
  const h = cols.map(c => `<th class="${c.num ? "num" : ""}" data-k="${c.k}">${c.label}${st.k === c.k ? (st.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = sorted.map(r => "<tr>" + cols.map(c => `<td class="${c.num ? "num" : ""}">${c.num ? fmt(r[c.k], c.d ?? 2) : escapeHTML(r[c.k] ?? "")}</td>`).join("") + "</tr>").join("");
  box._csv = {cols, rows: sorted};
  box.innerHTML = `<table><thead><tr>${h}</tr></thead><tbody>${body}</tbody></table>`;
  box.querySelectorAll("th").forEach(th => th.onclick = () => {
    const k = th.dataset.k; const dir = st.k === k ? -st.dir : (cols.find(c => c.k === k).num ? -1 : 1);
    table(containerId, cols, rows, { k, dir });
  });
}
document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => {
  const t = document.getElementById(b.dataset.toggle); t.classList.toggle("on"); b.classList.toggle("on", t.classList.contains("on"));
  b.textContent = t.classList.contains("on") ? "Hide table" : "Show table";
});

// ================================================================== 1. Country ECI
function domainTrees() { return { P: "Product", T: S.tech, S: S.sci }; }
function renderEci() {
  const t = tok(), y = S.year, trees = domainTrees(), sel = new Set(S.countries);
  const maps = { P: eciAt(trees.P, y), T: eciAt(trees.T, y), S: eciAt(trees.S, y) };
  // KPI tiles: coverage per domain
  document.getElementById("eciKpi").innerHTML = ["P", "T", "S"].map(k => {
    const m = maps[k]; const tr = trees[k];
    return `<div class="card"><div class="v">${m ? m.size : "–"}</div><div class="l">${FAM_LABEL[fam(tr)]} · ${y} countries with ECI<br><span style="color:var(--muted)">${treeLabel(tr)}</span></div></div>`;
  }).join("") + S.countries.slice(0, 3).map(c => {
    const vals = ["P", "T", "S"].map(k => maps[k] && maps[k].has(c) ? `${FAM_LABEL[fam(trees[k])]} ${fmt(maps[k].get(c))} (#${rank(maps[k]).get(c)})` : null).filter(Boolean);
    return `<div class="card"><div class="v" style="font-size:16px">${c} ${cname(c)}</div><div class="l">${vals.join(" · ") || "No data"}</div></div>`;
  }).join("");
  // rankings
  [["P", "rkP"], ["T", "rkT"], ["S", "rkS"]].forEach(([k, id]) => {
    const m = maps[k], tr = trees[k];
    setNote(id + "-note", `${treeLabel(tr)} · ${y} · Top 25 countries by ECI; selected countries are highlighted`);
    if (!m) { plot(id, [], {}); return; }
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = rows.slice(0, 25);
    const extra = S.countries.filter(c => m.has(c) && !top.some(r => r[0] === c)).map(c => [c, m.get(c)]);
    const all = top.concat(extra);
    const rk = rank(m);
    const labels = all.map(([c]) => `${c}  ${cname(c).slice(0, 20)}`);
    plot(id, [{
      type: "bar", orientation: "h", x: all.map(r => r[1]), y: labels,
      marker: { color: all.map(([c]) => sel.has(c) ? famColor(tr) : t.axis), line: { width: 0 } },
      customdata: all.map(([c]) => [cname(c), rk.get(c)]),
      hovertemplate: "<b>%{customdata[0]}</b><br>ECI %{x:.3f} · rank %{customdata[1]} / " + m.size + "<extra></extra>",
    }], lay({ margin: { l: 150, t: 4 }, height: Math.max(460, 16 * all.length + 60), bargap: 0.25,
             xaxis: { title: { text: "ECI (z-score)" }, zeroline: true }, yaxis: { autorange: "reversed", tickfont: { size: 10.5, color: t.text2 }, gridcolor: "rgba(0,0,0,0)" } }));
  });
  // time series
  const few = S.countries.length <= 4;
  [["P", "tsP"], ["T", "tsT"], ["S", "tsS"]].forEach(([k, id]) => {
    const tr = trees[k], traces = [], ann = [];
    S.countries.forEach(c => {
      const s = eciSeries(tr, c); if (!s.x.length) return;
      const col = pal(slotFor(S.cslot, c));
      traces.push({ type: "scatter", mode: "lines", x: s.x, y: s.y, name: `${c} ${cname(c)}`, line: { color: col, width: 2 },
                    hovertemplate: `<b>${c} ${cname(c)}</b> %{x}<br>ECI %{y:.3f}<extra></extra>` });
      if (few) ann.push({ x: s.x[s.x.length - 1], y: s.y[s.y.length - 1], text: c, showarrow: false, xanchor: "left", xshift: 4, font: { size: 10, color: col } });
    });
    plot(id, traces, lay({ showlegend: true, hovermode: "x unified", annotations: ann, margin: { t: 6, r: 30 },
                           yaxis: { title: { text: "ECI" }, zeroline: true }, shapes: [{ type: "line", x0: y, x1: y, y0: 0, y1: 1, yref: "paper", line: { color: t.axis, width: 1 } }] }));
  });
  // cross-domain scatter
  [["P", "T", "scPT"], ["P", "S", "scPS"], ["T", "S", "scTS"]].forEach(([a, b, id]) => {
    const ma = maps[a], mb = maps[b];
    if (!ma || !mb) { setNote(id + "-note", `${y}: Data is unavailable for one or both domains`); plot(id, [], {}); return; }
    const cs = [...ma.keys()].filter(c => mb.has(c));
    const rho = spearman(cs.map(c => ma.get(c)), cs.map(c => mb.get(c)));
    setNote(id + "-note", `${y} · ${cs.length} shared countries · Spearman ρ = ${fmt(rho)}`);
    const base = cs.filter(c => !sel.has(c)), hi = cs.filter(c => sel.has(c));
    const mk = list => ({ x: list.map(c => ma.get(c)), y: list.map(c => mb.get(c)), text: list.map(c => `${c} ${cname(c)}`) });
    const tb = mk(base), th = mk(hi);
    plot(id, [
      { type: "scatter", mode: "markers", ...tb, marker: { color: t.axis, size: 7, line: { color: t.surface, width: 1 } }, hovertemplate: "<b>%{text}</b><br>%{x:.2f} · %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "markers+text", ...th, text: hi, textposition: "top center", textfont: { size: 10, color: t.text2 },
        marker: { color: hi.map(c => pal(slotFor(S.cslot, c))), size: 11, line: { color: t.surface, width: 2 } },
        customdata: hi.map(c => cname(c)), hovertemplate: "<b>%{customdata}</b><br>%{x:.2f} · %{y:.2f}<extra></extra>" },
    ], lay({ hovermode: "closest", margin: { t: 6 }, xaxis: { title: { text: `ECI ${FAM_LABEL[fam(trees[a])]}` }, zeroline: true }, yaxis: { title: { text: `ECI ${FAM_LABEL[fam(trees[b])]}` }, zeroline: true } }));
  });
  // maps
  [["P", "mpP"], ["T", "mpT"], ["S", "mpS"]].forEach(([k, id]) => {
    const m = maps[k], tr = trees[k];
    if (!m) { plot(id, [], {}); return; }
    const cs = [...m.keys()].filter(c => D.iso3[c]);
    const lim = Math.min(3, Math.max(1, ...cs.map(c => Math.abs(m.get(c)))));
    plot(id, [{
      type: "choropleth", locations: cs.map(c => D.iso3[c]), z: cs.map(c => m.get(c)), text: cs.map(c => `${c} ${cname(c)}`),
      colorscale: DIVERGING[theme()], zmin: -lim, zmax: lim, zmid: 0, marker: { line: { color: t.surface, width: 0.4 } },
      colorbar: { thickness: 8, len: 0.7, tickfont: { size: 10, color: t.muted }, outlinewidth: 0, title: { text: "ECI", font: { size: 10 } } },
      hovertemplate: "<b>%{text}</b><br>ECI %{z:.2f}<extra></extra>",
    }], lay({ margin: { l: 0, r: 0, t: 0, b: 0 }, geo: { projection: { type: "natural earth" }, showframe: false, showcoastlines: false, showcountries: false,
            bgcolor: t.surface, landcolor: t.grid, showland: true, showocean: false, lakecolor: t.surface, showlakes: false } }));
  });
  renderEciTable();
}
function renderEciTable() {
  const y = S.year, trees = domainTrees(), q = (document.getElementById("eciTblQ").value || "").toLowerCase();
  const maps = { P: eciAt(trees.P, y), T: eciAt(trees.T, y), S: eciAt(trees.S, y) };
  const ranks = { P: maps.P && rank(maps.P), T: maps.T && rank(maps.T), S: maps.S && rank(maps.S) };
  const extra = (tree, stem) => { const p = P[tree], i = yIndex(p, y); if (i < 0 || !p[stem][i]) return null; const m = new Map(); p.countries.forEach((c, k) => { if (p[stem][i][k] != null) m.set(c, p[stem][i][k]); }); return m; };
  const fit = extra(trees.P, "fitness"), div = extra(trees.P, "diversity");
  const cs = new Set(); Object.values(maps).forEach(m => m && [...m.keys()].forEach(c => cs.add(c)));
  const rows = [...cs].map(c => ({ code: c, name: cname(c), eP: maps.P?.get(c) ?? null, rP: ranks.P?.get(c) ?? null, eT: maps.T?.get(c) ?? null, rT: ranks.T?.get(c) ?? null,
                                   eS: maps.S?.get(c) ?? null, rS: ranks.S?.get(c) ?? null, fit: fit?.get(c) ?? null, div: div?.get(c) ?? null }))
    .filter(r => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  table("eciTbl", [{ k: "code", label: "Code" }, { k: "name", label: "Country" }, { k: "eP", label: "Product ECI", num: true, d: 3 }, { k: "rP", label: "rank", num: true, d: 0 },
                   { k: "eT", label: "Technology ECI", num: true, d: 3 }, { k: "rT", label: "rank", num: true, d: 0 }, { k: "eS", label: "Knowledge ECI", num: true, d: 3 }, { k: "rS", label: "rank", num: true, d: 0 },
                   { k: "fit", label: "Product fitness", num: true, d: 3 }, { k: "div", label: "Product diversity", num: true, d: 0 }], rows, { k: "eP", dir: -1 });
}
function setupEci() {
  bindRange("eciYear", "eciYearLbl", allYears, S.year, v => { S.year = v; renderEci(); });
  fillSelect("eciTech", TECH, S.tech, treeLabel); fillSelect("eciSci", SCI, S.sci, treeLabel);
  document.getElementById("eciTech").onchange = e => { S.tech = e.target.value; document.getElementById("xTech").value = S.tech; renderEci(); };
  document.getElementById("eciSci").onchange = e => { S.sci = e.target.value; document.getElementById("xSci").value = S.sci; renderEci(); };
  const dl = document.getElementById("countryList");
  Object.keys(D.country_names).sort().forEach(c => { const o = document.createElement("option"); o.value = `${c} ${cname(c)}`; dl.appendChild(o); });
  const add = document.getElementById("eciAdd");
  add.onchange = () => {
    const v = add.value.trim(); if (!v) return;
    let code = v.split(/\s+/)[0].toUpperCase();
    if (!D.country_names[code]) { const hit = Object.entries(D.country_names).find(([, n]) => n.toLowerCase() === v.toLowerCase() || n.toLowerCase().startsWith(v.toLowerCase())); if (hit) code = hit[0]; }
    if (D.country_names[code] && !S.countries.includes(code) && S.countries.length < 8) { S.countries.push(code); slotFor(S.cslot, code); }
    add.value = ""; drawCountryChips(); renderEci();
  };
  S.countries.forEach(c => slotFor(S.cslot, c));
  drawCountryChips();
  document.getElementById("eciTblQ").oninput = renderEciTable;
}
function drawCountryChips() {
  chips("eciChips", S.countries, c => `${c} ${cname(c)}`, c => pal(slotFor(S.cslot, c)), c => { S.countries = S.countries.filter(x => x !== c); dropSlot(S.cslot, c); drawCountryChips(); renderEci(); });
}

// ================================================================== 2. Activity complexity (ACI / PCI)
function aciAt(tree, y) {
  const p = A[tree], i = yIndex(p, y); if (i < 0) return null;
  const rows = [];
  p.activities.forEach((a, k) => { const v = p.aci[i][k]; if (v != null) rows.push({ code: a, name: p.names[k], group: p.groups[k], aci: v, ub: p.ubiquity[i] ? p.ubiquity[i][k] : null }); });
  rows.sort((a, b) => b.aci - a.aci); rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}
function renderAci() {
  const t = tok(), tree = S.aTree, y = S.aYear, col = famColor(tree), rows = aciAt(tree, y), sel = new Set(S.acts);
  const lab = r => `${r.code}  ${r.name === r.code ? "" : r.name.slice(0, 34)}`;
  document.getElementById("aciKpi").innerHTML = rows?.length ? [
    `<div class="card"><div class="v">${rows.length}</div><div class="l">${y} activities with ACI · ${treeLabel(tree)}</div></div>`,
    `<div class="card"><div class="v" style="font-size:15px">${lab(rows[0])}</div><div class="l">Most complex activity · ACI ${fmt(rows[0].aci)}</div></div>`,
    `<div class="card"><div class="v" style="font-size:15px">${lab(rows[rows.length - 1])}</div><div class="l">Least complex activity · ACI ${fmt(rows[rows.length - 1].aci)}</div></div>`,
    `<div class="card"><div class="v">${new Set(rows.map(r => r.group)).size}</div><div class="l">Sectors</div></div>`,
  ].join("") : `<div class="card"><div class="v">–</div><div class="l">${y}: ${treeLabel(tree)} data is unavailable (${A[tree].years[0]}–${A[tree].years[A[tree].years.length - 1]})</div></div>`;
  const bars = (id, list, note) => {
    setNote(id + "-note", note);
    if (!list?.length) { plot(id, [], {}); return; }
    plot(id, [{ type: "bar", orientation: "h", x: list.map(r => r.aci), y: list.map(lab),
      marker: { color: list.map(r => sel.has(r.code) ? pal(slotFor(S.aslot, r.code)) : col), line: { width: 0 } },
      customdata: list.map(r => [r.name, r.group, r.rank, r.ub]),
      hovertemplate: "<b>%{customdata[0]}</b><br>Sector %{customdata[1]}<br>ACI %{x:.3f} · rank %{customdata[2]} · Ubiquity %{customdata[3]}<extra></extra>" }],
      lay({ margin: { l: 230, t: 4 }, height: 500, bargap: 0.25, xaxis: { title: { text: "ACI (z-score)" }, zeroline: true }, yaxis: { autorange: "reversed", tickfont: { size: 10.5, color: t.text2 }, gridcolor: "rgba(0,0,0,0)" } }));
  };
  bars("acTop", rows && rows.slice(0, 20), `${treeLabel(tree)} · ${y} · Top 20 by ACI`);
  bars("acBot", rows && rows.slice(-20).reverse(), `${treeLabel(tree)} · ${y} · Bottom 20 by ACI`);
  if (rows?.length) {
    const byG = new Map(); rows.forEach(r => { if (!byG.has(r.group)) byG.set(r.group, []); byG.get(r.group).push(r.aci); });
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
    const groups = [...byG.entries()].filter(([, v]) => v.length >= 3).sort((a, b) => med(a[1]) - med(b[1]));
    plot("acBox", groups.map(([g, v]) => ({ type: "box", x: v, name: `${g} (${v.length})`, orientation: "h", marker: { color: col, size: 3 }, line: { color: col, width: 1.5 }, fillcolor: "rgba(0,0,0,0)", boxpoints: false, hoverinfo: "x+name" })),
         lay({ margin: { l: 180, t: 4 }, height: Math.max(300, 26 * groups.length + 70), xaxis: { title: { text: "ACI" }, zeroline: true }, yaxis: { tickfont: { size: 10.5, color: t.text2 }, gridcolor: "rgba(0,0,0,0)" } }));
    const base = rows.filter(r => !sel.has(r.code) && r.ub != null), hi = rows.filter(r => sel.has(r.code) && r.ub != null);
    plot("acUb", [
      { type: "scatter", mode: "markers", x: base.map(r => r.ub), y: base.map(r => r.aci), text: base.map(r => `${r.code} ${r.name}<br>${r.group}`), marker: { color: t.axis, size: 6, line: { color: t.surface, width: 1 } }, hovertemplate: "<b>%{text}</b><br>Ubiquity %{x} · ACI %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "markers+text", x: hi.map(r => r.ub), y: hi.map(r => r.aci), text: hi.map(r => r.code), textposition: "top center", textfont: { size: 10, color: t.text2 },
        marker: { color: hi.map(r => pal(slotFor(S.aslot, r.code))), size: 11, line: { color: t.surface, width: 2 } }, customdata: hi.map(r => `${r.code} ${r.name}`), hovertemplate: "<b>%{customdata}</b><br>Ubiquity %{x} · ACI %{y:.2f}<extra></extra>" },
    ], lay({ hovermode: "closest", margin: { t: 6 }, xaxis: { title: { text: "Ubiquity (countries with RCA ≥ 1)" } }, yaxis: { title: { text: "ACI" }, zeroline: true } }));
  } else { plot("acBox", [], {}); plot("acUb", [], {}); }
  // time series of highlighted activities
  const p = A[tree], traces = [];
  S.acts.forEach(a => {
    const k = p.activities.indexOf(a); if (k < 0) return;
    const x = [], yv = []; p.years.forEach((yr, i) => { const v = p.aci[i][k]; x.push(yr); yv.push(v); });
    traces.push({ type: "scatter", mode: "lines", x, y: yv, name: `${a} ${p.names[k]}`.slice(0, 40), line: { color: pal(slotFor(S.aslot, a)), width: 2 }, hovertemplate: `<b>${a} ${p.names[k]}</b> %{x}<br>ACI %{y:.3f}<extra></extra>` });
  });
  const el = document.getElementById("acTs");
  if (!traces.length) clearPlot('acTs','Search and add activities to explore their complexity over time');
  else plot("acTs", traces, lay({ showlegend: true, hovermode: "x unified", margin: { t: 6 }, yaxis: { title: { text: "ACI" }, zeroline: true }, shapes: [{ type: "line", x0: y, x1: y, y0: 0, y1: 1, yref: "paper", line: { color: t.axis, width: 1 } }] }));
  renderAciTable();
}
function renderAciTable() {
  const rows = aciAt(S.aTree, S.aYear) || [], q = (document.getElementById("aciTblQ").value || "").toLowerCase();
  table("aciTbl", [{ k: "rank", label: "rank", num: true, d: 0 }, { k: "code", label: "Code" }, { k: "name", label: "Name" }, { k: "group", label: "Sector" }, { k: "aci", label: "ACI", num: true, d: 3 }, { k: "ub", label: "Ubiquity", num: true, d: 0 }],
        rows.filter(r => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q)), { k: "rank", dir: 1 });
}
function fillActList() {
  const p = A[S.aTree], dl = document.getElementById("actList"); dl.innerHTML = "";
  p.activities.forEach((a, k) => { const o = document.createElement("option"); o.value = p.names[k] === a ? a : `${a} ${p.names[k]}`; dl.appendChild(o); });
}
function drawActChips() {
  const p = A[S.aTree];
  chips("aciChips", S.acts, a => { const k = p.activities.indexOf(a); return k < 0 ? a : `${a} ${p.names[k]}`.slice(0, 40); }, a => pal(slotFor(S.aslot, a)),
        a => { S.acts = S.acts.filter(x => x !== a); dropSlot(S.aslot, a); drawActChips(); renderAci(); });
}
function setupAci() {
  fillSelect("aciTree", D.trees, S.aTree, treeLabel);
  const yr = bindRange("aciYear", "aciYearLbl", A[S.aTree].years, S.aYear, v => { S.aYear = v; renderAci(); });
  document.getElementById("aciTree").onchange = e => {
    S.aTree = e.target.value; S.acts = []; S.aslot.clear();
    const ys = A[S.aTree].years; yr.min = ys[0]; yr.max = ys[ys.length - 1];
    S.aYear = Math.min(Math.max(S.aYear, ys[0]), ys[ys.length - 1]); yr.value = S.aYear; document.getElementById("aciYearLbl").textContent = S.aYear;
    fillActList(); drawActChips(); renderAci();
  };
  fillActList(); drawActChips();
  const add = document.getElementById("aciAdd");
  add.onchange = () => {
    const v = add.value.trim(); if (!v) return;
    const p = A[S.aTree]; let code = v.split(/\s+/)[0];
    if (!p.activities.includes(code)) { const k = p.names.findIndex(n => n.toLowerCase() === v.toLowerCase() || n.toLowerCase().startsWith(v.toLowerCase())); if (k >= 0) code = p.activities[k]; }
    if (p.activities.includes(code) && !S.acts.includes(code) && S.acts.length < 8) { S.acts.push(code); slotFor(S.aslot, code); }
    add.value = ""; drawActChips(); renderAci();
  };
  document.getElementById("aciTblQ").oninput = renderAciTable;
}

// Detailed figures are repository assets; only the selected image is downloaded.
const FIGURE_NOTES = {
  space: 'Activities are nodes; proximity links connect related activities. Colors identify sectors.',
  space_communities: 'Activities are colored by detected community. Community labels and positions may change across years.',
  umap: 'A two-dimensional UMAP projection of activity proximity. Nearby activities have similar proximity profiles; axes have no intrinsic units.',
  proximity_matrix_by_cluster: 'Pairwise activity proximity, ordered by hierarchical clustering. Both axes contain activities.',
  proximity_matrix_by_community: 'Pairwise activity proximity, ordered by detected community. Both axes contain activities.',
  matrix_sorted: 'Binary specialization (RCA ≥ 1), sorted by country diversity and activity ubiquity.',
  matrix_fitness_sorted: 'Countries are ordered by decreasing fitness in both panels. Left: activities by decreasing ubiquity. Right: activities by increasing fitness-complexity.',
};
function syncFigureSelection(tree, category, yearKey, viewKey, yearId, viewId) {
  const dataset=D.figures.datasets[tree];
  const years=(dataset?.years||[]).filter(y=>Object.keys(dataset.figures[y]||{}).some(v=>D.figures.views[v]?.category===category));
  if(!years.includes(S[yearKey]))S[yearKey]=years.at(-1)??null;
  const views=Object.keys(dataset?.figures[S[yearKey]]||{}).filter(v=>D.figures.views[v]?.category===category);
  if(!views.includes(S[viewKey]))S[viewKey]=views[0]??null;
  fillSelect(yearId,[...years].reverse(),S[yearKey]);
  fillSelect(viewId,views,S[viewKey],v=>D.figures.views[v].label);
  document.getElementById(yearId).disabled=!years.length;
  document.getElementById(viewId).disabled=!views.length;
}
function renderFigure(id, tree, year, view) {
  const host=document.getElementById(id), figure=D.figures.datasets[tree]?.figures[year]?.[view];
  host.replaceChildren();
  if(!figure){host.innerHTML='<div class="empty">No figure is available for this selection.</div>';return;}
  const label=`${treeLabel(tree)} · ${year} · ${D.figures.views[view].label}`;
  const status=document.createElement('div');status.className='caption';status.setAttribute('role','status');
  status.textContent='Loading figure…';
  const link=document.createElement('a');link.href=assetURL(figure.path,figure.sha256);link.target='_blank';link.rel='noopener';
  link.title='Open full-size figure';link.hidden=true;
  const img=new Image();img.className='figure-image';img.alt=label;img.decoding='async';
  img.width=figure.width;img.height=figure.height;
  const toolbar=document.createElement('div');toolbar.className='figure-toolbar';toolbar.hidden=true;
  const open=document.createElement('a');open.href=link.href;open.target='_blank';open.rel='noopener';
  open.className='btn';open.textContent='Open full-size figure';
  const details=document.createElement('span');details.className='caption';
  details.textContent=`${figure.width.toLocaleString()} × ${figure.height.toLocaleString()} px · ${(figure.bytes/1_000_000).toFixed(2)} MB`;
  toolbar.append(open,details);link.append(img);host.append(status,link,toolbar);
  img.onload=()=>{if(host.contains(img)){status.remove();link.hidden=false;toolbar.hidden=false;}};
  img.onerror=()=>{
    if(!host.contains(img))return;
    status.textContent='Could not load this figure. Check your connection and retry. ';
    const retry=document.createElement('button');retry.className='btn';retry.textContent='Retry';
    retry.onclick=()=>renderFigure(id,tree,year,view);status.append(retry);
  };
  img.src=link.href;
}
function renderSpace() {
  const tree=S.spTree,sp=D.space[tree];
  syncFigureSelection(tree,'space','spYear','spFig','spYear','spFig');
  document.getElementById('spTitle').textContent=`${treeLabel(tree)} · ${S.spYear??'Unavailable'} · ${D.figures.views[S.spFig]?.label||'Activity space'}`;
  const i=sp.years.indexOf(S.spYear);
  document.getElementById('spNote').textContent=(FIGURE_NOTES[S.spFig]||'')+(i<0?'':` Network: ${sp.nodes[i].toLocaleString()} activities · ${sp.edges[i].toLocaleString()} links · ${sp.communities[i].toLocaleString()} communities.`);
  renderFigure('spNetwork',tree,S.spYear,S.spFig);
  for (const [id,key,name] of [['spN','nodes','Activities'],['spE','edges','Edges'],['spC','communities','Communities']])
    plot(id,[{type:'scatter',mode:'lines',x:sp.years,y:sp[key],name,line:{color:famColor(tree)},hovertemplate:`%{x}<br>${name}: %{y}<extra></extra>`}],lay({shapes:[{type:'line',x0:S.spYear,x1:S.spYear,y0:0,y1:1,yref:'paper',line:{color:tok().axis,width:1}}]}));
}
function setupSpace() {
  fillSelect('spTree',D.trees,S.spTree,treeLabel);
  document.getElementById('spTree').onchange=e=>{S.spTree=e.target.value;S.spYear=null;renderSpace();};
  document.getElementById('spYear').onchange=e=>{S.spYear=+e.target.value;renderSpace();};
  document.getElementById('spFig').onchange=e=>{S.spFig=e.target.value;renderSpace();};
}

// ================================================================== 4. Nestedness
const MEAS_LABEL = { NODF: "NODF", sNODF: "sNODF (stable NODF)", Temperature_score: "Temperature score", nSNES: "nSNES" };
function renderNest() {
  syncFigureSelection(S.nTree,'matrix','nYear','nFig','nYear','nFig');
  const t = tok(), m = S.nMeasure;
  const zTraces = [], exTraces = [];
  D.trees.forEach((tree, i) => {
    const n = N[tree]; if (!n.years.length) return;
    const s = n.measures[m], col = treeColor(tree);
    zTraces.push({ type: "scatter", mode: "lines", x: n.years, y: s.z, name: treeLabel(tree), line: { color: col, width: 2 }, hovertemplate: `<b>${treeLabel(tree)}</b> %{x}<br>z = %{y:.2f}<extra></extra>` });
    exTraces.push({ type: "scatter", mode: "lines", x: n.years, y: s.excess_pct, name: treeLabel(tree), line: { color: col, width: 2 }, hovertemplate: `<b>${treeLabel(tree)}</b> %{x}<br>Excess %{y:.2f}%<extra></extra>` });
  });
  const ref = [1.96, -1.96].map(v => ({ type: "line", x0: 0, x1: 1, xref: "paper", y0: v, y1: v, line: { color: t.muted, width: 1 } }));
  plot("nZ", zTraces, lay({ showlegend: true, hovermode: "x unified", margin: { t: 6 }, yaxis: { title: { text: `${MEAS_LABEL[m]} z-score` }, zeroline: true }, shapes: ref }));
  plot("nEx", exTraces, lay({ showlegend: true, hovermode: "x unified", margin: { t: 6 }, yaxis: { title: { text: "Excess relative to null model (%)" }, zeroline: true } }));
  // small multiples: observed vs null band
  const box = document.getElementById("nSmall");
  if (!box.children.length) D.trees.forEach((tree, i) => { const c = document.createElement("div"); c.className = "card"; c.innerHTML = `<h3>${treeLabel(tree)}</h3><div class="note">Observed ${MEAS_LABEL[m]} vs null-model 2.5th–97.5th percentile interval</div><div class="plot short" id="nSm${i}"></div>`; box.appendChild(c); });
  D.trees.forEach((tree, i) => {
    const n = N[tree], s = n.measures[m], col = treeColor(tree);
    box.children[i].querySelector(".note").textContent = `Observed ${MEAS_LABEL[m]} vs null-model 2.5th–97.5th percentile interval`;
    if (!n.years.length) { plot(`nSm${i}`, [], {}); return; }
    plot(`nSm${i}`, [
      { type: "scatter", mode: "lines", x: n.years, y: s.null_lo, line: { width: 0 }, hoverinfo: "skip", showlegend: false },
      { type: "scatter", mode: "lines", x: n.years, y: s.null_hi, fill: "tonexty", fillcolor: col + "33", line: { width: 0 }, name: "Null-model interval", hovertemplate: "Null upper bound %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "lines", x: n.years, y: s.null_mean, line: { color: t.muted, width: 1 }, name: "Null mean", hovertemplate: "Null mean %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "lines+markers", x: n.years, y: s.observed, line: { color: col, width: 2 }, marker: { size: 4 }, name: "Observed", customdata: s.z, hovertemplate: "Observed %{y:.2f} · z %{customdata:.1f}<extra></extra>" },
    ], lay({ showlegend: true, hovermode: "x unified", margin: { t: 6 }, legend: { y: -0.25 }, shapes: [{ type: "line", x0: S.nYear, x1: S.nYear, y0: 0, y1: 1, yref: "paper", line: { color: t.axis, width: 1 } }] }));
  });
  renderMatrix();
  // table
  const rows = [];
  D.trees.forEach(tree => { const n = N[tree]; n.years.forEach((y, i) => D.measures.forEach(mm => { const s = n.measures[mm]; rows.push({ tree: treeLabel(tree), year: y, measure: mm, obs: s.observed[i], mean: s.null_mean[i], lo: s.null_lo[i], hi: s.null_hi[i], z: s.z[i], ex: s.excess_pct[i] }); })); });
  table("nTbl", [{ k: "tree", label: "Dataset" }, { k: "year", label: "Year", num: true, d: 0 }, { k: "measure", label: "Measure" }, { k: "obs", label: "Observed", num: true, d: 3 }, { k: "mean", label: "Null mean", num: true, d: 3 },
                 { k: "lo", label: "Null 2.5%", num: true, d: 3 }, { k: "hi", label: "Null 97.5%", num: true, d: 3 }, { k: "z", label: "z", num: true, d: 2 }, { k: "ex", label: "Excess %", num: true, d: 2 }], rows, { k: "year", dir: 1 });
}
function setupNest() {
  fillSelect('nMeasure', D.measures, S.nMeasure, m => MEAS_LABEL[m]);
  fillSelect('nTree', D.trees, S.nTree, treeLabel);
  S.nYear=null;
  document.getElementById('nMeasure').onchange=e=>{S.nMeasure=e.target.value;renderNest();};
  document.getElementById('nTree').onchange=e=>{S.nTree=e.target.value;S.nYear=null;renderNest();};
  document.getElementById('nYear').onchange=e=>{S.nYear=+e.target.value;renderNest();};
  document.getElementById('nFig').onchange=e=>{S.nFig=e.target.value;renderMatrix();};
}
function renderMatrix() {
  syncFigureSelection(S.nTree,'matrix','nYear','nFig','nYear','nFig');
  document.getElementById('nMatTitle').textContent=`${treeLabel(S.nTree)} · ${S.nYear??'Unavailable'} · Nestedness matrix`;
  const available=D.figures.datasets[S.nTree]?.figures[S.nYear]||{};
  document.getElementById('nMatNote').textContent=(FIGURE_NOTES[S.nFig]||'')+(!available.matrix_fitness_sorted?' A fitness-sorted source figure is unavailable for this dataset and year.':'');
  renderFigure('nMat',S.nTree,S.nYear,S.nFig);
}


// ================================================================== 5. Cross-domain
function renderCross() {
  const t = tok(), y = S.xYear;
  const pairs = [["Product", S.tech], ["Product", S.sci], [S.tech, S.sci]];
  const traces = pairs.map(([a, b], i) => {
    const ys = P[a].years.filter(yy => P[b].years.includes(yy)), rho = [];
    ys.forEach(yy => { const ma = eciAt(a, yy), mb = eciAt(b, yy); const cs = [...ma.keys()].filter(c => mb.has(c)); rho.push(cs.length >= 20 ? spearman(cs.map(c => ma.get(c)), cs.map(c => mb.get(c))) : null); });
    const name = `${FAM_LABEL[fam(a)]} vs ${FAM_LABEL[fam(b)]}`;
    return { type: "scatter", mode: "lines+markers", x: ys, y: rho, name, line: { color: pal(i), width: 2 }, marker: { size: 5 }, hovertemplate: `<b>${name}</b> %{x}<br>ρ = %{y:.3f}<extra></extra>` };
  });
  plot("xRho", traces, lay({ showlegend: true, hovermode: "x unified", margin: { t: 6 }, yaxis: { title: { text: "Spearman ρ (ECI, country ranks)" }, range: [-1, 1], zeroline: true },
                             shapes: [{ type: "line", x0: y, x1: y, y0: 0, y1: 1, yref: "paper", line: { color: t.axis, width: 1 } }] }));
  const trees = ['Product', S.tech, S.sci], pair = [eciAt(trees[0], y), eciAt(trees[1], y), eciAt(trees[2], y)];
  const cs = pair.every(Boolean) ? [...pair[0].keys()].filter(c=>pair[1].has(c)&&pair[2].has(c)) : [];
  plot('xEci', cs.length ? [{type:'scatter',mode:'markers', x:cs.map(c=>pair[0].get(c)),y:cs.map(c=>pair[1].get(c)),text:cs.map(c=>cname(c)), customdata:cs.map(c=>pair[2]?.get(c)),
    marker:{size:9,color:cs.map(c=>pair[2]?.get(c)??0),colorscale:DIVERGING[theme()],cmid:0,colorbar:{title:{text:'Knowledge ECI'}}},
    hovertemplate:'%{text}<br>Product ECI %{x:.3f}<br>Technology ECI %{y:.3f}<br>Knowledge ECI %{customdata:.3f}<extra></extra>'}] : [], lay({xaxis:{title:{text:'Product ECI'}},yaxis:{title:{text:'Technology ECI'}}}));

}
function setupCross() {
  fillSelect("xTech", TECH, S.tech, treeLabel); fillSelect("xSci", SCI, S.sci, treeLabel);
  document.getElementById("xTech").onchange = e => { S.tech = e.target.value; document.getElementById("eciTech").value = S.tech; renderCross(); };
  document.getElementById("xSci").onchange = e => { S.sci = e.target.value; document.getElementById("eciSci").value = S.sci; renderCross(); };
  bindRange("xYear", "xYearLbl", allYears, S.xYear, v => { S.xYear = v; renderCross(); });

}

function setupScreening() {
  const profile=D.manifest.profile, rules=profile.rules;
  const output=(family,value)=>family==='Product'?`US$${(value*1000).toLocaleString('en-US')}`:`${value.toLocaleString('en-US')} ${family==='Technology'?'patent':'paper'} equivalents`;
  const families=['Product','Technology','Science'];
  const label=family=>family==='Science'?'Knowledge':family;
  document.getElementById('screeningSummary').textContent='Minimum annual country output: '+families.map(f=>`${label(f)} ${output(f,rules[f].min_country_mass)}`).join(' · ')+'.';
  const box=document.getElementById('screeningRules'),intro=document.createElement('p'),list=document.createElement('ul');
  intro.textContent='Screened uses explicit project support thresholds. Iterative pruning removes countries and activities below these floors; all measures are then recomputed using the retained annual matrix.';
  for(const family of families) {
    const rule=rules[family],item=document.createElement('li');
    item.textContent=`${label(family)}: country output ≥ ${output(family,rule.min_country_mass)}; activity output across retained countries ≥ ${output(family,rule.min_activity_mass)}; at least ${rule.min_country_activities} positive activities per country and ${rule.min_activity_countries} contributing countries per activity.`;
    list.append(item);
  }
  box.replaceChildren(intro,list);
  document.getElementById('screeningAudit').href=assetURL(D.manifest.screening_audit);
}

// ================================================================== tabs, theme, boot
const RENDER = { eci: renderEci, aci: renderAci, space: renderSpace, nest: renderNest, cross: renderCross };
let active = "eci";
function switchTab(name) {
  active = name;
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  RENDER[name]();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));
document.getElementById("themeBtn").onclick = () => {
  document.documentElement.dataset.theme = theme() === "dark" ? "light" : "dark";
  try { localStorage.setItem("ec-dash-theme", theme()); } catch (_) {}
  RENDER[active]();
};
(function boot() {
  let stored; try { stored = localStorage.getItem("ec-dash-theme"); } catch (_) {}
  const saved = stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = saved;
  setupScreening(); setupEci(); setupAci(); setupSpace(); setupNest(); setupCross();
  document.querySelectorAll("iframe").forEach(f => { f.title = "Interactive economic complexity visualization"; });
  document.querySelectorAll(".f input, .f select").forEach(el => { el.setAttribute("aria-label", el.closest(".f").querySelector("span")?.textContent || el.id); });
  document.querySelectorAll("[data-toggle]").forEach(toggle => {
    const button = document.createElement("button"); button.className = "btn"; button.textContent = "Download CSV";
    button.onclick = () => {
      const data = document.getElementById(toggle.dataset.toggle)._csv; if (!data) return;
      const quote = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
      const csv = [data.cols.map(c => quote(c.label)).join(","), ...data.rows.map(r => data.cols.map(c => quote(r[c.k])).join(","))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
      const a = document.createElement("a"); a.href = url; a.download = toggle.dataset.toggle + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }; toggle.after(button);
  });
  const nTY = D.trees.map(t => `${treeLabel(t)} ${P[t].years[0]}–${P[t].years.slice(-1)[0]}`).join(" · ");
  document.getElementById("foot").textContent = `Built ${D.built} · ${D.trees.length} datasets · ${nTY}. Screened metrics are loaded from Parquet; detailed figures cover the latest two available years per dataset.`;
  document.getElementById('loadStatus').textContent = `All-year Screened metrics loaded · Figures for the latest two years load on demand${location.protocol==='file:'?' · Data source: GitHub (internet required)':''}`;
  renderEci();
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => RENDER[active](), 200); });
})();
