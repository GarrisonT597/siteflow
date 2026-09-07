# SiteFlow Next

Production-shaped local multi-tenant construction ops app (Node + Express + static UI)

**PR #1** (static rebuild) is already merged. This folder is the **next upgrade**: real backend, hashed auth, disk JSON store, uploads, exports, notifications, PWA, and Stripe stubs.

## Run

    cd /workspace/siteflow-next
    npm install
    npm start

Then open http://localhost:4250

Data lives under `data/` (JSON + `data/uploads/`). Re-seed happens automatically when `data/` is empty.

## Demo accounts

| Role   | Username | Password     | Company         |
|--------|----------|--------------|-----------------|
| Owner  | owner    | SiteFlow99   | O. Edwards Co.  |
| Office | priya    | office123    | O. Edwards Co.  |
| Field  | marcus   | field123     | O. Edwards Co.  |
| Owner  | alex     | Ridge99      | Ridge Build LLC |

Client portal code: **PAD7-VIEW** (Pad 7 — North Wing)

## What is real vs stub

**Real (local):**
- Express API on port **4250**
- Cookie / token sessions; passwords hashed with **bcryptjs**
- Multi-tenant JSON store on disk (`companies`, `users`, `sessions`, `audit`, `notifications`)
- CRUD for jobs, crew, schedule, reports, COs, time, photos, yard, invoices, safety tals, materials/POs, subcontractors
- File uploads to `data/uploads/` (served at `/uploads/`)
- Audit log for CO + invoice / money actions
- CSV exports: time, invoices, jobs
- In-app notifications (job assigned, CO approved, invoice due)
- Company onboarding via register
- Roles: owner / office / field (+ permission flags)
- PWA: `manifest.webmanifest` + `service-worker.js` (shell cache; offline read via last bootstrap cache in localStorage)

**Stub only:**
- **Stripe** — `/api/stripe/*` returns stub payloads. Copy `.env.example` → `.env  and set `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` when you wire live billing. **No live charges** in this build.

## Layout

    server.js          Express app
    lib/store.js       JSON file store
    lib/auth.js         bcrypt + sessions
    lib/seed.js         demo tenants
    public/             static UI + PWA
    data/               runtime DB + uploads

## Checks

    npm run check
    curl -s http://localhost:4250/api/health

Do not push from this agent — parent handles GitHub.
