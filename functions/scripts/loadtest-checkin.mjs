/**
 * Measures what a room's worth of simultaneous check-ins does to the one
 * document every check-in has to write.
 *
 * `events/live-number-caller` carries the claim counters, so claimNumberAsAttendee
 * allocates a number inside a transaction against it. Firestore's sustained
 * ceiling is about one write per second per document; three hundred people
 * arriving inside a minute is several times that, and contended transactions
 * retry and eventually come back ABORTED. The client treats that as transient and
 * backs off, so the failure mode is a slow door rather than a broken one — but
 * nobody had ever measured where it starts.
 *
 * This reports three things:
 *
 *   1. latency percentiles for the callable,
 *   2. how many calls failed, by error code,
 *   3. whether the numbers actually came out right — every attendee holding a
 *      distinct number, and the counter landing exactly where it should. That is
 *      the assertion that matters: a slow check-in is a bad evening, but two
 *      people holding #47 is a broken one.
 *
 * Against the emulator (no setup, but the emulator does not reproduce real lock
 * contention — treat the numbers as a correctness smoke test only):
 *
 *   npm run emulators                       # in one terminal
 *   npm run loadtest                        # in another
 *
 * Against a real project, which is the only place the numbers mean anything:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=sa.json \
 *   node functions/scripts/loadtest-checkin.mjs \
 *     --project my-staging-project --api-key <web api key> --attendees 300 --window 60
 *
 * It creates a live event, checks in N fake attendees, and closes the event
 * again. Do not point it at the project running a real event: see PRODUCTION_
 * PROJECT_ID below, which it refuses outright.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/*
 * The project this app actually runs events on. Refused unconditionally: this
 * script writes three hundred fake claims and then closes the event, which
 * during a real one would clear the room's numbers and archive the lot.
 */
const PRODUCTION_PROJECT_ID = "boiler-book-club-number-caller";

const LIVE_EVENT_PATH = "events/live-number-caller";
const CLAIM_ACCESS_PATH = `${LIVE_EVENT_PATH}/private/claim-access`;
const CLAIM_ACCESS_ROTATION_MS = 60_000;
const REGION = "us-central1";

const parseArgs = () => {
  const args = new Map();

  for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index];
    if (token.startsWith("--")) {
      const next = process.argv[index + 1];
      args.set(token.slice(2), next && !next.startsWith("--") ? next : "true");
    }
  }

  return args;
};

const args = parseArgs();
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId =
  args.get("project") || process.env.GCLOUD_PROJECT || (useEmulator ? "demo-number-caller" : "");
const attendeeCount = Number.parseInt(args.get("attendees") ?? "300", 10);
/* Seconds the arrivals are spread over. 60 is a busy door; 15 is the worst case
   — a queue that was already outside when it opened. */
const windowSeconds = Number.parseInt(args.get("window") ?? "60", 10);
const apiKey = args.get("api-key") || (useEmulator ? "fake-api-key" : "");

if (!projectId) {
  console.error("A --project is required (or set GCLOUD_PROJECT).");
  process.exit(1);
}

if (projectId === PRODUCTION_PROJECT_ID) {
  console.error(
    `Refusing to run against ${PRODUCTION_PROJECT_ID}.\n` +
      "This creates fake attendees and closes the event when it is done. Point it at " +
      "a staging project, or at the emulator suite.",
  );
  process.exit(1);
}

if (!apiKey) {
  console.error(
    "An --api-key is required against a real project: it is the Web API key from " +
      "Firebase console -> Project settings, used to trade each custom token for an ID token.",
  );
  process.exit(1);
}

if (!Number.isFinite(attendeeCount) || attendeeCount < 1) {
  console.error("--attendees must be a positive integer.");
  process.exit(1);
}

// Must stay byte-for-byte equivalent to hashClaimAccessValue in functions/index.js
// and src/claimAccess.js — this is the code the display shows and the callable checks.
const hashClaimAccessValue = (value) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 8);
};

const buildClaimAccessCode = (secret, timestamp = Date.now()) =>
  hashClaimAccessValue(`${secret}:${Math.floor(timestamp / CLAIM_ACCESS_ROTATION_MS)}`);

const identityToolkitOrigin = process.env.FIREBASE_AUTH_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
  : "https://identitytoolkit.googleapis.com";

const callableOrigin = process.env.FUNCTIONS_EMULATOR_HOST
  ? `http://${process.env.FUNCTIONS_EMULATOR_HOST}/${projectId}/${REGION}`
  : useEmulator
    ? `http://127.0.0.1:5001/${projectId}/${REGION}`
    : `https://${REGION}-${projectId}.cloudfunctions.net`;

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const percentile = (sortedValues, fraction) => {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length));
  return sortedValues[index];
};

