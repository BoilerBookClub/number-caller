import { DEFAULT_CLAIM_RULES_TEXT, normalizeClaimRulesText } from "./claimRules.js";
import { initialDemoConfig, normalizeDemoConfig } from "./demoEvent.js";
import {
  normalizeRaffleMemberChances,
  normalizeRaffleWinnerNumbers,
} from "./raffle.js";
import { DEFAULT_TITLE_FONT, normalizeTitleFont } from "./titleFonts.js";

/**
 * The shape of a live event and the normalisers that keep it honest.
 *
 * Extracted from App.jsx, which had grown to hold routing, auth, the claim
 * lifecycle, the scanner, auto-advance and every one of these helpers in a
 * single 2,800-line component.
 */
export const defaultQrUrl =
  "https://www.boilerbookclub.com/announcements/";
const DEFAULT_GROUP_SIZE = 10;
/* Shared by the group timer and the final call timer, which run on the same
   1-10 minute slider. */
const DEFAULT_AUTO_ADVANCE_TIMER_MINUTES = 5;
/* Matches the ceiling in firestore.rules. Kept in step by hand: the rules
   cannot import this, and a list over the cap is rejected outright rather than
   trimmed, which would fail a final call with nothing on screen to explain it. */
const MAX_FINAL_CALL_TARGETS = 1000;

export const initialState = {
  title: "BOILER BOOK CLUB EVENT",
  titleFont: DEFAULT_TITLE_FONT,
  claimRulesText: DEFAULT_CLAIM_RULES_TEXT,
  qrUrl: defaultQrUrl,
  /* The activity feed in the bottom-left of the display. On by default: it is
     how a room sees that check-ins and pickups are landing. Staff can turn it
     off for a venue where names and avatars on a projector are unwelcome — it
     is the only place on the display that shows either. */
  displayFeedEnabled: true,
  autoAdvanceEnabled: false,
  autoAdvanceBacklogLimitEnabled: false,
  /* How much of the backlog has to be cleared before auto-advance resumes,
     as a percentage of everyone already called this round. */
  autoAdvanceBacklogClearedPercent: 50,
  autoAdvanceFinalCallTimerEnabled: false,
  autoAdvanceFinalCallTimerMinutes: DEFAULT_AUTO_ADVANCE_TIMER_MINUTES,
  autoAdvanceGroupTimerEnabled: false,
  autoAdvanceGroupTimerMinutes: DEFAULT_AUTO_ADVANCE_TIMER_MINUTES,
  autoAdvanceNextGroup: true,
  autoAdvanceStartRound: false,
  autoAdvanceStartRoundMinutes: DEFAULT_AUTO_ADVANCE_TIMER_MINUTES,
  autoAdvanceThresholdPercent: 80,
  groupSize: DEFAULT_GROUP_SIZE,
  memberCheckInLeadMinutes: 15,
  current: 0,
  groupStartedAt: null,
  roundStartedAt: null,
  last: 0,
  round: 1,
  finalCall: false,
  /* Attendee numbers, never claim ids. This state rides on the live event
     document, which is world-readable, and a claim id carries the attendee's
     Discord user id — publishing one per outstanding attendee for the length of
     every final call is exactly what the raffle winner list avoids by holding
     numbers. See src/raffle.js. */
  finalCallTargetNumbers: [],
  /* The prize raffle. See src/raffle.js for why the winners are held as
     numbers: this document is world-readable, and a claim id is not. */
  raffleOpen: false,
  /* Off by default: staff are not in the draw unless somebody deliberately
     puts them there. See src/staffNumbers.js. */
  raffleAllowStaff: false,
  raffleMembersOnly: false,
  /* Off by default: a raffle draws from everybody unless staff decide people
     have to put themselves forward for it. */
  raffleRequireOptIn: false,
  /* How many entries a member gets to a guest's one. 1 is no advantage. */
  raffleMemberChances: 1,
  raffleAllowRepeatWinners: false,
  raffleSpinCount: 0,
  raffleSpinStartedAtMs: null,
  raffleWinnerNumber: 0,
  raffleWinnerNumbers: [],
};

