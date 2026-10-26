import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from 'firebase/firestore';

// Replace these with your actual Firebase project configuration via .env
const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "your-firebase-project-id",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "your-firebase-app-id",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "your-project-id.firebasestorage.app",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "your-firebase-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "your-project-id.firebaseapp.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "your-messaging-sender-id",
};

export const app = initializeApp(firebaseConfig);

let firestoreInstance;
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

export const db = firestoreInstance;
export const auth = getAuth(app);

