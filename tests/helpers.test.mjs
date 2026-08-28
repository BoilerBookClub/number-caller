// Unit tests for the pure helpers. No emulator, no browser.
//
// Run with:  npm run test:unit

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClaimAccessCode,
  CLAIM_ACCESS_ROTATION_MS,
  createClaimAccessSecret,
} from "../src/claimAccess.js";
import {
  buildClaimQrPayload,
  buildRaffleQrPayload,
  parseClaimQrPayload,
  parseRaffleQrPayload,
} from "../src/claimQr.js";
import {
  buildRaffleSegmentLabel,
  buildRaffleSegments,
  getRaffleEligibleClaims,
  getRaffleEntryWeight,
  getRaffleLandingFraction,
  getRaffleNextRotation,
  getRaffleSpinPhase,
  getRaffleSpinTiming,
  getRaffleWinnerRotation,
  normalizeRaffleMemberChances,
  normalizeRaffleWinnerNumbers,
  pickRaffleWinner,
  RAFFLE_LANDING_SPREAD,
  RAFFLE_LEAD_IN_MS,
  RAFFLE_MEMBER_CHANCES_MAX,
  RAFFLE_MAX_WINNERS,
  RAFFLE_PHASE,
  RAFFLE_POINTER_ANGLE,
  RAFFLE_REVEAL_AFTER_MS,
  RAFFLE_SPIN_DURATION_MS,
  RAFFLE_SPIN_TURNS,
} from "../src/raffle.js";
import {
  DEFAULT_CLAIM_RULES_TEXT,
  normalizeClaimRulesText,
  parseClaimRulesList,
} from "../src/claimRules.js";
import {
  DEFAULT_TITLE_FONT,
  getEventTitleClassName,
  normalizeTitleFont,
  TITLE_FONT_OPTIONS,
} from "../src/titleFonts.js";
import {
  DEMO_LIMITS,
  DEMO_SEED_BATCH_SIZE,
  getDemoJoinDelayMs,
  getDemoPickupChancePercent,
  getDemoPickupDelayMs,
  getDemoRaffleCollectDelayMs,
  getDemoRaffleJoinDelayMs,
  initialDemoConfig,
  normalizeDemoConfig,
  planDemoParticipants,
  shouldDemoParticipantJoinRaffle,
  shouldDemoParticipantPickUp,
  shouldDemoWinnerCollectPrize,
  splitIntoBatches,
} from "../src/demoEvent.js";
import {
  CLAIM_RETRY_MAX_DELAY_MS,
  createClaimRetryState,
  getClaimRetryDelayMs,
  isTransientClaimError,
  MAX_CLAIM_ATTEMPTS,
  nextClaimRetryState,
  shouldRetryClaim,
} from "../src/claimRetry.js";
import { BACKTRACK_STEP, getBacktrackStep, hasClaimedInRound } from "../src/backtrack.js";
import { planAuthStep } from "../src/authStep.js";
import {
  formatClaimNumber,
  isStaffClaim,
  partitionStaffClaims,
  projectQueueNumbers,
} from "../src/staffNumbers.js";
import { createCodeChallenge, createCodeVerifier } from "../src/pkce.js";
import {
  getStaffWalkthroughPages,
  hasSeenStaffWalkthrough,
  markEventCreatedHere,
  markStaffWalkthroughSeen,
  resolveStaffWalkthroughRole,
  STAFF_WALKTHROUGH_ROLE,
} from "../src/staffWalkthrough.js";
import { clearPerEventKeysExcept } from "../src/claimSession.js";
import {
  applyStateChanges,
  getStateChanges,
  hasUnchangedStateFields,
  initialState,
  normalizeState,
} from "../src/eventState.js";

// --- claimAccess -------------------------------------------------------------

test("claim access codes are stable within a rotation bucket", () => {
  const secret = "secret-value";
  const base = 1_700_000_000_000;

  assert.equal(buildClaimAccessCode(secret, base), buildClaimAccessCode(secret, base + 999));
});

test("claim access codes change between rotation buckets", () => {
  const secret = "secret-value";
  const base = 1_700_000_000_000;

  assert.notEqual(
    buildClaimAccessCode(secret, base),
    buildClaimAccessCode(secret, base + CLAIM_ACCESS_ROTATION_MS),
  );
});

test("claim access codes differ per secret", () => {
  const timestamp = 1_700_000_000_000;

  assert.notEqual(
    buildClaimAccessCode("secret-a", timestamp),
    buildClaimAccessCode("secret-b", timestamp),
  );
});

test("an empty secret yields no code, so it can never accidentally validate", () => {
  assert.equal(buildClaimAccessCode("", Date.now()), "");
  assert.equal(buildClaimAccessCode(null, Date.now()), "");
});

test("claim access codes are non-empty and URL-safe", () => {
  const code = buildClaimAccessCode(createClaimAccessSecret(), Date.now());

  assert.match(code, /^[0-9a-z]{1,8}$/);
});

test("generated secrets are unique", () => {
  const secrets = new Set(Array.from({ length: 500 }, () => createClaimAccessSecret()));

  assert.equal(secrets.size, 500);
});

// --- claimQr -----------------------------------------------------------------

test("a claim QR payload round-trips", () => {
  const input = { claimId: "event__discord%3A1", eventId: "event", qrToken: "token-value" };

  assert.deepEqual(parseClaimQrPayload(buildClaimQrPayload(input)), input);
});

test("QR payloads from other sources are rejected", () => {
  for (const value of [
    "",
    "   ",
    "not a payload",
    null,
    undefined,
    42,
    // The JSON shape this replaced. A ticket left open across the deploy has to
    // be refused rather than mis-parsed.
    JSON.stringify({ kind: "number-caller-claim", claimId: "a", eventId: "b", qrToken: "c" }),
    "1|c|event__k",                  // too few fields
    "1|c|event__k|token|extra",      // too many
    "2|c|event__k|token",            // a version this build does not speak
    "1|x|event__k|token",            // an unknown kind
    "1|c||token",                    // empty claimId
    "1|c|event__k|",                 // empty qrToken
    "1|c|noseam|token",              // a claim id with no event id in it
    "1|c|__k|token",                 // an empty event id before the seam
    "1|c|ev/other__k|token"
  ]) {
    assert.equal(parseClaimQrPayload(value), null, `expected null for ${String(value)}`);
  }
});

test("the claim payload stays short enough for the code to scan", () => {
  // A real claim: a uuid event id, a percent-encoded Discord participant key,
  // and a uuid token. See tests/claimQr.test.mjs for the error-correction
  // arithmetic this length feeds; this is the cheap guard that catches a field
  // being added without anyone re-running that.
  const eventId = "3f6a1c88-4b2e-4d51-9a7c-1e2f3a4b5c6d";
  const payload = buildClaimQrPayload({
    claimId: `${eventId}__${encodeURIComponent("discord:123456789012345678")}`,
    eventId,
    qrToken: "9c1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6",
  });

  assert.ok(payload.length <= 128, `claim payload grew to ${payload.length} bytes`);
});

// --- claimRules --------------------------------------------------------------

test("blank claim rules fall back to the defaults", () => {
  assert.equal(normalizeClaimRulesText(""), DEFAULT_CLAIM_RULES_TEXT);
  assert.equal(normalizeClaimRulesText("   "), DEFAULT_CLAIM_RULES_TEXT);
  assert.equal(normalizeClaimRulesText(null), DEFAULT_CLAIM_RULES_TEXT);
});

test("claim rules are capped at the length the security rules allow", () => {
  assert.ok(normalizeClaimRulesText("x".repeat(9000)).length <= 6000);
});

test("claim rules normalise CRLF so line counts match what staff typed", () => {
  assert.equal(normalizeClaimRulesText("one\r\ntwo"), "one\ntwo");
});

test("claim rules parse into a list, stripping manual numbering and bullets", () => {
  assert.deepEqual(parseClaimRulesList("1. First\n2) Second\n- Third\n* Fourth"), [
    "First",
    "Second",
    "Third",
    "Fourth",
  ]);
});

test("claim rules drop blank lines", () => {
  assert.deepEqual(parseClaimRulesList("First\n\n   \nSecond"), ["First", "Second"]);
});

test("rules that are only formatting characters fall back to the defaults", () => {
  assert.ok(parseClaimRulesList("- \n1. ").length > 0);
});

