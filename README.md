# SiteFlow

Construction jobsite board for field and office.

Open `index.html` in a browser. Data stays on this device (localStorage).

## Demo
- Owner: `owner` / `SiteFlow99`
- Field: `marcus` / `field123`
- Client portal: `PAD7-VIEW`

## What this build fixes
- Escape user text before it hits the DOM
- Civil (local) dates instead of UTC slices
- Time posted per person, per job, per day, at that person’s rate
- Weekly labor and the bar chart computed from those posts
- Cascading job delete and dispatch cleanup when a person is removed
- Monotonic DR / CO / INV numbers
- Unique portal codes
- Portal session in sessionStorage with an 8-hour expiry
- Report submit workflow
- Equipment and invoices scoped to the selected job

Still a single-tenant demo. A real backend is required before this leaves the laptop.
