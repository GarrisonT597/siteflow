const KEY_AUTH = "siteflow.auth.v5";
const KEY_DB = "siteflow.db.v5";
const KEY_PORTAL = "siteflow.portal.v5";
const OLD_DB_KEYS = ["siteflow.db.v4","siteflow.db.v3"];
const SESSION_MS = 8 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const PORTAL_MS = 8 * 60 * 60 * 1000;
const PHOTO_MAX = 700000;
const PLANS = { solo:{name:"Solo",price:49,crewCap:1}, crew:{name:"Crew",price:99,crewCap:5}, unlimited:{name:"Unlimited",price:199,crewCap:999} };
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const $ = (id) => document.getElementById(id);
let PICKED = "crew";
const esc = (s) => String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&":"&","<":"<",">":">",'"':""","'":"&#39;","`":"&#96;" }[c]));
function pad(n){ return String(n).padStart(2,"0"); }
function todayLocal(d){
  const x = d instanceof Date ? d : new Date();
  return x.getFullYear()+"-"+pad(x.getMonth()+1)+"-"+pad(x.getDate());
}
function addDays(iso, n){
  const [y,m,d] = iso.split("-").map(Number);
  return todayLocal(new Date(y, m-1, d + n));
}
function uid(p){ return p+"-"+Math.random().toString(36).slice(2,10); }
function rateOf(crewId){ return (typeof DB !== "undefined" ? DB.crew : []).find(c => c.id === crewId)?.rate || 0; }
