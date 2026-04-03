import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { createClaimQrToken } from "./claimQr";

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

export const buildClaimId = (eventId, claimKey) =>
  `${eventId}__${encodeURIComponent(claimKey)}`;

const getClaimRef = (claimId) =>
  doc(db, "events", "live-number-caller", "claims", claimId);

const claimsCollectionRef = firebaseEnabled
  ? collection(db, "events", "live-number-caller", "claims")
  : null;
const usersCollectionRef = firebaseEnabled ? collection(db, "users") : null;

export const getModeFromUrl = () => {
  const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";

  if (normalizedPath === "/display") {
    return "display";
  }

  if (normalizedPath === "/control") {
    return "control";
  }

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");

  return mode === "display" || mode === "control" ? mode : null;
};

export const getScreenUrl = (mode) => {
  const url = new URL(window.location.href);

  url.pathname = mode ? `/${mode}` : "/";
  url.searchParams.delete("mode");

  if (mode) {
    url.searchParams.delete("claim");
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

export const subscribeToClaim = ({ claimId, onClaim, onError }) => {
  if (!firebaseEnabled || !claimId) {
    return () => {};
  }

  return onSnapshot(
    getClaimRef(claimId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onClaim(null);
        return;
      }

      onClaim(snapshot.data());
    },
    onError,
  );
};

export const subscribeToClaims = ({ onClaims, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    claimsCollectionRef,
    (snapshot) => {
      onClaims(
        snapshot.docs.map((claimDoc) => ({
          claimId: claimDoc.id,
          ...claimDoc.data(),
        })),
      );
    },
    onError,
  );
};

export const subscribeToUsers = ({ onUsers, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    usersCollectionRef,
    (snapshot) => {
      onUsers(
        snapshot.docs.map((userDoc) => ({
          userId: userDoc.id,
          ...userDoc.data(),
        })),
      );
    },
    onError,
  );
};

export const createLiveEvent = async ({
  claimAccessSecret,
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
    claimAccessSecret,
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
    claimAccessSecret: "",
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
  isMember,
  participantType,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const claimId = buildClaimId(eventId, claimKey);
  const claimRef = getClaimRef(claimId);

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
      const qrToken = existingClaim.qrToken ?? createClaimQrToken();

      if (!existingClaim.qrToken) {
        transaction.update(claimRef, {
          qrToken,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        claimId,
        existing: true,
        isMember: existingClaim.isMember ?? false,
        itemsClaimedCount: existingClaim.itemsClaimedCount ?? 0,
        number: existingClaim.number,
        qrToken,
        redeemedRound: existingClaim.redeemedRound ?? 0,
      };
    }

    const number = liveEvent.nextClaimNumber ?? 1;
    const qrToken = createClaimQrToken();

    transaction.set(claimRef, {
      claimedAt: serverTimestamp(),
      discordUserId: discordUserId ?? null,
      displayName,
      email: email ?? null,
      eventId,
      isMember: isMember ?? false,
      itemsClaimedCount: 0,
      number,
      participantType,
      qrToken,
      redeemedRound: 0,
      updatedAt: serverTimestamp(),
    });

    transaction.update(liveStateRef, {
      claimCount: number,
      nextClaimNumber: number + 1,
      updatedAt: serverTimestamp(),
    });

    return {
      claimId,
      existing: false,
      isMember: isMember ?? false,
      itemsClaimedCount: 0,
      number,
      qrToken,
      redeemedRound: 0,
    };
  });
};

export const redeemClaimByQr = async ({ claimId, eventId, qrToken }) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const claimRef = getClaimRef(claimId);

  return runTransaction(db, async (transaction) => {
    const [liveEventSnapshot, claimSnapshot] = await Promise.all([
      transaction.get(liveStateRef),
      transaction.get(claimRef),
    ]);

    if (!liveEventSnapshot.exists()) {
      throw new Error("The event is not open yet.");
    }

    if (!claimSnapshot.exists()) {
      throw new Error("This claim could not be found.");
    }

    const liveEvent = liveEventSnapshot.data();
    const claim = claimSnapshot.data();
    const currentRound = liveEvent.state?.round ?? 1;
    const currentNumber = liveEvent.state?.current ?? 0;

    if (!liveEvent.active || liveEvent.eventId !== eventId) {
      throw new Error("This QR code is for a different event.");
    }

    if (claim.eventId !== eventId || claim.qrToken !== qrToken) {
      throw new Error("This QR code is no longer valid.");
    }

    if (currentNumber < claim.number) {
      throw new Error("This number is not eligible yet.");
    }

    if ((claim.redeemedRound ?? 0) === currentRound) {
      return {
        alreadyRedeemed: true,
        displayName: claim.displayName,
        number: claim.number,
        round: currentRound,
      };
    }

    transaction.update(claimRef, {
      itemsClaimedCount: (claim.itemsClaimedCount ?? 0) + 1,
      redeemedAt: serverTimestamp(),
      redeemedRound: currentRound,
      updatedAt: serverTimestamp(),
    });

    return {
      alreadyRedeemed: false,
      displayName: claim.displayName,
      number: claim.number,
      round: currentRound,
    };
  });
};