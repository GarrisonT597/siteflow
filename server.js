"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const store = require("./lib/store");
const auth = require("./lib/auth");
const seed = require("./lib/seed");

const PORT = Number(process.env.PORT) || 4250;
const PLANS = {
  solo: { name: "Solo", price: 49, crewCap: 1 },
  crew: { name: "Crew", price: 99, crewCap: 5 },
  unlimited: { name: "Unlimited", price: 199, crewCap: 999 },
};

const COLLECTIONS = [
  "jobs",
  "crew",
  "schedule",
  "reports",
  "changes",
  "time",
  "photos",
  "equipment",
  "invoices",
  "safety",
  "materials",
  "subcontractors",
];

function uid(p) {
  return p + "-" + uuidv4().slice(0, 8);
}

function nextNumber(company, key, prefix) {
  if (!company.counters) company.counters = { dr: 1, co: 1, inv: 1, po: 1, talk: 1 };
  const n = company.counters[key] || 1;
  company.counters[key] = n + 1;
  return prefix + "-" + String(n).padStart(3, "0");
}

function ensureCompanyShape(co) {
  if (!co.counters) co.counters = { dr: 1, co: 1, inv: 1, po: 1, talk: 1 };
  COLLECTIONS.forEach((k) => {
    if (!Array.isArray(co[k])) co[k] = [];
  });
  return co;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  });
  return lines.join("\n") + "\n";
}

function audit(req, action, entity, detail) {
  const s = req.session;
  store.appendAudit({
    id: uid("a"),
    companyId: s.companyId,
    at: new Date().toISOString(),
    actor: s.username,
    action,
    entity: entity || null,
    detail: detail || null,
  });
}

function notify(companyId, userId, type, title, body) {
  store.addNotification({
    id: uid("n"),
    companyId,
    userId: userId || null,
    type,
    title,
    body,
    read: false,
    created: new Date().toISOString(),
  });
}

