import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

import {
  applyStateChanges,
  getStateChanges,
  hasUnchangedStateFields,
  normalizeState,
} from "./eventState.js";

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

/**
 * App Check attests that requests come from this app rather than a script.
 *
 * Opt-in by design: set VITE_FIREBASE_APPCHECK_SITE_KEY once the reCAPTCHA v3
 * key is registered. Turning it on here only makes the client *send* tokens —
 * the functions keep accepting requests without them until you separately set
 * ENFORCE_APP_CHECK=true, so you can watch the App Check metrics in the console
 * and confirm real traffic is verified before anything starts getting rejected.
 */
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;

if (app && appCheckSiteKey) {
  try {
    // Lets a developer machine mint a debug token instead of solving reCAPTCHA.
    if (import.meta.env.DEV) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    initializeAppCheck(app, {
      isTokenAutoRefreshEnabled: true,
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
    });
  } catch (error) {
    // Never let attestation setup stop an attendee from claiming a number.
    console.error("App Check setup failed:", error?.message || error);
  }
}
export const auth = firebaseEnabled ? getAuth(app) : null;
export const db = firebaseEnabled ? getFirestore(app) : null;
const functions = firebaseEnabled ? getFunctions(app) : null;

/**
 * Point everything at the local emulator suite.
 *
 * Set VITE_USE_FIREBASE_EMULATORS=true in .env.local and run `npm run emulators`
 * to work against local Firestore, Auth and Functions — no live project, no real
 * attendees, and rules changes take effect on save.
 */
if (firebaseEnabled && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  const emulatorHost = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || "127.0.0.1";

  connectFirestoreEmulator(db, emulatorHost, 8080);
  connectFunctionsEmulator(functions, emulatorHost, 5001);
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });

  console.warn(`Firebase is using local emulators at ${emulatorHost}.`);
}
const liveStateRef = firebaseEnabled
  ? doc(db, "events", "live-number-caller")
  : null;
// How many activity items the display shows.
const DISPLAY_FEED_LIMIT = 5;

// Staff-only. Kept out of the live event document, which is publicly readable.
const claimAccessRef = firebaseEnabled
  ? doc(db, "events", "live-number-caller", "private", "claim-access")
  : null;
const displayFeedCollectionRef = firebaseEnabled
  ? collection(db, "events", "live-number-caller", "feed")
  : null;

/*
 * The newest few activity items *for this event*.
 *
 * The eventId filter is the second fence rather than the first: the feed is
 * emptied when an event closes and when the event id changes, so in the
 * ordinary case there is nothing in here that belongs to anybody else. The case
 * it exists for is a close that failed part way, which is precisely the case
 * where the leftovers are last event's attendees — names and avatars — and the
 * place they would surface is a projector in front of a room.
 *
 * Items written before the field existed carry no eventId and so drop out of
 * this query. That is the right way round: an item old enough to predate the
 * stamp is old enough not to belong on the current event's display.
 */
const buildDisplayFeedQuery = (eventId) =>
  eventId
    ? query(
        displayFeedCollectionRef,
        where("eventId", "==", eventId),
        orderBy("timestampMs", "desc"),
        limit(DISPLAY_FEED_LIMIT),
      )
    : query(
        displayFeedCollectionRef,
        orderBy("timestampMs", "desc"),
        limit(DISPLAY_FEED_LIMIT),
      );

export const buildClaimId = (eventId, claimKey) =>
  `${eventId}__${encodeURIComponent(claimKey)}`;

const getClaimRef = (claimId) =>
  doc(db, "events", "live-number-caller", "claims", claimId);

const claimsCollectionRef = firebaseEnabled
  ? collection(db, "events", "live-number-caller", "claims")
  : null;
const exchangeDiscordAuthCodeCallable = firebaseEnabled
  ? httpsCallable(functions, "exchangeDiscordAuthCode")
  : null;
const refreshTrustedSessionCallable = firebaseEnabled
  ? httpsCallable(functions, "refreshTrustedSession")
  : null;
const assignPreclaimIfQueuedCallable = firebaseEnabled
  ? httpsCallable(functions, "assignPreclaimIfQueued")
  : null;
const assignPreclaimAsStaffCallable = firebaseEnabled ? httpsCallable(functions, "assignPreclaimAsStaff") : null;
const removePreclaimAsStaffCallable = firebaseEnabled ? httpsCallable(functions, "removePreclaimAsStaff") : null;
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
const redeemRaffleByQrAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "redeemRaffleByQrAsStaff")
  : null;
