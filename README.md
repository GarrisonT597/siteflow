# SiteFlow

Construction jobsite board.

The working split app (PWA, hashed login, Stripe stub) lives here:

https://github.com/GarrisonT597/siteflow-construction

That repo now includes `ledger-fix.js` and `ledger-overrides.js` for:
- local civil dates
- time posted per person at that person’s rate
- weekly labor computed from those posts
- cascading job delete
- monotonic DR / CO / INV numbers
- unique portal codes
- portal session in sessionStorage

The single-file demo used in the project workspace is `siteflow-app.html`.
