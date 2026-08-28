// Firestore rules tests for the attendee-facing attack surface.
//
// Run with:  npm run test:rules
// (starts the Firestore emulator, loads firestore.rules, exits non-zero on failure)

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

const EVENT_ID = "event-abc";
const LIVE_EVENT = ["events", "live-number-caller"];
const claimPath = (uid) => `${EVENT_ID}__${encodeURIComponent(`discord:${uid}`)}`;

let testEnv;

const liveEventDocument = () => ({
  active: true,
  claimCount: 3,
  eventEndAtMs: 1_700_007_200_000,
  eventId: EVENT_ID,
  eventStartAtMs: 1_700_000_000_000,
  memberEarlyAccessAtMs: 1_699_999_100_000,
  nextClaimNumber: 4,
  stateVersion: 7,
  state: {
    title: "Boiler Book Club Event",
    titleFont: "londrina-shadow",
    claimRulesText: "One item each.",
    qrUrl: "https://example.com/books",
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
    current: 10,
    groupStartedAt: null,
    roundStartedAt: null,
    last: 0,
    round: 1,
    finalCall: false,
    finalCallTargetNumbers: [],
    raffleOpen: false,
    raffleAllowStaff: false,
    raffleMembersOnly: false,
    raffleRequireOptIn: false,
    raffleMemberChances: 1,
    raffleAllowRepeatWinners: false,
    raffleSpinCount: 0,
    raffleSpinStartedAtMs: null,
    raffleWinnerNumber: 0,
    raffleWinnerNumbers: [],
  },
  timeframeEnd: "21:00",
  timeframeLabel: "7:00 PM - 9:00 PM",
  timeframeStart: "19:00",
  updatedAt: 1_700_000_000_000,
});

const claimDocument = (uid, number) => ({
  avatarUrl: "",
  claimedAt: 1_700_000_000_000,
  joinedAt: 1_700_000_000_000,
  discordUserId: uid,
  displayName: `Attendee ${uid}`,
  eventId: EVENT_ID,
  isMember: false,
  itemClaimedAtMsHistory: [],
  itemsClaimedCount: 0,
  number,
  participantType: "discord",
  qrToken: "qr-token-abcdefgh",
  redeemedRound: 0,
  updatedAt: 1_700_000_000_000,
});

const preclaimDocument = (uid) => ({
  avatarUrl: "",
  createdAt: 1_700_000_000_000,
  discordUserId: uid,
  displayName: `Attendee ${uid}`,
  eventId: EVENT_ID,
  isMember: false,
  memberEligibleAt: null,
  participantType: "discord",
  updatedAt: 1_700_000_000_000,
});

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-number-caller",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, ...LIVE_EVENT), {
      ...liveEventDocument(),
      claimAccessSecret: "legacy-value-should-not-be-here",
    });
    await setDoc(doc(db, ...LIVE_EVENT, "private", "claim-access"), {
      secret: "super-secret-rotating-value",
      updatedAt: 1_700_000_000_000,
    });
    await setDoc(doc(db, ...LIVE_EVENT, "feed", "feed-1"), {
      action: "is #1",
      avatarUrl: "",
      id: "feed-1",
      isMember: false,
      timestampMs: 1,
      username: "Attendee 1",
    });
    await setDoc(doc(db, ...LIVE_EVENT, "claims", claimPath("attendee-1")), claimDocument("attendee-1", 1));
    await setDoc(doc(db, ...LIVE_EVENT, "claims", claimPath("attendee-2")), claimDocument("attendee-2", 2));
    await setDoc(doc(db, ...LIVE_EVENT, "preclaims", claimPath("attendee-2")), preclaimDocument("attendee-2"));
  });
});

const anon = () => testEnv.unauthenticatedContext().firestore();
const attendee = (uid = "attendee-1") =>
  testEnv.authenticatedContext(uid, { member: false, staff: false }).firestore();
const member = (uid = "attendee-1") =>
  testEnv.authenticatedContext(uid, { member: true, staff: false }).firestore();
const staff = () =>
  testEnv.authenticatedContext("staff-1", { member: true, staff: true }).firestore();
// --- SEC-1: the rotating check-in secret is not publicly readable -------------

test("SEC-1: anyone may read the live event document (title, schedule, call state)", async () => {
  await assertSucceeds(getDoc(doc(anon(), ...LIVE_EVENT)));
});

