/* eslint-env node */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { sanitizeAvatarUrl } from "./avatarUrl.js";
import { containsProfanity } from "./displayNameFilter.js";

initializeApp();

// A cap on how far an abusive or runaway caller can scale this out. Nothing here
// needs to serve a crowd larger than one event's worth of attendees, and the
// callables are reachable without App Check.
//
// This is the default for the scrapers, the schedulers and the staff callables,
// none of which are ever hit by more than a handful of people at once.
setGlobalOptions({ maxInstances: 10 });

/**
 * The ceiling for the three callables a whole room reaches at the same moment.
 *
 * Ten instances is the right cap for a callable a couple of staff press, and the
 * wrong one for the door: three hundred people checking in inside a minute
 * saturate it and start getting `resource-exhausted` back, which the attendee
 * page then retries. Raised here rather than globally so an abusive caller still
 * cannot scale out the announcement scraper or the archive reader.
 */
const ATTENDEE_CALLABLE_MAX_INSTANCES = 60;

/**
 * How many attendees can actually be served at once, which is not the number
 * above on its own.
 *
 * A 2nd-gen function left at the default 256 MiB is allocated less than a whole
 * vCPU, and Cloud Run refuses to run more than one request per instance below
 * one CPU. So sixty instances meant sixty *concurrent* check-ins, not sixty a
 * second — and sixty cold starts all landing on the first people through the
 * door. Asking for a full CPU is what makes `concurrency` mean anything.
 *
 * Twenty rather than the platform default of eighty: these handlers spend
 * almost all of their time waiting on Firestore rather than on CPU, but they do
 * contend on one document, and letting a single instance pile eighty
 * transactions onto it trades one queue for another.
 */
const ATTENDEE_CALLABLE_CONCURRENCY = 20;

/**
 * Instances kept warm.
 *
 * Zero by default, because this bills whether or not an event is running. Set
 * ATTENDEE_MIN_INSTANCES=2 in functions/.env for the day of an event so the
 * first arrivals do not each pay for a container start, and put it back to 0
 * afterwards.
 */
const ATTENDEE_CALLABLE_MIN_INSTANCES = (() => {
  const parsedValue = Number.parseInt(process.env.ATTENDEE_MIN_INSTANCES ?? "", 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
})();

/**
 * App Check enforcement, staged.
 *
 * Flipping this on before the client is actually sending attestation tokens
 * would reject every callable and take the event down, so it is a deliberate
 * second step: ship VITE_FIREBASE_APPCHECK_SITE_KEY, confirm verified requests
 * in the Firebase console, then set ENFORCE_APP_CHECK=true in functions/.env.
 */
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";

/**
 * Shared by the three callables the whole room reaches at once.
 *
 * Below ENFORCE_APP_CHECK rather than beside the constants it is built from,
 * because it reads that flag and the flag is declared here.
 */
const attendeeCallableOptions = () => ({
  concurrency: ATTENDEE_CALLABLE_CONCURRENCY,
  cpu: 1,
  enforceAppCheck: ENFORCE_APP_CHECK,
  maxInstances: ATTENDEE_CALLABLE_MAX_INSTANCES,
  memory: "512MiB",
  minInstances: ATTENDEE_CALLABLE_MIN_INSTANCES,
});

const db = getFirestore();

/**
 * The claim-write trigger's own options.
 *
 * It inherits setGlobalOptions otherwise, and that ceiling is sized for the
 * scrapers and the staff callables rather than for something that fires once per
 * check-in and once per pickup. Two things bite at three hundred attendees:
 * ten instances is a small pool for a burst that size, and a 2nd-gen function
 * left at the default 256 MiB is allocated less than a whole vCPU, which makes
 * Cloud Run refuse more than one request per instance — so `concurrency` is
 * silently 1 and the pool is ten invocations, full stop. The activity feed then
 * runs minutes behind the room it is describing.
 *
 * Same reasoning, and the same numbers, as attendeeCallableOptions above.
 */
const claimTriggerOptions = () => ({
  concurrency: ATTENDEE_CALLABLE_CONCURRENCY,
  cpu: 1,
  maxInstances: 20,
  memory: "512MiB",
});


// Overridable so a second guild does not need a code change and a redeploy.
// The defaults are the Boiler Book Club guild this was built for.
const TARGET_GUILD_ID = process.env.DISCORD_GUILD_ID || "835995185817059439";
// The OAuth application tokens must belong to. Public by design — it is in the
// authorize URL the client builds — and defaulted here so the audience check
// below cannot be silently disabled by forgetting a config value.
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1329229896798441623";
const REQUIRED_ROLE_ID = process.env.DISCORD_MEMBER_ROLE_ID || "937848500287336478";
const SPECIAL_ROLE_IDS = (process.env.DISCORD_STAFF_ROLE_IDS || "835995868007104543")
  .split(",")
  .map((roleId) => roleId.trim())
  .filter(Boolean);

/**
 * Discord user IDs that get staff access regardless of guild roles.
 *
 * Bootstrap for a genuine chicken-and-egg problem: running an event needs staff
 * access, but staff access comes from a Discord role somebody else has to grant
 * you first. These are user IDs (snowflakes), not usernames — holding one still
 * requires authenticating as that Discord account, so this is no weaker than the
 * role check it stands in for.
 *
 * This used to carry a hardcoded user ID as its default, because functions/.env
 * is gitignored and would therefore be absent from a CI deploy — silently
 * revoking access. The deploy workflow now writes functions/.env from repo
 * configuration, so the bootstrap account can live there instead of shipping
 * inside the deployed artifact, where a fork or a second deployment would have
 * granted it staff on someone else's instance.
 *
 * Set DISCORD_STAFF_USER_IDS (comma-separated) to re-enable it.
 */
const STAFF_USER_IDS = (process.env.DISCORD_STAFF_USER_IDS ?? "")
  .split(",")
  .map((userId) => userId.trim())
  .filter(Boolean);
/**
 * The Discord bot token, held in Secret Manager.
 *
 * Declaring it here is what makes Firebase mount it on the functions that list
 * it in `secrets`. The value is only readable at call time — reading it at
 * module load, as this used to, yields an empty string and silently degrades
 * every membership lookup to cached token claims.
 *
 * Set it once with:  npx firebase-tools functions:secrets:set DISCORD_BOT_TOKEN
 */
const discordBotTokenSecret = defineSecret("DISCORD_BOT_TOKEN");

/**
 * The OAuth client secret, held in Secret Manager.
 *
 * Needed because login is an authorization-code exchange now: the browser never
 * receives a Discord token, it receives a single-use code that only this
 * function — holding the secret — can turn into one.
 *
 * Set it once with:  npx firebase-tools functions:secrets:set DISCORD_CLIENT_SECRET
 */
const discordClientSecretSecret = defineSecret("DISCORD_CLIENT_SECRET");

const getDiscordClientSecret = () => process.env.DISCORD_CLIENT_SECRET || "";

/**
 * Redirect URIs the code exchange will accept.
 *
 * Optional, and empty by default. Discord independently rejects any redirect_uri
 * that is not registered on the application, and the code is cryptographically
 * bound to the one used at authorize time — so this is a second fence rather
 * than the only one. It is left permissive by default precisely so a custom
 * domain does not silently break every login on deploy.
 */
const DISCORD_ALLOWED_REDIRECT_URIS = (process.env.DISCORD_REDIRECT_URIS || "")
  .split(",")
  .map((uri) => uri.trim())
  .filter(Boolean);

const getDiscordBotToken = () =>
  process.env.DISCORD_BOT_TOKEN || process.env.BBC_DISCORD_BOT_TOKEN || "";
// How many activity items survive a trim. Ten times what the display reads, so
// the margin absorbs a burst of check-ins between trim runs.
const DISPLAY_FEED_RETENTION = 50;
const LIVE_EVENT_PATH = "events/live-number-caller";
const DISPLAY_FEED_PATH = "events/live-number-caller/feed";
const CLAIM_ACCESS_PATH = "events/live-number-caller/private/claim-access";
const CLAIM_ACCESS_ROTATION_MS = 60_000;
/*
 * How many one-minute rotations of the display code are still accepted.
 *
 * The display rotates its QR every minute, but a walk-up has to complete a
 * whole Discord OAuth round trip between scanning it and reaching us — and for
 * a first-time attendee that means installing or opening Discord, signing in,
 * possibly clearing 2FA, and authorising the app, on a venue network three
 * hundred phones are already saturating.
 *
 * This was 3, giving them roughly two minutes. Anyone slower than that got
 * `permission-denied` back, which the attendee page reads as an expired scan —
 * so it cleared their grant and put them in front of the "scan the code on the
 * display again" wall, at the one moment they are furthest from the projector
 * and least likely to work out what went wrong.
 *
 * Six buckets is about five minutes of acceptance. The code is still bound to
 * one event and one rotating secret, and it still expires on its own; widening
 * the window does not make it forgeable, it only stops the gate closing on
 * people who are already through it.
 *
 * The queued path never had this problem — it is exempted from the code check
 * entirely, because a queue entry is itself proof that they scanned.
 */
const CLAIM_ACCESS_ACCEPTED_BUCKETS = 6;
const MEMBER_ELIGIBLE_AT_MAX_AHEAD_MS = 24 * 60 * 60 * 1000;
// How long cached role claims may stand in for a failed Discord lookup.
const CLAIM_REUSE_MAX_AGE_MS = 30 * 60 * 1000;

// Must stay byte-for-byte equivalent to hashClaimAccessValue in src/claimAccess.js.
// JavaScript bitwise operators are 32-bit everywhere, so this agrees across runtimes.
const hashClaimAccessValue = (value) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 8);
};

const buildClaimAccessCode = (secret, timestamp) => {
  if (!secret) {
    return "";
  }

  const bucket = Math.floor(timestamp / CLAIM_ACCESS_ROTATION_MS);

  return hashClaimAccessValue(`${secret}:${bucket}`);
};

const isValidClaimAccessCode = (
  secret,
  candidateCode,
  nowMs = Date.now(),
  acceptedBuckets = CLAIM_ACCESS_ACCEPTED_BUCKETS,
) => {
  if (!secret || typeof candidateCode !== "string" || !candidateCode) {
    return false;
  }

  for (let offset = 0; offset < acceptedBuckets; offset += 1) {
    const candidateTimestamp = nowMs - offset * CLAIM_ACCESS_ROTATION_MS;

    if (buildClaimAccessCode(secret, candidateTimestamp) === candidateCode) {
      return true;
    }
  }

  return false;
};

const readClaimAccessSecret = async () => {
  const snapshot = await db.doc(CLAIM_ACCESS_PATH).get();
  const secret = snapshot.exists ? snapshot.data()?.secret : null;

  return typeof secret === "string" && secret ? secret : null;
};

/**
 * The only gate between "someone has a Discord account" and "someone is checked
 * in to this event". Staff bypass the code because they are already trusted and
 * are not standing in front of the display.
 */
const assertClaimAccess = async ({
  acceptedBuckets = CLAIM_ACCESS_ACCEPTED_BUCKETS,
  allowWithoutCode,
  claimAccessCode,
  eventId,
}) => {
  const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
  const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

  if (!liveEvent?.active) {
    throw new HttpsError("failed-precondition", "No event is currently live.");
  }

  if (!liveEvent.eventId || liveEvent.eventId !== eventId) {
    throw new HttpsError("failed-precondition", "This event is no longer accepting check-ins.");
  }

  if (allowWithoutCode) {
    return liveEvent;
  }

  const secret = await readClaimAccessSecret();

  if (!secret || !isValidClaimAccessCode(secret, claimAccessCode, Date.now(), acceptedBuckets)) {
    throw new HttpsError(
      "permission-denied",
      "Scan the QR code on the event display to check in.",
    );
  }

  return liveEvent;
};

/**
 * The name that goes on the projector, for any check-in path.
 *
 * The display name is taken from the request body — a Discord username is not
 * verified either — so the profanity screen has to sit here, or it is one
 * direct callable request away from being skipped entirely.
 *
 * A refused name falls back rather than throwing: rejecting outright would stop
 * an attendee getting a number at all over a nickname they set on Discord years
 * ago.
 */
const sanitizeDisplayName = (value, fallbackValue) => {
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  const resolvedValue = (trimmedValue || String(fallbackValue || "Guest")).slice(0, 120);

  if (containsProfanity(resolvedValue)) {
    console.warn("Replaced a display name the profanity filter refused.");
    return "Guest";
  }

  return resolvedValue;
};

