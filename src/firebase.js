import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
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

// Debug: surface config presence to the browser console for local debugging.
try {
  // Only run in browser environments where `console` is available.
  // Log which Vite vars are present (avoid printing secret values).
  // This helps diagnose "Connecting to live event…" hangs caused by missing env or blocked network.
   
  console.debug("Firebase config present?", {
    apiKey: Boolean(firebaseConfig.apiKey),
    authDomain: Boolean(firebaseConfig.authDomain),
    projectId: Boolean(firebaseConfig.projectId),
    appId: Boolean(firebaseConfig.appId),
    firebaseEnabled,
  });
} catch {
  // ignore in non-browser runtimes
}
const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
export const auth = firebaseEnabled ? getAuth(app) : null;
export const db = firebaseEnabled ? getFirestore(app) : null;
const functions = firebaseEnabled ? getFunctions(app) : null;
const liveStateRef = firebaseEnabled
  ? doc(db, "events", "live-number-caller")
  : null;
const displayFeedRef = firebaseEnabled
  ? doc(db, "events", "live-number-caller", "public", "display-feed")
  : null;

export const buildClaimId = (eventId, claimKey) =>
  `${eventId}__${encodeURIComponent(claimKey)}`;

const getClaimRef = (claimId) =>
  doc(db, "events", "live-number-caller", "claims", claimId);

const claimsCollectionRef = firebaseEnabled
  ? collection(db, "events", "live-number-caller", "claims")
  : null;
const exchangeDiscordAccessTokenCallable = firebaseEnabled
  ? httpsCallable(functions, "exchangeDiscordAccessToken")
  : null;
const assignPreclaimIfQueuedCallable = firebaseEnabled
  ? httpsCallable(functions, "assignPreclaimIfQueued")
  : null;
const listPreclaimsCallable = firebaseEnabled ? httpsCallable(functions, "listPreclaims") : null;
const assignPreclaimAsStaffCallable = firebaseEnabled ? httpsCallable(functions, "assignPreclaimAsStaff") : null;
const removePreclaimAsStaffCallable = firebaseEnabled ? httpsCallable(functions, "removePreclaimAsStaff") : null;
const refreshPreclaimMembershipAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "refreshPreclaimMembershipAsStaff")
  : null;
const refreshAllPreclaimMembershipsAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "refreshAllPreclaimMembershipsAsStaff")
  : null;
const removeClaimCallable = firebaseEnabled ? httpsCallable(functions, "removeClaim") : null;
const moveClaimBackToQueueAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "moveClaimBackToQueueAsStaff")
  : null;
const redeemClaimByQrAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "redeemClaimByQrAsStaff")
  : null;
const readPreclaimForUserCallable = firebaseEnabled
  ? httpsCallable(functions, "readPreclaimForUser")
  : null;

export const signInWithDiscordAccessToken = async ({ accessToken }) => {
  if (!firebaseEnabled || !auth || !exchangeDiscordAccessTokenCallable) {
    throw new Error("Firebase is not configured.");
  }

  const result = await exchangeDiscordAccessTokenCallable({ accessToken });
  const firebaseCustomToken = result.data?.firebaseCustomToken;
  const profile = result.data?.profile;

  if (typeof firebaseCustomToken !== "string" || !firebaseCustomToken) {
    throw new Error("Unable to establish trusted Firebase access.");
  }

  await signInWithCustomToken(auth, firebaseCustomToken);

  if (!profile || typeof profile !== "object") {
    throw new Error("Trusted Firebase access did not return a profile.");
  }

  return profile;
};