test("SEC-1: the check-in secret is not readable by the public", async () => {
  await assertFails(getDoc(doc(anon(), ...LIVE_EVENT, "private", "claim-access")));
});

test("SEC-1: the check-in secret is not readable by a signed-in attendee", async () => {
  await assertFails(getDoc(doc(attendee(), ...LIVE_EVENT, "private", "claim-access")));
});

test("SEC-1: staff may read the check-in secret so the display can render its QR", async () => {
  await assertSucceeds(getDoc(doc(staff(), ...LIVE_EVENT, "private", "claim-access")));
});

test("SEC-1: a live event document carrying claimAccessSecret is rejected on write", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      claimAccessSecret: "put-it-back",
    }),
  );
});

// --- SEC-2 / SEC-3: attendees cannot mint claims or choose numbers ------------

test("SEC-3: an attendee cannot create a claim, so cannot pick their own number", async () => {
  await assertFails(
    setDoc(
      doc(attendee("attendee-9"), ...LIVE_EVENT, "claims", claimPath("attendee-9")),
      claimDocument("attendee-9", 1),
    ),
  );
});

test("SEC-3: an attendee cannot overwrite an existing claim to take its number", async () => {
  await assertFails(
    setDoc(
      doc(attendee("attendee-1"), ...LIVE_EVENT, "claims", claimPath("attendee-1")),
      claimDocument("attendee-1", 1),
    ),
  );
});

test("SEC-7: an attendee cannot promote themselves to member on their own claim", async () => {
  await assertFails(
    updateDoc(doc(attendee("attendee-1"), ...LIVE_EVENT, "claims", claimPath("attendee-1")), {
      isMember: true,
    }),
  );
});

test("SEC-8: an attendee cannot bump the event's number counter", async () => {
  await assertFails(
    updateDoc(doc(attendee(), ...LIVE_EVENT), { claimCount: 4, nextClaimNumber: 5 }),
  );
});

// --- SEC-4 / SEC-5: the queue cannot be self-declared or hijacked -------------

test("SEC-4: an attendee cannot queue themselves as a member", async () => {
  await assertFails(
    setDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "preclaims", claimPath("attendee-9")), {
      ...preclaimDocument("attendee-9"),
      isMember: true,
      memberEligibleAt: 0,
    }),
  );
});

test("SEC-4: even a real member cannot write their own eligibility time", async () => {
  await assertFails(
    setDoc(doc(member("attendee-9"), ...LIVE_EVENT, "preclaims", claimPath("attendee-9")), {
      ...preclaimDocument("attendee-9"),
      isMember: true,
      memberEligibleAt: 0,
    }),
  );
});

test("SEC-5: an attendee cannot overwrite somebody else's queue entry", async () => {
  await assertFails(
    setDoc(
      doc(attendee("attendee-1"), ...LIVE_EVENT, "preclaims", claimPath("attendee-2")),
      { ...preclaimDocument("attendee-1"), displayName: "Hijacked" },
      { merge: true },
    ),
  );
});

// --- SEC-6: attendees see their own records only -----------------------------

test("SEC-6: an attendee may read their own claim", async () => {
  await assertSucceeds(getDoc(doc(attendee("attendee-1"), ...LIVE_EVENT, "claims", claimPath("attendee-1"))));
});

test("SEC-6: an attendee cannot read another attendee's claim or QR token", async () => {
  await assertFails(getDoc(doc(attendee("attendee-1"), ...LIVE_EVENT, "claims", claimPath("attendee-2"))));
});

test("SEC-6: an attendee cannot list the roster", async () => {
  await assertFails(getDocs(collection(attendee(), ...LIVE_EVENT, "claims")));
});

test("staff may still list the roster", async () => {
  await assertSucceeds(getDocs(collection(staff(), ...LIVE_EVENT, "claims")));
});

test("staff may list the queue, and nobody else may", async () => {
  // The control panel holds a listener on this now rather than polling a
  // staff-gated callable every five seconds. Staff could already read the whole
  // queue through that callable, so this grants them nothing new — but it must
  // not have opened the queue to anyone else, and a queue entry carries a
  // Discord user id and a display name.
  await assertSucceeds(getDocs(collection(staff(), ...LIVE_EVENT, "preclaims")));
  await assertFails(getDocs(collection(attendee(), ...LIVE_EVENT, "preclaims")));
  await assertFails(getDocs(collection(anon(), ...LIVE_EVENT, "preclaims")));
});

