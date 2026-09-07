import { parquetReadObjects } from './hyparquet.min.js';
const cache = new Map();
let fileDescriptors = {};
const assetBase = location.protocol === 'file:'
  ? 'https://raw.githubusercontent.com/Dawoon-Jeong0523/EC_dashboard/main/'
  : new URL('./', document.baseURI).href;
export const assetURL = (path, hash) => {
  const url = new URL(path, assetBase);
  if (hash) url.searchParams.set('v', hash);
  return url.href;
};
export function readParquet(path) {
  if (!path) return Promise.reject(new Error('Dataset file is not available'));
  const hash = fileDescriptors[path]?.sha256;
  if (!hash) return Promise.reject(new Error('Dataset checksum is not available'));
  const url = assetURL(path, hash);
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const actual = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
      if (actual !== hash) throw new Error('Dataset checksum mismatch. Reload after the release finishes.');
      const rows = await parquetReadObjects({file: buffer});
      return rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
    })().catch(error => {cache.delete(url); throw error;}));
  }
  return cache.get(url);
}
export const loadDetail = (meta, kind) => readParquet(meta.files[kind]);
export async function loadDashboard() {
  const response = await fetch(assetURL('data/manifest.json'), {cache:'no-cache'});
  if (!response.ok) throw new Error(`Manifest: HTTP ${response.status}`);
  const manifest = await response.json();
  const figuresResponse = await fetch(assetURL('data/figures.json'), {cache:'no-cache'});
  if (!figuresResponse.ok) throw new Error(`Figure manifest: HTTP ${figuresResponse.status}`);
  const figures = await figuresResponse.json();
  if (manifest.profile?.kind !== 'screened' || figures.profile?.kind !== 'screened')
    throw new Error('This dashboard requires Screened results. Unscreened assets cannot be displayed.');
  const profileHash = manifest.profile_sha256;
  if (!profileHash || figures.profile_sha256 !== profileHash ||
      manifest.datasets.some(d=>d.profile_sha256!==profileHash) ||
      manifest.datasets.some(d=>figures.datasets[d.id]?.profile_sha256!==profileHash))
    throw new Error('Metrics and figures use different screening profiles. Reload after the release finishes.');
  fileDescriptors = manifest.files;
  const measures = ['NODF', 'sNODF', 'Temperature_score', 'nSNES'];
  const D = {manifest, figures, trees:manifest.datasets.map(d=>d.id), countries_default:['KR','US','DE','JP','CN','BR','VN','NG'],
    country_names:manifest.country_names,iso3:manifest.iso3,measures,eci:{},aci:{},nestedness:{},space:{},built:manifest.built_utc || manifest.built || manifest.generated_at || ''};
  const unique = (rows,key) => [...new Set(rows.map(r=>r[key]))].sort((a,b)=>typeof a==='number'?a-b:String(a).localeCompare(b));
  function panel(rows,id,fields) {
    const years=unique(rows,'year'), entities=unique(rows,id), yi=new Map(years.map((y,i)=>[y,i])),ei=new Map(entities.map((e,i)=>[e,i]));
    const p={years,[id==='country'?'countries':'activities']:entities};
    for(const f of fields) p[f]=years.map(()=>Array(entities.length).fill(null));
    for(const r of rows) for(const f of fields) p[f][yi.get(r.year)][ei.get(r[id])]=r[f]??null;
    if(id==='activity') {
      const labels = new Map(rows.map(r=>[r.activity,r]));
      p.names=entities.map(e=>labels.get(e).name||e);p.groups=entities.map(e=>labels.get(e).group||'Other');
    }
    return p;
  }
  let done=0;
  await Promise.all(manifest.datasets.map(async meta=> {
    const [countries,activities,nested,space]=await Promise.all(['country_metrics','activity_metrics','nestedness','space_stats'].map(kind=>loadDetail(meta,kind)));
    D.eci[meta.id]=panel(countries,'country',['eci','fitness','diversity']);
    D.aci[meta.id]=panel(activities,'activity',['aci','ubiquity','fitness_complexity']);
    const years=unique(nested,'year');
    const cols=['observed','null_mean','null_sd','null_lo','null_hi','z','excess_pct','p_upper','p_lower'];
    D.nestedness[meta.id]={years,measures:Object.fromEntries(measures.map(measure=> {
      const values = new Map(nested.filter(r=>r.measure===measure).map(r=>[r.year,r]));
      return [measure,Object.fromEntries(cols.map(c=>[c,years.map(y=>values.get(y)?.[c]??null)]))];
    }))};
    space.sort((a,b)=>a.year-b.year);
    D.space[meta.id]={years:space.map(r=>r.year),...Object.fromEntries(['nodes','edges','communities','density'].map(c=>[c,space.map(r=>r[c])]))};
    done++; document.getElementById('loadStatus').textContent=`Loading Parquet metrics… ${done} of ${manifest.datasets.length} datasets`;
  }));
  return D;
}
