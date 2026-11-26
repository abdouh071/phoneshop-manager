import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { resolveFirebaseEnvironment } from './firebaseConfig';

const resolvedEnv = resolveFirebaseEnvironment(import.meta.env as Record<string, string | undefined>);

export const app = initializeApp(resolvedEnv.config);
export const isUsingFirebaseEmulator = resolvedEnv.useEmulator;
export const firebaseProjectId = resolvedEnv.config.projectId!;

let firestoreInstance;
if (resolvedEnv.useEmulator) {
  firestoreInstance = initializeFirestore(app, { ignoreUndefinedProperties: true });
} else {
  try {
    firestoreInstance = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
      ignoreUndefinedProperties: true,
    });
  } catch (e) {
    console.warn('[Firestore] Failed to initialize persistentLocalCache, falling back to default:', e);
    firestoreInstance = initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
}

export const db = firestoreInstance;
export const auth = getAuth(app);

if (resolvedEnv.useEmulator && resolvedEnv.emulator) {
  connectFirestoreEmulator(db, resolvedEnv.emulator.firestoreHost, resolvedEnv.emulator.firestorePort);
  connectAuthEmulator(auth, resolvedEnv.emulator.authUrl, { disableWarnings: true });
}