const buildDiscordAvatarUrl = (userData) =>
  userData.avatar
    ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${Number(userData.discriminator ?? 0) % 5}.png`;

const fetchDiscordJson = async ({ accessToken, path, errorMessage }) => {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const respText = await response.text().catch(() => "");

  if (!response.ok) {
    // Status only. The response body can echo request context, and these logs are
    // retained in Cloud Logging where they are far more widely readable than the
    // request itself.
    console.error("Discord API error", {
      path,
      status: response.status,
      statusText: response.statusText,
    });

    throw new HttpsError(
      "unauthenticated",
      `${errorMessage} (status ${response.status})`,
      {
        path,
        status: response.status,
      },
    );
  }

  try {
    return JSON.parse(respText);
  } catch (err) {
    console.error("Discord API returned non-JSON response", {
      path,
      bodyLength: respText.length,
      error: err && (err.message || err),
    });
    throw new HttpsError("unauthenticated", errorMessage);
  }
};

/**
 * Turns a single-use authorization code into a Discord access token.
 *
 * The browser used to obtain the access token itself, through the implicit
 * grant, and hand it here — which meant a real Discord token sat in every
 * attendee's localStorage for 24 hours, one XSS away from being stolen and
 * replayed. With the authorization-code flow the browser only ever holds a
 * code that is useless without this function's client secret, and the token
 * below never leaves this process.
 *
 * The PKCE verifier is what stops a code intercepted at the redirect from being
 * redeemed by anyone else: it only works alongside the random verifier the
 * browser generated and never transmitted until now.
 */
const exchangeDiscordCodeForAccessToken = async ({ code, codeVerifier, redirectUri }) => {
  const clientSecret = getDiscordClientSecret();

  if (!clientSecret) {
    console.error(
      "DISCORD_CLIENT_SECRET is not available; the login code exchange cannot run. " +
        "Set it with: npx firebase-tools functions:secrets:set DISCORD_CLIENT_SECRET",
    );
    throw new HttpsError("failed-precondition", "Discord login is not configured.");
  }

  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const responseText = await response.text().catch(() => "");

  if (!response.ok) {
    // Status only: the body of a failed token exchange echoes request context.
    console.error("Discord token exchange failed", {
      status: response.status,
      statusText: response.statusText,
    });

    throw new HttpsError("unauthenticated", "Discord login failed. Please try again.");
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new HttpsError("unauthenticated", "Discord login failed. Please try again.");
  }

  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new HttpsError("unauthenticated", "Discord login failed. Please try again.");
  }

  return payload.access_token;
};

const assertAllowedRedirectUri = (redirectUri) => {
  let parsed;

  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new HttpsError("invalid-argument", "A valid redirect URI is required.");
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new HttpsError("invalid-argument", "The redirect URI must use https.");
  }

  if (
    DISCORD_ALLOWED_REDIRECT_URIS.length
    && !DISCORD_ALLOWED_REDIRECT_URIS.includes(redirectUri)
  ) {
    console.error("Rejected a redirect URI that is not on the allowlist.", { redirectUri });
    throw new HttpsError("permission-denied", "That redirect URI is not allowed.");
  }
};

const getHttpStatusFromError = (error) => {
  const statusFromDetails = error?.details?.status;
  if (typeof statusFromDetails === "number") {
    return statusFromDetails;
  }

  const statusMatch = String(error?.message || "").match(/status\s+(\d{3})/i);
  if (statusMatch) {
    const parsedStatus = Number.parseInt(statusMatch[1], 10);
    if (Number.isFinite(parsedStatus)) {
      return parsedStatus;
    }
  }

  return null;
};

const MEMBERSHIP_REFRESH_CONCURRENCY = 8;
// Firestore rejects any commit over 500 operations. Membership refresh writes
// one per queue entry, so a single batch worked right up until the queue grew
// past that mark and then failed for the whole event at once.
const MEMBERSHIP_REFRESH_BATCH_SIZE = 200;

/** Runs `mapper` over `items` with at most `limit` in flight, preserving order. */
const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
};

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const fetchDiscordJsonWithRetry = async ({
  accessToken,
  path,
  errorMessage,
  retries = 2,
}) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchDiscordJson({ accessToken, path, errorMessage });
    } catch (error) {
      const status = getHttpStatusFromError(error);
      const shouldRetry =
        attempt < retries && (status === 429 || (status >= 500 && status < 600));

      if (!shouldRetry) {
        throw error;
      }

      await sleep(250 * (attempt + 1));
    }
  }

  throw new HttpsError("unavailable", errorMessage);
};

const getTimestampMs = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value?.toMillis === "function") {
    const timestampMs = value.toMillis();
    return Number.isFinite(timestampMs) ? timestampMs : null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsedValue = Date.parse(value);
  return Number.isNaN(parsedValue) ? null : parsedValue;
};

const setDateToClockTime = (date, clockTime) => {
  if (!clockTime || typeof clockTime !== "string") {
    return null;
  }

  const [hoursText, minutesText] = clockTime.split(":");
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  const nextDate = new Date(date);
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
};

const toFiniteMs = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? Math.trunc(parsedValue) : null;
};


const normalizeMemberCheckInLeadMinutes = (value) => {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 15;
  }

  return parsedValue;
};

// --- legacy fallbacks, UTC-relative; only reached for pre-migration events ---

const resolveLegacyEventWindow = (liveEvent, nowMs) => {
  const referenceTimestamp = getTimestampMs(liveEvent.startedAt) ?? nowMs;
  const referenceDate = new Date(referenceTimestamp);
  const eventStartDate = setDateToClockTime(referenceDate, liveEvent.timeframeStart);
  const eventEndDate = setDateToClockTime(referenceDate, liveEvent.timeframeEnd);

  if (!eventStartDate) {
    return { eventEndDate: null, eventStartDate: null, referenceTimestamp };
  }

  if (eventEndDate && eventEndDate <= eventStartDate) {
    eventEndDate.setDate(eventEndDate.getDate() + 1);
  }

  if (eventEndDate && referenceTimestamp > eventEndDate.getTime()) {
    eventStartDate.setDate(eventStartDate.getDate() + 1);
    eventEndDate.setDate(eventEndDate.getDate() + 1);
  }

  return { eventEndDate, eventStartDate, referenceTimestamp };
};

const isLiveEventStartedFromClockTimes = (liveEvent, nowMs) => {
  const { eventStartDate } = resolveLegacyEventWindow(liveEvent, nowMs);

  if (!eventStartDate) {
    return true;
  }

  return nowMs >= eventStartDate.getTime();
};

const getMemberEligibleAtFromClockTimes = (liveEvent, nowMs) => {
  const { eventStartDate } = resolveLegacyEventWindow(liveEvent, nowMs);

  if (!eventStartDate) {
    return null;
  }

  const memberLeadMinutes = normalizeMemberCheckInLeadMinutes(
    liveEvent.state?.memberCheckInLeadMinutes,
  );

  return eventStartDate.getTime() - memberLeadMinutes * 60 * 1000;
};

/**
 * Event schedules are entered as wall-clock strings ("19:00") in the venue's
 * timezone. Cloud Functions run with TZ=UTC and have no idea what that timezone
 * is, so resolving those strings here produced an instant hours away from the
 * real one — and on the wrong calendar day for evening events.
 *
 * The staff browser now resolves the schedule where it is unambiguous and stores
 * the result as absolute epoch milliseconds. These helpers read those values and
 * only fall back to the old clock-time math for events created before that
 * change, where being approximately right beats refusing to answer.
 */
const isLiveEventStarted = (liveEvent, nowMs = Date.now()) => {
  if (!liveEvent?.active) {
    return false;
  }

  const eventStartAtMs = toFiniteMs(liveEvent.eventStartAtMs);
  if (eventStartAtMs !== null) {
    return nowMs >= eventStartAtMs;
  }

  return isLiveEventStartedFromClockTimes(liveEvent, nowMs);
};

const getMemberEligibleAtForLiveEvent = (liveEvent, nowMs = Date.now()) => {
  if (!liveEvent) {
    return null;
  }

  const memberEarlyAccessAtMs = toFiniteMs(liveEvent.memberEarlyAccessAtMs);
  if (memberEarlyAccessAtMs !== null) {
    return memberEarlyAccessAtMs;
  }

  const eventStartAtMs = toFiniteMs(liveEvent.eventStartAtMs);
  if (eventStartAtMs !== null) {
    return eventStartAtMs - normalizeMemberCheckInLeadMinutes(
      liveEvent.state?.memberCheckInLeadMinutes,
    ) * 60 * 1000;
  }

  return getMemberEligibleAtFromClockTimes(liveEvent, nowMs);
};

const fetchDiscordGuildMemberRolesByBot = async ({
  discordUserId,
  retries = 2,
}) => {
  const discordBotToken = getDiscordBotToken();

  if (!discordBotToken) {
    console.warn(
      "DISCORD_BOT_TOKEN is not available; falling back to cached Firebase token claims. " +
        "Set it with: firebase functions:secrets:set DISCORD_BOT_TOKEN",
    );
    return null;
  }

  if (!discordUserId) {
    return null;
  }

  const path = `/guilds/${TARGET_GUILD_ID}/members/${discordUserId}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      headers: {
        authorization: `Bot ${discordBotToken}`,
      },
    });
    const responseBody = await response.text().catch(() => "");

    if (response.status === 404) {
      return [];
    }

    if (response.ok) {
      try {
        const payload = JSON.parse(responseBody);
        return Array.isArray(payload.roles) ? payload.roles : [];
      } catch {
        return [];
      }
    }

    const shouldRetry =
      attempt < retries && (response.status === 429 || (response.status >= 500 && response.status < 600));

    if (shouldRetry) {
      await sleep(250 * (attempt + 1));
      continue;
    }

    console.warn("Bot guild membership lookup failed", {
      path,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }

  return null;
};

const resolveMembershipStatusForDiscordUser = async ({
  currentIsMember,
  discordUserId,
}) => {
  if (!discordUserId) {
    return {
      isMember: Boolean(currentIsMember),
      source: "preclaim",
    };
  }

  const botRoles = await fetchDiscordGuildMemberRolesByBot({ discordUserId });
  if (Array.isArray(botRoles)) {
    return {
      isMember: botRoles.includes(REQUIRED_ROLE_ID),
      source: "bot",
    };
  }

  const authUserRecord = await getAuth().getUser(discordUserId).catch(() => null);
  if (authUserRecord) {
    return {
      isMember: authUserRecord.customClaims?.member === true,
      source: "custom-claims",
    };
  }

  return {
    isMember: Boolean(currentIsMember),
    source: "preclaim",
  };
};

/**
 * Builds one activity item under a caller-supplied, deterministic id.
 *
 * The id used to be a fresh crypto.randomUUID(). Firestore triggers are
 * at-least-once, so a retried invocation minted a *different* id and the
 * display announced the same thing twice. Deriving the id from what happened —
 * this claim, this round — means a retry overwrites its own row instead.
 */
const buildDisplayFeedItem = ({ action, avatarUrl, eventId, id, isMember, username }) => ({
  action,
  avatarUrl: avatarUrl || "",
  /* Stamped so the display can ask for this event's activity rather than for
     the newest activity there is. The feed is cleared when an event closes and
     when the event id changes, so in the ordinary case those are the same
     query — but a close that fails part way is exactly the case where they are
     not, and the failure mode is last event's attendees scrolling past on the
     projector during this one. */
  eventId: eventId || null,
  id,
  isMember: isMember === true,
  timestampMs: Date.now(),
  username: username || "Unknown attendee",
});

/**
 * Moves an event's attendees into `eventArchives/{eventId}` when it ends.
 *
 * Nothing used to clear these collections, so claims from every past event
 * accumulated in `claims/` forever — and the control panel re-read all of them,
 * from every event, on each roster poll. Archiving rather than deleting keeps
 * the attendance history available without leaving it in the live path.
 * `eventArchives` is not covered by any security rule, so it is unreachable
 * from clients and readable only through the Admin SDK.
 */
/**
 * Documents per archive page.
 *
 * Deliberately below 250, not 500: archiving writes *two* operations per
 * document (the copy into `eventArchives` and the delete from the live path),
 * and Firestore rejects any commit carrying more than 500. At the old page size
 * of 300 that was 600 writes, so closing an event with more than 250 attendees
 * failed outright — and because the commit throws before the deletes land, the
 * live collections were never cleared and the next event started polluted.
 */
const ARCHIVE_PAGE_SIZE = 200;

const archiveAndClearCollection = async ({ archivePath = null, sourcePath }) => {
  const pageSize = ARCHIVE_PAGE_SIZE;
  let processedCount = 0;

  for (;;) {
    const page = await db.collection(sourcePath).limit(pageSize).get();

    if (page.empty) {
      return processedCount;
    }

    const batch = db.batch();

    page.docs.forEach((docSnapshot) => {
      if (archivePath) {
        batch.set(db.doc(`${archivePath}/${docSnapshot.id}`), docSnapshot.data());
      }
      batch.delete(docSnapshot.ref);
    });

    await batch.commit();
    processedCount += page.size;

    if (page.size < pageSize) {
      return processedCount;
    }
  }
};

const deleteCollection = async (sourcePath) => archiveAndClearCollection({ sourcePath });

/**
 * Appends one activity item.
 *
 * This used to rewrite a single document inside a transaction on every claim
 * write. When a group of attendees checked in together those transactions all
 * contended on that one document and retried against each other — a textbook
 * Firestore hot spot, at exactly the busiest moment of the event. Independent
 * documents have no contention; the display reads back the newest few.
 */
const pushDisplayFeedItem = async (item) => {
  await db.doc(`${DISPLAY_FEED_PATH}/${item.id}`).set(item);
};

const clearDisplayFeed = async () => {
  await deleteCollection(DISPLAY_FEED_PATH);
};

/**
 * Drops all but the newest few activity items.
 *
 * The feed gains a document per queue join and per item pickup but is only ever
 * read back five at a time, and nothing removed them until the event closed —
 * so a 300-person event sat on roughly a thousand documents that no one would
 * ever look at. Kept well above the display's limit so there is always a margin
 * for items arriving between runs.
 */
const trimDisplayFeed = async () => {
  /*
   * Ask how many there are before reading any of them.
   *
   * This ran every five minutes for the whole of an event and found nothing to
   * do on most of them, and it still paid for the looking: .offset(50) bills
   * fifty reads for the documents it skips, and a limit(50) cursor query would
   * bill the same fifty. A count aggregation is billed per thousand index
   * entries matched, so the quiet case — which is nearly every case — is one
   * read instead of fifty.
   */
  const feedCount = await db.collection(DISPLAY_FEED_PATH).count().get();

  if ((feedCount.data().count ?? 0) <= DISPLAY_FEED_RETENTION) {
    return 0;
  }

  /*
   * Only now, and with a cursor rather than an offset: same billing as the
   * offset on this path, but it is reached only when there is actually
   * something to delete.
   *
   * select() with no fields asks for keys alone, which is all the delete needs.
   */
  const boundary = await db
    .collection(DISPLAY_FEED_PATH)
    .orderBy("timestampMs", "desc")
    .limit(DISPLAY_FEED_RETENTION)
    .select()
    .get();

  // Fewer items than the retention limit: nothing is stale yet.
  if (boundary.size < DISPLAY_FEED_RETENTION) {
    return 0;
  }

  const stale = await db
    .collection(DISPLAY_FEED_PATH)
    .orderBy("timestampMs", "desc")
    .startAfter(boundary.docs[boundary.size - 1])
    .limit(ARCHIVE_PAGE_SIZE)
    .select()
    .get();

  if (stale.empty) {
    return 0;
  }

  const batch = db.batch();
  stale.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
  await batch.commit();

  return stale.size;
};

/**
 * Rejects an id that would change the shape of the path it is interpolated into.
 *
 * Every caller-supplied id in this file lands in a `db.doc()` template string.
 * Firestore paths have no "..", so a slash cannot escape the collection root,
 * but it can still redirect a read — or a delete — at a sibling subcollection,
 * and an id producing an odd segment count throws an opaque INTERNAL error
 * rather than a clean invalid-argument. All of these callables are staff-gated,
 * so this is hardening rather than a fix for a live exposure.
 */
const isValidDocumentId = (value) =>
  typeof value === "string"
    && value.length > 0
    && value.length <= 1500
    && !value.includes("/")
    && value !== "."
    && value !== "..";

const toPositiveInteger = (value) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const toNonNegativeInteger = (value) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
};

/**
 * A claim number, which is positive for an attendee and negative for staff.
 *
 * Everywhere a number is read back off a claim uses this rather than
 * toPositiveInteger, which would silently turn a staff number into 0 and hand
 * every staff member the same identity.
 */
const toClaimNumber = (value) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue !== 0 ? parsedValue : null;
};

/** Whether a claim number is a staff number rather than a place in the queue. */
const isStaffClaimNumber = (value) => {
  const parsedValue = toClaimNumber(value);
  return parsedValue !== null && parsedValue < 0;
};

/**
 * The next number for a claim, and the counter bumps that go with it.
 *
 * Staff are numbered before #1 — see src/staffNumbers.js for why they are held
 * as negatives — off their own counter, so handing a staff member a number
 * never moves the attendee queue along. They are also left out of `claimCount`,
 * which is the attendance figure the metrics and the archived events are built
 * from: staff running the event are not attendance.
 */
const allocateClaimNumber = ({ isStaff, liveEvent }) => {
  if (isStaff === true) {
    const nextStaffNumber = toPositiveInteger(liveEvent?.nextStaffNumber) ?? 1;

    return {
      counterUpdates: { nextStaffNumber: nextStaffNumber + 1 },
      number: -nextStaffNumber,
    };
  }

  const nextClaimNumber = toPositiveInteger(liveEvent?.nextClaimNumber) ?? 1;

  return {
    counterUpdates: {
      claimCount: (toNonNegativeInteger(liveEvent?.claimCount) ?? 0) + 1,
      nextClaimNumber: nextClaimNumber + 1,
    },
    number: nextClaimNumber,
  };
};

/**
 * Claim numbers come from a single monotonic counter on the event document.
 *
 * Every assignment path used to scan the whole claims collection for the lowest
 * unused number while the attendee path used the counter, so the two disagreed
 * after any removal. A counter is also cheaper (no full-collection read per
 * assignment) and safer during a live event: a recycled number could belong to
 * a group that has already been called.
 */

