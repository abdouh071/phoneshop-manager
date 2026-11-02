import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
} from 'firebase/firestore';
import { Platform } from 'react-native';

// Shared config with the phone-shop-manager web app.
// Every value can be overridden at build time through EXPO_PUBLIC_* so a staging
// project never has to be hardcoded here.
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'phoneshop-mgr-pro-2026';
const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '382569044952';

// google-services.json carries the Android app id; the web app id was previously
// used for every platform. Auth and Firestore do not key off it, but Firebase
// services that do (Crashlytics, Messaging) would reject a mismatched one.
const ANDROID_APP_ID = '1:382569044952:android:e165c901a68be88dc2f0ad';
const WEB_APP_ID = '1:382569044952:web:3081c612d39e1f7fc2f0ad';

// The Android-restricted key is deliberately NOT used here: Firebase rejects a
// request whose key is restricted to an Android package unless the caller sends
// X-Android-Package, which fetch from React Native does not. The project-wide web
// key is what authenticates today, so it stays the default and can be overridden
// per platform once a restricted key has been tested against a real build.
const apiKey =
  (Platform.OS === 'android' && process.env.EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY) ||
  (Platform.OS === 'ios' && process.env.EXPO_PUBLIC_FIREBASE_IOS_API_KEY) ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  'AIzaSyCYQopJt3Ppyd8BV-o0c1pd-AONwEqBFXw';

const appId =
  process.env.EXPO_PUBLIC_FIREBASE_APP_ID ||
  (Platform.OS === 'android' ? ANDROID_APP_ID : WEB_APP_ID);

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

export const auth = getAuth(app);
