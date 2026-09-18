import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore with specific databaseId if configured
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export { firebaseConfig };

export interface LocalUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  photoURL: string | null;
}

function getOrCreateLocalUserId(): string {
  try {
    let localId = localStorage.getItem('trading_local_uid');
    if (!localId) {
      localId = 'local_user_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('trading_local_uid', localId);
    }
    return localId;
  } catch {
    return 'local_user_guest';
  }
}

export function createLocalFallbackUser(): LocalUser {
  return {
    uid: getOrCreateLocalUserId(),
    email: null,
    displayName: 'Local Trader',
    isAnonymous: true,
    photoURL: null
  };
}

// Google Sign-In helper
export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function logOut(): Promise<void> {
  await signOut(auth);
}

// Helper to ensure an authenticated user session is active for Firestore rules
let currentUserPromise: Promise<User | LocalUser> | null = null;

export function ensureAuthenticatedUser(): Promise<User | LocalUser> {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  if (currentUserPromise) {
    return currentUserPromise;
  }

  currentUserPromise = new Promise<User | LocalUser>((resolve) => {
    let hasResolved = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (hasResolved) return;

      if (user) {
        hasResolved = true;
        unsubscribe();
        currentUserPromise = null;
        resolve(user);
      } else {
        // Try anonymous sign in if enabled, but gracefully fall back to Local User if disabled by admin
        try {
          const cred = await signInAnonymously(auth);
          hasResolved = true;
          unsubscribe();
          currentUserPromise = null;
          resolve(cred.user);
        } catch (err: any) {
          // Anonymous auth disabled or restricted by admin in Firebase console - fallback cleanly
          console.info('Firebase anonymous auth restricted; operating with persistent local identity.', err?.code || err);
          hasResolved = true;
          unsubscribe();
          currentUserPromise = null;
          resolve(createLocalFallbackUser());
        }
      }
    });

    // Safety timeout to avoid locking UI
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        try { unsubscribe(); } catch {}
        currentUserPromise = null;
        resolve(createLocalFallbackUser());
      }
    }, 2500);
  });

  return currentUserPromise;
}
