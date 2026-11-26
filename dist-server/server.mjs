// server.ts
import crypto2 from "crypto";
import express from "express";
import fs2 from "fs";
import http from "http";
import https from "https";
import os from "os";
import path2 from "path";
import { WebSocket, WebSocketServer } from "ws";

// server/store.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
function normalizePhoneNumber(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  return hasPlus ? `+${digits}` : digits;
}
var DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");
var VAULT_DIR = path.resolve(DATA_DIR, "vault");
var DB_PATH = path.resolve(DATA_DIR, "db.json");
function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const emptyDb = {
      users: [],
      cloudDocs: [],
      pairings: {}
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb, null, 2), "utf8");
  }
}
function readDb() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      cloudDocs: Array.isArray(parsed.cloudDocs) ? parsed.cloudDocs : [],
      pairings: parsed.pairings && typeof parsed.pairings === "object" ? parsed.pairings : {}
    };
  } catch {
    return { users: [], cloudDocs: [], pairings: {} };
  }
}
function writeDb(db) {
  ensureStorage();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "scan_file";
}
function resolveVaultPath(vaultFileName) {
  ensureStorage();
  const safeName = sanitizeFileName(path.basename(vaultFileName));
  const resolved = path.resolve(VAULT_DIR, safeName);
  if (!resolved.startsWith(VAULT_DIR + path.sep)) {
    throw new Error("Invalid vault path");
  }
  return resolved;
}