// --- titleFonts --------------------------------------------------------------

test("unknown title fonts fall back to the default", () => {
  assert.equal(normalizeTitleFont("comic-sans"), DEFAULT_TITLE_FONT);
  assert.equal(normalizeTitleFont(undefined), DEFAULT_TITLE_FONT);
});

test("every offered title font is accepted", () => {
  TITLE_FONT_OPTIONS.forEach((option) => {
    assert.equal(normalizeTitleFont(option.value), option.value);
  });
});

test("the default title font is one of the offered options", () => {
  assert.ok(TITLE_FONT_OPTIONS.some((option) => option.value === DEFAULT_TITLE_FONT));
});

test("title class names include the resolved font", () => {
  assert.equal(
    getEventTitleClassName("monoton", "carnival"),
    "event-title event-title--monoton carnival",
  );
  assert.equal(
    getEventTitleClassName("nope"),
    `event-title event-title--${DEFAULT_TITLE_FONT}`,
  );
});

// --- demoEvent ---------------------------------------------------------------

test("demo settings outside their range are clamped, not rejected", () => {
  assert.deepEqual(
    normalizeDemoConfig({
      memberPercent: 400,
      participantCount: -5,
      pickupChancePercent: -1,
      preStartPercent: 101,
    }),
    { memberPercent: 100, participantCount: 1, pickupChancePercent: 0, preStartPercent: 100 },
  );
});

test("unreadable demo settings fall back to the defaults", () => {
  assert.deepEqual(normalizeDemoConfig(undefined), initialDemoConfig);
  assert.deepEqual(normalizeDemoConfig({ participantCount: "lots" }), initialDemoConfig);
});

test("a demo guest list is the size that was asked for", () => {
  const plan = planDemoParticipants({
    config: { ...initialDemoConfig, participantCount: 37 },
    eventId: "event-a",
  });

  assert.equal(plan.length, 37);
});

test("demo names are distinct, so no two fake attendees share a handle", () => {
  const plan = planDemoParticipants({
    config: { ...initialDemoConfig, participantCount: 120 },
    eventId: "event-a",
  });
  const names = new Set(plan.map((participant) => participant.displayName));

  assert.equal(names.size, plan.length);
});

test("demo names are two words joined, so they never read as a real attendee", () => {
  const plan = planDemoParticipants({ config: initialDemoConfig, eventId: "event-a" });

  plan.forEach(({ displayName }) => {
    assert.match(displayName, /^[A-Z][a-z]+[A-Z][a-z]+$/);
  });
});

test("the member and early-join shares are exact counts, not per-person coin flips", () => {
  const plan = planDemoParticipants({
    config: {
      memberPercent: 25,
      participantCount: 40,
      pickupChancePercent: 80,
      preStartPercent: 75,
    },
    eventId: "event-a",
  });

  assert.equal(plan.filter((participant) => participant.isMember).length, 10);
  assert.equal(plan.filter((participant) => participant.queued).length, 30);
});

test("member and early-join draws are independent of each other", () => {
  const plan = planDemoParticipants({
    config: {
      memberPercent: 50,
      participantCount: 40,
      pickupChancePercent: 80,
      preStartPercent: 50,
    },
    eventId: "event-a",
  });
  const members = plan.filter((participant) => participant.isMember);

  // If one draw drove the other, every member would land on the same side.
  const queuedMembers = members.filter((participant) => participant.queued).length;
  assert.ok(queuedMembers > 0 && queuedMembers < members.length);
});

test("the same event always plans the same people, so two control panels agree", () => {
  const build = () => planDemoParticipants({ config: initialDemoConfig, eventId: "event-a" });

  assert.deepEqual(build(), build());
});

test("different events plan different people", () => {
  const left = planDemoParticipants({ config: initialDemoConfig, eventId: "event-a" });
  const right = planDemoParticipants({ config: initialDemoConfig, eventId: "event-b" });

  assert.notDeepEqual(
    left.map((participant) => participant.displayName),
    right.map((participant) => participant.displayName),
  );
});

test("seed batches never exceed what the callable accepts", () => {
  const batches = splitIntoBatches(Array.from({ length: 120 }, (_, index) => index));

  assert.ok(batches.every((batch) => batch.length <= DEMO_SEED_BATCH_SIZE));
  assert.equal(batches.flat().length, 120);
});

test("final call gives the stragglers a better chance without making it certain", () => {
  assert.equal(getDemoPickupChancePercent({ isFinalCall: false, pickupChancePercent: 80 }), 80);
  assert.equal(getDemoPickupChancePercent({ isFinalCall: true, pickupChancePercent: 80 }), 90);
  // Nobody picking up in a normal round still means nobody is guaranteed to.
  assert.ok(getDemoPickupChancePercent({ isFinalCall: true, pickupChancePercent: 0 }) < 100);
});

test("a pickup rate of zero means nobody ever takes an item", () => {
  for (const randomValue of [0, 0.5, 0.999]) {
    assert.equal(
      shouldDemoParticipantPickUp({
        isFinalCall: false,
        pickupChancePercent: 0,
        randomValue,
      }),
      false,
    );
  }
});

test("a pickup rate of 100 means everybody does", () => {
  for (const randomValue of [0, 0.5, 0.999]) {
    assert.equal(
      shouldDemoParticipantPickUp({
        isFinalCall: false,
        pickupChancePercent: 100,
        randomValue,
      }),
      true,
    );
  }
});

test("the pickup roll splits at the configured rate", () => {
  const roll = (randomValue) =>
    shouldDemoParticipantPickUp({ isFinalCall: false, pickupChancePercent: 80, randomValue });

  assert.equal(roll(0.79), true);
  assert.equal(roll(0.8), false);
});

test("demo delays stay inside their window even for nonsense input", () => {
  for (const randomValue of [-1, 0, 0.5, 1, 2, NaN, undefined]) {
    const joinDelayMs = getDemoJoinDelayMs(randomValue, { totalArrivals: 50 });
    const pickupDelayMs = getDemoPickupDelayMs(randomValue);
    const raffleJoinDelayMs = getDemoRaffleJoinDelayMs(randomValue);
    const raffleCollectDelayMs = getDemoRaffleCollectDelayMs(randomValue);

    assert.ok(joinDelayMs >= 200 && joinDelayMs <= 40_000, `join ${joinDelayMs}`);
    assert.ok(pickupDelayMs >= 1_200 && pickupDelayMs <= 45_000, `pickup ${pickupDelayMs}`);
    assert.ok(
      raffleJoinDelayMs >= 500 && raffleJoinDelayMs <= 150_000,
      `raffle join ${raffleJoinDelayMs}`,
    );
    assert.ok(
      raffleCollectDelayMs >= 4_000 && raffleCollectDelayMs <= 120_000,
      `raffle collect ${raffleCollectDelayMs}`,
    );
  }
});

/*
 * The behaviour these delays exist for, rather than only their bounds.
 *
 * A uniform draw out of a narrow band is what they used to be, and it is the
 * one thing a room full of people never looks like: arrivals on a metronome,
 * and a called group clearing as a block because every delay landed inside the
 * same six seconds.
 */
test("pickup delays are heavy-tailed rather than evenly spread", () => {
  const quick = getDemoPickupDelayMs(0.2);
  const median = getDemoPickupDelayMs(0.5);
  const slow = getDemoPickupDelayMs(0.95);

  assert.ok(quick < median && median < slow, `${quick} ${median} ${slow}`);
  // The half of the room that reacts fastest does so well inside the average,
  // and the tail runs several times longer — which is where a backlog comes
  // from. An even spread would put the median halfway between the two.
  assert.ok(median < 8_000, `median ${median}`);
  assert.ok(slow > median * 2, `slow ${slow} vs median ${median}`);
});

test("arrivals thin out as the room fills", () => {
  const early = getDemoJoinDelayMs(0.5, { arrivedCount: 0, totalArrivals: 100 });
  const late = getDemoJoinDelayMs(0.5, { arrivedCount: 99, totalArrivals: 100 });

  assert.ok(late > early, `early ${early} late ${late}`);
});

test("a bigger room fills at a faster rate rather than taking proportionally longer", () => {
  const smallRoomGap = getDemoJoinDelayMs(0.5, { arrivedCount: 0, totalArrivals: 20 });
  const bigRoomGap = getDemoJoinDelayMs(0.5, { arrivedCount: 0, totalArrivals: 200 });

  assert.ok(bigRoomGap < smallRoomGap, `small ${smallRoomGap} big ${bigRoomGap}`);
});

