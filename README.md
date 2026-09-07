# SiteFlow

Multi-company construction ops demo — field + office jobsites, scheduling, time, change orders, daily reports, yard, photos, invoices, and a client portal.

**Open locally:** double-click `index.html`, or from this folder run:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. Data stays in this browser (`localStorage` / portal `sessionStorage`). No backend and **no `siteflow-construction` repo** are required.

## Demo accounts

| Role   | Username | Password     | Company        |
|--------|----------|--------------|----------------|
| Owner  | `owner`  | `SiteFlow99` | O. Edwards Co. |
| Office | `priya`  | `office123`  | O. Edwards Co. |
| Field  | `marcus` | `field123`   | O. Edwards Co. |
| Owner  | `alex`   | `Ridge99`    | Ridge Build LLC (2nd tenant) |

Client portal code: **`PAD7-VIEW`** (Pad 7 — North Wing)

## Features

- **Multi-company tenants** — each company has isolated jobs, crew, schedule, time, COs, reports, equipment, photos, and invoices
- **Roles** — owner / office / field with demo logins; register creates a new company + owner
- **Jobs / locations** — jobsites with portal codes and status
- **Schedule** — week view; assign crew to jobs/days
- **Time** — posts per person, job, day at that person’s rate; weekly labor summary + bar chart
- **Change orders** — create / approve / reject with monotonic `CO-###`
- **Daily reports** — draft → submit workflow with monotonic `DR-###`
- **Equipment** — yard inventory scoped to company pool and/or job
- **Photos / docs** — captions (+ optional local image)
- **Invoices** — draft → sent → paid with monotonic `INV-###`
- **Client portal** — share code; ~8h session in `sessionStorage`
- **Admin** — company name, plan tiers (solo / crew / unlimited), crew roster with plan caps
- Escape all user text before DOM; local civil dates; unique portal codes; cascade deletes for jobs and people

## Files

- `index.html` — auth shell, app nav, portal shell
- `styles.css` — dark industrial theme (sage, Barlow Condensed + IBM Plex)
- `app.js` — full client app (multi-tenant store)

## Reset demo data

In the browser console: clear keys starting with `siteflow.` (or Application → Local Storage), then reload.
