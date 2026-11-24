import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface StoredUser {
  id: string;
  email: string;
  phone?: string;
  firebaseUid?: string;
  provider?: string;
  displayName: string;
  passwordHash: string;
  recoveryHash?: string;
  verified: boolean;
  createdAt: string;
}

export function normalizePhoneNumber(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return hasPlus ? `+${digits}` : digits;
}

export interface CloudDocRecord {
  id: string;
  userId: string;
  title: string;
  fileName: string;
  category: string;
  folder: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  ocrText: string;
  sourceDevice: string;
  sha256: string;
  version: number;
  vaultFileName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PairingSession {
  pairCode: string;
  desktopName: string;
  createdAt: string;
  devices: Array<{
    id: string;
    name: string;
    platform: string;
    connected: boolean;
    lastSeen: string;
    pairedAt: string;
  }>;
  pendingTransfers: Array<Record<string, unknown>>;
}

interface DatabaseFile {
  users: StoredUser[];
  cloudDocs: CloudDocRecord[];
  pairings: Record<string, PairingSession>;
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
export const VAULT_DIR = path.resolve(DATA_DIR, 'vault');
const DB_PATH = path.resolve(DATA_DIR, 'db.json');

function ensureStorage(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const emptyDb: DatabaseFile = {
      users: [],
      cloudDocs: [],
      pairings: {},
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb, null, 2), 'utf8');
  }
}

export function readDb(): DatabaseFile {
  ensureStorage();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseFile>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      cloudDocs: Array.isArray(parsed.cloudDocs) ? parsed.cloudDocs : [],
      pairings: parsed.pairings && typeof parsed.pairings === 'object' ? parsed.pairings : {},
    };
  } catch {
    return { users: [], cloudDocs: [], pairings: {} };
  }
}

export function writeDb(db: DatabaseFile): void {
  ensureStorage();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'scan_file';
}

export function resolveVaultPath(vaultFileName: string): string {
  ensureStorage();
  const safeName = sanitizeFileName(path.basename(vaultFileName));
  const resolved = path.resolve(VAULT_DIR, safeName);
  if (!resolved.startsWith(VAULT_DIR + path.sep)) {
    throw new Error('Invalid vault path');
  }
  return resolved;
}