export const assignPreclaimIfQueued = async ({ eventId, claimKey }) => {
  if (!firebaseEnabled || !assignPreclaimIfQueuedCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await assignPreclaimIfQueuedCallable({ eventId, claimKey });

  return result.data;
};

export const readPreclaimForUser = async ({ eventId, claimKey }) => {
  if (!firebaseEnabled || !readPreclaimForUserCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await readPreclaimForUserCallable({ eventId, claimKey });

  return result.data;
};

export const readAllPreclaims = async () => {
  if (!firebaseEnabled || !listPreclaimsCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await listPreclaimsCallable({});

  return result.data?.preclaims ?? [];
};

export const assignPreclaimAsStaff = async ({ preclaimId }) => {
  if (!firebaseEnabled || !assignPreclaimAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await assignPreclaimAsStaffCallable({ preclaimId });

  return result.data;
};

export const removePreclaimAsStaff = async ({ preclaimId }) => {
  if (!firebaseEnabled || !removePreclaimAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await removePreclaimAsStaffCallable({ preclaimId });

  return result.data;
};

export const refreshPreclaimMembershipAsStaff = async ({ preclaimId }) => {
  if (!firebaseEnabled || !refreshPreclaimMembershipAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await refreshPreclaimMembershipAsStaffCallable({ preclaimId });

  return result.data;
};

export const refreshAllPreclaimMembershipsAsStaff = async () => {
  if (!firebaseEnabled || !refreshAllPreclaimMembershipsAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await refreshAllPreclaimMembershipsAsStaffCallable({});

  return result.data;
};

export const removeClaim = async ({ claimId }) => {
  if (!firebaseEnabled || !removeClaimCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await removeClaimCallable({ claimId });

  return result.data;
};

export const moveClaimBackToQueueAsStaff = async ({ claimId }) => {
  if (!firebaseEnabled || !moveClaimBackToQueueAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await moveClaimBackToQueueAsStaffCallable({ claimId });

  return result.data;
};

export const signOutTrustedAuth = async () => {
  if (!auth) {
    return;
  }

  await signOut(auth);
};

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
  url.hash = "";
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

  // Wrap handlers with debug logs to make subscription state visible in browser console.
  const wrappedOnEvent = (snapshot) => {
    try {
       
      console.debug("subscribeToLiveEvent: snapshot received", { exists: snapshot.exists });
    } catch {
      // ignore
    }

    if (!snapshot.exists) {
      onEvent(null);
      return;
    }

    onEvent(snapshot.data());
  };

  const wrappedOnError = (err) => {
     
    console.error("subscribeToLiveEvent: error", err && (err.message || err));
    if (typeof onError === "function") onError(err);
  };

  return onSnapshot(liveStateRef, wrappedOnEvent, wrappedOnError);
};

export const readLiveEventOnce = async () => {
  if (!firebaseEnabled) {
    return null;
  }

  const snapshot = await getDoc(liveStateRef);

  return snapshot.exists() ? snapshot.data() : null;
};

export const subscribeToClaim = ({ claimId, onClaim, onError }) => {
  if (!firebaseEnabled || !claimId) {
    return () => {};
  }

  // Workaround for an intermittent Firestore watch-stream internal assertion
  // (`Unexpected state` IDs such as ca9/b815) observed during rapid claim/preclaim
  // create/delete flows. Polling avoids that watch edge case.
  let isDisposed = false;
  let timeoutId = null;

  const poll = async () => {
    if (isDisposed) {
      return;
    }

    try {
      const snapshot = await getDoc(getClaimRef(claimId));
      if (isDisposed) {
        return;
      }

      onClaim(snapshot.exists() ? snapshot.data() : null);
    } catch (error) {
      if (!isDisposed && typeof onError === "function") {
        onError(error);
      }
    } finally {
      if (!isDisposed) {
        timeoutId = window.setTimeout(() => {
          void poll();
        }, 1200);
      }
    }
  };

  void poll();

  return () => {
    isDisposed = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

export const readPreclaimOnce = async ({ claimId }) => {
  if (!firebaseEnabled || !claimId) {
    return null;
  }

  const preclaimRef = doc(db, "events", "live-number-caller", "preclaims", claimId);
  const snapshot = await getDoc(preclaimRef);

  return snapshot.exists() ? snapshot.data() : null;
};

export const subscribeToPreclaim = ({ claimId, onPreclaim, onError }) => {
  if (!firebaseEnabled || !claimId) {
    return () => {};
  }

  const preclaimRef = doc(db, "events", "live-number-caller", "preclaims", claimId);
  let isDisposed = false;
  let timeoutId = null;

  const poll = async () => {
    if (isDisposed) {
      return;
    }

    try {
      const snapshot = await getDoc(preclaimRef);
      if (isDisposed) {
        return;
      }

      onPreclaim(snapshot.exists() ? snapshot.data() : null);
    } catch (error) {
      if (!isDisposed && typeof onError === "function") {
        onError(error);
      }
    } finally {
      if (!isDisposed) {
        timeoutId = window.setTimeout(() => {
          void poll();
        }, 1200);
      }
    }
  };

  void poll();

  return () => {
    isDisposed = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

export const subscribeToDisplayFeed = ({ onFeed, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    displayFeedRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onFeed([]);
        return;
      }

      const feedItems = snapshot.data()?.items;
      onFeed(Array.isArray(feedItems) ? feedItems : []);
    },
    onError,
  );
};

export const readClaimOnce = async ({ claimId }) => {
  if (!firebaseEnabled || !claimId) {
    return null;
  }

  const snapshot = await getDoc(getClaimRef(claimId));

  return snapshot.exists() ? snapshot.data() : null;
};

export const subscribeToClaims = ({ onClaims, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  let isDisposed = false;
  let timeoutId = null;

  const poll = async () => {
    if (isDisposed) {
      return;
    }

    try {
      const snapshot = await getDocs(claimsCollectionRef);
      if (isDisposed) {
        return;
      }

      onClaims(
        snapshot.docs.map((claimDoc) => ({
          claimId: claimDoc.id,
          ...claimDoc.data(),
        })),
      );
    } catch (error) {
      if (!isDisposed && typeof onError === "function") {
        onError(error);
      }
    } finally {
      if (!isDisposed) {
        timeoutId = window.setTimeout(() => {
          void poll();
        }, 1400);
      }
    }
  };

  void poll();

  return () => {
    isDisposed = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
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

  const liveEventSnapshot = await getDoc(liveStateRef);
  const liveEventData = liveEventSnapshot.exists() ? liveEventSnapshot.data() || {} : {};
  const sanitizedLiveEventData = {
    active: liveEventData.active === true,
    claimCount: Number.isFinite(liveEventData.claimCount)
      ? Math.max(0, Math.trunc(liveEventData.claimCount))
      : 0,
    claimAccessSecret:
      typeof liveEventData.claimAccessSecret === "string" ? liveEventData.claimAccessSecret : "",
    eventId:
      liveEventData.eventId == null
        ? null
        : typeof liveEventData.eventId === "string"
          ? liveEventData.eventId
          : String(liveEventData.eventId),
    nextClaimNumber:
      Number.isFinite(liveEventData.nextClaimNumber) && liveEventData.nextClaimNumber >= 1
        ? Math.trunc(liveEventData.nextClaimNumber)
        : 1,
    state,
    timeframeEnd,
    timeframeLabel,
    timeframeStart,
    updatedAt: serverTimestamp(),
  };

  if (liveEventData.startedAt != null) {
    sanitizedLiveEventData.startedAt = liveEventData.startedAt;
  }

  if (liveEventData.endedAt != null) {
    sanitizedLiveEventData.endedAt = liveEventData.endedAt;
  }

  await setDoc(liveStateRef, sanitizedLiveEventData);
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
  avatarUrl,
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
      const claimUpdates = {
        updatedAt: serverTimestamp(),
      };
      let shouldUpdate = false;

      if (!existingClaim.qrToken) {
        claimUpdates.qrToken = qrToken;
        shouldUpdate = true;
      }

      if (avatarUrl && existingClaim.avatarUrl !== avatarUrl) {
        claimUpdates.avatarUrl = avatarUrl;
        shouldUpdate = true;
      }

      if (displayName && existingClaim.displayName !== displayName) {
        claimUpdates.displayName = displayName;
        shouldUpdate = true;
      }

      if (!existingClaim.joinedAt) {
        claimUpdates.joinedAt = existingClaim.claimedAt ?? serverTimestamp();
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        transaction.update(claimRef, claimUpdates);
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
      avatarUrl: avatarUrl ?? "",
      claimedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      discordUserId: discordUserId ?? null,
      displayName,
      email: email ?? null,
      eventId,
      isMember: isMember ?? false,
      itemClaimedAtMsHistory: [],
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

export const enqueuePreclaim = async ({
  claimKey,
  avatarUrl,
  discordUserId,
  displayName,
  eventId,
  isMember,
  participantType,
  memberEligibleAt,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const claimId = buildClaimId(eventId, claimKey);
  const preclaimRef = doc(db, "events", "live-number-caller", "preclaims", claimId);
  try {
     
    console.debug("enqueuePreclaim: writing preclaim", { claimId, eventId, claimKey });

    // Log current auth user id and custom claims (if available) to help debug rules
    try {
      if (auth && auth.currentUser) {
         
        console.debug("enqueuePreclaim: auth.currentUser.uid", auth.currentUser.uid);
        try {
          const idTokenResult = await auth.currentUser.getIdTokenResult();
           
          console.debug("enqueuePreclaim: idTokenResult.claims", idTokenResult.claims);
        } catch (tokenErr) {
           
          console.debug("enqueuePreclaim: failed to getIdTokenResult", tokenErr && (tokenErr.message || tokenErr));
        }
      } else {
         
        console.debug("enqueuePreclaim: no auth.currentUser available");
      }
    } catch {
      // swallow logging errors
    }

      // Prefer the authenticated user's UID for discordUserId when available
      const finalDiscordUserId = (auth && auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : (discordUserId ?? null);

      const docPayload = {
        avatarUrl: avatarUrl ?? "",
        createdAt: serverTimestamp(),
        discordUserId: finalDiscordUserId,
        // Ensure displayName is non-empty so security rules allow the write.
        displayName: (displayName && displayName.length > 0) ? displayName : (finalDiscordUserId ? String(finalDiscordUserId) : "Guest"),
        eventId,
        memberEligibleAt: memberEligibleAt ?? null,
        isMember: isMember ?? false,
        // Ensure participantType is present for rule validation.
        participantType: participantType ?? "discord",
        updatedAt: serverTimestamp(),
      };

       
      console.debug("enqueuePreclaim: final payload", docPayload);

      await setDoc(preclaimRef, docPayload, { merge: true });

     
    console.debug("enqueuePreclaim: write successful", { claimId });

    return { claimId };
  } catch (e) {
     
    console.error("enqueuePreclaim failed (client):", e && (e.code || e.message || e), e);
    throw e;
  }
};

export const updatePreclaimMembership = async ({
  claimKey,
  eventId,
  isMember,
  memberEligibleAt,
  displayName,
  avatarUrl,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const claimId = buildClaimId(eventId, claimKey);
  const preclaimRef = doc(db, "events", "live-number-caller", "preclaims", claimId);

  // Use auth.currentUser.uid when available to keep owner identity consistent
  const finalDiscordUserId = (auth && auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : null;

  const updatePayload = {
    isMember: isMember ?? false,
    memberEligibleAt: memberEligibleAt ?? null,
    // Ensure displayName is non-empty so security rules allow the update.
    displayName: (displayName && displayName.length > 0) ? displayName : (finalDiscordUserId ? String(finalDiscordUserId) : "Guest"),
    avatarUrl: avatarUrl ?? "",
    discordUserId: finalDiscordUserId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    eventId,
  };

  // Ensure participantType is present (rules require it)
  try {
    const existing = await getDoc(preclaimRef);
    const existingParticipantType = existing.exists() ? existing.data()?.participantType : null;

    updatePayload.participantType = existingParticipantType || "discord";
  } catch {
    updatePayload.participantType = "discord";
  }

   
  console.debug("updatePreclaimMembership: updating preclaim", { claimId, updatePayload, finalDiscordUserId });

  await setDoc(preclaimRef, updatePayload, { merge: true });

  return { claimId };
};

export const redeemClaimByQr = async ({ claimId, eventId, qrToken }) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  if (redeemClaimByQrAsStaffCallable) {
    if (auth?.currentUser) {
      try {
        await auth.currentUser.getIdToken(true);
      } catch {
        // Continue; callable will surface a clear auth error if token is invalid.
      }
    }

    const result = await redeemClaimByQrAsStaffCallable({ claimId, eventId, qrToken });
    return result.data;
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

    const nextItemClaimedAtMsHistory = [
      ...(Array.isArray(claim.itemClaimedAtMsHistory) ? claim.itemClaimedAtMsHistory : []),
      Date.now(),
    ];

    transaction.update(claimRef, {
      itemClaimedAtMsHistory: nextItemClaimedAtMsHistory,
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
