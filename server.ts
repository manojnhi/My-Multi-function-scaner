import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CloudDocRecord,
  hashPassword,
  normalizePhoneNumber,
  PairingSession,
  readDb,
  resolveVaultPath,
  sanitizeFileName,
  StoredUser,
  verifyPassword,
  writeDb,
} from './server/store.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const NATIVE_DIR = path.resolve(process.cwd(), 'native-ecosystem');
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

function loadFirebaseProjectId(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    }
  } catch {
    // ignore missing config
  }
  return '';
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();
let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && cachedCerts.expiresAt > Date.now()) {
    return cachedCerts.certs;
  }
  const resp = await fetch(FIREBASE_CERTS_URL);
  if (!resp.ok) {
    throw new Error('Could not fetch Google public signing keys');
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  const certs = (await resp.json()) as Record<string, string>;
  cachedCerts = { certs, expiresAt: Date.now() + ttlMs };
  return certs;
}

interface VerifiedFirebaseIdentity {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  provider: 'google' | 'github' | 'microsoft' | 'apple' | 'phone' | 'password';
  emailVerified: boolean;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity> {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error('Firebase project is not configured on this server');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid token algorithm or key identifier');
  }
  let certs = await getFirebasePublicCerts();
  let certPem = certs[header.kid];
  if (!certPem) {
    cachedCerts = null;
    certs = await getFirebasePublicCerts();
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error('Unrecognized Firebase signing certificate');
  }
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = Buffer.from(sigB64, 'base64url');
  const sigValid = crypto.verify('RSA-SHA256', signedData, certPem, signature);
  if (!sigValid) {
    throw new Error('Firebase ID token signature verification failed');
  }
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    phone_number?: string;
    firebase?: { sign_in_provider?: string };
  };
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error('Firebase token audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error('Firebase token issuer mismatch');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new Error('Invalid Firebase user subject');
  }
  if (!payload.exp || payload.exp <= nowSec || !payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Firebase token expired or not yet valid');
  }

  const rawProvider = payload.firebase?.sign_in_provider || 'google.com';
  const provider: VerifiedFirebaseIdentity['provider'] =
    rawProvider === 'google.com'
      ? 'google'
      : rawProvider === 'github.com'
        ? 'github'
        : rawProvider === 'microsoft.com'
          ? 'microsoft'
          : rawProvider === 'apple.com'
            ? 'apple'
            : rawProvider === 'phone'
              ? 'phone'
              : 'password';

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const phone = normalizePhoneNumber(payload.phone_number);
  const displayName =
    (typeof payload.name === 'string' && payload.name.trim()) ||
    (email ? email.split('@')[0] : phone || 'Scanner User');

  return {
    uid: payload.sub,
    email,
    displayName: displayName.slice(0, 60),
    phone: phone || undefined,
    provider,
    emailVerified: Boolean(payload.email_verified) || provider !== 'password',
  };
}

function toPublicUser(u: StoredUser) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    provider: (u.provider as VerifiedFirebaseIdentity['provider']) || 'password',
    displayName: u.displayName,
    verified: u.verified,
    createdAt: u.createdAt,
  };
}

function findUserByIdentifier(users: StoredUser[], rawIdentifier: string): StoredUser | undefined {
  const trimmed = rawIdentifier.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('@')) {
    const normalizedEmail = trimmed.toLowerCase();
    return users.find((u) => u.email === normalizedEmail);
  }
  const normalizedPhone = normalizePhoneNumber(trimmed);
  if (!normalizedPhone) return undefined;
  const digits = normalizedPhone.replace(/\D/g, '');
  return users.find((u) => {
    if (!u.phone) return false;
    if (u.phone === normalizedPhone) return true;
    const storedDigits = u.phone.replace(/\D/g, '');
    return digits.length >= 10 && storedDigits.length >= 10 && storedDigits.slice(-10) === digits.slice(-10);
  });
}

interface AuthTokenPayload {
  userId: string;
  email: string;
  exp: number;
}