export const initialControlForm = {
  title: "",
  titleFont: initialState.titleFont,
  claimRulesText: initialState.claimRulesText,
  qrUrl: initialState.qrUrl,
  displayFeedEnabled: initialState.displayFeedEnabled,
  memberCheckInLeadMinutes: String(initialState.memberCheckInLeadMinutes),
  timeframeStart: "19:00",
  timeframeEnd: "21:00",
  /* Demo settings live on the create form only. Editing a live event cannot
     turn a real event into a demo one, or the other way round: the flag decides
     whether the attendee list is kept when it closes. */
  isDemo: false,
  /* Device preference, not event data — see src/useKeepScreenAwake.js. It rides
     along on the create form because starting an event is the moment staff know
     whether these screens are about to sit untouched on a projector, and it is
     applied to the stored preference once the event is created. On by default:
     the form is reset to these values whenever no event is live, so every
     create arms it again even if the last event turned it off. */
  keepScreenAwake: true,
  demoMemberPercent: String(initialDemoConfig.memberPercent),
  demoParticipantCount: String(initialDemoConfig.participantCount),
  demoPickupChancePercent: String(initialDemoConfig.pickupChancePercent),
  demoPreStartPercent: String(initialDemoConfig.preStartPercent),
};

/** The create form's demo fields, as the event document stores them. */
export const buildDemoConfigFromForm = (controlForm) =>
  normalizeDemoConfig({
    memberPercent: controlForm?.demoMemberPercent,
    participantCount: controlForm?.demoParticipantCount,
    pickupChancePercent: controlForm?.demoPickupChancePercent,
    preStartPercent: controlForm?.demoPreStartPercent,
  });

export const normalizeMemberCheckInLeadMinutes = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return initialState.memberCheckInLeadMinutes;
  }

  return Math.max(0, Math.min(60, parsedValue));
};

export const normalizeAutoAdvanceThresholdPercent = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 10 || parsedValue > 100) {
    return initialState.autoAdvanceThresholdPercent;
  }

  return parsedValue;
};

export const normalizeAutoAdvanceTimerMinutes = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 10) {
    return DEFAULT_AUTO_ADVANCE_TIMER_MINUTES;
  }

  return parsedValue;
};

export const normalizeAutoAdvanceBacklogClearedPercent = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 10 || parsedValue > 100) {
    return initialState.autoAdvanceBacklogClearedPercent;
  }

  return parsedValue;
};

export const normalizeGroupSize = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 20) {
    return initialState.groupSize;
  }

  return parsedValue;
};

export const normalizeNonNegativeInteger = (value, fallbackValue) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallbackValue;
  }

  return parsedValue;
};

/**
 * A claim number, which is positive for an attendee and negative for staff.
 *
 * Separate from normalizeNonNegativeInteger because that one floors a staff
 * number to 0 — and 0 means "no number", so every staff member would come back
 * from the roster wearing the same non-identity.
 */
export const normalizeClaimNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number.parseInt(value, 10);

  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

