"use strict";

const path = require("path");
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
  "equipmentHours",
  "invoices",
  "safety",
  "materials",
  "subcontractors",
];

/** Collections foreman may create */
const FOREMAN_CREATE = new Set(["reports", "time", "photos", "safety", "equipmentHours", "changes"]);

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
  return seed.enrichCompany ? seed.enrichCompany(co) : co;
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

function hoursFromRange(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

function uniquePortalCode(company, preferred) {
  const used = new Set(
    (company.jobs || []).map((j) => String(j.portalCode || "").toUpperCase()).filter(Boolean)
  );
  let code = String(preferred || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
  if (code && !used.has(code)) return code;
  for (let i = 0; i < 40; i++) {
    const candidate = uid("PORT").toUpperCase().replace(/-/g, "").slice(0, 9);
    if (!used.has(candidate)) return candidate;
  }
  return "P-" + Date.now().toString(36).toUpperCase();
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

function roleOf(req) {
  return auth.normalizeRole(req.session && req.session.role);
}

function parseCrewOnSite(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  store.ensureDirs();
  await seed.seedIfNeeded(false);
  auth.migrateUserRoles();
  if (seed.upgradeCompaniesToV3) seed.upgradeCompaniesToV3();

  // Migrate crew roles field → foreman in company data
  const companies = store.listCompanies();
  let coChanged = false;
  Object.keys(companies).forEach((id) => {
    const co = ensureCompanyShape(companies[id]);
    co.crew.forEach((c) => {
      if (c.role === "field") {
        c.role = "foreman";
        coChanged = true;
      }
    });
    co.changes.forEach((ch) => {
      if (ch.status === "open") {
        ch.status = "submitted";
        coChanged = true;
      }
    });
    companies[id] = co;
  });
  if (coChanged) store.write("companies", companies);

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
      const r = roleOf(req);
      if (!req.session || !roles.includes(r)) {
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
    // normalize stored role
    if (user.role === "field") {
      user.role = "foreman";
      user.permissions = auth.defaultPermissions("foreman");
      const users = store.getUsers();
      const i = users.findIndex((u) => u.id === user.id);
      if (i >= 0) {
        users[i] = user;
        store.saveUsers(users);
      }
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
    company.crew = [
      {
        id: crewId,
        name,
        role: "owner",
        rate: 75,
        userId,
        phone: "",
        active: true,
        available: true,
      },
    ];
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

  // ---------- Bootstrap ----------
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
      data: Object.fromEntries(COLLECTIONS.map((k) => [k, req.company[k] || []])),
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

  // ---------- Generic CRUD ----------
  function crudList(collection) {
    app.get("/api/" + collection, requireAuth, loadCompany, (req, res) => {
      let items = req.company[collection] || [];
      if (req.query.jobId) items = items.filter((x) => x.jobId === req.query.jobId);
      if (req.query.crewId) items = items.filter((x) => x.crewId === req.query.crewId);
      if (req.query.equipmentId) items = items.filter((x) => x.equipmentId === req.query.equipmentId);
      // Foreman sees all time/equipmentHours for transparency on assigned jobs, but UI filters
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
      const role = roleOf(req);
      if (role === "foreman" && !FOREMAN_CREATE.has(collection)) {
        return res.status(403).json({ error: "Foreman cannot create " + collection });
      }
      try {
        const item = prepare ? prepare(req, req.body) : { ...req.body, id: uid(collection.slice(0, 1)) };
        if (!item.id) item.id = uid(collection.slice(0, 3));
        req.company[collection].push(item);
        store.saveCompany(req.company);
        res.status(201).json(item);
      } catch (err) {
        const status = err.status || 400;
        return res.status(status).json({ error: err.message || err.error || "Error" });
      }
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
      const role = roleOf(req);
      if (collection === "jobs" && !auth.canDeleteJobs(req.session)) {
        return res.status(403).json({ error: "Only owner can delete jobs" });
      }
      if (collection === "crew" && !auth.canDeleteCrew(req.session)) {
        return res.status(403).json({ error: "Only owner can delete crew" });
      }
      if (role === "foreman") {
        // Foreman may delete own pending time / own draft reports / own photos / own equipment hours
        const item = (req.company[collection] || []).find((x) => x.id === req.params.id);
        if (!item) return res.status(404).json({ error: "Not found" });
        if (collection === "time") {
          if (item.crewId !== req.session.crewId || item.status === "approved") {
            return res.status(403).json({ error: "Forbidden" });
          }
        } else if (collection === "reports") {
          if (item.by !== req.session.name || item.status !== "draft") {
            return res.status(403).json({ error: "Forbidden" });
          }
        } else if (collection === "photos" || collection === "equipmentHours") {
          // allow
        } else {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const before = req.company[collection].length;
      req.company[collection] = req.company[collection].filter((x) => x.id !== req.params.id);
      if (req.company[collection].length === before) return res.status(404).json({ error: "Not found" });

      if (collection === "jobs") {
        const jid = req.params.id;
        [
          "schedule",
          "reports",
          "changes",
          "time",
          "photos",
          "equipment",
          "equipmentHours",
          "invoices",
          "safety",
          "materials",
        ].forEach((k) => {
          req.company[k] = (req.company[k] || []).filter((x) => x.jobId !== jid);
        });
      }
      if (collection === "crew") {
        const cid = req.params.id;
        req.company.schedule = (req.company.schedule || []).filter((x) => x.crewId !== cid);
        req.company.time = (req.company.time || []).filter((x) => x.crewId !== cid);
      }
      if (collection === "equipment") {
        const eid = req.params.id;
        req.company.equipmentHours = (req.company.equipmentHours || []).filter((x) => x.equipmentId !== eid);
      }
      store.saveCompany(req.company);
      res.json({ ok: true });
    });
  }

  // Jobs
  crudList("jobs");
  crudGet("jobs");
  crudCreate("jobs", (req, body) => {
    if (roleOf(req) === "foreman") {
      const e = new Error("Foreman cannot create jobs");
      e.status = 403;
      throw e;
    }
    return {
      id: uid("j"),
      name: String(body.name || "Untitled job").trim(),
      client: String(body.client || "").trim(),
      address: String(body.address || "").trim(),
      status: body.status || "active",
      portalCode: uniquePortalCode(req.company, body.portalCode),
      start: body.start || null,
      end: body.end || null,
    };
  });
  crudUpdate("jobs", (req) => {
    if (roleOf(req) === "foreman") return { status: 403, error: "Forbidden" };
    return null;
  });
  crudDelete("jobs");

  // Crew
  crudList("crew");
  crudGet("crew");
  crudCreate("crew", (req, body) => {
    if (roleOf(req) === "foreman") {
      const e = new Error("Forbidden");
      e.status = 403;
      throw e;
    }
    const plan = PLANS[req.company.plan] || PLANS.crew;
    if (req.company.crew.length >= plan.crewCap) {
      const err = new Error("Crew cap reached for plan");
      err.status = 400;
      throw err;
    }
    let role = auth.normalizeRole(body.role || "foreman");
    if (role === "owner" && roleOf(req) !== "owner") role = "foreman";
    return {
      id: uid("c"),
      name: String(body.name || "").trim(),
      role,
      rate: Number(body.rate) || 0,
      userId: body.userId || null,
      phone: String(body.phone || "").trim(),
      active: body.active !== false,
      available: body.available !== false,
    };
  });
  crudUpdate("crew", (req, prev, next) => {
    if (roleOf(req) === "foreman") return { status: 403, error: "Forbidden" };
    next.role = auth.normalizeRole(next.role || prev.role);
    next.phone = next.phone != null ? String(next.phone) : prev.phone || "";
    next.active = next.active !== false;
    next.available = next.available !== false;
    next.rate = Number(next.rate) || 0;
    return null;
  });
  crudDelete("crew");

  // Schedule
  crudList("schedule");
  crudCreate("schedule", (req, body) => {
    if (roleOf(req) === "foreman") {
      const e = new Error("Foreman cannot assign schedule");
      e.status = 403;
      throw e;
    }
    return {
      id: uid("s"),
      jobId: body.jobId,
      date: body.date || seed.todayLocal(),
      crewId: body.crewId,
      note: body.note || "",
    };
  });
  crudUpdate("schedule", (req) => {
    if (roleOf(req) === "foreman") return { status: 403, error: "Forbidden" };
    return null;
  });
  crudDelete("schedule");

  // Reports — draft / submit / approve
  crudList("reports");
  crudCreate("reports", (req, body) => {
    const status = body.status === "submitted" ? "submitted" : "draft";
    const item = {
      id: uid("r"),
      jobId: body.jobId,
      number: nextNumber(req.company, "dr", "DR"),
      date: body.date || seed.todayLocal(),
      weather: body.weather || "",
      workDone: body.workDone || "",
      issues: body.issues || "",
      materialsUsed: body.materialsUsed || "",
      delays: body.delays || "",
      crewOnSite: parseCrewOnSite(body.crewOnSite),
      photoIds: Array.isArray(body.photoIds) ? body.photoIds : [],
      status,
      by: body.by || req.session.name,
      submittedAt: status === "submitted" ? new Date().toISOString() : null,
      approvedBy: null,
      approvedAt: null,
    };
    audit(req, "report.created", item.number, item.status + " · " + (item.workDone || "").slice(0, 60));
    if (status === "submitted") {
      notify(req.session.companyId, null, "report_submitted", item.number + " submitted", "Daily report ready for review");
    }
    return item;
  });
  crudUpdate("reports", (req, prev, next) => {
    const role = roleOf(req);
    // Foreman: only own draft → submit or edit draft
    if (role === "foreman") {
      if (prev.by !== req.session.name) return { status: 403, error: "Not your report" };
      if (prev.status === "approved") return { status: 403, error: "Already approved" };
      if (next.status === "approved" || next.status === "rejected") {
        return { status: 403, error: "Foreman cannot approve reports" };
      }
      if (prev.status === "submitted" && next.status === "draft") {
        // allow retract? no — keep submitted unless office
        return { status: 403, error: "Already submitted" };
      }
      if (next.status === "submitted" && prev.status === "draft") {
        next.submittedAt = new Date().toISOString();
        audit(req, "report.submitted", next.number, next.date);
        notify(req.session.companyId, null, "report_submitted", next.number + " submitted", "Daily report ready for review");
      }
      next.crewOnSite = parseCrewOnSite(next.crewOnSite);
      return null;
    }
    // Office/owner approve
    if (prev.status !== next.status) {
      if (next.status === "submitted" && prev.status === "draft") {
        next.submittedAt = new Date().toISOString();
        audit(req, "report.submitted", next.number, next.date);
      }
      if (next.status === "approved") {
        next.approvedBy = req.session.name;
        next.approvedAt = new Date().toISOString();
        audit(req, "report.approved", next.number, next.date);
        notify(req.session.companyId, null, "report_approved", next.number + " approved", "Daily report approved");
      }
      if (next.status === "draft" && prev.status === "submitted") {
        // office can send back
        next.submittedAt = null;
      }
    }
    next.crewOnSite = parseCrewOnSite(next.crewOnSite);
    return null;
  });
  crudDelete("reports");

  // Changes (COs) — draft → submitted → approved/rejected
  crudList("changes");
  crudCreate("changes", (req, body) => {
    const role = roleOf(req);
    let status = body.status || "draft";
    if (role === "foreman") {
      // Foreman can only draft (or submit draft)
      if (status !== "draft" && status !== "submitted") status = "draft";
    }
    if (status === "open") status = "submitted";
    const item = {
      id: uid("co"),
      jobId: body.jobId,
      number: nextNumber(req.company, "co", "CO"),
      title: String(body.title || "").trim(),
      amount: Number(body.amount) || 0,
      status,
      description: body.description || "",
      by: body.by || req.session.name,
      createdAt: new Date().toISOString(),
    };
    audit(req, "co.created", item.number, item.title + " · $" + item.amount + " · " + item.status);
    return item;
  });
  crudUpdate("changes", (req, prev, next) => {
    const role = roleOf(req);
    if (next.status === "open") next.status = "submitted";
    if (role === "foreman") {
      if (prev.by && prev.by !== req.session.name && prev.status !== "draft") {
        return { status: 403, error: "Forbidden" };
      }
      // Foreman may edit draft / submit own draft
      if (prev.status !== "draft" && prev.status !== "submitted") {
        return { status: 403, error: "Cannot edit approved/rejected CO" };
      }
      if (next.status === "approved" || next.status === "rejected") {
        return { status: 403, error: "Foreman cannot approve COs" };
      }
      if (prev.status === "draft" && next.status === "submitted") {
        audit(req, "co.submitted", next.number, next.title);
        notify(req.session.companyId, null, "co_submitted", next.number + " submitted", next.title + " · $" + next.amount);
      }
      return null;
    }
    if (prev.status !== next.status) {
      if (next.status === "approved") {
        audit(req, "co.approved", next.number, next.title + " · $" + next.amount);
        notify(req.session.companyId, null, "co_approved", next.number + " approved", next.title + " · $" + next.amount);
      } else if (next.status === "rejected") {
        audit(req, "co.rejected", next.number, next.title);
      } else if (next.status === "submitted") {
        audit(req, "co.submitted", next.number, next.title);
      }
    }
    if (Number(prev.amount) !== Number(next.amount)) {
      audit(req, "co.amount", next.number, "Amount " + prev.amount + " → " + next.amount);
    }
    return null;
  });
  crudDelete("changes");

  // Time — hours / start-end / approve
  crudList("time");
  crudCreate("time", (req, body) => {
    const role = roleOf(req);
    let crewId = body.crewId;
    if (role === "foreman") {
      // Post own time (or allow posting for others? "own crew / assigned jobs" — own person)
      crewId = req.session.crewId || crewId;
      if (body.crewId && body.crewId !== req.session.crewId) {
        const e = new Error("Foreman can only post own time");
        e.status = 403;
        throw e;
      }
    }
    const crew = req.company.crew.find((c) => c.id === crewId);
    let hours = Number(body.hours);
    if ((!hours || hours <= 0) && body.start && body.end) {
      hours = hoursFromRange(body.start, body.end) || 0;
    }
    hours = Number(hours) || 0;
    const item = {
      id: uid("t"),
      jobId: body.jobId,
      crewId,
      date: body.date || seed.todayLocal(),
      hours,
      start: body.start || null,
      end: body.end || null,
      rate: Number(body.rate != null ? body.rate : crew?.rate) || 0,
      note: body.note || "",
      status: body.status === "approved" && auth.canApprove(req.session) ? "approved" : "pending",
      clockedInAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectedReason: null,
    };
    if (item.status === "approved") {
      item.approvedBy = req.session.name;
      item.approvedAt = new Date().toISOString();
    }
    return item;
  });
  crudUpdate("time", (req, prev, next) => {
    const role = roleOf(req);
    if (role === "foreman") {
      if (prev.crewId !== req.session.crewId) return { status: 403, error: "Not your time entry" };
      if (prev.status === "approved") return { status: 403, error: "Already approved" };
      if (next.status === "approved" || next.status === "rejected") {
        return { status: 403, error: "Cannot approve time" };
      }
      if (next.start && next.end) {
        const h = hoursFromRange(next.start, next.end);
        if (h != null) next.hours = h;
      }
      next.status = "pending";
      return null;
    }
    if (prev.status !== next.status) {
      if (next.status === "approved") {
        next.approvedBy = req.session.name;
        next.approvedAt = new Date().toISOString();
        audit(req, "time.approved", next.id, crewName(req, next.crewId) + " · " + next.hours + "h · " + next.date);
        const crew = req.company.crew.find((c) => c.id === next.crewId);
        if (crew?.userId) {
          notify(req.session.companyId, crew.userId, "time_approved", "Time approved", next.date + " · " + next.hours + "h");
        }
      } else if (next.status === "rejected") {
        next.approvedBy = req.session.name;
        next.approvedAt = new Date().toISOString();
        audit(req, "time.rejected", next.id, next.date + " · " + (next.rejectedReason || ""));
      }
    }
    if (next.start && next.end && !req.body.hours) {
      const h = hoursFromRange(next.start, next.end);
      if (h != null) next.hours = h;
    }
    return null;
  });
  crudDelete("time");

  function crewName(req, crewId) {
    return (req.company.crew || []).find((c) => c.id === crewId)?.name || crewId;
  }

  // Clock in / out
  app.post("/api/time/clock-in", requireAuth, loadCompany, (req, res) => {
    const role = roleOf(req);
    const crewId = role === "foreman" ? req.session.crewId : req.body.crewId || req.session.crewId;
    if (!crewId) return res.status(400).json({ error: "No crew member linked" });
    const open = (req.company.time || []).find(
      (t) => t.crewId === crewId && t.clockedInAt && !t.end && t.status !== "rejected"
    );
    if (open) return res.status(409).json({ error: "Already clocked in", entry: open });
    const crew = req.company.crew.find((c) => c.id === crewId);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const item = {
      id: uid("t"),
      jobId: req.body.jobId || null,
      crewId,
      date: seed.todayLocal(),
      hours: 0,
      start: hh + ":" + mm,
      end: null,
      rate: Number(crew?.rate) || 0,
      note: req.body.note || "Clock-in",
      status: "pending",
      clockedInAt: now.toISOString(),
      approvedBy: null,
      approvedAt: null,
    };
    req.company.time.push(item);
    store.saveCompany(req.company);
    res.status(201).json(item);
  });

  app.post("/api/time/clock-out", requireAuth, loadCompany, (req, res) => {
    const role = roleOf(req);
    const crewId = role === "foreman" ? req.session.crewId : req.body.crewId || req.session.crewId;
    const open = (req.company.time || []).find(
      (t) => t.crewId === crewId && t.clockedInAt && !t.end
    );
    if (!open) return res.status(404).json({ error: "No open clock-in" });
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    open.end = hh + ":" + mm;
    open.hours = hoursFromRange(open.start, open.end) || 0;
    open.clockedInAt = open.clockedInAt; // keep
    open.note = open.note && open.note !== "Clock-in" ? open.note : "Clocked shift";
    if (req.body.jobId) open.jobId = req.body.jobId;
    store.saveCompany(req.company);
    res.json(open);
  });

  // Weekly timesheet summary
  app.get("/api/time/timesheet", requireAuth, loadCompany, (req, res) => {
    const week = req.query.week || seed.weekStart(seed.todayLocal());
    const end = seed.addDays(week, 6);
    let entries = (req.company.time || []).filter((t) => t.date >= week && t.date <= end);
    if (roleOf(req) === "foreman" && req.session.crewId) {
      entries = entries.filter((t) => t.crewId === req.session.crewId);
    }
    if (req.query.crewId) entries = entries.filter((t) => t.crewId === req.query.crewId);
    if (req.query.jobId) entries = entries.filter((t) => t.jobId === req.query.jobId);

    const byCrew = {};
    entries.forEach((t) => {
      if (!byCrew[t.crewId]) {
        byCrew[t.crewId] = {
          crewId: t.crewId,
          name: crewName(req, t.crewId),
          rate: Number(t.rate) || 0,
          hours: 0,
          approvedHours: 0,
          pendingHours: 0,
          labor: 0,
          entries: [],
        };
      }
      const row = byCrew[t.crewId];
      const h = Number(t.hours) || 0;
      row.hours += h;
      if (t.status === "approved") row.approvedHours += h;
      if (t.status === "pending") row.pendingHours += h;
      row.labor += h * (Number(t.rate) || row.rate || 0);
      row.entries.push(t);
    });
    const members = Object.values(byCrew).map((m) => ({
      ...m,
      ot: Math.max(0, m.hours - 40),
      regular: Math.min(m.hours, 40),
    }));
    const totals = members.reduce(
      (a, m) => ({
        hours: a.hours + m.hours,
        ot: a.ot + m.ot,
        labor: a.labor + m.labor,
        pending: a.pending + m.pendingHours,
      }),
      { hours: 0, ot: 0, labor: 0, pending: 0 }
    );
    res.json({ week, end, members, totals, entries });
  });

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

  // Equipment inventory
  crudList("equipment");
  crudCreate("equipment", (req, body) => {
    if (roleOf(req) === "foreman") {
      const e = new Error("Forbidden");
      e.status = 403;
      throw e;
    }
    return {
      id: uid("e"),
      jobId: body.jobId || null,
      name: String(body.name || "").trim(),
      status: body.status || "in",
      notes: body.notes || "",
      meter: body.meter != null && body.meter !== "" ? Number(body.meter) : null,
      lastServiceHours:
        body.lastServiceHours != null && body.lastServiceHours !== ""
          ? Number(body.lastServiceHours)
          : null,
      maintenanceDue: body.maintenanceDue || "",
      maintenanceNote: body.maintenanceNote || "",
    };
  });
  crudUpdate("equipment", (req, prev, next) => {
    if (roleOf(req) === "foreman") {
      // Foreman can update status / job tie / meter while logging use
      next.name = prev.name;
    }
    return null;
  });
  crudDelete("equipment");

  // Equipment hours
  crudList("equipmentHours");
  crudCreate("equipmentHours", (req, body) => {
    const eq = (req.company.equipment || []).find((e) => e.id === body.equipmentId);
    const item = {
      id: uid("eh"),
      equipmentId: body.equipmentId,
      jobId: body.jobId || eq?.jobId || null,
      date: body.date || seed.todayLocal(),
      hours: Number(body.hours) || 0,
      meter: body.meter != null && body.meter !== "" ? Number(body.meter) : null,
      note: body.note || "",
      by: body.by || req.session.name,
      created: new Date().toISOString(),
    };
    if (eq && item.meter != null) {
      eq.meter = item.meter;
    }
    if (eq && body.jobId) eq.jobId = body.jobId;
    return item;
  });
  crudUpdate("equipmentHours", (req, prev, next) => {
    if (roleOf(req) === "foreman" && prev.by && prev.by !== req.session.name) {
      return { status: 403, error: "Forbidden" };
    }
    return null;
  });
  crudDelete("equipmentHours");

  app.get("/api/equipment/utilization", requireAuth, loadCompany, (req, res) => {
    const week = req.query.week || seed.weekStart(seed.todayLocal());
    const end = seed.addDays(week, 6);
    const logs = (req.company.equipmentHours || []).filter((h) => h.date >= week && h.date <= end);
    const byUnit = {};
    (req.company.equipment || []).forEach((e) => {
      byUnit[e.id] = {
        equipmentId: e.id,
        name: e.name,
        status: e.status,
        jobId: e.jobId,
        meter: e.meter,
        lastServiceHours: e.lastServiceHours,
        maintenanceDue: e.maintenanceDue,
        hours: 0,
        logs: [],
      };
    });
    logs.forEach((h) => {
      if (!byUnit[h.equipmentId]) {
        byUnit[h.equipmentId] = {
          equipmentId: h.equipmentId,
          name: "Unknown",
          hours: 0,
          logs: [],
        };
      }
      byUnit[h.equipmentId].hours += Number(h.hours) || 0;
      byUnit[h.equipmentId].logs.push(h);
    });
    res.json({ week, end, units: Object.values(byUnit), totalHours: logs.reduce((a, h) => a + (Number(h.hours) || 0), 0) });
  });

  // Invoices
  crudList("invoices");
  crudCreate("invoices", (req, body) => {
    if (!auth.canMoney(req.session)) {
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
    if (!auth.canMoney(req.session)) return { status: 403, error: "Forbidden" };
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

  // Safety
  crudList("safety");
  crudCreate("safety", (req, body) => ({
    id: uid("talk"),
    number: nextNumber(req.company, "talk", "TT"),
    jobId: body.jobId || null,
    date: body.date || seed.todayLocal(),
    topic: String(body.topic || "").trim(),
    attendees: Array.isArray(body.attendees)
      ? body.attendees
      : String(body.attendees || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
    notes: body.notes || "",
    by: body.by || req.session.name,
  }));
  crudUpdate("safety");
  crudDelete("safety");

  // Materials
  crudList("materials");
  crudCreate("materials", (req, body) => {
    if (!auth.canEdit(req.session)) {
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
  crudUpdate("materials", (req) => {
    if (!auth.canEdit(req.session)) return { status: 403, error: "Forbidden" };
    return null;
  });
  crudDelete("materials");

  // Subs
  crudList("subcontractors");
  crudCreate("subcontractors", (req, body) => {
    if (!auth.canEdit(req.session)) {
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
  crudUpdate("subcontractors", (req) => {
    if (!auth.canEdit(req.session)) return { status: 403, error: "Forbidden" };
    return null;
  });
  crudDelete("subcontractors");

  // Schedule notify
  app.post("/api/schedule/:id/notify", requireAuth, loadCompany, (req, res) => {
    if (!auth.canEdit(req.session)) return res.status(403).json({ error: "Forbidden" });
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

  // Who's where today
  app.get("/api/crew/today", requireAuth, loadCompany, (req, res) => {
    const today = seed.todayLocal();
    const assignments = (req.company.schedule || [])
      .filter((s) => s.date === today)
      .map((s) => ({
        ...s,
        crewName: crewName(req, s.crewId),
        jobName: (req.company.jobs.find((j) => j.id === s.jobId) || {}).name || "—",
      }));
    const roster = (req.company.crew || []).map((c) => ({
      ...c,
      today: assignments.filter((a) => a.crewId === c.id),
    }));
    res.json({ date: today, assignments, roster });
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
    if (!auth.canEdit(req.session)) return res.status(403).json({ error: "Forbidden" });
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
    const cName = (id) => req.company.crew.find((c) => c.id === id)?.name || id;
    const jName = (id) => req.company.jobs.find((j) => j.id === id)?.name || id;
    const rows = req.company.time.map((t) => ({
      date: t.date,
      job: jName(t.jobId),
      crew: cName(t.crewId),
      hours: t.hours,
      start: t.start || "",
      end: t.end || "",
      rate: t.rate,
      amount: (Number(t.hours) * Number(t.rate)).toFixed(2),
      status: t.status || "",
      note: t.note || "",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="time.csv"');
    res.send(toCsv(rows, ["date", "job", "crew", "hours", "start", "end", "rate", "amount", "status", "note"]));
  });

  app.get("/api/export/equipment-hours.csv", requireAuth, loadCompany, (req, res) => {
    const eName = (id) => req.company.equipment.find((e) => e.id === id)?.name || id;
    const jName = (id) => req.company.jobs.find((j) => j.id === id)?.name || id;
    const rows = (req.company.equipmentHours || []).map((h) => ({
      date: h.date,
      equipment: eName(h.equipmentId),
      job: jName(h.jobId),
      hours: h.hours,
      meter: h.meter ?? "",
      by: h.by || "",
      note: h.note || "",
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="equipment-hours.csv"');
    res.send(toCsv(rows, ["date", "equipment", "job", "hours", "meter", "by", "note"]));
  });

  app.get("/api/export/invoices.csv", requireAuth, loadCompany, (req, res) => {
    if (!auth.canMoney(req.session)) return res.status(403).json({ error: "Forbidden" });
    const jName = (id) => req.company.jobs.find((j) => j.id === id)?.name || id;
    const rows = req.company.invoices.map((inv) => ({
      number: inv.number,
      job: jName(inv.jobId),
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

  // Portal
  app.post("/api/portal/login", (req, res) => {
    const code = String(req.body.code || "")
      .trim()
      .toUpperCase();
    const companiesMap = store.listCompanies();
    let found = null;
    let companyId = null;
    Object.values(companiesMap).forEach((co) => {
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
    const reports = (co.reports || [])
      .filter((r) => r.jobId === found.id && (r.status === "submitted" || r.status === "approved"))
      .map((r) => ({
        number: r.number,
        date: r.date,
        weather: r.weather,
        workDone: r.workDone,
        status: r.status,
      }));
    const invoices = (co.invoices || [])
      .filter((i) => i.jobId === found.id && i.status !== "draft")
      .map((i) => ({
        number: i.number,
        amount: i.amount,
        status: i.status,
        due: i.due,
        description: i.description,
      }));
    res.json({
      job: {
        id: found.id,
        name: found.name,
        client: found.client,
        address: found.address,
        status: found.status,
        start: found.start,
        end: found.end,
        portalCode: found.portalCode,
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
      reports,
    });
  });

  // Stripe stubs
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, name: "siteflow-next", port: PORT });
  });

  app.use((err, _req, res, _next) => {
    if (err && err.status) return res.status(err.status).json({ error: err.message || err.error || "Error" });
    if (err && err.name === "MulterError") return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  });

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
