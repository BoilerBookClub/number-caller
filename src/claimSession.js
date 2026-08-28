/**
 * Everything this browser remembers about an attendee's claim access.
 *
 * The server is the authority — these values only decide which screen to show
 * and carry the scanned code across the Discord OAuth round trip.
 */
const CLAIM_ACCESS_GRANT_KEY = "number-caller-claim-access-grant";
const CONFIRMED_CLAIM_ACCESS_KEY = "number-caller-confirmed-claim-access";
const PERSISTED_CLAIM_SESSION_KEY = "number-caller-persisted-claim-session";

export const readClaimAccessGrant = () => {
  const rawGrant = window.sessionStorage.getItem(CLAIM_ACCESS_GRANT_KEY);

  if (!rawGrant) {
    return null;
  }

  try {
    return JSON.parse(rawGrant);
  } catch {
    window.sessionStorage.removeItem(CLAIM_ACCESS_GRANT_KEY);
    return null;
  }
};

export const writeClaimAccessGrant = (grant) => {
  window.sessionStorage.setItem(CLAIM_ACCESS_GRANT_KEY, JSON.stringify(grant));
};

// The scanned code has to survive the Discord OAuth round trip and any in-app
// navigation that strips the query string, because the server now requires it.
export const readStoredClaimAccessCode = (eventId) => {
  const storedGrant = readClaimAccessGrant();

  if (!storedGrant || storedGrant.eventId !== eventId) {
    return "";
  }

  return typeof storedGrant.code === "string" ? storedGrant.code : "";
};

export const clearClaimAccessGrant = () => {
  window.sessionStorage.removeItem(CLAIM_ACCESS_GRANT_KEY);
};

export const readConfirmedClaimAccess = () => {
  const rawConfirmedAccess = window.localStorage.getItem(CONFIRMED_CLAIM_ACCESS_KEY);

  if (!rawConfirmedAccess) {
    return null;
  }

  try {
    return JSON.parse(rawConfirmedAccess);
  } catch {
    window.localStorage.removeItem(CONFIRMED_CLAIM_ACCESS_KEY);
    return null;
  }
};

export const writeConfirmedClaimAccess = (confirmedAccess) => {
  window.localStorage.setItem(
    CONFIRMED_CLAIM_ACCESS_KEY,
    JSON.stringify(confirmedAccess),
  );
};

export const clearConfirmedClaimAccess = () => {
  window.localStorage.removeItem(CONFIRMED_CLAIM_ACCESS_KEY);
};

export const readPersistedClaimSession = () => {
  const rawPersistedClaimSession = window.localStorage.getItem(
    PERSISTED_CLAIM_SESSION_KEY,
  );

  if (!rawPersistedClaimSession) {
    return null;
  }

  try {
    const parsedPersistedClaimSession = JSON.parse(rawPersistedClaimSession);

    if (
      !parsedPersistedClaimSession ||
      typeof parsedPersistedClaimSession.claimId !== "string" ||
      typeof parsedPersistedClaimSession.eventId !== "string" ||
      typeof parsedPersistedClaimSession.userId !== "string"
    ) {
      throw new Error("Invalid persisted claim session.");
    }

    return parsedPersistedClaimSession;
  } catch {
    window.localStorage.removeItem(PERSISTED_CLAIM_SESSION_KEY);
    return null;
  }
};

export const writePersistedClaimSession = (claimSession) => {
  window.localStorage.setItem(
    PERSISTED_CLAIM_SESSION_KEY,
    JSON.stringify(claimSession),
  );
};

export const clearPersistedClaimSession = () => {
  window.localStorage.removeItem(PERSISTED_CLAIM_SESSION_KEY);
};

export const buildClaimRulesAcknowledgedKey = (eventId, claimId) =>
  `claimRulesAcknowledged:${eventId}:${claimId}`;

/* Staff-side, and the one key here that is not an attendee's. The back button
   asks before it rewinds the queue; this remembers that somebody ticked "don't
   ask again", per event, so the answer does not carry over to the next one. */
export const buildBacktrackConfirmSkippedKey = (eventId) =>
  `backtrackConfirmSkipped:${eventId}`;

export const readStoredBoolean = (key) => window.localStorage.getItem(key) === "true";

/* Which of the current-group/backlog lists staff last had open in the queue
   card. Per event, like the backtrack skip above, so the choice survives a
   refresh but doesn't carry over to the next event. */
export const buildQueuePanelOpenKey = (eventId, panel) =>
  `queuePanelOpen:${panel}:${eventId}`;

export const readStoredBooleanOrDefault = (key, defaultValue) => {
  const rawValue = window.localStorage.getItem(key);
  return rawValue === null ? defaultValue : rawValue === "true";
};

export const getClaimAccessCodeFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("claim")?.trim() ?? "";
};

export const buildClaimAccessUrl = (accessCode) => {
  const url = new URL(window.location.href);

  url.pathname = "/";
  url.searchParams.delete("mode");

  if (accessCode) {
    url.searchParams.set("claim", accessCode);
  } else {
    url.searchParams.delete("claim");
  }

  return url.toString();
};

/*
 * Per-event keys, swept when the event they belong to is over.
 *
 * Five families of key are written per event and per device — the walkthrough's
 * two, the claim-rules acknowledgement, the backtrack "don't ask again", and
 * which halves of the queue card were open. Every one of them is scoped by
 * event id on purpose, so that the next event asks again, and none of them was
 * ever removed. Four or five keys per event, forever, on a staff phone that
 * works every event and on an attendee's phone that comes back each month.
 *
 * Nothing here is load-bearing enough to be worth a migration: these are all
 * "has this person seen this yet" flags, and the correct answer for an event
 * that is no longer live is to forget them.
 *
 * Keyed on the event that is live *now*. Anything carrying a different event id
 * belongs to an event that has closed, and anything carrying none is from
 * before these were scoped at all.
 */
const PER_EVENT_KEY_PREFIXES = [
  "staffCreatedEvent:",
  "staffWalkthroughSeen:",
  "claimRulesAcknowledged:",
  "backtrackConfirmSkipped:",
  "queuePanelOpen:",
];

export const clearPerEventKeysExcept = (liveEventId) => {
  const keptEventId = typeof liveEventId === "string" ? liveEventId : "";

  try {
    const staleKeys = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (!key || !PER_EVENT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        continue;
      }

      /* The event id is the last colon-separated segment in every one of these
         — `staffWalkthroughSeen:{role}:{eventId}`,
         `claimRulesAcknowledged:{eventId}:{claimId}` being the exception, which
         is why this tests for the id anywhere in the key rather than parsing a
         position that is not the same in all five. */
      if (keptEventId && key.includes(keptEventId)) {
        continue;
      }

      staleKeys.push(key);
    }

    staleKeys.forEach((key) => window.localStorage.removeItem(key));

    return staleKeys.length;
  } catch {
    /* A browser with storage disabled or full. Housekeeping is not worth
       interrupting a check-in over. */
    return 0;
  }
};
