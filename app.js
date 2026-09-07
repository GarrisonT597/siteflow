/* SiteFlow — multi-company construction ops demo (rebuild) */
(function () {
  "use strict";

  const KEY_AUTH = "siteflow.auth.v6";
  const KEY_STORE = "siteflow.store.v6";
  const KEY_SESSION = "siteflow.session.v6";
  const KEY_PORTAL = "siteflow.portal.v6";
  const SESSION_MS = 8 * 60 * 60 * 1000;
  const IDLE_MS = 30 * 60 * 1000;
  const PORTAL_MS = 8 * 60 * 60 * 1000;
  const PHOTO_MAX = 700000;
  const PLANS = {
    solo: { name: "Solo", price: 49, crewCap: 1 },
    crew: { name: "Crew", price: 99, crewCap: 5 },
    unlimited: { name: "Unlimited", price: 199, crewCap: 999 },
  };
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const $ = (id) => document.getElementById(id);
  let PICKED = "crew";
  let AUTH = null;
  let STORE = null;
  let DB = null;
  let SESSION = null;
  let CURRENT_VIEW = "jobs";
  let SELECTED_JOB = null;
  let WEEK_MON = null;
  let lastActivity = Date.now();

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])
    );

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function todayLocal(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    return todayLocal(new Date(y, m - 1, d + n));
  }
  function uid(p) {
    return p + "-" + Math.random().toString(36).slice(2, 10);
  }
  function money(n) {
    return (
      "$" +
      Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
    );
  }
  function weekStart(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = (dt.getDay() + 6) % 7;
    return addDays(iso, -day);
  }
  function fmtShort(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return m + "/" + d;
  }
  function rateOf(crewId) {
    return (DB?.crew || []).find((c) => c.id === crewId)?.rate || 0;
  }
  function crewName(crewId) {
    return (DB?.crew || []).find((c) => c.id === crewId)?.name || "—";
  }
  function jobName(jobId) {
    return (DB?.jobs || []).find((j) => j.id === jobId)?.name || "—";
  }
  function loadJSON(key, store) {
    try {
      const raw = (store || localStorage).getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function saveJSON(key, val, store) {
    (store || localStorage).setItem(key, JSON.stringify(val));
  }
  function canEdit() {
    return SESSION && (SESSION.role === "owner" || SESSION.role === "office");
  }
  function isOwner() {
    return SESSION && SESSION.role === "owner";
  }
  function isField() {
    return SESSION && SESSION.role === "field";
  }

  function emptyCompany(id, name, plan) {
    return {
      id,
      name,
      plan: plan || "crew",
      counters: { dr: 1, co: 1, inv: 1 },
      jobs: [],
      crew: [],
      schedule: [],
      reports: [],
      changes: [],
      time: [],
      photos: [],
      equipment: [],
      invoices: [],
    };
  }

  function allJobs() {
    const out = [];
    Object.values(STORE.companies || {}).forEach((co) => {
      (co.jobs || []).forEach((j) => out.push({ job: j, companyId: co.id, companyName: co.name }));
    });
    return out;
  }


  /* ---------- seed ---------- */
  function seedDemo() {
    const co1 = uid("co");
    const co2 = uid("co");

    const ownerId = uid("u");
    const officeId = uid("u");
    const fieldId = uid("u");
    const alexId = uid("u");

    const crewOwner = uid("c");
    const crewPriya = uid("c");
    const crewMarcus = uid("c");
    const crewAlex = uid("c");
    const crewSam = uid("c");

    const job1 = uid("j");
    const job2 = uid("j");
    const job3 = uid("j");
    const today = todayLocal();
    const mon = weekStart(today);

    AUTH = {
      users: [
        {
          id: ownerId,
          username: "owner",
          password: "SiteFlow99",
          name: "Garrison Owner",
          role: "owner",
          companyId: co1,
          crewId: crewOwner,
        },
        {
          id: officeId,
          username: "priya",
          password: "office123",
          name: "Priya Shah",
          role: "office",
          companyId: co1,
          crewId: crewPriya,
        },
        {
          id: fieldId,
          username: "marcus",
          password: "field123",
          name: "Marcus Reed",
          role: "field",
          companyId: co1,
          crewId: crewMarcus,
        },
        {
          id: alexId,
          username: "alex",
          password: "Ridge99",
          name: "Alex Rivera",
          role: "owner",
          companyId: co2,
          crewId: crewAlex,
        },
      ],
    };

    const c1 = emptyCompany(co1, "O. Edwards Co.", "unlimited");
    c1.counters = { dr: 3, co: 2, inv: 2 };
    c1.jobs = [
      {
        id: job1,
        name: "Pad 7 — North Wing",
        client: "Harbor Realty",
        address: "1200 Harbor Ave",
        status: "active",
        portalCode: "PAD7-VIEW",
        start: addDays(mon, -14),
        end: addDays(mon, 45),
      },
      {
        id: job2,
        name: "River Walk Punch",
        client: "City Parks",
        address: "88 River Walk",
        status: "punch",
        portalCode: "RIV2-VIEW",
        start: addDays(mon, -30),
        end: addDays(mon, 7),
      },
    ];
    c1.crew = [
      { id: crewOwner, name: "Garrison Owner", role: "owner", rate: 95, userId: ownerId },
      { id: crewPriya, name: "Priya Shah", role: "office", rate: 55, userId: officeId },
      { id: crewMarcus, name: "Marcus Reed", role: "field", rate: 42, userId: fieldId },
    ];
    c1.schedule = [
      { id: uid("s"), jobId: job1, date: mon, crewId: crewMarcus, note: "Form walls" },
      { id: uid("s"), jobId: job1, date: addDays(mon, 1), crewId: crewMarcus, note: "Pour slab" },
      { id: uid("s"), jobId: job1, date: addDays(mon, 2), crewId: crewOwner, note: "Inspect rebar" },
      { id: uid("s"), jobId: job2, date: addDays(mon, 3), crewId: crewMarcus, note: "Punch list" },
      { id: uid("s"), jobId: job1, date: addDays(mon, 4), crewId: crewMarcus, note: "Strip forms" },
    ];
    c1.reports = [
      {
        id: uid("r"),
        jobId: job1,
        number: "DR-001",
        date: addDays(mon, -1),
        weather: "Clear / 72F",
        workDone: "Set forms on north elevation. Tied rebar cages for columns A1–A4.",
        issues: "None",
        status: "submitted",
        by: "Marcus Reed",
      },
      {
        id: uid("r"),
        jobId: job1,
        number: "DR-002",
        date: today,
        weather: "Overcast / 68F",
        workDone: "Prep for pour. Verified embeds and vapor barrier.",
        issues: "Waiting on rebar delivery — ETA afternoon",
        status: "draft",
        by: "Marcus Reed",
      },
    ];
    c1.changes = [
      {
        id: uid("co"),
        jobId: job1,
        number: "CO-001",
        title: "Extra trench drain",
        amount: 4800,
        status: "approved",
        description: "Owner-requested drain at loading dock.",
      },
      {
        id: uid("co"),
        jobId: job1,
        number: "CO-002",
        title: "Upgrade to epoxy floor",
        amount: 12500,
        status: "open",
        description: "Change from sealed concrete to industrial epoxy in warehouse bay.",
      },
    ];
    c1.time = [
      { id: uid("t"), jobId: job1, crewId: crewMarcus, date: mon, hours: 8, rate: 42, note: "Forms" },
      { id: uid("t"), jobId: job1, crewId: crewMarcus, date: addDays(mon, 1), hours: 9, rate: 42, note: "Pour" },
      { id: uid("t"), jobId: job1, crewId: crewOwner, date: addDays(mon, 2), hours: 4, rate: 95, note: "QA" },
      { id: uid("t"), jobId: job2, crewId: crewMarcus, date: addDays(mon, 3), hours: 6, rate: 42, note: "Punch" },
      { id: uid("t"), jobId: job1, crewId: crewPriya, date: mon, hours: 3, rate: 55, note: "Submittals" },
    ];
    c1.photos = [
      {
        id: uid("p"),
        jobId: job1,
        caption: "North forms set — ready for pour",
        dataUrl: null,
        created: addDays(mon, -1),
      },
      {
        id: uid("p"),
        jobId: job1,
        caption: "Rebar cages A1–A4",
        dataUrl: null,
        created: today,
      },
      {
        id: uid("p"),
        jobId: job2,
        caption: "Punch items marked at railing",
        dataUrl: null,
        created: addDays(mon, -2),
      },
    ];
    c1.equipment = [
      { id: uid("e"), jobId: job1, name: "Boom lift 40'", status: "in", notes: "Yard bay 2" },
      { id: uid("e"), jobId: job1, name: "Plate compactor", status: "out", notes: "On Pad 7" },
      { id: uid("e"), jobId: job2, name: "Generator 5kW", status: "low", notes: "Fuel low" },
      { id: uid("e"), jobId: null, name: "Skid steer", status: "in", notes: "Shared — main yard" },
    ];
    c1.invoices = [
      {
        id: uid("i"),
        jobId: job1,
        number: "INV-001",
        amount: 25000,
        status: "sent",
        due: addDays(today, 14),
        description: "Progress billing #1 — foundation & forms",
      },
      {
        id: uid("i"),
        jobId: job2,
        number: "INV-002",
        amount: 4200,
        status: "paid",
        due: addDays(today, -7),
        description: "Punch list closeout",
      },
    ];

    const c2 = emptyCompany(co2, "Ridge Build LLC", "crew");
    c2.counters = { dr: 2, co: 1, inv: 1 };
    c2.jobs = [
      {
        id: job3,
        name: "Summit Retail Fit-Out",
        client: "Summit Partners",
        address: "410 Market St",
        status: "active",
        portalCode: "SUM3-VIEW",
        start: addDays(mon, -7),
        end: addDays(mon, 60),
      },
    ];
    c2.crew = [
      { id: crewAlex, name: "Alex Rivera", role: "owner", rate: 88, userId: alexId },
      { id: crewSam, name: "Sam Ortiz", role: "field", rate: 40, userId: null },
    ];
    c2.schedule = [
      { id: uid("s"), jobId: job3, date: mon, crewId: crewSam, note: "Demolition" },
      { id: uid("s"), jobId: job3, date: addDays(mon, 1), crewId: crewAlex, note: "Owner walk" },
      { id: uid("s"), jobId: job3, date: addDays(mon, 2), crewId: crewSam, note: "Framing start" },
    ];
    c2.reports = [
      {
        id: uid("r"),
        jobId: job3,
        number: "DR-001",
        date: addDays(mon, -1),
        weather: "Sunny / 78F",
        workDone: "Soft demo complete in suite 200.",
        issues: "Need dumpster swap Monday",
        status: "submitted",
        by: "Sam Ortiz",
      },
    ];
    c2.changes = [
      {
        id: uid("co"),
        jobId: job3,
        number: "CO-001",
        title: "Add glass storefront",
        amount: 8900,
        status: "open",
        description: "Replace solid entry with aluminum storefront system.",
      },
    ];
    c2.time = [
      { id: uid("t"), jobId: job3, crewId: crewSam, date: mon, hours: 8, rate: 40, note: "Demo" },
      { id: uid("t"), jobId: job3, crewId: crewAlex, date: addDays(mon, 1), hours: 3, rate: 88, note: "Walk" },
    ];
    c2.photos = [
      {
        id: uid("p"),
        jobId: job3,
        caption: "Suite 200 after soft demo",
        dataUrl: null,
        created: addDays(mon, -1),
      },
    ];
    c2.equipment = [
      { id: uid("e"), jobId: job3, name: "Demo hammer", status: "out", notes: "On site" },
      { id: uid("e"), jobId: null, name: "Pickup #3", status: "in", notes: "Shop" },
    ];
    c2.invoices = [
      {
        id: uid("i"),
        jobId: job3,
        number: "INV-001",
        amount: 15000,
        status: "draft",
        due: addDays(today, 21),
        description: "Mobilization & demo",
      },
    ];

    STORE = { companies: {} };
    STORE.companies[co1] = c1;
    STORE.companies[co2] = c2;
    saveJSON(KEY_AUTH, AUTH);
    saveJSON(KEY_STORE, STORE);
  }


  function ensureData() {
    AUTH = loadJSON(KEY_AUTH);
    STORE = loadJSON(KEY_STORE);
    if (!AUTH || !STORE || !AUTH.users?.length || !STORE.companies) {
      ["siteflow.db.v5", "siteflow.auth.v5", "siteflow.session.v5", "siteflow.portal.v5"].forEach((k) =>
        localStorage.removeItem(k)
      );
      seedDemo();
    }
    Object.values(STORE.companies).forEach((co) => {
      if (!co.counters) co.counters = { dr: 1, co: 1, inv: 1 };
      ["jobs", "crew", "schedule", "reports", "changes", "time", "photos", "equipment", "invoices"].forEach((k) => {
        if (!Array.isArray(co[k])) co[k] = [];
      });
    });
  }

  function persist() {
    if (SESSION?.companyId && DB) {
      STORE.companies[SESSION.companyId] = DB;
    }
    saveJSON(KEY_AUTH, AUTH);
    saveJSON(KEY_STORE, STORE);
  }

  function bindCompany(companyId) {
    DB = STORE.companies[companyId];
    if (!DB) throw new Error("Company not found");
  }

  function nextNumber(kind, prefix) {
    const n = DB.counters[kind] || 1;
    DB.counters[kind] = n + 1;
    persist();
    return prefix + "-" + String(n).padStart(3, "0");
  }

  function uniquePortalCode(base) {
    const used = new Set();
    Object.values(STORE.companies).forEach((co) => {
      (co.jobs || []).forEach((j) => {
        if (j.portalCode) used.add(j.portalCode.toUpperCase());
      });
    });
    let stem = (base || "JOB").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "JOB";
    let code = stem + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    let guard = 0;
    while (used.has(code) && guard++ < 40) {
      code = stem + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    return code;
  }

  function saveSession(user) {
    const co = STORE.companies[user.companyId];
    SESSION = {
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      company: co?.name || "",
      plan: co?.plan || user.plan || "crew",
      crewId: user.crewId || null,
      started: Date.now(),
      expires: Date.now() + SESSION_MS,
    };
    saveJSON(KEY_SESSION, SESSION);
    lastActivity = Date.now();
  }
  function loadSession() {
    SESSION = loadJSON(KEY_SESSION);
    if (!SESSION) return null;
    if (Date.now() > SESSION.expires) {
      clearSession();
      return null;
    }
    if (!STORE.companies[SESSION.companyId]) {
      clearSession();
      return null;
    }
    return SESSION;
  }
  function clearSession() {
    SESSION = null;
    localStorage.removeItem(KEY_SESSION);
  }
  function touchActivity() {
    lastActivity = Date.now();
  }
  function checkIdle() {
    if (!SESSION) return;
    if (Date.now() - lastActivity > IDLE_MS) logout();
  }

  function savePortalSession(job, companyId) {
    const sess = {
      code: job.portalCode,
      jobId: job.id,
      companyId,
      expires: Date.now() + PORTAL_MS,
    };
    saveJSON(KEY_PORTAL, sess, sessionStorage);
  }
  function loadPortalSession() {
    const sess = loadJSON(KEY_PORTAL, sessionStorage);
    if (!sess) return null;
    if (Date.now() > sess.expires) {
      sessionStorage.removeItem(KEY_PORTAL);
      return null;
    }
    return sess;
  }
  function clearPortalSession() {
    sessionStorage.removeItem(KEY_PORTAL);
  }

  function showAuth(which) {
    $("auth").classList.remove("hidden");
    $("app").classList.add("hidden");
    $("portal-app").classList.add("hidden");
    $("login-view").classList.toggle("hidden", which !== "login");
    $("register-view").classList.toggle("hidden", which !== "register");
    $("portal-gate").classList.toggle("hidden", which !== "portal");
  }

  function bindAuth() {
    $("to-register").onclick = (e) => {
      e.preventDefault();
      showAuth("register");
    };
    $("to-login").onclick = (e) => {
      e.preventDefault();
      showAuth("login");
    };
    $("to-login-2").onclick = (e) => {
      e.preventDefault();
      showAuth("login");
    };
    $("to-portal").onclick = (e) => {
      e.preventDefault();
      showAuth("portal");
    };

    document.querySelectorAll("#reg-plans .plan").forEach((el) => {
      el.onclick = () => {
        document.querySelectorAll("#reg-plans .plan").forEach((p) => p.classList.remove("on"));
        el.classList.add("on");
        PICKED = el.dataset.plan;
      };
    });

    $("login-form").onsubmit = (e) => {
      e.preventDefault();
      const u = ($("login-user").value || "").trim().toLowerCase();
      const p = ($("login-pass").value || "");
      const user = AUTH.users.find((x) => x.username.toLowerCase() === u && x.password === p);
      if (!user) {
        $("login-err").textContent = "Invalid username or password.";
        return;
      }
      $("login-err").textContent = "";
      bindCompany(user.companyId);
      saveSession(user);
      enterApp();
    };

    $("register-form").onsubmit = (e) => {
      e.preventDefault();
      const company = ($("reg-company").value || "").trim();
      const name = ($("reg-name").value || "").trim();
      const username = ($("reg-user").value || "").trim().toLowerCase();
      const password = $("reg-pass").value || "";
      if (!company || !name || !username || password.length < 6) {
        $("reg-err").textContent = "Fill all fields; password at least 6 characters.";
        return;
      }
      if (AUTH.users.some((x) => x.username.toLowerCase() === username)) {
        $("reg-err").textContent = "Username already taken.";
        return;
      }
      const companyId = uid("co");
      const crewId = uid("c");
      const user = {
        id: uid("u"),
        username,
        password,
        name,
        role: "owner",
        companyId,
        crewId,
      };
      AUTH.users.push(user);
      const co = emptyCompany(companyId, company, PICKED);
      co.crew.push({ id: crewId, name, role: "owner", rate: 75, userId: user.id });
      STORE.companies[companyId] = co;
      persist();
      bindCompany(companyId);
      $("reg-err").textContent = "";
      saveSession(user);
      enterApp();
    };

    $("portal-form").onsubmit = (e) => {
      e.preventDefault();
      const code = ($("portal-code").value || "").trim().toUpperCase();
      const hit = allJobs().find((x) => (x.job.portalCode || "").toUpperCase() === code);
      if (!hit) {
        $("portal-err").textContent = "Unknown portal code.";
        return;
      }
      $("portal-err").textContent = "";
      savePortalSession(hit.job, hit.companyId);
      enterPortal(hit.job, hit.companyId);
    };
  }

  function logout() {
    clearSession();
    DB = null;
    SELECTED_JOB = null;
    CURRENT_VIEW = "jobs";
    WEEK_MON = null;
    showAuth("login");
  }

  function enterApp() {
    clearPortalSession();
    $("auth").classList.add("hidden");
    $("portal-app").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("role-pill").textContent = SESSION.name + " · " + SESSION.role;
    $("side-company").textContent = SESSION.company;
    $("nav-admin").classList.toggle("hidden", SESSION.role !== "owner");
    if (!WEEK_MON) WEEK_MON = weekStart(todayLocal());
    fillJobSelect();
    setView(CURRENT_VIEW || "jobs");
  }

  function fillJobSelect() {
    const sel = $("job-select");
    const jobs = DB.jobs.slice();
    if (!SELECTED_JOB || !jobs.find((j) => j.id === SELECTED_JOB)) {
      SELECTED_JOB = jobs[0]?.id || null;
    }
    if (!jobs.length) {
      sel.innerHTML = '<option value="">No jobs</option>';
      return;
    }
    sel.innerHTML = jobs
      .map(
        (j) =>
          '<option value="' +
          esc(j.id) +
          '"' +
          (j.id === SELECTED_JOB ? " selected" : "") +
          ">" +
          esc(j.name) +
          "</option>"
      )
      .join("");
  }

  function currentJob() {
    return DB.jobs.find((j) => j.id === SELECTED_JOB) || null;
  }

  function setView(name) {
    if (name === "admin" && !isOwner()) name = "jobs";
    CURRENT_VIEW = name;
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
    const renderers = {
      jobs: renderJobs,
      schedule: renderSchedule,
      reports: renderReports,
      changes: renderChanges,
      time: renderTime,
      photos: renderPhotos,
      yard: renderYard,
      invoices: renderInvoices,
      admin: renderAdmin,
    };
    (renderers[name] || renderJobs)();
  }

  function bindApp() {
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.onclick = () => setView(b.dataset.view);
    });
    $("logout-btn").onclick = logout;
    $("job-select").onchange = () => {
      SELECTED_JOB = $("job-select").value || null;
      setView(CURRENT_VIEW);
    };
    document.addEventListener("click", touchActivity);
    document.addEventListener("keydown", touchActivity);
    setInterval(checkIdle, 60000);
  }

  function pageHead(title, sub, extra) {
    return (
      '<div class="page-head"><div><div class="kicker">SiteFlow</div><h2>' +
      esc(title) +
      '</h2><div class="who">' +
      esc(sub || "") +
      "</div></div>" +
      (extra || "") +
      "</div>"
    );
  }

  function needJob() {
    if (currentJob()) return false;
    $("view").innerHTML =
      pageHead("Select a job", "Create a job first.") +
      '<div class="card"><p class="meta">No job selected. Open Jobs to create one.</p></div>';
    return true;
  }

  function cascadeDeleteJob(jobId) {
    ["schedule", "reports", "changes", "time", "photos", "invoices"].forEach((k) => {
      DB[k] = DB[k].filter((x) => x.jobId !== jobId);
    });
    DB.equipment.forEach((e) => {
      if (e.jobId === jobId) e.jobId = null;
    });
    DB.jobs = DB.jobs.filter((j) => j.id !== jobId);
  }

  function cascadeDeletePerson(crewId) {
    DB.schedule = DB.schedule.filter((s) => s.crewId !== crewId);
    DB.time = DB.time.filter((t) => t.crewId !== crewId);
    DB.crew = DB.crew.filter((c) => c.id !== crewId);
    AUTH.users.forEach((u) => {
      if (u.crewId === crewId && u.companyId === SESSION.companyId && u.role !== "owner") {
        u.crewId = null;
      }
    });
  }


  /* ---------- Jobs ---------- */
  function renderJobs() {
    const jobs = DB.jobs;
    const plan = PLANS[DB.plan] || PLANS.crew;
    let html =
      pageHead("Jobs", DB.name + " · " + plan.name + " plan") +
      '<div class="stats">' +
      '<div class="card"><div class="lbl">Jobs</div><div class="num">' +
      jobs.length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Crew</div><div class="num">' +
      DB.crew.length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Open COs</div><div class="num">' +
      DB.changes.filter((c) => c.status === "open").length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Unpaid INV</div><div class="num">' +
      DB.invoices.filter((i) => i.status !== "paid").length +
      "</div></div></div>" +
      '<div class="job-list" id="job-list"></div>';

    if (canEdit()) {
      html +=
        '<div class="card" style="margin-top:16px">' +
        '<h3 class="cond" style="font-size:22px;margin-bottom:10px">New jobsite</h3>' +
        '<form id="job-form" class="form-grid">' +
        '<div><label>Name</label><input id="job-name" required placeholder="Pad 7 — North Wing" /></div>' +
        '<div><label>Client</label><input id="job-client" placeholder="Harbor Realty" /></div>' +
        '<div class="full"><label>Address / location</label><input id="job-address" /></div>' +
        '<div><label>Start</label><input id="job-start" type="date" value="' +
        todayLocal() +
        '" /></div>' +
        '<div><label>End</label><input id="job-end" type="date" /></div>' +
        '<div class="full actions"><button class="btn primary" type="submit">Create job</button></div>' +
        "</form></div>";
    } else {
      html +=
        '<div class="lock-note">Field role: select a job above to work reports, time, and photos.</div>';
    }
    $("view").innerHTML = html;

    const list = $("job-list");
    if (!jobs.length) {
      list.innerHTML = '<div class="empty">No jobs yet.</div>';
    } else {
      list.innerHTML = jobs
        .map((j) => {
          const hours = DB.time.filter((t) => t.jobId === j.id).reduce((s, t) => s + Number(t.hours), 0);
          return (
            '<div class="card job-card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div>' +
            "<h3>" +
            esc(j.name) +
            '</h3><div class="meta">' +
            esc(j.client || "—") +
            " · " +
            esc(j.address || "—") +
            '</div><div style="margin-top:8px"><span class="badge status ' +
            esc(j.status) +
            '">' +
            esc(j.status) +
            '</span><span class="badge mono" style="margin-left:6px">' +
            esc(j.portalCode) +
            "</span></div></div>" +
            '<div class="actions" style="margin-top:0">' +
            '<button class="btn sm" data-select="' +
            esc(j.id) +
            '" type="button">Select</button>' +
            (canEdit()
              ? '<button class="btn sm ghost" data-status="' +
                esc(j.id) +
                '" type="button">Cycle status</button>' +
                '<button class="btn sm danger" data-del="' +
                esc(j.id) +
                '" type="button">Delete</button>'
              : "") +
            '</div></div><div class="row3" style="margin-top:12px">' +
            '<div class="mini"><div class="lbl">Hours</div><div class="num" style="font-size:22px">' +
            hours +
            "</div></div>" +
            '<div class="mini"><div class="lbl">Reports</div><div class="num" style="font-size:22px">' +
            DB.reports.filter((r) => r.jobId === j.id).length +
            "</div></div>" +
            '<div class="mini"><div class="lbl">Photos</div><div class="num" style="font-size:22px">' +
            DB.photos.filter((p) => p.jobId === j.id).length +
            "</div></div></div></div>"
          );
        })
        .join("");
    }

    list.querySelectorAll("[data-select]").forEach((btn) => {
      btn.onclick = () => {
        SELECTED_JOB = btn.dataset.select;
        fillJobSelect();
        setView("jobs");
      };
    });
    list.querySelectorAll("[data-del]").forEach((btn) => {
      btn.onclick = () => {
        if (
          !confirm(
            "Delete this job and cascade related schedule, time, reports, COs, photos, and invoices?"
          )
        )
          return;
        cascadeDeleteJob(btn.dataset.del);
        if (SELECTED_JOB === btn.dataset.del) SELECTED_JOB = null;
        persist();
        fillJobSelect();
        renderJobs();
      };
    });
    list.querySelectorAll("[data-status]").forEach((btn) => {
      btn.onclick = () => {
        const j = DB.jobs.find((x) => x.id === btn.dataset.status);
        if (!j) return;
        const cycle = ["active", "punch", "open", "active"];
        const i = cycle.indexOf(j.status);
        j.status = cycle[(i < 0 ? 0 : i) + 1] || "active";
        persist();
        renderJobs();
      };
    });

    const form = $("job-form");
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = ($("job-name").value || "").trim();
        if (!name) return;
        const job = {
          id: uid("j"),
          name,
          client: ($("job-client").value || "").trim(),
          address: ($("job-address").value || "").trim(),
          status: "active",
          portalCode: uniquePortalCode(name),
          start: $("job-start").value || todayLocal(),
          end: $("job-end").value || "",
        };
        DB.jobs.push(job);
        SELECTED_JOB = job.id;
        persist();
        fillJobSelect();
        renderJobs();
      };
    }
  }

  /* ---------- Schedule ---------- */
  function renderSchedule() {
    if (!WEEK_MON) WEEK_MON = weekStart(todayLocal());
    const days = DAYS.map((label, i) => ({ label, date: addDays(WEEK_MON, i) }));
    const today = todayLocal();

    let html =
      pageHead("Schedule", "Week view · assign crew to jobs/days") +
      '<div class="week-nav">' +
      '<button class="btn sm" id="wk-prev" type="button">← Prev</button>' +
      '<div class="range">' +
      esc(fmtShort(WEEK_MON)) +
      " – " +
      esc(fmtShort(addDays(WEEK_MON, 6))) +
      "</div>" +
      '<button class="btn sm" id="wk-today" type="button">This week</button>' +
      '<button class="btn sm" id="wk-next" type="button">Next →</button></div>' +
      '<div class="week" id="week-grid"></div>';

    if (canEdit()) {
      html +=
        '<div class="card" style="margin-top:16px">' +
        '<h3 class="cond" style="font-size:22px;margin-bottom:10px">Assign crew</h3>' +
        '<form id="sched-form" class="form-grid">' +
        '<div><label>Job</label><select id="sch-job">' +
        DB.jobs
          .map(
            (j) =>
              '<option value="' +
              esc(j.id) +
              '"' +
              (j.id === SELECTED_JOB ? " selected" : "") +
              ">" +
              esc(j.name) +
              "</option>"
          )
          .join("") +
        '</select></div><div><label>Crew</label><select id="sch-crew">' +
        DB.crew
          .map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>")
          .join("") +
        '</select></div><div><label>Date</label><input id="sch-date" type="date" value="' +
        today +
        '" /></div><div><label>Note</label><input id="sch-note" placeholder="Form walls" /></div>' +
        '<div class="full actions"><button class="btn primary" type="submit">Add to schedule</button></div>' +
        "</form></div>";
    } else {
      html +=
        '<div class="lock-note">Field: your assignments appear on the week board. Office/owner can edit.</div>';
    }
    $("view").innerHTML = html;

    const grid = $("week-grid");
    grid.innerHTML = days
      .map((d) => {
        let items = DB.schedule.filter((s) => s.date === d.date);
        if (isField() && SESSION.crewId) {
          items = items.filter((s) => s.crewId === SESSION.crewId);
        }
        const chips =
          items
            .map((s) => {
              return (
                '<div class="chip">' +
                (canEdit()
                  ? '<button class="x" data-rm="' + esc(s.id) + '" type="button" title="Remove">×</button>'
                  : "") +
                '<div class="who-line">' +
                esc(crewName(s.crewId)) +
                '</div><div class="note-line">' +
                esc(jobName(s.jobId)) +
                (s.note ? " · " + esc(s.note) : "") +
                "</div></div>"
              );
            })
            .join("") || '<div class="meta" style="font-size:12px">—</div>';
        return (
          '<div class="day' +
          (d.date === today ? " today" : "") +
          '"><h4>' +
          esc(d.label) +
          " <b>" +
          esc(fmtShort(d.date)) +
          "</b></h4>" +
          chips +
          "</div>"
        );
      })
      .join("");

    $("wk-prev").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, -7);
      renderSchedule();
    };
    $("wk-next").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, 7);
      renderSchedule();
    };
    $("wk-today").onclick = () => {
      WEEK_MON = weekStart(todayLocal());
      renderSchedule();
    };
    grid.querySelectorAll("[data-rm]").forEach((btn) => {
      btn.onclick = () => {
        DB.schedule = DB.schedule.filter((s) => s.id !== btn.dataset.rm);
        persist();
        renderSchedule();
      };
    });

    const form = $("sched-form");
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        if (!DB.jobs.length || !DB.crew.length) return;
        DB.schedule.push({
          id: uid("s"),
          jobId: $("sch-job").value,
          crewId: $("sch-crew").value,
          date: $("sch-date").value || todayLocal(),
          note: ($("sch-note").value || "").trim(),
        });
        persist();
        renderSchedule();
      };
    }
  }


  /* ---------- Reports ---------- */
  function renderReports() {
    if (needJob()) return;
    const job = currentJob();
    const rows = DB.reports.filter((r) => r.jobId === job.id).slice().reverse();

    $("view").innerHTML =
      pageHead("Daily reports", job.name) +
      '<div class="card" style="margin-bottom:14px;overflow:auto"><table>' +
      "<thead><tr><th>No.</th><th>Date</th><th>By</th><th>Weather</th><th>Status</th><th></th></tr></thead><tbody>" +
      (rows
        .map((r) => {
          const canSub =
            r.status === "draft" && (canEdit() || (isField() && r.by === SESSION.name));
          return (
            "<tr><td class=\"mono\">" +
            esc(r.number) +
            "</td><td>" +
            esc(r.date) +
            "</td><td>" +
            esc(r.by) +
            "</td><td>" +
            esc(r.weather) +
            '</td><td><span class="status ' +
            esc(r.status) +
            '">' +
            esc(r.status) +
            '</span></td><td><button class="btn sm ghost" data-view-r="' +
            esc(r.id) +
            '" type="button">View</button>' +
            (canSub
              ? ' <button class="btn sm" data-sub="' + esc(r.id) + '" type="button">Submit</button>'
              : "") +
            "</td></tr>"
          );
        })
        .join("") || '<tr><td colspan="6" class="meta">No reports yet.</td></tr>') +
      '</tbody></table></div><div class="card" id="report-detail" style="display:none;margin-bottom:14px"></div>' +
      '<div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">New field report</h3>' +
      '<form id="rep-form" class="form-grid">' +
      '<div><label>Date</label><input id="rep-date" type="date" value="' +
      todayLocal() +
      '" /></div>' +
      '<div><label>Weather</label><input id="rep-weather" placeholder="Clear / 72F" /></div>' +
      '<div class="full"><label>Work done</label><textarea id="rep-work" required></textarea></div>' +
      '<div class="full"><label>Issues / delays</label><textarea id="rep-issues"></textarea></div>' +
      '<div class="full actions"><button class="btn primary" type="submit">Save draft</button></div>' +
      "</form></div>";

    $("view").querySelectorAll("[data-view-r]").forEach((btn) => {
      btn.onclick = () => {
        const r = DB.reports.find((x) => x.id === btn.dataset.viewR);
        if (!r) return;
        const box = $("report-detail");
        box.style.display = "block";
        box.innerHTML =
          '<div class="kicker">' +
          esc(r.number) +
          " · " +
          esc(r.status) +
          '</div><h3 class="cond" style="font-size:24px;margin:6px 0">' +
          esc(r.date) +
          " — " +
          esc(r.by) +
          '</h3><div class="meta">' +
          esc(r.weather) +
          '</div><p style="margin-top:12px"><strong>Work done</strong><br>' +
          esc(r.workDone) +
          '</p><p style="margin-top:10px"><strong>Issues</strong><br>' +
          esc(r.issues || "—") +
          "</p>";
      };
    });
    $("view").querySelectorAll("[data-sub]").forEach((btn) => {
      btn.onclick = () => {
        const r = DB.reports.find((x) => x.id === btn.dataset.sub);
        if (!r) return;
        r.status = "submitted";
        persist();
        renderReports();
      };
    });
    $("rep-form").onsubmit = (e) => {
      e.preventDefault();
      const work = ($("rep-work").value || "").trim();
      if (!work) return;
      DB.reports.push({
        id: uid("r"),
        jobId: job.id,
        number: nextNumber("dr", "DR"),
        date: $("rep-date").value || todayLocal(),
        weather: ($("rep-weather").value || "").trim(),
        workDone: work,
        issues: ($("rep-issues").value || "").trim(),
        status: "draft",
        by: SESSION.name,
      });
      persist();
      renderReports();
    };
  }

  /* ---------- Change orders ---------- */
  function renderChanges() {
    if (needJob()) return;
    const job = currentJob();
    const rows = DB.changes.filter((c) => c.jobId === job.id).slice().reverse();

    $("view").innerHTML =
      pageHead("Change orders", job.name) +
      '<div class="stats">' +
      '<div class="card"><div class="lbl">Open</div><div class="num">' +
      rows.filter((c) => c.status === "open").length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Approved</div><div class="num">' +
      rows.filter((c) => c.status === "approved").length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Approved $</div><div class="num">' +
      money(rows.filter((c) => c.status === "approved").reduce((s, c) => s + Number(c.amount), 0)) +
      "</div></div>" +
      '<div class="card"><div class="lbl">Total COs</div><div class="num">' +
      rows.length +
      "</div></div></div>" +
      '<div class="card" style="margin-bottom:14px;overflow:auto"><table>' +
      "<thead><tr><th>No.</th><th>Title</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>" +
      (rows
        .map((c) => {
          return (
            '<tr><td class="mono">' +
            esc(c.number) +
            "</td><td><strong>" +
            esc(c.title) +
            '</strong><div class="meta">' +
            esc(c.description || "") +
            "</div></td><td>" +
            esc(money(c.amount)) +
            '</td><td><span class="status ' +
            esc(c.status) +
            '">' +
            esc(c.status) +
            "</span></td><td>" +
            (canEdit() && c.status === "open"
              ? '<button class="btn sm" data-approve="' +
                esc(c.id) +
                '" type="button">Approve</button> ' +
                '<button class="btn sm ghost" data-reject="' +
                esc(c.id) +
                '" type="button">Reject</button>'
              : "") +
            "</td></tr>"
          );
        })
        .join("") || '<tr><td colspan="5" class="meta">No change orders.</td></tr>') +
      "</tbody></table></div>" +
      (canEdit()
        ? '<div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">New change order</h3>' +
          '<form id="co-form" class="form-grid">' +
          '<div><label>Title</label><input id="co-title" required /></div>' +
          '<div><label>Amount</label><input id="co-amount" type="number" min="0" step="0.01" required /></div>' +
          '<div class="full"><label>Description</label><textarea id="co-desc"></textarea></div>' +
          '<div class="full actions"><button class="btn primary" type="submit">Create CO</button></div>' +
          "</form></div>"
        : '<div class="lock-note">Field can view COs; office/owner create and approve.</div>');

    $("view").querySelectorAll("[data-approve]").forEach((btn) => {
      btn.onclick = () => {
        const c = DB.changes.find((x) => x.id === btn.dataset.approve);
        if (c) {
          c.status = "approved";
          persist();
          renderChanges();
        }
      };
    });
    $("view").querySelectorAll("[data-reject]").forEach((btn) => {
      btn.onclick = () => {
        const c = DB.changes.find((x) => x.id === btn.dataset.reject);
        if (c) {
          c.status = "rejected";
          persist();
          renderChanges();
        }
      };
    });
    const form = $("co-form");
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        DB.changes.push({
          id: uid("co"),
          jobId: job.id,
          number: nextNumber("co", "CO"),
          title: ($("co-title").value || "").trim(),
          amount: Number($("co-amount").value) || 0,
          status: "open",
          description: ($("co-desc").value || "").trim(),
        });
        persist();
        renderChanges();
      };
    }
  }


  /* ---------- Time ---------- */
  function renderTime() {
    if (!WEEK_MON) WEEK_MON = weekStart(todayLocal());
    const mon = WEEK_MON;
    const sun = addDays(mon, 6);
    let posts = DB.time.filter((t) => t.date >= mon && t.date <= sun);
    if (isField() && SESSION.crewId) {
      posts = posts.filter((t) => t.crewId === SESSION.crewId);
    }

    const byDay = DAYS.map((label, i) => {
      const date = addDays(mon, i);
      const dayPosts = posts.filter((t) => t.date === date);
      const hours = dayPosts.reduce((s, t) => s + Number(t.hours), 0);
      const cost = dayPosts.reduce(
        (s, t) => s + Number(t.hours) * Number(t.rate || rateOf(t.crewId)),
        0
      );
      return { label, date, hours, cost };
    });
    const maxH = Math.max(1, ...byDay.map((d) => d.hours));
    const weekHours = byDay.reduce((s, d) => s + d.hours, 0);
    const weekCost = byDay.reduce((s, d) => s + d.cost, 0);

    const jobOpts = DB.jobs
      .map(
        (j) =>
          '<option value="' +
          esc(j.id) +
          '"' +
          (j.id === SELECTED_JOB ? " selected" : "") +
          ">" +
          esc(j.name) +
          "</option>"
      )
      .join("");
    let crewList = DB.crew;
    if (isField() && SESSION.crewId) {
      crewList = DB.crew.filter((c) => c.id === SESSION.crewId);
    }
    const crewOpts = crewList
      .map(
        (c) =>
          '<option value="' +
          esc(c.id) +
          '">' +
          esc(c.name) +
          " ($" +
          c.rate +
          "/hr)</option>"
      )
      .join("");

    $("view").innerHTML =
      pageHead("Time tracking", "Per person · job · day · at that person’s rate") +
      '<div class="week-nav">' +
      '<button class="btn sm" id="tm-prev" type="button">← Prev</button>' +
      '<div class="range">Week of ' +
      esc(fmtShort(mon)) +
      "</div>" +
      '<button class="btn sm" id="tm-today" type="button">This week</button>' +
      '<button class="btn sm" id="tm-next" type="button">Next →</button></div>' +
      '<div class="stats">' +
      '<div class="card"><div class="lbl">Week hours</div><div class="num">' +
      weekHours +
      "</div></div>" +
      '<div class="card"><div class="lbl">Labor $</div><div class="num">' +
      money(weekCost) +
      "</div></div>" +
      '<div class="card"><div class="lbl">Entries</div><div class="num">' +
      posts.length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Crew on clock</div><div class="num">' +
      new Set(posts.map((t) => t.crewId)).size +
      "</div></div></div>" +
      '<div class="card" style="margin-bottom:14px"><div class="lbl">Weekly labor hours</div><div class="bars">' +
      byDay
        .map(
          (d) =>
            '<div class="bar-col"><div class="bar" style="height:' +
            Math.max(4, (d.hours / maxH) * 100) +
            '%" title="' +
            d.hours +
            'h"></div><span>' +
            esc(d.label) +
            "</span></div>"
        )
        .join("") +
      '</div></div><div class="card" style="margin-bottom:14px;overflow:auto"><table>' +
      "<thead><tr><th>Date</th><th>Person</th><th>Job</th><th>Hrs</th><th>Rate</th><th>$</th><th>Note</th><th></th></tr></thead><tbody>" +
      (posts
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((t) => {
          const rate = t.rate || rateOf(t.crewId);
          const canDel = canEdit() || (isField() && t.crewId === SESSION.crewId);
          return (
            "<tr><td>" +
            esc(t.date) +
            "</td><td>" +
            esc(crewName(t.crewId)) +
            "</td><td>" +
            esc(jobName(t.jobId)) +
            "</td><td>" +
            esc(t.hours) +
            "</td><td>" +
            esc(money(rate)) +
            "</td><td>" +
            esc(money(Number(t.hours) * rate)) +
            '</td><td class="meta">' +
            esc(t.note || "") +
            "</td><td>" +
            (canDel
              ? '<button class="btn sm ghost" data-del-t="' + esc(t.id) + '" type="button">×</button>'
              : "") +
            "</td></tr>"
          );
        })
        .join("") || '<tr><td colspan="8" class="meta">No time posted this week.</td></tr>') +
      '</tbody></table></div><div class="card">' +
      '<h3 class="cond" style="font-size:22px;margin-bottom:10px">Post time</h3>' +
      '<form id="time-form" class="form-grid">' +
      '<div><label>Person</label><select id="tm-crew">' +
      crewOpts +
      '</select></div><div><label>Job</label><select id="tm-job">' +
      jobOpts +
      '</select></div><div><label>Date</label><input id="tm-date" type="date" value="' +
      todayLocal() +
      '" /></div><div><label>Hours</label><input id="tm-hours" type="number" min="0.25" step="0.25" value="8" required /></div>' +
      '<div class="full"><label>Note</label><input id="tm-note" placeholder="Forms / pour / punch" /></div>' +
      '<div class="full actions"><button class="btn primary" type="submit">Post hours</button></div>' +
      "</form></div>";

    $("tm-prev").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, -7);
      renderTime();
    };
    $("tm-next").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, 7);
      renderTime();
    };
    $("tm-today").onclick = () => {
      WEEK_MON = weekStart(todayLocal());
      renderTime();
    };
    $("view").querySelectorAll("[data-del-t]").forEach((btn) => {
      btn.onclick = () => {
        DB.time = DB.time.filter((t) => t.id !== btn.dataset.delT);
        persist();
        renderTime();
      };
    });
    $("time-form").onsubmit = (e) => {
      e.preventDefault();
      const crewId = $("tm-crew").value;
      const jobId = $("tm-job").value;
      if (!crewId || !jobId) return;
      const hours = Number($("tm-hours").value) || 0;
      if (hours <= 0) return;
      DB.time.push({
        id: uid("t"),
        jobId,
        crewId,
        date: $("tm-date").value || todayLocal(),
        hours,
        rate: rateOf(crewId),
        note: ($("tm-note").value || "").trim(),
      });
      persist();
      renderTime();
    };
  }

  /* ---------- Photos ---------- */
  function renderPhotos() {
    if (needJob()) return;
    const job = currentJob();
    const photos = DB.photos.filter((p) => p.jobId === job.id).slice().reverse();

    $("view").innerHTML =
      pageHead("Photos & docs", job.name + " · captions for the record") +
      '<div class="photos" id="photo-grid"></div>' +
      '<div class="card" style="margin-top:16px">' +
      '<h3 class="cond" style="font-size:22px;margin-bottom:10px">Add caption / photo</h3>' +
      '<form id="photo-form" class="form-grid">' +
      '<div class="full"><label>Caption</label><input id="ph-cap" required placeholder="North forms set" /></div>' +
      '<div class="full"><label>Image (optional)</label><input id="ph-file" type="file" accept="image/*" /></div>' +
      '<div class="full actions"><button class="btn primary" type="submit">Save</button></div>' +
      '</form><p class="hint">Images stay in this browser only (compressed for localStorage).</p></div>';

    const grid = $("photo-grid");
    if (!photos.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No photos yet.</div>';
    } else {
      grid.innerHTML = photos
        .map((p) => {
          const media = p.dataUrl
            ? '<img src="' + p.dataUrl + '" alt="" />'
            : '<div class="ph">SF</div>';
          return (
            '<div class="photo">' +
            media +
            '<div class="cap">' +
            esc(p.caption) +
            '<div class="meta">' +
            esc(p.created) +
            "</div>" +
            (canEdit() || isField()
              ? '<button class="btn sm ghost" style="margin-top:6px" data-del-p="' +
                esc(p.id) +
                '" type="button">Remove</button>'
              : "") +
            "</div></div>"
          );
        })
        .join("");
    }

    grid.querySelectorAll("[data-del-p]").forEach((btn) => {
      btn.onclick = () => {
        DB.photos = DB.photos.filter((p) => p.id !== btn.dataset.delP);
        persist();
        renderPhotos();
      };
    });

    $("photo-form").onsubmit = (e) => {
      e.preventDefault();
      const caption = ($("ph-cap").value || "").trim();
      if (!caption) return;
      const file = $("ph-file").files && $("ph-file").files[0];
      const finish = (dataUrl) => {
        DB.photos.push({
          id: uid("p"),
          jobId: job.id,
          caption,
          dataUrl: dataUrl || null,
          created: todayLocal(),
        });
        persist();
        renderPhotos();
      };
      if (!file) {
        finish(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        let dataUrl = reader.result;
        if (typeof dataUrl === "string" && dataUrl.length > PHOTO_MAX) {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 800 / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            dataUrl = canvas.toDataURL("image/jpeg", 0.7);
            if (dataUrl.length > PHOTO_MAX) dataUrl = null;
            finish(dataUrl);
          };
          img.onerror = () => finish(null);
          img.src = dataUrl;
        } else {
          finish(dataUrl);
        }
      };
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    };
  }


  /* ---------- Yard / equipment ---------- */
  function renderYard() {
    const job = currentJob();

    $("view").innerHTML =
      pageHead(
        "Yard & equipment",
        job ? "Scoped to " + job.name + " + company pool" : "Company equipment"
      ) +
      '<div class="card" style="margin-bottom:14px;overflow:auto"><table>' +
      "<thead><tr><th>Asset</th><th>Status</th><th>Job</th><th>Notes</th><th></th></tr></thead><tbody>" +
      (DB.equipment
        .map((e) => {
          return (
            "<tr><td><strong>" +
            esc(e.name) +
            '</strong></td><td><span class="status ' +
            esc(e.status) +
            '">' +
            esc(e.status) +
            '</span></td><td class="meta">' +
            (e.jobId ? esc(jobName(e.jobId)) : "Company pool") +
            '</td><td class="meta">' +
            esc(e.notes || "") +
            "</td><td>" +
            (canEdit()
              ? '<button class="btn sm ghost" data-cycle-e="' +
                esc(e.id) +
                '" type="button">Status</button> ' +
                '<button class="btn sm danger" data-del-e="' +
                esc(e.id) +
                '" type="button">×</button>'
              : "") +
            "</td></tr>"
          );
        })
        .join("") || '<tr><td colspan="5" class="meta">No equipment.</td></tr>') +
      "</tbody></table></div>" +
      (canEdit()
        ? '<div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">Add equipment</h3>' +
          '<form id="eq-form" class="form-grid">' +
          '<div><label>Name</label><input id="eq-name" required placeholder="Boom lift 40\'" /></div>' +
          '<div><label>Status</label><select id="eq-status"><option value="in">in</option><option value="out">out</option><option value="low">low</option></select></div>' +
          '<div><label>Job (optional)</label><select id="eq-job"><option value="">Company pool</option>' +
          DB.jobs
            .map(
              (j) =>
                '<option value="' +
                esc(j.id) +
                '"' +
                (j.id === SELECTED_JOB ? " selected" : "") +
                ">" +
                esc(j.name) +
                "</option>"
            )
            .join("") +
          '</select></div><div><label>Notes</label><input id="eq-notes" /></div>' +
          '<div class="full actions"><button class="btn primary" type="submit">Add to yard</button></div>' +
          "</form></div>"
        : "");

    $("view").querySelectorAll("[data-cycle-e]").forEach((btn) => {
      btn.onclick = () => {
        const e = DB.equipment.find((x) => x.id === btn.dataset.cycleE);
        if (!e) return;
        const cycle = ["in", "out", "low", "in"];
        e.status = cycle[cycle.indexOf(e.status) + 1] || "in";
        persist();
        renderYard();
      };
    });
    $("view").querySelectorAll("[data-del-e]").forEach((btn) => {
      btn.onclick = () => {
        DB.equipment = DB.equipment.filter((e) => e.id !== btn.dataset.delE);
        persist();
        renderYard();
      };
    });
    const form = $("eq-form");
    if (form) {
      form.onsubmit = (ev) => {
        ev.preventDefault();
        DB.equipment.push({
          id: uid("e"),
          name: ($("eq-name").value || "").trim(),
          status: $("eq-status").value,
          jobId: $("eq-job").value || null,
          notes: ($("eq-notes").value || "").trim(),
        });
        persist();
        renderYard();
      };
    }
  }

  /* ---------- Invoices ---------- */
  function renderInvoices() {
    if (needJob()) return;
    const job = currentJob();
    const rows = DB.invoices.filter((i) => i.jobId === job.id).slice().reverse();

    $("view").innerHTML =
      pageHead("Invoices", job.name) +
      '<div class="stats">' +
      '<div class="card"><div class="lbl">Draft/Sent</div><div class="num">' +
      rows.filter((i) => i.status !== "paid").length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Paid</div><div class="num">' +
      rows.filter((i) => i.status === "paid").length +
      "</div></div>" +
      '<div class="card"><div class="lbl">Open $</div><div class="num">' +
      money(rows.filter((i) => i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0)) +
      "</div></div>" +
      '<div class="card"><div class="lbl">Paid $</div><div class="num">' +
      money(rows.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0)) +
      "</div></div></div>" +
      '<div class="card" style="margin-bottom:14px;overflow:auto"><table>' +
      "<thead><tr><th>No.</th><th>Description</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>" +
      (rows
        .map((inv) => {
          return (
            '<tr><td class="mono">' +
            esc(inv.number) +
            "</td><td>" +
            esc(inv.description) +
            "</td><td>" +
            esc(money(inv.amount)) +
            "</td><td>" +
            esc(inv.due) +
            '</td><td><span class="status ' +
            esc(inv.status) +
            '">' +
            esc(inv.status) +
            "</span></td><td>" +
            (canEdit()
              ? '<button class="btn sm" data-inv="' + esc(inv.id) + '" type="button">Advance</button>'
              : "") +
            "</td></tr>"
          );
        })
        .join("") || '<tr><td colspan="6" class="meta">No invoices.</td></tr>') +
      "</tbody></table></div>" +
      (canEdit()
        ? '<div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">New invoice</h3>' +
          '<form id="inv-form" class="form-grid">' +
          '<div><label>Amount</label><input id="inv-amount" type="number" min="0" step="0.01" required /></div>' +
          '<div><label>Due</label><input id="inv-due" type="date" value="' +
          addDays(todayLocal(), 14) +
          '" /></div>' +
          '<div class="full"><label>Description</label><input id="inv-desc" required placeholder="Progress billing #2" /></div>' +
          '<div class="full actions"><button class="btn primary" type="submit">Create invoice</button></div>' +
          "</form></div>"
        : '<div class="lock-note">Field can view invoices for the selected job.</div>');

    $("view").querySelectorAll("[data-inv]").forEach((btn) => {
      btn.onclick = () => {
        const inv = DB.invoices.find((x) => x.id === btn.dataset.inv);
        if (!inv) return;
        const cycle = { draft: "sent", sent: "paid", paid: "paid", overdue: "paid" };
        inv.status = cycle[inv.status] || "sent";
        persist();
        renderInvoices();
      };
    });
    const form = $("inv-form");
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        DB.invoices.push({
          id: uid("i"),
          jobId: job.id,
          number: nextNumber("inv", "INV"),
          amount: Number($("inv-amount").value) || 0,
          status: "draft",
          due: $("inv-due").value || addDays(todayLocal(), 14),
          description: ($("inv-desc").value || "").trim(),
        });
        persist();
        renderInvoices();
      };
    }
  }


  /* ---------- Admin ---------- */
  function renderAdmin() {
    if (!isOwner()) {
      setView("jobs");
      return;
    }
    const plan = PLANS[DB.plan] || PLANS.crew;
    const cap = plan.crewCap;

    $("view").innerHTML =
      pageHead("Admin", DB.name + " · company settings & crew") +
      '<div class="row2"><div class="card"><div class="lbl">Company</div>' +
      '<form id="co-set" style="margin-top:10px"><label>Name</label>' +
      '<input id="adm-name" value="' +
      esc(DB.name) +
      '" /><div class="actions"><button class="btn primary" type="submit">Save company</button></div></form></div>' +
      '<div class="card"><div class="lbl">Plan</div><div class="plan-grid" id="adm-plans">' +
      Object.entries(PLANS)
        .map(([k, p]) => {
          return (
            '<div class="plan-card' +
            (DB.plan === k ? " on" : "") +
            '" data-plan="' +
            esc(k) +
            '"><h4>' +
            esc(p.name) +
            '</h4><div class="price">$' +
            p.price +
            '</div><div class="meta">Crew cap: ' +
            (p.crewCap === 999 ? "∞" : p.crewCap) +
            "</div></div>"
          );
        })
        .join("") +
      '</div><p class="hint">Current: ' +
      esc(plan.name) +
      ". Caps apply when adding crew.</p></div></div>" +
      '<div class="card" style="margin-top:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
      '<h3 class="cond" style="font-size:22px">Crew roster</h3>' +
      '<span class="badge">' +
      DB.crew.length +
      " / " +
      (cap === 999 ? "∞" : cap) +
      "</span></div>" +
      '<table style="margin-top:12px"><thead><tr><th>Name</th><th>Role</th><th>Rate</th><th>Login</th><th></th></tr></thead><tbody>' +
      DB.crew
        .map((c) => {
          const user = AUTH.users.find((u) => u.id === c.userId);
          return (
            "<tr><td>" +
            esc(c.name) +
            '</td><td><span class="badge">' +
            esc(c.role) +
            "</span></td><td>" +
            esc(money(c.rate)) +
            '/hr</td><td class="mono meta">' +
            (user ? esc(user.username) : "—") +
            "</td><td>" +
            (c.role !== "owner"
              ? '<button class="btn sm danger" data-rm-crew="' +
                esc(c.id) +
                '" type="button">Remove</button>'
              : '<span class="meta">owner</span>') +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>" +
      '<div class="card" style="margin-top:14px">' +
      '<h3 class="cond" style="font-size:22px;margin-bottom:10px">Add crew member</h3>' +
      '<form id="crew-form" class="form-grid">' +
      '<div><label>Name</label><input id="cr-name" required /></div>' +
      '<div><label>Role</label><select id="cr-role"><option value="field">field</option><option value="office">office</option></select></div>' +
      '<div><label>Hourly rate</label><input id="cr-rate" type="number" min="0" step="1" value="40" /></div>' +
      '<div><label>Username (optional login)</label><input id="cr-user" autocomplete="off" /></div>' +
      '<div><label>Password</label><input id="cr-pass" type="password" autocomplete="new-password" /></div>' +
      '<div class="full actions"><button class="btn primary" type="submit">Add to roster</button></div>' +
      '</form><div class="err" id="crew-err"></div></div>' +
      '<div class="card" style="margin-top:14px">' +
      '<h3 class="cond" style="font-size:22px;margin-bottom:8px">Portal codes</h3>' +
      '<p class="meta" style="margin-bottom:10px">Share these with clients. Sessions last ~8 hours in this browser tab.</p>' +
      "<table><thead><tr><th>Job</th><th>Code</th></tr></thead><tbody>" +
      (DB.jobs
        .map(
          (j) =>
            "<tr><td>" +
            esc(j.name) +
            '</td><td class="mono">' +
            esc(j.portalCode) +
            "</td></tr>"
        )
        .join("") || '<tr><td colspan="2" class="meta">No jobs.</td></tr>') +
      "</tbody></table></div>";

    $("co-set").onsubmit = (e) => {
      e.preventDefault();
      const name = ($("adm-name").value || "").trim();
      if (!name) return;
      DB.name = name;
      SESSION.company = name;
      $("side-company").textContent = name;
      persist();
      renderAdmin();
    };

    document.querySelectorAll("#adm-plans .plan-card").forEach((el) => {
      el.onclick = () => {
        DB.plan = el.dataset.plan;
        SESSION.plan = DB.plan;
        persist();
        renderAdmin();
      };
    });

    $("view").querySelectorAll("[data-rm-crew]").forEach((btn) => {
      btn.onclick = () => {
        if (!confirm("Remove this person and cascade their schedule/time entries?")) return;
        const crewId = btn.dataset.rmCrew;
        const person = DB.crew.find((c) => c.id === crewId);
        if (person && person.userId) {
          AUTH.users = AUTH.users.filter(
            (u) => !(u.id === person.userId && u.role !== "owner")
          );
        }
        cascadeDeletePerson(crewId);
        persist();
        renderAdmin();
      };
    });

    $("crew-form").onsubmit = (e) => {
      e.preventDefault();
      $("crew-err").textContent = "";
      const planNow = PLANS[DB.plan] || PLANS.crew;
      if (DB.crew.length >= planNow.crewCap) {
        $("crew-err").textContent =
          "Crew cap reached for " + planNow.name + " plan. Upgrade in Admin.";
        return;
      }
      const name = ($("cr-name").value || "").trim();
      const role = $("cr-role").value;
      const rate = Number($("cr-rate").value) || 0;
      const username = ($("cr-user").value || "").trim().toLowerCase();
      const password = $("cr-pass").value || "";
      if (!name) return;
      let userId = null;
      if (username) {
        if (password.length < 6) {
          $("crew-err").textContent = "Login password must be at least 6 characters.";
          return;
        }
        if (AUTH.users.some((u) => u.username.toLowerCase() === username)) {
          $("crew-err").textContent = "Username already taken.";
          return;
        }
        userId = uid("u");
      }
      const crewId = uid("c");
      DB.crew.push({ id: crewId, name, role, rate, userId });
      if (userId) {
        AUTH.users.push({
          id: userId,
          username,
          password,
          name,
          role,
          companyId: SESSION.companyId,
          crewId,
        });
      }
      persist();
      renderAdmin();
    };
  }

  /* ---------- Portal ---------- */
  function enterPortal(job, companyId) {
    clearSession();
    $("auth").classList.add("hidden");
    $("app").classList.add("hidden");
    $("portal-app").classList.remove("hidden");
    const co = STORE.companies[companyId];
    if (!co) {
      showAuth("portal");
      return;
    }
    const reports = (co.reports || []).filter((r) => r.jobId === job.id && r.status === "submitted");
    const changes = (co.changes || []).filter((c) => c.jobId === job.id && c.status === "approved");
    const invoices = (co.invoices || []).filter((i) => i.jobId === job.id && i.status !== "draft");
    const photos = (co.photos || []).filter((p) => p.jobId === job.id);

    $("portal-view").innerHTML =
      '<div class="portal-top"><div class="brand-row" style="margin:0"><div class="logo">SF</div><div>' +
      '<h1 style="font-size:24px">SiteFlow</h1><div class="brand-tag">CLIENT PORTAL</div></div></div>' +
      '<button class="btn ghost" id="portal-out" type="button">Exit portal</button></div>' +
      '<div class="portal-banner"><div class="kicker">' +
      esc(co.name) +
      "</div><h2>" +
      esc(job.name) +
      '</h2><div class="meta">' +
      esc(job.client || "") +
      " · " +
      esc(job.address || "") +
      '</div><div style="margin-top:10px"><span class="badge status ' +
      esc(job.status) +
      '">' +
      esc(job.status) +
      '</span><span class="badge mono" style="margin-left:6px">' +
      esc(job.portalCode) +
      "</span></div></div><div class=\"stack\">" +
      '<div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">Submitted reports</h3>' +
      (reports
        .map(
          (r) =>
            '<div style="padding:10px 0;border-bottom:1px solid var(--line)">' +
            '<div class="mono meta">' +
            esc(r.number) +
            " · " +
            esc(r.date) +
            '</div><div style="margin-top:4px">' +
            esc(r.workDone) +
            "</div></div>"
        )
        .join("") || '<p class="meta">No submitted reports yet.</p>') +
      '</div><div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">Approved changes</h3>' +
      (changes
        .map(
          (c) =>
            '<div style="padding:8px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px">' +
            "<div><strong>" +
            esc(c.title) +
            '</strong><div class="meta">' +
            esc(c.number) +
            "</div></div><div>" +
            esc(money(c.amount)) +
            "</div></div>"
        )
        .join("") || '<p class="meta">No approved change orders.</p>') +
      '</div><div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">Invoices</h3>' +
      (invoices
        .map(
          (i) =>
            '<div style="padding:8px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px">' +
            '<div><span class="mono">' +
            esc(i.number) +
            "</span> · " +
            esc(i.description) +
            '<div class="meta status ' +
            esc(i.status) +
            '">' +
            esc(i.status) +
            " · due " +
            esc(i.due) +
            "</div></div><div>" +
            esc(money(i.amount)) +
            "</div></div>"
        )
        .join("") || '<p class="meta">No invoices shared yet.</p>') +
      '</div><div class="card"><h3 class="cond" style="font-size:22px;margin-bottom:10px">Photos</h3><div class="photos">' +
      (photos
        .map((p) => {
          const media = p.dataUrl
            ? '<img src="' + p.dataUrl + '" alt="" />'
            : '<div class="ph">SF</div>';
          return (
            '<div class="photo">' +
            media +
            '<div class="cap">' +
            esc(p.caption) +
            '<div class="meta">' +
            esc(p.created) +
            "</div></div></div>"
          );
        })
        .join("") || '<p class="meta">No photos.</p>') +
      "</div></div></div>";

    $("portal-out").onclick = () => {
      clearPortalSession();
      showAuth("login");
    };
  }

  /* ---------- boot ---------- */
  function boot() {
    ensureData();
    bindAuth();
    bindApp();

    const portal = loadPortalSession();
    if (portal) {
      const co = STORE.companies[portal.companyId];
      const job = co && co.jobs && co.jobs.find((j) => j.id === portal.jobId);
      if (job) {
        enterPortal(job, portal.companyId);
        return;
      }
      clearPortalSession();
    }

    const sess = loadSession();
    if (sess) {
      try {
        bindCompany(sess.companyId);
        enterApp();
        return;
      } catch (err) {
        clearSession();
      }
    }
    showAuth("login");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