function signToken(payload: AuthTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!payload.userId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function isHttpsRequest(req: express.Request): boolean {
  const xfProto = req.headers['x-forwarded-proto'];
  return req.secure || xfProto === 'https';
}

function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const https = isHttpsRequest(req);
  if (https) {
    res.setHeader(
      'Set-Cookie',
      `scanner_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `scanner_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
  }
}

function clearSessionCookie(req: express.Request, res: express.Response): void {
  const https = isHttpsRequest(req);
  if (https) {
    res.setHeader(
      'Set-Cookie',
      'scanner_session=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0'
    );
  } else {
    res.setHeader('Set-Cookie', 'scanner_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  }
}

function readCookieValue(req: express.Request, name: string): string {
  const header = req.headers.cookie;
  if (!header) return '';
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const verified = verifyToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  (req as express.Request & { authUser: AuthTokenPayload }).authUser = verified;
  next();
}

function generatePairCode(): string {
  const num = crypto.randomInt(100000, 999999);
  return String(num);
}

interface WsClientMeta {
  ws: WebSocket;
  role: 'desktop' | 'mobile';
  pairCode: string;
  deviceId: string;
  deviceName: string;
  platform: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'My Multi Functional Scanner', timestamp: new Date().toISOString() });
  });

  // Auth: Register (supports Email, Mobile Number, or both)
  app.post('/api/auth/register', (req, res) => {
    const { email, phone, password, displayName, recoveryPhrase } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const hasEmail = normalizedEmail.includes('@');
    const normalizedPhone = normalizePhoneNumber(phone);

    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password (min 6 characters) is required.' });
      return;
    }
    if (!hasEmail && !normalizedPhone) {
      res.status(400).json({ error: 'Provide a valid email address or mobile number (7-15 digits).' });
      return;
    }
    if (normalizedEmail && !hasEmail) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (typeof phone === 'string' && phone.trim() && !normalizedPhone) {
      res.status(400).json({ error: 'Mobile number must contain 7-15 digits (e.g. +919876543210).' });
      return;
    }

    const db = readDb();
    if (hasEmail && db.users.some((u) => u.email === normalizedEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    if (normalizedPhone && findUserByIdentifier(db.users, normalizedPhone)) {
      res.status(409).json({ error: 'An account with this mobile number already exists.' });
      return;
    }

    const cleanRecovery = typeof recoveryPhrase === 'string' ? recoveryPhrase.trim() : '';
    const fallbackName = hasEmail ? normalizedEmail.split('@')[0] : normalizedPhone;
    const newUser: StoredUser = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      phone: normalizedPhone || undefined,
      provider: !hasEmail && normalizedPhone ? 'phone' : 'password',
      displayName:
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim().slice(0, 60)
          : fallbackName,
      passwordHash: hashPassword(password),
      recoveryHash: cleanRecovery.length >= 4 ? hashPassword(cleanRecovery) : undefined,
      verified: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);
    writeDb(db);

    const token = signToken({
      userId: newUser.id,
      email: newUser.email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    setSessionCookie(req, res, token);
    res.status(201).json({ token, user: toPublicUser(newUser) });
  });

  // Auth: Login (supports Email OR Mobile Number)
  app.post('/api/auth/login', (req, res) => {
    const { identifier, email, password } = req.body ?? {};
    const rawId = typeof identifier === 'string' ? identifier : typeof email === 'string' ? email : '';
    if (!rawId.trim() || typeof password !== 'string') {
      res.status(400).json({ error: 'Email or mobile number and password are required.' });
      return;
    }
    const db = readDb();
    const user = findUserByIdentifier(db.users, rawId);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid credentials. Check your email/mobile number and password.' });
      return;
    }
    const token = signToken({
      userId: user.id,
      email: user.email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    setSessionCookie(req, res, token);
    res.json({ token, user: toPublicUser(user) });
  });

  // Auth: Social / Firebase ID Token Exchange (Google, GitHub, Microsoft, Apple)
  app.post('/api/auth/firebase', async (req, res) => {
    const { idToken, phone } = req.body ?? {};
    if (typeof idToken !== 'string' || !idToken.trim()) {
      res.status(400).json({ error: 'Firebase ID token is required.' });
      return;
    }
    try {
      const identity = await verifyFirebaseIdToken(idToken.trim());
      const db = readDb();
      const extraPhone = normalizePhoneNumber(phone) || identity.phone;

      let user =
        db.users.find((u) => u.firebaseUid === identity.uid) ||
        (identity.email ? db.users.find((u) => u.email === identity.email) : undefined) ||
        (extraPhone ? findUserByIdentifier(db.users, extraPhone) : undefined);

      if (!user) {
        user = {
          id: crypto.randomUUID(),
          email: identity.email,
          phone: extraPhone || undefined,
          firebaseUid: identity.uid,
          provider: identity.provider,
          displayName: identity.displayName,
          passwordHash: hashPassword(crypto.randomBytes(24).toString('hex')),
          verified: identity.emailVerified,
          createdAt: new Date().toISOString(),
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
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      setSessionCookie(req, res, token);
      res.json({ token, user: toPublicUser(user) });
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : 'Could not verify social login token.',
      });
    }
  });

  // Auth: Add or Update Mobile Number for Signed-In User
  app.post('/api/auth/phone', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const { phone } = req.body ?? {};
    if (typeof phone !== 'string') {
      res.status(400).json({ error: 'Phone value is required.' });
      return;
    }
    const trimmed = phone.trim();
    const normalizedPhone = trimmed ? normalizePhoneNumber(trimmed) : '';
    if (trimmed && !normalizedPhone) {
      res.status(400).json({ error: 'Enter a valid mobile number (7-15 digits, e.g. +919876543210).' });
      return;
    }
    const db = readDb();
    const user = db.users.find((u) => u.id === authUser.userId);
    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    if (normalizedPhone) {
      const conflict = findUserByIdentifier(
        db.users.filter((u) => u.id !== user.id),
        normalizedPhone
      );
      if (conflict) {
        res.status(409).json({ error: 'This mobile number is already linked to another account.' });
        return;
      }
      user.phone = normalizedPhone;
    } else {
      if (!user.email) {
        res.status(400).json({ error: 'Cannot remove mobile number when no email is linked to this account.' });
        return;
      }
      delete user.phone;
    }
    writeDb(db);
    res.json({ user: toPublicUser(user) });
  });

  // Auth: Password Reset using Recovery Key (supports Email or Mobile Number)
  app.post('/api/auth/reset-password', (req, res) => {
    const { identifier, email, recoveryPhrase, newPassword } = req.body ?? {};
    const rawId = typeof identifier === 'string' ? identifier : typeof email === 'string' ? email : '';
    if (
      !rawId.trim() ||
      typeof recoveryPhrase !== 'string' ||
      typeof newPassword !== 'string' ||
      newPassword.length < 6
    ) {
      res.status(400).json({ error: 'Email/mobile number, recovery phrase, and new password (min 6 characters) are required.' });
      return;
    }
    const db = readDb();
    const user = findUserByIdentifier(db.users, rawId);
    if (!user || !user.recoveryHash || !verifyPassword(recoveryPhrase.trim(), user.recoveryHash)) {
      res.status(401).json({ error: 'Invalid account identifier or recovery key.' });
      return;
    }
    user.passwordHash = hashPassword(newPassword);
    writeDb(db);
    res.json({ ok: true });
  });

  // Auth: Change Password (authenticated)
  app.post('/api/auth/change-password', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ error: 'Current password and new password (min 6 chars) are required.' });
      return;
    }
    const db = readDb();
    const user = db.users.find((u) => u.id === authUser.userId);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    user.passwordHash = hashPassword(newPassword);
    writeDb(db);
    res.json({ ok: true });
  });

  // Auth: Session profile (via Bearer header)
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const db = readDb();
    const user = db.users.find((u) => u.id === authUser.userId);
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });

  // Auth: Auto-restore session from HttpOnly cookie on page reload
  app.get('/api/auth/session', (req, res) => {
    const cookieToken = readCookieValue(req, 'scanner_session');
    if (!cookieToken) {
      res.json({ token: '', user: null });
      return;
    }
    const verified = verifyToken(cookieToken);
    if (!verified) {
      clearSessionCookie(req, res);
      res.json({ token: '', user: null });
      return;
    }
    const db = readDb();
    const user = db.users.find((u) => u.id === verified.userId);
    if (!user) {
      clearSessionCookie(req, res);
      res.json({ token: '', user: null });
      return;
    }
    res.json({ token: cookieToken, user: toPublicUser(user) });
  });

  // Auth: Logout (clears HttpOnly session cookie)
  app.post('/api/auth/logout', (req, res) => {
    const requestedWith = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const expectedHost = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
    let originOk = requestedWith === 'XMLHttpRequest';
    if (!originOk && typeof origin === 'string' && expectedHost) {
      try {
        originOk = new URL(origin).host === expectedHost;
      } catch {
        originOk = false;
      }
    }
    if (!originOk) {
      res.status(403).json({ error: 'Forbidden CSRF check' });
      return;
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Auth: Delete Account & Cloud Data
  app.delete('/api/auth/account', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const db = readDb();
    const userDocs = db.cloudDocs.filter((d) => d.userId === authUser.userId);
    for (const doc of userDocs) {
      try {
        const p = resolveVaultPath(doc.vaultFileName);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Ignore already-deleted vault file
      }
    }
    db.cloudDocs = db.cloudDocs.filter((d) => d.userId !== authUser.userId);
    db.users = db.users.filter((u) => u.id !== authUser.userId);
    writeDb(db);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Pairing: Create or retrieve channel
  app.post('/api/pairing/create', (req, res) => {
    const { existingCode, desktopName } = req.body ?? {};
    const db = readDb();
    if (typeof existingCode === 'string' && /^\d{6}$/.test(existingCode) && db.pairings[existingCode]) {
      res.json(db.pairings[existingCode]);
      return;
    }
    let code = generatePairCode();
    while (db.pairings[code]) {
      code = generatePairCode();
    }
    const session: PairingSession = {
      pairCode: code,
      desktopName: typeof desktopName === 'string' && desktopName.trim() ? desktopName.trim().slice(0, 50) : 'Windows Desktop Workbench',
      createdAt: new Date().toISOString(),
      devices: [],
      pendingTransfers: [],
    };
    db.pairings[code] = session;
    writeDb(db);
    res.status(201).json(session);
  });

  // Pairing: Inspect channel
  app.get('/api/pairing/:code', (req, res) => {
    const code = req.params.code;
    const db = readDb();
    const session = db.pairings[code];
    if (!session) {
      res.status(404).json({ error: 'Pairing code not found or expired' });
      return;
    }
    res.json(session);
  });

  // Pairing: Remove paired device
  app.delete('/api/pairing/:code/devices/:deviceId', (req, res) => {
    const { code, deviceId } = req.params;
    const db = readDb();
    const session = db.pairings[code];
    if (!session) {
      res.status(404).json({ error: 'Pairing session not found' });
      return;
    }
    session.devices = session.devices.filter((d) => d.id !== deviceId);
    writeDb(db);
    broadcastToChannel(code, {
      type: 'device:removed',
      deviceId,
      devices: session.devices,
    });
    res.json({ ok: true, devices: session.devices });
  });

  // Cloud Sync: List user documents
  app.get('/api/cloud/documents', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const db = readDb();
    const docs = db.cloudDocs
      .filter((d) => d.userId === authUser.userId)
      .map((d) => {
        let dataUrl = '';
        try {
          const filePath = resolveVaultPath(d.vaultFileName);
          if (fs.existsSync(filePath)) {
            dataUrl = fs.readFileSync(filePath, 'utf8');
          }
        } catch {
          dataUrl = '';
        }
        return { ...d, dataUrl };
      });
    res.json({ documents: docs });
  });

  // Cloud Sync: Upload / update document
  app.post('/api/cloud/documents', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const doc = req.body;
    if (!doc || typeof doc.id !== 'string' || typeof doc.dataUrl !== 'string' || typeof doc.sha256 !== 'string') {
      res.status(400).json({ error: 'Invalid document payload' });
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
    fs.writeFileSync(vaultPath, doc.dataUrl, 'utf8');

    const existingIdx = db.cloudDocs.findIndex((d) => d.userId === authUser.userId && d.id === doc.id);
    const now = new Date().toISOString();
    const record: CloudDocRecord = {
      id: doc.id,
      userId: authUser.userId,
      title: String(doc.title || 'Scanned Document').slice(0, 120),
      fileName: sanitizeFileName(String(doc.fileName || 'scan.jpg')),
      category: String(doc.category || 'Scans'),
      folder: String(doc.folder || 'Documents/Scans'),
      mimeType: String(doc.mimeType || 'image/jpeg'),
      sizeBytes: Number(doc.sizeBytes || doc.dataUrl.length),
      pageCount: Number(doc.pageCount || 1),
      ocrText: typeof doc.ocrText === 'string' ? doc.ocrText : '',
      sourceDevice: String(doc.sourceDevice || 'Mobile'),
      sha256: doc.sha256,
      version: existingIdx >= 0 ? db.cloudDocs[existingIdx].version + 1 : 1,
      vaultFileName,
      createdAt: existingIdx >= 0 ? db.cloudDocs[existingIdx].createdAt : now,
      updatedAt: now,
    };
    if (existingIdx >= 0) {
      db.cloudDocs[existingIdx] = record;
    } else {
      db.cloudDocs.unshift(record);
    }
    writeDb(db);
    res.status(201).json({ document: record });
  });

  // Cloud Sync: Delete document
  app.delete('/api/cloud/documents/:id', requireAuth, (req, res) => {
    const authUser = (req as express.Request & { authUser: AuthTokenPayload }).authUser;
    const docId = req.params.id;
    const db = readDb();
    const target = db.cloudDocs.find((d) => d.userId === authUser.userId && d.id === docId);
    if (!target) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    try {
      const p = resolveVaultPath(target.vaultFileName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore missing file
    }
    db.cloudDocs = db.cloudDocs.filter((d) => !(d.userId === authUser.userId && d.id === docId));
    writeDb(db);
    res.json({ ok: true });
  });

  // Native Ecosystem Source & Build Files Explorer (Read-Only)
  app.get('/api/native-files', (_req, res) => {
    if (!fs.existsSync(NATIVE_DIR)) {
      res.json({ files: [] });
      return;
    }
    const results: Array<{ path: string; content: string; language: string }> = [];
    function walk(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.resolve(dir, entry.name);
        if (!full.startsWith(NATIVE_DIR + path.sep)) continue;
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const rel = path.relative(NATIVE_DIR, full).replace(/\\/g, '/');
          const ext = path.extname(rel).slice(1);
          results.push({
            path: rel,
            content: fs.readFileSync(full, 'utf8'),
            language: ext || 'text',
          });
        }
      }
    }
    walk(NATIVE_DIR);
    res.json({ files: results });
  });

  // Multi-Platform Share Link Cache (bounded 24h TTL, non-HTML binary serving)
  interface SharedArtifact {
    id: string;
    title: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    expiresAt: number;
  }
  const sharedArtifacts = new Map<string, SharedArtifact>();

  app.post('/api/share', (req, res) => {
    const { title, fileName, mimeType, dataUrl } = req.body ?? {};
    if (typeof dataUrl !== 'string' || typeof mimeType !== 'string') {
      res.status(400).json({ error: 'Document dataUrl and mimeType are required.' });
      return;
    }
    const allowedMime =
      mimeType === 'application/pdf' ||
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp';
    if (!allowedMime) {
      res.status(400).json({ error: 'Only PDF, JPEG, PNG, and WEBP sharing is supported.' });
      return;
    }
    const commaIdx = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || commaIdx < 0) {
      res.status(400).json({ error: 'Invalid base64 dataUrl.' });
      return;
    }
    const bytes = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
      res.status(400).json({ error: 'File size exceeds 20 MB share limit.' });
      return;
    }

    // Prune expired or oversized cache
    const now = Date.now();
    for (const [key, item] of sharedArtifacts.entries()) {
      if (item.expiresAt < now) sharedArtifacts.delete(key);
    }
    while (sharedArtifacts.size >= 80) {
      const oldestKey = sharedArtifacts.keys().next().value;
      if (!oldestKey) break;
      sharedArtifacts.delete(oldestKey);
    }

    const shareId = crypto.randomBytes(8).toString('base64url');
    const expiresAt = now + 24 * 60 * 60 * 1000;
    const cleanFileName = sanitizeFileName(
      typeof fileName === 'string' && fileName.trim() ? fileName : 'shared_document'
    );

    sharedArtifacts.set(shareId, {
      id: shareId,
      title: typeof title === 'string' ? title.slice(0, 120) : cleanFileName,
      fileName: cleanFileName,
      mimeType,
      bytes,
      expiresAt,
    });

    res.status(201).json({
      shareId,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });

  app.get('/api/share/:shareId', (req, res) => {
    const item = sharedArtifacts.get(req.params.shareId);
    if (!item || item.expiresAt < Date.now()) {
      sharedArtifacts.delete(req.params.shareId);
      res.status(404).send('Share link expired or not found.');
      return;
    }
    const forceDownload = req.query.download === '1';
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${forceDownload ? 'attachment' : 'inline'}; filename="${item.fileName}"`
    );
    res.send(item.bytes);
  });

  // Wi-Fi / IP Camera Snapshot Proxy (allows LAN IP cameras without browser CORS taint while blocking metadata/loopback targets)
  app.get('/api/wifi-camera/snapshot', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid camera URL.' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Only HTTP/HTTPS snapshot URLs are allowed.' });
      return;
    }
    const host = parsed.hostname.toLowerCase();
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'metadata.google.internal'];
    if (
      blockedHosts.includes(host) ||
      host.startsWith('127.') ||
      host.startsWith('169.254.') ||
      host.endsWith('.internal')
    ) {
      res.status(403).json({ error: 'Loopback and cloud metadata addresses are blocked.' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        res.status(502).json({ error: `Camera responded with HTTP ${upstream.status}` });
        return;
      }
      const ct = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) {
        res.status(415).json({ error: 'Camera URL did not return an image snapshot.' });
        return;
      }
      const arr = await upstream.arrayBuffer();
      if (arr.byteLength > 6 * 1024 * 1024) {
        res.status(413).json({ error: 'Snapshot frame exceeded 6 MB limit.' });
        return;
      }
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(arr));
    } catch {
      res.status(504).json({ error: 'Could not reach Wi-Fi camera at that URL.' });
    } finally {
      clearTimeout(timer);
    }
  });

  // HTTP Server + WebSocket Server
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WsClientMeta>();

  function broadcastToChannel(pairCode: string, payload: Record<string, unknown>, excludeWs?: WebSocket) {
    const msg = JSON.stringify(payload);
    for (const client of clients) {
      if (client.pairCode === pairCode && client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  wss.on('connection', (ws) => {
    let meta: WsClientMeta | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const type = String(msg.type || '');

        if (type === 'register') {
          const role = msg.role === 'mobile' ? 'mobile' : 'desktop';
          const pairCode = String(msg.pairCode || '');
          const deviceId = String(msg.deviceId || crypto.randomUUID());
          const deviceName = String(msg.deviceName || (role === 'mobile' ? 'Android Mobile' : 'Windows Desktop')).slice(0, 60);
          const platform = String(msg.platform || (role === 'mobile' ? 'Mobile Web' : 'Windows'));

          const db = readDb();
          if (!db.pairings[pairCode]) {
            if (role === 'desktop') {
              db.pairings[pairCode] = {
                pairCode,
                desktopName: deviceName,
                createdAt: new Date().toISOString(),
                devices: [],
                pendingTransfers: [],
              };
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid pairing code. Check your Windows Desktop screen.' }));
              return;
            }
          }

          meta = { ws, role, pairCode, deviceId, deviceName, platform };
          clients.add(meta);

          const session = db.pairings[pairCode];
          if (role === 'mobile') {
            const existing = session.devices.find((d) => d.id === deviceId);
            const now = new Date().toISOString();
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
                pairedAt: now,
              });
            }
            writeDb(db);
          }

          ws.send(
            JSON.stringify({
              type: 'registered',
              pairCode,
              role,
              desktopName: session.desktopName,
              devices: session.devices,
            })
          );

          broadcastToChannel(
            pairCode,
            {
              type: 'presence:update',
              devices: session.devices,
              desktopOnline: Array.from(clients).some((c) => c.pairCode === pairCode && c.role === 'desktop'),
            },
            undefined
          );

          // Deliver queued offline transfers if Desktop just reconnected
          if (role === 'desktop' && session.pendingTransfers.length > 0) {
            for (const docPayload of session.pendingTransfers) {
              ws.send(JSON.stringify({ type: 'transfer:incoming', document: docPayload }));
            }
            session.pendingTransfers = [];
            writeDb(db);
          }
          return;
        }

        if (!meta) return;

        if (type === 'transfer:document') {
          const doc = msg.document as Record<string, unknown> | undefined;
          if (!doc || typeof doc.id !== 'string') return;

          const desktopClients = Array.from(clients).filter(
            (c) => c.pairCode === meta!.pairCode && c.role === 'desktop' && c.ws.readyState === WebSocket.OPEN
          );

          if (desktopClients.length > 0) {
            for (const desktop of desktopClients) {
              desktop.ws.send(
                JSON.stringify({
                  type: 'transfer:incoming',
                  fromDeviceId: meta.deviceId,
                  fromDeviceName: meta.deviceName,
                  document: doc,
                })
              );
            }
            ws.send(JSON.stringify({ type: 'transfer:ack', documentId: doc.id, status: 'delivered' }));
          } else {
            // Buffer on server until desktop reconnects
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
            ws.send(JSON.stringify({ type: 'transfer:ack', documentId: doc.id, status: 'buffered' }));
          }
          return;
        }

        if (type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      if (!meta) return;
      clients.delete(meta);
      const db = readDb();
      const session = db.pairings[meta.pairCode];
      if (session) {
        if (meta.role === 'mobile') {
          const dev = session.devices.find((d) => d.id === meta!.deviceId);
          if (dev) {
            dev.connected = false;
            dev.lastSeen = new Date().toISOString();
            writeDb(db);
          }
        }
        broadcastToChannel(meta.pairCode, {
          type: 'presence:update',
          devices: session.devices,
          desktopOnline: Array.from(clients).some((c) => c.pairCode === meta!.pairCode && c.role === 'desktop'),
        });
      }
    });
  });

  let viteServerRef: { middlewares: express.RequestHandler; close: () => Promise<void> } | null = null;

  // Vite dev middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    if (!process.env.DISABLE_HMR) {
      process.env.DISABLE_HMR = 'true';
    }
    const vitePromise = import('vite')
      .then((vite) =>
        vite.createServer({
          server: { middlewareMode: true, hmr: false, ws: false },
          appType: 'spa',
        })
      )
      .then((viteServer) => {
        viteServerRef = viteServer;
        return viteServer;
      });

    vitePromise.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });

    app.use((req, res, next) => {
      vitePromise
        .then((viteServer) => viteServer.middlewares(req, res, next))
        .catch(next);
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  let listenAttempts = 0;
  const maxListenAttempts = 8;

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && listenAttempts < maxListenAttempts) {
      listenAttempts += 1;
      console.warn(`Port ${PORT} busy during restart, retrying (${listenAttempts}/${maxListenAttempts})...`);
      setTimeout(() => {
        server.listen(PORT, '0.0.0.0');
      }, 400);
      return;
    }
    console.error('Server listen error:', err);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`My Multi Functional Scanner running at http://0.0.0.0:${PORT}`);
  });

  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      for (const client of clients) {
        try {
          client.ws.terminate();
        } catch {
          // ignore
        }
      }
      wss.close();
      await Promise.race([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
      if (viteServerRef) {
        await viteServerRef.close();
      }
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => void gracefulShutdown());
  process.once('SIGINT', () => void gracefulShutdown());
}

startServer();