export const normalizeState = (nextState) => {
  const mergedState = {
    ...initialState,
    ...nextState,
  };
  const normalizedThreshold = normalizeAutoAdvanceThresholdPercent(
    mergedState.autoAdvanceThresholdPercent,
  );
  const normalizedTimerMinutes = normalizeAutoAdvanceTimerMinutes(
    mergedState.autoAdvanceFinalCallTimerMinutes,
  );
  const normalizedGroupTimerMinutes = normalizeAutoAdvanceTimerMinutes(
    mergedState.autoAdvanceGroupTimerMinutes,
  );
  const normalizedStartRoundMinutes = normalizeAutoAdvanceTimerMinutes(
    mergedState.autoAdvanceStartRoundMinutes,
  );
  const normalizedBacklogClearedPercent = normalizeAutoAdvanceBacklogClearedPercent(
    mergedState.autoAdvanceBacklogClearedPercent,
  );
  const normalizedGroupSize = normalizeGroupSize(mergedState.groupSize);
  const normalizedTitle =
    typeof mergedState.title === "string" && mergedState.title.trim()
      ? mergedState.title
      : initialState.title;
  const normalizedQrUrl =
    typeof mergedState.qrUrl === "string" ? mergedState.qrUrl : initialState.qrUrl;
  /* Capped as well as filtered, because the security rules cap it too: an
     uncapped list on a document rewritten by every check-in can be grown until
     writes start failing, and a final call over the cap would simply be
     rejected with nothing on screen to say why. */
  const normalizedFinalCallTargetNumbers = Array.isArray(mergedState.finalCallTargetNumbers)
    ? [
        ...new Set(
          mergedState.finalCallTargetNumbers
            .map((value) => Number.parseInt(value, 10))
            /* Non-zero rather than positive so the shape matches every other
               number on this document, even though final call never targets
               staff — see activateFinalCall. */
            .filter((value) => Number.isFinite(value) && value !== 0),
        ),
      ].slice(0, MAX_FINAL_CALL_TARGETS)
    : initialState.finalCallTargetNumbers;

  return {
    title: normalizedTitle,
    titleFont: normalizeTitleFont(mergedState.titleFont),
    claimRulesText: normalizeClaimRulesText(mergedState.claimRulesText),
    qrUrl: normalizedQrUrl,
    displayFeedEnabled:
      typeof mergedState.displayFeedEnabled === "boolean"
        ? mergedState.displayFeedEnabled
        : initialState.displayFeedEnabled,
    autoAdvanceEnabled:
      typeof mergedState.autoAdvanceEnabled === "boolean"
        ? mergedState.autoAdvanceEnabled
        : normalizedThreshold > 0,
    autoAdvanceBacklogLimitEnabled:
      typeof mergedState.autoAdvanceBacklogLimitEnabled === "boolean"
        ? mergedState.autoAdvanceBacklogLimitEnabled
        : initialState.autoAdvanceBacklogLimitEnabled,
    autoAdvanceBacklogClearedPercent: normalizedBacklogClearedPercent,
    autoAdvanceFinalCallTimerEnabled:
      typeof mergedState.autoAdvanceFinalCallTimerEnabled === "boolean"
        ? mergedState.autoAdvanceFinalCallTimerEnabled
        : initialState.autoAdvanceFinalCallTimerEnabled,
    autoAdvanceFinalCallTimerMinutes: normalizedTimerMinutes,
    autoAdvanceGroupTimerEnabled:
      typeof mergedState.autoAdvanceGroupTimerEnabled === "boolean"
        ? mergedState.autoAdvanceGroupTimerEnabled
        : initialState.autoAdvanceGroupTimerEnabled,
    autoAdvanceGroupTimerMinutes: normalizedGroupTimerMinutes,
    autoAdvanceNextGroup:
      typeof mergedState.autoAdvanceNextGroup === "boolean"
        ? mergedState.autoAdvanceNextGroup
        : initialState.autoAdvanceNextGroup,
    autoAdvanceStartRound:
      typeof mergedState.autoAdvanceStartRound === "boolean"
        ? mergedState.autoAdvanceStartRound
        : initialState.autoAdvanceStartRound,
    autoAdvanceStartRoundMinutes: normalizedStartRoundMinutes,
    autoAdvanceThresholdPercent: normalizedThreshold,
    groupSize: normalizedGroupSize,
    memberCheckInLeadMinutes: normalizeMemberCheckInLeadMinutes(
      mergedState.memberCheckInLeadMinutes,
    ),
    current: normalizeNonNegativeInteger(mergedState.current, initialState.current),
    groupStartedAt: mergedState.groupStartedAt ?? initialState.groupStartedAt,
    roundStartedAt: mergedState.roundStartedAt ?? initialState.roundStartedAt,
    last: normalizeNonNegativeInteger(mergedState.last, initialState.last),
    round: normalizeNonNegativeInteger(mergedState.round, initialState.round),
    finalCall:
      typeof mergedState.finalCall === "boolean"
        ? mergedState.finalCall
        : initialState.finalCall,
    finalCallTargetNumbers: normalizedFinalCallTargetNumbers,
    raffleOpen:
      typeof mergedState.raffleOpen === "boolean"
        ? mergedState.raffleOpen
        : initialState.raffleOpen,
    raffleAllowStaff:
      typeof mergedState.raffleAllowStaff === "boolean"
        ? mergedState.raffleAllowStaff
        : initialState.raffleAllowStaff,
    raffleMembersOnly:
      typeof mergedState.raffleMembersOnly === "boolean"
        ? mergedState.raffleMembersOnly
        : initialState.raffleMembersOnly,
    raffleRequireOptIn:
      typeof mergedState.raffleRequireOptIn === "boolean"
        ? mergedState.raffleRequireOptIn
        : initialState.raffleRequireOptIn,
    raffleMemberChances: normalizeRaffleMemberChances(mergedState.raffleMemberChances),
    raffleAllowRepeatWinners:
      typeof mergedState.raffleAllowRepeatWinners === "boolean"
        ? mergedState.raffleAllowRepeatWinners
        : initialState.raffleAllowRepeatWinners,
    raffleSpinCount: normalizeNonNegativeInteger(
      mergedState.raffleSpinCount,
      initialState.raffleSpinCount,
    ),
    // Stamped by whichever control panel pressed Spin, the same way
    // groupStartedAt is, so every screen can work out how much of the spin is
    // left rather than starting its own animation from scratch.
    raffleSpinStartedAtMs: Number.isFinite(mergedState.raffleSpinStartedAtMs)
      ? Math.trunc(mergedState.raffleSpinStartedAtMs)
      : initialState.raffleSpinStartedAtMs,
    raffleWinnerNumber: normalizeClaimNumber(
      mergedState.raffleWinnerNumber,
      initialState.raffleWinnerNumber,
    ),
    raffleWinnerNumbers: normalizeRaffleWinnerNumbers(mergedState.raffleWinnerNumbers),
  };
};

