"use strict";

const { v4: uuidv4 } = require("uuid");
const store = require("./store");
const auth = require("./auth");

function uid(p) {
  return p + "-" + uuidv4().slice(0, 8);
}

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

function weekStart(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = (dt.getDay() + 6) % 7;
  return addDays(iso, -day);
}

function emptyCompany(id, name, plan) {
  return {
    id,
    name,
    plan: plan || "crew",
    counters: { dr: 1, co: 1, inv: 1, po: 1, talk: 1 },
    jobs: [],
    crew: [],
    schedule: [],
    reports: [],
    changes: [],
    time: [],
    photos: [],
    equipment: [],
    equipmentHours: [],
    invoices: [],
    safety: [],
    materials: [],
    subcontractors: [],
  };
}

function normalizeCrewMember(c) {
  return {
    ...c,
    phone: c.phone != null ? c.phone : "",
    active: c.active !== false,
    available: c.available !== false,
    rate: Number(c.rate) || 0,
    role: c.role || "foreman",
  };
}

function normalizeEquipment(e) {
  return {
    ...e,
    meter: e.meter != null && e.meter !== "" ? Number(e.meter) : null,
    lastServiceHours:
      e.lastServiceHours != null && e.lastServiceHours !== "" ? Number(e.lastServiceHours) : null,
    maintenanceDue: e.maintenanceDue || "",
    maintenanceNote: e.maintenanceNote || "",
  };
}

function normalizeTime(t) {
  return {
    ...t,
    hours: Number(t.hours) || 0,
    rate: Number(t.rate) || 0,
    start: t.start || null,
    end: t.end || null,
    status: t.status || "approved",
    clockedInAt: t.clockedInAt || null,
    approvedBy: t.approvedBy || null,
    approvedAt: t.approvedAt || null,
    rejectedReason: t.rejectedReason || null,
  };
}