test("not every demo participant opts into the raffle or collects a prize", () => {
  assert.equal(shouldDemoParticipantJoinRaffle(0.5), true);
  assert.equal(shouldDemoParticipantJoinRaffle(0.99), false);
  assert.equal(shouldDemoWinnerCollectPrize(0.5), true);
  assert.equal(shouldDemoWinnerCollectPrize(0.99), false);
});

test("a demo can hold a full house", () => {
  // The whole point of a demo is finding out what a real turnout does to the
  // panel, so the cap has to reach one.
  assert.ok(DEMO_LIMITS.participantCount.max >= 300);

  const participants = planDemoParticipants({
    config: { memberPercent: 40, participantCount: 300, preStartPercent: 60 },
    eventId: "full-house",
  });

  assert.equal(participants.length, 300);
  // Names key the roster and have to stay distinguishable at that size.
  assert.equal(new Set(participants.map((p) => p.displayName)).size, 300);
});

// --- check-in retries --------------------------------------------------------
//
// The attendee page asks for a number from an effect whose own dependencies
// include the loading flag it sets, so without a bound a failure re-runs it
// immediately — a tight loop of one callable per round trip, on every phone in
// the room, starting exactly when the callable is already struggling.

test("only failures worth trying again are retried", () => {
  assert.equal(isTransientClaimError({ code: "functions/unavailable" }), true);
  assert.equal(isTransientClaimError({ code: "functions/resource-exhausted" }), true);
  assert.equal(isTransientClaimError({ code: "functions/deadline-exceeded" }), true);
  // A refusal that will refuse again just as firmly.
  assert.equal(isTransientClaimError({ code: "functions/permission-denied" }), false);
  assert.equal(isTransientClaimError({ code: "functions/failed-precondition" }), false);
  assert.equal(isTransientClaimError({ code: "functions/invalid-argument" }), false);
  // A fetch that never reached anywhere carries no code at all, and is the
  // single most likely failure on a venue network.
  assert.equal(isTransientClaimError(new Error("network error")), true);
});

test("retries back off, are jittered, and stop", () => {
  // The first attempt is immediate: somebody who has just scanned should not
  // sit through a delay that exists for the failure case.
  assert.equal(getClaimRetryDelayMs(0), 0);

  const first = getClaimRetryDelayMs(1, 0.5);
  const second = getClaimRetryDelayMs(2, 0.5);
  const third = getClaimRetryDelayMs(3, 0.5);

  assert.ok(first < second && second < third, `${first} ${second} ${third}`);
  assert.ok(getClaimRetryDelayMs(50, 1) <= CLAIM_RETRY_MAX_DELAY_MS);

  // Jitter is what stops three hundred devices that failed on the same second
  // from all coming back on the same later one.
  assert.notEqual(getClaimRetryDelayMs(3, 0), getClaimRetryDelayMs(3, 1));

  const transient = { code: "functions/unavailable" };
  assert.equal(shouldRetryClaim({ attemptCount: 1, error: transient }), true);
  assert.equal(shouldRetryClaim({ attemptCount: MAX_CLAIM_ATTEMPTS, error: transient }), false);
  // A permanent refusal stops on the first try rather than spending the budget.
  assert.equal(
    shouldRetryClaim({ attemptCount: 1, error: { code: "functions/permission-denied" } }),
    false,
  );
});

test("the retry counter resets when the event or the attendee changes", () => {
  const first = nextClaimRetryState(createClaimRetryState("event-a:discord:1"), "event-a:discord:1");
  assert.equal(first.attemptCount, 1);

  const second = nextClaimRetryState(first, "event-a:discord:1");
  assert.equal(second.attemptCount, 2);

  // A different event is a fresh question; the attempts spent on the last one
  // say nothing about this one.
  const other = nextClaimRetryState(second, "event-b:discord:1");
  assert.equal(other.attemptCount, 1);
});

// --- pkce --------------------------------------------------------------------
//
// The challenge transform is checked against the worked example in RFC 7636
// Appendix B. Getting it wrong does not degrade gracefully: Discord rejects the
// exchange and nobody can log in.