const writeClaimFromPreclaim = ({
  tx,
  claimRef,
  eventId,
  number,
  preclaimData,
}) => {
  const joinedAtValue = preclaimData.createdAt ?? Date.now();

  tx.set(claimRef, {
    avatarUrl: preclaimData.avatarUrl || "",
    claimedAt: Date.now(),
    joinedAt: joinedAtValue,
    discordUserId: preclaimData.discordUserId ?? null,
    displayName: preclaimData.displayName || "",
    eventId: eventId || null,
    isMember: preclaimData.isMember ?? false,
    // Recorded from the queue entry, which took it from the caller's verified
    // token — never from the request body, same as membership.
    isStaff: preclaimData.isStaff === true,
    itemClaimedAtMsHistory: [],
    itemsClaimedCount: 0,
    number,
    participantType: preclaimData.participantType || "",
    qrToken: crypto.randomUUID(),
    redeemedRound: 0,
    updatedAt: Date.now(),
  });
};

/**
 * The participant key a claim and a queue entry are filed under.
 *
 * The `discord:` prefix is a namespace, not a fact worth deriving — Discord is
 * the only login there is. It stays because it is already baked into every
 * claim document id ever written, and because src/App.jsx builds the same
 * string on its side; the two have to agree byte for byte.
 */
const buildParticipantKey = (request) => `discord:${request.auth?.uid}`;

const buildAttendeeClaimId = (eventId, request) =>
  `${eventId}__${encodeURIComponent(buildParticipantKey(request))}`;

/**
 * Fake logins for the emulator, keyed by the "access token" the client sends.
 * Guarded by FUNCTIONS_EMULATOR at the only call site.
 */
const DEV_LOGIN_PROFILES = {
  "dev:staff": {
    avatarUrl: "",
    hasFullAccess: true,
    isMember: true,
    user: "100000000000000001",
    username: "Dev Staff",
  },
  "dev:member": {
    avatarUrl: "",
    hasFullAccess: false,
    isMember: true,
    user: "100000000000000002",
    username: "Dev Member",
  },
  "dev:guest": {
    avatarUrl: "",
    hasFullAccess: false,
    isMember: false,
    user: "100000000000000003",
    username: "Dev Guest",
  },
};

/** Roles → access flags, plus the bootstrap allowlist. */
const resolveAccessFlagsFromRoles = (roles, userId) => {
  const isMember = roles.includes(REQUIRED_ROLE_ID);
  let hasFullAccess = SPECIAL_ROLE_IDS.some((roleId) => roles.includes(roleId));

  if (STAFF_USER_IDS.includes(userId)) {
    // Logged every time so an allowlisted grant is never invisible.
    console.warn("Granting staff access from the DISCORD_STAFF_USER_IDS allowlist.", { userId });
    hasFullAccess = true;
  }

  return { hasFullAccess, isMember };
};

/**
 * How long a session refresh is served from the caller's existing claims.
 *
 * refreshTrustedSession reaches Discord's bot API on every call, and that budget
 * is shared by the whole event: the per-route rate limit for guild-member
 * lookups is Discord's, not ours, so one client in a retry loop can spend it and
 * degrade membership resolution for everyone in the room. The page calls this
 * once per load, so anything above a few seconds is invisible in normal use.
 *
 * Instance-local by design. A shared counter in Firestore would put another
 * write on the hot path this audit is trying to take load off, and the failure
 * this guards against is one client looping — which lands on one instance. It is
 * a dampener, not a quota, and the fallback below already degrades gracefully.
 */
const SESSION_REFRESH_COOLDOWN_MS = 30_000;

/**
 * uid -> when it last caused a Discord lookup.
 *
 * Bounded so a long-lived instance cannot grow this without limit; the eviction
 * is crude on purpose, because entries older than the cooldown are dead weight
 * and the exact victim does not matter.
 */
const SESSION_REFRESH_MAX_TRACKED_USERS = 5_000;
const lastSessionRefreshAtMsByUserId = new Map();

const shouldSkipDiscordSessionRefresh = (userId, nowMs = Date.now()) => {
  const lastRefreshAtMs = lastSessionRefreshAtMsByUserId.get(userId);

  if (Number.isFinite(lastRefreshAtMs) && nowMs - lastRefreshAtMs < SESSION_REFRESH_COOLDOWN_MS) {
    return true;
  }

  if (lastSessionRefreshAtMsByUserId.size >= SESSION_REFRESH_MAX_TRACKED_USERS) {
    for (const [trackedUserId, trackedAtMs] of lastSessionRefreshAtMsByUserId) {
      if (nowMs - trackedAtMs >= SESSION_REFRESH_COOLDOWN_MS) {
        lastSessionRefreshAtMsByUserId.delete(trackedUserId);
      }
    }
  }

  lastSessionRefreshAtMsByUserId.set(userId, nowMs);
  return false;
};

const mintTrustedSessionToken = ({ hasFullAccess, isMember, userId }) =>
  getAuth().createCustomToken(userId, {
    // Stamped so the continuity paths below can tell a just-verified session
    // from one coasting on a failing Discord lookup.
    claimsMintedAt: Date.now(),
    member: isMember,
    staff: hasFullAccess,
  });

/**
 * Reads a signed-in user's guild roles using their own access token.
 *
 * A 404 means they are simply not in the guild. Any other failure is treated as
 * transient and falls back to the caller's existing claims — but only briefly,
 * because without a bound anyone removed from the staff role kept staff access
 * for as long as the lookup kept failing, which is a revocation that never lands.
 */
const resolveAccessFlagsFromUserToken = async ({ accessToken, request, userId }) => {
  try {
    const guildMemberData = await fetchDiscordJsonWithRetry({
      accessToken,
      path: `/users/@me/guilds/${TARGET_GUILD_ID}/member`,
      errorMessage: "Unable to verify Discord membership.",
    });

    const roles = Array.isArray(guildMemberData.roles) ? guildMemberData.roles : [];
    return resolveAccessFlagsFromRoles(roles, userId);
  } catch (err) {
    const status = getHttpStatusFromError(err);

    if (status === 404) {
      console.warn("Guild membership check returned 404; treating user as non-member.", {
        error: err && (err.message || err),
        userId,
      });
      return resolveAccessFlagsFromRoles([], userId);
    }

    const callerToken = request.auth?.token || {};
    const claimsMintedAt = Number(callerToken.claimsMintedAt);
    const claimsAreFresh =
      Number.isFinite(claimsMintedAt) && Date.now() - claimsMintedAt < CLAIM_REUSE_MAX_AGE_MS;
    const canReuseCallerClaims = request.auth?.uid === userId && claimsAreFresh;
    const hadStaffAccess = canReuseCallerClaims && callerToken.staff === true;
    const hadMemberAccess = canReuseCallerClaims && callerToken.member === true;

    if (hadStaffAccess || hadMemberAccess) {
      console.warn("Guild membership check failed; reusing recent caller token claims.", {
        error: err && (err.message || err),
        reusedClaims: { member: hadMemberAccess, staff: hadStaffAccess },
        userId,
      });
      return { hasFullAccess: hadStaffAccess, isMember: hadMemberAccess };
    }

    console.error("Guild membership check failed and no trusted caller claims were available.", {
      error: err && (err.message || err),
      userId,
    });
    throw new HttpsError(
      "unavailable",
      "Unable to verify Discord membership right now. Please try logging in again.",
    );
  }
};

/**
 * Signs a user in from an authorization code.
 *
 * Replaces the old exchangeDiscordAccessToken, which took a Discord access
 * token straight from the browser. Removing it removes the whole class of
 * problem: there is no longer a token in the browser to steal, and no endpoint
 * that will accept one.
 */
export const exchangeDiscordAuthCode = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, secrets: [discordClientSecretSecret] },
  async (request) => {
    const code = typeof request.data?.code === "string" ? request.data.code.trim() : "";

    if (!code) {
      throw new HttpsError("invalid-argument", "An authorization code is required.");
    }

    // Local development only. FUNCTIONS_EMULATOR is set by the emulator and by
    // nothing else, so this branch cannot exist in a deployed function — it lets
    // you exercise staff and member flows without a Discord role or a real login.
    //   localStorage.setItem("devLogin", "dev:staff");
    const devProfile = process.env.FUNCTIONS_EMULATOR === "true"
      ? DEV_LOGIN_PROFILES[code]
      : null;

    if (devProfile) {
      console.warn(`Emulator dev login as "${code}".`);

      return {
        firebaseCustomToken: await mintTrustedSessionToken({
          hasFullAccess: devProfile.hasFullAccess,
          isMember: devProfile.isMember,
          userId: devProfile.user,
        }),
        profile: devProfile,
      };
    }

    const codeVerifier =
      typeof request.data?.codeVerifier === "string" ? request.data.codeVerifier : "";
    const redirectUri =
      typeof request.data?.redirectUri === "string" ? request.data.redirectUri : "";

    if (codeVerifier.length < 43 || codeVerifier.length > 128) {
      throw new HttpsError("invalid-argument", "A valid PKCE code verifier is required.");
    }

    assertAllowedRedirectUri(redirectUri);

    const accessToken = await exchangeDiscordCodeForAccessToken({
      code,
      codeVerifier,
      redirectUri,
    });

    const userData = await fetchDiscordJson({
      accessToken,
      path: "/users/@me",
      errorMessage: "Discord login failed.",
    });

    const { hasFullAccess, isMember } = await resolveAccessFlagsFromUserToken({
      accessToken,
      request,
      userId: userData.id,
    });

    return {
      firebaseCustomToken: await mintTrustedSessionToken({
        hasFullAccess,
        isMember,
        userId: userData.id,
      }),
      profile: {
        avatarUrl: buildDiscordAvatarUrl(userData),
        hasFullAccess,
        isMember,
        user: userData.id,
        username: userData.username || userData.id,
      },
    };
  },
);

/**
 * Re-checks a signed-in user's roles and reissues their session.
 *
 * The browser used to re-verify roles on every page load by replaying its
 * stored Discord token. With no token to replay, that would have left roles
 * frozen for the life of a session — a staff revocation landing only at the next
 * full login. This does the same job from the other side, using the bot token,
 * so nothing about the user's Discord credentials has to be kept anywhere.
 *
 * Falls back to the caller's existing claims when the bot lookup is
 * unavailable, so a missing DISCORD_BOT_TOKEN degrades to today's behaviour
 * rather than signing everyone out.
 */
export const refreshTrustedSession = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, secrets: [discordBotTokenSecret] },
  async (request) => {
    const userId = request.auth?.uid;

    if (!userId) {
      throw new HttpsError("unauthenticated", "Sign in before refreshing a session.");
    }

    /* Called again within the cooldown: reissue from the claims the caller is
       already carrying rather than spending another Discord lookup. This is the
       same answer the unavailable-Discord path below gives, and it is correct
       for the same reason — those claims were themselves minted from a verified
       role check moments ago. A revocation still lands, just on the next call
       after the cooldown rather than on a call made seconds after the last. */
    if (shouldSkipDiscordSessionRefresh(userId)) {
      const throttledToken = request.auth?.token || {};
      const throttledIsMember = throttledToken.member === true;
      const throttledHasFullAccess =
        throttledToken.staff === true || STAFF_USER_IDS.includes(userId);

      return {
        firebaseCustomToken: await mintTrustedSessionToken({
          hasFullAccess: throttledHasFullAccess,
          isMember: throttledIsMember,
          userId,
        }),
        hasFullAccess: throttledHasFullAccess,
        isMember: throttledIsMember,
      };
    }

    const roles = await fetchDiscordGuildMemberRolesByBot({ discordUserId: userId });

    if (Array.isArray(roles)) {
      const { hasFullAccess, isMember } = resolveAccessFlagsFromRoles(roles, userId);

      return {
        firebaseCustomToken: await mintTrustedSessionToken({ hasFullAccess, isMember, userId }),
        hasFullAccess,
        isMember,
      };
    }

    const callerToken = request.auth?.token || {};
    const isMember = callerToken.member === true;
    const hasFullAccess = callerToken.staff === true || STAFF_USER_IDS.includes(userId);

    console.warn("Session refresh could not reach Discord; reusing existing claims.", { userId });

    return {
      firebaseCustomToken: await mintTrustedSessionToken({ hasFullAccess, isMember, userId }),
      hasFullAccess,
      isMember,
    };
  },
);

/**
 * Issues an attendee their number. This is the only path that creates a claim for
 * a non-staff user: the caller must present a live QR code from the display, the
 * number comes from the event counter rather than the request, and membership is
 * read from the verified token instead of being taken on trust.
 */
const ANNOUNCEMENTS_URL = process.env.BOOK_LIST_ANNOUNCEMENTS_URL
  || "https://www.boilerbookclub.com/announcements/";

const decodeHtmlEntities = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "\u2019")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");

/**
 * Returns the newest post on the club's announcements page.
 *
 * That post is almost always the book list for the event being set up, so the
 * control panel offers it as the Book List URL instead of making staff paste it.
 * Fetched server-side because the announcements site sends no CORS headers, so
 * the browser cannot read it directly.
 *
 * Scraping is inherently brittle: the callable reports failure rather than
 * guessing, and the field stays editable either way.
 */
const ARCHIVE_ROOT = "eventArchives";

/**
 * Summary numbers Past Events shows for each archived event.
 *
 * These used to be recomputed on every listing by reading the entire claims
 * subcollection of all 50 listed events — tens of thousands of document reads
 * per button press, growing with every event ever run. They are derived here
 * instead, during the archive sweep, which already reads every claim exactly
 * once and so gets them for free.
 */
const createArchiveMetrics = () => ({
  attendeeCount: 0,
  attendeesWithItems: 0,
  firstJoinAtMs: null,
  itemsClaimed: 0,
  lastJoinAtMs: null,
  memberCount: 0,
  rounds: 0,
});

const addClaimToArchiveMetrics = (metrics, claim) => {
  const claimedCount = toNonNegativeInteger(claim.itemsClaimedCount) ?? 0;
  /* Staff ran the event rather than attended it, and the live claimCount has
     left them out since they were given their own numbering — so counting them
     here would make a closed event report a bigger turnout than the control
     panel showed all evening. Their pickups still count: an item they took off
     the table is an item that left it. */
  const isStaffClaim = claim.isStaff === true || isStaffClaimNumber(claim.number);

  metrics.itemsClaimed += claimedCount;
  metrics.rounds = Math.max(metrics.rounds, toNonNegativeInteger(claim.redeemedRound) ?? 0);

  if (isStaffClaim) {
    return;
  }

  metrics.attendeeCount += 1;

  if (claimedCount > 0) {
    metrics.attendeesWithItems += 1;
  }

  if (claim.isMember === true) {
    metrics.memberCount += 1;
  }

  const joinedAt = getTimestampMs(claim.joinedAt) ?? getTimestampMs(claim.claimedAt);

  if (Number.isFinite(joinedAt)) {
    metrics.firstJoinAtMs =
      metrics.firstJoinAtMs === null ? joinedAt : Math.min(metrics.firstJoinAtMs, joinedAt);
    metrics.lastJoinAtMs =
      metrics.lastJoinAtMs === null ? joinedAt : Math.max(metrics.lastJoinAtMs, joinedAt);
  }
};

const minDefined = (left, right) => {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
};

const maxDefined = (left, right) => {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
};

/**
 * Folds a fresh sweep's numbers into whatever the archive already recorded.
 *
 * An event can be archived more than once — a close that partially failed, or
 * stray documents arriving with a later event — and each sweep only sees the
 * documents it moved. Combining rather than replacing keeps the totals honest
 * across both.
 */
const mergeArchiveMetrics = (existing, added) => {
  if (!existing) {
    return added;
  }

  return {
    attendeeCount: (toNonNegativeInteger(existing.attendeeCount) ?? 0) + added.attendeeCount,
    attendeesWithItems:
      (toNonNegativeInteger(existing.attendeesWithItems) ?? 0) + added.attendeesWithItems,
    firstJoinAtMs: minDefined(getTimestampMs(existing.firstJoinAtMs), added.firstJoinAtMs),
    itemsClaimed: (toNonNegativeInteger(existing.itemsClaimed) ?? 0) + added.itemsClaimed,
    lastJoinAtMs: maxDefined(getTimestampMs(existing.lastJoinAtMs), added.lastJoinAtMs),
    memberCount: (toNonNegativeInteger(existing.memberCount) ?? 0) + added.memberCount,
    rounds: Math.max(toNonNegativeInteger(existing.rounds) ?? 0, added.rounds),
  };
};

