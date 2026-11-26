import type { PairedDevice, ScanDocument, UserAccount } from '../types';
import { parsePcAddressInput, toWebSocketUrl } from './pcAddressMath';

export interface WsPresencePayload {
  devices: PairedDevice[];
  desktopOnline: boolean;
}

export type SyncWsHandlers = {
  onStatusChange?: (connected: boolean) => void;
  onPresence?: (payload: WsPresencePayload) => void;
  onIncomingDocument?: (doc: ScanDocument, fromDeviceName: string) => void;
  onTransferAck?: (documentId: string, status: 'delivered' | 'buffered') => void;
  onError?: (message: string) => void;
};

export class ScannerSyncSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;
  private role: 'desktop' | 'mobile' = 'desktop';
  private pairCode = '';
  private deviceId = '';
  private deviceName = '';
  private serverOrigin = '';
  private handlers: SyncWsHandlers = {};

  connect(params: {
    role: 'desktop' | 'mobile';
    pairCode: string;
    deviceId: string;
    deviceName: string;
    serverOrigin?: string;
    handlers: SyncWsHandlers;
  }): void {
    this.role = params.role;
    this.pairCode = params.pairCode;
    this.deviceId = params.deviceId;
    this.deviceName = params.deviceName;
    this.serverOrigin = params.serverOrigin || '';
    this.handlers = params.handlers;
    this.shouldReconnect = true;
    this.openSocket();
  }

  private openSocket(): void {
    if (!this.pairCode) return;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const customWs = this.serverOrigin ? toWebSocketUrl(this.serverOrigin) : '';
    const wsUrl = customWs || `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.handlers.onStatusChange?.(true);
      ws.send(
        JSON.stringify({
          type: 'register',
          role: this.role,
          pairCode: this.pairCode,
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          platform: this.role === 'mobile' ? 'Mobile Web' : 'Windows Desktop',
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'registered' || msg.type === 'presence:update') {
          this.handlers.onPresence?.({
            devices: Array.isArray(msg.devices) ? msg.devices : [],
            desktopOnline: msg.desktopOnline !== false,
          });
        } else if (msg.type === 'transfer:incoming' && msg.document) {
          this.handlers.onIncomingDocument?.(
            msg.document as ScanDocument,
            String(msg.fromDeviceName || 'Paired Mobile')
          );
        } else if (msg.type === 'transfer:ack') {
          this.handlers.onTransferAck?.(
            String(msg.documentId),
            msg.status === 'buffered' ? 'buffered' : 'delivered'
          );
        } else if (msg.type === 'error') {
          this.handlers.onError?.(String(msg.message || 'Connection error'));
        }
      } catch {
        // ignore invalid frames
      }
    };

    ws.onclose = () => {
      this.handlers.onStatusChange?.(false);
      if (this.shouldReconnect) {
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => this.openSocket(), 2500);
      }
    };

    ws.onerror = () => {
      this.handlers.onStatusChange?.(false);
    };
  }

  sendDocument(doc: ScanDocument): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(
      JSON.stringify({
        type: 'transfer:document',
        document: doc,
      })
    );
    return true;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.handlers.onStatusChange?.(false);
  }
}

export async function createPairingChannel(
  existingCode?: string,
  desktopName = 'Windows Desktop Workbench'
): Promise<{ pairCode: string; devices: PairedDevice[] }> {
  const res = await fetch('/api/pairing/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ existingCode, desktopName }),
  });
  if (!res.ok) throw new Error('Failed to create pairing channel');
  return res.json();
}

export async function verifyPairingCode(code: string, serverOrigin?: string): Promise<boolean> {
  const parsed = serverOrigin ? parsePcAddressInput(serverOrigin) : null;
  const base =
    parsed && parsed.address.toLowerCase() !== window.location.origin.toLowerCase()
      ? parsed.address
      : '';
  const res = await fetch(`${base}/api/pairing/${encodeURIComponent(code)}`);
  return res.ok;
}

export async function removePairedDevice(code: string, deviceId: string): Promise<PairedDevice[]> {
  const res = await fetch(`/api/pairing/${encodeURIComponent(code)}/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to remove device');
  const data = await res.json();
  return data.devices || [];
}

// Auth & Cloud Sync API helpers (Bearer token kept strictly in JS/React memory)
export async function apiRegister(params: {
  email?: string;
  phone?: string;
  password: string;
  displayName: string;
  recoveryPhrase?: string;
}): Promise<{ token: string; user: UserAccount }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
}

export async function apiLogin(
  identifier: string,
  password: string
): Promise<{ token: string; user: UserAccount }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, email: identifier, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function apiFirebaseAuth(
  idToken: string,
  phone?: string
): Promise<{ token: string; user: UserAccount }> {
  const res = await fetch('/api/auth/firebase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Social sign-in failed');
  return data;
}

export async function apiUpdatePhone(
  token: string,
  phone: string
): Promise<{ user: UserAccount }> {
  const res = await fetch('/api/auth/phone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not update mobile number');
  return data;
}

export async function apiResetPassword(
  identifier: string,
  recoveryPhrase: string,
  newPassword: string
): Promise<void> {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, email: identifier, recoveryPhrase, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Password reset failed');
}

export async function apiChangePassword(
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Password change failed');
}

export async function apiDeleteAccount(token: string): Promise<void> {
  const res = await fetch('/api/auth/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete account');
}

export async function apiRestoreSession(): Promise<{ token: string; user: UserAccount } | null> {
  const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string; user?: UserAccount | null };
  if (data.token && data.user) {
    return { token: data.token, user: data.user };
  }
  return null;
}

export async function apiLogout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
}

export async function apiCloudUploadDocument(
  token: string,
  doc: ScanDocument
): Promise<{ duplicate?: boolean; document: { version: number } }> {
  const res = await fetch('/api/cloud/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(doc),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Cloud backup failed');
  return data;
}

export async function apiCloudFetchDocuments(token: string): Promise<ScanDocument[]> {
  const res = await fetch('/api/cloud/documents', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch cloud backup');
  return (data.documents || []).map((d: Record<string, unknown>) => ({
    ...d,
    fileExtension: String(d.fileName || 'scan.jpg').split('.').pop() || 'jpg',
    ocrStatus: d.ocrText ? 'done' : 'idle',
    filterMode: 'original',
    syncStatus: 'synced',
  }));
}

export async function apiCreateShareLink(doc: {
  title: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
}): Promise<{ shareId: string; shareUrl: string; expiresAt: string }> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create share link');
  const origin = window.location.origin;
  return {
    shareId: data.shareId,
    shareUrl: `${origin}/api/share/${encodeURIComponent(data.shareId)}`,
    expiresAt: data.expiresAt,
  };
}

export function getWifiCameraProxyUrl(snapshotUrl: string): string {
  return `/api/wifi-camera/snapshot?url=${encodeURIComponent(snapshotUrl)}&_t=${Date.now()}`;
}

