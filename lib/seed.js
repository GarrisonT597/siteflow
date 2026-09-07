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
    invoices: [],
    safety: [],
    materials: [],
    subcontractors: [],
  };
}

async function seedIfNeeded(force) {
  store.ensureDirs();
  const meta = store.getMeta();
  const users = store.getUsers();
  if (!force && meta.seeded && users.length) return { seeded: false };

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
      role: "field",
      companyId: co1,
      crewId: crewMarcus,
      permissions: auth.defaultPermissions("field"),
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
  c1.counters = { dr: 3, co: 2, inv: 2, po: 3, talk: 3 };
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
    { id: uid("p"), jobId: job1, caption: "North forms set — ready for pour", url: null, created: addDays(mon, -1) },
    { id: uid("p"), jobId: job1, caption: "Rebar cages A1–A4", url: null, created: today },
    { id: uid("p"), jobId: job2, caption: "Punch items marked at railing", url: null, created: addDays(mon, -2) },
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
    { id: uid("p"), jobId: job3, caption: "Suite 200 after soft demo", url: null, created: addDays(mon, -1) },
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
      companyId: co2,
      userId: alexId,
      type: "job_assigned",
      title: "Summit walk scheduled",
      body: "Owner walk " + addDays(mon, 1),
      read: false,
      created: nowIso,
    },
  ]);
  store.setMeta({ seeded: true, seededAt: nowIso, version: 2 });
  return { seeded: true, companies: [co1, co2] };
}

module.exports = { seedIfNeeded, emptyCompany, uid, todayLocal, addDays, weekStart };