async function main() {
  store.ensureDirs();
  await seed.seedIfNeeded(false);

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use("/uploads", express.static(store.UPLOADS_DIR));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, store.UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").slice(0, 10) || ".bin";
        cb(null, uid("up") + ext);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
  });

  function requireAuth(req, res, next) {
    const token =
      req.cookies[auth.SESSION_COOKIE] ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
      req.headers["x-session-token"];
    const session = auth.getSession(token);
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    req.session = session;
    req.token = token;
    next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.session || !roles.includes(req.session.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    };
  }

  function loadCompany(req, res, next) {
    const co = store.getCompany(req.session.companyId);
    if (!co) return res.status(404).json({ error: "Company not found" });
    req.company = ensureCompanyShape(co);
    next();
  }

  // ---------- Auth ----------
  app.post("/api/auth/login", async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = store.findUser((u) => u.username.toLowerCase() === username);
    if (!user || !(await auth.verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const session = auth.createSession(user);
    res.cookie(auth.SESSION_COOKIE, session.token, auth.cookieOptions());
    const company = ensureCompanyShape(store.getCompany(user.companyId));
    res.json({
      user: auth.publicUser(user),
      company: { id: company.id, name: company.name, plan: company.plan },
      token: session.token,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = req.cookies[auth.SESSION_COOKIE] || req.body.token;
    auth.destroySession(token);
    res.clearCookie(auth.SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = store.findUser((u) => u.id === req.session.userId);
    const company = store.getCompany(req.session.companyId);
    if (!user || !company) return res.status(401).json({ error: "Session invalid" });
    res.json({
      user: auth.publicUser(user),
      company: { id: company.id, name: company.name, plan: company.plan },
    });
  });

  // Company onboarding (register owner + new tenant)
  app.post("/api/auth/register", async (req, res) => {
    const companyName = String(req.body.company || "").trim();
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const plan = PLANS[req.body.plan] ? req.body.plan : "crew";

    if (!companyName || !name || !username || password.length < 6) {
      return res.status(400).json({ error: "Company, name, username, and password (6+) required" });
    }
    if (store.findUser((u) => u.username.toLowerCase() === username)) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const companyId = uid("co");
    const userId = uid("u");
    const crewId = uid("c");
    const company = seed.emptyCompany(companyId, companyName, plan);
    company.crew = [{ id: crewId, name, role: "owner", rate: 75, userId }];
    store.saveCompany(company);

    const user = {
      id: userId,
      username,
      passwordHash: await auth.hashPassword(password),
      name,
      role: "owner",
      companyId,
      crewId,
      permissions: auth.defaultPermissions("owner"),
    };
    const users = store.getUsers();
    users.push(user);
    store.saveUsers(users);

    store.appendAudit({
      id: uid("a"),
      companyId,
      at: new Date().toISOString(),
      actor: username,
      action: "company.created",
      entity: companyId,
      detail: "Onboarded " + companyName + " (" + plan + ")",
    });

    const session = auth.createSession(user);
    res.cookie(auth.SESSION_COOKIE, session.token, auth.cookieOptions());
    res.status(201).json({
      user: auth.publicUser(user),
      company: { id: company.id, name: company.name, plan: company.plan },
      token: session.token,
    });
  });

  // ---------- Company bootstrap ----------
  app.get("/api/bootstrap", requireAuth, loadCompany, (req, res) => {
    const user = store.findUser((u) => u.id === req.session.userId);
    const notifications = store.getNotifications(req.session.companyId, req.session.userId);
    res.json({
      user: auth.publicUser(user),
      company: {
        id: req.company.id,
        name: req.company.name,
        plan: req.company.plan,
        counters: req.company.counters,
      },
      data: Object.fromEntries(COLLECTIONS.map((k) => [k, req.company[k]])),
      plans: PLANS,
      notifications,
      unread: notifications.filter((n) => !n.read).length,
    });
  });

  app.patch("/api/company", requireAuth, requireRole("owner"), loadCompany, (req, res) => {
    if (req.body.name) req.company.name = String(req.body.name).trim();
    if (req.body.plan && PLANS[req.body.plan]) req.company.plan = req.body.plan;
    store.saveCompany(req.company);
    audit(req, "company.updated", req.company.id, "Updated company settings");
    res.json({ id: req.company.id, name: req.company.name, plan: req.company.plan });
  });

  // ---------- Generic CRUD helpers ----------
  function crudList(collection) {
    app.get("/api/" + collection, requireAuth, loadCompany, (req, res) => {
      let items = req.company[collection] || [];
      if (req.query.jobId) items = items.filter((x) => x.jobId === req.query.jobId);
      res.json(items);
    });
  }

  function crudGet(collection) {
    app.get("/api/" + collection + "/:id", requireAuth, loadCompany, (req, res) => {
      const item = (req.company[collection] || []).find((x) => x.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Not found" });
      res.json(item);
    });
  }

  function crudCreate(collection, prepare) {
    app.post("/api/" + collection, requireAuth, loadCompany, (req, res) => {
      if (req.session.role === "field" && !["reports", "time", "photos", "safety"].includes(collection)) {
        return res.status(403).json({ error: "Field role cannot create " + collection });
      }
      const item = prepare ? prepare(req, req.body) : { ...req.body, id: uid(collection.slice(0, 1)) };
      if (!item.id) item.id = uid(collection.slice(0, 3));
      req.company[collection].push(item);
      store.saveCompany(req.company);
      res.status(201).json(item);
    });
  }

  function crudUpdate(collection, onUpdate) {
    app.patch("/api/" + collection + "/:id", requireAuth, loadCompany, (req, res) => {
      const list = req.company[collection] || [];
      const i = list.findIndex((x) => x.id === req.params.id);
      if (i < 0) return res.status(404).json({ error: "Not found" });
      const prev = list[i];
      const next = { ...prev, ...req.body, id: prev.id };
      if (onUpdate) {
        const err = onUpdate(req, prev, next);
        if (err) return res.status(err.status || 400).json({ error: err.error });
      }
      list[i] = next;
      store.saveCompany(req.company);
      res.json(next);
    });
  }

  function crudDelete(collection) {
    app.delete("/api/" + collection + "/:id", requireAuth, loadCompany, (req, res) => {
      if (req.session.role === "field") return res.status(403).json({ error: "Forbidden" });
      const before = req.company[collection].length;
      req.company[collection] = req.company[collection].filter((x) => x.id !== req.params.id);
      if (req.company[collection].length === before) return res.status(404).json({ error: "Not found" });
      // cascade job delete
      if (collection === "jobs") {
        const jid = req.params.id;
        ["schedule", "reports", "changes", "time", "photos", "equipment", "invoices", "safety", "materials"].forEach(
          (k) => {
            req.company[k] = (req.company[k] || []).filter((x) => x.jobId !== jid);
          }
        );
      }
      if (collection === "crew") {
        const cid = req.params.id;
        req.company.schedule = req.company.schedule.filter((x) => x.crewId !== cid);
        req.company.time = req.company.time.filter((x) => x.crewId !== cid);
      }
      store.saveCompany(req.company);
      res.json({ ok: true });
    });
  }

  // Jobs
  crudList("jobs");
  crudGet("jobs");
  crudCreate("jobs", (req, body) => {
    const code =
      String(body.portalCode || "")
        .trim()
        .toUpperCase() || uid("PORT").toUpperCase().replace("-", "").slice(0, 9);
    return {
      id: uid("j"),
      name: String(body.name || "Untitled job").trim(),
      client: String(body.client || "").trim(),
      address: String(body.address || "").trim(),
      status: body.status || "active",
      portalCode: code,
      start: body.start || null,
      end: body.end || null,
    };
  });
  crudUpdate("jobs");
  crudDelete("jobs");

  // Crew
  crudList("crew");
  crudGet("crew");
  crudCreate("crew", (req, body) => {
    const plan = PLANS[req.company.plan] || PLANS.crew;
    if (req.company.crew.length >= plan.crewCap) {
      const err = new Error("Crew cap reached for plan");
      err.status = 400;
      throw err;
    }
    return {
      id: uid("c"),
      name: String(body.name || "").trim(),
      role: body.role || "field",
      rate: Number(body.rate) || 0,
      userId: body.userId || null,
    };
  });
  crudUpdate("crew");
  crudDelete("crew");

  // Schedule
  crudList("schedule");
  crudCreate("schedule", (_req, body) => ({
    id: uid("s"),
    jobId: body.jobId,
    date: body.date,
    crewId: body.crewId,
    note: body.note || "",
  }));
  crudUpdate("schedule");
  crudDelete("schedule");

  // Reports
  crudList("reports");
  crudCreate("reports", (req, body) => ({
    id: uid("r"),
    jobId: body.jobId,
    number: nextNumber(req.company, "dr", "DR"),
    date: body.date || seed.todayLocal(),
    weather: body.weather || "",
    workDone: body.workDone || "",
    issues: body.issues || "",
    status: body.status || "draft",
    by: body.by || req.session.name,
  }));
  crudUpdate("reports");
  crudDelete("reports");

  // Changes (COs) — audit on approve/reject/money
  crudList("changes");
  crudCreate("changes", (req, body) => {
    const item = {
      id: uid("co"),
      jobId: body.jobId,
      number: nextNumber(req.company, "co", "CO"),
      title: String(body.title || "").trim(),
      amount: Number(body.amount) || 0,
      status: body.status || "open",
      description: body.description || "",
    };
    audit(req, "co.created", item.number, item.title + " · $" + item.amount);
    return item;
  });
  crudUpdate("changes", (req, prev, next) => {
    if (req.session.role === "field") return { status: 403, error: "Forbidden" };
    if (prev.status !== next.status) {
      if (next.status === "approved") {
        audit(req, "co.approved", next.number, next.title + " · $" + next.amount);
        notify(req.session.companyId, null, "co_approved", next.number + " approved", next.title + " · $" + next.amount);
      } else if (next.status === "rejected") {
        audit(req, "co.rejected", next.number, next.title);
      }
    }
    if (Number(prev.amount) !== Number(next.amount)) {
      audit(req, "co.amount", next.number, "Amount " + prev.amount + " → " + next.amount);
    }
    return null;
  });
  crudDelete("changes");

  // Time
  crudList("time");
  crudCreate("time", (req, body) => {
    const crew = req.company.crew.find((c) => c.id === body.crewId);
    return {
      id: uid("t"),
      jobId: body.jobId,
      crewId: body.crewId,
      date: body.date || seed.todayLocal(),
      hours: Number(body.hours) || 0,
      rate: Number(body.rate != null ? body.rate : crew?.rate) || 0,
      note: body.note || "",
    };
  });
  crudUpdate("time");
  crudDelete("time");

  // Photos
  crudList("photos");
  crudCreate("photos", (_req, body) => ({
    id: uid("p"),
    jobId: body.jobId,
    caption: body.caption || "",
    url: body.url || null,
    created: body.created || seed.todayLocal(),
  }));
  crudUpdate("photos");
  crudDelete("photos");

  // Equipment
  crudList("equipment");
  crudCreate("equipment", (_req, body) => ({
    id: uid("e"),
    jobId: body.jobId || null,
    name: String(body.name || "").trim(),
    status: body.status || "in",
    notes: body.notes || "",
  }));
  crudUpdate("equipment");
  crudDelete("equipment");

  // Invoices — audit money actions
  crudList("invoices");
  crudCreate("invoices", (req, body) => {
    if (req.session.role === "field") {
      const e = new Error("Forbidden");
      e.status = 403;
      throw e;
    }
    const item = {
      id: uid("i"),
      jobId: body.jobId,
      number: nextNumber(req.company, "inv", "INV"),
      amount: Number(body.amount) || 0,
      status: body.status || "draft",
      due: body.due || null,
      description: body.description || "",
    };
    audit(req, "invoice.created", item.number, "Draft · $" + item.amount);
    return item;
  });
  crudUpdate("invoices", (req, prev, next) => {
    if (req.session.role === "field") return { status: 403, error: "Forbidden" };
    if (prev.status !== next.status) {
      audit(req, "invoice." + next.status, next.number, next.number + " · $" + next.amount);
      if (next.status === "sent") {
        notify(
          req.session.companyId,
          null,
          "invoice_due",
          "Invoice " + next.number + " sent",
          "Due " + (next.due || "—") + " · $" + next.amount
        );
      }
    }
    if (Number(prev.amount) !== Number(next.amount)) {
      audit(req, "invoice.amount", next.number, "Amount " + prev.amount + " → " + next.amount);
    }
    return null;
  });
  crudDelete("invoices");

  // Safety toolbox talks
  crudList("safety");
  crudCreate("safety", (req, body) => ({
    id: uid("talk"),
    number: nextNumber(req.company, "talk", "TT"),
    jobId: body.jobId || null,
    date: body.date || seed.todayLocal(),
    topic: String(body.topic || "").trim(),
    attendees: Array.isArray(body.attendees) ? body.attendees : String(body.attendees || "").split(",").map((s) => s.trim()).filter(Boolean),
    notes: body.notes || "",
    by: body.by || req.session.name,
  }));
  crudUpdate("safety");
  crudDelete("safety");

  // Materials / POs
  crudList("materials");
  crudCreate("materials", (req, body) => {
    if (req.session.role === "field") {
      const e = new Error("Forbidden");
      e.status = 403;
      throw e;
    }
    return {
      id: uid("po"),
      number: nextNumber(req.company, "po", "PO"),
      jobId: body.jobId || null,
      vendor: String(body.vendor || "").trim(),
      status: body.status || "draft",
      amount: Number(body.amount) || 0,
      items: body.items || "",
      date: body.date || seed.todayLocal(),
      due: body.due || null,
    };
  });
  crudUpdate("materials");
  crudDelete("materials");

  // Subcontractors
  crudList("subcontractors");
  crudCreate("subcontractors", (req, body) => {
    if (req.session.role === "field") {
      const e = new Error("Forbidden");
      e.status = 403;
      throw e;
    }
    return {
      id: uid("sub"),
      name: String(body.name || "").trim(),
      trade: body.trade || "",
      contact: body.contact || "",
      phone: body.phone || "",
      email: body.email || "",
      status: body.status || "active",
      cois: !!body.cois,
      notes: body.notes || "",
    };
  });
  crudUpdate("subcontractors");
  crudDelete("subcontractors");

  // Assign schedule → notify
  app.post("/api/schedule/:id/notify", requireAuth, loadCompany, (req, res) => {
    const item = req.company.schedule.find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    const crew = req.company.crew.find((c) => c.id === item.crewId);
    const job = req.company.jobs.find((j) => j.id === item.jobId);
    if (crew?.userId) {
      notify(
        req.session.companyId,
        crew.userId,
        "job_assigned",
        "Assigned to " + (job?.name || "job"),
        (item.note || "Shift") + " — " + item.date
      );
    }
    res.json({ ok: true });
  });

  // Uploads
  app.post("/api/uploads", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const url = "/uploads/" + req.file.filename;
    res.status(201).json({
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  });

  // Audit
  app.get("/api/audit", requireAuth, (req, res) => {
    if (req.session.role === "field") return res.status(403).json({ error: "Forbidden" });
    res.json(store.getAudit(req.session.companyId, Number(req.query.limit) || 200));
  });

  // Notifications
  app.get("/api/notifications", requireAuth, (req, res) => {
    const list = store.getNotifications(req.session.companyId, req.session.userId);
    res.json({ items: list, unread: list.filter((n) => !n.read).length });
  });

  app.post("/api/notifications/:id/read", requireAuth, (req, res) => {
    const all = store.read("notifications", []);
    const n = all.find((x) => x.id === req.params.id && x.companyId === req.session.companyId);
    if (!n) return res.status(404).json({ error: "Not found" });
    n.read = true;
    store.saveNotifications(all);
    res.json(n);
  });

  app.post("/api/notifications/read-all", requireAuth, (req, res) => {
    const all = store.read("notifications", []);
    all.forEach((n) => {
      if (n.companyId === req.session.companyId && (!n.userId || n.userId === req.session.userId)) {
        n.read = true;
      }
    });
    store.saveNotifications(all);
    res.json({ ok: true });
  });

  // CSV exports
  app.get("/api/export/time.csv", requireAuth, loadCompany, (req, res) => {
    const crewName = (id) => req.company.crew.find((c) => c.id === id)?.name || id;
    const jobName = (id) => req.company.jobs.find((j) => j.id === id)?.name || id;
    const rows = req.company.time.map((t) => ({
      date: t.date,
      job: jobName(t.jobId),
      crew: crewName(t.crewId),
      hours: t.hours,
      rate: t.rate,
      amount: (Number(t.hours) * Number(t.rate)).toFixed(2),
      note: t.note || "",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="time.csv"');
    res.send(toCsv(rows, ["date", "job", "crew", "hours", "rate", "amount", "note"]));
  });

  app.get("/api/export/invoices.csv", requireAuth, loadCompany, (req, res) => {
    if (req.session.role === "field") return res.status(403).json({ error: "Forbidden" });
    const jobName = (id) => req.company.jobs.find((j) => j.id === id)?.name || id;
    const rows = req.company.invoices.map((inv) => ({
      number: inv.number,
      job: jobName(inv.jobId),
      amount: inv.amount,
      status: inv.status,
      due: inv.due || "",
      description: inv.description || "",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices.csv"');
    res.send(toCsv(rows, ["number", "job", "amount", "status", "due", "description"]));
  });

  app.get("/api/export/jobs.csv", requireAuth, loadCompany, (req, res) => {
    const rows = req.company.jobs.map((j) => ({
      name: j.name,
      client: j.client,
      address: j.address,
      status: j.status,
      portalCode: j.portalCode,
      start: j.start || "",
      end: j.end || "",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="jobs.csv"');
    res.send(toCsv(rows, ["name", "client", "address", "status", "portalCode", "start", "end"]));
  });

  // Portal (share code)
  app.post("/api/portal/login", (req, res) => {
    const code = String(req.body.code || "")
      .trim()
      .toUpperCase();
    const companies = store.listCompanies();
    let found = null;
    let companyId = null;
    Object.values(companies).forEach((co) => {
      (co.jobs || []).forEach((j) => {
        if (j.portalCode === code) {
          found = j;
          companyId = co.id;
        }
      });
    });
    if (!found) return res.status(401).json({ error: "Invalid portal code" });
    const co = store.getCompany(companyId);
    const photos = (co.photos || []).filter((p) => p.jobId === found.id);
    const changes = (co.changes || []).filter((c) => c.jobId === found.id);
    const invoices = (co.invoices || [])
      .filter((i) => i.jobId === found.id && i.status !== "draft")
      .map((i) => ({ number: i.number, amount: i.amount, status: i.status, due: i.due, description: i.description }));
    res.json({
      job: {
        id: found.id,
        name: found.name,
        client: found.client,
        address: found.address,
        status: found.status,
        start: found.start,
        end: found.end,
      },
      companyName: co.name,
      photos,
      changes: changes.map((c) => ({
        number: c.number,
        title: c.title,
        amount: c.amount,
        status: c.status,
        description: c.description,
      })),
      invoices,
    });
  });

  // Stripe stubs — no live charges
  app.get("/api/stripe/config", requireAuth, (_req, res) => {
    res.json({
      stub: true,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      message: "Stripe is stubbed. Set STRIPE_SECRET_KEY in .env — no live charges in this build.",
    });
  });

  app.post("/api/stripe/checkout-session", requireAuth, requireRole("owner"), (req, res) => {
    const plan = PLANS[req.body.plan] || PLANS.crew;
    res.json({
      stub: true,
      id: "cs_test_stub_" + uid("stripe"),
      url: null,
      plan: req.body.plan || "crew",
      amount: plan.price * 100,
      currency: "usd",
      message: "Checkout stub only — no Stripe charge created.",
    });
  });

  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (_req, res) => {
    res.json({ stub: true, received: true });
  });

  // Health
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, name: "siteflow-next", port: PORT });
  });

  // Error handler for thrown errors in create hooks
  app.use((err, _req, res, _next) => {
    if (err && err.status) return res.status(err.status).json({ error: err.message || err.error || "Error" });
    if (err && err.name === "MulterError") return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  });

  // Static frontend
  const pub = path.join(__dirname, "public");
  app.use(express.static(pub));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(path.join(pub, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log("SiteFlow listening on http://localhost:" + PORT);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
