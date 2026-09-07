"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const FILES = {
  companies: "companies.json",
  users: "users.json",
  sessions: "sessions.json",
  audit: "audit.json",
  notifications: "notifications.json",
  meta: "meta.json",
};

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function filePath(key) {
  return path.join(DATA_DIR, FILES[key] || key);
}

function read(key, fallback) {
  ensureDirs();
  const fp = filePath(key);
  if (!fs.existsSync(fp)) return fallback !== undefined ? fallback : [];
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return fallback !== undefined ? fallback : [];
  }
}

function write(key, data) {
  ensureDirs();
  const fp = filePath(key);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function getCompany(companyId) {
  const companies = read("companies", {});
  return companies[companyId] || null;
}

function saveCompany(company) {
  const companies = read("companies", {});
  companies[company.id] = company;
  write("companies", companies);
  return company;
}

function listCompanies() {
  return read("companies", {});
}

function getUsers() {
  return read("users", []);
}

function saveUsers(users) {
  write("users", users);
}

function findUser(pred) {
  return getUsers().find(pred) || null;
}

function updateUser(userId, patch) {
  const users = getUsers();
  const i = users.findIndex((u) => u.id === userId);
  if (i < 0) return null;
  users[i] = { ...users[i], ...patch };
  saveUsers(users);
  return users[i];
}

function getSessions() {
  return read("sessions", {});
}

function saveSessions(sessions) {
  write("sessions", sessions);
}

function appendAudit(entry) {
  const log = read("audit", []);
  log.push(entry);
  // keep last 5000
  if (log.length > 5000) log.splice(0, log.length - 5000);
  write("audit", log);
  return entry;
}

function getAudit(companyId, limit) {
  const log = read("audit", []);
  const filtered = companyId ? log.filter((e) => e.companyId === companyId) : log;
  return filtered.slice(-(limit || 200)).reverse();
}

function getNotifications(companyId, userId) {
  const all = read("notifications", []);
  return all
    .filter((n) => n.companyId === companyId && (!n.userId || n.userId === userId))
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function saveNotifications(list) {
  write("notifications", list);
}

function addNotification(n) {
  const all = read("notifications", []);
  all.push(n);
  write("notifications", all);
  return n;
}

function getMeta() {
  return read("meta", { seeded: false });
}

function setMeta(meta) {
  write("meta", meta);
}

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  ensureDirs,
  read,
  write,
  getCompany,
  saveCompany,
  listCompanies,
  getUsers,
  saveUsers,
  findUser,
  updateUser,
  getSessions,
  saveSessions,
  appendAudit,
  getAudit,
  getNotifications,
  saveNotifications,
  addNotification,
  getMeta,
  setMeta,
};