// Bumped when the shape below changes, so a listing can tell stored numbers from
// an archive written before this existed and fall back to counting.
const ARCHIVE_METRICS_VERSION = 1;

/** Writes each event's summary onto its archive stub, combining with any prior sweep. */
const writeArchiveMetrics = async (metricsByEventId) => {
  const entries = [...metricsByEventId.entries()];

  await mapWithConcurrency(entries, 5, async ([eventId, added]) => {
    const stubRef = db.doc(`${ARCHIVE_ROOT}/${eventId}`);

    await db.runTransaction(async (tx) => {
      const stub = await tx.get(stubRef);
      const existing = stub.exists ? stub.data()?.metrics : null;

      tx.set(
        stubRef,
        {
          metrics: mergeArchiveMetrics(existing, added),
          metricsVersion: ARCHIVE_METRICS_VERSION,
        },
        { merge: true },
      );
    });
  });
};

/** Normalizes the summary stored on an archive stub into the listing's shape. */
const readStoredArchiveMetrics = (metrics) => ({
  attendeeCount: toNonNegativeInteger(metrics.attendeeCount) ?? 0,
  attendeesWithItems: toNonNegativeInteger(metrics.attendeesWithItems) ?? 0,
  firstJoinAtMs: getTimestampMs(metrics.firstJoinAtMs),
  itemsClaimed: toNonNegativeInteger(metrics.itemsClaimed) ?? 0,
  lastJoinAtMs: getTimestampMs(metrics.lastJoinAtMs),
  memberCount: toNonNegativeInteger(metrics.memberCount) ?? 0,
  rounds: toNonNegativeInteger(metrics.rounds) ?? 0,
});

/**
 * The pre-denormalisation path: counts an archive by reading all of its claims.
 *
 * Only reached for events closed before the summary was written at close time,
 * so it runs at most once per old archive rather than on every listing.
 */
const computeArchiveMetricsFromClaims = async (eventId) => {
  const claims = await db.collection(`${ARCHIVE_ROOT}/${eventId}/claims`).get();
  const metrics = createArchiveMetrics();

  claims.forEach((claimDoc) => {
    addClaimToArchiveMetrics(metrics, claimDoc.data() || {});
  });

  return metrics;
};

/**
 * Past events, newest first, with the metrics staff care about.
 *
 * Attendees are archived under eventArchives/{eventId} when an event closes.
 * That path matches no security rule, so it is unreachable from a client and
 * has to be read through here.
 */
export const listArchivedEvents = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to view past events.");
    }

    const archives = await db.collection(ARCHIVE_ROOT).orderBy("closedAt", "desc").limit(50).get();

    const events = await mapWithConcurrency(archives.docs, 5, async (archiveDoc) => {
      const archive = archiveDoc.data() || {};
      // Written at close by writeArchiveMetrics. Reading the whole claims
      // subcollection here instead — as this did for every listed event — cost
      // tens of thousands of document reads per listing and got worse with
      // every event run. Archives closed before that existed still need the
      // slow path once.
      const metrics = archive.metricsVersion === ARCHIVE_METRICS_VERSION && archive.metrics
        ? readStoredArchiveMetrics(archive.metrics)
        : await computeArchiveMetricsFromClaims(archiveDoc.id);

      return {
        ...metrics,
        closedAtMs: getTimestampMs(archive.closedAt),
        eventId: archiveDoc.id,
        timeframeLabel: archive.timeframeLabel || "",
        title: archive.title || "Untitled event",
      };
    });

    return { events };
  },
);

/** Full attendee list for one past event, for the expanded view. */
export const readArchivedEvent = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to view past events.");
    }

    const eventId = request.data?.eventId;

    if (!isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid eventId is required.");
    }

    const [archiveSnapshot, claimsSnapshot] = await Promise.all([
      db.doc(`${ARCHIVE_ROOT}/${eventId}`).get(),
      db.collection(`${ARCHIVE_ROOT}/${eventId}/claims`).orderBy("number").get(),
    ]);

    if (!archiveSnapshot.exists) {
      throw new HttpsError("not-found", "That past event could not be found.");
    }

    const archive = archiveSnapshot.data() || {};

    return {
      attendees: claimsSnapshot.docs.map((claimDoc) => {
        const claim = claimDoc.data() || {};

        return {
          avatarUrl: claim.avatarUrl || "",
          claimId: claimDoc.id,
          displayName: claim.displayName || "Unknown attendee",
          isMember: claim.isMember === true,
          itemsClaimedCount: toNonNegativeInteger(claim.itemsClaimedCount) ?? 0,
          itemClaimedAtMsHistory: Array.isArray(claim.itemClaimedAtMsHistory)
            ? claim.itemClaimedAtMsHistory.filter((value) => Number.isFinite(value))
            : [],
          joinedAtMs: getTimestampMs(claim.joinedAt) ?? getTimestampMs(claim.claimedAt),
          // toClaimNumber, not toPositiveInteger: a staff number is negative,
          // and flooring it to 0 gave every staff member in a past event the
          // same non-identity. See the note on toClaimNumber above.
          number: toClaimNumber(claim.number) ?? 0,
          redeemedAtMs: getTimestampMs(claim.redeemedAt),
        };
      }),
      closedAtMs: getTimestampMs(archive.closedAt),
      eventId,
      timeframeLabel: archive.timeframeLabel || "",
      title: archive.title || "Untitled event",
    };
  },
);

/**
 * Permanently removes one past event and everything archived under it.
 *
 * There is no undo: the archive is the only copy of an event's attendees once
 * the live collections have been cleared, so the control panel asks staff to
 * confirm before calling this.
 */
export const deleteArchivedEvent = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to delete past events.");
    }

    const eventId = request.data?.eventId;

    if (!isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid eventId is required.");
    }

    const archiveRef = db.doc(`${ARCHIVE_ROOT}/${eventId}`);

    if (!(await archiveRef.get()).exists) {
      throw new HttpsError("not-found", "That past event could not be found.");
    }

    const [claims, preclaims] = await Promise.all([
      deleteCollection(`${ARCHIVE_ROOT}/${eventId}/claims`),
      deleteCollection(`${ARCHIVE_ROOT}/${eventId}/preclaims`),
    ]);

    await archiveRef.delete();

    console.info("Deleted archived event", { claims, eventId, preclaims });

    return { claims, deleted: true, eventId, preclaims };
  },
);

export const fetchLatestAnnouncement = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to read announcements.");
    }

    let html = "";

    try {
      const response = await fetch(ANNOUNCEMENTS_URL, {
        headers: { accept: "text/html" },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      html = await response.text();
    } catch (error) {
      console.warn("Announcements fetch failed", { error: error?.message || String(error) });
      throw new HttpsError("unavailable", "Could not reach the announcements page.");
    }

    const base = new URL(ANNOUNCEMENTS_URL);
    // Posts repeat their href (image, heading, "read more"), so take the first
    // one in document order that is an actual post rather than the index.
    const hrefs = [...html.matchAll(/href="(\/announcements\/[^"#?]+)"/g)].map((match) => match[1]);
    const postPath = hrefs.find((href) => href.replace(/\/+$/, "") !== base.pathname.replace(/\/+$/, ""));

    if (!postPath) {
      throw new HttpsError("not-found", "No announcement posts found on that page.");
    }

    const url = new URL(postPath, base.origin).toString();

    // Best-effort title: the first heading after the winning link, else the slug.
    const linkIndex = html.indexOf(postPath);
    const headingMatch = html
      .slice(linkIndex, linkIndex + 4000)
      .match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
    const slugTitle = postPath
      .split("/")
      .filter(Boolean)
      .pop()
      .split("-")
      .filter((part) => !/^[a-z0-9]{5}$/.test(part) && !/^\d+$/.test(part))
      .join(" ");
    const title = headingMatch
      ? decodeHtmlEntities(headingMatch[1].replace(/<[^>]+>/g, "").trim()).slice(0, 200)
      : slugTitle;

    return { title: title || slugTitle, url };
  },
);

export const claimNumberAsAttendee = onCall(
  attendeeCallableOptions(),
  async (request) => {
  const callerUid = request.auth?.uid;

  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Check in before claiming a number.");
  }


  const eventId = request.data?.eventId;

  if (!isValidDocumentId(eventId)) {
    throw new HttpsError("invalid-argument", "A valid eventId is required.");
  }

  const isStaffCaller = request.auth?.token?.staff === true;

  await assertClaimAccess({
    allowWithoutCode: isStaffCaller,
    claimAccessCode: request.data?.claimAccessCode,
    eventId,
  });

  const isMember = request.auth?.token?.member === true;
  const participantType = "discord";
  const displayName = sanitizeDisplayName(request.data?.displayName, callerUid);
  const avatarUrl = sanitizeAvatarUrl(request.data?.avatarUrl);
  const claimId = buildAttendeeClaimId(eventId, request);
  const liveEventRef = db.doc(LIVE_EVENT_PATH);
  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${claimId}`);
  let result = null;

  /*
   * Somebody who already holds a number, settled without touching the event
   * document.
   *
   * The transaction below reads the live event unconditionally, and a
   * transactional read takes a lock — so an attendee who already has a claim and
   * will never move a counter still contended with every genuine check-in for
   * the one document every check-in has to write. That is not a rare path: it is
   * every page reload, every client retry from src/claimRetry.js, and everyone
   * who simply reopens their ticket during the evening. At three hundred people
   * it is most of the traffic on the hottest document in the system.
   *
   * Nothing here needs the event document. assertClaimAccess above has already
   * read it and thrown unless the event is live and is this event; the claim
   * carries its own eventId, which is checked again below; and no branch in here
   * allocates a number. Two point reads and a batch settle it with no lock at
   * all.
   *
   * Same shape, and the same reasoning, as the fast path in
   * assignPreclaimIfQueued. It is a fast path and not a check: a claim that does
   * not exist yet falls through to the transaction, which re-reads everything
   * and remains the authority on who gets a number.
   */
  const earlyClaimSnapshot = await claimRef.get();

  if (earlyClaimSnapshot.exists) {
    const existingClaim = earlyClaimSnapshot.data() || {};

    /* A claim left over from an event that has since been replaced is not this
       event's claim. The transaction path would have caught this by way of the
       event document; here it is checked directly against the claim. */
    if (existingClaim.eventId === eventId) {
      const nowMs = Date.now();
      const qrToken = existingClaim.qrToken || crypto.randomUUID();
      const claimUpdates = { updatedAt: nowMs };

      if (!existingClaim.qrToken) {
        claimUpdates.qrToken = qrToken;
      }

      if (avatarUrl && existingClaim.avatarUrl !== avatarUrl) {
        claimUpdates.avatarUrl = avatarUrl;
      }

      if (displayName && existingClaim.displayName !== displayName) {
        claimUpdates.displayName = displayName;
      }

      if (existingClaim.isMember !== isMember) {
        claimUpdates.isMember = isMember;
      }

      /* Their number is never re-issued here, so a staff member who took a
         number before they were staff keeps the one the room has already seen.
         Only the flag is corrected, which is what the roster groups on. */
      if (existingClaim.isStaff !== isStaffCaller) {
        claimUpdates.isStaff = isStaffCaller;
      }

      /* One batch rather than two writes, so a leftover queue entry cannot
         survive an update that succeeded — it would be reprocessed later and
         overwrite this claim with a second number. */
      const batch = db.batch();
      batch.set(claimRef, claimUpdates, { merge: true });
      batch.delete(preclaimRef);
      await batch.commit();

      return {
        claimId,
        existing: true,
        isMember,
        isStaff: isStaffCaller,
        itemsClaimedCount: toPositiveInteger(existingClaim.itemsClaimedCount) ?? 0,
        number: toClaimNumber(existingClaim.number) ?? 0,
        qrToken,
        redeemedRound: toPositiveInteger(existingClaim.redeemedRound) ?? 0,
      };
    }
  }

  await db.runTransaction(async (tx) => {
    const [liveEventSnapshot, claimSnapshot, preclaimSnapshot] = await Promise.all([
      tx.get(liveEventRef),
      tx.get(claimRef),
      tx.get(preclaimRef),
    ]);

    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};

    if (!liveEvent.active || liveEvent.eventId !== eventId) {
      throw new HttpsError("failed-precondition", "This event is no longer accepting check-ins.");
    }

    const nowMs = Date.now();

    if (claimSnapshot.exists) {
      const existingClaim = claimSnapshot.data() || {};
      const qrToken = existingClaim.qrToken || crypto.randomUUID();
      const claimUpdates = { updatedAt: nowMs };

      if (!existingClaim.qrToken) {
        claimUpdates.qrToken = qrToken;
      }

      if (avatarUrl && existingClaim.avatarUrl !== avatarUrl) {
        claimUpdates.avatarUrl = avatarUrl;
      }

      if (displayName && existingClaim.displayName !== displayName) {
        claimUpdates.displayName = displayName;
      }

      if (existingClaim.isMember !== isMember) {
        claimUpdates.isMember = isMember;
      }

      /* Their number is never re-issued here, so a staff member who took a
         number before they were staff keeps the one the room has already seen.
         Only the flag is corrected, which is what the roster groups on. */
      if (existingClaim.isStaff !== isStaffCaller) {
        claimUpdates.isStaff = isStaffCaller;
      }

      tx.set(claimRef, claimUpdates, { merge: true });
      // A leftover queue entry would be reprocessed later and overwrite this claim
      // with a second number, so drop it now that the claim exists.
      tx.delete(preclaimRef);

      result = {
        claimId,
        existing: true,
        isMember,
        isStaff: isStaffCaller,
        itemsClaimedCount: toPositiveInteger(existingClaim.itemsClaimedCount) ?? 0,
        number: toClaimNumber(existingClaim.number) ?? 0,
        qrToken,
        redeemedRound: toPositiveInteger(existingClaim.redeemedRound) ?? 0,
      };
      return;
    }

    const { counterUpdates, number } = allocateClaimNumber({
      isStaff: isStaffCaller,
      liveEvent,
    });
    const qrToken = crypto.randomUUID();
    // Someone who queued before the doors opened keeps their original join time so
    // the attendee graph stays honest.
    const joinedAt = preclaimSnapshot.exists
      ? getTimestampMs(preclaimSnapshot.data()?.createdAt) ?? nowMs
      : nowMs;

    tx.set(claimRef, {
      avatarUrl,
      claimedAt: nowMs,
      joinedAt,
      discordUserId: callerUid,
      displayName,
      eventId,
      isMember,
      isStaff: isStaffCaller,
      itemClaimedAtMsHistory: [],
      itemsClaimedCount: 0,
      number,
      participantType,
      qrToken,
      redeemedRound: 0,
      updatedAt: nowMs,
    });
    tx.delete(preclaimRef);
    tx.update(liveEventRef, {
      ...counterUpdates,
      updatedAt: nowMs,
    });

    result = {
      claimId,
      existing: false,
      isMember,
      isStaff: isStaffCaller,
      itemsClaimedCount: 0,
      number,
      qrToken,
      redeemedRound: 0,
    };
  });

  return result;
});

/**
 * Adds an attendee to the pre-event queue. Same access check as claiming a number:
 * without a live display code there is no way in. Member status and the moment a
 * member becomes eligible both come from trusted sources, never from the caller.
 */
export const joinQueueAsAttendee = onCall(
  attendeeCallableOptions(),
  async (request) => {
  const callerUid = request.auth?.uid;

  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Check in before joining the queue.");
  }


  const eventId = request.data?.eventId;

  if (!isValidDocumentId(eventId)) {
    throw new HttpsError("invalid-argument", "A valid eventId is required.");
  }

  const isStaffCaller = request.auth?.token?.staff === true;
  const liveEvent = await assertClaimAccess({
    allowWithoutCode: isStaffCaller,
    claimAccessCode: request.data?.claimAccessCode,
    eventId,
  });

  const claimId = buildAttendeeClaimId(eventId, request);
  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${claimId}`);
  const [claimSnapshot, preclaimSnapshot] = await Promise.all([
    claimRef.get(),
    preclaimRef.get(),
  ]);

  if (claimSnapshot.exists) {
    return { alreadyClaimed: true, claimId, queued: false };
  }

  const nowMs = Date.now();
  const isMember = request.auth?.token?.member === true;
  const memberEligibleAtRaw = isMember ? getMemberEligibleAtForLiveEvent(liveEvent, nowMs) : null;
  const memberEligibleAt =
    Number.isFinite(memberEligibleAtRaw) &&
    memberEligibleAtRaw < nowMs + MEMBER_ELIGIBLE_AT_MAX_AHEAD_MS
      ? memberEligibleAtRaw
      : null;
  // Preserve the original queue position when this runs more than once.
  const createdAt = preclaimSnapshot.exists
    ? getTimestampMs(preclaimSnapshot.data()?.createdAt) ?? nowMs
    : nowMs;

  await preclaimRef.set(
    {
      avatarUrl: sanitizeAvatarUrl(request.data?.avatarUrl),
      createdAt,
      discordUserId: callerUid,
      displayName: sanitizeDisplayName(request.data?.displayName, callerUid),
      eventId,
      isMember,
      // From the verified token, so the number they are eventually handed is
      // decided by their role and not by what their phone claimed to be.
      isStaff: isStaffCaller,
      memberEligibleAt,
      participantType: "discord",
      updatedAt: nowMs,
    },
    { merge: true },
  );

  return {
    alreadyClaimed: false,
    claimId,
    isMember,
    isStaff: isStaffCaller,
    memberEligibleAt,
    queued: true,
  };
});

