# Economic Complexity Explorer — deployment mirror

**Live dashboard:** https://dawoon-jeong0523.github.io/EC_dashboard/dashboard.html

This repository holds only the static site of the Economic Complexity dashboard so that it can be served by GitHub
Pages: `dashboard.html`, `index.html` (redirect), `assets/` (frontend bundle and the vendored Parquet reader),
`data/` (screened metrics as Parquet with their manifests) and `figures/` (the latest-two-year activity-space and
nestedness views). Nothing here is edited by hand.

The analysis — country × activity matrices, their builders, the screening pipeline, the exporters and the
documentation of every measurement choice — lives in the private repository `Dawoon-Jeong0523/EC`; its
`scripts/publish_dashboard.sh` copies a finished build into this repository and commits it. Each commit message
names the build time recorded in `data/manifest.json` and the EC commit it came from.

Twenty-one datasets are published: Product (BACI HS4 exports), Technology from PatentsView (US grants; inventor and
assignee country; first or all CPC codes; grant and filing year), Technology from PATSTAT (worldwide patent families;
inventor and applicant country), and Knowledge from OpenAlex (subfields) and Dimensions (ANZSRC Fields of Research).
All metrics are recomputed on annually screened matrices (`data/screening.json` records the rules and every excluded
country, activity and dataset-year). See the dashboard's own notes for interpretation.

Third-party components: Plotly.js (MIT, loaded from its CDN) and hyparquet (MIT, vendored) — see
`THIRD_PARTY_NOTICES.md`.
