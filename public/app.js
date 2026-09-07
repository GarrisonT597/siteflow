/* SiteFlow Next — API-backed multi-tenant construction ops */
(function () {
  "use strict";

  const CACHE_KEY = "siteflow.next.cache.v1";
  const TOKEN_KEY = "siteflow.next.token.v1";
  const PLANS = {
    solo: { name: "Solo", price: 49, crewCap: 1 },
    crew: { name: "Crew", price: 99, crewCap: 5 },
    unlimited: { name: "Unlimited", price: 199, crewCap: 999 },
  };
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const $ = (id) => document.getElementById(id);
  let PICKED = "crew";
  let SESSION = null;
  let COMPANY = null;
  let DB = null;
  let NOTIFS = [];
  let CURRENT_VIEW = "jobs";
  let SELECTED_JOB = null;
  let WEEK_MON = null;
  let OFFLINE = false;
  let TOKEN = localStorage.getItem(TOKEN_KEY) || null;

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
  function weekStart(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = (dt.getDay() + 6) % 7;
    return addDays(iso, -day);
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
  function canEdit() {
    return SESSION && (SESSION.role === "owner" || SESSION.role === "office");
  }
  function isOwner() {
    return SESSION && SESSION.role === "owner";
  }
  function isField() {
    return SESSION && SESSION.role === "field";
  }

  function cacheSave() {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ session: SESSION, company: COMPANY, data: DB, notifs: NOTIFS, at: Date.now() })
      );
    } catch (_) {}
  }
  function cacheLoad() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  async function api(path, opts) {
    const options = opts || {};
    const headers = Object.assign({}, options.headers || {});
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }
    if (TOKEN) headers["X-Session-Token"] = TOKEN;
    const res = await fetch(path, {
      credentials: "include",
      ...options,
      headers,
      body:
        options.body && !(options.body instanceof FormData) && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body,
    });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || "Request failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function bootstrap() {
    try {
      const data = await api("/api/bootstrap");
      SESSION = data.user;
      COMPANY = data.company;
      DB = data.data;
      NOTIFS = data.notifications || [];
      OFFLINE = false;
      cacheSave();
      return true;
    } catch (e) {
      const cached = cacheLoad();
      if (cached && cached.data) {
        SESSION = cached.session;
        COMPANY = cached.company;
        DB = cached.data;
        NOTIFS = cached.notifs || [];
        OFFLINE = true;
        return true;
      }
      throw e;
    }
  }

  async function createItem(collection, body) {
    const item = await api("/api/" + collection, { method: "POST", body });
    DB[collection] = DB[collection] || [];
    DB[collection].push(item);
    cacheSave();
    return item;
  }

  async function updateItem(collection, id, body) {
    const item = await api("/api/" + collection + "/" + id, { method: "PATCH", body });
    const list = DB[collection] || [];
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = item;
    cacheSave();
    return item;
  }

  async function deleteItem(collection, id) {
    await api("/api/" + collection + "/" + id, { method: "DELETE" });
    DB[collection] = (DB[collection] || []).filter((x) => x.id !== id);
    if (collection === "jobs") {
      ["schedule", "reports", "changes", "time", "photos", "equipment", "invoices", "safety", "materials"].forEach(
        (k) => {
          DB[k] = (DB[k] || []).filter((x) => x.jobId !== id);
        }
      );
    }
    cacheSave();
  }

  function showAuth(which) {
    $("auth").classList.remove("hidden");
    $("app").classList.add("hidden");
    $("portal-app").classList.add("hidden");
    $("login-view").classList.toggle("hidden", which !== "login");
    $("register-view").classList.toggle("hidden", which !== "register");
    $("portal-gate").classList.toggle("hidden", which !== "portal");
  }

  function showApp() {
    $("auth").classList.add("hidden");
    $("portal-app").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("side-company").textContent = COMPANY?.name || "—";
    $("role-pill").textContent = (SESSION?.role || "") + (OFFLINE ? " · offline" : "");
    $("nav-admin").classList.toggle("hidden", !isOwner());
    refreshNotifBadge();
    fillJobSelect();
    setView(CURRENT_VIEW || "jobs");
  }

  function refreshNotifBadge() {
    const unread = (NOTIFS || []).filter((n) => !n.read).length;
    const badge = $("notif-badge");
    badge.textContent = String(unread);
    badge.classList.toggle("hidden", unread === 0);
  }

  function fillJobSelect() {
    const sel = $("job-select");
    const jobs = DB?.jobs || [];
    sel.innerHTML =
      '<option value="">All jobs</option>' +
      jobs.map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("");
    if (SELECTED_JOB && jobs.some((j) => j.id === SELECTED_JOB)) sel.value = SELECTED_JOB;
    else SELECTED_JOB = sel.value || null;
  }

  function filtered(list, jobKey) {
    const key = jobKey || "jobId";
    if (!SELECTED_JOB) return list || [];
    return (list || []).filter((x) => x[key] === SELECTED_JOB || x[key] == null);
  }

  function pageHead(title, actionsHtml) {
    return (
      '<div class="page-head"><div><h2>' +
      esc(title) +
      "</h2>" +
      (OFFLINE ? '<span class="offline-pill">Offline cache</span>' : "") +
      '</div><div class="actions">' +
      (actionsHtml || "") +
      "</div></div>"
    );
  }

  function setView(name) {
    CURRENT_VIEW = name;
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-view") === name);
    });
    const map = {
      jobs: renderJobs,
      schedule: renderSchedule,
      reports: renderReports,
      changes: renderChanges,
      time: renderTime,
      photos: renderPhotos,
      yard: renderYard,
      invoices: renderInvoices,
      safety: renderSafety,
      materials: renderMaterials,
      subs: renderSubs,
      exports: renderExports,
      admin: renderAdmin,
      notifications: renderNotificationsInline,
    };
    (map[name] || renderJobs)();
  }

  /* ---------- Views ---------- */
  function renderJobs() {
    const jobs = DB.jobs || [];
    let html = pageHead(
      "Jobs",
      canEdit() ? '<button class="btn primary sm" id="job-add" type="button">Add job</button>' : ""
    );
    html += '<div class="cards">';
    jobs.forEach((j) => {
      html +=
        '<div class="card"><div class="card-top"><strong>' +
        esc(j.name) +
        '</strong><span class="pill">' +
        esc(j.status) +
        '</span></div><div class="meta">' +
        esc(j.client) +
        " · " +
        esc(j.address) +
        '</div><div class="meta mono">Portal: ' +
        esc(j.portalCode) +
        "</div>";
      if (canEdit()) {
        html +=
          '<div class="row-actions"><button class="btn sm ghost" data-edit-job="' +
          esc(j.id) +
          '" type="button">Edit</button><button class="btn sm danger" data-del-job="' +
          esc(j.id) +
          '" type="button">Delete</button></div>';
      }
      html += "</div>";
    });
    if (!jobs.length) html += '<div class="empty">No jobs yet.</div>';
    html += "</div>";
    if (canEdit()) {
      html +=
        '<div id="job-form" class="panel hidden"><h3>New job</h3><div class="form-grid">' +
        '<label>Name<input id="jf-name" /></label><label>Client<input id="jf-client" /></label>' +
        '<label>Address<input id="jf-address" /></label><label>Status<select id="jf-status"><option>active</option><option>punch</option><option>closed</option></select></label>' +
        '<label>Portal code<input id="jf-portal" placeholder="AUTO" /></label></div>' +
        '<button class="btn primary" id="jf-save" type="button">Save</button></div>';
    }
    $("view").innerHTML = html;
    bindJobs();
  }

  function bindJobs() {
    const add = $("job-add");
    if (add)
      add.onclick = () => {
        $("job-form").classList.toggle("hidden");
      };
    const save = $("jf-save");
    if (save)
      save.onclick = async () => {
        try {
          await createItem("jobs", {
            name: $("jf-name").value,
            client: $("jf-client").value,
            address: $("jf-address").value,
            status: $("jf-status").value,
            portalCode: $("jf-portal").value,
          });
          fillJobSelect();
          renderJobs();
        } catch (e) {
          alert(e.message);
        }
      };
    $("view").querySelectorAll("[data-del-job]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Delete job and related records?")) return;
        try {
          await deleteItem("jobs", btn.getAttribute("data-del-job"));
          fillJobSelect();
          renderJobs();
        } catch (e) {
          alert(e.message);
        }
      };
    });
    $("view").querySelectorAll("[data-edit-job]").forEach((btn) => {
      btn.onclick = async () => {
        const j = DB.jobs.find((x) => x.id === btn.getAttribute("data-edit-job"));
        if (!j) return;
        const name = prompt("Job name", j.name);
        if (name == null) return;
        try {
          await updateItem("jobs", j.id, { name });
          fillJobSelect();
          renderJobs();
        } catch (e) {
          alert(e.message);
        }
      };
    });
  }

  function renderSchedule() {
    if (!WEEK_MON) WEEK_MON = weekStart(todayLocal());
    const days = DAYS.map((d, i) => ({ label: d, date: addDays(WEEK_MON, i) }));
    let html = pageHead(
      "Schedule",
      '<button class="btn sm ghost" id="wk-prev" type="button">←</button><span class="mono">' +
        esc(WEEK_MON) +
        '</span><button class="btn sm ghost" id="wk-next" type="button">→</button>' +
        (canEdit() ? '<button class="btn primary sm" id="sch-add" type="button">Assign</button>' : "")
    );
    html += '<div class="week">';
    days.forEach((day) => {
      const items = (DB.schedule || []).filter(
        (s) => s.date === day.date && (!SELECTED_JOB || s.jobId === SELECTED_JOB)
      );
      html += '<div class="day"><div class="day-h">' + day.label + " " + fmtShort(day.date) + "</div>";
      items.forEach((s) => {
        html +=
          '<div class="chip"><b>' +
          esc(crewName(s.crewId)) +
          "</b><div>" +
          esc(jobName(s.jobId)) +
          '</div><div class="muted">' +
          esc(s.note || "") +
          "</div>";
        if (canEdit())
          html +=
            '<button class="btn sm ghost" data-del-s="' + esc(s.id) + '" type="button">×</button>';
        html += "</div>";
      });
      html += "</div>";
    });
    html += "</div>";
    if (canEdit()) {
      html +=
        '<div id="sch-form" class="panel hidden"><h3>Assign crew</h3><div class="form-grid">' +
        '<label>Job<select id="sf-job">' +
        (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
        '</select></label><label>Crew<select id="sf-crew">' +
        (DB.crew || []).map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("") +
        '</select></label><label>Date<input type="date" id="sf-date" value="' +
        esc(WEEK_MON) +
        '" /></label><label>Note<input id="sf-note" /></label></div>' +
        '<button class="btn primary" id="sf-save" type="button">Save</button></div>';
    }
    $("view").innerHTML = html;
    $("wk-prev").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, -7);
      renderSchedule();
    };
    $("wk-next").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, 7);
      renderSchedule();
    };
    const add = $("sch-add");
    if (add) add.onclick = () => $("sch-form").classList.toggle("hidden");
    const save = $("sf-save");
    if (save)
      save.onclick = async () => {
        try {
          const item = await createItem("schedule", {
            jobId: $("sf-job").value,
            crewId: $("sf-crew").value,
            date: $("sf-date").value,
            note: $("sf-note").value,
          });
          try {
            await api("/api/schedule/" + item.id + "/notify", { method: "POST", body: {} });
          } catch (_) {}
          renderSchedule();
        } catch (e) {
          alert(e.message);
        }
      };
    $("view").querySelectorAll("[data-del-s]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await deleteItem("schedule", btn.getAttribute("data-del-s"));
          renderSchedule();
        } catch (e) {
          alert(e.message);
        }
      };
    });
  }

  function renderReports() {
    const list = filtered(DB.reports);
    let html = pageHead(
      "Daily reports",
      '<button class="btn primary sm" id="dr-add" type="button">New report</button>'
    );
    html += '<table class="table"><thead><tr><th>#</th><th>Date</th><th>Job</th><th>Status</th><th>By</th><th></th></tr></thead><tbody>';
    list.forEach((r) => {
      html +=
        "<tr><td class=\"mono\">" +
        esc(r.number) +
        "</td><td>" +
        esc(r.date) +
        "</td><td>" +
        esc(jobName(r.jobId)) +
        '</td><td><span class="pill">' +
        esc(r.status) +
        "</span></td><td>" +
        esc(r.by) +
        '</td><td><button class="btn sm ghost" data-open-r="' +
        esc(r.id) +
        '" type="button">Open</button></td></tr>';
    });
    html += "</tbody></table>";
    html +=
      '<div id="dr-form" class="panel hidden"><h3>Report</h3><div class="form-grid">' +
      '<label>Job<select id="dr-job">' +
      (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
      '</select></label><label>Date<input type="date" id="dr-date" value="' +
      todayLocal() +
      '" /></label><label>Weather<input id="dr-weather" /></label>' +
      '<label class="span2">Work done<textarea id="dr-work" rows="3"></textarea></label>' +
      '<label class="span2">Issues<textarea id="dr-issues" rows="2"></textarea></label></div>' +
      '<button class="btn primary" id="dr-save" type="button">Save draft</button> ' +
      '<button class="btn" id="dr-submit" type="button">Submit</button></div>';
    html += '<div id="dr-detail" class="panel hidden"></div>';
    $("view").innerHTML = html;
    $("dr-add").onclick = () => $("dr-form").classList.toggle("hidden");
    const saveDr = async (status) => {
      try {
        await createItem("reports", {
          jobId: $("dr-job").value,
          date: $("dr-date").value,
          weather: $("dr-weather").value,
          workDone: $("dr-work").value,
          issues: $("dr-issues").value,
          status,
        });
        renderReports();
      } catch (e) {
        alert(e.message);
      }
    };
    $("dr-save").onclick = () => saveDr("draft");
    $("dr-submit").onclick = () => saveDr("submitted");
    $("view").querySelectorAll("[data-open-r]").forEach((btn) => {
      btn.onclick = () => {
        const r = DB.reports.find((x) => x.id === btn.getAttribute("data-open-r"));
        if (!r) return;
        const el = $("dr-detail");
        el.classList.remove("hidden");
        el.innerHTML =
          "<h3>" +
          esc(r.number) +
          '</h3><p class="meta">' +
          esc(r.date) +
          " · " +
          esc(jobName(r.jobId)) +
          " · " +
          esc(r.status) +
          "</p><p><b>Weather</b> " +
          esc(r.weather) +
          "</p><p><b>Work</b> " +
          esc(r.workDone) +
          "</p><p><b>Issues</b> " +
          esc(r.issues) +
          "</p>";
        if (canEdit() && r.status === "draft") {
          el.innerHTML +=
            '<button class="btn primary sm" id="dr-mark" type="button">Mark submitted</button>';
          $("dr-mark").onclick = async () => {
            await updateItem("reports", r.id, { status: "submitted" });
            renderReports();
          };
        }
      };
    });
  }

  function renderChanges() {
    const list = filtered(DB.changes);
    let html = pageHead(
      "Change orders",
      canEdit() ? '<button class="btn primary sm" id="co-add" type="button">New CO</button>' : ""
    );
    html += '<table class="table"><thead><tr><th>#</th><th>Title</th><th>Job</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>';
    list.forEach((c) => {
      html +=
        "<tr><td class=\"mono\">" +
        esc(c.number) +
        "</td><td>" +
        esc(c.title) +
        "</td><td>" +
        esc(jobName(c.jobId)) +
        "</td><td>" +
        money(c.amount) +
        '</td><td><span class="pill">' +
        esc(c.status) +
        "</span></td><td>";
      if (canEdit() && c.status === "open") {
        html +=
          '<button class="btn sm" data-co-a="' +
          esc(c.id) +
          '" type="button">Approve</button> <button class="btn sm danger" data-co-r="' +
          esc(c.id) +
          '" type="button">Reject</button>';
      }
      html += "</td></tr>";
    });
    html += "</tbody></table>";
    if (canEdit()) {
      html +=
        '<div id="co-form" class="panel hidden"><h3>New change order</h3><div class="form-grid">' +
        '<label>Job<select id="co-job">' +
        (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
        '</select></label><label>Title<input id="co-title" /></label><label>Amount<input id="co-amt" type="number" /></label>' +
        '<label class="span2">Description<textarea id="co-desc" rows="2"></textarea></label></div>' +
        '<button class="btn primary" id="co-save" type="button">Create</button></div>';
    }
    $("view").innerHTML = html;
    const add = $("co-add");
    if (add) add.onclick = () => $("co-form").classList.toggle("hidden");
    const save = $("co-save");
    if (save)
      save.onclick = async () => {
        try {
          await createItem("changes", {
            jobId: $("co-job").value,
            title: $("co-title").value,
            amount: Number($("co-amt").value),
            description: $("co-desc").value,
          });
          renderChanges();
        } catch (e) {
          alert(e.message);
        }
      };
    $("view").querySelectorAll("[data-co-a]").forEach((btn) => {
      btn.onclick = async () => {
        await updateItem("changes", btn.getAttribute("data-co-a"), { status: "approved" });
        await refreshNotifs();
        renderChanges();
      };
    });
    $("view").querySelectorAll("[data-co-r]").forEach((btn) => {
      btn.onclick = async () => {
        await updateItem("changes", btn.getAttribute("data-co-r"), { status: "rejected" });
        renderChanges();
      };
    });
  }

  function renderTime() {
    if (!WEEK_MON) WEEK_MON = weekStart(todayLocal());
    const list = (DB.time || []).filter(
      (t) => t.date >= WEEK_MON && t.date <= addDays(WEEK_MON, 6) && (!SELECTED_JOB || t.jobId === SELECTED_JOB)
    );
    const totalH = list.reduce((a, t) => a + Number(t.hours || 0), 0);
    const total$ = list.reduce((a, t) => a + Number(t.hours || 0) * Number(t.rate || 0), 0);
    let html = pageHead(
      "Time",
      '<button class="btn sm ghost" id="tw-prev" type="button">←</button><span class="mono">' +
        esc(WEEK_MON) +
        '</span><button class="btn sm ghost" id="tw-next" type="button">→</button>' +
        '<button class="btn primary sm" id="tm-add" type="button">Post time</button>'
    );
    html +=
      '<div class="stats"><div class="stat"><div class="lbl">Hours</div><div class="val">' +
      totalH +
      '</div></div><div class="stat"><div class="lbl">Labor $</div><div class="val">' +
      money(total$) +
      "</div></div></div>";
    html += '<table class="table"><thead><tr><th>Date</th><th>Crew</th><th>Job</th><th>Hrs</th><th>Rate</th><th>$</th><th>Note</th></tr></thead><tbody>';
    list.forEach((t) => {
      html +=
        "<tr><td>" +
        esc(t.date) +
        "</td><td>" +
        esc(crewName(t.crewId)) +
        "</td><td>" +
        esc(jobName(t.jobId)) +
        "</td><td>" +
        esc(t.hours) +
        "</td><td>" +
        money(t.rate) +
        "</td><td>" +
        money(t.hours * t.rate) +
        "</td><td>" +
        esc(t.note || "") +
        "</td></tr>";
    });
    html += "</tbody></table>";
    html +=
      '<div id="tm-form" class="panel hidden"><h3>Post time</h3><div class="form-grid">' +
      '<label>Job<select id="tm-job">' +
      (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
      '</select></label><label>Crew<select id="tm-crew">' +
      (DB.crew || []).map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("") +
      '</select></label><label>Date<input type="date" id="tm-date" value="' +
      todayLocal() +
      '" /></label><label>Hours<input type="number" id="tm-hrs" step="0.5" value="8" /></label>' +
      '<label>Note<input id="tm-note" /></label></div><button class="btn primary" id="tm-save" type="button">Save</button></div>';
    $("view").innerHTML = html;
    $("tw-prev").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, -7);
      renderTime();
    };
    $("tw-next").onclick = () => {
      WEEK_MON = addDays(WEEK_MON, 7);
      renderTime();
    };
    $("tm-add").onclick = () => $("tm-form").classList.toggle("hidden");
    $("tm-save").onclick = async () => {
      try {
        const crewId = $("tm-crew").value;
        await createItem("time", {
          jobId: $("tm-job").value,
          crewId,
          date: $("tm-date").value,
          hours: Number($("tm-hrs").value),
          rate: rateOf(crewId),
          note: $("tm-note").value,
        });
        renderTime();
      } catch (e) {
        alert(e.message);
      }
    };
  }

  function renderPhotos() {
    const list = filtered(DB.photos);
    let html = pageHead(
      "Photos / docs",
      '<button class="btn primary sm" id="ph-add" type="button">Add</button>'
    );
    html += '<div class="cards">';
    list.forEach((p) => {
      html +=
        '<div class="card">' +
        (p.url ? '<img class="thumb" src="' + esc(p.url) + '" alt="" />' : '<div class="thumb placeholder">No image</div>') +
        "<div><strong>" +
        esc(p.caption || "Untitled") +
        '</strong><div class="meta">' +
        esc(jobName(p.jobId)) +
        " · " +
        esc(p.created) +
        "</div></div>";
      if (canEdit())
        html +=
          '<button class="btn sm danger" data-del-p="' + esc(p.id) + '" type="button">Delete</button>';
      html += "</div>";
    });
    html += "</div>";
    html +=
      '<div id="ph-form" class="panel hidden"><h3>Upload</h3><div class="form-grid">' +
      '<label>Job<select id="ph-job">' +
      (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
      '</select></label><label>Caption<input id="ph-cap" /></label>' +
      '<label>File<input type="file" id="ph-file" accept="image/*,.pdf" /></label></div>' +
      '<button class="btn primary" id="ph-save" type="button">Save</button></div>';
    $("view").innerHTML = html;
    $("ph-add").onclick = () => $("ph-form").classList.toggle("hidden");
    $("ph-save").onclick = async () => {
      try {
        let url = null;
        const file = $("ph-file").files[0];
        if (file) {
          const fd = new FormData();
          fd.append("file", file);
          const up = await api("/api/uploads", { method: "POST", body: fd, headers: {} });
          url = up.url;
        }
        await createItem("photos", {
          jobId: $("ph-job").value,
          caption: $("ph-cap").value,
          url,
          created: todayLocal(),
        });
        renderPhotos();
      } catch (e) {
        alert(e.message);
      }
    };
    $("view").querySelectorAll("[data-del-p]").forEach((btn) => {
      btn.onclick = async () => {
        await deleteItem("photos", btn.getAttribute("data-del-p"));
        renderPhotos();
      };
    });
  }

  function renderYard() {
    const list = filtered(DB.equipment);
    let html = pageHead(
      "Yard / equipment",
      canEdit() ? '<button class="btn primary sm" id="eq-add" type="button">Add</button>' : ""
    );
    html += '<table class="table"><thead><tr><th>Name</th><th>Status</th><th>Job</th><th>Notes</th><th></th></tr></thead><tbody>';
    list.forEach((e) => {
      html +=
        "<tr><td>" +
        esc(e.name) +
        '</td><td><span class="pill">' +
        esc(e.status) +
        "</span></td><td>" +
        esc(e.jobId ? jobName(e.jobId) : "Yard pool") +
        "</td><td>" +
        esc(e.notes || "") +
        "</td><td>";
      if (canEdit())
        html +=
          '<button class="btn sm ghost" data-eq="' +
          esc(e.id) +
          '" type="button">Cycle</button>';
      html += "</td></tr>";
    });
    html += "</tbody></table>";
    if (canEdit()) {
      html +=
        '<div id="eq-form" class="panel hidden"><h3>Equipment</h3><div class="form-grid">' +
        '<label>Name<input id="eq-name" /></label><label>Status<select id="eq-status"><option>in</option><option>out</option><option>low</option></select></label>' +
        '<label>Job<select id="eq-job"><option value="">Yard pool</option>' +
        (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
        '</select></label><label>Notes<input id="eq-notes" /></label></div>' +
        '<button class="btn primary" id="eq-save" type="button">Save</button></div>';
    }
    $("view").innerHTML = html;
    const add = $("eq-add");
    if (add) add.onclick = () => $("eq-form").classList.toggle("hidden");
    const save = $("eq-save");
    if (save)
      save.onclick = async () => {
        await createItem("equipment", {
          name: $("eq-name").value,
          status: $("eq-status").value,
          jobId: $("eq-job").value || null,
          notes: $("eq-notes").value,
        });
        renderYard();
      };
    $("view").querySelectorAll("[data-eq]").forEach((btn) => {
      btn.onclick = async () => {
        const e = DB.equipment.find((x) => x.id === btn.getAttribute("data-eq"));
        if (!e) return;
        const cycle = { in: "out", out: "low", low: "in" };
        await updateItem("equipment", e.id, { status: cycle[e.status] || "in" });
        renderYard();
      };
    });
  }

  function renderInvoices() {
    const list = filtered(DB.invoices);
    let html = pageHead(
      "Invoices",
      canEdit() ? '<button class="btn primary sm" id="inv-add" type="button">New invoice</button>' : ""
    );
    html += '<table class="table"><thead><tr><th>#</th><th>Job</th><th>Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>';
    list.forEach((inv) => {
      html +=
        "<tr><td class=\"mono\">" +
        esc(inv.number) +
        "</td><td>" +
        esc(jobName(inv.jobId)) +
        "</td><td>" +
        money(inv.amount) +
        '</td><td><span class="pill">' +
        esc(inv.status) +
        "</span></td><td>" +
        esc(inv.due || "—") +
        "</td><td>";
      if (canEdit()) {
        if (inv.status === "draft")
          html +=
            '<button class="btn sm" data-inv-send="' + esc(inv.id) + '" type="button">Send</button> ';
        if (inv.status === "sent")
          html +=
            '<button class="btn sm" data-inv-pay="' + esc(inv.id) + '" type="button">Mark paid</button>';
      }
      html += "</td></tr>";
    });
    html += "</tbody></table>";
    if (canEdit()) {
      html +=
        '<div id="inv-form" class="panel hidden"><h3>Invoice</h3><div class="form-grid">' +
        '<label>Job<select id="inv-job">' +
        (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
        '</select></label><label>Amount<input type="number" id="inv-amt" /></label>' +
        '<label>Due<input type="date" id="inv-due" /></label><label class="span2">Description<input id="inv-desc" /></label></div>' +
        '<button class="btn primary" id="inv-save" type="button">Create draft</button></div>';
    }
    $("view").innerHTML = html;
    const add = $("inv-add");
    if (add) add.onclick = () => $("inv-form").classList.toggle("hidden");
    const save = $("inv-save");
    if (save)
      save.onclick = async () => {
        await createItem("invoices", {
          jobId: $("inv-job").value,
          amount: Number($("inv-amt").value),
          due: $("inv-due").value,
          description: $("inv-desc").value,
        });
        renderInvoices();
      };
    $("view").querySelectorAll("[data-inv-send]").forEach((btn) => {
      btn.onclick = async () => {
        await updateItem("invoices", btn.getAttribute("data-inv-send"), { status: "sent" });
        await refreshNotifs();
        renderInvoices();
      };
    });
    $("view").querySelectorAll("[data-inv-pay]").forEach((btn) => {
      btn.onclick = async () => {
        await updateItem("invoices", btn.getAttribute("data-inv-pay"), { status: "paid" });
        renderInvoices();
      };
    });
  }

  function renderSafety() {
    const list = filtered(DB.safety);
    let html = pageHead(
      "Safety — toolbox talks",
      '<button class="btn primary sm" id="tt-add" type="button">Log talk</button>'
    );
    html += '<div class="cards">';
    list.forEach((t) => {
      html +=
        '<div class="card"><div class="card-top"><strong class="mono">' +
        esc(t.number) +
        "</strong><span>" +
        esc(t.date) +
        "</span></div><div><b>" +
        esc(t.topic) +
        '</b></div><div class="meta">' +
        esc(jobName(t.jobId)) +
        " · " +
        esc((t.attendees || []).join(", ")) +
        '</div><div class="meta">' +
        esc(t.notes || "") +
        "</div></div>";
    });
    if (!list.length) html += '<div class="empty">No toolbox talks yet.</div>';
    html += "</div>";
    html +=
      '<div id="tt-form" class="panel hidden"><h3>Toolbox talk</h3><div class="form-grid">' +
      '<label>Job<select id="tt-job"><option value="">—</option>' +
      (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
      '</select></label><label>Date<input type="date" id="tt-date" value="' +
      todayLocal() +
      '" /></label><label class="span2">Topic<input id="tt-topic" /></label>' +
      '<label class="span2">Attendees (comma-separated)<input id="tt-att" /></label>' +
      '<label class="span2">Notes<textarea id="tt-notes" rows="2"></textarea></label></div>' +
      '<button class="btn primary" id="tt-save" type="button">Save</button></div>';
    $("view").innerHTML = html;
    $("tt-add").onclick = () => $("tt-form").classList.toggle("hidden");
    $("tt-save").onclick = async () => {
      await createItem("safety", {
        jobId: $("tt-job").value || null,
        date: $("tt-date").value,
        topic: $("tt-topic").value,
        attendees: $("tt-att").value,
        notes: $("tt-notes").value,
      });
      renderSafety();
    };
  }

  function renderMaterials() {
    const list = filtered(DB.materials);
    let html = pageHead(
      "Materials / POs",
      canEdit() ? '<button class="btn primary sm" id="po-add" type="button">New PO</button>' : ""
    );
    html += '<table class="table"><thead><tr><th>#</th><th>Vendor</th><th>Job</th><th>Amount</th><th>Status</th><th>Items</th></tr></thead><tbody>';
    list.forEach((p) => {
      html +=
        "<tr><td class=\"mono\">" +
        esc(p.number) +
        "</td><td>" +
        esc(p.vendor) +
        "</td><td>" +
        esc(p.jobId ? jobName(p.jobId) : "—") +
        "</td><td>" +
        money(p.amount) +
        '</td><td><span class="pill">' +
        esc(p.status) +
        "</span></td><td>" +
        esc(p.items || "") +
        "</td></tr>";
    });
    html += "</tbody></table>";
    if (canEdit()) {
      html +=
        '<div id="po-form" class="panel hidden"><h3>Purchase order</h3><div class="form-grid">' +
        '<label>Vendor<input id="po-vendor" /></label><label>Amount<input type="number" id="po-amt" /></label>' +
        '<label>Job<select id="po-job"><option value="">—</option>' +
        (DB.jobs || []).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>").join("") +
        '</select></label><label>Status<select id="po-status"><option>draft</option><option>ordered</option><option>received</option></select></label>' +
        '<label class="span2">Items<input id="po-items" /></label></div>' +
        '<button class="btn primary" id="po-save" type="button">Create</button></div>';
    }
    $("view").innerHTML = html;
    const add = $("po-add");
    if (add) add.onclick = () => $("po-form").classList.toggle("hidden");
    const save = $("po-save");
    if (save)
      save.onclick = async () => {
        await createItem("materials", {
          vendor: $("po-vendor").value,
          amount: Number($("po-amt").value),
          jobId: $("po-job").value || null,
          status: $("po-status").value,
          items: $("po-items").value,
        });
        renderMaterials();
      };
  }

  function renderSubs() {
    const list = DB.subcontractors || [];
    let html = pageHead(
      "Subcontractors",
      canEdit() ? '<button class="btn primary sm" id="sub-add" type="button">Add sub</button>' : ""
    );
    html += '<div class="cards">';
    list.forEach((s) => {
      html +=
        '<div class="card"><div class="card-top"><strong>' +
        esc(s.name) +
        '</strong><span class="pill">' +
        esc(s.status) +
        '</span></div><div class="meta">' +
        esc(s.trade) +
        " · " +
        esc(s.contact) +
        " · " +
        esc(s.phone) +
        '</div><div class="meta">' +
        esc(s.email) +
        " · COI: " +
        (s.cois ? "yes" : "no") +
        '</div><div class="meta">' +
        esc(s.notes || "") +
        "</div></div>";
    });
    if (!list.length) html += '<div class="empty">No subcontractors.</div>';
    html += "</div>";
    if (canEdit()) {
      html +=
        '<div id="sub-form" class="panel hidden"><h3>Subcontractor</h3><div class="form-grid">' +
        '<label>Name<input id="sub-name" /></label><label>Trade<input id="sub-trade" /></label>' +
        '<label>Contact<input id="sub-contact" /></label><label>Phone<input id="sub-phone" /></label>' +
        '<label>Email<input id="sub-email" /></label><label>Status<select id="sub-status"><option>active</option><option>pending</option><option>quoted</option></select></label>' +
        '<label class="span2">Notes<input id="sub-notes" /></label></div>' +
        '<button class="btn primary" id="sub-save" type="button">Save</button></div>';
    }
    $("view").innerHTML = html;
    const add = $("sub-add");
    if (add) add.onclick = () => $("sub-form").classList.toggle("hidden");
    const save = $("sub-save");
    if (save)
      save.onclick = async () => {
        await createItem("subcontractors", {
          name: $("sub-name").value,
          trade: $("sub-trade").value,
          contact: $("sub-contact").value,
          phone: $("sub-phone").value,
          email: $("sub-email").value,
          status: $("sub-status").value,
          notes: $("sub-notes").value,
          cois: false,
        });
        renderSubs();
      };
  }

  function renderExports() {
    let html = pageHead("Exports");
    html += '<div class="export-grid">';
    [
      ["time.csv", "Time entries", "Weekly labor CSV"],
      ["invoices.csv", "Invoices", "Billing export"],
      ["jobs.csv", "Jobs", "Jobsite roster"],
    ].forEach(([file, title, desc]) => {
      html +=
        '<div class="export-card"><h3>' +
        esc(title) +
        "</h3><p>" +
        esc(desc) +
        '</p><a class="btn primary sm" href="/api/export/' +
        file +
        '" download>Download CSV</a></div>';
    });
    html += "</div>";
    if (canEdit()) {
      html +=
        '<div class="panel" style="margin-top:16px"><h3>Audit log</h3><div id="audit-box" class="meta">Loading…</div></div>';
    }
    $("view").innerHTML = html;
    if (canEdit()) {
      api("/api/audit")
        .then((rows) => {
          $("audit-box").innerHTML = rows.length
            ? '<table class="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead><tbody>' +
              rows
                .slice(0, 40)
                .map(
                  (r) =>
                    "<tr><td class=\"mono\">" +
                    esc(r.at) +
                    "</td><td>" +
                    esc(r.actor) +
                    '</td><td class="mono">' +
                    esc(r.action) +
                    "</td><td>" +
                    esc(r.detail || r.entity || "") +
                    "</td></tr>"
                )
                .join("") +
              "</tbody></table>"
            : "No audit events.";
        })
        .catch((e) => {
          $("audit-box").textContent = e.message;
        });
    }
  }

  function renderAdmin() {
    if (!isOwner()) {
      $("view").innerHTML = pageHead("Admin") + '<div class="empty">Owner only.</div>';
      return;
    }
    const plan = PLANS[COMPANY.plan] || PLANS.crew;
    let html = pageHead("Admin");
    html +=
      '<div class="panel"><h3>Company</h3><div class="form-grid">' +
      '<label>Name<input id="ad-name" value="' +
      esc(COMPANY.name) +
      '" /></label><label>Plan<select id="ad-plan">' +
      Object.keys(PLANS)
        .map(
          (k) =>
            '<option value="' +
            k +
            '"' +
            (COMPANY.plan === k ? " selected" : "") +
            ">" +
            PLANS[k].name +
            " ($" +
            PLANS[k].price +
            ")</option>"
        )
        .join("") +
      '</select></label></div><button class="btn primary" id="ad-save" type="button">Save</button> ' +
      '<button class="btn ghost" id="ad-stripe" type="button">Stripe checkout (stub)</button>' +
      '<p class="hint" id="ad-stripe-msg">Billing is demo/stub only.</p></div>';
    html +=
      '<div class="panel"><h3>Crew (' +
      (DB.crew || []).length +
      " / " +
      plan.crewCap +
      ')</h3><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Rate</th></tr></thead><tbody>';
    (DB.crew || []).forEach((c) => {
      html +=
        "<tr><td>" +
        esc(c.name) +
        "</td><td>" +
        esc(c.role) +
        "</td><td>" +
        money(c.rate) +
        "</td></tr>";
    });
    html +=
      '</tbody></table><div class="form-grid" style="margin-top:12px">' +
      '<label>Name<input id="cr-name" /></label><label>Role<select id="cr-role"><option>field</option><option>office</option></select></label>' +
      '<label>Rate<input type="number" id="cr-rate" value="40" /></label></div>' +
      '<button class="btn sm primary" id="cr-add" type="button">Add crew</button></div>';
    $("view").innerHTML = html;
    $("ad-save").onclick = async () => {
      try {
        COMPANY = await api("/api/company", {
          method: "PATCH",
          body: { name: $("ad-name").value, plan: $("ad-plan").value },
        });
        $("side-company").textContent = COMPANY.name;
        renderAdmin();
      } catch (e) {
        alert(e.message);
      }
    };
    $("ad-stripe").onclick = async () => {
      try {
        const r = await api("/api/stripe/checkout-session", {
          method: "POST",
          body: { plan: $("ad-plan").value },
        });
        $("ad-stripe-msg").textContent = r.message + " (id: " + r.id + ", $" + r.amount / 100 + ")";
      } catch (e) {
        $("ad-stripe-msg").textContent = e.message;
      }
    };
    $("cr-add").onclick = async () => {
      try {
        await createItem("crew", {
          name: $("cr-name").value,
          role: $("cr-role").value,
          rate: Number($("cr-rate").value),
        });
        renderAdmin();
      } catch (e) {
        alert(e.message);
      }
    };
  }

  function renderNotificationsInline() {
    openNotifPanel();
    setView("jobs");
  }

  async function refreshNotifs() {
    try {
      const data = await api("/api/notifications");
      NOTIFS = data.items || [];
      cacheSave();
      refreshNotifBadge();
      if (!$("notif-panel").classList.contains("hidden")) renderNotifList();
    } catch (_) {}
  }

  function renderNotifList() {
    const box = $("notif-list");
    if (!NOTIFS.length) {
      box.innerHTML = '<div class="notif-empty">No notifications</div>';
      return;
    }
    box.innerHTML = NOTIFS.map(
      (n) =>
        '<div class="notif-item' +
        (n.read ? "" : " unread") +
        '" data-nid="' +
        esc(n.id) +
        '"><div class="t">' +
        esc(n.title) +
        '</div><div class="b">' +
        esc(n.body) +
        "</div></div>"
    ).join("");
    box.querySelectorAll("[data-nid]").forEach((el) => {
      el.onclick = async () => {
        const id = el.getAttribute("data-nid");
        try {
          await api("/api/notifications/" + id + "/read", { method: "POST", body: {} });
          const n = NOTIFS.find((x) => x.id === id);
          if (n) n.read = true;
          refreshNotifBadge();
          renderNotifList();
        } catch (_) {}
      };
    });
  }

  function openNotifPanel() {
    $("notif-panel").classList.remove("hidden");
    renderNotifList();
  }

  /* ---------- Portal ---------- */
  async function openPortal(code) {
    const data = await api("/api/portal/login", { method: "POST", body: { code } });
    $("auth").classList.add("hidden");
    $("app").classList.add("hidden");
    $("portal-app").classList.remove("hidden");
    const j = data.job;
    let html =
      '<div class="portal-card"><div class="brand-row"><div class="logo">SF</div><div><h1>' +
      esc(j.name) +
      '</h1><div class="brand-tag">' +
      esc(data.companyName) +
      '</div></div></div><p class="sub">' +
      esc(j.client) +
      " · " +
      esc(j.address) +
      ' · <span class="pill">' +
      esc(j.status) +
      "</span></p>";
    html += "<h3>Change orders</h3><ul>";
    (data.changes || []).forEach((c) => {
      html +=
        "<li>" +
        esc(c.number) +
        " — " +
        esc(c.title) +
        " · " +
        money(c.amount) +
        " · " +
        esc(c.status) +
        "</li>";
    });
    html += "</ul><h3>Invoices</h3><ul>";
    (data.invoices || []).forEach((i) => {
      html +=
        "<li>" +
        esc(i.number) +
        " · " +
        money(i.amount) +
        " · " +
        esc(i.status) +
        " · due " +
        esc(i.due || "—") +
        "</li>";
    });
    html += "</ul><h3>Photos</h3><div class=\"cards\">";
    (data.photos || []).forEach((p) => {
      html +=
        '<div class="card">' +
        (p.url ? '<img class="thumb" src="' + esc(p.url) + '" alt="" />' : "") +
        "<div>" +
        esc(p.caption || "") +
        "</div></div>";
    });
    html +=
      '</div><p class="switch"><a href="#" id="portal-exit">Exit portal</a></p></div>';
    $("portal-view").innerHTML = html;
    $("portal-exit").onclick = (e) => {
      e.preventDefault();
      showAuth("login");
    };
  }

  /* ---------- Auth wiring ---------- */
  function wireAuth() {
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
        PICKED = el.getAttribute("data-plan");
      };
    });
    $("login-form").onsubmit = async (e) => {
      e.preventDefault();
      $("login-err").textContent = "";
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: { username: $("login-user").value, password: $("login-pass").value },
        });
        TOKEN = data.token;
        localStorage.setItem(TOKEN_KEY, TOKEN);
        await bootstrap();
        showApp();
      } catch (err) {
        $("login-err").textContent = err.message || "Login failed";
      }
    };
    $("register-form").onsubmit = async (e) => {
      e.preventDefault();
      $("reg-err").textContent = "";
      try {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: {
            company: $("reg-company").value,
            name: $("reg-name").value,
            username: $("reg-user").value,
            password: $("reg-pass").value,
            plan: PICKED,
          },
        });
        TOKEN = data.token;
        localStorage.setItem(TOKEN_KEY, TOKEN);
        await bootstrap();
        showApp();
      } catch (err) {
        $("reg-err").textContent = err.message || "Register failed";
      }
    };
    $("portal-form").onsubmit = async (e) => {
      e.preventDefault();
      $("portal-err").textContent = "";
      try {
        await openPortal($("portal-code").value);
      } catch (err) {
        $("portal-err").textContent = err.message || "Invalid code";
      }
    };
    $("logout-btn").onclick = async () => {
      try {
        await api("/api/auth/logout", { method: "POST", body: { token: TOKEN } });
      } catch (_) {}
      TOKEN = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(CACHE_KEY);
      SESSION = null;
      DB = null;
      showAuth("login");
    };
    $("job-select").onchange = () => {
      SELECTED_JOB = $("job-select").value || null;
      setView(CURRENT_VIEW);
    };
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.onclick = () => setView(btn.getAttribute("data-view"));
    });
    $("notif-btn").onclick = () => {
      $("notif-panel").classList.toggle("hidden");
      if (!$("notif-panel").classList.contains("hidden")) renderNotifList();
    };
    $("notif-close").onclick = () => $("notif-panel").classList.add("hidden");
    $("notif-read-all").onclick = async () => {
      try {
        await api("/api/notifications/read-all", { method: "POST", body: {} });
        NOTIFS.forEach((n) => (n.read = true));
        refreshNotifBadge();
        renderNotifList();
      } catch (_) {}
    };
  }

  async function init() {
    wireAuth();
    WEEK_MON = weekStart(todayLocal());
    if (TOKEN) {
      try {
        await bootstrap();
        showApp();
      } catch (_) {
        showAuth("login");
      }
    } else {
      showAuth("login");
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }
  }

  init();
})();