export const assignPreclaimIfQueued = onCall(
  attendeeCallableOptions(),
  async (request) => {
  const eventId = request.data?.eventId;
  const claimKey = request.data?.claimKey;

  // claimKey needs no path check of its own: it only reaches a document path
  // through encodeURIComponent, which escapes a slash.
  if (!isValidDocumentId(eventId) || !claimKey || typeof claimKey !== "string") {
    throw new HttpsError("invalid-argument", "A valid eventId and claimKey are required.");
  }

  // The caller may only assign their own queue entry. Comparing against the key
  // we would have built for them is what stops one attendee naming another's.
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Check in before claiming a number.");
  }


  if (claimKey !== buildParticipantKey(request)) {
    throw new HttpsError("permission-denied", "Not authorized to assign this preclaim.");
  }

  const preclaimId = `${eventId}__${encodeURIComponent(claimKey)}`;
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);
  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${preclaimId}`);
  const liveEventRef = db.doc(LIVE_EVENT_PATH);

  /*
   * The cheap answer first, outside any transaction.
   *
   * This callable is the attendee page's fallback for "the server-side sweep
   * did not run for me", so at the moment the doors open every phone in the
   * room calls it — and for almost all of them the answer is "you already have
   * a claim" or "you were never queued". Both of those used to be reached by
   * opening a transaction that reads the live event document, so three hundred
   * no-op calls became three hundred transactions contending on the one
   * document every check-in already has to write. Two point reads settle it
   * instead, and take no locks.
   *
   * This is only a fast path. It is not a check: the transaction below re-reads
   * both documents and is what actually decides, so a claim created between
   * these reads and that one still wins.
   */
  const [earlyClaimSnapshot, earlyPreclaimSnapshot] = await Promise.all([
    claimRef.get(),
    preclaimRef.get(),
  ]);

  if (earlyClaimSnapshot.exists) {
    return { assigned: false, reason: "already-claimed" };
  }

  if (!earlyPreclaimSnapshot.exists) {
    return { assigned: false, reason: "no-preclaim" };
  }

  // Every read happens inside the transaction. The queue entry used to be read
  // outside it and never re-checked, so this could land on top of a claim made
  // in between — and because writeClaimFromPreclaim is a non-merge set, that
  // wiped the attendee's redemption history and let them collect a second item.
  return db.runTransaction(async (tx) => {
    const [liveEventSnapshot, preclaimSnapshot, claimSnapshot] = await tx.getAll(
      liveEventRef,
      preclaimRef,
      claimRef,
    );

    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};

    // If live event doesn't match requested event, abort
    if (!liveEvent.eventId || liveEvent.eventId !== eventId) {
      throw new HttpsError("failed-precondition", "Event is not active or does not match.");
    }

    // Closing between the page render and this call is an ordinary race, not a
    // client bug, so it answers rather than throws.
    if (liveEvent.active !== true) {
      return { assigned: false, reason: "event-inactive" };
    }

    if (claimSnapshot.exists) {
      return { assigned: false, reason: "already-claimed" };
    }

    if (!preclaimSnapshot.exists) {
      return { assigned: false, reason: "no-preclaim" };
    }

    const pre = preclaimSnapshot.data() || {};
    const nowMs = Date.now();

    if (pre.isMember) {
      const memberEligibleAt = toFiniteMs(pre.memberEligibleAt);

      if (memberEligibleAt !== null && memberEligibleAt > nowMs) {
        return { assigned: false, reason: "member-not-eligible" };
      }
    } else if (pre.isStaff !== true && !isLiveEventStarted(liveEvent, nowMs)) {
      // Non-members have no early window. Without this, any queued attendee
      // could call the callable directly before the doors opened and take a
      // number ahead of the members the early access exists for. Staff are
      // exempt: their number is not a place in that queue, so handing it over
      // early takes nothing from anybody.
      return { assigned: false, reason: "event-not-started" };
    }

    const { counterUpdates, number: assignedNumber } = allocateClaimNumber({
      isStaff: pre.isStaff === true,
      liveEvent,
    });

    writeClaimFromPreclaim({
      tx,
      claimRef,
      eventId: liveEvent.eventId,
      number: assignedNumber,
      preclaimData: pre,
    });

    tx.delete(preclaimRef);

    tx.update(liveEventRef, {
      ...counterUpdates,
      updatedAt: Date.now(),
    });

    return { assigned: true };
  });
});

/*
 * listPreclaims used to live here.
 *
 * The control panel polled it every five seconds for the whole queue, per staff
 * tab. It holds a listener now — see subscribeToPreclaims in src/firebase.js —
 * so nothing has called this since, and leaving a deployed callable that reads
 * an entire collection is a cost and a surface with no reader.
 */

export const assignPreclaimAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
  // Staff may assign any preclaim immediately
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to assign preclaims as staff.');
  }

  const preclaimId = request.data?.preclaimId;
  if (!isValidDocumentId(preclaimId)) {
    throw new HttpsError('invalid-argument', 'A valid preclaimId is required.');
  }

  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);
  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${preclaimId}`);
  const liveEventRef = db.doc(LIVE_EVENT_PATH);

  return db.runTransaction(async (tx) => {
    // Read inside the transaction, same reasoning as assignPreclaimIfQueued:
    // the attendee's own phone may be assigning the very same queue entry.
    const [liveEventSnapshot, preclaimSnapshot, claimSnapshot] = await tx.getAll(
      liveEventRef,
      preclaimRef,
      claimRef,
    );

    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};

    if (!liveEvent.eventId) {
      throw new HttpsError('failed-precondition', 'Event is not active.');
    }

    if (claimSnapshot.exists) {
      // Someone got there first. Clear the leftover queue entry so the roster
      // stops showing them in both lists, but leave the claim untouched.
      tx.delete(preclaimRef);
      return { assigned: false, reason: 'already-claimed' };
    }

    if (!preclaimSnapshot.exists) {
      throw new HttpsError('not-found', 'Preclaim not found.');
    }

    const preclaimData = preclaimSnapshot.data() || {};

    // Queue entries are only cleared when an event closes, so a close that
    // failed part way leaves last event's entries sitting in the roster for
    // staff to click. Checking only that *some* event is live let one of those
    // be handed a number in the current event.
    if (preclaimData.eventId && preclaimData.eventId !== liveEvent.eventId) {
      throw new HttpsError(
        'failed-precondition',
        'That queue entry belongs to a different event.',
      );
    }

    const { counterUpdates, number: assignedNumber } = allocateClaimNumber({
      isStaff: preclaimData.isStaff === true,
      liveEvent,
    });

    writeClaimFromPreclaim({
      tx,
      claimRef,
      eventId: liveEvent.eventId,
      number: assignedNumber,
      preclaimData,
    });

    tx.delete(preclaimRef);

    tx.update(liveEventRef, {
      ...counterUpdates,
      updatedAt: Date.now(),
    });

    return { assigned: true };
  });
});

export const removePreclaimAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to remove preclaims.');
  }

  const preclaimId = request.data?.preclaimId;
  if (!isValidDocumentId(preclaimId)) {
    throw new HttpsError('invalid-argument', 'A valid preclaimId is required.');
  }

  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);
  const preSnap = await preclaimRef.get();

  if (!preSnap.exists) {
    throw new HttpsError('not-found', 'Preclaim not found.');
  }

  await preclaimRef.delete();

  return { removed: true };
});

/*
 * refreshPreclaimMembershipAsStaff used to live here.
 *
 * It re-checked one queue entry's Discord membership. Nothing has called it
 * since the control panel moved to refreshing the whole queue in one go — see
 * refreshAllPreclaimMembershipsAsStaff below, which does the same work in
 * bounded parallel — and a deployed callable that spends a Discord round trip
 * on behalf of no caller is a cost and a surface with no reader.
 */

export const refreshAllPreclaimMembershipsAsStaff = onCall(
  // Each entry costs a Discord round trip. Even batched, a long queue needs
  // more than the default minute.
  { enforceAppCheck: ENFORCE_APP_CHECK, secrets: [discordBotTokenSecret], timeoutSeconds: 300 },
  async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError("permission-denied", "Not authorized to refresh queue membership.");
  }

  const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
  const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;
  const activeEventId = liveEvent?.eventId;

  if (!activeEventId) {
    return {
      membersCount: 0,
      refreshedCount: 0,
      refreshedIds: [],
      sourceBreakdown: {},
      total: 0,
    };
  }

  const preclaimsSnapshot = await db
    .collection(`${LIVE_EVENT_PATH}/preclaims`)
    .where("eventId", "==", activeEventId)
    .get();

  if (preclaimsSnapshot.empty) {
    return {
      membersCount: 0,
      refreshedCount: 0,
      refreshedIds: [],
      sourceBreakdown: {},
      total: 0,
    };
  }

  const refreshedIds = [];
  const sourceBreakdown = {};
  const pendingWrites = [];
  let membersCount = 0;

  // Was strictly sequential, so a queue of 200 meant 200 serial Discord round
  // trips and a near-certain timeout. Bounded so Discord is not hammered either.
  const results = await mapWithConcurrency(
    preclaimsSnapshot.docs,
    MEMBERSHIP_REFRESH_CONCURRENCY,
    async (preclaimDoc) => {
      const preclaimData = preclaimDoc.data() || {};
      const membership = await resolveMembershipStatusForDiscordUser({
        currentIsMember: preclaimData.isMember,
        discordUserId: preclaimData.discordUserId,
      });

      return { membership, preclaimDoc };
    },
  );

  results.forEach(({ membership, preclaimDoc }) => {
    const memberEligibleAt = membership.isMember ? getMemberEligibleAtForLiveEvent(liveEvent) : null;

    pendingWrites.push({
      data: {
        isMember: membership.isMember,
        memberEligibleAt,
        updatedAt: Date.now(),
      },
      ref: preclaimDoc.ref,
    });

    refreshedIds.push(preclaimDoc.id);
    sourceBreakdown[membership.source] = (sourceBreakdown[membership.source] ?? 0) + 1;
    if (membership.isMember) {
      membersCount += 1;
    }
  });

  for (let index = 0; index < pendingWrites.length; index += MEMBERSHIP_REFRESH_BATCH_SIZE) {
    const batch = db.batch();

    pendingWrites
      .slice(index, index + MEMBERSHIP_REFRESH_BATCH_SIZE)
      .forEach(({ data, ref }) => {
        batch.set(ref, data, { merge: true });
      });

    await batch.commit();
  }

  return {
    membersCount,
    refreshedCount: refreshedIds.length,
    refreshedIds,
    sourceBreakdown,
    total: preclaimsSnapshot.size,
  };
});

export const removeClaim = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to remove claims.');
  }

  const claimId = request.data?.claimId;
  if (!isValidDocumentId(claimId)) {
    throw new HttpsError('invalid-argument', 'A valid claimId is required.');
  }

  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${claimId}`);
  const liveEventRef = db.doc(LIVE_EVENT_PATH);

  await db.runTransaction(async (tx) => {
    const [claimSnap, liveEventSnapshot] = await Promise.all([
      tx.get(claimRef),
      tx.get(liveEventRef),
    ]);

    if (!claimSnap.exists) {
      throw new HttpsError('not-found', 'Claim not found.');
    }

    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    const currentClaimCount = Number.isFinite(liveEvent?.claimCount) ? liveEvent.claimCount : 0;
    // A staff claim never went into claimCount, so taking one off must not take
    // an attendee off the count with it.
    const wasCounted = !isStaffClaimNumber((claimSnap.data() || {}).number);

    tx.delete(claimRef);
    tx.delete(preclaimRef);
    tx.set(liveEventRef, {
      claimCount: wasCounted ? Math.max(0, currentClaimCount - 1) : currentClaimCount,
      updatedAt: Date.now(),
    }, { merge: true });
  });

  return { removed: true };
});

export const moveClaimBackToQueueAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError("permission-denied", "Not authorized to move claims back to queue.");
  }

  const claimId = request.data?.claimId;
  if (!isValidDocumentId(claimId)) {
    throw new HttpsError("invalid-argument", "A valid claimId is required.");
  }

  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${claimId}`);
  const liveEventRef = db.doc(LIVE_EVENT_PATH);

  await db.runTransaction(async (tx) => {
    const [claimSnapshot, liveEventSnapshot] = await Promise.all([
      tx.get(claimRef),
      tx.get(liveEventRef),
    ]);

    if (!claimSnapshot.exists) {
      throw new HttpsError("not-found", "Claim not found.");
    }

    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;
    if (!liveEvent?.active || isLiveEventStarted(liveEvent)) {
      throw new HttpsError("failed-precondition", "Queue is not currently open.");
    }

    const claimData = claimSnapshot.data() || {};
    const activeEventId = liveEvent.eventId || null;
    if (!activeEventId) {
      throw new HttpsError("failed-precondition", "Event is not active.");
    }

    if (claimData.eventId && claimData.eventId !== activeEventId) {
      throw new HttpsError("failed-precondition", "Claim does not belong to the active event.");
    }

    const isMember = claimData.isMember === true;
    const isStaffMember = claimData.isStaff === true || isStaffClaimNumber(claimData.number);
    const now = Date.now();
    const currentClaimCount = Number.isFinite(liveEvent?.claimCount) ? liveEvent.claimCount : 0;

    tx.set(preclaimRef, {
      // The time they originally joined the queue, not the time staff moved
      // them. The door-open sweep orders by createdAt, so stamping "now" here
      // sent someone staff had corrected to the back of a line they had been
      // waiting in — behind everyone who queued after them. joinQueueAsAttendee
      // preserves the original for the same reason.
      createdAt: getTimestampMs(claimData.joinedAt) ?? now,
      avatarUrl: claimData.avatarUrl || "",
      discordUserId: claimData.discordUserId ?? null,
      displayName: claimData.displayName || "",
      eventId: activeEventId,
      isMember,
      // Carried across so they are handed a staff number again rather than
      // dropping into the attendee queue on the way back.
      isStaff: isStaffMember,
      memberEligibleAt: isMember ? getMemberEligibleAtForLiveEvent(liveEvent, now) : null,
      participantType: claimData.participantType || "",
      // Tells the activity feed this is staff undoing an assignment, not the
      // attendee queueing up again.
      restoredByStaff: true,
      updatedAt: now,
    }, { merge: true });
    tx.delete(claimRef);
    tx.set(liveEventRef, {
      claimCount: isStaffMember ? currentClaimCount : Math.max(0, currentClaimCount - 1),
      updatedAt: now,
    }, { merge: true });
  });

  return { moved: true };
});