test("the code challenge matches the RFC 7636 worked example", async () => {
  const challenge = await createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");

  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("code verifiers are unique and inside the length the RFC allows", () => {
  const verifiers = new Set();

  for (let index = 0; index < 200; index += 1) {
    const verifier = createCodeVerifier();

    assert.ok(verifier.length >= 43 && verifier.length <= 128, `length ${verifier.length}`);
    assert.match(verifier, /^[A-Za-z0-9\-._~]+$/, verifier);
    verifiers.add(verifier);
  }

  assert.equal(verifiers.size, 200);
});

test("the challenge is stable for a verifier and differs between verifiers", async () => {
  const verifier = createCodeVerifier();

  assert.equal(await createCodeChallenge(verifier), await createCodeChallenge(verifier));
  assert.notEqual(await createCodeChallenge(verifier), await createCodeChallenge(createCodeVerifier()));
});

// --- authStep ----------------------------------------------------------------
//
// The login effect re-runs for reasons it causes itself: signing in flips both
// firebaseAuthReady and firebaseSignedIn. These pin down what each of those runs
// is supposed to do.

const step = (overrides) =>
  planAuthStep({
    devLogin: "",
    firebaseAuthReady: true,
    firebaseSignedIn: false,
    hasAuth: true,
    hasPendingExchange: false,
    redirectedCode: null,
    sessionSettled: false,
    storedUser: "",
    ...overrides,
  });

test("a code in the URL is redeemed", () => {
  assert.equal(step({ redirectedCode: "abc" }), "exchange-code");
});

test("a code is redeemed even before Firebase has reported in", () => {
  // It is single-use and must be spent on the run that finds it.
  assert.equal(
    step({ redirectedCode: "abc", firebaseAuthReady: false }),
    "exchange-code",
  );
});

test("REGRESSION: the re-run caused by signing in re-attaches instead of signing out", () => {
  // The exact state the second run sees mid-login: the code has been stripped
  // from the URL, the profile is not written until the exchange resolves, and
  // Firebase has just reported a session. Returning "signed-out" here is what
  // tore down the fresh session and left the app spinning forever.
  assert.equal(
    step({
      firebaseAuthReady: true,
      firebaseSignedIn: true,
      hasPendingExchange: true,
      redirectedCode: null,
      storedUser: "",
    }),
    "reattach",
  );
});

test("REGRESSION: an in-flight exchange outranks waiting for Firebase", () => {
  assert.equal(
    step({ hasPendingExchange: true, firebaseAuthReady: false }),
    "reattach",
  );
});

test("a finished login makes later re-runs do nothing", () => {
  assert.equal(step({ sessionSettled: true, storedUser: "u1", firebaseSignedIn: true }), "settled");
  assert.equal(step({ sessionSettled: true, hasPendingExchange: true }), "settled");
});

test("a new code still wins over a settled session, so re-login works", () => {
  assert.equal(step({ sessionSettled: true, redirectedCode: "abc" }), "exchange-code");
});

test("a stored profile plus a live Firebase session is refreshed", () => {
  assert.equal(step({ storedUser: "u1", firebaseSignedIn: true }), "refresh");
});

test("a reload waits for Firebase rather than deciding early", () => {
  // Deciding here would sign out anyone who simply refreshed the page.
  assert.equal(step({ storedUser: "u1", firebaseAuthReady: false }), "wait-for-firebase");
});

test("a stored profile with no Firebase session signs out", () => {
  assert.equal(step({ storedUser: "u1", firebaseSignedIn: false }), "signed-out");
});

test("a first-ever visit signs out rather than exchanging anything", () => {
  assert.equal(step({}), "signed-out");
});

test("the dev login stands in for a code, but never outranks a real one", () => {
  assert.equal(step({ devLogin: "dev:staff" }), "exchange-dev");
  assert.equal(step({ devLogin: "dev:staff", redirectedCode: "abc" }), "exchange-code");
});

test("with no Firebase configured at all, nothing waits forever", () => {
  assert.notEqual(step({ hasAuth: false, firebaseAuthReady: false }), "wait-for-firebase");
});

// --- raffle ------------------------------------------------------------------

const raffleClaim = (number, isMember = false) => ({
  claimId: `claim-${number}`,
  displayName: `Attendee ${number}`,
  isMember,
  number,
});

test("a raffle QR payload round-trips and is not readable as an item claim", () => {
  const payload = buildRaffleQrPayload({
    claimId: "event-1__discord%3A42",
    eventId: "event-1",
    qrToken: "token-1",
  });

  assert.deepEqual(parseRaffleQrPayload(payload), {
    claimId: "event-1__discord%3A42",
    eventId: "event-1",
    qrToken: "token-1",
  });
  // The kinds are what keep a prize off the item-claim path at the scanner.
  assert.equal(parseClaimQrPayload(payload), null);
});

test("an item claim QR payload is not readable as a raffle prize", () => {
  const payload = buildClaimQrPayload({
    claimId: "event-1__discord%3A42",
    eventId: "event-1",
    qrToken: "token-1",
  });

  assert.equal(parseRaffleQrPayload(payload), null);
});

test("raffle winner numbers are cleaned, deduplicated and capped", () => {
  // 0 means "no number" and is dropped; a negative is a staff number, which is
  // a real winner whenever staff have been let into the draw.
  assert.deepEqual(normalizeRaffleWinnerNumbers([3, "4", 3, 0, -2, null, 5]), [3, 4, -2, 5]);
  assert.deepEqual(normalizeRaffleWinnerNumbers("nope"), []);

  const overflowing = Array.from({ length: RAFFLE_MAX_WINNERS + 10 }, (_, index) => index + 1);
  const normalized = normalizeRaffleWinnerNumbers(overflowing);

  assert.equal(normalized.length, RAFFLE_MAX_WINNERS);
  // The cap keeps the newest winners, whose prize codes are the ones still out.
  assert.equal(normalized.at(-1), RAFFLE_MAX_WINNERS + 10);
});

test("an open raffle draws from everyone with a number", () => {
  const eligible = getRaffleEligibleClaims({
    claims: [raffleClaim(2), raffleClaim(1, true), raffleClaim(3)],
  });

  assert.deepEqual(eligible.map((claim) => claim.number), [1, 2, 3]);
});

test("a members-only raffle leaves non-members off the wheel", () => {
  const eligible = getRaffleEligibleClaims({
    claims: [raffleClaim(1, true), raffleClaim(2), raffleClaim(3, true)],
    membersOnly: true,
  });

  assert.deepEqual(eligible.map((claim) => claim.number), [1, 3]);
});

test("previous winners are out of the draw by default, across multiple raffles", () => {
  const claims = [raffleClaim(1), raffleClaim(2), raffleClaim(3)];
  const afterFirstSpin = getRaffleEligibleClaims({ claims, winnerNumbers: [2] });

  assert.deepEqual(afterFirstSpin.map((claim) => claim.number), [1, 3]);

  const afterSecondSpin = getRaffleEligibleClaims({ claims, winnerNumbers: [2, 3] });

  assert.deepEqual(afterSecondSpin.map((claim) => claim.number), [1]);
});

test("repeat winners are allowed back on the wheel when staff turn it on", () => {
  const eligible = getRaffleEligibleClaims({
    allowRepeatWinners: true,
    claims: [raffleClaim(1), raffleClaim(2)],
    winnerNumbers: [2],
  });

  assert.deepEqual(eligible.map((claim) => claim.number), [1, 2]);
});

test("attendees without a number are never drawn", () => {
  const eligible = getRaffleEligibleClaims({
    claims: [raffleClaim(0), { displayName: "No number", isMember: true }, raffleClaim(4)],
  });

  assert.deepEqual(eligible.map((claim) => claim.number), [4]);
});

// --- staff numbers -----------------------------------------------------------

test("staff numbers are shown as S-numbers and attendees as #-numbers", () => {
  assert.equal(formatClaimNumber(-1), "S1");
  assert.equal(formatClaimNumber(-12), "S12");
  assert.equal(formatClaimNumber(7), "#7");
  // 0 is "no number yet", which has nothing to print.
  assert.equal(formatClaimNumber(0), "");
  assert.equal(formatClaimNumber(null), "");
});

test("a claim is staff by its flag or by a number below zero", () => {
  assert.equal(isStaffClaim({ isStaff: true, number: 4 }), true);
  // A claim written before the flag existed still reads correctly off its
  // number, which is what the roster groups on.
  assert.equal(isStaffClaim({ number: -3 }), true);
  assert.equal(isStaffClaim({ number: 3 }), false);
  assert.equal(isStaffClaim(null), false);
});

test("the queue projects the numbers the server will actually allocate", () => {
  // The server counts up from the event's own counters and never winds them
  // back, so a removal leaves a gap it will not reuse — see allocateClaimNumber.
  // Gap-filling here agreed with it until staff removed somebody, and from then
  // on the queue promised a number nobody would be given.
  const projected = projectQueueNumbers({
    nextClaimNumber: 12,
    nextStaffNumber: 2,
    queueEntries: [{ preclaimId: "a" }, { preclaimId: "b" }, { preclaimId: "c" }],
  });

  assert.deepEqual(projected.map((entry) => entry.projectedNumber), [12, 13, 14]);
  // The entry is carried through, not replaced.
  assert.equal(projected[0].preclaimId, "a");
});

test("a staff member waiting in the queue is projected an S-number", () => {
  const projected = projectQueueNumbers({
    nextClaimNumber: 5,
    nextStaffNumber: 3,
    queueEntries: [
      { preclaimId: "a" },
      { isStaff: true, preclaimId: "s" },
      { preclaimId: "b" },
      { isStaff: true, preclaimId: "s2" },
    ],
  });

  // Two counters, running independently: handing a staff member their number
  // must not move the attendee queue along, which is the whole point of them
  // being numbered before #1.
  assert.deepEqual(projected.map((entry) => entry.projectedNumber), [5, -3, 6, -4]);
  assert.deepEqual(projected.map((entry) => formatClaimNumber(entry.projectedNumber)), [
    "#5",
    "S3",
    "#6",
    "S4",
  ]);
});

test("a queue projection falls back to #1 when the event carries no counters", () => {
  // An event started before staff numbering existed has no nextStaffNumber, and
  // a missing counter must not project #0 — which reads as "no number".
  assert.deepEqual(
    projectQueueNumbers({
      queueEntries: [{ preclaimId: "a" }, { isStaff: true, preclaimId: "s" }],
    }).map((entry) => entry.projectedNumber),
    [1, -1],
  );
  assert.deepEqual(projectQueueNumbers().map((entry) => entry.projectedNumber), []);
});

test("staff sort ahead of #1 and split off the attendee list in order", () => {
  const roster = [
    raffleClaim(2),
    { claimId: "s2", displayName: "Staff two", isMember: true, number: -2 },
    raffleClaim(1),
    { claimId: "s1", displayName: "Staff one", isMember: true, number: -1 },
  ].sort((left, right) => left.number - right.number);

  const { attendeeClaims, staffClaims } = partitionStaffClaims(roster);

  assert.deepEqual(staffClaims.map((claim) => claim.number), [-2, -1]);
  assert.deepEqual(attendeeClaims.map((claim) => claim.number), [1, 2]);
});

test("staff are off the wheel unless the raffle is told to include them", () => {
  const claims = [
    { claimId: "s1", displayName: "Staff one", isMember: true, number: -1 },
    raffleClaim(1),
    raffleClaim(2),
  ];

  // Off by default, and off when the flag is absent entirely — a caller that
  // forgets to pass it must not quietly draw the person handing out prizes.
  assert.deepEqual(
    getRaffleEligibleClaims({ claims }).map((claim) => claim.number),
    [1, 2],
  );
  assert.deepEqual(
    getRaffleEligibleClaims({ allowStaff: false, claims }).map((claim) => claim.number),
    [1, 2],
  );
  assert.deepEqual(
    getRaffleEligibleClaims({ allowStaff: true, claims }).map((claim) => claim.number),
    [-1, 1, 2],
  );
});

test("a staff member already flagged is off the wheel even holding a real number", () => {
  const claims = [
    { claimId: "s1", displayName: "Promoted", isMember: true, isStaff: true, number: 3 },
    raffleClaim(1),
  ];

  assert.deepEqual(
    getRaffleEligibleClaims({ claims }).map((claim) => claim.number),
    [1],
  );
});

test("a staff win is remembered, so a later spin leaves them out", () => {
  const claims = [
    { claimId: "s1", displayName: "Staff one", isMember: true, number: -1 },
    raffleClaim(1),
  ];
  const winnerNumbers = normalizeRaffleWinnerNumbers([-1]);

  assert.deepEqual(winnerNumbers, [-1]);
  assert.deepEqual(
    getRaffleEligibleClaims({ allowStaff: true, claims, winnerNumbers }).map(
      (claim) => claim.number,
    ),
    [1],
  );
});

test("a staff slice on the wheel is labelled S1, never as a negative", () => {
  const [staffSegment] = buildRaffleSegments({
    claims: [{ claimId: "s1", displayName: "Ada", isMember: true, number: -1 }],
  });

  assert.equal(buildRaffleSegmentLabel(staffSegment), "S1 · Ada");
});

test("the draw covers the whole pool and only the pool", () => {
  const eligible = [raffleClaim(1), raffleClaim(2), raffleClaim(3), raffleClaim(4)];

  assert.equal(pickRaffleWinner(eligible, 0).number, 1);
  assert.equal(pickRaffleWinner(eligible, 0.99).number, 4);
  // Guards against an out-of-range random value indexing past the end.
  assert.equal(pickRaffleWinner(eligible, 1).number, 4);
  assert.equal(pickRaffleWinner([]), null);
});

test("the reveal waits for the wheel to travel and then to spin", () => {
  const spinStartedAtMs = 1_700_000_000_000;
  const spin = { spinCount: 1, spinStartedAtMs, winnerNumber: 7 };

  assert.equal(RAFFLE_REVEAL_AFTER_MS, RAFFLE_LEAD_IN_MS + RAFFLE_SPIN_DURATION_MS);
  // Still travelling into place.
  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + 10 }),
    RAFFLE_PHASE.spinning,
  );
  // Turning, but not landed: the old duration alone is no longer the finish.
  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + RAFFLE_SPIN_DURATION_MS }),
    RAFFLE_PHASE.spinning,
  );
  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + RAFFLE_REVEAL_AFTER_MS }),
    RAFFLE_PHASE.revealed,
  );
  // A screen that opens long after the spin lands goes straight to the winner
  // rather than replaying an animation nobody is waiting for.
  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + 600_000 }),
    RAFFLE_PHASE.revealed,
  );
  assert.equal(getRaffleSpinPhase({ spinCount: 0, winnerNumber: 0 }), RAFFLE_PHASE.idle);
});

