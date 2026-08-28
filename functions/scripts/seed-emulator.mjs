/**
 * Seeds the local emulator with a live event and a few attendees.
 *
 * Run against the emulator suite only — it talks to the Firestore emulator via
 * FIRESTORE_EMULATOR_HOST and will refuse to run without it, so it can never
 * touch a real project.
 *
 *   npm run emulators        # in one terminal
 *   npm run seed             # in another
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "Refusing to run: FIRESTORE_EMULATOR_HOST is not set.\n" +
      "Start the emulators first (npm run emulators), then run npm run seed.",
  );
  process.exit(1);
}

const EVENT_ID = "dev-event";
const LIVE_EVENT_PATH = "events/live-number-caller";
const CLAIM_ACCESS_SECRET = "dev-claim-access-secret";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-number-caller" });
const db = getFirestore();

const now = new Date();
const startOfToday = new Date(now);
startOfToday.setHours(now.getHours(), now.getMinutes(), 0, 0);
const pad = (value) => String(value).padStart(2, "0");
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const endTime = new Date(startOfToday.getTime() + 2 * 60 * 60 * 1000);

const attendee = (index, overrides = {}) => ({
  avatarUrl: "",
  claimedAt: Date.now(),
  joinedAt: Date.now() - index * 60_000,
  discordUserId: `20000000000000000${index}`,
  displayName: `Test Attendee ${index}`,
  eventId: EVENT_ID,
  isMember: index % 3 === 0,
  itemClaimedAtMsHistory: [],
  itemsClaimedCount: 0,
  number: index,
  participantType: "discord",
  qrToken: `dev-qr-token-${index}`,
  redeemedRound: 0,
  updatedAt: Date.now(),
  ...overrides,
});

const attendeeCount = 12;

await db.doc(LIVE_EVENT_PATH).set({
  active: true,
  claimCount: attendeeCount,
  eventEndAtMs: endTime.getTime(),
  eventId: EVENT_ID,
  eventStartAtMs: startOfToday.getTime(),
  memberEarlyAccessAtMs: startOfToday.getTime() - 15 * 60_000,
  nextClaimNumber: attendeeCount + 1,
  startedAt: new Date(),
  stateVersion: 1,
  timeframeEnd: clock(endTime),
  timeframeLabel: `${clock(startOfToday)} - ${clock(endTime)}`,
  timeframeStart: clock(startOfToday),
  updatedAt: Date.now(),
  state: {
    title: "DEV BOOK CLUB EVENT",
    titleFont: "londrina-shadow",
    claimRulesText: "Take one item when your number is called.\nShow staff your QR code.",
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
    groupSize: 5,
    memberCheckInLeadMinutes: 15,
    current: 0,
    groupStartedAt: null,
    last: 0,
    round: 1,
    finalCall: false,
    finalCallTargetNumbers: [],
  },
});

await db.doc(`${LIVE_EVENT_PATH}/private/claim-access`).set({
  secret: CLAIM_ACCESS_SECRET,
  updatedAt: Date.now(),
});

const batch = db.batch();
for (let index = 1; index <= attendeeCount; index += 1) {
  const claimId = `${EVENT_ID}__${encodeURIComponent(`discord:20000000000000000${index}`)}`;
  batch.set(db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`), attendee(index));
}
await batch.commit();

// Same rotating-code algorithm as src/claimAccess.js, so the printed link is
// one the emulated callables will actually accept.
const hashClaimAccessValue = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 8);
};
const code = hashClaimAccessValue(`${CLAIM_ACCESS_SECRET}:${Math.floor(Date.now() / 60_000)}`);

console.log(`Seeded a live event with ${attendeeCount} attendees.

  Control panel   http://localhost:5173/control
  Display         http://localhost:5173/display
  Attendee        http://localhost:5173/?claim=${code}

The attendee link's code rotates every 60 seconds; re-run "npm run seed" for a
fresh one, or copy the current QR code off the display.

Sign in without Discord by running this in the browser console, then reloading:

  localStorage.setItem("devLogin", "dev:staff");

Use "dev:member" or "dev:guest" to test the attendee side.
`);
