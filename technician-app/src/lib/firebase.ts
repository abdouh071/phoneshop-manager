import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import * as firebaseAuth from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
} from 'firebase/firestore';
import { Platform } from 'react-native';

// Shared config with the phone-shop-manager web app.
// Every value is supplied at build time through EXPO_PUBLIC_* environment variables.
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '';
const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : '');
const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : '');
const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '';

const apiKey =
  (Platform.OS === 'android' && process.env.EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY) ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  '';

const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '';

const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId,
};

export const app = initializeApp(firebaseConfig);

// Offline cache strategy, stated per platform rather than probed:
//
//   • Web (expo web) has IndexedDB, so the Firestore SDK can keep a durable cache.
//   • React Native does NOT. The `react-native` bundle this app links against
//     (`@firebase/firestore/dist/index.rn.js`) contains no IndexedDB/LevelDb
//     implementation at all, so `persistentLocalCache()` has nothing to write to
//     and only produces an in-process cache that dies with the app.
//
// So on native, durability comes from the AsyncStorage queues in
// `offlineSyncService`, not from the SDK cache. That is a real limitation, not a
// setting to flip — do not "fix" it by enabling persistence and assuming writes
// survive a reboot.
const hasIndexedDb =
  Platform.OS === 'web' &&
  typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined';

export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: hasIndexedDb ? persistentLocalCache({}) : memoryLocalCache(),
});

/**
 * Metro links the React Native bundle of `firebase/auth`, which exports this
 * helper; the entry point TypeScript reads is the browser bundle, which does not.
 * Taken off the namespace and given a local shape rather than `any`, so the
 * compiler still checks the one call site that uses it.
 */
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
  }
).getReactNativePersistence;

/**
 * `getAuth()` on React Native keeps the session in memory: the web SDK asks the
 * platform for a place to store it, finds no browser, and the sign-in dies with
 * the JS runtime — which is why every reopen asked the technician for a password.
 * AsyncStorage is that place, so the session survives a kill and a reboot.
 *
 * Restoring is not trusting: `onAuthStateChanged` still reads `users/{uid}` and
 * signs the device out of a revoked or wrong-role profile before the app opens.
 */
const createAuth = (): Auth => {
  if (Platform.OS === 'web' || typeof getReactNativePersistence !== 'function') {
    return getAuth(app);
  }
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Already initialized — what a Metro Fast Refresh does. Reuse that instance
    // rather than crash the dev loop over a persistence call it cannot repeat.
    return getAuth(app);
  }
};

export const auth = createAuth();