// --- the attendee page's polling must keep working ---------------------------

test("an attendee may poll their own claim before it exists", async () => {
  const snapshot = await assertSucceeds(
    getDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "claims", claimPath("attendee-9"))),
  );
  assert.equal(snapshot.exists(), false);
});

test("an attendee may poll their own queue entry before it exists", async () => {
  const snapshot = await assertSucceeds(
    getDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "preclaims", claimPath("attendee-9"))),
  );
  assert.equal(snapshot.exists(), false);
});

test("an attendee may read their own queue entry", async () => {
  await assertSucceeds(
    getDoc(doc(attendee("attendee-2"), ...LIVE_EVENT, "preclaims", claimPath("attendee-2"))),
  );
});

// --- SEC-13: attendance is not enumerable by a signed-out probe --------------
//
// The allowance above for reading a document that does not exist used to apply
// to anonymous callers too. Claim IDs are derived from the Discord user ID and
// the event ID is on the publicly readable event document, so allowed-vs-denied
// on a probe told anyone whether a given person had checked in.

test("SEC-13: an anonymous client cannot probe for a claim that does not exist", async () => {
  await assertFails(getDoc(doc(anon(), ...LIVE_EVENT, "claims", claimPath("attendee-9"))));
});

test("SEC-13: an anonymous client cannot probe for a claim that does exist", async () => {
  await assertFails(getDoc(doc(anon(), ...LIVE_EVENT, "claims", claimPath("attendee-1"))));
});

test("SEC-13: an anonymous client cannot probe for a queue entry that does not exist", async () => {
  await assertFails(getDoc(doc(anon(), ...LIVE_EVENT, "preclaims", claimPath("attendee-9"))));
});

// --- SEC-14: attendance is not enumerable by a signed-in probe either --------
//
// SEC-13 above closed this off for anonymous callers. It stayed open for anybody
// holding any Discord account, which is a very low bar at a public event: the
// missing-document allowance was granted on being signed in, so a signed-in
// attacker could ask for claims/{eventId}__discord%3A{victim} and read the
// answer off the outcome — allowed-and-empty meant "has not checked in",
// permission-denied meant "has". The event id is on the world-readable event
// document and claim ids are derived from the Discord user id, so both halves
// were already in hand.
//
// canReadOwnRecord now decides on the requested id rather than on
// resource.data.discordUserId, which gives the same answer whether or not the
// document exists. The pair of tests below is the whole point: an attendee
// probing somebody else must be refused *identically* for a claim that exists
// and one that does not.

test("SEC-14: an attendee cannot probe another attendee's claim that does exist", async () => {
  await assertFails(
    getDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "claims", claimPath("attendee-1"))),
  );
});

test("SEC-14: an attendee cannot probe another attendee's claim that does not exist", async () => {
  await assertFails(
    getDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "claims", claimPath("attendee-404"))),
  );
});

test("SEC-14: an attendee cannot probe another attendee's queue entry that does exist", async () => {
  await assertFails(
    getDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "preclaims", claimPath("attendee-2"))),
  );
});

test("SEC-14: an attendee cannot probe another attendee's queue entry that does not exist", async () => {
  await assertFails(
    getDoc(doc(attendee("attendee-9"), ...LIVE_EVENT, "preclaims", claimPath("attendee-404"))),
  );
});

// A demo participant's claim is filed under `__demo%3A{n}` rather than under a
// Discord id, so no attendee's own id can ever match it. Previously these were
// readable-when-missing by anyone signed in.
test("SEC-14: an attendee cannot probe a demo participant's claim", async () => {
  await assertFails(
    getDoc(
      doc(
        attendee("attendee-9"),
        ...LIVE_EVENT,
        "claims",
        `${EVENT_ID}__${encodeURIComponent("demo:1")}`,
      ),
    ),
  );
});

// Staff read the roster a document at a time from the ticket preview, so the
// staff half of canReadOwnRecord has to keep working for somebody else's claim.
test("SEC-14: staff may still read any attendee's claim", async () => {
  await assertSucceeds(
    getDoc(doc(staff(), ...LIVE_EVENT, "claims", claimPath("attendee-1"))),
  );
});

// --- staff paths the control panel depends on --------------------------------

