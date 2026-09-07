"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const store = require("./store");

const SESSION_COOKIE = "sf_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const SALT_ROUNDS = 10;

/** Map legacy "field" → "foreman" */
function normalizeRole(role) {
  if (!role) return "foreman";
  if (role === "field") return "foreman";
  return role;
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  if (!String(hash).startsWith("$2")) return plain === hash;
  return bcrypt.compare(String(plain), hash);
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(user) {
  const token = newToken();
  const sessions = store.getSessions();
  const now = Date.now();
  const role = normalizeRole(user.role);
  sessions[token] = {
    token,
    userId: user.id,
    companyId: user.companyId,
    role,
    username: user.username,
    name: user.name,
    crewId: user.crewId || null,
    createdAt: now,
    lastActive: now,
  };
  Object.keys(sessions).forEach((t) => {
    const s = sessions[t];
    if (now - s.createdAt > SESSION_MS || now - s.lastActive > IDLE_MS) {
      delete sessions[t];
    }
  });
  store.saveSessions(sessions);
  return sessions[token];
}

function getSession(token) {
  if (!token) return null;
  const sessions = store.getSessions();
  const s = sessions[token];
  if (!s) return null;
  const now = Date.now();
  if (now - s.createdAt > SESSION_MS || now - s.lastActive > IDLE_MS) {
    delete sessions[token];
    store.saveSessions(sessions);
    return null;
  }
  s.role = normalizeRole(s.role);
  s.lastActive = now;
  sessions[token] = s;
  store.saveSessions(sessions);
  return s;
}

function destroySession(token) {
  if (!token) return;
  const sessions = store.getSessions();
  delete sessions[token];
  store.saveSessions(sessions);
}

function publicUser(u) {
  if (!u) return null;
  const role = normalizeRole(u.role);
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role,
    companyId: u.companyId,
    crewId: u.crewId || null,
    permissions: u.permissions || defaultPermissions(role),
  };
}

/**
 * Permission matrix:
 * - owner: full admin (jobs/crew delete, billing, approve all, money)
 * - office: schedule, invoices, approvals, edit jobs, materials — no destructive deletes, no billing admin
 * - foreman: field ops — time, DRs, draft COs, photos, equipment hours
 */
function defaultPermissions(role) {
  role = normalizeRole(role);
  if (role === "owner") {
    return {
      admin: true,
      money: true,
      approve: true,
      edit: true,
      field: true,
      deleteJobs: true,
      deleteCrew: true,
      billing: true,
    };
  }
  if (role === "office") {
    return {
      admin: false,
      money: true,
      approve: true,
      edit: true,
      field: false,
      deleteJobs: false,
      deleteCrew: false,
      billing: false,
    };
  }
  // foreman (and any unknown)
  return {
    admin: false,
    money: false,
    approve: false,
    edit: false,
    field: true,
    deleteJobs: false,
    deleteCrew: false,
    billing: false,
  };
}

function isOwner(session) {
  return session && normalizeRole(session.role) === "owner";
}

function isOffice(session) {
  return session && normalizeRole(session.role) === "office";
}

function isForeman(session) {
  const r = session && normalizeRole(session.role);
  return r === "foreman";
}

function canApprove(session) {
  return isOwner(session) || isOffice(session);
}

function canEdit(session) {
  return isOwner(session) || isOffice(session);
}

function canMoney(session) {
  return isOwner(session) || isOffice(session);
}

function canDeleteJobs(session) {
  return isOwner(session);
}

function canDeleteCrew(session) {
  return isOwner(session);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS,
  };
}

/** One-time migrate users: field → foreman */
function migrateUserRoles() {
  const users = store.getUsers();
  let changed = false;
  users.forEach((u) => {
    if (u.role === "field") {
      u.role = "foreman";
      u.permissions = defaultPermissions("foreman");
      changed = true;
    } else if (u.role === "foreman" || u.role === "office" || u.role === "owner") {
      u.permissions = defaultPermissions(u.role);
    }
  });
  if (changed) store.saveUsers(users);
  return changed;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_MS,
  IDLE_MS,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  publicUser,
  defaultPermissions,
  normalizeRole,
  isOwner,
  isOffice,
  isForeman,
  canApprove,
  canEdit,
  canMoney,
  canDeleteJobs,
  canDeleteCrew,
  cookieOptions,
  migrateUserRoles,
};