test("a staff win drives the wheel exactly as an attendee win does", () => {
  // A staff number is negative (see src/staffNumbers.js), and staff can be let
  // into the draw. Read as "winnerNumber > 0", every one of these came back
  // idle: the wheel never turned and the win was never announced, while the
  // spin had already been written to the event and the staff member spent.
  const spinStartedAtMs = 1_700_000_000_000;
  const spin = { spinCount: 1, spinStartedAtMs, winnerNumber: -1 };

  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + 10 }),
    RAFFLE_PHASE.spinning,
  );
  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + RAFFLE_REVEAL_AFTER_MS }),
    RAFFLE_PHASE.revealed,
  );
  // A cleared winner is 0, and that really is idle whichever sign the last one had.
  assert.equal(
    getRaffleSpinPhase({ ...spin, nowMs: spinStartedAtMs + 10, winnerNumber: 0 }),
    RAFFLE_PHASE.idle,
  );
});

test("a screen picks a spin up where it is, and a cleared one not at all", () => {
  const spinStartedAtMs = 1_700_000_000_000;

  // Opening as the spin is called: the full run-up, then the full turn.
  assert.deepEqual(getRaffleSpinTiming({ nowMs: spinStartedAtMs, spinStartedAtMs }), {
    leadInMs: RAFFLE_LEAD_IN_MS,
    spinMs: RAFFLE_SPIN_DURATION_MS,
  });

  // Opening part-way through the run-up: what is left of it, and the whole turn,
  // which has not started yet.
  assert.deepEqual(
    getRaffleSpinTiming({ nowMs: spinStartedAtMs + 200, spinStartedAtMs }),
    { leadInMs: RAFFLE_LEAD_IN_MS - 200, spinMs: RAFFLE_SPIN_DURATION_MS },
  );

  // Opening mid-turn: done growing, and only the rest of the turn to run, so it
  // still lands on the winner at the same instant as every other screen.
  assert.deepEqual(
    getRaffleSpinTiming({ nowMs: spinStartedAtMs + RAFFLE_LEAD_IN_MS + 1_500, spinStartedAtMs }),
    { leadInMs: 0, spinMs: RAFFLE_SPIN_DURATION_MS - 1_500 },
  );

  // Opening after it landed: nothing left to animate, so the wheel is simply
  // drawn where it stopped.
  assert.deepEqual(
    getRaffleSpinTiming({ nowMs: spinStartedAtMs + 600_000, spinStartedAtMs }),
    { leadInMs: 0, spinMs: 0 },
  );

  /* And the one that used to spin the wheel on every refresh. Clearing the
     winner nulls the start time and leaves the spin count standing, so a
     freshly loaded screen meets a spin count it has never seen with no
     timestamp behind it. That is a spin long finished, not one starting now. */
  assert.deepEqual(getRaffleSpinTiming({ spinStartedAtMs: null }), { leadInMs: 0, spinMs: 0 });
  assert.deepEqual(getRaffleSpinTiming({}), { leadInMs: 0, spinMs: 0 });
});

test("the wheel stops with the winning slice under the pointer", () => {
  // The pointer is at three o'clock, because the staged wheel hangs off the
  // left of the display and that is the rim still on screen.
  assert.equal(RAFFLE_POINTER_ANGLE, 90);

  const segments = buildRaffleSegments({
    claims: [raffleClaim(1), raffleClaim(2), raffleClaim(3), raffleClaim(4)],
  });

  // Four equal slices of 90°: the first is centred at 45°, so a 45° turn
  // carries it round to the pointer.
  assert.equal(getRaffleWinnerRotation(segments, 1), 45);
  assert.equal(getRaffleWinnerRotation(segments, 2), 315);
  assert.equal(getRaffleWinnerRotation(segments, 4), 135);

  // Whatever the slice and whatever the weighting, it ends up at the pointer.
  for (const [count, chances] of [[3, 1], [7, 3], [12, 5], [60, 2]]) {
    const claims = Array.from({ length: count }, (_, index) =>
      raffleClaim(index + 1, index % 3 === 0),
    );
    const weighted = buildRaffleSegments({ claims, memberChances: chances });

    for (const segment of weighted) {
      const rotation = getRaffleWinnerRotation(weighted, segment.number);

      assert.ok(
        Math.abs(((segment.midAngle + rotation) % 360) - RAFFLE_POINTER_ANGLE) < 1e-9,
        `#${segment.number} of ${count} at ${chances}x did not land on the pointer`,
      );
    }
  }

  // A winner who is no longer on the wheel stops it somewhere sane.
  assert.equal(getRaffleWinnerRotation(segments, 99), 0);
  assert.equal(getRaffleWinnerRotation([], 1), 0);
});

test("the wheel stops somewhere inside the winning slice rather than dead centre", () => {
  const segments = buildRaffleSegments({
    claims: [raffleClaim(1), raffleClaim(2), raffleClaim(3), raffleClaim(4)],
  });
  const [firstSegment] = segments;
  // Four 90° slices, so the widest the landing may sit off centre is 32.4°.
  const widestOffset = (RAFFLE_LANDING_SPREAD / 2) * firstSegment.sweepAngle;

  const isAbout = (actual, expected) => Math.abs(actual - expected) < 1e-9;

  assert.ok(isAbout(getRaffleWinnerRotation(segments, 1, { landingFraction: 0 }), 45 + widestOffset));
  assert.ok(isAbout(getRaffleWinnerRotation(segments, 1, { landingFraction: 1 }), 45 - widestOffset));
  // Both ends of the range are still comfortably inside the slice.
  assert.ok(widestOffset < firstSegment.sweepAngle / 2);

  // Whatever it is handed, the pointer lands within the winner's own slice —
  // never on a seam, and never on the person next to them.
  for (const [count, chances] of [[2, 1], [5, 2], [17, 4], [115, 1]]) {
    const claims = Array.from({ length: count }, (_, index) =>
      raffleClaim(index + 1, index % 3 === 0),
    );
    const weighted = buildRaffleSegments({ claims, memberChances: chances });

    for (const segment of weighted) {
      for (const landingFraction of [0, 0.17, 0.5, 0.83, 1]) {
        const rotation = getRaffleWinnerRotation(weighted, segment.number, { landingFraction });
        // Where the pointer ends up, measured from the slice's leading edge.
        const intoSlice =
          (((RAFFLE_POINTER_ANGLE - rotation - segment.startAngle) % 360) + 360) % 360;

        assert.ok(
          intoSlice > 0 && intoSlice < segment.sweepAngle,
          `#${segment.number} of ${count} landed ${intoSlice}° into a ${segment.sweepAngle}° slice`,
        );
      }
    }
  }

  // Garbage stops it in the middle, as it did before there was a choice.
  assert.equal(getRaffleWinnerRotation(segments, 1, { landingFraction: NaN }), 45);
});