/** Trades a custom token for an ID token, which is what a callable expects. */
const signIn = async (customToken) => {
  const response = await fetch(
    `${identityToolkitOrigin}/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );

  if (!response.ok) {
    throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()).idToken;
};

const callCheckIn = async ({ idToken, claimAccessCode, eventId, displayName }) => {
  const response = await fetch(`${callableOrigin}/claimNumberAsAttendee`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      data: { avatarUrl: "", claimAccessCode, displayName, eventId },
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = payload?.error || {};
    throw Object.assign(new Error(error.message || `HTTP ${response.status}`), {
      code: error.status || `http-${response.status}`,
    });
  }

  return payload.result;
};

const main = async () => {
  const eventId = `loadtest-${Date.now()}`;
  const secret = `loadtest-secret-${Math.random().toString(36).slice(2)}`;

  console.log(
    `Load test: ${attendeeCount} attendees over ${windowSeconds}s against ${projectId} ` +
      `(${useEmulator ? "emulator" : "real project"})`,
  );

  // A live event that started in the past, so no early-access window applies and
  // every caller takes the walk-up path this is here to measure.
  const startedAtMs = Date.now() - 60_000;
  await db.doc(LIVE_EVENT_PATH).set({
    active: true,
    claimCount: 0,
    eventEndAtMs: startedAtMs + 7_200_000,
    eventId,
    eventStartAtMs: startedAtMs,
    memberEarlyAccessAtMs: startedAtMs,
    nextClaimNumber: 1,
    nextStaffNumber: 1,
    startedAt: new Date(startedAtMs),
    stateVersion: 1,
    timeframeEnd: "21:00",
    timeframeLabel: "load test",
    timeframeStart: "19:00",
    updatedAt: Date.now(),
    state: {
      title: "LOAD TEST",
      titleFont: "londrina-shadow",
      claimRulesText: "",
      qrUrl: "https://example.invalid/",
      displayFeedEnabled: false,
      autoAdvanceEnabled: false,
      autoAdvanceBacklogLimitEnabled: false,
      autoAdvanceBacklogClearedPercent: 50,
      autoAdvanceFinalCallTimerEnabled: false,
      autoAdvanceFinalCallTimerMinutes: 5,
      autoAdvanceGroupTimerEnabled: false,
      autoAdvanceGroupTimerMinutes: 5,
      autoAdvanceNextGroup: true,
      autoAdvanceStartRound: false,
      autoAdvanceStartRoundMinutes: 5,
      autoAdvanceThresholdPercent: 80,
      groupSize: 10,
      memberCheckInLeadMinutes: 15,
      current: 0,
      groupStartedAt: null,
      roundStartedAt: null,
      last: 0,
      round: 1,
      finalCall: false,
      finalCallTargetNumbers: [],
    },
  });
  await db.doc(CLAIM_ACCESS_PATH).set({ secret, updatedAt: Date.now() });

  console.log("Minting sessions...");
  const sessions = [];
  const mintConcurrency = 20;
  let mintIndex = 0;

  await Promise.all(
    Array.from({ length: mintConcurrency }, async () => {
      for (;;) {
        const index = mintIndex;
        mintIndex += 1;
        if (index >= attendeeCount) return;

        const uid = `loadtest-${index}`;
        const customToken = await auth.createCustomToken(uid, {
          claimsMintedAt: Date.now(),
          member: false,
          staff: false,
        });
        sessions[index] = { idToken: await signIn(customToken), index, uid };
      }
    }),
  );

  /*
   * One measured wave of arrivals.
   *
   * Run twice. The first is the real thing: nobody has a claim, so every call
   * allocates a number in a transaction against the event document. The second
   * is the same people asking again, which is what a page reload, a client retry
   * from src/claimRetry.js, or simply reopening a ticket does — and there are
   * far more of those during an evening than there are genuine check-ins. That
   * path takes a fast path in claimNumberAsAttendee that never touches the event
   * document, so the two waves together show what the contended path costs.
   */
  const runWave = async (label, waveSessions = sessions) => {
    console.log(`${label}: ${waveSessions.length} calls over ${windowSeconds}s...`);

    const latencies = [];
    const errorsByCode = new Map();
    const numbersByUid = new Map();
    const spreadMs = windowSeconds * 1000;
    const startedAt = Date.now();

    await Promise.all(
      waveSessions.map(async (session) => {
        // Arrivals spread evenly across the window, jittered, so they do not all
        // land on the same millisecond in lockstep.
        await sleep(Math.random() * spreadMs);

        const callStartedAt = Date.now();
        try {
          const result = await callCheckIn({
            claimAccessCode: buildClaimAccessCode(secret),
            displayName: `Load Test ${session.index}`,
            eventId,
            idToken: session.idToken,
          });
          latencies.push(Date.now() - callStartedAt);
          numbersByUid.set(session.uid, result?.number);
        } catch (error) {
          latencies.push(Date.now() - callStartedAt);
          const code = error.code || "unknown";
          errorsByCode.set(code, (errorsByCode.get(code) ?? 0) + 1);
        }
      }),
    );

    latencies.sort((left, right) => left - right);

    return {
      attempted: waveSessions.length,
      elapsedSeconds: (Date.now() - startedAt) / 1000,
      errorsByCode,
      latencies,
      numbersByUid,
    };
  };

  const reportWave = (label, wave) => {
    const succeededInWave = wave.numbersByUid.size;
    console.log(`\n--- ${label} ${"-".repeat(Math.max(0, 50 - label.length))}`);
    console.log(`elapsed                ${wave.elapsedSeconds.toFixed(1)}s`);
    console.log(`succeeded / attempted  ${succeededInWave} / ${wave.attempted}`);
    console.log(`latency p50            ${percentile(wave.latencies, 0.5)}ms`);
    console.log(`latency p95            ${percentile(wave.latencies, 0.95)}ms`);
    console.log(`latency p99            ${percentile(wave.latencies, 0.99)}ms`);
    console.log(`latency max            ${wave.latencies[wave.latencies.length - 1] ?? 0}ms`);

    if (succeededInWave < wave.attempted) {
      console.log(`failures               ${wave.attempted - succeededInWave}`);
      for (const [code, count] of [...wave.errorsByCode].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${code.padEnd(20)} ${count}`);
      }
    } else {
      console.log("failures               none");
    }
  };

  const firstWave = await runWave("Wave 1 (new check-ins, allocates a number)");
  /* Only the people who actually came away with a number. Replaying somebody
     whose first call failed would send them down the allocating path again and
     mix the two measurements together, which is what made the first version of
     this wave say nothing useful. */
  const repeatSessions = sessions.filter((session) => firstWave.numbersByUid.has(session.uid));
  const secondWave = await runWave("Wave 2 (repeat calls, fast path)", repeatSessions);

  const { elapsedSeconds, errorsByCode, latencies, numbersByUid } = firstWave;

  const liveEvent = (await db.doc(LIVE_EVENT_PATH).get()).data() ?? {};
  const succeeded = numbersByUid.size;

  /*
   * Read back what was actually written, rather than trusting what the callers
   * heard.
   *
   * Under contention a transaction can commit and the caller still get an error
   * — the lock timeout lands on the way back, or on a retry of a call that had
   * already succeeded. Those attendees hold a perfectly good number they were
   * never told about; their own claim subscription is what delivers it. So the
   * count of successful *responses* is not the count of claims, and asserting
   * that they match reports a healthy event as a broken one.
   *
   * The invariants that do matter are all here: no two attendees holding the
   * same number, the attendance counter matching the roster, and the allocator
   * never handing out a number it has already given away.
   */
  const claimsSnapshot = await db.collection(`${LIVE_EVENT_PATH}/claims`).get();
  const claimsForThisEvent = claimsSnapshot.docs
    .map((claimDoc) => claimDoc.data())
    .filter((claim) => claim.eventId === eventId);
  const issuedNumbers = claimsForThisEvent
    .map((claim) => claim.number)
    .filter((number) => Number.isInteger(number) && number > 0);
  const distinctNumbers = new Set(issuedNumbers);
  const highestNumber = issuedNumbers.reduce((highest, n) => Math.max(highest, n), 0);

  reportWave("wave 1: new check-ins (writes the event document)", firstWave);
  reportWave("wave 2: repeat calls (fast path, no event write)", secondWave);
  console.log(
    `\nwave 1 write rate      ${(succeeded / Math.max(elapsedSeconds, 1)).toFixed(1)}/s to the event document`,
  );

  // The part that is pass/fail rather than informational.
  console.log("\n--- correctness -----------------------------------------");
  const duplicates = issuedNumbers.length - distinctNumbers.size;

  console.log(`claims written         ${claimsForThisEvent.length}`);
  console.log(`callers told           ${succeeded}`);
  if (claimsForThisEvent.length > succeeded) {
    console.log(
      `  (${claimsForThisEvent.length - succeeded} committed but the caller timed out before ` +
        "hearing back; their claim subscription delivers it)",
    );
  }
  console.log(`distinct numbers       ${distinctNumbers.size} of ${issuedNumbers.length}`);
  console.log(`highest number         ${highestNumber}`);
  console.log(`nextClaimNumber        ${liveEvent.nextClaimNumber} (must be > ${highestNumber})`);
  console.log(
    `claimCount             ${liveEvent.claimCount} (expected ${claimsForThisEvent.length})`,
  );

  const problems = [];
  if (duplicates > 0) problems.push(`${duplicates} duplicate number(s) issued`);
  if (!(liveEvent.nextClaimNumber > highestNumber)) {
    problems.push("the allocator could re-issue a number it has already handed out");
  }
  if (liveEvent.claimCount !== claimsForThisEvent.length) {
    problems.push(
      `claimCount is ${liveEvent.claimCount} but ${claimsForThisEvent.length} claims exist`,
    );
  }

  console.log("\nCleaning up...");
  await db.doc(LIVE_EVENT_PATH).set(
    { active: false, endedAt: new Date(), eventId: null, updatedAt: Date.now() },
    { merge: true },
  );

  if (problems.length) {
    console.error(`\nFAIL: ${problems.join("; ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    "\nPASS: no number was issued twice, the counter cannot re-issue one, and " +
      "claimCount matches the roster.",
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