/*
 * Two control panels editing one event.
 *
 * Every write from a panel is built as a whole state object on top of whatever
 * that panel last saw, so sending it verbatim means sending a stale copy of
 * every field the panel did not touch. That used to be guarded with a version
 * check that refused the write outright, which turned every ordinary overlap —
 * a slider on one panel, auto-advance ticking on another, two staff screens
 * running the same auto-advance — into a refused change and a dialog about a
 * conflict staff could do nothing about.
 *
 * Instead the write is reduced to the fields it actually changed and those are
 * applied over the newest state on the server. Nothing is refused and nothing
 * is lost: the panel that moved the queue moves the queue, and the panel that
 * moved a slider moves the slider.
 */

/* The fields a write has to carry together, because one of them alone does not
   describe a queue or a raffle draw. Advancing the group while another panel
   was in final call has to end the final call and drop its target list, or the
   merged result is a group that has been called underneath a final call
   banner. Everything outside these groups is an independent setting and merges
   on its own. */
const STATE_FIELD_GROUPS = [
  [
    "current",
    "finalCall",
    "finalCallTargetNumbers",
    "groupStartedAt",
    "last",
    "round",
    "roundStartedAt",
  ],
  [
    "raffleOpen",
    "raffleSpinCount",
    "raffleSpinStartedAtMs",
    "raffleWinnerNumber",
    "raffleWinnerNumbers",
  ],
];

/* normalizeState only ever produces primitives and flat arrays of numbers, so
   this is as deep as equality needs to go. */
const isSameStateValue = (leftValue, rightValue) => {
  if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
    return (
      Array.isArray(leftValue) &&
      Array.isArray(rightValue) &&
      leftValue.length === rightValue.length &&
      leftValue.every((value, index) => value === rightValue[index])
    );
  }

  return leftValue === rightValue;
};

/**
 * What a write actually changes, as the fields that differ from the state it
 * was built on. Passing no base state means the caller is replacing the whole
 * state rather than editing one, so every field counts as changed.
 */
export const getStateChanges = (baseState, nextState) => {
  const normalizedNextState = normalizeState(nextState);

  if (!baseState) {
    return { ...normalizedNextState };
  }

  const normalizedBaseState = normalizeState(baseState);
  const changes = {};

  for (const field of Object.keys(normalizedNextState)) {
    if (!isSameStateValue(normalizedBaseState[field], normalizedNextState[field])) {
      changes[field] = normalizedNextState[field];
    }
  }

  for (const group of STATE_FIELD_GROUPS) {
    if (group.some((field) => field in changes)) {
      for (const field of group) {
        changes[field] = normalizedNextState[field];
      }
    }
  }

  return changes;
};

/** The result of that write landing on whatever state is current now. */
export const applyStateChanges = (currentState, changes) =>
  normalizeState({ ...normalizeState(currentState), ...changes });

/**
 * Whether the fields a write depends on are still what it read.
 *
 * Merging is the right answer for almost everything, but not for a write whose
 * whole point is that it happens once — drawing a raffle winner, stamping a
 * missing timestamp. Those name the fields they are racing on, and the write is
 * dropped rather than merged if another panel got there first.
 */
export const hasUnchangedStateFields = (baseState, currentState, fields) => {
  if (!fields?.length || !baseState) {
    return true;
  }

  const normalizedBaseState = normalizeState(baseState);
  const normalizedCurrentState = normalizeState(currentState);

  return fields.every((field) =>
    isSameStateValue(normalizedBaseState[field], normalizedCurrentState[field]),
  );
};

