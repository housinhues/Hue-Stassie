# Housing Hues — Unified Workstation

Internal dashboard: project tracker, workload chart, calendar, and social feed links (Facebook/Instagram).

## Hosting

This Vite dashboard is deployed to **Vercel** at the domain root. A GitHub Pages workflow is also kept for an optional repository-site deployment; when that workflow runs, it builds with the `/hue-stassie/` project path automatically.

The expected public URL is:

```text
https://huestasie.vercel.app/
```

The dashboard stores its current workspace in browser `localStorage`, so it is usable in local-only mode. When Supabase is configured, the workstation adds magic-link login and cloud persistence.

## Local preview

```bash
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173/>.

## Cloud persistence

The Supabase-backed local-first persistence layer is enabled automatically when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present at build time. The Supabase project must be active and the SQL schema must be applied before enabling those variables. Never place a Supabase service-role key in frontend code.

The app intentionally remains usable without Supabase. In local-only mode, the cloud button reports `LOCAL ONLY` and all edits remain in the current browser.

## Deployment configuration

The GitHub Actions workflow only needs the optional Supabase variables when cloud mode is ready. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repository Actions secrets, then push to `main`. To use the optional GitHub Pages deployment, enable Pages for the repository and select **GitHub Actions** as its source.
