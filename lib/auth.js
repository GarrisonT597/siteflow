"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const store = require("./store");

const SESSION_COOKIE = "sf_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const SALT_ROUNDS = 10;

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  // support legacy plain during migration — not used after seed
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
  sessions[token] = {
    token,
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    username: user.username,
    name: user.name,
    crewId: user.crewId || null,
    createdAt: now,
    lastActive: now,
  };
  // prune expired
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
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    companyId: u.companyId,
    crewId: u.crewId || null,
    permissions: u.permissions || defaultPermissions(u.role),
  };
}

function defaultPermissions(role) {
  if (role === "owner") {
    return { admin: true, money: true, approve: true, edit: true, field: true };
  }
  if (role === "office") {
    return { admin: false, money: true, approve: true, edit: true, field: false };
  }
  return { admin: false, money: false, approve: false, edit: false, field: true };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS,
  };
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
  cookieOptions,
};