test("staff may start an event and write the check-in secret", async () => {
  await assertSucceeds(setDoc(doc(staff(), ...LIVE_EVENT), liveEventDocument()));
  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT, "private", "claim-access"), {
      secret: "rotated",
      updatedAt: 1_700_000_000_001,
    }),
  );
});

test("staff may advance the call state on an event started before this change", async () => {
  // beforeEach seeds a legacy document that still carries claimAccessSecret.
  // pushLiveState clears that field on every write, which is what keeps an
  // in-flight event advancing after these rules are deployed.
  const nextState = { ...liveEventDocument().state, current: 20, last: 10 };
  await assertSucceeds(
    updateDoc(doc(staff(), ...LIVE_EVENT), {
      state: nextState,
      updatedAt: 1,
      claimAccessSecret: deleteField(),
    }),
  );
});

test("SEC-1: a state write that leaves claimAccessSecret in place is rejected", async () => {
  const nextState = { ...liveEventDocument().state, current: 20, last: 10 };
  await assertFails(updateDoc(doc(staff(), ...LIVE_EVENT), { state: nextState, updatedAt: 1 }));
});

test("SEC-12: the activity feed is not readable by the public", async () => {
  await assertFails(getDocs(collection(anon(), ...LIVE_EVENT, "feed")));
});

test("SEC-12: the activity feed is not readable by a signed-in attendee", async () => {
  await assertFails(getDocs(collection(attendee(), ...LIVE_EVENT, "feed")));
});

test("the display, opened by staff, can still read the activity feed", async () => {
  await assertSucceeds(getDocs(collection(staff(), ...LIVE_EVENT, "feed")));
});

test("PERF-5: nobody can write feed items from a client", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT, "feed", "forged"), {
      action: "claimed an item",
      id: "forged",
      isMember: false,
      timestampMs: 2,
      username: "Nobody",
    }),
  );
});

test("BUG-3: a state write may carry a bumped stateVersion", async () => {
  const nextState = { ...liveEventDocument().state, current: 20, last: 10 };
  await assertSucceeds(
    updateDoc(doc(staff(), ...LIVE_EVENT), {
      state: nextState,
      stateVersion: 8,
      updatedAt: 1,
      claimAccessSecret: deleteField(),
    }),
  );
});

test("BUG-1: absolute schedule timestamps are accepted on the event document", async () => {
  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      eventEndAtMs: 1_700_100_000_000,
      eventStartAtMs: 1_700_090_000_000,
      memberEarlyAccessAtMs: 1_700_089_100_000,
    }),
  );
});

// --- state validation: fields that were in the allowlist but never checked ---

test("SEC-14: a huge finalCallTargetNumbers list is rejected", async () => {
  // The one field on this world-readable document that grows with attendance.
  // Uncapped, it could be grown past the 1 MB document limit, after which every
  // write to the event fails and the event freezes.
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: {
        ...liveEventDocument().state,
        finalCallTargetNumbers: Array.from({ length: 1001 }, (_unused, index) => index + 1),
      },
    }),
  );
});

test("SEC-14: a realistically sized finalCallTargetNumbers list is still accepted", async () => {
  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: {
        ...liveEventDocument().state,
        finalCallTargetNumbers: Array.from({ length: 300 }, (_unused, index) => index + 1),
      },
    }),
  );
});

test("SEC-14: the retired finalCallTargetClaimIds list is no longer accepted", async () => {
  /*
   * It held claim ids, and a claim id carries the attendee's Discord user id —
   * on a document the whole internet can read, for the length of every final
   * call. Replaced by finalCallTargetNumbers, and accepted for one release only
   * so a staff tab open on the older build was not locked out mid-event.
   *
   * That release has shipped. Nothing writes it now, so the allowlist should
   * not still admit a field whose whole purpose was leaking attendance.
   */
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: {
        ...liveEventDocument().state,
        finalCallTargetClaimIds: Array.from({ length: 3 }, (_unused, index) => `claim-${index}`),
      },
    }),
  );
});

test("SEC-14: an overlong titleFont is rejected", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: { ...liveEventDocument().state, titleFont: "x".repeat(65) },
    }),
  );
});

test("SEC-14: groupStartedAt must be an integer when set", async () => {
  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: { ...liveEventDocument().state, groupStartedAt: 1_700_000_000_000 },
    }),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: { ...liveEventDocument().state, groupStartedAt: "not-a-timestamp" },
    }),
  );
});