export const normalizeLiveEvent = (nextEvent) => ({
  active: false,
  claimCount: 0,
  /* The schedule as absolute instants, resolved by the staff browser in the
     venue's timezone when the event was created or edited. Defaulted here so
     getEventSchedule can tell "this event predates them" from "this field just
     is not on the object yet" and fall back to the clock-time strings only in
     the first case. */
  eventEndAtMs: null,
  eventId: null,
  eventStartAtMs: null,
  memberEarlyAccessAtMs: null,
  nextClaimNumber: 1,
  nextStaffNumber: 1,
  timeframeEnd: "",
  timeframeLabel: "",
  timeframeStart: "",
  ...nextEvent,
  demo: normalizeDemoConfig(nextEvent?.demo),
  isDemo: nextEvent?.isDemo === true,
  isDemoPaused: nextEvent?.isDemoPaused === true,
  state: normalizeState(nextEvent?.state),
});

export const getTimestampMs = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
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

const getTimestampMsList = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => getTimestampMs(value))
    .filter((value) => Number.isFinite(value))
    .sort((leftValue, rightValue) => leftValue - rightValue);
};

export const normalizeClaimRecord = (claimId, nextClaim) => {
  if (!nextClaim) {
    return null;
  }

  return {
    claimId,
    displayName: "",
    eventId: null,
    number: 0,
    qrToken: "",
    redeemedRound: 0,
    ...nextClaim,
  };
};

export const buildClaimResultFromRecord = (claimRecord) => {
  if (!claimRecord) {
    return null;
  }

  return {
    claimId: claimRecord.claimId,
    existing: true,
    isMember: claimRecord.isMember ?? false,
    isStaff: claimRecord.isStaff === true,
    itemsClaimedCount: normalizeNonNegativeInteger(claimRecord.itemsClaimedCount, 0),
    number: normalizeClaimNumber(claimRecord.number, 0),
    qrToken: claimRecord.qrToken ?? "",
    redeemedRound: normalizeNonNegativeInteger(claimRecord.redeemedRound, 0),
  };
};

export const normalizeRosterClaim = (nextClaim) => {
  const storedDisplayName = nextClaim.displayName?.trim() ?? "";
  const resolvedDisplayName =
    !storedDisplayName
      ? nextClaim.discordUserId || "Unknown attendee"
      : storedDisplayName;

  return {
    claimId: nextClaim.claimId,
    avatarUrl: nextClaim.avatarUrl ?? "",
    claimedAtMs: getTimestampMs(nextClaim.claimedAt),
    joinedAtMs: getTimestampMs(nextClaim.joinedAt),
    displayName: resolvedDisplayName,
    discordUserId: nextClaim.discordUserId ?? null,
    eventId: nextClaim.eventId ?? null,
    isMember: nextClaim.isMember ?? false,
    // Staff run the event rather than queue in it. Read from the flag or from
    // a number below zero, so a claim written before the flag existed still
    // reads correctly off the number it was given.
    isStaff: nextClaim.isStaff === true || normalizeClaimNumber(nextClaim.number, 0) < 0,
    itemClaimedAtMsHistory: getTimestampMsList(nextClaim.itemClaimedAtMsHistory),
    itemsClaimedCount: normalizeNonNegativeInteger(nextClaim.itemsClaimedCount, 0),
    number: normalizeClaimNumber(nextClaim.number, 0),
    participantType: nextClaim.participantType ?? "discord",
    // A raffle prize handed over. Kept well apart from the item-claim fields
    // below it — nothing derived from this reaches the graphs or the metrics.
    raffleClaimedAtMs: getTimestampMs(nextClaim.raffleClaimedAtMs),
    // When they put themselves forward for the raffle, if opt-in is on.
    raffleJoinedAtMs: getTimestampMs(nextClaim.raffleJoinedAtMs),
    // Staff-only by security rule, and staff need it for two things: rendering
    // an attendee's QR code from the roster when their phone cannot, and
    // standing in for a demo participant's phone at pickup time.
    qrToken: nextClaim.qrToken ?? "",
    redeemedAtMs: getTimestampMs(nextClaim.redeemedAt),
    redeemedRound: normalizeNonNegativeInteger(nextClaim.redeemedRound, 0),
  };
};

export const buildEventId = () =>
  globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}`;