export const redeemClaimByQrAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError("permission-denied", "Not authorized to redeem claims.");
  }

  const claimId = request.data?.claimId;
  const eventId = request.data?.eventId;
  const qrToken = request.data?.qrToken;

  if (
    !isValidDocumentId(claimId) ||
    !isValidDocumentId(eventId) ||
    !qrToken || typeof qrToken !== "string"
  ) {
    throw new HttpsError("invalid-argument", "claimId, eventId, and qrToken are required.");
  }

  const liveEventRef = db.doc(LIVE_EVENT_PATH);
  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
  let result = null;

  await db.runTransaction(async (tx) => {
    const [liveEventSnapshot, claimSnapshot] = await Promise.all([
      tx.get(liveEventRef),
      tx.get(claimRef),
    ]);

    if (!liveEventSnapshot.exists) {
      throw new HttpsError("failed-precondition", "The event is not open yet.");
    }

    if (!claimSnapshot.exists) {
      throw new HttpsError("not-found", "This claim could not be found.");
    }

    const liveEvent = liveEventSnapshot.data() || {};
    const claim = claimSnapshot.data() || {};
    const currentRoundRaw = Number.parseInt(liveEvent?.state?.round, 10);
    const currentRound = Number.isFinite(currentRoundRaw) && currentRoundRaw > 0 ? currentRoundRaw : 1;
    const currentNumberRaw = Number.parseInt(liveEvent?.state?.current, 10);
    const currentNumber = Number.isFinite(currentNumberRaw) && currentNumberRaw >= 0 ? currentNumberRaw : 0;
    const claimNumber = toClaimNumber(claim.number) ?? 0;
    const redeemedRoundRaw = Number.parseInt(claim.redeemedRound, 10);
    const redeemedRound =
      Number.isFinite(redeemedRoundRaw) && redeemedRoundRaw >= 0 ? redeemedRoundRaw : 0;

    if (!liveEvent.active || liveEvent.eventId !== eventId) {
      throw new HttpsError("failed-precondition", "This QR code is for a different event.");
    }

    if (claim.eventId !== eventId || claim.qrToken !== qrToken) {
      throw new HttpsError("failed-precondition", "This QR code is no longer valid.");
    }

    /* Final call reaches back for everyone still outstanding, so eligibility
       there is the target list rather than the called number. Today every
       target is already below `current` — final call is only offered once the
       last group is up — but the demo redemption path has always read it this
       way, and two paths that decide the same question differently is how a
       change to that gating turns into an attendee the display is calling
       forward whose code will not scan. */
    const isFinalCallTarget =
      liveEvent?.state?.finalCall === true &&
      (Array.isArray(liveEvent?.state?.finalCallTargetNumbers)
        ? liveEvent.state.finalCallTargetNumbers
        : []
      )
        .map((value) => toClaimNumber(value))
        .includes(claimNumber);

    /* Staff have no place in the queue to wait for. They collect from the
       moment the round is announced — while the display is still showing
       "Round X is starting soon", before the first group is called — and at any
       point after it, so the only gate on them is the round they last picked up
       in, checked below alongside everybody else's. */
    if (isStaffClaimNumber(claimNumber)) {
      if (!liveEvent.active) {
        throw new HttpsError("failed-precondition", "This event is not running.");
      }
    } else if (claimNumber < 1 || (currentNumber < claimNumber && !isFinalCallTarget)) {
      throw new HttpsError("failed-precondition", "This number is not eligible yet.");
    }

    /* "At or past the current round" rather than an equality check, because the
       control panel can now rewind the queue. A pickup already recorded in a
       later round has to keep them out of the group when the rewind brings it
       round again; see hasClaimedInRound in src/backtrack.js, which the client
       reads the same way. Rounds only move forward otherwise, so this is an
       equality check in every other case. */
    if (redeemedRound > 0 && redeemedRound >= currentRound) {
      result = {
        alreadyRedeemed: true,
        displayName: claim.displayName || "",
        number: claimNumber,
        round: currentRound,
      };
      return;
    }

    const existingHistory = Array.isArray(claim.itemClaimedAtMsHistory)
      ? claim.itemClaimedAtMsHistory.filter((value) => Number.isFinite(value))
      : [];
    const nowMs = Date.now();
    const nextItemClaimedAtMsHistory = [...existingHistory, nowMs];
    const currentItemsClaimedCount = Number.parseInt(claim.itemsClaimedCount, 10);
    const nextItemsClaimedCount =
      (Number.isFinite(currentItemsClaimedCount) && currentItemsClaimedCount >= 0
        ? currentItemsClaimedCount
        : 0) + 1;

    tx.set(claimRef, {
      itemClaimedAtMsHistory: nextItemClaimedAtMsHistory,
      itemsClaimedCount: nextItemsClaimedCount,
      redeemedAt: nowMs,
      redeemedRound: currentRound,
      updatedAt: nowMs,
    }, { merge: true });

    result = {
      alreadyRedeemed: false,
      displayName: claim.displayName || "",
      number: claimNumber,
      round: currentRound,
    };
  });

  return result ?? {
    alreadyRedeemed: false,
    displayName: "",
    number: 0,
    round: 1,
  };
});

/**
 * Puts the signed-in attendee into the raffle.
 *
 * Only meaningful while staff have opt-in switched on, which is the setting
 * that makes the Join button appear on an attendee's ticket. The stamp lands on
 * their own claim, so who is actually in the draw is server-recorded and cannot
 * be self-declared by editing a request — the same reason numbers and member
 * status are not taken from the client either.
 *
 * Like every other raffle write, it goes nowhere near the item-claim fields, so
 * joining a raffle cannot move the round progress, the attendee totals, the
 * graphs or the archived metrics.
 */
export const joinRaffleAsAttendee = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const callerUid = request.auth?.uid;

    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Sign in before joining the raffle.");
    }


    const eventId = request.data?.eventId;

    if (!isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid eventId is required.");
    }

    const claimId = buildAttendeeClaimId(eventId, request);
    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
    let result = null;

    await db.runTransaction(async (tx) => {
      const [liveEventSnapshot, claimSnapshot] = await Promise.all([
        tx.get(liveEventRef),
        tx.get(claimRef),
      ]);

      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};

      if (!liveEvent.active || liveEvent.eventId !== eventId) {
        throw new HttpsError("failed-precondition", "This event is no longer running.");
      }

      if (liveEvent?.state?.raffleRequireOptIn !== true) {
        throw new HttpsError("failed-precondition", "This raffle does not need you to join.");
      }

      if (!claimSnapshot.exists) {
        throw new HttpsError("failed-precondition", "You need a number before joining the raffle.");
      }

      const claim = claimSnapshot.data() || {};
      const joinedAtMs = getTimestampMs(claim.raffleJoinedAtMs);

      if (joinedAtMs !== null) {
        result = { alreadyJoined: true, joinedAtMs };
        return;
      }

      const nowMs = Date.now();

      tx.set(claimRef, { raffleJoinedAtMs: nowMs }, { merge: true });

      result = { alreadyJoined: false, joinedAtMs: nowMs };
    });

    return result;
  },
);

/**
 * Confirms a raffle prize at the pickup table.
 *
 * Records exactly one thing — `raffleClaimedAtMs` on the winner's claim — so
 * staff can see at a glance which prizes have actually been collected. That
 * field is deliberately nowhere near the item-claim fields: it never touches
 * `itemsClaimedCount`, `redeemedRound` or `itemClaimedAtMsHistory`, which are
 * what the round progress card, the attendee list totals, the graphs and the
 * archived event metrics are all built from. A raffle cannot move any of them.
 *
 * It is also invisible to the activity feed, which only reacts to the item
 * counters going up.
 *
 * What it checks is that the code belongs to a real winner: the claim has to
 * exist on this event, carry the token encoded in the code, and hold a number
 * the event's own winner list contains. A losing attendee cannot mint one of
 * these by editing their payload, because the winner list is written only by
 * the staff control panel. A winner who is replaced comes off that list, and
 * their code stops working with it.
 */
export const redeemRaffleByQrAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to confirm raffle prizes.");
    }

    const claimId = request.data?.claimId;
    const eventId = request.data?.eventId;
    const qrToken = request.data?.qrToken;

    if (
      !isValidDocumentId(claimId) ||
      !isValidDocumentId(eventId) ||
      !qrToken ||
      typeof qrToken !== "string"
    ) {
      throw new HttpsError("invalid-argument", "claimId, eventId, and qrToken are required.");
    }

    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
    let result = null;

    await db.runTransaction(async (tx) => {
      const [liveEventSnapshot, claimSnapshot] = await Promise.all([
        tx.get(liveEventRef),
        tx.get(claimRef),
      ]);

      if (!liveEventSnapshot.exists) {
        throw new HttpsError("failed-precondition", "The event is not open yet.");
      }

      if (!claimSnapshot.exists) {
        throw new HttpsError("not-found", "This claim could not be found.");
      }

      const liveEvent = liveEventSnapshot.data() || {};
      const claim = claimSnapshot.data() || {};

      if (!liveEvent.active || liveEvent.eventId !== eventId) {
        throw new HttpsError("failed-precondition", "This QR code is for a different event.");
      }

      if (claim.eventId !== eventId || claim.qrToken !== qrToken) {
        throw new HttpsError("failed-precondition", "This QR code is no longer valid.");
      }

      const claimNumber = toClaimNumber(claim.number) ?? 0;
      const winnerNumbers = Array.isArray(liveEvent?.state?.raffleWinnerNumbers)
        ? liveEvent.state.raffleWinnerNumbers
            .map((value) => toClaimNumber(value))
            .filter((value) => value !== null)
        : [];

      if (claimNumber === 0 || !winnerNumbers.includes(claimNumber)) {
        throw new HttpsError("failed-precondition", "This attendee has not won a raffle prize.");
      }

      const claimedAtMs = getTimestampMs(claim.raffleClaimedAtMs);

      if (claimedAtMs !== null) {
        result = {
          alreadyClaimed: true,
          claimedAtMs,
          displayName: claim.displayName || "",
          number: claimNumber,
        };
        return;
      }

      const nowMs = Date.now();

      // Only this field. `updatedAt` is left alone as well, so a prize handover
      // does not even look like activity on the claim.
      tx.set(claimRef, { raffleClaimedAtMs: nowMs }, { merge: true });

      result = {
        alreadyClaimed: false,
        claimedAtMs: nowMs,
        displayName: claim.displayName || "",
        number: claimNumber,
      };
    });

    return result;
  },
);

/* --- demo events ---------------------------------------------------------- */

/** One seed call's worth of participants. Keeps the transaction bounded. */
const DEMO_SEED_BATCH_LIMIT = 25;
const DEMO_PARTICIPANT_TYPE = "demo";
/* The ceiling on participantCount, kept in step by hand with DEMO_LIMITS in
   src/demoEvent.js and validDemoConfig in firestore.rules. Only used here to
   bound the paging loop that admits a queued demo. */
const DEMO_LIMITS_PARTICIPANT_MAX = 300;

/**
 * Asserts the live event is the demo event the caller thinks it is.
 *
 * This is the guard that keeps fake attendees out of a real event: nothing
 * below writes a claim unless the event document itself was created with
 * `isDemo: true`, which only happens on the create form's demo path.
 */
const readDemoLiveEvent = async (eventId, snapshot = null) => {
  const liveEventSnapshot = snapshot ?? (await db.doc(LIVE_EVENT_PATH).get());
  const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

  if (!liveEvent?.active || liveEvent.eventId !== eventId) {
    throw new HttpsError("failed-precondition", "That event is not currently live.");
  }

  if (liveEvent.isDemo !== true) {
    throw new HttpsError("failed-precondition", "This event is not running as a demo.");
  }

  return liveEvent;
};

const sanitizeDemoParticipants = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError("invalid-argument", "participants must be a non-empty array.");
  }

  if (value.length > DEMO_SEED_BATCH_LIMIT) {
    throw new HttpsError(
      "invalid-argument",
      `participants may hold at most ${DEMO_SEED_BATCH_LIMIT} entries per call.`,
    );
  }

  return value.map((participant) => {
    const index = toNonNegativeInteger(participant?.index);

    if (index === null) {
      throw new HttpsError("invalid-argument", "Each participant needs a non-negative index.");
    }

    return {
      displayName: sanitizeDisplayName(participant?.displayName, `Guest ${index + 1}`),
      index,
      isMember: participant?.isMember === true,
      queued: participant?.queued === true,
    };
  });
};

/**
 * Creates fake attendees for a demo event.
 *
 * Keyed by index rather than by anything random, so calling it twice with the
 * same guest list is a no-op for everyone who already exists. That matters
 * because the driver runs in the control panel: two staff tabs on the same demo
 * both drip participants in, and they have to converge on one roster rather
 * than seed two.
 */
export const seedDemoParticipantsAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to seed demo participants.");
    }

    const eventId = request.data?.eventId;

    if (!isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid eventId is required.");
    }

    const participants = sanitizeDemoParticipants(request.data?.participants);
    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    let created = 0;
    let queued = 0;
    let skipped = 0;

    await db.runTransaction(async (tx) => {
      const liveEventSnapshot = await tx.get(liveEventRef);
      const liveEvent = await readDemoLiveEvent(eventId, liveEventSnapshot);
      const hasStarted = isLiveEventStarted(liveEvent);
      const nowMs = Date.now();
      const refs = participants.map((participant) => {
        const docId = `${eventId}__${encodeURIComponent(`demo:${participant.index}`)}`;

        return {
          claimRef: db.doc(`${LIVE_EVENT_PATH}/claims/${docId}`),
          participant,
          preclaimRef: db.doc(`${LIVE_EVENT_PATH}/preclaims/${docId}`),
        };
      });
      const existing = await Promise.all(
        refs.flatMap(({ claimRef, preclaimRef }) => [tx.get(claimRef), tx.get(preclaimRef)]),
      );

      // Reset per attempt: a contended transaction runs this body more than once.
      created = 0;
      queued = 0;
      skipped = 0;

      let nextNumber = toPositiveInteger(liveEvent.nextClaimNumber) ?? 1;

      refs.forEach(({ claimRef, participant, preclaimRef }, position) => {
        const claimSnapshot = existing[position * 2];
        const preclaimSnapshot = existing[position * 2 + 1];

        if (claimSnapshot.exists || preclaimSnapshot.exists) {
          skipped += 1;
          return;
        }

        // Someone meant to queue before the doors opened has missed that window
        // if the event is already under way; they walk in with a number instead.
        if (participant.queued && !hasStarted) {
          tx.set(preclaimRef, {
            avatarUrl: "",
            createdAt: nowMs,
            discordUserId: null,
            displayName: participant.displayName,
            eventId,
            isMember: participant.isMember,
            memberEligibleAt: participant.isMember
              ? getMemberEligibleAtForLiveEvent(liveEvent, nowMs)
              : null,
            participantType: DEMO_PARTICIPANT_TYPE,
            updatedAt: nowMs,
          });
          queued += 1;
          return;
        }

        tx.set(claimRef, {
          avatarUrl: "",
          claimedAt: nowMs,
          joinedAt: nowMs,
          discordUserId: null,
          displayName: participant.displayName,
          eventId,
          isMember: participant.isMember,
          itemClaimedAtMsHistory: [],
          itemsClaimedCount: 0,
          number: nextNumber,
          participantType: DEMO_PARTICIPANT_TYPE,
          qrToken: crypto.randomUUID(),
          redeemedRound: 0,
          updatedAt: nowMs,
        });

        nextNumber += 1;
        created += 1;
      });

      if (created === 0) {
        return;
      }

      tx.update(liveEventRef, {
        claimCount: (toNonNegativeInteger(liveEvent.claimCount) ?? 0) + created,
        nextClaimNumber: nextNumber,
        updatedAt: nowMs,
      });
    });

    return { created, queued, skipped };
  },
);