const joinRaffleAsAttendeeCallable = firebaseEnabled
  ? httpsCallable(functions, "joinRaffleAsAttendee")
  : null;
const claimNumberAsAttendeeCallable = firebaseEnabled
  ? httpsCallable(functions, "claimNumberAsAttendee")
  : null;
const joinQueueAsAttendeeCallable = firebaseEnabled
  ? httpsCallable(functions, "joinQueueAsAttendee")
  : null;
const fetchLatestAnnouncementCallable = firebaseEnabled
  ? httpsCallable(functions, "fetchLatestAnnouncement")
  : null;
const listArchivedEventsCallable = firebaseEnabled
  ? httpsCallable(functions, "listArchivedEvents")
  : null;
const readArchivedEventCallable = firebaseEnabled
  ? httpsCallable(functions, "readArchivedEvent")
  : null;
const seedDemoParticipantsAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "seedDemoParticipantsAsStaff")
  : null;
const assignQueuedDemoParticipantsAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "assignQueuedDemoParticipantsAsStaff")
  : null;
const redeemDemoClaimAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "redeemDemoClaimAsStaff")
  : null;
const joinRaffleAsDemoParticipantAsStaffCallable = firebaseEnabled
  ? httpsCallable(functions, "joinRaffleAsDemoParticipantAsStaff")
  : null;
const deleteArchivedEventCallable = firebaseEnabled
  ? httpsCallable(functions, "deleteArchivedEvent")
  : null;

/**
 * Trades a Discord authorization code for a Firebase session.
 *
 * The code and the PKCE verifier are the only credentials that leave the
 * browser, and neither is reusable: the code is single-use and the exchange
 * needs a client secret this app does not have. Nothing Discord-issued comes
 * back — only a Firebase custom token and the display profile.
 */