// The whole state map the control panel actually writes, as normalizeState
// emits it. The fixture above is that payload, so this is the regression guard
// for a field the client sends being missing from the rules' allowlist: that
// rejects every state write, and the display stops following the control panel
// entirely — no group advances, no handover to the raffle.
test("the full state payload the control panel writes is accepted", async () => {
  await assertSucceeds(
    updateDoc(doc(staff(), ...LIVE_EVENT), {
      state: {
        ...liveEventDocument().state,
        current: 20,
        groupStartedAt: 1_700_000_000_000,
        roundStartedAt: 1_700_000_000_000,
        raffleOpen: true,
      },
      stateVersion: 8,
      updatedAt: 1,
      claimAccessSecret: deleteField(),
    }),
  );
});

test("roundStartedAt must be an integer when set", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      state: { ...liveEventDocument().state, roundStartedAt: "not-a-timestamp" },
    }),
  );
});

test("SEC-1: staff cannot write a private document other than claim-access", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT, "private", "something-else"), {
      secret: "smuggled",
      updatedAt: 1_700_000_000_000,
    }),
  );
});

test("SEC-1: staff cannot read a private document other than claim-access", async () => {
  await assertFails(getDoc(doc(staff(), ...LIVE_EVENT, "private", "something-else")));
});

test("BUG-9: the archive is unreachable from clients", async () => {
  await assertFails(getDoc(doc(staff(), "eventArchives", EVENT_ID)));
  await assertFails(getDoc(doc(attendee(), "eventArchives", EVENT_ID)));
});

// --- demo events: the flag that keeps a rehearsal out of Past Events ---------

const demoConfig = () => ({
  memberPercent: 40,
  participantCount: 24,
  pickupChancePercent: 80,
  preStartPercent: 60,
});

test("staff may start an event flagged as a demo", async () => {
  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      demo: demoConfig(),
      isDemo: true,
    }),
  );
});

test("a demo event's settings must be in range, so the seeder cannot be pointed at a crowd", async () => {
  for (const demo of [
    { ...demoConfig(), participantCount: 5000 },
    { ...demoConfig(), participantCount: 0 },
    { ...demoConfig(), memberPercent: 101 },
    { ...demoConfig(), preStartPercent: -1 },
    { ...demoConfig(), pickupChancePercent: "most" },
    { ...demoConfig(), unexpectedField: 1 },
  ]) {
    await assertFails(
      setDoc(doc(staff(), ...LIVE_EVENT), { ...liveEventDocument(), demo, isDemo: true }),
    );
  }
});

test("the demo flag has to be a boolean", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      demo: demoConfig(),
      isDemo: "yes",
    }),
  );
});

test("an attendee cannot mark the live event as a demo to erase its record", async () => {
  await assertFails(
    updateDoc(doc(attendee(), ...LIVE_EVENT), { isDemo: true, demo: demoConfig() }),
  );
});

test("advancing a demo event's call state keeps its flag intact", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      demo: demoConfig(),
      isDemo: true,
    });
  });

  const nextState = { ...liveEventDocument().state, current: 20, last: 10 };
  await assertSucceeds(
    updateDoc(doc(staff(), ...LIVE_EVENT), { state: nextState, stateVersion: 8, updatedAt: 1 }),
  );
});

test("staff may pause a demo, and the flag lives on the event so every panel sees it", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      demo: demoConfig(),
      isDemo: true,
    });
  });

  await assertSucceeds(updateDoc(doc(staff(), ...LIVE_EVENT), { isDemoPaused: true, updatedAt: 2 }));
});

test("the pause flag has to be a boolean", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), {
      ...liveEventDocument(),
      demo: demoConfig(),
      isDemo: true,
      isDemoPaused: "maybe",
    }),
  );
});

test("an attendee cannot pause or resume a demo", async () => {
  await assertFails(updateDoc(doc(attendee(), ...LIVE_EVENT), { isDemoPaused: true }));
});

// --- the prize raffle ---------------------------------------------------------

const liveEventWithRaffleState = (raffleState) => {
  const base = liveEventDocument();

  return { ...base, state: { ...base.state, ...raffleState } };
};

test("staff may open the raffle and record a winner", async () => {
  await assertSucceeds(
    setDoc(
      doc(staff(), ...LIVE_EVENT),
      liveEventWithRaffleState({
        raffleOpen: true,
        raffleSpinCount: 1,
        raffleSpinStartedAtMs: 1_700_000_000_000,
        raffleWinnerNumber: 2,
        raffleWinnerNumbers: [2],
      }),
    ),
  );
});