/**
 * Marks a demo participant as having picked up an item.
 *
 * Deliberately routed through the same transaction shape as a scanned QR code
 * rather than writing the claim directly, so the demo exercises the eligibility
 * and already-redeemed checks that the scanner relies on. The QR token is not
 * required: there is no code to scan, and the caller is staff on a demo event.
 */
export const redeemDemoClaimAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to redeem demo claims.");
    }

    const claimId = request.data?.claimId;
    const eventId = request.data?.eventId;

    if (!isValidDocumentId(claimId) || !isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid claimId and eventId are required.");
    }

    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
    let result = { alreadyRedeemed: false, redeemed: false };

    await db.runTransaction(async (tx) => {
      const [liveEventSnapshot, claimSnapshot] = await Promise.all([
        tx.get(liveEventRef),
        tx.get(claimRef),
      ]);
      const liveEvent = await readDemoLiveEvent(eventId, liveEventSnapshot);

      if (!claimSnapshot.exists) {
        throw new HttpsError("not-found", "This demo participant could not be found.");
      }

      const claim = claimSnapshot.data() || {};

      if (claim.participantType !== DEMO_PARTICIPANT_TYPE) {
        throw new HttpsError("permission-denied", "That claim is not a demo participant.");
      }

      const currentRoundRaw = Number.parseInt(liveEvent?.state?.round, 10);
      const currentRound =
        Number.isFinite(currentRoundRaw) && currentRoundRaw > 0 ? currentRoundRaw : 1;
      const currentNumberRaw = Number.parseInt(liveEvent?.state?.current, 10);
      const currentNumber =
        Number.isFinite(currentNumberRaw) && currentNumberRaw >= 0 ? currentNumberRaw : 0;
      const claimNumber = toPositiveInteger(claim.number) ?? 0;
      const redeemedRound = toNonNegativeInteger(claim.redeemedRound) ?? 0;

      if (claim.eventId !== eventId) {
        throw new HttpsError("failed-precondition", "That claim is for a different event.");
      }

      // Final call reaches back for everyone still outstanding, so eligibility
      // there is the target list rather than the current number. The list holds
      // attendee numbers rather than claim ids, because the event document is
      // world-readable and a claim id carries a Discord user id.
      const isFinalCallTarget =
        liveEvent?.state?.finalCall === true &&
        (liveEvent?.state?.finalCallTargetNumbers ?? [])
          .map((value) => toClaimNumber(value))
          .includes(claimNumber);

      if (claimNumber < 1 || (currentNumber < claimNumber && !isFinalCallTarget)) {
        throw new HttpsError("failed-precondition", "That number has not been called yet.");
      }

      // Same rewind-aware test as redeemClaimByQr above.
      if (redeemedRound > 0 && redeemedRound >= currentRound) {
        result = { alreadyRedeemed: true, redeemed: false, round: currentRound };
        return;
      }

      const existingHistory = Array.isArray(claim.itemClaimedAtMsHistory)
        ? claim.itemClaimedAtMsHistory.filter((value) => Number.isFinite(value))
        : [];
      const nowMs = Date.now();

      tx.set(
        claimRef,
        {
          itemClaimedAtMsHistory: [...existingHistory, nowMs],
          itemsClaimedCount: (toNonNegativeInteger(claim.itemsClaimedCount) ?? 0) + 1,
          redeemedAt: nowMs,
          redeemedRound: currentRound,
          updatedAt: nowMs,
        },
        { merge: true },
      );

      result = { alreadyRedeemed: false, redeemed: true, round: currentRound };
    });

    return result;
  },
);

/**
 * Puts a fake attendee into the raffle.
 *
 * joinRaffleAsAttendee works off the caller's own verified session, which a
 * demo participant does not have — they have no phone and no login. This is the
 * same write reached the same way every other demo behaviour is: staff-gated,
 * refused unless the live event was created as a demo, and refused unless the
 * claim it names is actually one of the fake ones.
 *
 * Like the attendee path it touches exactly one field, nowhere near the
 * item-claim counters the graphs and the archived metrics are built from.
 */
export const joinRaffleAsDemoParticipantAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to join demo participants.");
    }

    const claimId = request.data?.claimId;
    const eventId = request.data?.eventId;

    if (!isValidDocumentId(claimId) || !isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid claimId and eventId are required.");
    }

    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
    let result = { alreadyJoined: false, joined: false };

    await db.runTransaction(async (tx) => {
      const [liveEventSnapshot, claimSnapshot] = await Promise.all([
        tx.get(liveEventRef),
        tx.get(claimRef),
      ]);

      await readDemoLiveEvent(eventId, liveEventSnapshot);

      if (!claimSnapshot.exists) {
        throw new HttpsError("not-found", "This demo participant could not be found.");
      }

      const claim = claimSnapshot.data() || {};

      if (claim.participantType !== DEMO_PARTICIPANT_TYPE) {
        throw new HttpsError("permission-denied", "That claim is not a demo participant.");
      }

      if (claim.eventId !== eventId) {
        throw new HttpsError("failed-precondition", "That claim is for a different event.");
      }

      if (getTimestampMs(claim.raffleJoinedAtMs) !== null) {
        result = { alreadyJoined: true, joined: false };
        return;
      }

      tx.set(claimRef, { raffleJoinedAtMs: Date.now() }, { merge: true });

      result = { alreadyJoined: false, joined: true };
    });

    return result;
  },
);

export const syncDisplayFeedForClaimChanges = onDocumentWritten(
  {
    document: `${LIVE_EVENT_PATH}/claims/{claimId}`,
    ...claimTriggerOptions(),
  },
  async (event) => {
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    if (!afterData) {
      return;
    }

    if (!beforeData) {
      const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

      if (!liveEvent?.active || !isLiveEventStarted(liveEvent)) {
        return;
      }

      if (afterData.eventId && liveEvent.eventId && afterData.eventId !== liveEvent.eventId) {
        return;
      }

      await pushDisplayFeedItem(buildDisplayFeedItem({
        action: `is #${afterData.number}`,
        avatarUrl: afterData.avatarUrl,
        // The claim's own event, falling back to the live one for a claim
        // written before claims carried an eventId.
        eventId: afterData.eventId || liveEvent.eventId,
        id: `assigned-${event.params.claimId}`,
        isMember: afterData.isMember,
        username: afterData.displayName,
      }));
      return;
    }

    const beforeCount = beforeData.itemsClaimedCount ?? 0;
    const afterCount = afterData.itemsClaimedCount ?? 0;
    const beforeRound = beforeData.redeemedRound ?? 0;
    const afterRound = afterData.redeemedRound ?? 0;

    if (afterCount > beforeCount || afterRound > beforeRound) {
      // Keyed by which pickup this is, so two pickups in different rounds are
      // two items but a retry of the same one lands on the same document.
      await pushDisplayFeedItem(buildDisplayFeedItem({
        action: "claimed an item",
        avatarUrl: afterData.avatarUrl,
        eventId: afterData.eventId,
        id: `redeemed-${event.params.claimId}-${afterRound}-${afterCount}`,
        isMember: afterData.isMember,
        username: afterData.displayName,
      }));
    }
  },
);

const ERROR_REPORT_MAX_FIELD_LENGTH = 4000;
// Roughly the six truncated fields plus JSON overhead. Anything larger is not a
// crash report.
const ERROR_REPORT_MAX_BODY_BYTES = 32_000;
/**
 * Origins allowed to POST crash reports.
 *
 * This defaulted to an empty list, which the handler below turned into
 * `cors: true` — an unauthenticated, any-origin, unmetered writer into Cloud
 * Logging, which is a billing-amplification and log-poisoning primitive rather
 * than a diagnostic. It now falls back to the project's own hosting origins, so
 * a missing config value fails closed instead of open.
 */
