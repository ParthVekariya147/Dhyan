import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);

/**
 * Firestore with offline persistence switched on.
 *
 * This is not a nicety — it is how the app stays inside the free tier. The spec (§12)
 * warns that 2,000 yuvaks × 108 ticks would be ~216,000 writes/day against a 20,000
 * limit. Ticks therefore live in localStorage and only the day's *result* is written
 * once per yuvak per day; persistent cache means the 108 વર્ણન and the user's own
 * documents are read from disk on repeat visits rather than re-fetched.
 *
 * multipleTabManager keeps that cache coherent if a yuvak opens two tabs.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