test("every screen works out the same landing point for one spin", () => {
  const spin = { spinCount: 3, winnerNumber: 72 };

  assert.equal(getRaffleLandingFraction(spin), getRaffleLandingFraction({ ...spin }));

  const fraction = getRaffleLandingFraction(spin);

  assert.ok(fraction >= 0 && fraction < 1);
  // The same person, drawn again later in the night, is not landed on in
  // exactly the same place; nor are two people on the same spin.
  assert.notEqual(fraction, getRaffleLandingFraction({ ...spin, spinCount: 4 }));
  assert.notEqual(fraction, getRaffleLandingFraction({ ...spin, winnerNumber: 73 }));
  assert.ok(Number.isFinite(getRaffleLandingFraction()));

  // Across a night's worth of spins it uses the whole slice rather than
  // hugging the middle, which is the only reason this exists.
  const fractions = Array.from({ length: 400 }, (_, index) =>
    getRaffleLandingFraction({ spinCount: (index % 20) + 1, winnerNumber: index + 1 }),
  );

  assert.ok(Math.min(...fractions) < 0.05);
  assert.ok(Math.max(...fractions) > 0.95);
  assert.ok(new Set(fractions).size > 380);
});

test("every spin turns forwards and makes at least the full number of turns", () => {
  const first = getRaffleNextRotation(0, 315);

  assert.equal(first, RAFFLE_SPIN_TURNS * 360 + 315);

  const second = getRaffleNextRotation(first, 45);

  assert.ok(second > first);
  assert.ok(second - first >= RAFFLE_SPIN_TURNS * 360);
  // Landing on the same slice twice still spins rather than standing still.
  assert.ok(getRaffleNextRotation(first, 315) > first);
});

test("a wheel label always carries the number, even when the name is cut", () => {
  assert.equal(buildRaffleSegmentLabel({ displayName: "Alice", number: 12 }), "12 · Alice");
  assert.equal(
    buildRaffleSegmentLabel({ displayName: "Bartholomew Fitzgerald", number: 7 }),
    "7 · Bartholomew F…",
  );
  assert.equal(buildRaffleSegmentLabel({ displayName: "   ", number: 3 }), "3");
});

test("a replaced winner is off the list and cannot be drawn as their own replacement", () => {
  const claims = [raffleClaim(1), raffleClaim(2), raffleClaim(3)];
  const remainingWinners = [1, 2].filter((number) => number !== 2);

  assert.deepEqual(remainingWinners, [1]);

  // Repeat winners on is the case that bites: without the explicit exclusion
  // the pool would happily hand the prize back to the person who just left.
  const replacementPool = getRaffleEligibleClaims({
    allowRepeatWinners: true,
    claims,
    winnerNumbers: remainingWinners,
  }).filter((claim) => claim.number !== 2);

  assert.deepEqual(replacementPool.map((claim) => claim.number), [1, 3]);
  assert.ok(!replacementPool.some((claim) => claim.number === 2));
});

// --- raffle opt-in and member chances ----------------------------------------

const joinedClaim = (number, isMember = false) => ({
  ...raffleClaim(number, isMember),
  raffleJoinedAtMs: 1_700_000_000_000,
});

test("opt-in keeps everyone who has not joined off the wheel", () => {
  const claims = [joinedClaim(1), raffleClaim(2), joinedClaim(3), raffleClaim(4)];

  // Off by default: joining is irrelevant and everybody is in.
  assert.deepEqual(
    getRaffleEligibleClaims({ claims }).map((claim) => claim.number),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    getRaffleEligibleClaims({ claims, requireOptIn: true }).map((claim) => claim.number),
    [1, 3],
  );
});

test("opt-in stacks with the other filters rather than replacing them", () => {
  const claims = [joinedClaim(1, true), joinedClaim(2), raffleClaim(3, true), joinedClaim(4, true)];
  const eligible = getRaffleEligibleClaims({
    claims,
    membersOnly: true,
    requireOptIn: true,
    winnerNumbers: [4],
  });

  // #2 never joined as a member, #3 joined nothing, #4 has already won.
  assert.deepEqual(eligible.map((claim) => claim.number), [1]);
});

test("member chances are clamped to a sane range", () => {
  assert.equal(normalizeRaffleMemberChances(undefined), 1);
  assert.equal(normalizeRaffleMemberChances("3"), 3);
  assert.equal(normalizeRaffleMemberChances(0), 1);
  assert.equal(normalizeRaffleMemberChances(99), RAFFLE_MEMBER_CHANCES_MAX);
  assert.equal(normalizeRaffleMemberChances("nonsense"), 1);
});

test("a member's extra chances only apply to members", () => {
  assert.equal(getRaffleEntryWeight(raffleClaim(1, true), 4), 4);
  assert.equal(getRaffleEntryWeight(raffleClaim(2, false), 4), 1);
  assert.equal(getRaffleEntryWeight(raffleClaim(3, true), 1), 1);
});

test("extra chances widen a member's slice instead of duplicating them", () => {
  const claims = [raffleClaim(1, true), raffleClaim(2), raffleClaim(3)];
  const segments = buildRaffleSegments({ claims, memberChances: 3 });

  // One slice each: nobody appears on the wheel twice, so "who won" stays a
  // single slice and the draw count stays honest.
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((segment) => segment.number), [1, 2, 3]);

  // 3 + 1 + 1 = 5 shares of the circle.
  assert.ok(Math.abs(segments[0].sweepAngle - 216) < 1e-9);
  assert.ok(Math.abs(segments[1].sweepAngle - 72) < 1e-9);
  assert.ok(Math.abs(segments[2].sweepAngle - 72) < 1e-9);

  // The slices tile the whole circle with no gaps or overlaps.
  assert.equal(segments[0].startAngle, 0);
  segments.forEach((segment, index) => {
    if (index > 0) {
      assert.ok(Math.abs(segment.startAngle - segments[index - 1].endAngle) < 1e-9);
    }
  });
  assert.ok(Math.abs(segments.at(-1).endAngle - 360) < 1e-9);
});

test("the draw is weighted exactly as the wheel is drawn", () => {
  const claims = [raffleClaim(1, true), raffleClaim(2), raffleClaim(3)];
  const segments = buildRaffleSegments({ claims, memberChances: 3 });

  // The member owns the first 3/5 of the draw, then one guest each.
  assert.equal(pickRaffleWinner(segments, 0).number, 1);
  assert.equal(pickRaffleWinner(segments, 0.59).number, 1);
  assert.equal(pickRaffleWinner(segments, 0.61).number, 2);
  assert.equal(pickRaffleWinner(segments, 0.81).number, 3);

  // Which is the same share of the circle their slice takes up.
  assert.ok(Math.abs(segments[0].sweepAngle / 360 - 0.6) < 1e-9);
});

test("an unweighted list is still drawn uniformly", () => {
  const plain = [raffleClaim(1), raffleClaim(2), raffleClaim(3), raffleClaim(4)];

  assert.equal(pickRaffleWinner(plain, 0).number, 1);
  assert.equal(pickRaffleWinner(plain, 0.26).number, 2);
  assert.equal(pickRaffleWinner(plain, 0.99).number, 4);
});

// --- backtrack ---------------------------------------------------------------

const queueState = (overrides) => ({
  current: 0,
  finalCall: false,
  groupSize: 10,
  last: 0,
  round: 1,
  totalPeopleWithNumbers: 34,
  ...overrides,
});