const ERROR_REPORT_ALLOWED_ORIGINS = (process.env.ERROR_REPORT_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const getDefaultErrorReportOrigins = () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const origins = projectId
    ? [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`]
    : [];

  if (process.env.FUNCTIONS_EMULATOR === "true") {
    origins.push("http://localhost:5173", "http://127.0.0.1:5173");
  }

  return origins;
};

const ERROR_REPORT_ORIGINS = ERROR_REPORT_ALLOWED_ORIGINS.length
  ? ERROR_REPORT_ALLOWED_ORIGINS
  : getDefaultErrorReportOrigins();

const truncate = (value) =>
  typeof value === "string" ? value.slice(0, ERROR_REPORT_MAX_FIELD_LENGTH) : "";

/**
 * Receives client crash reports from the error boundary and writes them to Cloud
 * Logging, where a log-based alert can pick them up.
 *
 * Until now a crash on the projector mid-event was completely silent — it logged
 * to a browser console nobody was looking at. This deliberately stores nothing in
 * Firestore: reports are diagnostic, arrive unauthenticated, and should not be
 * able to grow a collection.
 *
 * Point the client at it with VITE_ERROR_REPORT_URL.
 */
export const reportClientError = onRequest(
  { cors: ERROR_REPORT_ORIGINS, maxInstances: 3 },
  (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    if ((request.rawBody?.length ?? 0) > ERROR_REPORT_MAX_BODY_BYTES) {
      response.status(413).send("Payload Too Large");
      return;
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};

    // Structured so it lands as a queryable Cloud Logging entry rather than text.
    console.error("Client error report", {
      componentStack: truncate(body.componentStack),
      message: truncate(body.message) || "(no message)",
      path: truncate(body.path),
      reportedAtMs: Date.now(),
      stack: truncate(body.stack),
      userAgent: truncate(body.userAgent),
    });

    // No body: the client is mid-crash and ignores the response anyway.
    response.status(204).send("");
  },
);

export const syncDisplayFeedForQueueJoins = onDocumentCreated(
  {
    document: `${LIVE_EVENT_PATH}/preclaims/{preclaimId}`,
    ...claimTriggerOptions(),
  },
  async (event) => {
    const preclaimData = event.data?.data();

    if (!preclaimData) {
      return;
    }

    // Staff moving someone off the roster recreates their queue entry, which
    // looks identical to a fresh join from here. Announcing it made the display
    // tell the room that somebody staff had just removed had queued up.
    if (preclaimData.restoredByStaff === true) {
      return;
    }

    const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

    if (!liveEvent?.active) {
      return;
    }

    if (preclaimData.eventId && liveEvent.eventId && preclaimData.eventId !== liveEvent.eventId) {
      return;
    }

    await pushDisplayFeedItem(buildDisplayFeedItem({
      action: "queued",
      avatarUrl: preclaimData.avatarUrl,
      eventId: preclaimData.eventId || liveEvent.eventId,
      id: `queued-${event.params.preclaimId}`,
      isMember: preclaimData.isMember,
      username: preclaimData.displayName,
    }));
  },
);

/**
 * Queue entries converted per transaction.
 *
 * Each entry costs two writes (the new claim and the delete of the queue entry)
 * and the batch carries one more for the event counter, so 200 lands at 401 —
 * inside Firestore's 500-write ceiling with room to spare. Callers must page;
 * handing this an unbounded snapshot is what previously made a busy event fail
 * to open its doors at all.
 */
const PRECLAIM_ASSIGN_PAGE_SIZE = 200;

/**
 * Turns a page of queue entries into claims, in one transaction.
 *
 * Shared by the scheduler, the event-start path and the schedule-change path so
 * the numbering rule lives in exactly one place.
 */
const assignPreclaimsFromSnapshot = async (snapshot, { fallbackEventId = null } = {}) => {
  if (snapshot.empty) {
    return 0;
  }

  let assignedCount = 0;

  await db.runTransaction(async (tx) => {
    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const claimRefs = snapshot.docs.map((preclaimDoc) =>
      db.doc(`${LIVE_EVENT_PATH}/claims/${preclaimDoc.id}`));

    // Every read has to happen before the first write, so the claim documents
    // are fetched alongside the event rather than checked inline below. The
    // check itself matters: the snapshot was read outside this transaction, so
    // an attendee who claimed in the meantime would otherwise be overwritten
    // with a fresh claim — silently resetting their redemption history and
    // handing them a second pickup.
    const [liveEventSnapshot, ...claimSnapshots] = await tx.getAll(liveEventRef, ...claimRefs);

    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    const targetEventId = liveEvent.eventId || fallbackEventId || null;
    let nextAvailableNumber = toPositiveInteger(liveEvent.nextClaimNumber) ?? 1;
    // Staff are numbered off their own counter, before #1, so a batch that
    // happens to contain one does not push the attendee queue along.
    let nextAvailableStaffNumber = toPositiveInteger(liveEvent.nextStaffNumber) ?? 1;
    let assignedStaffCount = 0;

    // Reset per attempt: a contended transaction runs this body more than once.
    assignedCount = 0;

    snapshot.docs.forEach((preclaimDoc, index) => {
      const preclaimData = preclaimDoc.data() || {};

      if (targetEventId && preclaimData.eventId && preclaimData.eventId !== targetEventId) {
        return;
      }

      if (claimSnapshots[index].exists) {
        // Already holds a number. The queue entry is stale, so clear it rather
        // than leaving it to be re-read on every later pass.
        tx.delete(preclaimDoc.ref);
        return;
      }

      const isStaffEntry = preclaimData.isStaff === true;

      writeClaimFromPreclaim({
        tx,
        claimRef: claimRefs[index],
        eventId: targetEventId,
        number: isStaffEntry ? -nextAvailableStaffNumber : nextAvailableNumber,
        preclaimData,
      });
      tx.delete(preclaimDoc.ref);

      if (isStaffEntry) {
        nextAvailableStaffNumber += 1;
        assignedStaffCount += 1;
      } else {
        nextAvailableNumber += 1;
      }

      assignedCount += 1;
    });

    if (assignedCount === 0) {
      return;
    }

    tx.update(liveEventRef, {
      // Staff are not attendance, so only the attendees in this batch move the
      // count the metrics and the archived events are built from.
      claimCount:
        (toNonNegativeInteger(liveEvent.claimCount) ?? 0) + assignedCount - assignedStaffCount,
      nextClaimNumber: nextAvailableNumber,
      nextStaffNumber: nextAvailableStaffNumber,
      updatedAt: Date.now(),
    });
  });

  return assignedCount;
};

/**
 * Drains a queue query into claims, one bounded page at a time.
 *
 * Pages with a cursor rather than re-querying from the start, because not every
 * entry a page returns gets deleted — one belonging to a different event is
 * skipped and left in place. A restart-from-the-top loop would therefore read
 * that same page forever.
 */
const assignPreclaimsFromQuery = async (baseQuery, { fallbackEventId = null } = {}) => {
  let cursor = null;
  let totalAssigned = 0;

  for (;;) {
    const pageQuery = cursor
      ? baseQuery.startAfter(cursor).limit(PRECLAIM_ASSIGN_PAGE_SIZE)
      : baseQuery.limit(PRECLAIM_ASSIGN_PAGE_SIZE);
    const page = await pageQuery.get();

    if (page.empty) {
      return totalAssigned;
    }

    totalAssigned += await assignPreclaimsFromSnapshot(page, { fallbackEventId });

    if (page.size < PRECLAIM_ASSIGN_PAGE_SIZE) {
      return totalAssigned;
    }

    cursor = page.docs[page.size - 1];
  }
};

/**
 * Turns queued demo participants into claims, the way a real attendee's own
 * browser does when the doors open.
 *
 * Nothing server-side sweeps non-member queue entries at the event start time —
 * each attendee's phone calls assignPreclaimIfQueued for itself. Fake attendees
 * have no phone, so the control panel's demo driver calls this instead.
 */
export const assignQueuedDemoParticipantsAsStaff = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth || request.auth.token.staff !== true) {
      throw new HttpsError("permission-denied", "Not authorized to assign demo participants.");
    }

    const eventId = request.data?.eventId;

    if (!isValidDocumentId(eventId)) {
      throw new HttpsError("invalid-argument", "A valid eventId is required.");
    }

    await readDemoLiveEvent(eventId);

    /*
     * Paged, because a demo can now hold three hundred participants and this
     * used to read exactly one page of two hundred and stop — so a demo where
     * most of the room queued before the doors opened left the remainder stuck
     * in the queue with no phone of their own to get them out of it.
     *
     * Assigned entries are deleted, so re-querying from the start makes
     * progress. The iteration cap is there because an entry belonging to a
     * different event is skipped rather than deleted, and a query that keeps
     * returning one would otherwise never end.
     */
    const maxPages = Math.ceil(DEMO_LIMITS_PARTICIPANT_MAX / PRECLAIM_ASSIGN_PAGE_SIZE) + 1;
    let assigned = 0;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const queuedDemoParticipants = await db
        .collection(`${LIVE_EVENT_PATH}/preclaims`)
        .where("participantType", "==", DEMO_PARTICIPANT_TYPE)
        .limit(PRECLAIM_ASSIGN_PAGE_SIZE)
        .get();

      if (queuedDemoParticipants.empty) {
        break;
      }

      const assignedThisPage = await assignPreclaimsFromSnapshot(queuedDemoParticipants, {
        fallbackEventId: eventId,
      });

      assigned += assignedThisPage;

      if (assignedThisPage === 0) {
        break;
      }
    }

    return { assigned };
  },
);

// Returns the query rather than running it, so callers can page it. The
// composite index this needs is declared in firestore.indexes.json.
const buildEligibleMemberPreclaimsQuery = () =>
  db
    .collection(`${LIVE_EVENT_PATH}/preclaims`)
    .where("isMember", "==", true)
    .where("memberEligibleAt", "<=", Date.now())
    .orderBy("memberEligibleAt");

/**
 * Admits everyone the event start time has made eligible, whoever they are.
 *
 * Members are admitted early, one window at a time, by the indexed query above.
 * Non-members are admitted all at once when the doors open — and until this
 * existed, nothing on the server did that. Their own browser called
 * assignPreclaimIfQueued for them, which meant a queue entry belonged to
 * whichever phone happened to still be awake and foregrounded at the start
 * time. A locked screen, a backgrounded tab or a browser the attendee had
 * closed on the walk over was an attendee who simply never got a number, with
 * nothing on any screen to say so.
 *
 * Ordered by createdAt so the room is numbered in the order it queued, exactly
 * as the doors-opening sweep in onLiveEventUpdated does.
 */
const buildStartedEventPreclaimsQuery = () =>
  db.collection(`${LIVE_EVENT_PATH}/preclaims`).orderBy("createdAt");

export const processMemberPreclaims = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Etc/UTC", timeoutSeconds: 300 },
  async () => {
    // Cheap guard so the quiet 99% of the day costs a single document read
    // rather than an indexed query against the queue.
    const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();

    if (!liveEventSnapshot.exists) {
      return;
    }

    const liveEvent = liveEventSnapshot.data();

    if (liveEvent?.active !== true) {
      return;
    }

    /*
     * Once the event has started there is no early window left to respect, so
     * the whole queue is eligible and the member-only query would leave the
     * rest of it stranded. Before that, only members with a window that has
     * opened.
     *
     * This is deliberately the same paged, transactional path both other
     * callers use: assignPreclaimsFromSnapshot re-reads each claim inside its
     * transaction, so an attendee whose own phone got there first is skipped
     * rather than handed a second number.
     */
    await assignPreclaimsFromQuery(
      isLiveEventStarted(liveEvent)
        ? buildStartedEventPreclaimsQuery()
        : buildEligibleMemberPreclaimsQuery(),
    );
  },
);

/**
 * Keeps the activity feed from piling up over the course of an event.
 *
 * Deliberately on its own schedule rather than inside pushDisplayFeedItem: the
 * feed is written from the claim trigger, which fires once per check-in, and
 * adding a query and a delete there would put work back on the hot path the
 * independent-document design exists to keep clear.
 */
export const trimDisplayFeedOnSchedule = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Etc/UTC" },
  async () => {
    const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();

    if (!liveEventSnapshot.exists || liveEventSnapshot.data()?.active !== true) {
      return;
    }

    const removed = await trimDisplayFeed();

    if (removed > 0) {
      console.info("Trimmed display feed", { removed });
    }
  },
);

/**
 * Files every document under the event it actually belongs to.
 *
 * This used to sweep the whole live collection into the closing event's
 * archive. Because claims were never cleared before archiving existed, closing
 * a brand-new test event hoovered up years of leftovers and filed them all
 * under that event — one close produced an "attendee list" spanning 38 unrelated
 * events. Routing each document by its own eventId keeps the history honest and
 * still empties the live path for the next event.
 */
/**
 * Archives are listed by `closedAt`, so an event that only ever existed as
 * stray documents needs a parent doc or it stays invisible.
 */
const writeStrayArchiveStubs = async (strayEventIds) => {
  if (!strayEventIds.size) {
    return;
  }

  const batch = db.batch();

  strayEventIds.forEach((eventId) => {
    batch.set(
      db.doc(`eventArchives/${eventId}`),
      {
        closedAt: Date.now(),
        eventId,
        recovered: true,
        title: "Recovered event",
      },
      { merge: true },
    );
  });

  await batch.commit();
};

/**
 * Where a document goes when it has no eventId of its own and there is no
 * closing event to inherit one from.
 *
 * Previously the archive write was skipped in that case but the delete still
 * ran, destroying the attendee record with no copy kept. Skipping the delete
 * instead is not an option either — the paging loop re-queries from the start
 * of the collection and only makes progress because documents disappear, so a
 * document that is never deleted would be read forever. A labelled bucket keeps
 * the record, keeps the loop terminating, and shows up in the archive list via
 * the stray stub below.
 */
const UNKNOWN_EVENT_ARCHIVE_ID = "unknown-event";

const archiveCollectionByEventId = async ({ closedEventId, collectionName }) => {
  const sourcePath = `${LIVE_EVENT_PATH}/${collectionName}`;
  const pageSize = ARCHIVE_PAGE_SIZE;
  const counts = { matched: 0, strays: 0 };
  const strayEventIds = new Set();
  // Only claims carry the numbers Past Events reports; preclaims never made it
  // to a number, so they are archived without contributing to the summary.
  const collectsMetrics = collectionName === "claims";
  const metricsByEventId = new Map();

  for (;;) {
    /*
     * Stop if another event has opened underneath the sweep.
     *
     * This pages through the whole live collection — it has to, because the
     * documents it is here to rescue are the ones whose eventId does not match
     * the event being closed. That also means it will happily archive and
     * delete a claim belonging to an event that started while it was running,
     * and the attendee holding that number would simply lose it with nothing on
     * screen to say why.
     *
     * Closing and reopening takes longer than a sweep in practice, so this has
     * probably never fired. It is one document read per page against silently
     * destroying a live attendee's claim.
     */
    const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
    const liveEventNow = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

    if (liveEventNow?.active === true && liveEventNow.eventId !== closedEventId) {
      console.warn("Stopping the archive sweep: a new event is already live.", {
        closedEventId: closedEventId ?? null,
        collectionName,
        liveEventId: liveEventNow.eventId ?? null,
      });
      break;
    }

    const page = await db.collection(sourcePath).limit(pageSize).get();

    if (page.empty) {
      break;
    }

    const batch = db.batch();

    page.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      // Anything without an eventId predates the field; keep it with the event
      // being closed rather than inventing a bucket for it.
      const ownerEventId = typeof data.eventId === "string" && data.eventId
        ? data.eventId
        : closedEventId || UNKNOWN_EVENT_ARCHIVE_ID;

      batch.set(db.doc(`eventArchives/${ownerEventId}/${collectionName}/${docSnapshot.id}`), data);
      batch.delete(docSnapshot.ref);

      if (collectsMetrics) {
        if (!metricsByEventId.has(ownerEventId)) {
          metricsByEventId.set(ownerEventId, createArchiveMetrics());
        }
        addClaimToArchiveMetrics(metricsByEventId.get(ownerEventId), data);
      }

      if (ownerEventId === closedEventId) {
        counts.matched += 1;
      } else {
        counts.strays += 1;
        strayEventIds.add(ownerEventId);
      }
    });

    await batch.commit();
    await writeStrayArchiveStubs(strayEventIds);
    strayEventIds.clear();

    if (page.size < pageSize) {
      break;
    }
  }

  // After the whole sweep, so the totals cover every page rather than the last.
  await writeArchiveMetrics(metricsByEventId);

  return counts;
};

const archiveClosedEvent = async (closedEvent) => {
  const closedEventId = closedEvent?.eventId;

  if (closedEventId) {
    await db.doc(`eventArchives/${closedEventId}`).set(
      {
        closedAt: Date.now(),
        eventId: closedEventId,
        timeframeLabel: closedEvent?.timeframeLabel || "",
        title: closedEvent?.state?.title || "",
      },
      { merge: true },
    );
  }

  const [claims, preclaims] = await Promise.all([
    archiveCollectionByEventId({ closedEventId, collectionName: "claims" }),
    archiveCollectionByEventId({ closedEventId, collectionName: "preclaims" }),
  ]);

  // Stray documents get their own archive entry so they are still reachable.
  console.info("Archived event attendees on close", {
    claims,
    eventId: closedEventId ?? null,
    preclaims,
  });
};

/**
 * Throws a closed demo event away instead of filing it.
 *
 * A demo's attendee list is invented, so archiving it would put fake numbers in
 * Past Events and skew the averages every real event is compared against. The
 * live collections are still emptied, or the next event would open on top of a
 * roster of ghosts.
 *
 * This clears the whole live path, not only the fake documents. Anyone who
 * genuinely checked in to a demo event checked in to a demo event; there is no
 * real attendance here worth keeping.
 */
const discardClosedDemoEvent = async (closedEvent) => {
  const [claims, preclaims] = await Promise.all([
    deleteCollection(`${LIVE_EVENT_PATH}/claims`),
    deleteCollection(`${LIVE_EVENT_PATH}/preclaims`),
  ]);

  console.info("Discarded demo event attendees on close", {
    claims,
    eventId: closedEvent?.eventId ?? null,
    preclaims,
  });
};

// Fields that move the member early-access window. Nothing else about an event
// update can change who is eligible to be assigned a number.
const MEMBER_WINDOW_FIELDS = [
  "eventStartAtMs",
  "memberEarlyAccessAtMs",
  "timeframeEnd",
  "timeframeStart",
];

/**
 * The single handler for changes to the live event document.
 *
 * There were four separate `onDocumentUpdated` triggers on this path, so every
 * write — including the counter bump from each attendee joining — invoked all
 * of them. One of those then read the entire claims collection inside a
 * transaction, which made joining the event quadratic in the number of
 * attendees. Now there is one handler, and the expensive branches only run when
 * something relevant actually changed.
 */
export const onLiveEventUpdated = onDocumentUpdated(
  {
    document: LIVE_EVENT_PATH,
    /*
     * Nine minutes, not the default one.
     *
     * Closing an event runs the whole archive sweep from inside this handler:
     * both live collections paged two hundred documents at a time, a batch of
     * four hundred writes each, then a transaction per event id for the
     * summary. Three hundred attendees finish comfortably, but a close that
     * also has to rescue leftovers from a previous close that failed part way
     * does not — and a timeout mid-sweep leaves the live collections half
     * cleared, which is the state the next event would open on top of.
     */
    timeoutSeconds: 540,
    /*
     * Its own ceiling rather than the global ten.
     *
     * This fires on every write to the event document, which means once per
     * walk-up check-in — three hundred invocations in a burst, almost all of
     * them no-ops. Sharing a ten-instance pool with the archive sweep meant a
     * check-in rush could queue behind, or crowd out, the longest-running
     * function in the project. The early return below keeps the no-ops cheap;
     * this keeps them from being the only thing the pool is doing.
     */
    maxInstances: 20,
  },
  async (event) => {
  const beforeData = event.data.before.exists ? event.data.before.data() : null;
  const afterData = event.data.after.exists ? event.data.after.data() : null;

  if (!afterData) {
    return;
  }

  const didActivate = beforeData?.active !== true && afterData.active === true;
  const didClose = beforeData?.active === true && afterData.active !== true;
  const didChangeEvent = beforeData?.eventId !== afterData.eventId;
  const didMemberWindowMove =
    MEMBER_WINDOW_FIELDS.some((field) => beforeData?.[field] !== afterData[field]) ||
    beforeData?.state?.memberCheckInLeadMinutes !== afterData.state?.memberCheckInLeadMinutes;

  /*
   * The overwhelmingly common write to this document is a counter bump from
   * somebody checking in, and there is nothing here for one of those to do.
   *
   * Computed up front and returned on before any I/O, because the alternative is
   * three hundred invocations that each fall through the whole body to reach the
   * same conclusion. Every expensive branch below is gated on one of these four
   * flags, so this is the same decision made earlier rather than a new one.
   */
  if (!didActivate && !didClose && !didChangeEvent && !didMemberWindowMove) {
    return;
  }

  if (didClose) {
    if (beforeData?.isDemo === true) {
      await discardClosedDemoEvent(beforeData);
    } else {
      await archiveClosedEvent(beforeData);
    }
  }

  if (didClose || didChangeEvent) {
    await clearDisplayFeed();
  }

  if (didClose) {
    return;
  }

  if (didActivate) {
    // Doors opening: everyone waiting gets a number, in the order they queued.
    // Drained in pages — this used to read the whole queue and convert it in a
    // single transaction, which blew past the 500-write cap once around 250
    // people were waiting and left nobody with a number at all.
    await assignPreclaimsFromQuery(
      db.collection(`${LIVE_EVENT_PATH}/preclaims`).orderBy("createdAt"),
      { fallbackEventId: afterData.eventId },
    );
    return;
  }

  /* Only the member window is left: the guard at the top has already returned
     for anything that is none of the four cases. */
  if (!didMemberWindowMove) {
    return;
  }

  await assignPreclaimsFromQuery(buildEligibleMemberPreclaimsQuery());
  },
);
