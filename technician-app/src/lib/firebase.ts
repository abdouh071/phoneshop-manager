import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

// Shared config with the phone-shop-manager web app
const firebaseConfig = {
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "phoneshop-mgr-pro-2026",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:382569044952:web:3081c612d39e1f7fc2f0ad",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "phoneshop-mgr-pro-2026.firebasestorage.app",
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "AIzaSyCYQopJt3Ppyd8BV-o0c1pd-AONwEqBFXw",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "phoneshop-mgr-pro-2026.firebaseapp.com",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "382569044952",
};

export const app = initializeApp(firebaseConfig);

let firestoreSettings: any = { ignoreUndefinedProperties: true };
try {
  // If IndexedDB or local storage provider is present, enable persistent local cache
  if (typeof window !== 'undefined' && ((window as any).indexedDB || (globalThis as any).indexedDB)) {
    firestoreSettings.localCache = persistentLocalCache({});
  }
} catch {
  // Graceful fallback to default cache
}

export const db = initializeFirestore(app, firestoreSettings);
export const auth = getAuth(app);