test("the start of the event has nothing behind it", () => {
  assert.equal(getBacktrackStep(queueState({ current: 0, round: 1 })), null);
});

test("a rewind walks the round back one group at a time", () => {
  const fromThird = getBacktrackStep(queueState({ current: 30, last: 20 }));

  assert.equal(fromThird.kind, BACKTRACK_STEP.group);
  assert.equal(fromThird.current, 20);
  assert.equal(fromThird.last, 10);
  assert.equal(fromThird.round, 1);
  assert.equal(fromThird.finalCall, false);
  assert.equal(fromThird.label, "Group 11-20");

  const fromSecond = getBacktrackStep(queueState({ current: 20, last: 10 }));

  assert.equal(fromSecond.current, 10);
  assert.equal(fromSecond.last, 0);
  assert.equal(fromSecond.label, "Group 1-10");
});

test("the group size can change mid-round without the rewind losing its place", () => {
  // Called at 10 a group, then the size was raised to 15 for the third group.
  const step = getBacktrackStep(queueState({ current: 35, groupSize: 15, last: 20 }));

  assert.equal(step.current, 20);
  assert.equal(step.last, 5);
});

test("behind the first group is a round that has not started", () => {
  const step = getBacktrackStep(queueState({ current: 10, last: 0, round: 2 }));

  assert.equal(step.kind, BACKTRACK_STEP.pendingRound);
  assert.equal(step.current, 0);
  assert.equal(step.last, 0);
  assert.equal(step.round, 2);
  assert.equal(step.finalCall, false);
});

test("leaving final call puts its last group back without moving the queue", () => {
  const step = getBacktrackStep(queueState({ current: 40, finalCall: true, last: 30, round: 3 }));

  assert.equal(step.kind, BACKTRACK_STEP.group);
  assert.equal(step.finalCall, false);
  assert.equal(step.current, 40);
  assert.equal(step.last, 30);
  assert.equal(step.round, 3);
});

test("a pending round steps back into the previous round's final call", () => {
  const step = getBacktrackStep(queueState({ current: 0, round: 3, totalPeopleWithNumbers: 34 }));

  assert.equal(step.kind, BACKTRACK_STEP.previousRoundFinalCall);
  assert.equal(step.round, 2);
  assert.equal(step.finalCall, true);
  // Rebuilt from the roster: 34 attendees in groups of 10 last ended at 40, so
  // everybody's number is covered and final call can reach all of them.
  assert.equal(step.current, 40);
  assert.equal(step.last, 30);
  assert.ok(step.current >= 34);
});

test("the rebuilt final call covers the roster whatever the group size", () => {
  for (const groupSize of [1, 3, 7, 10, 20]) {
    for (const totalPeopleWithNumbers of [0, 1, 9, 34, 100]) {
      const step = getBacktrackStep(
        queueState({ current: 0, groupSize, round: 2, totalPeopleWithNumbers }),
      );

      assert.ok(step.current >= totalPeopleWithNumbers, `${groupSize}/${totalPeopleWithNumbers}`);
      assert.ok(step.last >= 0);
      assert.ok(step.last < step.current);
    }
  }
});

test("stepping back and forward again returns the queue to where it was", () => {
  // Forward: last becomes the old current, current gains a group.
  const called = { current: 30, finalCall: false, last: 20, round: 4 };
  const back = getBacktrackStep(queueState(called));
  const forward = { current: back.current + 10, last: back.current };

  assert.equal(forward.current, called.current);
  assert.equal(forward.last, called.last);
});

// --- hasClaimedInRound -------------------------------------------------------

test("an attendee who has not claimed is never counted as claimed", () => {
  assert.equal(hasClaimedInRound({ redeemedRound: 0 }, 1), false);
  assert.equal(hasClaimedInRound({}, 1), false);
  assert.equal(hasClaimedInRound(null, 1), false);
});

test("claiming this round keeps an attendee out of the round", () => {
  assert.equal(hasClaimedInRound({ redeemedRound: 2 }, 2), true);
});

test("an earlier round's claim leaves an attendee free to claim again", () => {
  assert.equal(hasClaimedInRound({ redeemedRound: 1 }, 2), false);
});

test("a rewind cannot hand a second item to somebody who already claimed", () => {
  // The queue was rewound from round 3 back into round 2; their pickup in round
  // 3 is still on record and still counts.
  assert.equal(hasClaimedInRound({ redeemedRound: 3 }, 2), true);
});

// --- the staff walkthrough ---------------------------------------------------

// The module reads localStorage through window, which node does not have. Only
// the four calls used below are needed.
const useStubbedLocalStorage = () => {
  const store = new Map();

  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      removeItem: (key) => store.delete(key),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };

  return store;
};

test("staff who did not create the event get the short deck", () => {
  useStubbedLocalStorage();

  assert.equal(
    resolveStaffWalkthroughRole("event-a"),
    STAFF_WALKTHROUGH_ROLE.helper,
  );
});

test("the browser that created the event gets the organizer deck", () => {
  useStubbedLocalStorage();
  markEventCreatedHere("event-a");

  assert.equal(
    resolveStaffWalkthroughRole("event-a"),
    STAFF_WALKTHROUGH_ROLE.organizer,
  );
});

test("creating one event does not claim the next one", () => {
  useStubbedLocalStorage();
  markEventCreatedHere("event-a");

  assert.equal(
    resolveStaffWalkthroughRole("event-b"),
    STAFF_WALKTHROUGH_ROLE.helper,
  );
});

test("the walkthrough is only forced once per event", () => {
  useStubbedLocalStorage();

  assert.equal(
    hasSeenStaffWalkthrough("event-a", STAFF_WALKTHROUGH_ROLE.helper),
    false,
  );

  markStaffWalkthroughSeen("event-a", STAFF_WALKTHROUGH_ROLE.helper);

  assert.equal(
    hasSeenStaffWalkthrough("event-a", STAFF_WALKTHROUGH_ROLE.helper),
    true,
  );
  // The next event asks again.
  assert.equal(
    hasSeenStaffWalkthrough("event-b", STAFF_WALKTHROUGH_ROLE.helper),
    false,
  );
});

test("reading the short deck does not count as reading the long one", () => {
  useStubbedLocalStorage();
  markStaffWalkthroughSeen("event-a", STAFF_WALKTHROUGH_ROLE.helper);

  assert.equal(
    hasSeenStaffWalkthrough("event-a", STAFF_WALKTHROUGH_ROLE.organizer),
    false,
  );
});

test("the helper deck is shorter than the organizer deck", () => {
  const helperPages = getStaffWalkthroughPages(STAFF_WALKTHROUGH_ROLE.helper);
  const organizerPages = getStaffWalkthroughPages(
    STAFF_WALKTHROUGH_ROLE.organizer,
  );

  assert.ok(helperPages.length < organizerPages.length);
  // An unknown role must not land somebody on an empty deck.
  assert.deepEqual(getStaffWalkthroughPages(""), organizerPages);
});

test("both decks end on the page about your own QR code", () => {
  for (const role of Object.values(STAFF_WALKTHROUGH_ROLE)) {
    const pages = getStaffWalkthroughPages(role);

    assert.equal(pages.at(-1).isFinish, true);
    // Every other page has something to read, and a heading to page past.
    for (const page of pages.slice(0, -1)) {
      assert.ok(page.title.length > 0);
      assert.ok(page.points.length > 0);
    }
  }
});

test("page titles are unique, because they key the progress dots", () => {
  for (const role of Object.values(STAFF_WALKTHROUGH_ROLE)) {
    const titles = getStaffWalkthroughPages(role).map((page) => page.title);

    assert.equal(new Set(titles).size, titles.length);
  }
});

test("the helper deck covers the scanner and the line", () => {
  const text = getStaffWalkthroughPages(STAFF_WALKTHROUGH_ROLE.helper)
    .flatMap((page) => [page.title, page.intro ?? "", ...page.points])
    .join(" ")
    .toLowerCase();

  // The four things a helper on the pickup table cannot do without.
  assert.ok(text.includes("bottom-left"));
  assert.ok(text.includes("qr code"));
  assert.ok(text.includes("green"));
  assert.ok(text.includes("at once"));
});

