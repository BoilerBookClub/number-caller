import { initializeApp } from "firebase/app";
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];

export const firebaseEnabled = requiredConfig.every(Boolean);

const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
const db = firebaseEnabled ? getFirestore(app) : null;
const liveStateRef = firebaseEnabled
  ? doc(db, "events", "live-number-caller")
  : null;

export const getModeFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");

  return mode === "display" || mode === "control" ? mode : null;
};

export const getScreenUrl = (mode) => {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode);

  return url.toString();
};

export const subscribeToLiveState = ({ onState, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    liveStateRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onState(null);
        return;
      }

      const data = snapshot.data();
      onState(data.state ?? null);
    },
    onError,
  );
};

export const pushLiveState = async (state) => {
  if (!firebaseEnabled) {
    return;
  }

  await setDoc(liveStateRef, {
    state,
    updatedAt: serverTimestamp(),
  });
};