function normalizeReport(r) {
  return {
    ...r,
    weather: r.weather || "",
    workDone: r.workDone || "",
    issues: r.issues || "",
    materialsUsed: r.materialsUsed || "",
    delays: r.delays || "",
    crewOnSite: Array.isArray(r.crewOnSite)
      ? r.crewOnSite
      : String(r.crewOnSite || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
    photoIds: Array.isArray(r.photoIds) ? r.photoIds : [],
    status: r.status || "draft",
    submittedAt: r.submittedAt || null,
    approvedBy: r.approvedBy || null,
    approvedAt: r.approvedAt || null,
  };
}

function enrichCompany(co) {
  if (!co.counters) co.counters = { dr: 1, co: 1, inv: 1, po: 1, talk: 1 };
  [
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
  ].forEach((k) => {
    if (!Array.isArray(co[k])) co[k] = [];
  });
  co.crew = co.crew.map(normalizeCrewMember);
  co.equipment = co.equipment.map(normalizeEquipment);
  co.time = co.time.map(normalizeTime);
  co.reports = co.reports.map(normalizeReport);
  return co;
}

function upgradeCompaniesToV3() {
  const meta = store.getMeta();
  if (meta.version >= 3) {
    // still normalize shapes on boot
    const companies = store.listCompanies();
    let changed = false;
    Object.keys(companies).forEach((id) => {
      const before = JSON.stringify(companies[id]);
      companies[id] = enrichCompany(companies[id]);
      if (JSON.stringify(companies[id]) !== before) changed = true;
    });
    if (changed) store.write("companies", companies);
    return { upgraded: false };
  }

  const companies = store.listCompanies();
  const today = todayLocal();
  const mon = weekStart(today);
  let touched = 0;

  Object.keys(companies).forEach((id) => {
    let co = enrichCompany(companies[id]);
    // If this looks like the O. Edwards demo company, deepen hours data
    const marcus = co.crew.find((c) => /marcus/i.test(c.name));
    const owner = co.crew.find((c) => /garrison|owner/i.test(c.name) || c.role === "owner");
    const priya = co.crew.find((c) => /priya/i.test(c.name));
    const job1 = co.jobs[0];
    const job2 = co.jobs[1];

    if (marcus) {
      marcus.phone = marcus.phone || "555-0103";
      marcus.available = true;
      marcus.active = true;
    }
    if (owner) {
      owner.phone = owner.phone || "555-0101";
      owner.available = true;
      owner.active = true;
    }
    if (priya) {
      priya.phone = priya.phone || "555-0102";
      priya.available = true;
      priya.active = true;
    }
    co.crew.forEach((c) => {
      if (!c.phone) c.phone = "";
      c.active = c.active !== false;
      c.available = c.available !== false;
    });

    // Ensure time entries have status + deepen Marcus week toward OT
    if (marcus && job1 && co.name && /Edwards/i.test(co.name)) {
      const existingMarcus = co.time.filter((t) => t.crewId === marcus.id);
      if (existingMarcus.length < 6) {
        // Add more hours so week totals show OT potential
        const extras = [
          { date: addDays(mon, 0), hours: 10, start: "06:30", end: "17:00", note: "Forms OT", jobId: job1.id },
          { date: addDays(mon, 1), hours: 10, start: "06:30", end: "17:00", note: "Pour OT", jobId: job1.id },
          { date: addDays(mon, 2), hours: 9, start: "07:00", end: "16:30", note: "Strip", jobId: job1.id },
          { date: addDays(mon, 3), hours: 8, start: "07:00", end: "15:30", note: "Punch assist", jobId: (job2 && job2.id) || job1.id },
          { date: addDays(mon, 4), hours: 9, start: "07:00", end: "16:30", note: "Backfill", jobId: job1.id },
        ];
        // Replace thin marcus rows for this week with richer set
        co.time = co.time.filter(
          (t) => !(t.crewId === marcus.id && t.date >= mon && t.date <= addDays(mon, 6))
        );
        extras.forEach((ex) => {
          co.time.push({
            id: uid("t"),
            jobId: ex.jobId,
            crewId: marcus.id,
            date: ex.date,
            hours: ex.hours,
            start: ex.start,
            end: ex.end,
            rate: marcus.rate || 42,
            note: ex.note,
            status: ex.date === addDays(mon, 4) ? "pending" : "approved",
            clockedInAt: null,
            approvedBy: ex.date === addDays(mon, 4) ? null : "priya",
            approvedAt: ex.date === addDays(mon, 4) ? null : new Date().toISOString(),
          });
        });
        if (owner && job1) {
          co.time.push({
            id: uid("t"),
            jobId: job1.id,
            crewId: owner.id,
            date: addDays(mon, 2),
            hours: 4,
            start: "09:00",
            end: "13:00",
            rate: owner.rate || 95,
            note: "QA / inspect",
            status: "approved",
            approvedBy: "owner",
            approvedAt: new Date().toISOString(),
          });
        }
        if (priya && job1) {
          co.time.push({
            id: uid("t"),
            jobId: job1.id,
            crewId: priya.id,
            date: mon,
            hours: 3,
            start: "08:00",
            end: "11:00",
            rate: priya.rate || 55,
            note: "Submittals",
            status: "approved",
            approvedBy: "owner",
            approvedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Equipment maintenance + meters
    co.equipment = co.equipment.map((e, idx) => {
      const base = normalizeEquipment(e);
      if (!base.meter && /boom|skid|generator|pickup/i.test(base.name)) {
        base.meter = 1200 + idx * 340;
      }
      if (!base.lastServiceHours && base.meter) {
        base.lastServiceHours = Math.max(0, base.meter - 80 - idx * 20);
      }
      if (!base.maintenanceDue) {
        if (/generator/i.test(base.name)) base.maintenanceDue = "Oil change at next 50 hrs";
        else if (/boom/i.test(base.name)) base.maintenanceDue = "Annual cert due " + addDays(today, 21);
        else if (/skid/i.test(base.name)) base.maintenanceDue = "Grease pins — overdue";
        else if (/plate/i.test(base.name)) base.maintenanceDue = "Belt check";
      }
      return base;
    });

    // Seed equipment hours if empty
    if (!co.equipmentHours.length && co.equipment.length && job1) {
      const units = co.equipment;
      units.forEach((eq, i) => {
        if (i > 2) return;
        co.equipmentHours.push({
          id: uid("eh"),
          equipmentId: eq.id,
          jobId: eq.jobId || job1.id,
          date: addDays(mon, i % 5),
          hours: 4 + (i % 3) * 2,
          meter: eq.meter != null ? eq.meter + 4 + i : null,
          note: "Runtime on site",
          by: marcus ? marcus.name : "Crew",
          created: new Date().toISOString(),
        });
        co.equipmentHours.push({
          id: uid("eh"),
          equipmentId: eq.id,
          jobId: eq.jobId || job1.id,
          date: addDays(mon, (i + 2) % 5),
          hours: 3 + i,
          meter: eq.meter != null ? eq.meter + 10 + i : null,
          note: i === 0 ? "Form setting" : "General use",
          by: marcus ? marcus.name : "Crew",
          created: new Date().toISOString(),
        });
      });
    }

    // Deepen reports
    co.reports = co.reports.map((r) => {
      const nr = normalizeReport(r);
      if (!nr.crewOnSite.length && marcus) {
        nr.crewOnSite = [marcus.name];
        if (owner && /inspect|QA|pour/i.test(nr.workDone)) nr.crewOnSite.push(owner.name);
      }
      if (!nr.materialsUsed && /form|rebar|pour/i.test(nr.workDone)) {
        nr.materialsUsed = "Form oil, rebar tie wire, vapor barrier";
      }
      if (!nr.delays && /waiting|ETA|delay/i.test(nr.issues)) {
        nr.delays = nr.issues;
      }
      if (nr.status === "submitted" && !nr.submittedAt) nr.submittedAt = new Date().toISOString();
      return nr;
    });

    // Ensure one approved + one draft + one submitted for Edwards
    if (/Edwards/i.test(co.name) && job1 && marcus) {
      const hasApproved = co.reports.some((r) => r.status === "approved");
      if (!hasApproved) {
        const submitted = co.reports.find((r) => r.status === "submitted");
        if (submitted) {
          submitted.status = "approved";
          submitted.approvedBy = "Priya Shah";
          submitted.approvedAt = new Date().toISOString();
        }
      }
    }

    companies[id] = co;
    touched += 1;
  });

  store.write("companies", companies);
  store.setMeta({
    ...meta,
    seeded: true,
    version: 3,
    upgradedAt: new Date().toISOString(),
  });
  return { upgraded: true, companies: touched };
}

async function seedIfNeeded(force) {
  store.ensureDirs();
  const meta = store.getMeta();
  const users = store.getUsers();
  if (!force && meta.seeded && users.length) {
    const up = upgradeCompaniesToV3();
    return { seeded: false, ...up };
  }

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
  const eqBoom = uid("e");
  const eqPlate = uid("e");
  const eqGen = uid("e");
  const eqSkid = uid("e");
  const today = todayLocal();
  const mon = weekStart(today);
  const nowIso = new Date().toISOString();

  const pw = {
    owner: await auth.hashPassword("SiteFlow99"),
    priya: await auth.hashPassword("office123"),
    marcus: await auth.hashPassword("field123"),
    alex: await auth.hashPassword("Ridge99"),
  };

  const userList = [
    {
      id: ownerId,
      username: "owner",
      passwordHash: pw.owner,
      name: "Garrison Owner",
      role: "owner",
      companyId: co1,
      crewId: crewOwner,
      permissions: auth.defaultPermissions("owner"),
    },
    {
      id: officeId,
      username: "priya",
      passwordHash: pw.priya,
      name: "Priya Shah",
      role: "office",
      companyId: co1,
      crewId: crewPriya,
      permissions: auth.defaultPermissions("office"),
    },
    {
      id: fieldId,
      username: "marcus",
      passwordHash: pw.marcus,
      name: "Marcus Reed",
      role: "foreman",
      companyId: co1,
      crewId: crewMarcus,
      permissions: auth.defaultPermissions("foreman"),
    },
    {
      id: alexId,
      username: "alex",
      passwordHash: pw.alex,
      name: "Alex Rivera",
      role: "owner",
      companyId: co2,
      crewId: crewAlex,
      permissions: auth.defaultPermissions("owner"),
    },
  ];

  const c1 = emptyCompany(co1, "O. Edwards Co.", "unlimited");
  c1.counters = { dr: 4, co: 2, inv: 2, po: 3, talk: 3 };
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
    {
      id: crewOwner,
      name: "Garrison Owner",
      role: "owner",
      rate: 95,
      userId: ownerId,
      phone: "555-0101",
      active: true,
      available: true,
    },
    {
      id: crewPriya,
      name: "Priya Shah",
      role: "office",
      rate: 55,
      userId: officeId,
      phone: "555-0102",
      active: true,
      available: true,
    },
    {
      id: crewMarcus,
      name: "Marcus Reed",
      role: "foreman",
      rate: 42,
      userId: fieldId,
      phone: "555-0103",
      active: true,
      available: true,
    },
  ];
  c1.schedule = [
    { id: uid("s"), jobId: job1, date: mon, crewId: crewMarcus, note: "Form walls" },
    { id: uid("s"), jobId: job1, date: addDays(mon, 1), crewId: crewMarcus, note: "Pour slab" },
    { id: uid("s"), jobId: job1, date: addDays(mon, 2), crewId: crewOwner, note: "Inspect rebar" },
    { id: uid("s"), jobId: job2, date: addDays(mon, 3), crewId: crewMarcus, note: "Punch list" },
    { id: uid("s"), jobId: job1, date: addDays(mon, 4), crewId: crewMarcus, note: "Strip forms" },
    { id: uid("s"), jobId: job1, date: today, crewId: crewMarcus, note: "Today — Pad 7" },
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
      materialsUsed: "Form oil, tie wire, #5 rebar",
      delays: "",
      crewOnSite: ["Marcus Reed", "Garrison Owner"],
      photoIds: [],
      status: "approved",
      by: "Marcus Reed",
      submittedAt: addDays(mon, -1) + "T18:00:00.000Z",
      approvedBy: "Priya Shah",
      approvedAt: addDays(mon, -1) + "T19:00:00.000Z",
    },
    {
      id: uid("r"),
      jobId: job1,
      number: "DR-002",
      date: today,
      weather: "Overcast / 68F",
      workDone: "Prep for pour. Verified embeds and vapor barrier.",
      issues: "Waiting on rebar delivery — ETA afternoon",
      materialsUsed: "Vapor barrier, embeds",
      delays: "Rebar delivery late — 2 hrs idle",
      crewOnSite: ["Marcus Reed"],
      photoIds: [],
      status: "draft",
      by: "Marcus Reed",
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
    },
    {
      id: uid("r"),
      jobId: job2,
      number: "DR-003",
      date: addDays(mon, -2),
      weather: "Sunny / 75F",
      workDone: "Walked punch list with parks inspector. Marked railing gaps.",
      issues: "",
      materialsUsed: "Paint touch-up kit",
      delays: "",
      crewOnSite: ["Marcus Reed"],
      photoIds: [],
      status: "submitted",
      by: "Marcus Reed",
      submittedAt: addDays(mon, -2) + "T17:00:00.000Z",
      approvedBy: null,
      approvedAt: null,
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
    {
      id: uid("t"),
      jobId: job1,
      crewId: crewMarcus,
      date: mon,
      hours: 10,
      start: "06:30",
      end: "17:00",
      rate: 42,
      note: "Forms",
      status: "approved",
      approvedBy: "priya",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job1,
      crewId: crewMarcus,
      date: addDays(mon, 1),
      hours: 10,
      start: "06:30",
      end: "17:00",
      rate: 42,
      note: "Pour",
      status: "approved",
      approvedBy: "priya",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job1,
      crewId: crewMarcus,
      date: addDays(mon, 2),
      hours: 9,
      start: "07:00",
      end: "16:30",
      rate: 42,
      note: "Strip",
      status: "approved",
      approvedBy: "priya",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job2,
      crewId: crewMarcus,
      date: addDays(mon, 3),
      hours: 8,
      start: "07:00",
      end: "15:30",
      rate: 42,
      note: "Punch",
      status: "approved",
      approvedBy: "priya",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job1,
      crewId: crewMarcus,
      date: addDays(mon, 4),
      hours: 9,
      start: "07:00",
      end: "16:30",
      rate: 42,
      note: "Backfill",
      status: "pending",
    },
    {
      id: uid("t"),
      jobId: job1,
      crewId: crewOwner,
      date: addDays(mon, 2),
      hours: 4,
      start: "09:00",
      end: "13:00",
      rate: 95,
      note: "QA",
      status: "approved",
      approvedBy: "owner",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job1,
      crewId: crewPriya,
      date: mon,
      hours: 3,
      start: "08:00",
      end: "11:00",
      rate: 55,
      note: "Submittals",
      status: "approved",
      approvedBy: "owner",
      approvedAt: nowIso,
    },
  ];
  c1.photos = [
    { id: uid("p"), jobId: job1, caption: "North forms set — ready for pour", url: null, created: addDays(mon, -1) },
    { id: uid("p"), jobId: job1, caption: "Rebar cages A1–A4", url: null, created: today },
    { id: uid("p"), jobId: job2, caption: "Punch items marked at railing", url: null, created: addDays(mon, -2) },
  ];
  c1.equipment = [
    {
      id: eqBoom,
      jobId: job1,
      name: "Boom lift 40'",
      status: "in",
      notes: "Yard bay 2",
      meter: 1840,
      lastServiceHours: 1760,
      maintenanceDue: "Annual cert due " + addDays(today, 21),
      maintenanceNote: "Schedule inspector",
    },
    {
      id: eqPlate,
      jobId: job1,
      name: "Plate compactor",
      status: "out",
      notes: "On Pad 7",
      meter: 420,
      lastServiceHours: 400,
      maintenanceDue: "Belt check",
      maintenanceNote: "",
    },
    {
      id: eqGen,
      jobId: job2,
      name: "Generator 5kW",
      status: "low",
      notes: "Fuel low",
      meter: 980,
      lastServiceHours: 950,
      maintenanceDue: "Oil change at next 50 hrs",
      maintenanceNote: "Fuel before River Walk",
    },
    {
      id: eqSkid,
      jobId: null,
      name: "Skid steer",
      status: "in",
      notes: "Shared — main yard",
      meter: 3120,
      lastServiceHours: 3000,
      maintenanceDue: "Grease pins — overdue",
      maintenanceNote: "Shop this weekend",
    },
  ];
  c1.equipmentHours = [
    {
      id: uid("eh"),
      equipmentId: eqBoom,
      jobId: job1,
      date: mon,
      hours: 6,
      meter: 1846,
      note: "Form setting",
      by: "Marcus Reed",
      created: nowIso,
    },
    {
      id: uid("eh"),
      equipmentId: eqBoom,
      jobId: job1,
      date: addDays(mon, 1),
      hours: 5,
      meter: 1851,
      note: "Pour support",
      by: "Marcus Reed",
      created: nowIso,
    },
    {
      id: uid("eh"),
      equipmentId: eqPlate,
      jobId: job1,
      date: addDays(mon, 2),
      hours: 4,
      meter: 424,
      note: "Backfill compaction",
      by: "Marcus Reed",
      created: nowIso,
    },
    {
      id: uid("eh"),
      equipmentId: eqGen,
      jobId: job2,
      date: addDays(mon, 3),
      hours: 7,
      meter: 987,
      note: "Punch power",
      by: "Marcus Reed",
      created: nowIso,
    },
    {
      id: uid("eh"),
      equipmentId: eqSkid,
      jobId: job1,
      date: addDays(mon, 4),
      hours: 3,
      meter: 3123,
      note: "Move spoils",
      by: "Marcus Reed",
      created: nowIso,
    },
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
  c1.safety = [
    {
      id: uid("talk"),
      number: "TT-001",
      jobId: job1,
      date: addDays(mon, -2),
      topic: "Fall protection on formwork",
      attendees: ["Marcus Reed", "Garrison Owner"],
      notes: "Reviewed harness inspection and anchor points.",
      by: "Marcus Reed",
    },
    {
      id: uid("talk"),
      number: "TT-002",
      jobId: job1,
      date: today,
      topic: "Concrete pour hazards",
      attendees: ["Marcus Reed"],
      notes: "Eye wash station location confirmed.",
      by: "Marcus Reed",
    },
  ];
  c1.materials = [
    {
      id: uid("po"),
      number: "PO-001",
      jobId: job1,
      vendor: "Metro Rebar Supply",
      status: "ordered",
      amount: 6800,
      items: "Rebar #5 cages A1–A8",
      date: addDays(mon, -3),
      due: addDays(mon, 1),
    },
    {
      id: uid("po"),
      number: "PO-002",
      jobId: job1,
      vendor: "FormTech Rentals",
      status: "received",
      amount: 2100,
      items: "Wall forms 8' — 12 panels",
      date: addDays(mon, -10),
      due: addDays(mon, -5),
    },
  ];
  c1.subcontractors = [
    {
      id: uid("sub"),
      name: "Apex Electrical",
      trade: "Electrical",
      contact: "Dana Cho",
      phone: "555-0142",
      email: "dana@apex-elec.example",
      status: "active",
      cois: true,
      notes: "Pad 7 rough-in week of " + addDays(mon, 14),
    },
    {
      id: uid("sub"),
      name: "Valley Plumbing Co.",
      trade: "Plumbing",
      contact: "Luis Mendez",
      phone: "555-0198",
      email: "luis@valleyplumb.example",
      status: "pending",
      cois: false,
      notes: "Waiting on COI",
    },
  ];

  const c2 = emptyCompany(co2, "Ridge Build LLC", "crew");
  c2.counters = { dr: 2, co: 1, inv: 1, po: 1, talk: 1 };
  const eqDemo = uid("e");
  const eqTruck = uid("e");
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
    {
      id: crewAlex,
      name: "Alex Rivera",
      role: "owner",
      rate: 88,
      userId: alexId,
      phone: "555-0201",
      active: true,
      available: true,
    },
    {
      id: crewSam,
      name: "Sam Ortiz",
      role: "foreman",
      rate: 40,
      userId: null,
      phone: "555-0202",
      active: true,
      available: true,
    },
  ];
  c2.schedule = [
    { id: uid("s"), jobId: job3, date: mon, crewId: crewSam, note: "Demolition" },
    { id: uid("s"), jobId: job3, date: addDays(mon, 1), crewId: crewAlex, note: "Owner walk" },
    { id: uid("s"), jobId: job3, date: addDays(mon, 2), crewId: crewSam, note: "Framing start" },
    { id: uid("s"), jobId: job3, date: today, crewId: crewSam, note: "Today — Summit" },
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
      materialsUsed: "Demo bags, plastic sheeting",
      delays: "Dumpster full — haul pending",
      crewOnSite: ["Sam Ortiz"],
      photoIds: [],
      status: "submitted",
      by: "Sam Ortiz",
      submittedAt: addDays(mon, -1) + "T17:30:00.000Z",
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
    {
      id: uid("t"),
      jobId: job3,
      crewId: crewSam,
      date: mon,
      hours: 8,
      start: "07:00",
      end: "15:30",
      rate: 40,
      note: "Demo",
      status: "approved",
      approvedBy: "alex",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job3,
      crewId: crewAlex,
      date: addDays(mon, 1),
      hours: 3,
      start: "10:00",
      end: "13:00",
      rate: 88,
      note: "Walk",
      status: "approved",
      approvedBy: "alex",
      approvedAt: nowIso,
    },
    {
      id: uid("t"),
      jobId: job3,
      crewId: crewSam,
      date: addDays(mon, 2),
      hours: 8,
      start: "07:00",
      end: "15:30",
      rate: 40,
      note: "Framing",
      status: "pending",
    },
  ];
  c2.photos = [
    { id: uid("p"), jobId: job3, caption: "Suite 200 after soft demo", url: null, created: addDays(mon, -1) },
  ];
  c2.equipment = [
    {
      id: eqDemo,
      jobId: job3,
      name: "Demo hammer",
      status: "out",
      notes: "On site",
      meter: 210,
      lastServiceHours: 200,
      maintenanceDue: "Bit replacement",
      maintenanceNote: "",
    },
    {
      id: eqTruck,
      jobId: null,
      name: "Pickup #3",
      status: "in",
      notes: "Shop",
      meter: 68400,
      lastServiceHours: 68000,
      maintenanceDue: "Oil at 69k",
      maintenanceNote: "",
    },
  ];
  c2.equipmentHours = [
    {
      id: uid("eh"),
      equipmentId: eqDemo,
      jobId: job3,
      date: mon,
      hours: 6,
      meter: 216,
      note: "Soft demo",
      by: "Sam Ortiz",
      created: nowIso,
    },
    {
      id: uid("eh"),
      equipmentId: eqTruck,
      jobId: job3,
      date: addDays(mon, 1),
      hours: 2,
      meter: 68402,
      note: "Haul debris",
      by: "Alex Rivera",
      created: nowIso,
    },
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
  c2.safety = [];
  c2.materials = [];
  c2.subcontractors = [
    {
      id: uid("sub"),
      name: "GlassLine Inc.",
      trade: "Glazing",
      contact: "Kim Park",
      phone: "555-0110",
      email: "kim@glassline.example",
      status: "quoted",
      cois: true,
      notes: "Storefront CO pending",
    },
  ];

  store.write("companies", { [co1]: c1, [co2]: c2 });
  store.saveUsers(userList);
  store.saveSessions({});
  store.write("audit", [
    {
      id: uid("a"),
      companyId: co1,
      at: nowIso,
      actor: "owner",
      action: "co.approved",
      entity: "CO-001",
      detail: "Approved Extra trench drain · $4800",
    },
    {
      id: uid("a"),
      companyId: co1,
      at: nowIso,
      actor: "priya",
      action: "invoice.sent",
      entity: "INV-001",
      detail: "Sent INV-001 · $25000",
    },
    {
      id: uid("a"),
      companyId: co1,
      at: nowIso,
      actor: "priya",
      action: "report.approved",
      entity: "DR-001",
      detail: "Approved daily report DR-001",
    },
  ]);
  store.write("notifications", [
    {
      id: uid("n"),
      companyId: co1,
      userId: fieldId,
      type: "job_assigned",
      title: "Assigned to Pad 7",
      body: "You are on Form walls — " + mon,
      read: false,
      created: nowIso,
    },
    {
      id: uid("n"),
      companyId: co1,
      userId: null,
      type: "co_approved",
      title: "CO-001 approved",
      body: "Extra trench drain · $4,800",
      read: false,
      created: nowIso,
    },
    {
      id: uid("n"),
      companyId: co1,
      userId: officeId,
      type: "invoice_due",
      title: "Invoice due soon",
      body: "INV-001 due " + addDays(today, 14),
      read: false,
      created: nowIso,
    },
    {
      id: uid("n"),
      companyId: co1,
      userId: fieldId,
      type: "time_approved",
      title: "Time approved",
      body: "Your Mon–Thu hours were approved",
      read: false,
      created: nowIso,
    },
    {
      id: uid("n"),
      companyId: co2,
      userId: alexId,
      type: "job_assigned",
      title: "Summit walk scheduled",
      body: "Owner walk " + addDays(mon, 1),
      read: false,
      created: nowIso,
    },
  ]);
  store.setMeta({ seeded: true, seededAt: nowIso, version: 3 });
  return { seeded: true, companies: [co1, co2] };
}

module.exports = {
  seedIfNeeded,
  emptyCompany,
  enrichCompany,
  upgradeCompaniesToV3,
  uid,
  todayLocal,
  addDays,
  weekStart,
};