/*
 * The per-event localStorage sweep.
 *
 * Five families of key are written per event and per device — the walkthrough's
 * two, the claim-rules acknowledgement, the backtrack "don't ask again", and
 * which halves of the queue card were open — and until this existed none of
 * them was ever removed. Four or five keys per event, forever, on a staff phone
 * that works every event.
 *
 * A stub rather than jsdom: the helper only uses length/key/getItem/removeItem,
 * and the point of these tests is which keys it decides to drop.
 */
const withStubbedLocalStorage = (initialEntries, run) => {
  const store = new Map(Object.entries(initialEntries));
  const previousWindow = globalThis.window;

  globalThis.window = {
    localStorage: {
      get length() {
        return store.size;
      },
      key: (index) => [...store.keys()][index] ?? null,
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      removeItem: (key) => store.delete(key),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };

  try {
    run(store);
  } finally {
    globalThis.window = previousWindow;
  }
};

test("the per-event sweep keeps the live event's keys and drops every other event's", () => {
  withStubbedLocalStorage(
    {
      "staffCreatedEvent:live": "true",
      "staffWalkthroughSeen:organizer:live": "true",
      "queuePanelOpen:group:live": "false",
      "claimRulesAcknowledged:live:live__discord%3A7": "true",
      "backtrackConfirmSkipped:live": "true",
      "staffCreatedEvent:old": "true",
      "staffWalkthroughSeen:helper:old": "true",
      "queuePanelOpen:backlog:old": "true",
      "claimRulesAcknowledged:old:old__discord%3A7": "true",
      "backtrackConfirmSkipped:old": "true",
    },
    (store) => {
      const removed = clearPerEventKeysExcept("live");

      assert.equal(removed, 5);
      assert.deepEqual(
        [...store.keys()].sort(),
        [
          "backtrackConfirmSkipped:live",
          "claimRulesAcknowledged:live:live__discord%3A7",
          "queuePanelOpen:group:live",
          "staffCreatedEvent:live",
          "staffWalkthroughSeen:organizer:live",
        ],
      );
    },
  );
});

test("the per-event sweep leaves keys it does not own alone", () => {
  withStubbedLocalStorage(
    {
      // The session keys, which are not per-event and must survive: an attendee
      // reloading mid-event depends on them.
      "number-caller-persisted-claim-session": "{}",
      "number-caller-confirmed-claim-access": "{}",
      // The device-wide screen-awake preference.
      keepScreenAwake: "true",
      // Somebody else's key entirely.
      "unrelated:thing": "1",
      "staffCreatedEvent:old": "true",
    },
    (store) => {
      const removed = clearPerEventKeysExcept("live");

      assert.equal(removed, 1);
      assert.ok(!store.has("staffCreatedEvent:old"));
      assert.ok(store.has("number-caller-persisted-claim-session"));
      assert.ok(store.has("keepScreenAwake"));
      assert.ok(store.has("unrelated:thing"));
    },
  );
});

test("with no event live, every per-event key is stale", () => {
  withStubbedLocalStorage(
    {
      "staffCreatedEvent:a": "true",
      "queuePanelOpen:group:b": "true",
      keepScreenAwake: "true",
    },
    (store) => {
      assert.equal(clearPerEventKeysExcept(""), 2);
      assert.deepEqual([...store.keys()], ["keepScreenAwake"]);
    },
  );
});

// --- concurrent state writes -------------------------------------------------
//
// Two control panels on one event. A write is reduced to the fields it changed
// and applied over whatever is current, so overlapping panels merge instead of
// one of them being refused.

const liveStateWith = (changes) => normalizeState({ ...initialState, ...changes });

test("a write carries only the fields it changed", () => {
  const baseState = liveStateWith({ current: 10, groupSize: 10, last: 0 });
  const changes = getStateChanges(baseState, { ...baseState, groupSize: 12 });

  assert.deepEqual(changes, { groupSize: 12 });
});

test("a settings change made during an advance keeps both", () => {
  const baseState = liveStateWith({ current: 10, groupSize: 10, last: 0 });
  // The other panel called the next group while this slider was moving.
  const currentState = liveStateWith({ current: 20, groupSize: 10, last: 10 });

  const merged = applyStateChanges(
    currentState,
    getStateChanges(baseState, { ...baseState, groupSize: 12 }),
  );

  assert.equal(merged.groupSize, 12);
  assert.equal(merged.current, 20);
  assert.equal(merged.last, 10);
});

test("an advance made during a settings change keeps both", () => {
  const baseState = liveStateWith({ current: 10, groupSize: 10, last: 0 });
  // The other panel moved the group size while this one pressed Next Group.
  const currentState = liveStateWith({ current: 10, groupSize: 12, last: 0 });

  const merged = applyStateChanges(
    currentState,
    getStateChanges(baseState, { ...baseState, current: 20, last: 10 }),
  );

  assert.equal(merged.current, 20);
  assert.equal(merged.last, 10);
  assert.equal(merged.groupSize, 12);
});

test("two panels advancing the same group land on one group, not two", () => {
  const baseState = liveStateWith({ current: 10, groupSize: 10, last: 0 });
  const nextGroup = { ...baseState, current: 20, last: 10 };

  // Auto-advance runs on every staff panel, so both write the same advance.
  const afterFirst = applyStateChanges(baseState, getStateChanges(baseState, nextGroup));
  const afterSecond = applyStateChanges(afterFirst, getStateChanges(baseState, nextGroup));

  assert.equal(afterSecond.current, 20);
  assert.equal(afterSecond.last, 10);
});

test("advancing the group ends a final call another panel started", () => {
  const baseState = liveStateWith({ current: 10, finalCall: false, last: 0 });
  const currentState = liveStateWith({
    current: 10,
    finalCall: true,
    finalCallTargetNumbers: [3, 7],
    last: 0,
  });

  /* The queue fields move together: a group called underneath a final call
     banner is not a state the panel has any way to show. */
  const merged = applyStateChanges(
    currentState,
    getStateChanges(baseState, { ...baseState, current: 20, last: 10 }),
  );

  assert.equal(merged.current, 20);
  assert.equal(merged.finalCall, false);
  assert.deepEqual(merged.finalCallTargetNumbers, []);
});

test("a raffle setting does not drag the draw back with it", () => {
  const baseState = liveStateWith({ raffleMembersOnly: false, raffleSpinCount: 0 });
  const currentState = liveStateWith({
    raffleMembersOnly: false,
    raffleOpen: true,
    raffleSpinCount: 3,
    raffleWinnerNumber: 12,
    raffleWinnerNumbers: [12],
  });

  const merged = applyStateChanges(
    currentState,
    getStateChanges(baseState, { ...baseState, raffleMembersOnly: true }),
  );

  assert.equal(merged.raffleMembersOnly, true);
  assert.equal(merged.raffleSpinCount, 3);
  assert.deepEqual(merged.raffleWinnerNumbers, [12]);
});

test("a list is compared by its contents, so an unchanged one is not rewritten", () => {
  const baseState = liveStateWith({ finalCallTargetNumbers: [1, 2, 3] });
  const changes = getStateChanges(baseState, {
    ...baseState,
    finalCallTargetNumbers: [1, 2, 3],
    title: "Book Club",
  });

  assert.deepEqual(changes, { title: "Book Club" });
});

test("with no base state the whole state is the change", () => {
  const nextState = liveStateWith({ current: 5 });

  assert.deepEqual(getStateChanges(null, nextState), nextState);
});

test("a guarded write is allowed while its fields are untouched", () => {
  const baseState = liveStateWith({ raffleSpinCount: 1 });
  const currentState = liveStateWith({ raffleSpinCount: 1, groupSize: 12 });

  assert.equal(
    hasUnchangedStateFields(baseState, currentState, ["raffleSpinCount"]),
    true,
  );
});

test("a guarded write is refused once another panel has moved its fields", () => {
  const baseState = liveStateWith({ raffleSpinCount: 1 });
  const currentState = liveStateWith({ raffleSpinCount: 2 });

  assert.equal(
    hasUnchangedStateFields(baseState, currentState, ["raffleSpinCount"]),
    false,
  );
});

test("naming no guarded fields leaves the write to merge", () => {
  const baseState = liveStateWith({ raffleSpinCount: 1 });
  const currentState = liveStateWith({ raffleSpinCount: 2 });

  assert.equal(hasUnchangedStateFields(baseState, currentState, []), true);
  assert.equal(hasUnchangedStateFields(baseState, currentState, undefined), true);
});