export const signInWithDiscordAuthCode = async ({ code, codeVerifier, redirectUri }) => {
  if (!firebaseEnabled || !auth || !exchangeDiscordAuthCodeCallable) {
    throw new Error("Firebase is not configured.");
  }

  const result = await exchangeDiscordAuthCodeCallable({ code, codeVerifier, redirectUri });
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

/**
 * Re-checks the signed-in user's Discord roles and reissues their session.
 *
 * Runs on page load in place of the old "replay the stored access token"
 * step. The server does the role lookup with its bot credentials, so a role
 * change still lands within a session without the browser holding anything of
 * Discord's.
 */
export const refreshTrustedSession = async () => {
  if (!firebaseEnabled || !auth || !refreshTrustedSessionCallable) {
    throw new Error("Firebase is not configured.");
  }

  const result = await refreshTrustedSessionCallable({});
  const firebaseCustomToken = result.data?.firebaseCustomToken;

  if (typeof firebaseCustomToken !== "string" || !firebaseCustomToken) {
    throw new Error("Unable to refresh trusted Firebase access.");
  }

  await signInWithCustomToken(auth, firebaseCustomToken);

  return {
    hasFullAccess: Boolean(result.data?.hasFullAccess),
    isMember: Boolean(result.data?.isMember),
  };
};

export const assignPreclaimIfQueued = async ({ eventId, claimKey }) => {
  if (!firebaseEnabled || !assignPreclaimIfQueuedCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await assignPreclaimIfQueuedCallable({ eventId, claimKey });

  return result.data;
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

/**
 * The rotating check-in secret, used by the display to build its QR code.
 * Staff-only: attendees have no reason to hold the secret, and letting them
 * would make the display QR code forgeable from anywhere.
 */
export const subscribeToClaimAccessSecret = ({ onSecret, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    claimAccessRef,
    (snapshot) => {
      const secret = snapshot.exists() ? snapshot.data()?.secret : "";
      onSecret(typeof secret === "string" ? secret : "");
    },
    onError,
  );
};

/**
 * Watches a document or query, falling back to polling if the watch stream dies.
 *
 * These subscriptions were all rewritten as polling loops to dodge an
 * intermittent Firestore watch-stream assertion ("Unexpected state", ids like
 * ca9/b815) seen during rapid claim/preclaim create-delete churn. Polling made
 * that impossible to hit, but it cost a read per document per interval — the
 * control panel alone re-read every claim ever created, roughly seventy times a
 * second.
 *
 * A listener is the right shape, so use one; if it errors we degrade to the old
 * polling behaviour rather than leaving the screen frozen mid-event. The SDK bug
 * is several majors old at this point, so the fallback should stay cold.
 */
/**
 * How many polls to serve before trying the listener again.
 *
 * Falling back used to be one-way: a single watch error put a device on a
 * 1,200ms poll of two documents for the rest of the session, about 1.7 reads a
 * second. One transient blip is not usually one device's blip — a saturated
 * venue network drops the whole room at once — so three hundred devices would
 * come out of it polling, roughly 500 reads a second, all evening, for
 * documents that change a handful of times per attendee.
 *
 * Retrying the listener costs one attempt every ~24 seconds per subscription
 * and, when it attaches, ends the polling for good.
 */
const POLLS_BEFORE_RETRYING_WATCH = 20;

const subscribeWithPollingFallback = ({
  onData,
  onError,
  pollIntervalMs,
  readOnce,
  watch,
}) => {
  let isDisposed = false;
  let stopWatching = null;
  let timeoutId = null;
  let pollsSinceWatchAttempt = 0;

  const handleValue = (value) => {
    if (!isDisposed) {
      onData(value);
    }
  };

  const startPolling = () => {
    const poll = async () => {
      if (isDisposed) {
        return;
      }

      try {
        /* Through handleValue, not onData directly: the await below is a
           network round trip, and a subscription disposed while it was in
           flight would otherwise still deliver into an unmounted screen. */
        handleValue(await readOnce());
      } catch (error) {
        if (!isDisposed && typeof onError === "function") {
          onError(error);
        }
      }

      if (isDisposed) {
        return;
      }

      pollsSinceWatchAttempt += 1;

      if (pollsSinceWatchAttempt >= POLLS_BEFORE_RETRYING_WATCH) {
        pollsSinceWatchAttempt = 0;
        // Stop the timer before attaching. If the listener holds it will start
        // delivering on its own, and a poll loop still running alongside it is
        // the cost this exists to remove; if it fails, its error handler starts
        // a fresh one.
        timeoutId = null;
        attachWatch();
        return;
      }

      timeoutId = window.setTimeout(() => {
        void poll();
      }, pollIntervalMs);
    };

    void poll();
  };

  function attachWatch() {
    if (isDisposed) {
      return;
    }

    stopWatching = watch(handleValue, (error) => {
      if (isDisposed) {
        return;
      }

      console.warn("Live listener failed; falling back to polling.", error?.message || error);
      stopWatching = null;
      startPolling();
    });
  }

  attachWatch();

  return () => {
    isDisposed = true;

    if (stopWatching) {
      stopWatching();
    }

    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

/**
 * The live event, which every screen in the app is derived from.
 *
 * Routed through the polling fallback like the claim and roster subscriptions,
 * which it was not before. It is the single most important listener there is —
 * it carries the called number, so it is what turns an attendee's ticket over —
 * and it was the one with no recovery path: a bare onSnapshot whose error
 * handler only logged. The SDK retries transient stream failures itself, so this
 * only bites on a terminal one, but when it did the page froze on stale state
 * for the rest of the evening with nothing on screen to say so.
 *
 * Polled slower than the claim subscriptions when it is degraded. This is one
 * document and the fallback is a degraded mode, not the normal one; at three
 * hundred devices a fast poll here is the stampede the fallback exists to avoid.
 */
export const subscribeToLiveEvent = ({ onEvent, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  return subscribeWithPollingFallback({
    onData: onEvent,
    onError,
    pollIntervalMs: 5000,
    readOnce: async () => {
      const snapshot = await getDoc(liveStateRef);
      return snapshot.exists() ? snapshot.data() : null;
    },
    watch: (next, fail) =>
      onSnapshot(liveStateRef, (snapshot) => next(snapshot.exists() ? snapshot.data() : null), fail),
  });
};

export const subscribeToClaim = ({ claimId, onClaim, onError }) => {
  if (!firebaseEnabled || !claimId) {
    return () => {};
  }

  const claimRef = getClaimRef(claimId);

  return subscribeWithPollingFallback({
    onData: onClaim,
    onError,
    pollIntervalMs: 1200,
    readOnce: async () => {
      const snapshot = await getDoc(claimRef);
      return snapshot.exists() ? snapshot.data() : null;
    },
    watch: (next, fail) =>
      onSnapshot(claimRef, (snapshot) => next(snapshot.exists() ? snapshot.data() : null), fail),
  });
};

const preclaimsCollectionRef = firebaseEnabled
  ? collection(db, "events", "live-number-caller", "preclaims")
  : null;

/**
 * The pre-event queue, live.
 *
 * Staff-only by security rule, like the roster. This replaced a five-second
 * poll of the listPreclaims callable: every tick cost a function invocation and
 * a read of the entire queue, per staff tab, for a list that changes a handful
 * of times a minute. Same shape as subscribeToClaims, including the polling
 * fallback if the watch stream ever gives out mid-event.
 */
export const subscribeToPreclaims = ({ eventId, onPreclaims, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  // Scoped to the live event, so a close that failed part way cannot put last
  // event's leftovers in front of staff as if they were waiting in this one.
  const preclaimsQuery = eventId
    ? query(preclaimsCollectionRef, where("eventId", "==", eventId))
    : preclaimsCollectionRef;
  const toPreclaimList = (snapshot) =>
    snapshot.docs.map((preclaimDoc) => ({
      preclaimId: preclaimDoc.id,
      ...preclaimDoc.data(),
    }));

  return subscribeWithPollingFallback({
    onData: onPreclaims,
    onError,
    pollIntervalMs: 5000,
    readOnce: async () => toPreclaimList(await getDocs(preclaimsQuery)),
    watch: (next, fail) =>
      onSnapshot(preclaimsQuery, (snapshot) => next(toPreclaimList(snapshot)), fail),
  });
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

  return subscribeWithPollingFallback({
    onData: onPreclaim,
    onError,
    pollIntervalMs: 1200,
    readOnce: async () => {
      const snapshot = await getDoc(preclaimRef);
      return snapshot.exists() ? snapshot.data() : null;
    },
    watch: (next, fail) =>
      onSnapshot(preclaimRef, (snapshot) => next(snapshot.exists() ? snapshot.data() : null), fail),
  });
};

/**
 * Newest activity items. Each item is its own document now — the feed used to be
 * a single array document rewritten in a transaction on every claim, which
 * serialised the whole room's check-ins behind one contended write.
 */
export const subscribeToDisplayFeed = ({ eventId, onFeed, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  const displayFeedQuery = buildDisplayFeedQuery(eventId);
  const toFeedList = (snapshot) =>
    snapshot.docs.map((feedDoc) => ({ id: feedDoc.id, ...feedDoc.data() }));

  /* Slow, and deliberately the slowest fallback here: the feed is decoration on
     the projector. A frozen one costs nobody their number, so it is not worth
     five documents a second of a venue network to keep it current. */
  return subscribeWithPollingFallback({
    onData: onFeed,
    onError,
    pollIntervalMs: 10000,
    readOnce: async () => toFeedList(await getDocs(displayFeedQuery)),
    watch: (next, fail) => onSnapshot(displayFeedQuery, (snapshot) => next(toFeedList(snapshot)), fail),
  });
};

export const readClaimOnce = async ({ claimId }) => {
  if (!firebaseEnabled || !claimId) {
    return null;
  }

  const snapshot = await getDoc(getClaimRef(claimId));

  return snapshot.exists() ? snapshot.data() : null;
};

export const subscribeToClaims = ({ eventId, onClaims, onError }) => {
  if (!firebaseEnabled) {
    return () => {};
  }

  // Scoped to the live event. The unfiltered read also pulled in every claim
  // from every past event, which is unbounded over the life of the project.
  const claimsQuery = eventId
    ? query(claimsCollectionRef, where("eventId", "==", eventId))
    : claimsCollectionRef;
  const toClaimList = (snapshot) =>
    snapshot.docs.map((claimDoc) => ({ claimId: claimDoc.id, ...claimDoc.data() }));

  return subscribeWithPollingFallback({
    onData: onClaims,
    onError,
    /*
     * Slower than the single-document fallbacks above, because this one re-reads
     * the whole roster rather than one claim. At three hundred attendees a
     * 1,400ms tick was about 214 document reads a second, per staff tab, for as
     * long as the watch stream stayed down — and the thing it is polling for is
     * a roster that changes a few times a minute once the doors are open.
     *
     * Four seconds is still well inside "staff notice a check-in promptly", and
     * this is a degraded mode that POLLS_BEFORE_RETRYING_WATCH is actively
     * trying to climb out of.
     */
    pollIntervalMs: 4000,
    readOnce: async () => toClaimList(await getDocs(claimsQuery)),
    watch: (next, fail) => onSnapshot(claimsQuery, (snapshot) => next(toClaimList(snapshot)), fail),
  });
};

export const createLiveEvent = async ({
  claimAccessSecret,
  demo = null,
  eventEndAtMs,
  eventId,
  eventStartAtMs,
  isDemo = false,
  memberEarlyAccessAtMs,
  state,
  timeframeEnd,
  timeframeLabel,
  timeframeStart,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const batch = writeBatch(db);

  batch.set(liveStateRef, {
    active: true,
    claimCount: 0,
    eventEndAtMs: eventEndAtMs ?? null,
    eventId,
    eventStartAtMs: eventStartAtMs ?? null,
    memberEarlyAccessAtMs: memberEarlyAccessAtMs ?? null,
    nextClaimNumber: 1,
    /* Staff are numbered before #1, off their own counter — see
       src/staffNumbers.js. Held positive here and stored on the claim as its
       negative, so both counters read the same way. */
    nextStaffNumber: 1,
    state,
    startedAt: serverTimestamp(),
    stateVersion: 1,
    timeframeEnd,
    timeframeLabel,
    timeframeStart,
    updatedAt: serverTimestamp(),
    // Only written when the event is a demo, so a real event's document stays
    // exactly the shape it has always been.
    ...(isDemo ? { demo, isDemo: true } : {}),
  });
  batch.set(claimAccessRef, {
    secret: claimAccessSecret,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
};

const readStateVersion = (liveEventData) => {
  const version = Number(liveEventData?.stateVersion);
  return Number.isFinite(version) ? Math.trunc(version) : 0;
};

/**
 * Applies the staff-editable event details without disturbing the round in
 * progress.
 *
 * This used to read the document and write back a whole `state` object built
 * when the dialog was opened, so saving while auto-advance was running rolled
 * `current`, `last`, `round` and `finalCall` back to their old values. Now the
 * current state is read inside the transaction and only the form's own fields
 * are merged over it.
 */
export const updateLiveEventDetails = async ({
  eventEndAtMs,
  eventStartAtMs,
  memberEarlyAccessAtMs,
  stateChanges,
  timeframeEnd,
  timeframeLabel,
  timeframeStart,
}) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(liveStateRef);

    if (!snapshot.exists()) {
      throw new Error("No event is currently live.");
    }

    const liveEventData = snapshot.data() || {};

    transaction.update(liveStateRef, {
      eventEndAtMs: eventEndAtMs ?? null,
      eventStartAtMs: eventStartAtMs ?? null,
      memberEarlyAccessAtMs: memberEarlyAccessAtMs ?? null,
      state: { ...(liveEventData.state || {}), ...stateChanges },
      stateVersion: readStateVersion(liveEventData) + 1,
      timeframeEnd,
      timeframeLabel,
      timeframeStart,
      updatedAt: serverTimestamp(),
      claimAccessSecret: deleteField(),
    });

    // Migration for events started before the secret moved out of the public
    // document: carry it across so an in-flight event keeps accepting check-ins.
    if (typeof liveEventData.claimAccessSecret === "string" && liveEventData.claimAccessSecret) {
      transaction.set(claimAccessRef, {
        secret: liveEventData.claimAccessSecret,
        updatedAt: serverTimestamp(),
      });
    }
  });
};

/**
 * Writes the call state, merged over whatever is on the server now.
 *
 * `baseState` is the state the caller built its change on. Only the fields that
 * differ from it are written, over the state read inside the transaction — so
 * two control panels working at once no longer overwrite each other with their
 * own stale copies of the fields they never touched.
 *
 * This used to refuse the write outright when the event had moved on, because
 * without any guard two panels each computed "current + groupSize" from their
 * own copy and the later write swallowed the earlier one. Reducing the write to
 * its own fields solves that without refusing anything: both panels write the
 * same advanced group, and neither drags the other's settings backwards.
 *
 * `requireUnchangedFields` is for the few writes that must not merge — the ones
 * that only make sense happening once. If another panel has moved one of those
 * fields since `baseState` was read, this write is dropped and reports back
 * that it did not apply.
 */
export const pushLiveState = async (
  nextState,
  { baseState, requireUnchangedFields } = {},
) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(liveStateRef);

    if (!snapshot.exists()) {
      throw new Error("No event is currently live.");
    }

    const liveEventData = snapshot.data() || {};
    const currentState = normalizeState(liveEventData.state);

    if (!hasUnchangedStateFields(baseState, currentState, requireUnchangedFields)) {
      return { applied: false, state: currentState };
    }

    const mergedState = applyStateChanges(
      currentState,
      getStateChanges(baseState, nextState),
    );

    transaction.update(liveStateRef, {
      state: mergedState,
      /* Still counted up, even though nothing reads it to refuse a write any
         more: it is the cheapest way to tell from the document whether two
         panels are writing at all, and the rules already allow the field. */
      stateVersion: readStateVersion(liveEventData) + 1,
      updatedAt: serverTimestamp(),
      // Events started before the secret moved under /private still carry the old
      // field, and the rules reject any document that includes it. Clearing it here
      // means the first group advance repairs an in-flight event instead of
      // freezing it. Harmless once no such documents remain.
      claimAccessSecret: deleteField(),
    });

    return { applied: true, state: mergedState };
  });
};

export const closeLiveEvent = async ({ state }) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  const batch = writeBatch(db);

  batch.set(liveStateRef, {
    active: false,
    claimCount: 0,
    endedAt: serverTimestamp(),
    eventEndAtMs: null,
    eventId: null,
    eventStartAtMs: null,
    memberEarlyAccessAtMs: null,
    nextClaimNumber: 1,
    nextStaffNumber: 1,
    state,
    stateVersion: 0,
    timeframeEnd: "",
    timeframeLabel: "",
    timeframeStart: "",
    updatedAt: serverTimestamp(),
  });
  batch.set(claimAccessRef, {
    secret: "",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * Requests a number for the signed-in attendee.
 *
 * The number itself, the attendee's identity and their member status are all
 * decided by the server from the verified auth token; the only thing the client
 * gets a say in is the display name and avatar. `claimAccessCode` is the code
 * scanned from the display QR, and the callable rejects the request without a
 * currently-valid one.
 */
export const claimNumberAsAttendee = async ({
  avatarUrl,
  claimAccessCode,
  displayName,
  eventId,
}) => {
  if (!firebaseEnabled || !claimNumberAsAttendeeCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await claimNumberAsAttendeeCallable({
    avatarUrl,
    claimAccessCode,
    displayName,
    eventId,
  });

  return result.data;
};

/**
 * Adds the signed-in attendee to the pre-event queue. Same access check as
 * claiming a number; membership and early-access eligibility are resolved
 * server-side rather than taken from the request.
 */
export const joinQueueAsAttendee = async ({
  avatarUrl,
  claimAccessCode,
  displayName,
  eventId,
}) => {
  if (!firebaseEnabled || !joinQueueAsAttendeeCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await joinQueueAsAttendeeCallable({
    avatarUrl,
    claimAccessCode,
    displayName,
    eventId,
  });

  return result.data;
};

/**
 * Refreshes the caller's ID token once, and remembers that it did.
 *
 * A freshly promoted staff account is carrying a token minted before the staff
 * claim existed, so the first scan of an event needs a forced refresh or the
 * callable refuses it. That happens at most once per staff member per session —
 * but redeemClaimByQr used to force it on *every* scan, which put a network
 * round trip to Firebase Auth in front of every person waiting at the pickup
 * table, all evening.
 *
 * Keyed on the uid so signing in as somebody else refreshes again.
 */
let refreshedTokenForUid = "";

const ensureFreshStaffToken = async () => {
  const currentUser = auth?.currentUser;

  if (!currentUser || refreshedTokenForUid === currentUser.uid) {
    return;
  }

  try {
    await currentUser.getIdToken(true);
    refreshedTokenForUid = currentUser.uid;
  } catch {
    // Continue; the callable will surface a clear auth error if it is invalid.
  }
};

export const redeemClaimByQr = async ({ claimId, eventId, qrToken }) => {
  if (!firebaseEnabled || !redeemClaimByQrAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  await ensureFreshStaffToken();

  try {
    const result = await redeemClaimByQrAsStaffCallable({ claimId, eventId, qrToken });

    return result.data;
  } catch (error) {
    /* The one case the per-scan refresh was really covering: a token that no
       longer says what the callable needs. Force one and try again, so a
       promotion mid-event still lands without costing every other scan a round
       trip. */
    if (error?.code === "functions/permission-denied" && auth?.currentUser) {
      refreshedTokenForUid = "";
      await ensureFreshStaffToken();

      const result = await redeemClaimByQrAsStaffCallable({ claimId, eventId, qrToken });

      return result.data;
    }

    throw error;
  }
};

/** Puts the signed-in attendee into the raffle, when staff require opting in. */
export const joinRaffleAsAttendee = async ({ eventId }) => {
  if (!firebaseEnabled || !joinRaffleAsAttendeeCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await joinRaffleAsAttendeeCallable({ eventId });

  return result.data;
};

/**
 * Confirms a raffle prize for the attendee whose code was scanned.
 *
 * Records nothing. The callable checks that the code belongs to a winner of
 * this event and says who they are; the prize handover itself is not written
 * anywhere, so no raffle can move the item-claim counts or the graphs.
 */
export const redeemRaffleByQr = async ({ claimId, eventId, qrToken }) => {
  if (!firebaseEnabled || !redeemRaffleByQrAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await redeemRaffleByQrAsStaffCallable({ claimId, eventId, qrToken });

  return result.data;
};

/** Newest post on the club announcements page — usually the event's book list. */
export const readLatestAnnouncement = async () => {
  if (!firebaseEnabled || !fetchLatestAnnouncementCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await fetchLatestAnnouncementCallable({});

  return result.data;
};

/** Past events with their headline metrics, newest first. */
export const readArchivedEvents = async () => {
  if (!firebaseEnabled || !listArchivedEventsCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await listArchivedEventsCallable({});

  return result.data?.events ?? [];
};

/** Full attendee list for one past event. */
export const readArchivedEvent = async ({ eventId }) => {
  if (!firebaseEnabled || !readArchivedEventCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await readArchivedEventCallable({ eventId });

  return result.data;
};

/**
 * Pauses or resumes a demo, for everyone.
 *
 * Held on the event rather than in the control panel that pressed the button:
 * a second staff tab is a second demo driver, and a pause only that tab knew
 * about left the other one still joining people and taking items — which looks
 * exactly like the button not working.
 */
export const setDemoPausedAsStaff = async ({ paused }) => {
  if (!firebaseEnabled) {
    throw new Error("Firebase is not configured.");
  }

  await updateDoc(liveStateRef, {
    isDemoPaused: paused === true,
    updatedAt: serverTimestamp(),
  });
};

/** Creates a batch of fake attendees on a demo event. Idempotent per index. */
export const seedDemoParticipantsAsStaff = async ({ eventId, participants }) => {
  if (!firebaseEnabled || !seedDemoParticipantsAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await seedDemoParticipantsAsStaffCallable({ eventId, participants });

  return result.data;
};

/** Gives every queued demo participant a number, as the doors opening would. */
export const assignQueuedDemoParticipantsAsStaff = async ({ eventId }) => {
  if (!firebaseEnabled || !assignQueuedDemoParticipantsAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await assignQueuedDemoParticipantsAsStaffCallable({ eventId });

  return result.data;
};

/** Marks one fake attendee as having picked up an item this round. */
export const redeemDemoClaimAsStaff = async ({ claimId, eventId }) => {
  if (!firebaseEnabled || !redeemDemoClaimAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await redeemDemoClaimAsStaffCallable({ claimId, eventId });

  return result.data;
};

/**
 * Puts one fake attendee into the raffle.
 *
 * The attendee path works off the caller's own session, which a demo
 * participant does not have — so the driver stands in for their phone here the
 * same way it does for a pickup.
 */
export const joinRaffleAsDemoParticipantAsStaff = async ({ claimId, eventId }) => {
  if (!firebaseEnabled || !joinRaffleAsDemoParticipantAsStaffCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await joinRaffleAsDemoParticipantAsStaffCallable({ claimId, eventId });

  return result.data;
};

/** Permanently deletes one past event and its archived attendees. */
export const deleteArchivedEvent = async ({ eventId }) => {
  if (!firebaseEnabled || !deleteArchivedEventCallable) {
    throw new Error("Firebase functions not configured.");
  }

  const result = await deleteArchivedEventCallable({ eventId });

  return result.data;
};