/* Staff numbers are negative on purpose — see src/staffNumbers.js — so a staff
   member drawn out of the wheel has to be recordable as the winner. */
test("a staff member can be recorded as the raffle winner", async () => {
  await assertSucceeds(
    setDoc(
      doc(staff(), ...LIVE_EVENT),
      liveEventWithRaffleState({
        raffleAllowStaff: true,
        raffleOpen: true,
        raffleSpinCount: 1,
        raffleSpinStartedAtMs: 1_700_000_000_000,
        raffleWinnerNumber: -2,
        raffleWinnerNumbers: [-2],
      }),
    ),
  );
});

test("staff numbering rides on its own counter", async () => {
  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT), { ...liveEventDocument(), nextStaffNumber: 3 }),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), { ...liveEventDocument(), nextStaffNumber: 0 }),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), { ...liveEventDocument(), nextStaffNumber: "3" }),
  );
});

test("an attendee cannot declare themselves a raffle winner", async () => {
  await assertFails(
    setDoc(
      doc(attendee(), ...LIVE_EVENT),
      liveEventWithRaffleState({ raffleOpen: true, raffleWinnerNumbers: [1] }),
    ),
  );
});

test("an event started before the raffle existed still accepts state writes", async () => {
  const legacyState = { ...liveEventDocument().state };

  delete legacyState.raffleOpen;
  delete legacyState.raffleMembersOnly;
  delete legacyState.raffleRequireOptIn;
  delete legacyState.raffleMemberChances;
  delete legacyState.raffleAllowRepeatWinners;
  delete legacyState.raffleSpinCount;
  delete legacyState.raffleSpinStartedAtMs;
  delete legacyState.raffleWinnerNumber;
  delete legacyState.raffleWinnerNumbers;

  await assertSucceeds(
    setDoc(doc(staff(), ...LIVE_EVENT), { ...liveEventDocument(), state: legacyState }),
  );
});

test("the raffle winner list is capped so it cannot be grown until writes fail", async () => {
  await assertFails(
    setDoc(
      doc(staff(), ...LIVE_EVENT),
      liveEventWithRaffleState({
        raffleWinnerNumbers: Array.from({ length: 501 }, (_, index) => index + 1),
      }),
    ),
  );
});

test("raffle fields are type-checked", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleOpen: "yes" })),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleWinnerNumber: "1" })),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleAllowStaff: "yes" })),
  );
  await assertFails(
    setDoc(
      doc(staff(), ...LIVE_EVENT),
      liveEventWithRaffleState({ raffleWinnerNumbers: "1,2,3" }),
    ),
  );
});

test("an unknown state field is still rejected alongside the raffle ones", async () => {
  await assertFails(
    setDoc(
      doc(staff(), ...LIVE_EVENT),
      liveEventWithRaffleState({ raffleSecretBackdoor: true }),
    ),
  );
});

test("staff may require attendees to join the raffle and weight members", async () => {
  await assertSucceeds(
    setDoc(
      doc(staff(), ...LIVE_EVENT),
      liveEventWithRaffleState({ raffleRequireOptIn: true, raffleMemberChances: 4 }),
    ),
  );
});

/* The seed setting is gone from the app, and was accepted for one release so a
   staff tab on the older build was not locked out mid-event. That release has
   shipped, so the allowlist no longer carries a field nothing writes. */
test("the retired wheel seed is no longer accepted", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleSeed: 42 })),
  );
});

test("member chances are bounded by the rules, not just the slider", async () => {
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleMemberChances: 0 })),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleMemberChances: 50 })),
  );
  await assertFails(
    setDoc(doc(staff(), ...LIVE_EVENT), liveEventWithRaffleState({ raffleRequireOptIn: "yes" })),
  );
});

test("SEC: an attendee cannot join the raffle by writing their own claim", async () => {
  await assertFails(
    updateDoc(doc(attendee(), ...LIVE_EVENT, "claims", claimPath("attendee-1")), {
      raffleJoinedAtMs: 1_700_000_000_000,
    }),
  );
});

// --- the private collections -------------------------------------------------

test("a signed-in attendee may read their own claim", async () => {
  await assertSucceeds(getDoc(doc(attendee(), ...LIVE_EVENT, "claims", claimPath("attendee-1"))));
});