// server.ts
var PORT = Number(process.env.PORT) || 3e3;
var HTTPS_PORT = Number(process.env.HTTPS_PORT) || 0;
var APP_ROOT = process.env.APP_ROOT || process.cwd();
var SESSION_SECRET = process.env.SESSION_SECRET || crypto2.randomBytes(32).toString("hex");
var NATIVE_DIR = path2.resolve(APP_ROOT, "native-ecosystem");
var FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
function loadFirebaseProjectId() {
  try {
    const cfgPath = path2.resolve(APP_ROOT, "firebase-applet-config.json");
    if (fs2.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs2.readFileSync(cfgPath, "utf8"));
      if (parsed.projectId) return parsed.projectId;
    }
  } catch {
  }
  return "";
}
var FIREBASE_PROJECT_ID = loadFirebaseProjectId();
var cachedCerts = null;
async function getFirebasePublicCerts() {
  if (cachedCerts && cachedCerts.expiresAt > Date.now()) {
    return cachedCerts.certs;
  }
  const resp = await fetch(FIREBASE_CERTS_URL);
  if (!resp.ok) {
    throw new Error("Could not fetch Google public signing keys");
  }
  const cacheControl = resp.headers.get("cache-control") || "";
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1e3 : 3600 * 1e3;
  const certs = await resp.json();
  cachedCerts = { certs, expiresAt: Date.now() + ttlMs };
  return certs;
}
async function verifyFirebaseIdToken(idToken) {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error("Firebase project is not configured on this server");
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed Firebase ID token");
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid token algorithm or key identifier");
  }
  let certs = await getFirebasePublicCerts();
  let certPem = certs[header.kid];
  if (!certPem) {
    cachedCerts = null;
    certs = await getFirebasePublicCerts();
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error("Unrecognized Firebase signing certificate");
  }
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = Buffer.from(sigB64, "base64url");
  const sigValid = crypto2.verify("RSA-SHA256", signedData, certPem, signature);
  if (!sigValid) {
    throw new Error("Firebase ID token signature verification failed");
  }
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  const nowSec = Math.floor(Date.now() / 1e3);
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error("Firebase token audience mismatch");
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error("Firebase token issuer mismatch");
  }
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) {
    throw new Error("Invalid Firebase user subject");
  }
  if (!payload.exp || payload.exp <= nowSec || !payload.iat || payload.iat > nowSec + 300) {
    throw new Error("Firebase token expired or not yet valid");
  }
  const rawProvider = payload.firebase?.sign_in_provider || "google.com";
  const provider = rawProvider === "google.com" ? "google" : rawProvider === "github.com" ? "github" : rawProvider === "microsoft.com" ? "microsoft" : rawProvider === "apple.com" ? "apple" : rawProvider === "phone" ? "phone" : "password";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const phone = normalizePhoneNumber(payload.phone_number);
  const displayName = typeof payload.name === "string" && payload.name.trim() || (email ? email.split("@")[0] : phone || "Scanner User");
  return {
    uid: payload.sub,
    email,
    displayName: displayName.slice(0, 60),
    phone: phone || void 0,
    provider,
    emailVerified: Boolean(payload.email_verified) || provider !== "password"
  };
}
function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    provider: u.provider || "password",
    displayName: u.displayName,
    verified: u.verified,
    createdAt: u.createdAt
  };
}
function findUserByIdentifier(users, rawIdentifier) {
  const trimmed = rawIdentifier.trim();
  if (!trimmed) return void 0;
  if (trimmed.includes("@")) {
    const normalizedEmail = trimmed.toLowerCase();
    return users.find((u) => u.email === normalizedEmail);
  }
  const normalizedPhone = normalizePhoneNumber(trimmed);
  if (!normalizedPhone) return void 0;
  const digits = normalizedPhone.replace(/\D/g, "");
  return users.find((u) => {
    if (!u.phone) return false;
    if (u.phone === normalizedPhone) return true;
    const storedDigits = u.phone.replace(/\D/g, "");
    return digits.length >= 10 && storedDigits.length >= 10 && storedDigits.slice(-10) === digits.slice(-10);
  });
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto2.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expectedSig = crypto2.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto2.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.userId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function isHttpsRequest(req) {
  const xfProto = req.headers["x-forwarded-proto"];
  return req.secure || xfProto === "https";
}
function setSessionCookie(req, res, token) {
  const https2 = isHttpsRequest(req);
  if (https2) {
    res.setHeader(
      "Set-Cookie",
      `scanner_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
  } else {
    res.setHeader(
      "Set-Cookie",
      `scanner_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
  }
}
function clearSessionCookie(req, res) {
  const https2 = isHttpsRequest(req);
  if (https2) {
    res.setHeader(
      "Set-Cookie",
      "scanner_session=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0"
    );
  } else {
    res.setHeader("Set-Cookie", "scanner_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  }
}
function readCookieValue(req, name) {
  const header = req.headers.cookie;
  if (!header) return "";
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const verified = verifyToken(token);
  if (!verified) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.authUser = verified;
  next();
}
function generatePairCode() {
  const num = crypto2.randomInt(1e5, 999999);
  return String(num);
}
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "30mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "Oklivo Scanner", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.post("/api/auth/register", (req, res) => {
    const { email, phone, password, displayName, recoveryPhrase } = req.body ?? {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const hasEmail = normalizedEmail.includes("@");
    const normalizedPhone = normalizePhoneNumber(phone);
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password (min 6 characters) is required." });
      return;
    }
    if (!hasEmail && !normalizedPhone) {
      res.status(400).json({ error: "Provide a valid email address or mobile number (7-15 digits)." });
      return;
    }
    if (normalizedEmail && !hasEmail) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }
    if (typeof phone === "string" && phone.trim() && !normalizedPhone) {
      res.status(400).json({ error: "Mobile number must contain 7-15 digits (e.g. +919876543210)." });
      return;
    }
    const db = readDb();
    if (hasEmail && db.users.some((u) => u.email === normalizedEmail)) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    if (normalizedPhone && findUserByIdentifier(db.users, normalizedPhone)) {
      res.status(409).json({ error: "An account with this mobile number already exists." });
      return;
    }
    const cleanRecovery = typeof recoveryPhrase === "string" ? recoveryPhrase.trim() : "";
    const fallbackName = hasEmail ? normalizedEmail.split("@")[0] : normalizedPhone;
    const newUser = {
      id: crypto2.randomUUID(),
      email: normalizedEmail,
      phone: normalizedPhone || void 0,
      provider: !hasEmail && normalizedPhone ? "phone" : "password",
      displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 60) : fallbackName,
      passwordHash: hashPassword(password),
      recoveryHash: cleanRecovery.length >= 4 ? hashPassword(cleanRecovery) : void 0,
      verified: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.users.push(newUser);
    writeDb(db);
    const token = signToken({
      userId: newUser.id,
      email: newUser.email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
    });
    setSessionCookie(req, res, token);
    res.status(201).json({ token, user: toPublicUser(newUser) });
  });
  app.post("/api/auth/login", (req, res) => {
    const { identifier, email, password } = req.body ?? {};
    const rawId = typeof identifier === "string" ? identifier : typeof email === "string" ? email : "";
    if (!rawId.trim() || typeof password !== "string") {
      res.status(400).json({ error: "Email or mobile number and password are required." });
      return;
    }
    const db = readDb();
    const user = findUserByIdentifier(db.users, rawId);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid credentials. Check your email/mobile number and password." });
      return;
    }
    const token = signToken({
      userId: user.id,
      email: user.email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
    });
    setSessionCookie(req, res, token);
    res.json({ token, user: toPublicUser(user) });
  });
  app.post("/api/auth/firebase", async (req, res) => {
    const { idToken, phone } = req.body ?? {};
    if (typeof idToken !== "string" || !idToken.trim()) {
      res.status(400).json({ error: "Firebase ID token is required." });
      return;
    }
    try {
      const identity = await verifyFirebaseIdToken(idToken.trim());
      const db = readDb();
      const extraPhone = normalizePhoneNumber(phone) || identity.phone;
      let user = db.users.find((u) => u.firebaseUid === identity.uid) || (identity.email ? db.users.find((u) => u.email === identity.email) : void 0) || (extraPhone ? findUserByIdentifier(db.users, extraPhone) : void 0);
      if (!user) {
        user = {
          id: crypto2.randomUUID(),
          email: identity.email,
          phone: extraPhone || void 0,
          firebaseUid: identity.uid,
          provider: identity.provider,
          displayName: identity.displayName,
          passwordHash: hashPassword(crypto2.randomBytes(24).toString("hex")),
          verified: identity.emailVerified,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        db.users.push(user);
      } else {
        user.firebaseUid = identity.uid;
        user.provider = identity.provider;
        if (!user.displayName && identity.displayName) user.displayName = identity.displayName;
        if (!user.email && identity.email) user.email = identity.email;
        if (extraPhone && !user.phone) user.phone = extraPhone;
      }
      writeDb(db);
      const token = signToken({
        userId: user.id,
        email: user.email,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
      });
      setSessionCookie(req, res, token);
      res.json({ token, user: toPublicUser(user) });
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : "Could not verify social login token."
      });
    }
  });
  app.post("/api/auth/phone", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const { phone } = req.body ?? {};
    if (typeof phone !== "string") {
      res.status(400).json({ error: "Phone value is required." });
      return;
    }
    const trimmed = phone.trim();
    const normalizedPhone = trimmed ? normalizePhoneNumber(trimmed) : "";
    if (trimmed && !normalizedPhone) {
      res.status(400).json({ error: "Enter a valid mobile number (7-15 digits, e.g. +919876543210)." });
      return;
    }
    const db = readDb();
    const user = db.users.find((u) => u.id === authUser.userId);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (normalizedPhone) {
      const conflict = findUserByIdentifier(
        db.users.filter((u) => u.id !== user.id),
        normalizedPhone
      );
      if (conflict) {
        res.status(409).json({ error: "This mobile number is already linked to another account." });
        return;
      }
      user.phone = normalizedPhone;
    } else {
      if (!user.email) {
        res.status(400).json({ error: "Cannot remove mobile number when no email is linked to this account." });
        return;
      }
      delete user.phone;
    }
    writeDb(db);
    res.json({ user: toPublicUser(user) });
  });
  app.post("/api/auth/reset-password", (req, res) => {
    const { identifier, email, recoveryPhrase, newPassword } = req.body ?? {};
    const rawId = typeof identifier === "string" ? identifier : typeof email === "string" ? email : "";
    if (!rawId.trim() || typeof recoveryPhrase !== "string" || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "Email/mobile number, recovery phrase, and new password (min 6 characters) are required." });
      return;
    }
    const db = readDb();
    const user = findUserByIdentifier(db.users, rawId);
    if (!user || !user.recoveryHash || !verifyPassword(recoveryPhrase.trim(), user.recoveryHash)) {
      res.status(401).json({ error: "Invalid account identifier or recovery key." });
      return;
    }
    user.passwordHash = hashPassword(newPassword);
    writeDb(db);
    res.json({ ok: true });
  });
  app.post("/api/auth/change-password", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "Current password and new password (min 6 chars) are required." });
      return;
    }
    const db = readDb();
    const user = db.users.find((u) => u.id === authUser.userId);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    user.passwordHash = hashPassword(newPassword);
    writeDb(db);
    res.json({ ok: true });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const db = readDb();
    const user = db.users.find((u) => u.id === authUser.userId);
    if (!user) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });
  app.get("/api/auth/session", (req, res) => {
    const cookieToken = readCookieValue(req, "scanner_session");
    if (!cookieToken) {
      res.json({ token: "", user: null });
      return;
    }
    const verified = verifyToken(cookieToken);
    if (!verified) {
      clearSessionCookie(req, res);
      res.json({ token: "", user: null });
      return;
    }
    const db = readDb();
    const user = db.users.find((u) => u.id === verified.userId);
    if (!user) {
      clearSessionCookie(req, res);
      res.json({ token: "", user: null });
      return;
    }
    res.json({ token: cookieToken, user: toPublicUser(user) });
  });
  app.post("/api/auth/logout", (req, res) => {
    const requestedWith = req.headers["x-requested-with"];
    const origin = req.headers.origin;
    const expectedHost = req.headers["x-forwarded-host"] || req.headers.host;
    let originOk = requestedWith === "XMLHttpRequest";
    if (!originOk && typeof origin === "string" && expectedHost) {
      try {
        originOk = new URL(origin).host === expectedHost;
      } catch {
        originOk = false;
      }
    }
    if (!originOk) {
      res.status(403).json({ error: "Forbidden CSRF check" });
      return;
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  app.delete("/api/auth/account", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const db = readDb();
    const userDocs = db.cloudDocs.filter((d) => d.userId === authUser.userId);
    for (const doc of userDocs) {
      try {
        const p = resolveVaultPath(doc.vaultFileName);
        if (fs2.existsSync(p)) fs2.unlinkSync(p);
      } catch {
      }
    }
    db.cloudDocs = db.cloudDocs.filter((d) => d.userId !== authUser.userId);
    db.users = db.users.filter((u) => u.id !== authUser.userId);
    writeDb(db);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  app.post("/api/pairing/create", (req, res) => {
    const { existingCode, desktopName } = req.body ?? {};
    const db = readDb();
    if (typeof existingCode === "string" && /^\d{6}$/.test(existingCode) && db.pairings[existingCode]) {
      res.json(db.pairings[existingCode]);
      return;
    }
    let code = generatePairCode();
    while (db.pairings[code]) {
      code = generatePairCode();
    }
    const session = {
      pairCode: code,
      desktopName: typeof desktopName === "string" && desktopName.trim() ? desktopName.trim().slice(0, 50) : "Windows Desktop Workbench",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      devices: [],
      pendingTransfers: []
    };
    db.pairings[code] = session;
    writeDb(db);
    res.status(201).json(session);
  });
  app.get("/api/pairing/:code", (req, res) => {
    const code = req.params.code;
    const db = readDb();
    const session = db.pairings[code];
    if (!session) {
      res.status(404).json({ error: "Pairing code not found or expired" });
      return;
    }
    res.json(session);
  });
  app.delete("/api/pairing/:code/devices/:deviceId", (req, res) => {
    const { code, deviceId } = req.params;
    const db = readDb();
    const session = db.pairings[code];
    if (!session) {
      res.status(404).json({ error: "Pairing session not found" });
      return;
    }
    session.devices = session.devices.filter((d) => d.id !== deviceId);
    writeDb(db);
    broadcastToChannel(code, {
      type: "device:removed",
      deviceId,
      devices: session.devices
    });
    res.json({ ok: true, devices: session.devices });
  });
  app.get("/api/cloud/documents", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const db = readDb();
    const docs = db.cloudDocs.filter((d) => d.userId === authUser.userId).map((d) => {
      let dataUrl = "";
      try {
        const filePath = resolveVaultPath(d.vaultFileName);
        if (fs2.existsSync(filePath)) {
          dataUrl = fs2.readFileSync(filePath, "utf8");
        }
      } catch {
        dataUrl = "";
      }
      return { ...d, dataUrl };
    });
    res.json({ documents: docs });
  });
  app.post("/api/cloud/documents", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const doc = req.body;
    if (!doc || typeof doc.id !== "string" || typeof doc.dataUrl !== "string" || typeof doc.sha256 !== "string") {
      res.status(400).json({ error: "Invalid document payload" });
      return;
    }
    const db = readDb();
    const existingByHash = db.cloudDocs.find(
      (d) => d.userId === authUser.userId && d.sha256 === doc.sha256 && d.id !== doc.id
    );
    if (existingByHash) {
      res.json({ duplicate: true, document: existingByHash });
      return;
    }
    const vaultFileName = sanitizeFileName(`${authUser.userId.slice(0, 8)}_${doc.id}.dat`);
    const vaultPath = resolveVaultPath(vaultFileName);
    fs2.writeFileSync(vaultPath, doc.dataUrl, "utf8");
    const existingIdx = db.cloudDocs.findIndex((d) => d.userId === authUser.userId && d.id === doc.id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      id: doc.id,
      userId: authUser.userId,
      title: String(doc.title || "Scanned Document").slice(0, 120),
      fileName: sanitizeFileName(String(doc.fileName || "scan.jpg")),
      category: String(doc.category || "Scans"),
      folder: String(doc.folder || "Documents/Scans"),
      mimeType: String(doc.mimeType || "image/jpeg"),
      sizeBytes: Number(doc.sizeBytes || doc.dataUrl.length),
      pageCount: Number(doc.pageCount || 1),
      ocrText: typeof doc.ocrText === "string" ? doc.ocrText : "",
      sourceDevice: String(doc.sourceDevice || "Mobile"),
      sha256: doc.sha256,
      version: existingIdx >= 0 ? db.cloudDocs[existingIdx].version + 1 : 1,
      vaultFileName,
      createdAt: existingIdx >= 0 ? db.cloudDocs[existingIdx].createdAt : now,
      updatedAt: now
    };
    if (existingIdx >= 0) {
      db.cloudDocs[existingIdx] = record;
    } else {
      db.cloudDocs.unshift(record);
    }
    writeDb(db);
    res.status(201).json({ document: record });
  });
  app.delete("/api/cloud/documents/:id", requireAuth, (req, res) => {
    const authUser = req.authUser;
    const docId = req.params.id;
    const db = readDb();
    const target = db.cloudDocs.find((d) => d.userId === authUser.userId && d.id === docId);
    if (!target) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    try {
      const p = resolveVaultPath(target.vaultFileName);
      if (fs2.existsSync(p)) fs2.unlinkSync(p);
    } catch {
    }
    db.cloudDocs = db.cloudDocs.filter((d) => !(d.userId === authUser.userId && d.id === docId));
    writeDb(db);
    res.json({ ok: true });
  });
  app.get("/api/native-files", (_req, res) => {
    if (!fs2.existsSync(NATIVE_DIR)) {
      res.json({ files: [] });
      return;
    }
    const results = [];
    function walk(dir) {
      const entries = fs2.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path2.resolve(dir, entry.name);
        if (!full.startsWith(NATIVE_DIR + path2.sep)) continue;
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const rel = path2.relative(NATIVE_DIR, full).replace(/\\/g, "/");
          const ext = path2.extname(rel).slice(1);
          results.push({
            path: rel,
            content: fs2.readFileSync(full, "utf8"),
            language: ext || "text"
          });
        }
      }
    }
    walk(NATIVE_DIR);
    res.json({ files: results });
  });
  const sharedArtifacts = /* @__PURE__ */ new Map();
  app.post("/api/share", (req, res) => {
    const { title, fileName, mimeType, dataUrl } = req.body ?? {};
    if (typeof dataUrl !== "string" || typeof mimeType !== "string") {
      res.status(400).json({ error: "Document dataUrl and mimeType are required." });
      return;
    }
    const allowedMime = mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp";
    if (!allowedMime) {
      res.status(400).json({ error: "Only PDF, JPEG, PNG, and WEBP sharing is supported." });
      return;
    }
    const commaIdx = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || commaIdx < 0) {
      res.status(400).json({ error: "Invalid base64 dataUrl." });
      return;
    }
    const bytes = Buffer.from(dataUrl.slice(commaIdx + 1), "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
      res.status(400).json({ error: "File size exceeds 20 MB share limit." });
      return;
    }
    const now = Date.now();
    for (const [key, item] of sharedArtifacts.entries()) {
      if (item.expiresAt < now) sharedArtifacts.delete(key);
    }
    while (sharedArtifacts.size >= 80) {
      const oldestKey = sharedArtifacts.keys().next().value;
      if (!oldestKey) break;
      sharedArtifacts.delete(oldestKey);
    }
    const shareId = crypto2.randomBytes(8).toString("base64url");
    const expiresAt = now + 24 * 60 * 60 * 1e3;
    const cleanFileName = sanitizeFileName(
      typeof fileName === "string" && fileName.trim() ? fileName : "shared_document"
    );
    sharedArtifacts.set(shareId, {
      id: shareId,
      title: typeof title === "string" ? title.slice(0, 120) : cleanFileName,
      fileName: cleanFileName,
      mimeType,
      bytes,
      expiresAt
    });
    res.status(201).json({
      shareId,
      expiresAt: new Date(expiresAt).toISOString()
    });
  });
  app.get("/api/share/:shareId", (req, res) => {
    const item = sharedArtifacts.get(req.params.shareId);
    if (!item || item.expiresAt < Date.now()) {
      sharedArtifacts.delete(req.params.shareId);
      res.status(404).send("Share link expired or not found.");
      return;
    }
    const forceDownload = req.query.download === "1";
    res.setHeader("Content-Type", item.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `${forceDownload ? "attachment" : "inline"}; filename="${item.fileName}"`
    );
    res.send(item.bytes);
  });
  app.get("/api/wifi-camera/snapshot", async (req, res) => {
    const rawUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: "Invalid camera URL." });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.status(400).json({ error: "Only HTTP/HTTPS snapshot URLs are allowed." });
      return;
    }
    const host = parsed.hostname.toLowerCase();
    const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"];
    if (blockedHosts.includes(host) || host.startsWith("127.") || host.startsWith("169.254.") || host.endsWith(".internal")) {
      res.status(403).json({ error: "Loopback and cloud metadata addresses are blocked." });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "error"
      });
      if (!upstream.ok) {
        res.status(502).json({ error: `Camera responded with HTTP ${upstream.status}` });
        return;
      }
      const ct = (upstream.headers.get("content-type") || "").toLowerCase();
      if (!ct.startsWith("image/")) {
        res.status(415).json({ error: "Camera URL did not return an image snapshot." });
        return;
      }
      const arr = await upstream.arrayBuffer();
      if (arr.byteLength > 6 * 1024 * 1024) {
        res.status(413).json({ error: "Snapshot frame exceeded 6 MB limit." });
        return;
      }
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(Buffer.from(arr));
    } catch {
      res.status(504).json({ error: "Could not reach Wi-Fi camera at that URL." });
    } finally {
      clearTimeout(timer);
    }
  });
  function lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
      }
    }
    return out;
  }
  app.get("/api/lan-info", (_req, res) => {
    const urls = [];
    for (const ip of lanAddresses()) {
      if (HTTPS_PORT) urls.push(`https://${ip}:${HTTPS_PORT}`);
      urls.push(`http://${ip}:${PORT}`);
    }
    res.json({ urls });
  });
  const server = http.createServer(app);
  let httpsServer = null;
  const wss = new WebSocketServer({ noServer: true });
  const attachUpgrade = (target) => {
    target.on("upgrade", (req, socket, head) => {
      const pathname = (req.url || "").split("?")[0];
      if (pathname === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      } else {
        socket.destroy();
      }
    });
  };
  attachUpgrade(server);
  const clients = /* @__PURE__ */ new Set();
  function broadcastToChannel(pairCode, payload, excludeWs) {
    const msg = JSON.stringify(payload);
    for (const client of clients) {
      if (client.pairCode === pairCode && client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }
  wss.on("connection", (ws) => {
    let meta = null;
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const type = String(msg.type || "");
        if (type === "register") {
          const role = msg.role === "mobile" ? "mobile" : "desktop";
          const pairCode = String(msg.pairCode || "");
          const deviceId = String(msg.deviceId || crypto2.randomUUID());
          const deviceName = String(msg.deviceName || (role === "mobile" ? "Android Mobile" : "Windows Desktop")).slice(0, 60);
          const platform = String(msg.platform || (role === "mobile" ? "Mobile Web" : "Windows"));
          const db = readDb();
          if (!db.pairings[pairCode]) {
            if (role === "desktop") {
              db.pairings[pairCode] = {
                pairCode,
                desktopName: deviceName,
                createdAt: (/* @__PURE__ */ new Date()).toISOString(),
                devices: [],
                pendingTransfers: []
              };
            } else {
              ws.send(JSON.stringify({ type: "error", message: "Invalid pairing code. Check your Windows Desktop screen." }));
              return;
            }
          }
          meta = { ws, role, pairCode, deviceId, deviceName, platform };
          clients.add(meta);
          const session = db.pairings[pairCode];
          if (role === "mobile") {
            const existing = session.devices.find((d) => d.id === deviceId);
            const now = (/* @__PURE__ */ new Date()).toISOString();
            if (existing) {
              existing.connected = true;
              existing.lastSeen = now;
              existing.name = deviceName;
            } else {
              session.devices.push({
                id: deviceId,
                name: deviceName,
                platform,
                connected: true,
                lastSeen: now,
                pairedAt: now
              });
            }
            writeDb(db);
          }
          ws.send(
            JSON.stringify({
              type: "registered",
              pairCode,
              role,
              desktopName: session.desktopName,
              devices: session.devices
            })
          );
          broadcastToChannel(
            pairCode,
            {
              type: "presence:update",
              devices: session.devices,
              desktopOnline: Array.from(clients).some((c) => c.pairCode === pairCode && c.role === "desktop")
            },
            void 0
          );
          if (role === "desktop" && session.pendingTransfers.length > 0) {
            for (const docPayload of session.pendingTransfers) {
              ws.send(JSON.stringify({ type: "transfer:incoming", document: docPayload }));
            }
            session.pendingTransfers = [];
            writeDb(db);
          }
          return;
        }
        if (!meta) return;
        if (type === "transfer:document") {
          const doc = msg.document;
          if (!doc || typeof doc.id !== "string") return;
          const desktopClients = Array.from(clients).filter(
            (c) => c.pairCode === meta.pairCode && c.role === "desktop" && c.ws.readyState === WebSocket.OPEN
          );
          if (desktopClients.length > 0) {
            for (const desktop of desktopClients) {
              desktop.ws.send(
                JSON.stringify({
                  type: "transfer:incoming",
                  fromDeviceId: meta.deviceId,
                  fromDeviceName: meta.deviceName,
                  document: doc
                })
              );
            }
            ws.send(JSON.stringify({ type: "transfer:ack", documentId: doc.id, status: "delivered" }));
          } else {
            const db = readDb();
            const session = db.pairings[meta.pairCode];
            if (session) {
              const alreadyQueued = session.pendingTransfers.some((p) => p.id === doc.id);
              if (!alreadyQueued) {
                session.pendingTransfers.push(doc);
                if (session.pendingTransfers.length > 25) {
                  session.pendingTransfers = session.pendingTransfers.slice(-25);
                }
                writeDb(db);
              }
            }
            ws.send(JSON.stringify({ type: "transfer:ack", documentId: doc.id, status: "buffered" }));
          }
          return;
        }
        if (type === "ping") {
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
      } catch {
      }
    });
    ws.on("close", () => {
      if (!meta) return;
      clients.delete(meta);
      const db = readDb();
      const session = db.pairings[meta.pairCode];
      if (session) {
        if (meta.role === "mobile") {
          const dev = session.devices.find((d) => d.id === meta.deviceId);
          if (dev) {
            dev.connected = false;
            dev.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
            writeDb(db);
          }
        }
        broadcastToChannel(meta.pairCode, {
          type: "presence:update",
          devices: session.devices,
          desktopOnline: Array.from(clients).some((c) => c.pairCode === meta.pairCode && c.role === "desktop")
        });
      }
    });
  });
  let viteServerRef = null;
  if (process.env.NODE_ENV !== "production") {
    if (!process.env.DISABLE_HMR) {
      process.env.DISABLE_HMR = "true";
    }
    const vitePromise = import("vite").then(
      (vite) => vite.createServer({
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: "spa"
      })
    ).then((viteServer) => {
      viteServerRef = viteServer;
      return viteServer;
    });
    vitePromise.catch((err) => {
      console.error("Failed to initialize Vite dev middleware:", err);
    });
    app.use((req, res, next) => {
      vitePromise.then((viteServer) => viteServer.middlewares(req, res, next)).catch(next);
    });
  } else {
    const distDir = path2.resolve(APP_ROOT, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path2.resolve(distDir, "index.html"));
    });
  }
  let listenAttempts = 0;
  const maxListenAttempts = 8;
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && listenAttempts < maxListenAttempts) {
      listenAttempts += 1;
      console.warn(`Port ${PORT} busy during restart, retrying (${listenAttempts}/${maxListenAttempts})...`);
      setTimeout(() => {
        server.listen(PORT, "0.0.0.0");
      }, 400);
      return;
    }
    console.error("Server listen error:", err);
    process.exit(1);
  });
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Oklivo Scanner running at http://0.0.0.0:${PORT}`);
  });
  if (HTTPS_PORT) {
    try {
      const dataDir = process.env.DATA_DIR || path2.resolve(process.cwd(), "data");
      const certDir = path2.resolve(dataDir, "cert");
      const keyPath = path2.resolve(certDir, "key.pem");
      const certPath = path2.resolve(certDir, "cert.pem");
      if (!fs2.existsSync(keyPath) || !fs2.existsSync(certPath)) {
        const mod = await import("selfsigned");
        const generate = mod.generate ?? mod.default?.generate;
        const altNames = [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
          ...lanAddresses().map((ip) => ({ type: 7, ip }))
        ];
        const pems = await Promise.resolve(
          generate([{ name: "commonName", value: "Oklivo Scanner" }], {
            days: 3650,
            keySize: 2048,
            algorithm: "sha256",
            extensions: [{ name: "subjectAltName", altNames }]
          })
        );
        fs2.mkdirSync(certDir, { recursive: true });
        fs2.writeFileSync(keyPath, pems.private);
        fs2.writeFileSync(certPath, pems.cert);
      }
      httpsServer = https.createServer(
        { key: fs2.readFileSync(keyPath), cert: fs2.readFileSync(certPath) },
        app
      );
      attachUpgrade(httpsServer);
      httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
        console.log(`HTTPS (self-signed) listening on https://0.0.0.0:${HTTPS_PORT}`);
      });
    } catch (err) {
      console.error("HTTPS listener could not start (continuing with HTTP only):", err);
    }
  }
  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      for (const client of clients) {
        try {
          client.ws.terminate();
        } catch {
        }
      }
      wss.close();
      httpsServer?.close();
      await Promise.race([
        new Promise((resolve) => server.close(() => resolve())),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
      if (viteServerRef) {
        await viteServerRef.close();
      }
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void gracefulShutdown());
  process.once("SIGINT", () => void gracefulShutdown());
}
startServer();
