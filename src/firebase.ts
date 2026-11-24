import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const app = initializeApp(firebaseConfig);
const configuredDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = configuredDbId ? getFirestore(app, configuredDbId) : getFirestore(app);
export const auth = getAuth(app);

// Keep Workspace OAuth access token strictly in JS memory (never in localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function clearDriveAccessToken(): void {
  cachedDriveAccessToken = null;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export type SocialAuthProviderId = 'google' | 'github' | 'microsoft' | 'apple';

export async function signInWithSocialProvider(
  providerId: SocialAuthProviderId
): Promise<{ idToken: string; firebaseUser: FirebaseUser; driveAccessToken?: string }> {
  const provider =
    providerId === 'google'
      ? (() => {
          const p = new GoogleAuthProvider();
          for (const scope of GOOGLE_DRIVE_SCOPES) {
            p.addScope(scope);
          }
          p.setCustomParameters({ prompt: 'select_account' });
          return p;
        })()
      : providerId === 'github'
        ? new GithubAuthProvider()
        : providerId === 'microsoft'
          ? new OAuthProvider('microsoft.com')
          : new OAuthProvider('apple.com');

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  let driveAccessToken: string | undefined;
  if (providerId === 'google') {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedDriveAccessToken = credential.accessToken;
      driveAccessToken = credential.accessToken;
    }
  }
  return { idToken, firebaseUser: result.user, driveAccessToken };
}

export async function connectGoogleDriveWithOAuth(): Promise<{
  idToken: string;
  firebaseUser: FirebaseUser;
  accessToken: string;
}> {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_DRIVE_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'consent select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google Drive permission was not granted.');
  }
  cachedDriveAccessToken = credential.accessToken;
  const idToken = await result.user.getIdToken();
  return { idToken, firebaseUser: result.user, accessToken: credential.accessToken };
}

export async function syncFirebaseProfileToFirestore(
  fbUser: FirebaseUser,
  providerLabel: string,
  phone?: string
): Promise<void> {
  if (!configuredDbId) return;
  const publicPath = `users/${fbUser.uid}`;
  const privatePath = `users/${fbUser.uid}/private/info`;
  const publicRef = doc(db, 'users', fbUser.uid);
  const privateRef = doc(db, 'users', fbUser.uid, 'private', 'info');

  try {
    const existingPublic = await getDoc(publicRef);
    const existingPrivate = await getDoc(privateRef);
    const batch = writeBatch(db);
    const nowTs = serverTimestamp();

    const displayName = (fbUser.displayName || fbUser.email?.split('@')[0] || 'Scanner User').slice(0, 80);
    if (!existingPublic.exists()) {
      batch.set(publicRef, {
        uid: fbUser.uid,
        displayName,
        provider: providerLabel.slice(0, 40),
        createdAt: nowTs,
        updatedAt: nowTs,
      });
    } else {
      batch.update(publicRef, {
        displayName,
        provider: providerLabel.slice(0, 40),
        updatedAt: nowTs,
      });
    }

    const cleanPhone = (phone || fbUser.phoneNumber || '').trim().slice(0, 24);
    const cleanEmail = (fbUser.email || '').trim().slice(0, 160);
    if (!existingPrivate.exists()) {
      const payload: Record<string, unknown> = {
        uid: fbUser.uid,
        createdAt: nowTs,
        updatedAt: nowTs,
      };
      if (cleanEmail) payload.email = cleanEmail;
      if (cleanPhone) payload.phone = cleanPhone;
      batch.set(privateRef, payload);
    } else {
      const updates: Record<string, unknown> = {
        updatedAt: nowTs,
      };
      if (cleanEmail) updates.email = cleanEmail;
      if (phone !== undefined) updates.phone = cleanPhone;
      batch.update(privateRef, updates);
    }

    await batch.commit();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `${publicPath} & ${privatePath}`);
      } catch {
        // Non-blocking fallback when secondary OAuth providers omit email_verified
      }
    }
  }
}

export async function updateFirestorePhone(phone: string): Promise<void> {
  if (!configuredDbId) return;
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  const privatePath = `users/${fbUser.uid}/private/info`;
  const privateRef = doc(db, 'users', fbUser.uid, 'private', 'info');
  try {
    const snap = await getDoc(privateRef);
    if (!snap.exists()) {
      await syncFirebaseProfileToFirestore(fbUser, 'google', phone);
      return;
    }
    const batch = writeBatch(db);
    batch.update(privateRef, {
      phone: phone.trim().slice(0, 24),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.UPDATE, privatePath);
    }
  }
}

export async function deleteFirestoreProfile(): Promise<void> {
  if (!configuredDbId) return;
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  try {
    await deleteDoc(doc(db, 'users', fbUser.uid, 'private', 'info'));
    await deleteDoc(doc(db, 'users', fbUser.uid));
  } catch {
    // Ignore if already absent or unauthenticated in Firebase
  }
}

export function subscribeFirebaseAuth(
  callback: (fbUser: FirebaseUser | null) => void
): () => void {
  return onAuthStateChanged(auth, (fbUser) => {
    if (!fbUser) {
      cachedDriveAccessToken = null;
    }
    callback(fbUser);
  });
}

export async function signOutFirebase(): Promise<void> {
  cachedDriveAccessToken = null;
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch {
    // Ignore sign-out errors
  }
}
