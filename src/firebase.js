import { initializeApp } from "firebase/app";
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
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
export const db = firebaseEnabled ? getFirestore(app) : null;
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

  if (mode) {
    url.searchParams.set("mode", mode);
  } else {
    url.searchParams.delete("mode");
  }

  return url.toString();
};

export const subscribeToLiveEvent = ({ onEvent, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    liveStateRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onEvent(null);
        return;
      }

      onEvent(snapshot.data());
    },
    onError,
  );
};

export const createLiveEvent = async ({
  eventId,
  state,
  timeframeEnd,
  timeframeLabel,
  timeframeStart,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  await setDoc(liveStateRef, {
    active: true,
    claimCount: 0,
    eventId,
    nextClaimNumber: 1,
    state,
    startedAt: serverTimestamp(),
    timeframeEnd,
    timeframeLabel,
    timeframeStart,
    updatedAt: serverTimestamp(),
  });
};

export const updateLiveEventDetails = async ({
  state,
  timeframeEnd,
  timeframeLabel,
  timeframeStart,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  await updateDoc(liveStateRef, {
    state,
    timeframeEnd,
    timeframeLabel,
    timeframeStart,
    updatedAt: serverTimestamp(),
  });
};

export const pushLiveState = async (state) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  await updateDoc(liveStateRef, {
    state,
    updatedAt: serverTimestamp(),
  });
};

export const closeLiveEvent = async ({ state }) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  await setDoc(liveStateRef, {
    active: false,
    claimCount: 0,
    endedAt: serverTimestamp(),
    eventId: null,
    nextClaimNumber: 1,
    state,
    timeframeEnd: "",
    timeframeLabel: "",
    timeframeStart: "",
    updatedAt: serverTimestamp(),
  });
};

export const claimEventNumber = async ({
  claimKey,
  discordUserId,
  displayName,
  email,
  eventId,
  participantType,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const claimId = `${eventId}__${encodeURIComponent(claimKey)}`;
  const claimRef = doc(db, "events", "live-number-caller", "claims", claimId);

  return runTransaction(db, async (transaction) => {
    const liveEventSnapshot = await transaction.get(liveStateRef);

    if (!liveEventSnapshot.exists()) {
      throw new Error("The event is not open yet.");
    }

    const liveEvent = liveEventSnapshot.data();

    if (!liveEvent.active || liveEvent.eventId !== eventId) {
      throw new Error("This event is no longer accepting claims.");
    }

    const existingClaimSnapshot = await transaction.get(claimRef);

    if (existingClaimSnapshot.exists()) {
      const existingClaim = existingClaimSnapshot.data();

      return {
        existing: true,
        number: existingClaim.number,
      };
    }

    const number = liveEvent.nextClaimNumber ?? 1;

    transaction.set(claimRef, {
      claimedAt: serverTimestamp(),
      discordUserId: discordUserId ?? null,
      displayName,
      email: email ?? null,
      eventId,
      number,
      participantType,
    });

    transaction.update(liveStateRef, {
      claimCount: number,
      nextClaimNumber: number + 1,
      updatedAt: serverTimestamp(),
    });

    return {
      existing: false,
      number,
    };
  });
};