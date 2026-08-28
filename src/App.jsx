import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import sound from "/sound.mp3";
import "./App.css";
import AppHeader from "./components/AppHeader";
import AttendeeTicketPage from "./components/AttendeeTicketPage";
import ClaimPage from "./components/ClaimPage";
import {
  ClaimAccessGatePage,
  ClosedEventPage,
  ControlAccessDenied,
  EventWrappedPage,
} from "./components/EntryPages";
import { normalizeClaimRulesText } from "./claimRules";
import {
  createClaimRetryState,
  getClaimRetryDelayMs,
  getDoorsOpenJitterMs,
  MAX_CLAIM_ATTEMPTS,
  nextClaimRetryState,
  shouldRetryClaim,
} from "./claimRetry";
import {
  buildClaimAccessCode,
  CLAIM_ACCESS_GRANT_MS,
  CLAIM_ACCESS_ROTATION_MS,
  createClaimAccessSecret,
} from "./claimAccess";
import {
  buildClaimQrPayload,
  buildRaffleQrPayload,
  parseClaimQrPayload,
  parseRaffleQrPayload,
} from "./claimQr";
import { fireCallConfetti, fireRaffleConfetti } from "./confetti";
import { VIBRATE_PRIZE_PATTERN, VIBRATE_TURN_PATTERN, vibrate } from "./haptics";
import {
  buildRaffleSegments,
  getRaffleEligibleClaims,
  normalizeRaffleMemberChances,
  pickRaffleWinner,
  RAFFLE_MAX_WINNERS,
  RAFFLE_PHASE,
} from "./raffle";
import useRaffleSpin from "./useRaffleSpin";
import {
  assignQueuedDemoParticipantsAsStaff,
  claimNumberAsAttendee,
  closeLiveEvent,
  buildClaimId,
  createLiveEvent,
  redeemDemoClaimAsStaff,
  seedDemoParticipantsAsStaff,
  setDemoPausedAsStaff,
  firebaseEnabled,
  getModeFromUrl,
  getScreenUrl,
  joinQueueAsAttendee,
  joinRaffleAsDemoParticipantAsStaff,
  deleteArchivedEvent,
  readArchivedEvent,
  readArchivedEvents,
  readLatestAnnouncement,
  pushLiveState,
  joinRaffleAsAttendee,
  redeemClaimByQr,
  redeemRaffleByQr,
  subscribeToClaim,
  subscribeToClaimAccessSecret,
  subscribeToClaims,
  subscribeToPreclaims,
  subscribeToDisplayFeed,
  subscribeToLiveEvent,
  updateLiveEventDetails,
  assignPreclaimIfQueued,
  readClaimOnce,
  readPreclaimOnce,
  assignPreclaimAsStaff,
  refreshAllPreclaimMembershipsAsStaff,
  removePreclaimAsStaff,
  moveClaimBackToQueueAsStaff,
  removeClaim,
  subscribeToPreclaim,
} from "./firebase";
import { normalizeTitleFont } from "./titleFonts";
import useDiscordLogin from "./useDiscordLogin";
import { LoadingScreen } from "./components/Spinner";
/*
 * Deliberately eager, despite being staff-only and the largest thing here.
 *
 * Splitting it out saves an attendee ~22 kB gzipped they would never run, but
 * it turns opening the control panel into a network fetch — and a blip at that
 * moment drops staff onto the error boundary mid-event. The bundle-size warning
 * that prompted the experiment is solved by splitting Firebase in
 * vite.config.js instead, which costs nothing at runtime. The same reasoning
 * covers AttendeeTicketPage above: it is opened from the roster *during* an
 * event, and it is barely a kilobyte gzipped.
 */
import ControlPage from "./components/ControlPage";
import useScrollLock from "./useScrollLock";
import useOverscrollBackground from "./useOverscrollBackground";
import useKeepScreenAwake, { isKeepScreenAwakeSupported } from "./useKeepScreenAwake";
import { markEventCreatedHere } from "./staffWalkthrough";

const DisplayPage = lazy(() => import("./components/DisplayPage"));

import {
  buildClaimAccessUrl,
  buildClaimRulesAcknowledgedKey,
  clearClaimAccessGrant,
  clearConfirmedClaimAccess,
  clearPerEventKeysExcept,
  clearPersistedClaimSession,
  getClaimAccessCodeFromUrl,
  readClaimAccessGrant,
  readConfirmedClaimAccess,
  readPersistedClaimSession,
  readStoredBoolean,
  readStoredClaimAccessCode,
  writeClaimAccessGrant,
  writeConfirmedClaimAccess,
  writePersistedClaimSession,
} from "./claimSession";
import {
  formatClockTime,
  formatElapsedDuration,
  formatTimeRange,
  getEventSchedule,
  isValidClockTime,
} from "./eventSchedule";
import {
  applyStateChanges,
  buildClaimResultFromRecord,
  buildDemoConfigFromForm,
  buildEventId,
  defaultQrUrl,
  getStateChanges,
  initialControlForm,
  initialState,
  normalizeAutoAdvanceBacklogClearedPercent,
  normalizeAutoAdvanceThresholdPercent,
  normalizeAutoAdvanceTimerMinutes,
  normalizeClaimRecord,
  normalizeGroupSize,
  normalizeLiveEvent,
  normalizeMemberCheckInLeadMinutes,
  normalizeRosterClaim,
  normalizeState,
} from "./eventState";
import { getBacktrackStep, hasClaimedInRound } from "./backtrack";
import { isStaffClaim, partitionStaffClaims } from "./staffNumbers";
import useDemoEvent from "./useDemoEvent";


// Marks a Discord login started from the "Staff Login" button on the
// closed-event card. It has to outlive the OAuth redirect, which reloads the
// page, so it lives in sessionStorage rather than in state.
const STAFF_LOGIN_ATTEMPT_KEY = "staffLoginAttempt";

// How long a scan verdict holds the middle of the scanner screen.
const SCAN_FEEDBACK_VISIBLE_MS = 1800;

// How long the same code is ignored for after being acted on, measured from
// when it was read rather than when the redemption came back.
const SCAN_REPEAT_COOLDOWN_MS = 2500;
const NON_STAFF_LOGIN_MESSAGE =
  "That Discord account does not have the staff role, so you have been signed back out.";

const readStaffLoginAttempt = () =>
  window.sessionStorage.getItem(STAFF_LOGIN_ATTEMPT_KEY) === "1";

function App() {
  const [mode, setMode] = useState(() => getModeFromUrl());
  // The live control screen portals its header buttons into this node
  // rather than rendering them below the title, so they sit next to the
  // logo/"Event Pass" lockup instead. See AppHeader's actionsSlotRef.
  const [controlHeaderActionsNode, setControlHeaderActionsNode] = useState(null);
  const [liveEvent, setLiveEvent] = useState(() => normalizeLiveEvent(null));
  const [endedEventTitle, setEndedEventTitle] = useState("");
  const [isHydrated, setIsHydrated] = useState(!firebaseEnabled);
  const [controlForm, setControlForm] = useState(initialControlForm);
  const [controlMessage, setControlMessage] = useState("");
  const [controlSaving, setControlSaving] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [claimRecord, setClaimRecord] = useState(null);
  const [claimRoster, setClaimRoster] = useState([]);
  const [claimPreclaims, setClaimPreclaims] = useState([]);
  const [claimPreclaim, setClaimPreclaim] = useState(null);
  const [claimError, setClaimError] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  /* Whether the page has stopped trying to get this attendee a number on its
     own. Set when the retries are used up, or on the first refusal that
     retrying cannot fix; cleared by the button on the ticket. */
  const [isClaimRetryExhausted, setIsClaimRetryExhausted] = useState(false);
  const [raffleJoinLoading, setRaffleJoinLoading] = useState(false);
  const [raffleJoinError, setRaffleJoinError] = useState("");
  /* The staff member's own pickup, recorded from their own ticket rather than
     through somebody else's camera. See handleStaffSelfRedeem. */
  const [staffSelfRedeemLoading, setStaffSelfRedeemLoading] = useState(false);
  const [staffSelfRedeemError, setStaffSelfRedeemError] = useState("");
  /*
   * Bumped once per raffle this attendee wins, alongside their confetti.
   *
   * The ticket turns itself to the prize code on it. A counter rather than a
   * boolean because the prize QR payload is the same string every time — see
   * ClaimTicketDeck, which needs a win to be an event, not a state.
   */
  const [raffleWinSignal, setRaffleWinSignal] = useState(0);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [isEventDetailsModalOpen, setIsEventDetailsModalOpen] = useState(false);
  const [isClaimRulesOpen, setIsClaimRulesOpen] = useState(false);
  const [claimAccessGranted, setClaimAccessGranted] = useState(false);
  const [claimAccessStatus, setClaimAccessStatus] = useState("");
  // Staff-only: drives the rotating QR code on the display. Attendees never hold it.
  const [claimAccessSecret, setClaimAccessSecret] = useState("");
  // A code the server has already refused, so the gate below does not re-grant on it.
  const [rejectedClaimAccessCode, setRejectedClaimAccessCode] = useState("");
  const [isStaffSelfClaimMode, setIsStaffSelfClaimMode] = useState(false);
  /* Whether the claim subscription has reported once for the id it is watching.
     "No claim yet" and "not looked yet" are the same empty record, and the staff
     auto-claim below has to tell them apart: acting on the second would issue a
     claim to somebody already holding one. */
  const [isClaimLookupResolved, setIsClaimLookupResolved] = useState(false);
  // Set when staff end an event, so they get a send-off rather than the
  // attendee-facing "no event is open" screen they just created.
  const [staffEndedEventTitle, setStaffEndedEventTitle] = useState("");
  // Why the last staff login attempt from the closed-event card did not stick.
  const [staffLoginMessage, setStaffLoginMessage] = useState("");
  const [isStaffLoginPending, setIsStaffLoginPending] = useState(readStaffLoginAttempt);
  const [displayFeedItems, setDisplayFeedItems] = useState([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  // Whose ticket staff are looking at, as that attendee sees it. Empty when the
  // control panel itself is on screen.
  const [previewClaimId, setPreviewClaimId] = useState("");
  const showControlFailureAlert = useCallback((message) => {
    if (!message) {
      return;
    }

    window.alert(message);
  }, []);
  const autoAdvanceQueueKeyRef = useRef("");
  const hasObservedQueuedPreclaimRef = useRef(false);
  const hasProcessedPreclaimRemovalRef = useRef(false);
  const hasObservedAssignedClaimRef = useRef(false);
  const isForcedLogoutPendingRef = useRef(false);
  const celebratedRaffleSpinRef = useRef(0);
  const previousCurrentRef = useRef(initialState.current);
  const previousEventIdRef = useRef(null);
  const qrScannerModuleRef = useRef(null);
  const scannerRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scanHandlerRef = useRef(null);
  /* The last code acted on, so one held in front of the lens is read once
     rather than five times a second. */
  const lastScanRef = useRef({ atMs: 0, value: "" });
  /* Whether their code was already on screen last render, so the buzz below
     fires on it arriving rather than on every render while it is there. */
  const previousShowClaimQrRef = useRef(false);
  const {
    accessResolved,
    authError,
    avatarUrl,
    dismissAuthError,
    firebaseAuthReady,
    firebaseSignedIn,
    hasFullAccess,
    isMember,
    loading: authLoading,
    loggedIn,
    logout,
    roleLoading,
    startOAuthGrant,
    user,
    username,
  } = useDiscordLogin();

  // Built on demand rather than on every render: useRef evaluates its argument
  // each time, so `useRef(new Audio(sound))` was constructing and discarding an
  // Audio element roughly once a second thanks to the clock tick.
  const dingSoundRef = useRef(null);
  const getDingSound = useCallback(() => {
    if (!dingSoundRef.current) {
      dingSoundRef.current = new Audio(sound);
      dingSoundRef.current.preload = "auto";
    }

    return dingSoundRef.current;
  }, []);
  const previousIsEventLiveRef = useRef(initialState.active ?? false);
  const previousLiveEventTitleRef = useRef(initialState.title);
  const liveState = liveEvent.state;
  const { current, finalCall: isFinalCall, last } = liveState;
  const displayUrl = getScreenUrl("display");
  const hasTrustedAttendeeAccess = firebaseAuthReady && firebaseSignedIn;
  const hasTrustedStaffAccess = hasTrustedAttendeeAccess && hasFullAccess;
  const isCheckingAccess =
    authLoading || roleLoading || (loggedIn && (!accessResolved || !firebaseAuthReady));
  const isEventLive = liveEvent.active;
  const qrCodeValue = liveState.qrUrl.trim() || defaultQrUrl;
  const currentRound = liveState.round;
  const memberCheckInLeadMinutes = normalizeMemberCheckInLeadMinutes(
    liveState.memberCheckInLeadMinutes,
  );
  /* The absolute instants the staff browser resolved when the event was created
     or last edited, so this page agrees with the server about when the doors
     open instead of re-deriving it in whatever timezone the phone is set to.
     The clock-time fields are still passed for events written before those
     values existed — see getEventSchedule. */
  const { eventStartTime, memberEarlyAccessTime } = getEventSchedule({
    eventEndAtMs: liveEvent.eventEndAtMs,
    eventStartAtMs: liveEvent.eventStartAtMs,
    memberCheckInLeadMinutes,
    memberEarlyAccessAtMs: liveEvent.memberEarlyAccessAtMs,
    now: currentTime,
    startedAt: liveEvent.startedAt,
    timeframeEnd: liveEvent.timeframeEnd,
    timeframeStart: liveEvent.timeframeStart,
  });
  const isEventStarted = !eventStartTime || currentTime >= eventStartTime.getTime();
  const isClaimWindowOpen =
    !eventStartTime ||
    currentTime >= eventStartTime.getTime() ||
    (isMember && memberEarlyAccessTime && currentTime >= memberEarlyAccessTime.getTime());
  /*
   * Whether the queue card is on the control panel.
   *
   * Before the start time, always: that is the window the queue exists for, and
   * staff need it whether or not anybody has joined yet. If staff push
   * timeframeStart later, this comes back on its own.
   *
   * After the start time, only while somebody is still in the queue — and that
   * clause is the point. This used to be a flat `!isEventStarted`, so the card
   * vanished the instant the event began and took every remaining queue entry
   * with it. Anybody whose phone had locked or closed was then invisible: no
   * row, no Assign button, nothing on screen to say they existed, and they were
   * eventually archived as a queue entry that never became a number. Staff had
   * no way to see the problem, let alone fix it.
   *
   * The server sweep should mean this list is empty seconds after the doors
   * open. Keeping the card up while it is not is how staff find out when that
   * has not happened.
   */
  const showPreclaimQueue =
    isEventLive && (!isEventStarted || claimPreclaims.length > 0);
  const liveCallLabel =
    liveState.current === 0 ? "Starting Soon" : `${liveState.last + 1}-${liveState.current}`;
  const eventStartLabel = liveEvent.timeframeStart
    ? formatClockTime(liveEvent.timeframeStart)
    : "the event start";
  const memberEarlyAccessLabel = memberEarlyAccessTime
    ? formatClockTime(memberEarlyAccessTime.toTimeString().slice(0, 5))
    : eventStartLabel;
  const rotatingClaimAccessCode = buildClaimAccessCode(claimAccessSecret, currentTime);
  const claimAccessCode = getClaimAccessCodeFromUrl();
  // What we present to the server when claiming or queueing: the code in the URL
  // if it is still there, otherwise the one banked when the QR was first scanned.
  const activeClaimAccessCode =
    claimAccessCode || readStoredClaimAccessCode(liveEvent.eventId ?? "");
  const rotatingClaimAccessUrl = rotatingClaimAccessCode
    ? buildClaimAccessUrl(rotatingClaimAccessCode)
    : "";

  /*
   * The current check-in link, in a form something other than a camera can
   * read.
   *
   * The QR is the only place this URL exists: react-qr-code renders SVG paths,
   * so there is nothing in the DOM to copy, and testing the attendee flow on
   * the machine driving the display otherwise means scanning the screen with a
   * phone and mailing the link back to yourself.
   *
   * Keyed on the URL rather than run on every render because the clock that
   * drives the countdown re-renders this component once a second, while the
   * code itself only rotates once a minute — this logs on rotation, which is
   * the only time there is anything new to say.
   *
   * Development only, and deliberately so. The code is a working credential
   * until the next rotation, and the display spends the evening on a projector
   * in a room full of people.
   */
  useEffect(() => {
    if (import.meta.env.DEV && rotatingClaimAccessUrl) {
      console.log("Check-in link:", rotatingClaimAccessUrl);
    }
  }, [rotatingClaimAccessUrl]);

  const qrRotationElapsedMs = currentTime % CLAIM_ACCESS_ROTATION_MS;
  const qrRotationRemainingMs = CLAIM_ACCESS_ROTATION_MS - qrRotationElapsedMs;
  const qrRotationProgress = qrRotationElapsedMs / CLAIM_ACCESS_ROTATION_MS;
  const nextQrCountdownSeconds = Math.ceil(qrRotationRemainingMs / 1000);
  /* Must agree byte for byte with buildParticipantKey in functions/index.js:
     it is half of the claim document's id, and getting it wrong means looking
     up a claim that will never exist. */
  const attendeeClaimKey =
    loggedIn && hasTrustedAttendeeAccess && user ? `discord:${user}` : "";
  // Read once per mount rather than on every render. The claim id it feeds is
  // only needed to recover a session across reloads.
  const [persistedClaimSession, setPersistedClaimSession] = useState(
    () => readPersistedClaimSession(),
  );
  const persistedClaimEventId = persistedClaimSession?.eventId ?? "";
  const persistedAttendeeClaimId =
    liveEvent.eventId &&
    persistedClaimEventId === liveEvent.eventId &&
    persistedClaimSession?.userId === user
      ? persistedClaimSession.claimId
      : "";
  const attendeeClaimId =
    liveEvent.eventId && attendeeClaimKey
      ? buildClaimId(liveEvent.eventId, attendeeClaimKey)
      : persistedAttendeeClaimId || claimResult?.claimId || "";
  const hasManualStaffClaimAccess = hasTrustedStaffAccess && isStaffSelfClaimMode;
  const claimRulesAcknowledgedKey =
    liveEvent.eventId && attendeeClaimId
      ? buildClaimRulesAcknowledgedKey(liveEvent.eventId, attendeeClaimId)
      : "";
  /* Matched on number rather than claim id: the list on the event document is
     numbers now, because that document is world-readable and a claim id carries
     the attendee's Discord user id. See src/eventState.js.

     Declared up here rather than beside the other queue maths because the QR
     gate below reads it — final call is one of the two ways a code goes live. */
  const finalCallTargetNumberSet = useMemo(
    () => new Set(liveState.finalCallTargetNumbers ?? []),
    [liveState.finalCallTargetNumbers],
  );
  const effectiveClaimResult = claimResult ?? buildClaimResultFromRecord(claimRecord);
  const attendeeClaimNumber = claimRecord?.number ?? claimResult?.number ?? null;
  const hasClaimedCurrentRound = hasClaimedInRound(claimRecord, currentRound);
  const isStaffClaimRecord = isStaffClaim(claimRecord);
  /*
   * Whether their code is live.
   *
   * Three ways in, and the third is the one this used to be missing.
   *
   * Staff hold a number before #1, so there is no group of theirs to wait for:
   * they collect from the moment the round is announced — while the display is
   * still showing "Round X is Starting Soon" — and at any point after it. The
   * comparison would let them through on its own, since every staff number is
   * below `current`, but it is spelled out because it is a rule rather than an
   * accident of the arithmetic. See src/staffNumbers.js.
   *
   * Then the ordinary case: their number has been called.
   *
   * And then final call, which reaches back for everyone still outstanding
   * regardless of where the called number got to. redeemClaimByQrAsStaff has
   * always read it that way — a scanned code is accepted if the number is on
   * the target list, whatever `current` says — and this did not, so an attendee
   * the projector was calling forward by name saw a grey placeholder while the
   * server would happily have taken their code. Staff could not work around it
   * either: AttendeeTicketPage applies this same test.
   *
   * It is reachable whenever a number outruns the attendee count, which any
   * removal from the roster causes, because numbers are never recycled.
   */
  const hasReachedClaimNumber =
    typeof claimRecord?.number === "number" &&
    (isStaffClaimRecord ||
      liveState.current >= claimRecord.number ||
      finalCallTargetNumberSet.has(claimRecord.number));
  const claimQrPayload =
    claimRecord?.claimId && claimRecord?.eventId && claimRecord?.qrToken
      ? buildClaimQrPayload({
          claimId: claimRecord.claimId,
          eventId: claimRecord.eventId,
          qrToken: claimRecord.qrToken,
        })
      : "";
  const showClaimQr =
    Boolean(claimQrPayload) && hasReachedClaimNumber && !hasClaimedCurrentRound;
  const currentEventClaims = useMemo(
    () =>
      claimRoster
        .filter((claim) => claim.eventId === liveEvent.eventId)
        // Staff sort to the front for free: their numbers are negative. See
        // src/staffNumbers.js.
        .sort((leftClaim, rightClaim) => leftClaim.number - rightClaim.number),
    [claimRoster, liveEvent.eventId],
  );
  /* Split once and shared, so the roster panel, the round maths and the raffle
     all mean the same thing by "staff". */
  const currentEventAttendeeClaims = useMemo(
    () => partitionStaffClaims(currentEventClaims).attendeeClaims,
    [currentEventClaims],
  );
  /* Only real numbers count towards the end of a round. Staff hold numbers
     before #1, so counting them here would leave the last group permanently
     short of the finish line and the round would never look complete. */
  const totalPeopleWithNumbers = currentEventAttendeeClaims.length;
  /*
   * The number the last group has to reach, which is not the same as how many
   * attendees there are.
   *
   * Numbers are never recycled — deliberately, because a reused number could
   * belong to a group that has already been called — so the moment staff remove
   * anyone from the roster the highest number issued runs ahead of the count.
   * Ending the round on the count instead meant a hundred-number event with ten
   * removals stopped calling groups at 90, and #91 to #100 were never invited up
   * at all: the panel had already swapped its next action for Final Call.
   *
   * The count is still the right denominator for "how many people are here",
   * which is what every other reading of it below is asking.
   */
  const highestAttendeeNumber = currentEventAttendeeClaims.reduce(
    (highest, claim) => Math.max(highest, claim.number),
    0,
  );
  /*
   * The raffle.
   *
   * Both pools are derived rather than stored, so the control panel that draws
   * the winner and the display that draws the wheel agree without a second
   * copy of the list to keep in step. They are only non-empty where the roster
   * is subscribed — staff on /control or /display — which is exactly where the
   * wheel and the Spin button live.
   */
  const raffleWinnerNumbers = liveState.raffleWinnerNumbers;
  const raffleMemberChances = normalizeRaffleMemberChances(liveState.raffleMemberChances);
  /* Who the next spin can land on: everyone eligible who has not already won. */
  const raffleDrawClaims = useMemo(
    () =>
      getRaffleEligibleClaims({
        allowRepeatWinners: liveState.raffleAllowRepeatWinners,
        allowStaff: liveState.raffleAllowStaff,
        claims: currentEventClaims,
        membersOnly: liveState.raffleMembersOnly,
        requireOptIn: liveState.raffleRequireOptIn,
        winnerNumbers: raffleWinnerNumbers,
      }),
    [
      currentEventClaims,
      liveState.raffleAllowRepeatWinners,
      liveState.raffleAllowStaff,
      liveState.raffleMembersOnly,
      liveState.raffleRequireOptIn,
      raffleWinnerNumbers,
    ],
  );
  /*
   * What the wheel is sliced into, which is the draw pool plus the winner
   * currently being revealed.
   *
   * Pressing Spin adds the winner to the winner list in the same write that
   * starts the spin — that is what keeps them out of the *next* draw. Without
   * this exception it would also take them off the wheel on the very frame the
   * wheel began turning towards them, and the pointer would settle on nothing.
   * Keeping them on also means the winning slice is still there to look at
   * under the pointer once it stops.
   */
  const raffleWheelClaims = useMemo(
    () =>
      getRaffleEligibleClaims({
        allowRepeatWinners: liveState.raffleAllowRepeatWinners,
        allowStaff: liveState.raffleAllowStaff,
        claims: currentEventClaims,
        membersOnly: liveState.raffleMembersOnly,
        requireOptIn: liveState.raffleRequireOptIn,
        winnerNumbers: raffleWinnerNumbers.filter(
          (winnerNumber) => winnerNumber !== liveState.raffleWinnerNumber,
        ),
      }),
    [
      currentEventClaims,
      liveState.raffleAllowRepeatWinners,
      liveState.raffleAllowStaff,
      liveState.raffleMembersOnly,
      liveState.raffleRequireOptIn,
      liveState.raffleWinnerNumber,
      raffleWinnerNumbers,
    ],
  );
  /*
   * The wheel's slices, and the hat the winner is drawn out of.
   *
   * One shared calculation on purpose: extra member chances widen a slice and
   * raise that person's odds by the same number, so what the room can see on
   * the wheel is exactly what the draw is doing.
   */
  const raffleWheelSegments = useMemo(
    () => buildRaffleSegments({ claims: raffleWheelClaims, memberChances: raffleMemberChances }),
    [raffleMemberChances, raffleWheelClaims],
  );
  const raffleDrawSegments = useMemo(
    () => buildRaffleSegments({ claims: raffleDrawClaims, memberChances: raffleMemberChances }),
    [raffleDrawClaims, raffleMemberChances],
  );
  /* Non-zero rather than positive, for the same reason isCurrentRaffleWinner
     below is: 0 is "no winner", but a staff number is negative and staff let
     into the draw can win. See src/staffNumbers.js. */
  const raffleWinnerClaim =
    liveState.raffleWinnerNumber !== 0
      ? currentEventClaims.find((claim) => claim.number === liveState.raffleWinnerNumber) ?? null
      : null;
  const rafflePhase = useRaffleSpin({
    spinCount: liveState.raffleSpinCount,
    spinStartedAtMs: liveState.raffleSpinStartedAtMs,
    winnerNumber: liveState.raffleWinnerNumber,
  });
  /*
   * The winner list, newest first, each with whether their prize has actually
   * been collected — which is the one thing a raffle records.
   *
   * The winner in play is held back until the wheel has stopped. They are
   * written to the event the instant Spin is pressed, so that every screen can
   * animate towards the same name, which means the control panel would
   * otherwise print the result in its own list six seconds before the room
   * finds out. Staff wait for the wheel like everybody else.
   *
   * This is the same suppression the winner's own phone applies to their prize
   * code, for the same reason.
   */
  const revealedRaffleWinnerNumbers =
    rafflePhase === RAFFLE_PHASE.spinning
      ? raffleWinnerNumbers.filter(
          (winnerNumber) => winnerNumber !== liveState.raffleWinnerNumber,
        )
      : raffleWinnerNumbers;
  const raffleWinnerClaims = useMemo(
    () =>
      revealedRaffleWinnerNumbers
        .map((winnerNumber) => {
          const claim =
            currentEventClaims.find((rosterClaim) => rosterClaim.number === winnerNumber) ?? null;

          return {
            claim,
            hasCollectedPrize: Number.isFinite(claim?.raffleClaimedAtMs),
            number: winnerNumber,
          };
        })
        .reverse(),
    [currentEventClaims, revealedRaffleWinnerNumbers],
  );
  const attendeeNumber = claimRecord?.number ?? 0;
  /*
   * A prize code, once their number has come out of the wheel — and it stays
   * available for the rest of the event, including after the raffle closes or
   * another one runs, because the prize itself may be handed over much later.
   *
   * Suppressed for the length of the current spin only: the winner is written
   * when Spin is pressed so that every screen animates towards the same name,
   * and without this their own phone would light up before the wheel had
   * finished turning and spoil the reveal.
   */
  /*
   * Opting in, on the attendee's own ticket.
   *
   * Only offered when staff have asked for it. Their claim carries the stamp,
   * which they can read back themselves, so the button settles into a confirmed
   * state without waiting on anything but their own claim subscription.
   */
  const isRaffleOptInRequired = Boolean(liveState.raffleRequireOptIn);
  const hasJoinedRaffle = Number.isFinite(claimRecord?.raffleJoinedAtMs);
  const canJoinRaffle =
    isRaffleOptInRequired && Boolean(claimRecord?.claimId) && Boolean(liveEvent.eventId);
  const handleJoinRaffle = useCallback(async () => {
    if (!liveEvent.eventId || raffleJoinLoading) {
      return;
    }

    setRaffleJoinLoading(true);
    setRaffleJoinError("");

    try {
      await joinRaffleAsAttendee({ eventId: liveEvent.eventId });
    } catch (error) {
      setRaffleJoinError(error.message || "Unable to join the raffle right now.");
    } finally {
      setRaffleJoinLoading(false);
    }
  }, [liveEvent.eventId, raffleJoinLoading]);
  /*
   * A staff member recording their own pickup, from their own ticket.
   *
   * Staff already hold the permission the scanner is checking for, so handing
   * their phone to a second staff member to have it photographed is a round
   * trip through somebody else for no added authority. This calls the same
   * callable a scan calls, with the claim id, event id and token their own
   * ticket already has in hand — the three things the QR code encodes and
   * nothing more, so nothing is asserted here that a scan would not assert.
   *
   * Deliberately not a local write. Eligibility (the round, whether they have
   * already picked up in it) is decided server-side either way, and the pickup
   * lands in the counts, the round progress and the activity feed as the
   * identical write, so a self-recorded claim cannot read differently from a
   * scanned one anywhere downstream.
   */
  const handleStaffSelfRedeem = useCallback(async () => {
    if (
      staffSelfRedeemLoading ||
      !claimRecord?.claimId ||
      !claimRecord?.eventId ||
      !claimRecord?.qrToken
    ) {
      return;
    }

    setStaffSelfRedeemLoading(true);
    setStaffSelfRedeemError("");

    try {
      await redeemClaimByQr({
        claimId: claimRecord.claimId,
        eventId: claimRecord.eventId,
        qrToken: claimRecord.qrToken,
      });
      /* Nothing to set on success: the ticket is driven by the live claim
         document, so the same subscription that turns an attendee's card over
         after a scan turns this one over. */
    } catch (error) {
      setStaffSelfRedeemError(error.message || "Unable to mark your item as claimed.");
    } finally {
      setStaffSelfRedeemLoading(false);
    }
  }, [
    claimRecord?.claimId,
    claimRecord?.eventId,
    claimRecord?.qrToken,
    staffSelfRedeemLoading,
  ]);
  /* Non-zero rather than positive: 0 is "no number yet", but a staff number is
     negative, and staff let into the draw can win like anybody else. */
  const isCurrentRaffleWinner =
    attendeeNumber !== 0 && attendeeNumber === liveState.raffleWinnerNumber;
  const hasRaffleWin =
    attendeeNumber !== 0 &&
    raffleWinnerNumbers.includes(attendeeNumber) &&
    !(isCurrentRaffleWinner && rafflePhase === RAFFLE_PHASE.spinning);
  const raffleQrPayload =
    hasRaffleWin && claimRecord?.claimId && claimRecord?.eventId && claimRecord?.qrToken
      ? buildRaffleQrPayload({
          claimId: claimRecord.claimId,
          eventId: claimRecord.eventId,
          qrToken: claimRecord.qrToken,
        })
      : "";
  /* The whole record of a prize handover — see redeemRaffleByQrAsStaff. It is
     what takes the "you won" banner off the ticket once staff have scanned. */
  const isRafflePrizeCollected = Number.isFinite(claimRecord?.raffleClaimedAtMs);
  const currentGroupClaims = useMemo(
    () => currentEventClaims.filter((claim) => claim.number > last && claim.number <= current),
    [current, currentEventClaims, last],
  );
  const finalCallTargetClaims = useMemo(
    () => currentEventClaims.filter((claim) => finalCallTargetNumberSet.has(claim.number)),
    [currentEventClaims, finalCallTargetNumberSet],
  );
  /*
   * Everyone auto-advance has already called this round: the final call targets
   * once final call is running, otherwise every number below the active group.
   * The backlog is whichever of them have not claimed, and the gate below reads
   * one against the other, so both have to come from the same set.
   */
  /* Attendees only. A staff number is below every called number, so leaving
     staff in here would count them as "already called" from the first group on
     — and a staff member who had not collected yet would hold the backlog gate
     shut against a room that had actually cleared. */
  const calledSoFarClaims = currentEventAttendeeClaims.filter((claim) => {
    if (liveState.finalCall) {
      return finalCallTargetNumberSet.has(claim.number);
    }

    return liveState.current > 0 && claim.number <= liveState.last;
  });
  const backlogClaims = calledSoFarClaims.filter(
    (claim) => !hasClaimedInRound(claim, currentRound),
  );
  const activeQueueElapsedLabel =
    liveState.groupStartedAt && (liveState.finalCall || liveState.current > 0)
      ? formatElapsedDuration(Math.max(0, currentTime - liveState.groupStartedAt))
      : "";
  const roundElapsedLabel = liveState.roundStartedAt
    ? formatElapsedDuration(Math.max(0, currentTime - liveState.roundStartedAt))
    : "";
  const activeQueueClaims = liveState.finalCall ? finalCallTargetClaims : currentGroupClaims;
  const finalCallTargetNumbersKey = (liveState.finalCallTargetNumbers ?? []).join(",");
  const activeQueueClaimedCount = activeQueueClaims.filter((claim) =>
    hasClaimedInRound(claim, currentRound),
  ).length;
  const isLastGroup =
    !liveState.finalCall && liveState.current > 0 && liveState.current >= highestAttendeeNumber;
  const autoAdvanceThresholdPercent = normalizeAutoAdvanceThresholdPercent(
    liveState.autoAdvanceThresholdPercent,
  );
  const autoAdvanceThresholdRatio = autoAdvanceThresholdPercent / 100;
  const autoAdvanceBacklogClearedPercent = normalizeAutoAdvanceBacklogClearedPercent(
    liveState.autoAdvanceBacklogClearedPercent,
  );
  /* Nothing called yet means nothing outstanding, so the gate is open. */
  const backlogClearedRatio = calledSoFarClaims.length
    ? (calledSoFarClaims.length - backlogClaims.length) / calledSoFarClaims.length
    : 1;
  const autoAdvanceFinalCallTimerMinutes = normalizeAutoAdvanceTimerMinutes(
    liveState.autoAdvanceFinalCallTimerMinutes,
  );
  const autoAdvanceGroupTimerMinutes = normalizeAutoAdvanceTimerMinutes(
    liveState.autoAdvanceGroupTimerMinutes,
  );
  const autoAdvanceStartRoundMinutes = normalizeAutoAdvanceTimerMinutes(
    liveState.autoAdvanceStartRoundMinutes,
  );
  const groupSize = normalizeGroupSize(liveState.groupSize);
  const autoAdvanceFinalCallTimerMs = autoAdvanceFinalCallTimerMinutes * 60 * 1000;
  const autoAdvanceGroupTimerMs = autoAdvanceGroupTimerMinutes * 60 * 1000;
  const autoAdvanceStartRoundMs = autoAdvanceStartRoundMinutes * 60 * 1000;
  const queueTitle = liveState.finalCall
    ? "Final Call"
    : liveState.current === 0
      ? "Group"
      : `Group ${liveState.last + 1}-${liveState.current}`;
  const queueDescription = liveState.finalCall
    ? `Showing everyone who had not claimed an item before final call started for round ${currentRound}.`
    : liveState.current === 0
      ? "Call the first group to start item pickup."
      : "";
  const isDisplayRoute = mode === "display";
  const canManageEvent = mode === "control" && isEventLive && hasTrustedStaffAccess;
  const shouldSubscribeToRosterData =
    isEventLive && hasTrustedStaffAccess && (isDisplayRoute || canManageEvent);
  const isAttendeeClaimRoute =
    mode === null &&
    typeof attendeeClaimNumber === "number" &&
    attendeeClaimNumber > liveState.last &&
    attendeeClaimNumber <= liveState.current;
  const shouldCelebrateCurrentCall = isDisplayRoute || isAttendeeClaimRoute;
  const shouldRedirectToControl =
    loggedIn &&
    hasTrustedStaffAccess &&
    !isCheckingAccess &&
    mode === null &&
    !claimAccessCode &&
    !hasManualStaffClaimAccess &&
    !effectiveClaimResult &&
    /* Closing an event signs staff out, so `loggedIn` already blocks this.
       Kept because the send-off card must not be raced back to the panel in the
       frame before the sign-out lands. */
    !staffEndedEventTitle;
  /*
   * A staff login that has been accepted but has not finished landing.
   *
   * hasFullAccess is the role as the Discord exchange reported it, and it
   * settles a moment before the Firebase session does. In that gap the account
   * is known to be staff but hasTrustedStaffAccess is still false, so
   * shouldRedirectToControl has not fired yet and the render order below falls
   * all the way through to the closed-event card — which is why staff saw the
   * Staff Login screen flash back at them on their way to /control.
   *
   * isStaffLoginPending covers the earlier half of the same journey: it is set
   * before the OAuth redirect and read back out of sessionStorage on return, so
   * it holds while the code is still being exchanged and `loggedIn` is false.
   */
  const isStaffHandoffPending =
    mode === null &&
    !claimAccessCode &&
    !hasManualStaffClaimAccess &&
    !effectiveClaimResult &&
    (isStaffLoginPending || (loggedIn && hasFullAccess && !hasTrustedStaffAccess));
  /*
   * The mirror of the above: /control is for staff who are already signed in.
   *
   * There is one way to log in, the button on "/", and it forwards staff back
   * here once Discord has confirmed the role. Anyone arriving at /control
   * signed out is sent to that button rather than shown a second login card.
   *
   * Gated on isCheckingAccess so a staff member reloading /control is not
   * bounced out before Firebase has reported their persisted session, and on
   * isHydrated so it cannot fire against a half-initialised page.
   */
  const shouldRedirectFromControl =
    isHydrated && mode === "control" && !isCheckingAccess && !loggedIn;
  const shouldLockBackgroundScroll =
    (mode === null && Boolean(claimResult) && isClaimRulesOpen) ||
    (mode === "control" && isEventLive && isEventDetailsModalOpen);

  const changeMode = useCallback((nextMode, options = {}) => {
    const { replace = false } = options;

    setMode(nextMode);
    window.history[replace ? "replaceState" : "pushState"](
      {},
      document.title,
      getScreenUrl(nextMode),
    );
  }, []);

  const openDisplayScreen = () => {
    window.open(displayUrl, "_blank", "noopener,noreferrer");
  };

  const openBookList = () => {
    window.open(qrCodeValue, "_blank", "noopener,noreferrer");
  };

  const handleLogout = useCallback(() => {
    isForcedLogoutPendingRef.current = false;
    clearClaimAccessGrant();
    clearConfirmedClaimAccess();
    clearPersistedClaimSession();
    setIsStaffSelfClaimMode(false);
    logout();
  }, [logout]);

  const handleStaffLogin = useCallback(() => {
    setStaffLoginMessage("");
    setIsStaffLoginPending(true);
    window.sessionStorage.setItem(STAFF_LOGIN_ATTEMPT_KEY, "1");
    // Back to "/" rather than straight to "/control": a login without the role
    // has to land somewhere the refusal can be reported and undone, and that is
    // this card. Staff are forwarded on by shouldRedirectToControl.
    startOAuthGrant("/");
  }, [startOAuthGrant]);

  /*
   * Resolves a staff login once Discord has reported back.
   *
   * Anyone can start this login, so the account that comes back may well not
   * hold the staff role. Rather than parking them on a half-signed-in page, we
   * say so and sign them straight back out to the closed-event card they
   * started from. hasFullAccess is the role as the exchange reported it, which
   * settles a moment before the Firebase session does — checking the combined
   * staff flag here would sign a genuine staff member out on that gap.
   */
  useEffect(() => {
    if (!readStaffLoginAttempt() || isCheckingAccess) {
      return;
    }

    window.sessionStorage.removeItem(STAFF_LOGIN_ATTEMPT_KEY);
    setIsStaffLoginPending(false);

    // Cancelled at Discord, or the exchange failed — useDiscordLogin surfaces
    // its own error for that.
    if (!loggedIn || hasFullAccess) {
      return;
    }

    handleLogout();
    setStaffLoginMessage(NON_STAFF_LOGIN_MESSAGE);
  }, [handleLogout, hasFullAccess, isCheckingAccess, loggedIn]);

  // The server refused the scanned code. Drop the optimistic grant and send the
  // attendee back to the display for a fresh one.
  const handleClaimAccessRejected = useCallback((error) => {
    if (error?.code !== "functions/permission-denied") {
      return false;
    }

    clearClaimAccessGrant();
    clearConfirmedClaimAccess();
    setRejectedClaimAccessCode(getClaimAccessCodeFromUrl() || "expired");
    setClaimAccessGranted(false);

    return true;
  }, []);

  const openStaffSelfClaim = useCallback(() => {
    setIsStaffSelfClaimMode(true);
    changeMode(null);
  }, [changeMode]);

  const resetClaimFlow = () => {
    setPersistedClaimSession(null);
    setClaimResult(null);
    setClaimRecord(null);
    setClaimError("");
    setClaimLoading(false);
    setIsClaimRetryExhausted(false);
    setIsClaimRulesOpen(false);
    setIsStaffSelfClaimMode(false);
    clearPersistedClaimSession();
  };

  const acknowledgeClaimRules = () => {
    if (claimRulesAcknowledgedKey) {
      window.localStorage.setItem(claimRulesAcknowledgedKey, "true");
    }

    setIsClaimRulesOpen(false);
  };

  const openClaimRules = () => {
    setIsClaimRulesOpen(true);
  };

  const closeEventDetailsModal = () => {
    setIsEventDetailsModalOpen(false);
  };

  // Staff routinely have the control panel, the display and their own ticket
  // open at once; three tabs all reading "Event Pass" is not navigable.
  useEffect(() => {
    const eventTitle = isEventLive ? liveState.title : "";
    const screenName =
      mode === "display" ? "Display" : mode === "control" ? "Control Panel" : "Your Number";

    document.title = eventTitle
      ? `${screenName} · ${eventTitle}`
      : `${screenName} · Event Pass`;
  }, [isEventLive, liveState.title, mode]);

  /*
   * Backing out of the control panel with the browser's own Back button walks
   * straight into the Discord OAuth history left behind by login — the
   * authorize page, sometimes a stale code — and that can silently sign staff
   * out mid-event. While control is showing, an extra history entry is kept
   * on top of it as a trip wire: the first Back press lands on that entry
   * instead of actually leaving, gets put back immediately so the address bar
   * never visibly moves, and only proceeds past it (via history.go(-2), which
   * clears the trip wire and the real control entry in one jump) once staff
   * confirm they meant it.
   */
  const controlBackGuardArmedRef = useRef(false);

  useEffect(() => {
    const shouldArm = mode === "control" && loggedIn && hasTrustedStaffAccess;

    if (!shouldArm) {
      controlBackGuardArmedRef.current = false;
      return;
    }

    if (controlBackGuardArmedRef.current) {
      return;
    }

    window.history.pushState({ controlBackGuard: true }, document.title, window.location.href);
    controlBackGuardArmedRef.current = true;
  }, [mode, loggedIn, hasTrustedStaffAccess]);

  useEffect(() => {
    const handlePopState = (event) => {
      if (controlBackGuardArmedRef.current && !event.state?.controlBackGuard) {
        window.history.pushState({ controlBackGuard: true }, document.title, getScreenUrl("control"));

        const shouldLeave = window.confirm(
          "Go back? Leaving the control panel this way can sign you out, and you'll need to log in with Discord again.",
        );

        if (shouldLeave) {
          controlBackGuardArmedRef.current = false;
          window.history.go(-2);
        }

        return;
      }

      setMode(getModeFromUrl());
      // The ticket preview pushes a history entry of its own, so Back gets out
      // of it rather than leaving the control panel entirely.
      setPreviewClaimId("");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  /*
   * The live event, which everything else on this page is derived from.
   *
   * The hydration flag flips on the first answer either way. An error has to
   * let the page render too — otherwise a Firebase that is down or blocked is
   * a permanently blank screen rather than an event that says it is offline.
   */
  useEffect(() => {
    if (!firebaseEnabled) {
      return undefined;
    }

    return subscribeToLiveEvent({
      onEvent: (nextEvent) => {
        setLiveEvent(normalizeLiveEvent(nextEvent));
        setIsHydrated(true);
      },
      onError: (error) => {
        setIsHydrated(true);
        console.error(error.message || "Unable to connect to Firebase.");
      },
    });
  }, []);

  /* Staff who land on the attendee page are sent to the panel they came for,
     and anyone on the panel who turns out not to hold staff access is sent
     back. Both replace rather than push, so neither leaves a step in history
     that walks straight back into the redirect. */
  useEffect(() => {
    if (!shouldRedirectToControl) {
      return;
    }

    changeMode("control", { replace: true });
  }, [changeMode, shouldRedirectToControl]);

  useEffect(() => {
    if (!shouldRedirectFromControl) {
      return;
    }

    changeMode(null, { replace: true });
  }, [changeMode, shouldRedirectFromControl]);

  /*
   * The clock every elapsed time and every countdown on the page is read off.
   *
   * It ticks the whole app once a second, which is the point — a running timer
   * that only moves when something else happens is not a timer. What it must
   * not do is take the phone with it: this render reaches the control panel's
   * several hundred drawn elements, and a second of that landing in the middle
   * of a flick is a frame the browser could not paint and a tap it could not
   * answer.
   *
   * startTransition is what keeps the two apart. Nothing here is urgent — no
   * one is waiting on this second rather than the next one — so React is free
   * to render it in slices and hand the main thread back to the scroll and to
   * whatever the finger just landed on in between. The tick still arrives; it
   * just stops being the thing a touch has to queue behind.
   *
   * Suspended while the tab is hidden, because a clock nobody can see is only
   * a background render, and a phone with the control panel open in a
   * backgrounded tab is the common case at an event. The catch-up on the way
   * back is not a transition: returning to the tab is exactly the moment the
   * displayed times must already be right.
   */
  useEffect(() => {
    let timer = null;

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer != null) {
        return;
      }

      timer = window.setInterval(() => {
        startTransition(() => setCurrentTime(Date.now()));
      }, 1_000);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }

      setCurrentTime(Date.now());
      start();
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useScrollLock(shouldLockBackgroundScroll);
  // Unconditional: every screen sits on the same page gradient, so the control
  // panel, the landing page and the display all bounce against it.
  useOverscrollBackground();
  /* Also unconditional, and for the same reason it has to be: the preference is
     stored per device, and the display route has to run the hook itself for the
     projector's screen to stay on while the control tab is the hidden one. Only
     the control panel shows the toggle. */
  const { isKeepScreenAwakeEnabled, setKeepScreenAwake, toggleKeepScreenAwake } =
    useKeepScreenAwake();

  useEffect(() => {
    const previousCurrent = previousCurrentRef.current;

    if (current > previousCurrent && !isFinalCall && shouldCelebrateCurrentCall) {
      void fireCallConfetti();

      const dingSound = getDingSound();
      dingSound.currentTime = 0;
      dingSound.play().catch(() => {});
    }

    previousCurrentRef.current = current;
  }, [current, getDingSound, isFinalCall, shouldCelebrateCurrentCall]);

  /*
   * The phone buzzing when their own code arrives.
   *
   * Keyed on the code appearing rather than on the display advancing, because
   * that is the moment the screen in their hand becomes the thing staff need to
   * scan — and it is true for a staff ticket the moment the round is announced,
   * which no reading of the called number would catch.
   *
   * The attendee page only. Staff on /control are the ones doing the calling.
   * Latched on the previous value so it fires on the change and not on every
   * render while the code is up, and the latch is kept even when the buzz is
   * skipped, so coming back from the panel to a code already on screen is not
   * read as it arriving.
   */
  useEffect(() => {
    const wasShowingClaimQr = previousShowClaimQrRef.current;

    previousShowClaimQrRef.current = showClaimQr;

    if (mode !== null || !showClaimQr || wasShowingClaimQr) {
      return;
    }

    vibrate(VIBRATE_TURN_PATTERN);
  }, [mode, showClaimQr]);

  /*
   * The winner's own celebration, on their own phone.
   *
   * Fired on the reveal rather than on the spin, so it lands with the wheel
   * stopping on the projector instead of six seconds before it. Only on the
   * attendee screen: staff running the raffle from /control are already
   * watching the display's confetti.
   *
   * Latched on the spin that was celebrated rather than on "has won", so an
   * attendee who wins twice — which staff can allow — gets a burst each time,
   * and a previous winner does not get one every time somebody else wins.
   */
  useEffect(() => {
    if (
      mode !== null ||
      !isCurrentRaffleWinner ||
      rafflePhase !== RAFFLE_PHASE.revealed ||
      celebratedRaffleSpinRef.current === liveState.raffleSpinCount
    ) {
      return;
    }

    celebratedRaffleSpinRef.current = liveState.raffleSpinCount;
    setRaffleWinSignal((signal) => signal + 1);
    vibrate(VIBRATE_PRIZE_PATTERN);
    void fireRaffleConfetti();
  }, [isCurrentRaffleWinner, liveState.raffleSpinCount, mode, rafflePhase]);

  // Browsers block audio until the tab has seen a user gesture. The projector is
  // opened and then left alone, so the call chime never actually played there.
  // Prime the clip on the first interaction with the page instead.
  useEffect(() => {
    if (!shouldCelebrateCurrentCall) {
      return undefined;
    }

    const unlockDingSound = () => {
      const dingSound = getDingSound();

      dingSound.muted = true;
      dingSound
        .play()
        .then(() => {
          dingSound.pause();
          dingSound.currentTime = 0;
          dingSound.muted = false;
        })
        .catch(() => {
          dingSound.muted = false;
        });
    };

    window.addEventListener("pointerdown", unlockDingSound, { once: true });
    window.addEventListener("keydown", unlockDingSound, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockDingSound);
      window.removeEventListener("keydown", unlockDingSound);
    };
  }, [getDingSound, shouldCelebrateCurrentCall]);

  useEffect(() => {
    if (!isEventLive) {
      setControlForm(initialControlForm);
      return;
    }

    setControlForm({
      claimRulesText: normalizeClaimRulesText(liveState.claimRulesText),
      qrUrl: liveState.qrUrl,
      displayFeedEnabled: liveState.displayFeedEnabled !== false,
      memberCheckInLeadMinutes: String(
        normalizeMemberCheckInLeadMinutes(liveState.memberCheckInLeadMinutes),
      ),
      timeframeEnd: liveEvent.timeframeEnd || initialControlForm.timeframeEnd,
      timeframeStart:
        liveEvent.timeframeStart || initialControlForm.timeframeStart,
      title: liveState.title,
      titleFont: normalizeTitleFont(liveState.titleFont),
    });
  }, [
    isEventLive,
    liveEvent.timeframeEnd,
    liveEvent.timeframeStart,
    liveState.claimRulesText,
    liveState.displayFeedEnabled,
    liveState.memberCheckInLeadMinutes,
    liveState.qrUrl,
    liveState.title,
    liveState.titleFont,
  ]);

  useEffect(() => {
    if (previousEventIdRef.current === liveEvent.eventId) {
      return;
    }

    previousEventIdRef.current = liveEvent.eventId;
    setDisplayFeedItems([]);
    setPreviewClaimId("");
    resetClaimFlow();
    /* The event that has just been left behind takes its per-device flags with
       it — the walkthrough, the rules acknowledgement, the backtrack "don't ask
       again", the open queue panels. All of them are scoped by event id so the
       next event asks again, and until now none of them was ever removed. */
    clearPerEventKeysExcept(liveEvent.eventId ?? "");
  }, [liveEvent.eventId]);

  useEffect(() => {
    // The feed carries attendee names and avatars, so it is staff-readable only.
    // The display is opened from the control panel and inherits that session.
    //
    // Turning the feed off in the event details stops the listener rather than
    // only hiding the items: there is no reason to hold a live query on names
    // and avatars that nothing is going to draw.
    if (!isEventLive || !hasTrustedStaffAccess || liveState.displayFeedEnabled === false) {
      setDisplayFeedItems([]);
      return undefined;
    }

    return subscribeToDisplayFeed({
      eventId: liveEvent.eventId,
      onFeed: (nextFeedItems) => {
        setDisplayFeedItems(nextFeedItems);
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync display feed.");
      },
    });
  }, [hasTrustedStaffAccess, isEventLive, liveEvent.eventId, liveState.displayFeedEnabled]);

  useEffect(() => {
    if (!effectiveClaimResult || !claimRulesAcknowledgedKey) {
      setIsClaimRulesOpen(false);
      return;
    }

    setIsClaimRulesOpen(!readStoredBoolean(claimRulesAcknowledgedKey));
  }, [claimRulesAcknowledgedKey, effectiveClaimResult]);

  useEffect(() => {
    // Track whether the event has been actively ended by staff (isEventLive)
    if (isEventLive) {
      previousLiveEventTitleRef.current = liveState.title?.trim() || initialState.title;
    }

    const wasEventLive = previousIsEventLiveRef.current;

    if (isEventLive) {
      setEndedEventTitle("");
    } else if (wasEventLive) {
      setEndedEventTitle(previousLiveEventTitleRef.current);
    }

    previousIsEventLiveRef.current = isEventLive;
  }, [isEventLive, liveState.title]);

  useEffect(() => {
    // A new id is a fresh question, so the answer from the last one stops counting.
    setIsClaimLookupResolved(false);

    if (!attendeeClaimId || !hasTrustedAttendeeAccess) {
      setClaimRecord(null);
      return undefined;
    }

    return subscribeToClaim({
      claimId: attendeeClaimId,
      onClaim: (nextClaim) => {
        const nextClaimRecord = normalizeClaimRecord(attendeeClaimId, nextClaim);

        setIsClaimLookupResolved(true);
        setClaimRecord(nextClaimRecord);
        setClaimResult((currentResult) => {
          if (!nextClaimRecord) {
            return currentResult?.claimId === attendeeClaimId ? null : currentResult;
          }

          const nextClaimResult = buildClaimResultFromRecord(nextClaimRecord);

          if (
            currentResult?.claimId === nextClaimResult.claimId &&
            currentResult.number === nextClaimResult.number &&
            currentResult.qrToken === nextClaimResult.qrToken &&
            currentResult.redeemedRound === nextClaimResult.redeemedRound &&
            currentResult.itemsClaimedCount === nextClaimResult.itemsClaimedCount &&
            currentResult.isMember === nextClaimResult.isMember
          ) {
            return currentResult;
          }

          return nextClaimResult;
        });
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync claim status.");
      },
    });
  }, [attendeeClaimId, hasTrustedAttendeeAccess]);

  useEffect(() => {
    hasObservedQueuedPreclaimRef.current = false;
    hasProcessedPreclaimRemovalRef.current = false;
    hasObservedAssignedClaimRef.current = false;
    isForcedLogoutPendingRef.current = false;
  }, [attendeeClaimId]);

  // Keep the attendee's preclaim in sync while awaiting the claim document.
  // If staff remove someone from queue, force a logout on the attendee side.
  useEffect(() => {
    let cancelled = false;

    if (!attendeeClaimId || !loggedIn || !liveEvent.eventId) {
      setClaimPreclaim(null);
      return undefined;
    }

    // If they've already been assigned a claim, clear any preclaim state.
    if (claimRecord && claimRecord.claimId === attendeeClaimId) {
      setClaimPreclaim(null);
      return undefined;
    }

    const forceLogoutIfUnassigned = async () => {
      isForcedLogoutPendingRef.current = true;
      try {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 400);
        });
        if (cancelled) {
          isForcedLogoutPendingRef.current = false;
          return;
        }

        const existingClaim = await readClaimOnce({ claimId: attendeeClaimId });
        if (!cancelled && !existingClaim) {
          handleLogout();
          return;
        }
        isForcedLogoutPendingRef.current = false;
      } catch (e) {
        console.warn("preclaim removal check failed:", e?.message || e);
        if (!cancelled) {
          handleLogout();
          return;
        }
        isForcedLogoutPendingRef.current = false;
      }
    };

    return subscribeToPreclaim({
      claimId: attendeeClaimId,
      onPreclaim: (nextPreclaim) => {
        setClaimPreclaim(nextPreclaim ?? null);

        if (nextPreclaim) {
          hasObservedQueuedPreclaimRef.current = true;
          hasProcessedPreclaimRemovalRef.current = false;
          return;
        }

        if (!hasObservedQueuedPreclaimRef.current || hasProcessedPreclaimRemovalRef.current) {
          return;
        }

        hasProcessedPreclaimRemovalRef.current = true;

        void forceLogoutIfUnassigned();
      },
      onError: (error) => {
        const errorCode = String(error?.code || "");
        const isPermissionDenied =
          errorCode === "permission-denied" ||
          errorCode === "permission_denied" ||
          errorCode === "firestore/permission-denied";

        const hadQueuedPresence = hasObservedQueuedPreclaimRef.current;

        if (isPermissionDenied && hadQueuedPresence && !hasProcessedPreclaimRemovalRef.current) {
          hasProcessedPreclaimRemovalRef.current = true;
          void forceLogoutIfUnassigned();
          return;
        }

        console.error(error.message || "Unable to sync queued attendee.");
      },
    });
  }, [attendeeClaimId, claimRecord, handleLogout, liveEvent.eventId, loggedIn]);

  useEffect(() => {
    const hasAssignedClaimForCurrentEvent =
      claimRecord?.claimId === attendeeClaimId && claimRecord?.eventId === liveEvent.eventId;

    if (hasAssignedClaimForCurrentEvent) {
      hasObservedAssignedClaimRef.current = true;
      return undefined;
    }

    if (
      !attendeeClaimId ||
      !loggedIn ||
      !liveEvent.eventId ||
      !hasObservedAssignedClaimRef.current ||
      isForcedLogoutPendingRef.current
    ) {
      return undefined;
    }

    let cancelled = false;

    const forceLogoutIfClaimRemoved = async () => {
      isForcedLogoutPendingRef.current = true;

      try {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 300);
        });

        if (cancelled) {
          isForcedLogoutPendingRef.current = false;
          return;
        }

        const existingClaim = await readClaimOnce({ claimId: attendeeClaimId });
        if (!cancelled && !existingClaim) {
          handleLogout();
          return;
        }

        isForcedLogoutPendingRef.current = false;
      } catch (e) {
        console.warn("claim removal check failed:", e?.message || e);
        if (!cancelled) {
          handleLogout();
          return;
        }
        isForcedLogoutPendingRef.current = false;
      }
    };

    void forceLogoutIfClaimRemoved();

    return () => {
      cancelled = true;
    };
  }, [attendeeClaimId, claimRecord, handleLogout, liveEvent.eventId, loggedIn]);

  useEffect(() => {
    if (!loggedIn || !user) {
      clearPersistedClaimSession();
      setPersistedClaimSession(null);
      return;
    }

    if (!claimRecord?.claimId || !claimRecord.eventId) {
      return;
    }

    const nextSession = {
      claimId: claimRecord.claimId,
      eventId: claimRecord.eventId,
      userId: user,
    };

    writePersistedClaimSession(nextSession);
    setPersistedClaimSession((currentSession) =>
      currentSession?.claimId === nextSession.claimId &&
      currentSession?.eventId === nextSession.eventId &&
      currentSession?.userId === nextSession.userId
        ? currentSession
        : nextSession,
    );
  }, [claimRecord, loggedIn, user]);

  useEffect(() => {
    if (!liveEvent.eventId) {
      clearPersistedClaimSession();
      setPersistedClaimSession(null);
      return;
    }

    if (persistedClaimEventId && persistedClaimEventId !== liveEvent.eventId) {
      clearPersistedClaimSession();
      setPersistedClaimSession(null);
    }
  }, [liveEvent.eventId, persistedClaimEventId]);

  useEffect(() => {
    if (!loggedIn || !claimAccessGranted || !liveEvent.eventId) {
      return;
    }

    writeConfirmedClaimAccess({
      eventId: liveEvent.eventId,
      userId: user,
    });

    const hasClaimForCurrentEvent =
      Boolean(claimRecord?.claimId) && claimRecord?.eventId === liveEvent.eventId;
    const hasPreclaimForCurrentEvent = claimPreclaim?.eventId === liveEvent.eventId;

    // If the user has claim access but the claim window isn't open yet,
    // enqueue them into the pre-claim queue so they'll be assigned automatically
    // when the event opens.
    (async () => {
      try {
        if (
          loggedIn &&
          claimAccessGranted &&
          // Same reasoning as assignDiscordNumber: no code, no call, so a
          // returning queued attendee is not bounced back to the gate.
          (activeClaimAccessCode || hasTrustedStaffAccess) &&
          liveEvent.eventId &&
          hasTrustedAttendeeAccess &&
          !isForcedLogoutPendingRef.current &&
          !isClaimWindowOpen &&
          user &&
          !hasClaimForCurrentEvent &&
          !hasPreclaimForCurrentEvent
        ) {
          await joinQueueAsAttendee({
            avatarUrl,
            claimAccessCode: activeClaimAccessCode,
            displayName: username || user,
            eventId: liveEvent.eventId,
          });
          // Read the queue entry back straight away so the attendee sees their
          // queued state without waiting for the event to open.
          try {
            const preclaim = await readPreclaimOnce({
              claimId: buildClaimId(liveEvent.eventId, attendeeClaimKey),
            });
            setClaimPreclaim(preclaim ?? null);
          } catch (e) {
            console.warn("joinQueueAsAttendee: readPreclaimOnce failed", e?.message || e);
          }
        }
      } catch (e) {
        if (handleClaimAccessRejected(e)) {
          return;
        }

        // Non-fatal: continue without blocking the UI.
        console.warn("joinQueueAsAttendee failed:", e?.message || e);
      }
    })();
  }, [
    activeClaimAccessCode,
    attendeeClaimKey,
    claimAccessGranted,
    liveEvent.eventId,
    loggedIn,
    user,
    handleClaimAccessRejected,
    isClaimWindowOpen,
    claimRecord,
    claimPreclaim,
    avatarUrl,
    username,
    hasTrustedAttendeeAccess,
    hasTrustedStaffAccess,
  ]);

  

  

  const assignDiscordNumber = useCallback(async () => {
    if (
      claimLoading ||
      !loggedIn ||
      !hasTrustedAttendeeAccess ||
      !liveEvent.eventId ||
      !user
    ) {
      return { status: "skipped" };
    }

    /*
     * Without a scanned code the server will refuse, which would bounce a
     * returning attendee to the "scan the QR" screen even though they already
     * hold a number. Their existing claim arrives via subscribeToClaim instead.
     */
    if (!activeClaimAccessCode && !hasTrustedStaffAccess) {
      return { status: "skipped" };
    }

    setClaimLoading(true);

    try {
      const result = await claimNumberAsAttendee({
        avatarUrl,
        claimAccessCode: activeClaimAccessCode,
        displayName: username || user,
        eventId: liveEvent.eventId,
      });

      setClaimResult(result);
      // Read the claim document straight away so the QR panel appears without
      // waiting for the polling subscription to catch up.
      try {
        const docData = await readClaimOnce({ claimId: result.claimId });
        if (docData) {
          setClaimRecord(normalizeClaimRecord(result.claimId, docData));
        }
      } catch (e) {
        console.warn("assignDiscordNumber: readClaimOnce failed", e?.message || e);
      }
      setClaimError("");
      setIsStaffSelfClaimMode(false);

      return { status: "ok" };
    } catch (error) {
      if (handleClaimAccessRejected(error)) {
        setClaimError("");
        return { status: "rejected" };
      }

      setClaimError(error.message || "Unable to assign a number right now.");

      /* Handed back rather than only reported, because whether this is worth
         trying again is the caller's question — see the retry policy in
         src/claimRetry.js and the effect that reads this below. */
      return { error, status: "failed" };
    } finally {
      setClaimLoading(false);
    }
  }, [
    activeClaimAccessCode,
    avatarUrl,
    claimLoading,
    handleClaimAccessRejected,
    hasTrustedAttendeeAccess,
    hasTrustedStaffAccess,
    liveEvent.eventId,
    loggedIn,
    user,
    username,
  ]);

  /*
   * Issues this staff member their own claim, and reads it straight back.
   *
   * Shared by the button in the header and by the automatic issue below, so
   * both produce the same claim through the same call. Returns the error rather
   * than reporting it: whether a failure is worth interrupting somebody over
   * depends on whether they asked for this, and only the caller knows that.
   */
  const requestStaffClaim = useCallback(async () => {
    setClaimLoading(true);

    try {
      // Staff are already trusted, so the callable lets them through without a
      // scanned code — they are running the event, not standing at the display.
      const result = await claimNumberAsAttendee({
        avatarUrl: avatarUrl ?? "",
        claimAccessCode: activeClaimAccessCode,
        displayName: username || user,
        eventId: liveEvent.eventId,
      });

      setClaimResult(result);
      try {
        const docData = await readClaimOnce({ claimId: result.claimId });
        if (docData) {
          setClaimRecord(normalizeClaimRecord(result.claimId, docData));
        }
      } catch (e) {
        console.warn("requestStaffClaim: readClaimOnce failed", e?.message || e);
      }
      setClaimError("");

      return null;
    } catch (e) {
      return e;
    } finally {
      setClaimLoading(false);
    }
  }, [activeClaimAccessCode, avatarUrl, liveEvent.eventId, user, username]);

  const handleStaffManualClaim = useCallback(async () => {
    if (!liveEvent.eventId || !loggedIn || !user) return;

    const error = await requestStaffClaim();

    if (error) {
      showControlFailureAlert(error?.message || "Unable to assign number.");
    }

    setIsStaffSelfClaimMode(false);
  }, [liveEvent.eventId, loggedIn, requestStaffClaim, showControlFailureAlert, user]);

  /*
   * A staff member's QR code, handed over without being asked for.
   *
   * A staff claim is not a place in the queue — it sits before #1 and is live
   * for the whole of every round (see src/staffNumbers.js) — so there is
   * nothing for the room to lose by staff holding one, and everyone working a
   * table needs a code somebody can scan when they pick something up. It used
   * to sit behind a button on the last page of the walkthrough, which meant the
   * people running the event were the only ones who had to remember to get one.
   *
   * Waits for the claim subscription to report before calling, so somebody who
   * already holds a claim is never issued anything; the ref then keeps a
   * re-render or a flapping subscription from calling twice. A repeat would be
   * harmless in any case — claimNumberAsAttendee returns the existing claim
   * rather than a second number — but it is a network call either way.
   *
   * Failures are logged and left there. Nobody asked for this, so nothing about
   * it should interrupt them mid-event, and the header button issues the same
   * claim by hand if it ever matters.
   */
  const autoStaffClaimAttemptRef = useRef("");

  useEffect(() => {
    if (
      mode !== "control" ||
      !isEventLive ||
      !hasTrustedStaffAccess ||
      !liveEvent.eventId ||
      !attendeeClaimId ||
      !user ||
      !isClaimLookupResolved ||
      claimLoading ||
      claimRecord?.eventId === liveEvent.eventId
    ) {
      return;
    }

    const attemptKey = `${liveEvent.eventId}:${attendeeClaimId}`;

    if (autoStaffClaimAttemptRef.current === attemptKey) {
      return;
    }

    autoStaffClaimAttemptRef.current = attemptKey;

    (async () => {
      const error = await requestStaffClaim();

      if (error) {
        console.warn("Automatic staff claim failed:", error?.message || error);
      }
    })();
  }, [
    attendeeClaimId,
    claimLoading,
    claimRecord,
    hasTrustedStaffAccess,
    isClaimLookupResolved,
    isEventLive,
    liveEvent.eventId,
    mode,
    requestStaffClaim,
    user,
  ]);

  // This gate decides which screen to show, not whether the attendee actually
  // gets in — the code is verified server-side by claimNumberAsAttendee and
  // joinQueueAsAttendee, which is the only check that counts. Being optimistic
  // here just avoids showing the "scan the QR" wall to someone who did scan it.
  useEffect(() => {
    if (!isEventLive || !liveEvent.eventId) {
      setClaimAccessGranted(false);
      setClaimAccessStatus("");
      clearClaimAccessGrant();
      return;
    }

    const storedGrant = readClaimAccessGrant();
    const confirmedAccess = readConfirmedClaimAccess();
    const hasStoredGrant =
      storedGrant?.eventId === liveEvent.eventId &&
      storedGrant?.expiresAt > currentTime &&
      storedGrant?.code !== rejectedClaimAccessCode;
    const hasConfirmedAccess =
      loggedIn &&
      confirmedAccess?.eventId === liveEvent.eventId &&
      confirmedAccess?.userId === user;
    const hasUnusedUrlCode = claimAccessCode && claimAccessCode !== rejectedClaimAccessCode;

    if (hasUnusedUrlCode) {
      /*
       * Banked once per code, not on every tick.
       *
       * This effect re-runs on the clock, and the write used to be
       * unconditional — so for as long as an attendee had their ticket open
       * with `?claim=` still in the URL, which is all evening, the grant was
       * re-serialised into sessionStorage once a second. It also meant the
       * expiry slid forward continuously and the 30-minute window never
       * actually ran, which is not what CLAIM_ACCESS_GRANT_MS says it is.
       *
       * The screen stays granted regardless while the code is in the URL: this
       * branch does not consult the stored grant, it only leaves one behind for
       * after the URL loses the code — an OAuth round trip, or a navigation.
       */
      if (storedGrant?.code !== claimAccessCode || storedGrant?.eventId !== liveEvent.eventId) {
        writeClaimAccessGrant({
          code: claimAccessCode,
          eventId: liveEvent.eventId,
          expiresAt: Date.now() + CLAIM_ACCESS_GRANT_MS,
        });
      }

      setClaimAccessGranted(true);
      setClaimAccessStatus("");
      return;
    }

    if (hasConfirmedAccess || hasStoredGrant) {
      setClaimAccessGranted(true);
      setClaimAccessStatus("");
      return;
    }

    setClaimAccessGranted(false);
    setClaimAccessStatus(
      rejectedClaimAccessCode
        ? "That event QR code expired. Scan the code on the display again to claim a number."
        : "Scan the in-person event QR code to claim a number.",
    );
  }, [
    claimAccessCode,
    currentTime,
    isEventLive,
    liveEvent.eventId,
    loggedIn,
    rejectedClaimAccessCode,
    user,
  ]);

  useEffect(() => {
    if (!isEventLive || !hasTrustedStaffAccess) {
      setClaimAccessSecret("");
      return undefined;
    }

    return subscribeToClaimAccessSecret({
      onSecret: setClaimAccessSecret,
      onError: (error) => {
        setClaimAccessSecret("");
        console.error(error.message || "Unable to read the display check-in code.");
      },
    });
  }, [hasTrustedStaffAccess, isEventLive]);

  useEffect(() => {
    if (!shouldSubscribeToRosterData) {
      setClaimRoster([]);
      return undefined;
    }

    return subscribeToClaims({
      eventId: liveEvent.eventId,
      onClaims: (nextClaims) => {
        const normalizedClaims = nextClaims.map((nextClaim) => normalizeRosterClaim(nextClaim));
        setClaimRoster(normalizedClaims);
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync attendee claims.");
      },
    });
  }, [liveEvent.eventId, shouldSubscribeToRosterData]);

  /*
   * The queue, live rather than polled.
   *
   * This used to call the listPreclaims callable every five seconds, which read
   * the entire queue and cost a function invocation each time — per staff tab.
   * Before the doors open on a busy event that is thousands of document reads a
   * minute for a list that changes a few times a minute. A listener costs one
   * read per document that actually changes; see subscribeToPreclaims, which
   * still degrades to polling if the watch stream gives out.
   *
   * The sort stays here rather than on the query: ordering by createdAt
   * server-side would need an index for a list this short, and the roster
   * re-sorts it members-first anyway.
   */
  useEffect(() => {
    /* Subscribed for the whole of a live event rather than only while the queue
       card is up. Gating the listener on the card meant the two decided each
       other: the card is shown when entries remain, and entries could only be
       seen while the card was shown, so after the start time it could never
       come back. The listener is one document per change on a list that changes
       a handful of times a night. */
    if (!isEventLive || mode !== "control" || !hasTrustedStaffAccess) {
      setClaimPreclaims([]);
      return undefined;
    }

    return subscribeToPreclaims({
      eventId: liveEvent.eventId,
      onPreclaims: (nextPreclaims) => {
        setClaimPreclaims(
          [...nextPreclaims].sort((leftPreclaim, rightPreclaim) => {
            const leftCreatedAt = leftPreclaim.createdAt?.toMillis
              ? leftPreclaim.createdAt.toMillis()
              : leftPreclaim.createdAt || 0;
            const rightCreatedAt = rightPreclaim.createdAt?.toMillis
              ? rightPreclaim.createdAt.toMillis()
              : rightPreclaim.createdAt || 0;

            return leftCreatedAt - rightCreatedAt;
          }),
        );
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync the queue.");
      },
    });
  }, [hasTrustedStaffAccess, isEventLive, liveEvent.eventId, mode]);

  const handleAssignPreclaimAsStaff = useCallback(async (preclaimId) => {
    try {
      await assignPreclaimAsStaff({ preclaimId });
    } catch (e) {
      console.error('assignPreclaimAsStaff failed', e?.message || e);
      showControlFailureAlert(e?.message || "Unable to assign queued attendee.");
      throw e;
    }
  }, [showControlFailureAlert]);

  const handleRefreshAllPreclaimMembershipsAsStaff = useCallback(async () => {
    try {
      const result = await refreshAllPreclaimMembershipsAsStaff();
      return result;
    } catch (e) {
      console.error("refreshAllPreclaimMembershipsAsStaff failed", e?.message || e);
      showControlFailureAlert(e?.message || "Unable to refresh queued attendee memberships.");
      throw e;
    }
  }, [showControlFailureAlert]);

  const handleRemovePreclaimAsStaff = useCallback(async (preclaimId) => {
    try {
      await removePreclaimAsStaff({ preclaimId });
      /* Dropped locally as well as on the server: the queue listener carries
         the delete a round trip later, and the row should go on the press. */
      setClaimPreclaims((currentPreclaims) =>
        currentPreclaims.filter((preclaim) => preclaim.preclaimId !== preclaimId),
      );
    } catch (e) {
      console.error("removePreclaimAsStaff failed", e?.message || e);
      showControlFailureAlert(e?.message || "Unable to remove queued attendee.");
      throw e;
    }
  }, [showControlFailureAlert]);

  /*
   * Held by value, not by the identity normalizeLiveEvent hands back.
   *
   * That object is rebuilt on every snapshot of the event document — which each
   * fake attendee joining causes, by way of the claim counter. The demo driver
   * keys its join timer on this, so a fresh identity per snapshot would restart
   * that timer continuously and the drip would never reach its next person.
   */
  const {
    memberPercent: demoMemberPercent,
    participantCount: demoParticipantCount,
    pickupChancePercent: demoPickupChancePercent,
    preStartPercent: demoPreStartPercent,
  } = liveEvent.demo;
  const demoConfig = useMemo(
    () => ({
      memberPercent: demoMemberPercent,
      participantCount: demoParticipantCount,
      pickupChancePercent: demoPickupChancePercent,
      preStartPercent: demoPreStartPercent,
    }),
    [demoMemberPercent, demoParticipantCount, demoPickupChancePercent, demoPreStartPercent],
  );

  /*
   * Demo events only: freezes the fake attendees where they are, so staff can
   * look at a group or a backlog without it clearing itself underneath them.
   *
   * Read off the event rather than held per tab. Each control panel runs its own
   * demo driver, so a pause only one tab knew about left any other one still
   * joining people and taking items — indistinguishable, from the room, from
   * the button doing nothing.
   */
  const isDemoPaused = liveEvent.isDemoPaused === true;
  const toggleDemoPaused = useCallback(async () => {
    const nextPaused = !isDemoPaused;

    // Echoed locally first: this stops the driver in this tab on the same tick
    // rather than a round trip later, and the subscription corrects it if the
    // write fails.
    setLiveEvent((currentEvent) => ({ ...currentEvent, isDemoPaused: nextPaused }));

    try {
      await setDemoPausedAsStaff({ paused: nextPaused });
    } catch (error) {
      showControlFailureAlert(error.message || "Unable to pause the demo.");
    }
  }, [isDemoPaused, showControlFailureAlert]);

  const handleSeedDemoParticipants = useCallback(
    async ({ eventId, participants }) => seedDemoParticipantsAsStaff({ eventId, participants }),
    [],
  );
  const handleAssignQueuedDemoParticipants = useCallback(
    async ({ eventId }) => assignQueuedDemoParticipantsAsStaff({ eventId }),
    [],
  );
  const handleRedeemDemoClaim = useCallback(
    async ({ claimId, eventId }) => redeemDemoClaimAsStaff({ claimId, eventId }),
    [],
  );
  const handleJoinRaffleAsDemoParticipant = useCallback(
    async ({ claimId, eventId }) => joinRaffleAsDemoParticipantAsStaff({ claimId, eventId }),
    [],
  );
  /* The same call a staff member's scanner makes. A demo claim carries a real
     qrToken, so a fake winner collects a prize through the path a real one
     does rather than through a shortcut that could record something different. */
  const handleRedeemDemoRafflePrize = useCallback(
    async ({ claimId, eventId, qrToken }) => redeemRaffleByQr({ claimId, eventId, qrToken }),
    [],
  );

  const { demoStatus } = useDemoEvent({
    claims: currentEventClaims,
    demoConfig,
    // Only where the event is being run. The display route subscribes to the
    // same roster, and a second driver would double every join.
    enabled: Boolean(liveEvent.isDemo) && canManageEvent,
    eventId: liveEvent.eventId,
    isEventStarted,
    isPaused: isDemoPaused,
    liveState,
    onAssignQueued: handleAssignQueuedDemoParticipants,
    onJoinRaffle: handleJoinRaffleAsDemoParticipant,
    onRedeem: handleRedeemDemoClaim,
    onRedeemRafflePrize: handleRedeemDemoRafflePrize,
    onSeed: handleSeedDemoParticipants,
  });

  /*
   * Opening an attendee's ticket is a navigation, not a dialog.
   *
   * It pushes a history entry on the same URL so the browser's Back button (and
   * a phone's back gesture, which is how staff will actually leave it) returns
   * to the attendee list instead of dropping them out of the control panel.
   */
  const openAttendeeTicketPreview = useCallback((claimId) => {
    if (!claimId) {
      return;
    }

    setPreviewClaimId(claimId);
    window.history.pushState({ attendeeTicketPreview: claimId }, document.title, getScreenUrl("control"));
  }, []);

  const closeAttendeeTicketPreview = useCallback(() => {
    setPreviewClaimId("");
    // Unwinds the entry pushed above, so leaving by the on-screen button and
    // leaving by Back land in the same place.
    window.history.back();
  }, []);

  const handleFetchLatestAnnouncement = useCallback(async () => readLatestAnnouncement(), []);
  const handleReadArchivedEvents = useCallback(async () => readArchivedEvents(), []);
  const handleReadArchivedEvent = useCallback(async ({ eventId }) => readArchivedEvent({ eventId }), []);

  const handleDeleteArchivedEvent = useCallback(async ({ eventId }) => {
    try {
      return await deleteArchivedEvent({ eventId });
    } catch (e) {
      console.error("deleteArchivedEvent failed", e?.message || e);
      throw e;
    }
  }, []);

  const handleRemoveClaim = useCallback(async (claimId) => {
    try {
      await removeClaim({ claimId });
    } catch (e) {
      console.error('removeClaim failed', e?.message || e);
      showControlFailureAlert(e?.message || "Unable to remove attendee.");
      throw e;
    }
  }, [showControlFailureAlert]);

  const handleMoveClaimBackToQueueAsStaff = useCallback(async (claimId) => {
    try {
      await moveClaimBackToQueueAsStaff({ claimId });
    } catch (e) {
      console.error("moveClaimBackToQueueAsStaff failed", e?.message || e);
      showControlFailureAlert(e?.message || "Unable to move attendee back to queue.");
      throw e;
    }
  }, [showControlFailureAlert]);

  useEffect(() => {
    if (mode === "control" && isEventLive && hasTrustedStaffAccess) {
      return;
    }

    setScannerActive(false);
  }, [hasTrustedStaffAccess, isEventLive, mode]);

  useEffect(() => {
    if (!scanFeedback) {
      return undefined;
    }

    // Long enough to read a name off the middle of the screen, short enough
    // that the camera is back before the next attendee has their code up.
    const timeoutId = window.setTimeout(() => {
      setScanFeedback(null);
    }, SCAN_FEEDBACK_VISIBLE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scanFeedback]);

  useEffect(() => {
    scanHandlerRef.current = async (rawValue) => {
      /*
       * The camera is stopped by the callback that got us here, so every way
       * out of this function has to put it back. A return that skipped the
       * restart — an unreadable code, most often — left the operator looking
       * at a black rectangle with no way back but closing the scanner and
       * opening it again.
       */
      const resumeScanner = () => {
        if (!scannerActive || !scannerRef.current) {
          return;
        }

        scannerRef.current.start().catch((error) => {
          setScanFeedback({
            tone: "error",
            message: error.message || "Unable to restart the camera scanner.",
          });
          setScannerActive(false);
        });
      };

      // The scan already in flight owns the camera and will restart it itself.
      if (scanLoading) {
        return;
      }

      if (!rawValue) {
        resumeScanner();
        return;
      }

      const payload = parseClaimQrPayload(rawValue);
      /* One camera, two kinds of code. The payloads are told apart by their
         `kind`, and a raffle prize deliberately does not reach the item-claim
         path — it must never touch a round, a count or the graphs. */
      const rafflePayload = payload ? null : parseRaffleQrPayload(rawValue);

      if (!payload && !rafflePayload) {
        setScanFeedback({
          tone: "error",
          message: "That QR code is not a valid attendee claim code.",
        });
        resumeScanner();
        return;
      }

      setScanLoading(true);

      try {
        if (rafflePayload) {
          const raffleResult = await redeemRaffleByQr(rafflePayload);
          const raffleWho = raffleResult.displayName
            ? `${raffleResult.number} — ${raffleResult.displayName}`
            : String(raffleResult.number);

          setScanFeedback({
            tone: raffleResult.alreadyClaimed ? "info" : "success",
            message: raffleResult.alreadyClaimed
              ? `${raffleWho} already collected their raffle prize`
              : `Raffle prize confirmed for ${raffleWho}`,
          });
          return;
        }

        const result = await redeemClaimByQr(payload);

        setScanFeedback({
          tone: result.alreadyRedeemed ? "info" : "success",
          message: result.alreadyRedeemed
            ? `${result.number} already claimed an item in round ${result.round}`
            : `Marked ${result.number} as claimed for round ${result.round}`,
        });
      } catch (error) {
        setScanFeedback({
          tone: "error",
          message:
            error.message ||
            (rafflePayload
              ? "Unable to confirm that raffle prize."
              : "Unable to mark that attendee as claimed."),
        });
      } finally {
        setScanLoading(false);
        resumeScanner();
      }
    };
  }, [scanLoading, scannerActive]);

  useEffect(() => {
    if (!scannerActive || !scannerVideoRef.current || !hasTrustedStaffAccess || !isEventLive) {
      return undefined;
    }

    let isDisposed = false;
    let scanner = null;

    // A fresh open is a fresh look at the room, so the code the last one ended
    // on is fair game again straight away.
    lastScanRef.current = { atMs: 0, value: "" };

    const startScanner = async () => {
      try {
        if (!qrScannerModuleRef.current) {
          const qrScannerModule = await import("qr-scanner");
          qrScannerModuleRef.current = qrScannerModule.default;
        }

        if (isDisposed || !scannerVideoRef.current) {
          return;
        }

        scanner = new qrScannerModuleRef.current(
          scannerVideoRef.current,
          (result) => {
            const value = typeof result === "string" ? result : result?.data ?? "";
            const nowMs = Date.now();
            const { atMs, value: lastValue } = lastScanRef.current;

            /* A code stays in frame for as long as it takes the attendee to
               lower their phone, and the scanner reads it five times a second.
               Ignoring the repeats here rather than in the handler is what
               keeps the camera running through them: stopping and restarting
               it on every repeat is what makes the feed stutter. */
            if (value === lastValue && nowMs - atMs < SCAN_REPEAT_COOLDOWN_MS) {
              return;
            }

            lastScanRef.current = { atMs: nowMs, value };

            // Held off the frame grabber for the round trip, and restarted by
            // the handler on its way out.
            scanner.stop();
            void scanHandlerRef.current?.(value);
          },
          {
            // Both off: these are the library's own overlay — the bouncing
            // amber corner marks and the outline it throws around a detected
            // code. The scanner modal draws its own wireframe guide instead,
            // which carries the scan state in its colour.
            highlightCodeOutline: false,
            highlightScanRegion: false,
            maxScansPerSecond: 5,
            preferredCamera: "environment",
          },
        );

        scannerRef.current = scanner;
        await scanner.start();
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setScanFeedback({
          tone: "error",
          message: error.message || "Unable to start the camera scanner.",
        });
        setScannerActive(false);
      }
    };

    void startScanner();

    return () => {
      isDisposed = true;

      if (scanner) {
        scanner.destroy();
      }

      if (scannerRef.current === scanner) {
        scannerRef.current = null;
      }
    };
  }, [hasTrustedStaffAccess, isEventLive, scannerActive]);

  /*
   * Getting the attendee their number, and knowing when to stop asking.
   *
   * This effect's own dependencies include the loading flag it sets, so a
   * failed call used to flip that flag back and re-run the effect on the spot —
   * a tight loop of one callable per round trip, with no cap, on every phone in
   * the room. The failures that set it off are the ones a busy event produces
   * (a callable at its instance ceiling, a transaction that timed out, a phone
   * that lost the network for a second), so three hundred devices would start
   * hammering the callable at the moment it was already struggling, and keep it
   * there.
   *
   * Now every attempt after the first waits, the waits double and are jittered
   * so the room does not come back in step, and after MAX_CLAIM_ATTEMPTS the
   * page stops and offers a button instead. A refusal that will never succeed —
   * a closed event, a rejected code — stops on the first try. See
   * src/claimRetry.js.
   */
  /*
   * A boolean rather than the queue entry itself, because both effects below
   * depend on it.
   *
   * The subscription hands back a fresh object on every delivery, and if the
   * watch stream has degraded to polling that is every 1.2 seconds — so
   * depending on the object would tear an effect down and reschedule its timer
   * faster than the backoff could ever elapse, and the retry would never fire
   * at all. Whether there is a queue entry for this event is all either effect
   * actually reads, and that changes twice a night.
   */
  const hasQueueEntryForThisEvent =
    Boolean(claimPreclaim) && claimPreclaim?.eventId === liveEvent.eventId;

  const claimRetryRef = useRef(createClaimRetryState());

  useEffect(() => {
    if (
      !isEventLive ||
      !claimAccessGranted ||
      !loggedIn ||
      !hasTrustedAttendeeAccess ||
      isCheckingAccess ||
      !isClaimWindowOpen ||
      claimLoading ||
      effectiveClaimResult ||
      /*
       * Somebody already in the queue is not this effect's to admit.
       *
       * claimNumberAsAttendee demands a display code that is at most about
       * three minutes old, and a queued attendee's is not: they scanned during
       * member early access and have been waiting ever since. So at the instant
       * the doors opened, every queued phone in the room called it with a
       * fifteen-minute-old code, the server refused all of them, and
       * handleClaimAccessRejected read that refusal as "your scan has expired"
       * — clearing the grant and putting the whole queue in front of the
       * "scan the code on the display again" wall, at the one moment nobody is
       * anywhere near the projector.
       *
       * Their number was never actually in doubt. It arrives from the queue
       * path below, or from the every-minute sweep on the server, neither of
       * which needs a code — the queue entry is itself the proof that they
       * scanned. This effect is for the walk-up who has just scanned and has no
       * queue entry at all.
       */
      hasQueueEntryForThisEvent
    ) {
      return undefined;
    }

    const retryKey = `${liveEvent.eventId}:${attendeeClaimKey}`;

    // A different event, or a different attendee, is a fresh question — the
    // attempts spent on the last one say nothing about this one.
    if (claimRetryRef.current.key !== retryKey) {
      claimRetryRef.current = createClaimRetryState(retryKey);
    }

    if (isClaimRetryExhausted) {
      return undefined;
    }

    const delayMs = getClaimRetryDelayMs(claimRetryRef.current.attemptCount);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const outcome = await assignDiscordNumber();

        if (outcome?.status !== "failed") {
          if (outcome?.status === "ok") {
            claimRetryRef.current = createClaimRetryState(retryKey);
          }
          return;
        }

        claimRetryRef.current = nextClaimRetryState(claimRetryRef.current, retryKey);

        if (
          !shouldRetryClaim({
            attemptCount: claimRetryRef.current.attemptCount,
            error: outcome.error,
          })
        ) {
          setIsClaimRetryExhausted(true);
        }
      })();
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    assignDiscordNumber,
    attendeeClaimKey,
    claimLoading,
    claimAccessGranted,
    effectiveClaimResult,
    isClaimRetryExhausted,
    isClaimWindowOpen,
    isCheckingAccess,
    isEventLive,
    hasQueueEntryForThisEvent,
    liveEvent.eventId,
    loggedIn,
    hasTrustedAttendeeAccess,
  ]);

  /*
   * Fallback for a queued attendee the server-side sweep did not reach.
   *
   * Gated on actually holding a queue entry, which the preclaim subscription
   * above already knows. It used to fire for anybody without a claim, so at the
   * moment the doors opened every phone in the room called it — and for almost
   * all of them the answer was "you were never queued", reached by way of a
   * transaction that read the same event document every check-in has to write.
   * Three hundred no-op calls, all contending on the one hot document, at the
   * busiest second of the evening.
   *
   * Bounded the same way as the claim itself, and for the same reason: this
   * effect's dependencies also include the loading flag it waits on.
   */
  const preclaimAssignRetryRef = useRef(createClaimRetryState());
  useEffect(() => {
    if (
      !isClaimWindowOpen ||
      !loggedIn ||
      !user ||
      !attendeeClaimKey ||
      !liveEvent.eventId ||
      !hasQueueEntryForThisEvent ||
      claimRecord ||
      claimLoading
    ) {
      return undefined;
    }

    const retryKey = `${liveEvent.eventId}:${attendeeClaimKey}`;

    if (preclaimAssignRetryRef.current.key !== retryKey) {
      preclaimAssignRetryRef.current = createClaimRetryState(retryKey);
    }

    if (preclaimAssignRetryRef.current.attemptCount >= MAX_CLAIM_ATTEMPTS) {
      return undefined;
    }

    let cancelled = false;
    /*
     * The first attempt is spread, and this is the one place in the app where
     * that matters.
     *
     * Everywhere else the first attempt is immediate on purpose: somebody who
     * has just scanned should not sit through a delay that exists for the
     * failure case. Here the trigger is a clock, not a person — every queued
     * phone in the room crosses the start time inside the same second and would
     * otherwise fire together, and every one of those calls opens a transaction
     * on the one document each check-in already has to write.
     *
     * The server sweeps the whole queue every minute now, so nothing is waiting
     * on this: it is the fallback for a phone the sweep has not reached yet, and
     * spreading it over the first half-minute costs that phone nothing.
     */
    const delayMs =
      preclaimAssignRetryRef.current.attemptCount === 0
        ? getDoorsOpenJitterMs()
        : getClaimRetryDelayMs(preclaimAssignRetryRef.current.attemptCount);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        preclaimAssignRetryRef.current = nextClaimRetryState(
          preclaimAssignRetryRef.current,
          retryKey,
        );

        try {
          // The key is the one the rest of the page already derives. The server
          // rebuilds it from the verified token and refuses anything else, so
          // the two constructions have to stay identical.
          const resp = await assignPreclaimIfQueued({
            eventId: liveEvent.eventId,
            claimKey: attendeeClaimKey,
          });

          if (cancelled) {
            return;
          }

          if (resp?.assigned) {
            preclaimAssignRetryRef.current = createClaimRetryState(retryKey);

            /*
             * Read the claim the server just wrote, rather than asking for one.
             *
             * This used to call assignDiscordNumber, which goes through
             * claimNumberAsAttendee — and that callable checks the display code
             * before it looks at anything else. A queued attendee's code is
             * always minutes old by the time the doors open, so the call was
             * guaranteed to come back permission-denied for somebody who had
             * just been given their number, and the refusal was read as an
             * expired scan. A point read says the same thing and cannot fail
             * that way; the claim subscription would deliver it a moment later
             * regardless, this just does not make them wait for it.
             */
            const assignedClaim = await readClaimOnce({
              claimId: buildClaimId(liveEvent.eventId, attendeeClaimKey),
            });

            if (!cancelled && assignedClaim) {
              setClaimRecord(
                normalizeClaimRecord(
                  buildClaimId(liveEvent.eventId, attendeeClaimKey),
                  assignedClaim,
                ),
              );
            }
          }
        } catch (e) {
          // If callable throws due to permission/other issues, log and continue.
          console.warn("preclaim-check failed:", e?.message || e);
        }
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    attendeeClaimKey,
    hasQueueEntryForThisEvent,
    isClaimWindowOpen,
    loggedIn,
    user,
    liveEvent.eventId,
    claimRecord,
    claimLoading,
    assignDiscordNumber,
  ]);

  /* Starts the attempts over, from the button the ticket shows once the page
     has given up. Their own press is the signal that whatever was wrong may
     have been fixed — a different network, a staff member re-opening the
     event — so the backoff goes back to nothing. */
  const retryClaimNow = useCallback(() => {
    claimRetryRef.current = createClaimRetryState();
    preclaimAssignRetryRef.current = createClaimRetryState();
    setClaimError("");
    setIsClaimRetryExhausted(false);
  }, []);

  /**
   * Saves a change to the live state.
   *
   * Callers build the whole state on top of `liveState`, so the change itself
   * is the difference between the two — and that is all that gets written, over
   * whatever is on the server by the time the write lands. Overlapping panels
   * therefore merge rather than collide: a slider moved here and a group called
   * there both stick, and neither one is refused.
   *
   * There is nothing to tell staff about when that happens, so nothing is told.
   * This used to raise "Another control panel changed the queue first" on every
   * overlap, which on a busy event meant a second staff screen reporting a
   * conflict every few seconds for changes it had made no part in — most often
   * because auto-advance runs on every panel at once and only one of them can
   * win each tick.
   *
   * `requireUnchangedFields` marks the rare write that must not merge, because
   * it only makes sense happening once; if another panel got there first it is
   * dropped, and the subscription brings back what they wrote.
   *
   * `alertOnFailure` is what staff pressing a button expect and what background
   * housekeeping does not: a write nobody asked for has nothing to say when it
   * fails.
   */
  const persistState = useCallback(async (
    newState,
    { alertOnFailure = true, requireUnchangedFields } = {},
  ) => {
    const baseState = liveState;
    const nextState = normalizeState(newState);
    const changes = getStateChanges(baseState, nextState);

    /* Applied over the newest local state rather than replacing it, for the
       same reason the server merges: a snapshot may have arrived between the
       render this was built from and now, and it would be thrown away. */
    setLiveEvent((currentEvent) => ({
      ...currentEvent,
      state: applyStateChanges(currentEvent.state, changes),
    }));

    if (!firebaseEnabled || !isEventLive) {
      return;
    }

    try {
      await pushLiveState(nextState, { baseState, requireUnchangedFields });
    } catch (error) {
      if (alertOnFailure) {
        showControlFailureAlert(error.message || "Unable to sync live event state.");
      }
    }
  }, [isEventLive, liveState, showControlFailureAlert]);

  /*
   * Rounds already under way when roundStartedAt was introduced have no value
   * for it — normalizeState defaults it to null rather than guessing at one.
   * Stamp it once, quietly, so the round timer has something to count from.
   *
   * Every staff panel on the event runs this, so it names roundStartedAt as a
   * field it will not merge: whichever panel stamps it first is the one that
   * counts, and the rest drop their write rather than overwriting a timestamp
   * that is already ticking with one a moment younger.
   */
  const roundStartedAtBackfillRef = useRef(null);
  useEffect(() => {
    if (!canManageEvent || liveState.roundStartedAt) {
      return;
    }

    const roundIsActive = liveState.finalCall || liveState.current > 0;
    if (!roundIsActive || roundStartedAtBackfillRef.current === liveEvent.eventId) {
      return;
    }

    roundStartedAtBackfillRef.current = liveEvent.eventId;
    void persistState(
      { ...liveState, roundStartedAt: Date.now() },
      { alertOnFailure: false, requireUnchangedFields: ["roundStartedAt"] },
    );
  }, [canManageEvent, liveEvent.eventId, liveState, persistState]);

  const increment = useCallback((amount) => {
    if (liveState.current === 0 && totalPeopleWithNumbers === 0) {
      setControlMessage("At least one attendee must claim a number before starting a round.");
      return;
    }

    setControlMessage("");
    const groupStartedAt = Date.now();
    persistState({
      ...liveState,
      current: liveState.current + amount,
      finalCall: false,
      finalCallTargetNumbers: [],
      groupStartedAt,
      last: liveState.current,
    });
  }, [liveState, persistState, totalPeopleWithNumbers]);

  const startRoundQueue = useCallback((nextRound = false) => {
    if (totalPeopleWithNumbers === 0) {
      return;
    }

    setControlMessage("");
    const groupStartedAt = Date.now();
    persistState({
      ...liveState,
      current: groupSize,
      finalCall: false,
      finalCallTargetNumbers: [],
      groupStartedAt,
      last: 0,
      round: nextRound ? liveState.round + 1 : liveState.round,
      /* Only a genuinely new round resets the clock — restarting the same
         pending round (nextRound === false) keeps counting from when it
         actually began. */
      roundStartedAt: nextRound ? groupStartedAt : liveState.roundStartedAt ?? groupStartedAt,
    });
  }, [groupSize, liveState, persistState, totalPeopleWithNumbers]);

  const updateGroupSize = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      groupSize: normalizeGroupSize(value),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceThresholdPercent = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceThresholdPercent: normalizeAutoAdvanceThresholdPercent(value),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceTimerMinutes = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceFinalCallTimerMinutes: normalizeAutoAdvanceTimerMinutes(value),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceStartRoundMinutes = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceStartRoundMinutes: normalizeAutoAdvanceTimerMinutes(value),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceGroupTimerMinutes = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceGroupTimerMinutes: normalizeAutoAdvanceTimerMinutes(value),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceBacklogClearedPercent = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceBacklogClearedPercent: normalizeAutoAdvanceBacklogClearedPercent(value),
    });
  }, [liveState, persistState]);

  /* The threshold is normalised rather than conditionally repaired: this used
     to substitute 100 when the stored threshold came back as 0, but
     normalizeAutoAdvanceThresholdPercent floors anything under 10 to the
     default of 80, so that branch could never be taken. */
  const toggleAutoAdvanceEnabled = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceEnabled: !liveState.autoAdvanceEnabled,
      autoAdvanceThresholdPercent: normalizeAutoAdvanceThresholdPercent(
        liveState.autoAdvanceThresholdPercent,
      ),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceAction = useCallback((field, value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      [field]: value,
    });
  }, [liveState, persistState]);

  /*
   * Ends the round and leaves the next one pending: nothing is called until
   * staff start it, or the pending round timer does.
   *
   * groupStartedAt is stamped rather than cleared, because in this state it is
   * what that timer counts from — the field already tracks "when the current
   * queue state began" for groups and for final call.
   */
  const newRound = useCallback(() => {
    setControlMessage("");
    const groupStartedAt = Date.now();
    persistState({
      ...liveState,
      current: 0,
      finalCall: false,
      finalCallTargetNumbers: [],
      groupStartedAt,
      last: 0,
      round: liveState.round + 1,
      /* Clocked from here rather than from when staff eventually press Start
         Round: this is the moment the previous round actually ended and the
         next one became pending. */
      roundStartedAt: groupStartedAt,
    });
  }, [liveState, persistState]);

  const activateFinalCall = useCallback(() => {
    setControlMessage("");
    const groupStartedAt = Date.now();
    persistState({
      ...liveState,
      finalCall: true,
      /* Attendees only. Final call sweeps up the people a group already called
         who have not collected; staff were never in a group, and their code
         works for the whole round anyway. */
      finalCallTargetNumbers: currentEventAttendeeClaims
        .filter((claim) => !hasClaimedInRound(claim, currentRound))
        .map((claim) => claim.number),
      groupStartedAt,
    });
  }, [currentEventAttendeeClaims, currentRound, liveState, persistState]);

  /*
   * The back button: one step back along the path the round came forward on.
   *
   * The step itself is worked out by getBacktrackStep, which the control panel
   * also reads so its confirmation dialog can name the step before it happens.
   * Nothing here touches a claim — an item already handed over stays handed
   * over, and hasClaimedInRound keeps that attendee out of the group when it is
   * called a second time, so a rewind only ever gives another chance to the
   * people who missed theirs.
   *
   * Auto-advance is switched off on the way past. Left on, it would look at the
   * group it has just been rewound into, find it already claimed past its
   * threshold, and step straight forward again — the rewind would not survive
   * its first tick. Turning it off rather than holding it silently keeps the
   * corner button honest about what the queue is going to do next.
   */
  const backtrackStep = useMemo(
    () =>
      getBacktrackStep({
        current: liveState.current,
        finalCall: liveState.finalCall,
        groupSize,
        highestClaimNumber: highestAttendeeNumber,
        last: liveState.last,
        round: liveState.round,
        totalPeopleWithNumbers,
      }),
    [groupSize, highestAttendeeNumber, liveState, totalPeopleWithNumbers],
  );

  const backtrack = useCallback(() => {
    if (!backtrackStep) {
      return;
    }

    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceEnabled: false,
      current: backtrackStep.current,
      finalCall: backtrackStep.finalCall,
      /* Rebuilt for the round being reopened rather than carried over: the list
         is "everyone still outstanding", and who that is has changed. */
      finalCallTargetNumbers: backtrackStep.finalCall
        ? currentEventAttendeeClaims
            .filter((claim) => !hasClaimedInRound(claim, backtrackStep.round))
            .map((claim) => claim.number)
        : [],
      groupStartedAt: Date.now(),
      last: backtrackStep.last,
      round: backtrackStep.round,
      /* Only reopening a previous round resets the clock — stepping back
         within the same round keeps its original start time. */
      roundStartedAt:
        backtrackStep.round === liveState.round ? liveState.roundStartedAt : Date.now(),
    });
  }, [backtrackStep, currentEventAttendeeClaims, liveState, persistState]);

  /*
   * The raffle.
   *
   * All four of these are ordinary state writes, so they go through
   * persistState like every other queue action: the optimistic local update
   * keeps the control panel responsive. Spinning is the one that cannot merge —
   * see spinRaffle, which refuses to draw a second winner over the first.
   */
  const updateRaffleOption = useCallback((field, value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      [field]: value,
    });
  }, [liveState, persistState]);

  const openRaffle = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      raffleOpen: true,
      // A fresh wheel: the previous reveal is cleared, but the winners
      // themselves are not, so re-opening the raffle still leaves everyone who
      // has already won out of the draw.
      raffleSpinCount: 0,
      raffleSpinStartedAtMs: null,
      raffleWinnerNumber: 0,
    });
  }, [liveState, persistState]);

  const closeRaffle = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      raffleOpen: false,
      raffleSpinCount: 0,
      raffleSpinStartedAtMs: null,
      raffleWinnerNumber: 0,
    });
  }, [liveState, persistState]);

  /*
   * Draws the winner here and now, then writes it with the moment the spin
   * began. The wheel on the display is animation only — it turns towards a
   * result that has already been decided, which is what lets a projector that
   * was opened mid-spin, or a second staff tab, land on the same name.
   */
  const spinRaffle = useCallback(() => {
    const nextSpinCount = (liveState.raffleSpinCount ?? 0) + 1;
    const winnerClaim = pickRaffleWinner(raffleDrawSegments);

    if (!winnerClaim) {
      setControlMessage(
        liveState.raffleMembersOnly
          ? "No members are eligible for this raffle."
          : "Nobody is eligible for this raffle yet.",
      );
      return;
    }

    setControlMessage("");
    /* The one write on the panel that must not merge. Two staff pressing Spin
       at the same moment each draw from their own copy of the wheel, and
       merging would let the second write land its winner over the first — one
       of the two names goes on the display, the other is quietly dropped back
       into the draw. Guarding on the spin counter means the second press is
       dropped instead, and both screens show the winner that was drawn. */
    persistState(
      {
        ...liveState,
        raffleOpen: true,
        raffleSpinCount: nextSpinCount,
        raffleSpinStartedAtMs: Date.now(),
        raffleWinnerNumber: winnerClaim.number,
        raffleWinnerNumbers: [...liveState.raffleWinnerNumbers, winnerClaim.number].slice(
          -RAFFLE_MAX_WINNERS,
        ),
      },
      { requireUnchangedFields: ["raffleSpinCount"] },
    );
  }, [liveState, persistState, raffleDrawSegments]);

  /*
   * Takes the result off the display, leaving the wheel up and ready.
   *
   * Only the current reveal: the winner stays on the winner list, so they keep
   * their prize code and stay out of the next draw. That is what separates this
   * from Clear Winner List, which throws the whole event's winners away.
   *
   * The spin counter is deliberately left alone. It only ever increases, and it
   * is what tells the wheel a new spin has been called — resetting it here would
   * make the next spin look like the first one all over again.
   */
  const clearRaffleWinner = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      raffleSpinStartedAtMs: null,
      raffleWinnerNumber: 0,
    });
  }, [liveState, persistState]);

  /* Puts every previous winner back in the draw and clears their prize codes.
     The undo for a spin staff did not mean to run. */
  const resetRaffleWinners = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      raffleSpinCount: 0,
      raffleSpinStartedAtMs: null,
      raffleWinnerNumber: 0,
      raffleWinnerNumbers: [],
    });
  }, [liveState, persistState]);

  useEffect(() => {
    if (!canManageEvent) {
      return;
    }

    const queueKey = isFinalCall
      ? `round:${currentRound}:final:${finalCallTargetNumbersKey}`
      : current === 0
        ? `round:${currentRound}:pending-start`
        : `round:${currentRound}:group:${last + 1}-${current}`;
    const finalCallElapsedMs =
      isFinalCall && liveState.groupStartedAt
        ? Math.max(0, currentTime - liveState.groupStartedAt)
        : 0;
    const shouldAdvanceFinalCallByTimer =
      isFinalCall &&
      liveState.autoAdvanceFinalCallTimerEnabled &&
      autoAdvanceFinalCallTimerMs > 0 &&
      finalCallElapsedMs >= autoAdvanceFinalCallTimerMs;
    /*
     * A pending round counts from when it became pending, which only newRound()
     * stamps. Round 1 has never had a queue state, so it has no reference and
     * never auto-starts — the first group of an event is always called by hand.
     */
    const pendingRoundStartedAtMs = liveState.groupStartedAt;
    const pendingRoundElapsedMs =
      pendingRoundStartedAtMs !== null && pendingRoundStartedAtMs !== undefined
        ? Math.max(0, currentTime - pendingRoundStartedAtMs)
        : 0;
    const shouldStartPendingRound =
      liveState.autoAdvanceStartRound &&
      pendingRoundStartedAtMs !== null &&
      pendingRoundStartedAtMs !== undefined &&
      autoAdvanceStartRoundMs > 0 &&
      pendingRoundElapsedMs >= autoAdvanceStartRoundMs;
    /*
     * The group timer is a backstop for a group that stalls: once it runs out,
     * move on whether or not the claimed threshold was reached. It measures the
     * active group only — final call has its own timer above.
     */
    const groupElapsedMs =
      !isFinalCall && liveState.groupStartedAt
        ? Math.max(0, currentTime - liveState.groupStartedAt)
        : 0;
    const shouldAdvanceGroupByTimer =
      !isFinalCall &&
      current > 0 &&
      liveState.autoAdvanceGroupTimerEnabled &&
      autoAdvanceGroupTimerMs > 0 &&
      groupElapsedMs >= autoAdvanceGroupTimerMs;
    const isBacklogTooLarge =
      liveState.autoAdvanceBacklogLimitEnabled &&
      backlogClearedRatio < autoAdvanceBacklogClearedPercent / 100;

    if (autoAdvanceQueueKeyRef.current !== queueKey) {
      autoAdvanceQueueKeyRef.current = "";
    }

    if (!liveState.autoAdvanceEnabled) {
      return;
    }

    /*
     * A raffle has the display.
     *
     * Auto-advance would otherwise carry on calling groups to a room that is
     * watching a prize wheel, and those attendees would never see their number
     * come up. The round is picked up exactly where it was left as soon as the
     * wheel comes down — nothing here is skipped, only postponed.
     */
    if (liveState.raffleOpen) {
      return;
    }

    if (isBacklogTooLarge) {
      return;
    }

    // A pending round: waiting on its timer, or on staff.
    if (!isFinalCall && current === 0) {
      if (
        !shouldStartPendingRound ||
        totalPeopleWithNumbers === 0 ||
        autoAdvanceQueueKeyRef.current === queueKey
      ) {
        return;
      }

      autoAdvanceQueueKeyRef.current = queueKey;
      startRoundQueue(false);
      return;
    }

    /*
     * Final call ends on its own timer or on staff pressing Next Round,
     * and on nothing else. In particular the claimed threshold does not end it:
     * stragglers are the whole reason it exists, so clearing the queue early is
     * no reason to stop waiting for them.
     *
     * It hands over to a pending round rather than calling the next group
     * itself — that is the pending round timer's job, above.
     */
    if (isFinalCall) {
      if (!shouldAdvanceFinalCallByTimer || autoAdvanceQueueKeyRef.current === queueKey) {
        return;
      }

      autoAdvanceQueueKeyRef.current = queueKey;
      newRound();
      return;
    }

    // A live group: the claimed threshold, with the group timer as a backstop.
    if (
      !shouldAdvanceGroupByTimer &&
      (autoAdvanceThresholdPercent <= 0 || activeQueueClaims.length === 0)
    ) {
      return;
    }

    const claimedRatio = activeQueueClaims.length
      ? activeQueueClaimedCount / activeQueueClaims.length
      : 0;

    const shouldAdvanceByThreshold = claimedRatio >= autoAdvanceThresholdRatio;

    if (!shouldAdvanceByThreshold && !shouldAdvanceGroupByTimer) {
      return;
    }

    if (autoAdvanceQueueKeyRef.current === queueKey) {
      return;
    }

    /*
     * No gate on entering final call: it is the only way a round can end, so
     * auto-advance always takes it once the last group is done.
     *
     * The Next Group toggle governs threshold advancement only — the group
     * timer is its own trigger and moves on regardless.
     */
    if (!isLastGroup && !liveState.autoAdvanceNextGroup && !shouldAdvanceGroupByTimer) {
      return;
    }

    autoAdvanceQueueKeyRef.current = queueKey;

    if (isLastGroup) {
      activateFinalCall();
      return;
    }

    increment(groupSize);
  }, [
    activeQueueClaimedCount,
    activeQueueClaims.length,
    activateFinalCall,
    autoAdvanceBacklogClearedPercent,
    autoAdvanceFinalCallTimerMs,
    autoAdvanceGroupTimerMs,
    autoAdvanceStartRoundMs,
    autoAdvanceThresholdPercent,
    autoAdvanceThresholdRatio,
    backlogClearedRatio,
    currentRound,
    currentTime,
    canManageEvent,
    finalCallTargetNumbersKey,
    groupSize,
    increment,
    newRound,
    current,
    isFinalCall,
    isLastGroup,
    last,
    liveState.autoAdvanceEnabled,
    liveState.raffleOpen,
    liveState.autoAdvanceBacklogLimitEnabled,
    liveState.autoAdvanceFinalCallTimerEnabled,
    liveState.autoAdvanceGroupTimerEnabled,
    liveState.autoAdvanceNextGroup,
    liveState.groupStartedAt,
    liveState.autoAdvanceStartRound,
    startRoundQueue,
    totalPeopleWithNumbers,
  ]);

  // Stable: this is a dependency of the book-list prefill effect, and a fresh
  // identity each render made that effect tear down and re-run continuously.
  const handleControlFieldChange = useCallback((field) => (event) => {
    setControlForm((currentForm) => ({
      ...currentForm,
      [field]: event.target.value,
    }));
  }, []);

  const validateTimeframe = () => {
    if (!controlForm.timeframeStart || !controlForm.timeframeEnd) {
      return "Add both a start time and an end time.";
    }

    // Caught here rather than at render: an unparseable value used to slip
    // through and show up literally on the display and attendee pages.
    if (
      !isValidClockTime(controlForm.timeframeStart) ||
      !isValidClockTime(controlForm.timeframeEnd)
    ) {
      return "Enter times as HH:MM, between 00:00 and 23:59.";
    }

    if (controlForm.timeframeEnd === controlForm.timeframeStart) {
      return "The start time and end time cannot be the same.";
    }

    return "";
  };

  const validateMemberCheckInLeadMinutes = () => {
    const parsedValue = Number.parseInt(controlForm.memberCheckInLeadMinutes, 10);

    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return "Member early check-in time must be 0 minutes or more.";
    }

    if (parsedValue > 60) {
      return "Member early check-in time cannot be more than 60 minutes.";
    }

    return "";
  };

  // The event schedule is entered as wall-clock text. Cloud Functions run in UTC
  // and cannot resolve "19:00" to the right instant, so resolve it here — in the
  // venue's own timezone — and store absolute values for the server to use.
  //
  // Deliberately passes no stored instants: turning the form's text into those
  // instants is this function's whole job, so it always takes the clock-time
  // path in getEventSchedule.
  const buildEventScheduleTimestamps = (formValues, startedAt) => {
    const schedule = getEventSchedule({
      memberCheckInLeadMinutes: normalizeMemberCheckInLeadMinutes(
        formValues.memberCheckInLeadMinutes,
      ),
      now: Date.now(),
      startedAt,
      timeframeEnd: formValues.timeframeEnd,
      timeframeStart: formValues.timeframeStart,
    });

    return {
      eventEndAtMs: schedule.eventEndTime ? schedule.eventEndTime.getTime() : null,
      eventStartAtMs: schedule.eventStartTime ? schedule.eventStartTime.getTime() : null,
      memberEarlyAccessAtMs: schedule.memberEarlyAccessTime
        ? schedule.memberEarlyAccessTime.getTime()
        : null,
    };
  };

  // Only the fields this form owns. Everything else about the round in progress
  // is merged server-side from the current state.
  const buildEventStateChangesFromForm = () => ({
    memberCheckInLeadMinutes: normalizeMemberCheckInLeadMinutes(
      controlForm.memberCheckInLeadMinutes,
    ),
    claimRulesText: normalizeClaimRulesText(controlForm.claimRulesText),
    displayFeedEnabled: controlForm.displayFeedEnabled !== false,
    // Clamped to the same limits the security rules enforce, so an over-long
    // title fails as a trimmed title rather than an unexplained save error.
    qrUrl: (controlForm.qrUrl.trim() || defaultQrUrl).slice(0, 2048),
    title: (controlForm.title.trim() || initialState.title).slice(0, 120),
    titleFont: normalizeTitleFont(controlForm.titleFont),
  });

  const buildEventStateFromForm = (baseState = liveState) =>
    normalizeState({ ...baseState, ...buildEventStateChangesFromForm() });

  const handleStartEvent = async (event) => {
    event.preventDefault();
    setControlMessage("");
    const timeframeError = validateTimeframe();
    const memberCheckInLeadMinutesError = validateMemberCheckInLeadMinutes();

    if (timeframeError) {
      setControlMessage(timeframeError);
      return;
    }

    if (memberCheckInLeadMinutesError) {
      setControlMessage(memberCheckInLeadMinutesError);
      return;
    }

    setControlSaving(true);

    const isDemo = controlForm.isDemo === true;
    const eventId = buildEventId();

    /*
     * Decides which walkthrough the control panel puts in front of whoever is
     * sitting here: the person who set the event up gets the whole deck.
     *
     * Written before the event rather than after it because Firestore applies a
     * batch locally and fires the live subscription with it long before commit()
     * resolves — marking afterwards let the panel open the helper deck at the
     * creator. A key left behind by a create that then failed is inert: event
     * ids are minted fresh every time, so nothing ever matches it again.
     */
    markEventCreatedHere(eventId);

    try {
      await createLiveEvent({
        ...buildEventScheduleTimestamps(controlForm, null),
        claimAccessSecret: createClaimAccessSecret(),
        // Fixed at creation. Whether an event is a demo decides whether its
        // attendee list survives being closed, so it is not an edit-time
        // setting — Edit Event Details never offers it.
        demo: isDemo ? buildDemoConfigFromForm(controlForm) : null,
        eventId,
        isDemo,
        state: buildEventStateFromForm(initialState),
        timeframeEnd: controlForm.timeframeEnd,
        timeframeLabel: formatTimeRange(
          controlForm.timeframeStart,
          controlForm.timeframeEnd,
        ),
        timeframeStart: controlForm.timeframeStart,
      });
      /* Applied on the way out rather than as the box is ticked: this is the
         device-wide preference the header toggle also writes, so a create that
         is cancelled or fails leaves whatever staff had before it alone. */
      setKeepScreenAwake(controlForm.keepScreenAwake !== false);
      setControlMessage("");
      setIsEventDetailsModalOpen(false);
    } catch (error) {
      showControlFailureAlert(error.message || "Unable to start the event.");
    } finally {
      setControlSaving(false);
    }
  };

  

  const handleSaveEventDetails = async (event) => {
    event.preventDefault();
    const timeframeError = validateTimeframe();
    const memberCheckInLeadMinutesError = validateMemberCheckInLeadMinutes();

    if (timeframeError) {
      setControlMessage(timeframeError);
      return;
    }

    if (memberCheckInLeadMinutesError) {
      setControlMessage(memberCheckInLeadMinutesError);
      return;
    }

    setControlSaving(true);

    try {
      await updateLiveEventDetails({
        ...buildEventScheduleTimestamps(controlForm, liveEvent.startedAt),
        stateChanges: buildEventStateChangesFromForm(),
        timeframeEnd: controlForm.timeframeEnd,
        timeframeLabel: formatTimeRange(
          controlForm.timeframeStart,
          controlForm.timeframeEnd,
        ),
        timeframeStart: controlForm.timeframeStart,
      });
      setControlMessage("");
      setIsEventDetailsModalOpen(false);
    } catch (error) {
      showControlFailureAlert(error.message || "Unable to save event details.");
    } finally {
      setControlSaving(false);
    }
  };

  const handleCloseEvent = async () => {
    setControlSaving(true);
    // Captured before the close wipes it, so the sign-off can name the event.
    const closingEventTitle = liveState.title;

    try {
      await closeLiveEvent({ state: initialState });
      setControlMessage("");
      setStaffEndedEventTitle(closingEventTitle);
      /*
       * Ending an event signs everyone out, staff included.
       *
       * Attendees lose their session because the event they checked into is
       * over; staff lose theirs for the same reason it matters that they did —
       * the panel is a live-event tool, and a browser left open on a finished
       * event should not still be holding a staff login. Starting the next
       * event means logging in again.
       *
       * The send-off card below is local state, so it survives the sign-out and
       * is still what staff see; dismissing it drops them on the closed-event
       * page rather than back in the panel.
       */
      resetClaimFlow();
      handleLogout();
      changeMode(null, { replace: true });
    } catch (error) {
      showControlFailureAlert(error.message || "Unable to close the event.");
    } finally {
      setControlSaving(false);
    }
  };

  if (!isHydrated) {
    return <LoadingScreen />;
  }

  if (mode === "display") {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <DisplayPage
          displayFeedItems={displayFeedItems}
          nextQrCountdownSeconds={nextQrCountdownSeconds}
          qrRotationProgress={qrRotationProgress}
          hasRosterAccess={shouldSubscribeToRosterData}
          isEventLive={isEventLive}
          liveEvent={liveEvent}
          liveState={liveState}
          onDismissStaffLoginMessage={() => setStaffLoginMessage("")}
          raffleEligibleClaims={raffleWheelSegments}
          raffleWinnerClaim={raffleWinnerClaim}
          rotatingClaimAccessUrl={rotatingClaimAccessUrl}
          staffLoginMessage={staffLoginMessage}
        />
      </Suspense>
    );
  }

  if (shouldRedirectToControl) {
    return <LoadingScreen />;
  }

  if (mode === "control") {
    if (isCheckingAccess || shouldRedirectFromControl) {
      // Either access is still resolving, or the effect above is on its way to
      // "/" — both render as loading rather than flashing a refusal card.
      return <LoadingScreen />;
    }

    if (!hasTrustedStaffAccess) {
      return (
        <>
          <AppHeader />
          <ControlAccessDenied
            authError={authError}
            handleLogout={handleLogout}
            hasFullAccess={hasFullAccess}
            isCheckingAccess={isCheckingAccess}
            onDismissAuthError={dismissAuthError}
          />
        </>
      );
    }

    /*
     * Looked up from the live roster each render rather than captured on open,
     * so the preview tracks the attendee it is showing: their number being
     * called flips the card to "You're up!" in staff's hands at the same moment
     * it does in theirs, and an attendee removed while it is open drops staff
     * back to the list instead of leaving a stale, still-scannable code.
     */
    const previewClaim = previewClaimId
      ? currentEventClaims.find((claim) => claim.claimId === previewClaimId)
      : null;
    /*
     * Their prize code, on exactly the terms their own phone gets it: from the
     * revealed winner list, so a spin still turning does not print the result
     * here first, and kept for the rest of the event because the prize may be
     * handed over long after the wheel stopped.
     *
     * Staff open this ticket precisely when the attendee cannot show their own
     * screen, which is when a prize code is hardest to come by — the raffle
     * panel's winner list opens it for that reason.
     */
    const previewRaffleQrPayload =
      previewClaim?.claimId &&
      previewClaim.eventId &&
      previewClaim.qrToken &&
      revealedRaffleWinnerNumbers.includes(previewClaim.number)
        ? buildRaffleQrPayload({
            claimId: previewClaim.claimId,
            eventId: previewClaim.eventId,
            qrToken: previewClaim.qrToken,
          })
        : "";

    if (previewClaim) {
      return (
        <>
          <AppHeader />
          <AttendeeTicketPage
            claim={previewClaim}
            currentRound={currentRound}
            currentTime={currentTime}
            eventStartTimeMs={eventStartTime ? eventStartTime.getTime() : null}
            isEventStarted={isEventStarted}
            liveCallLabel={liveCallLabel}
            liveState={liveState}
            onBack={closeAttendeeTicketPreview}
            onOpenBookList={openBookList}
            raffleQrPayload={previewRaffleQrPayload}
          />
        </>
      );
    }

    return (
      <>
        {/* Live: the panel portals its own row of actions into the slot. Idle:
            there is no row, and the corner carries Logout — the same place the
            attendee ticket keeps it, and where the staff landing's navbar
            button used to be. */}
        <AppHeader
          actionsSlotRef={isEventLive ? setControlHeaderActionsNode : undefined}
          onLogout={isEventLive ? undefined : handleLogout}
        />
        {/* No Suspense boundary: ControlPage is imported eagerly and on purpose
            — see the note at its import — so there is nothing here to suspend.
            DisplayPage, which is lazy, keeps its own boundary above. */}
        <ControlPage
          headerActionsNode={controlHeaderActionsNode}
          activeQueueClaims={activeQueueClaims}
          activeQueueElapsedLabel={activeQueueElapsedLabel}
          roundElapsedLabel={roundElapsedLabel}
          autoAdvanceBacklogClearedPercent={autoAdvanceBacklogClearedPercent}
          autoAdvanceBacklogLimitEnabled={Boolean(liveState.autoAdvanceBacklogLimitEnabled)}
          autoAdvanceEnabled={Boolean(liveState.autoAdvanceEnabled)}
          autoAdvanceFinalCallTimerEnabled={Boolean(liveState.autoAdvanceFinalCallTimerEnabled)}
          autoAdvanceFinalCallTimerMinutes={autoAdvanceFinalCallTimerMinutes}
          autoAdvanceGroupTimerEnabled={Boolean(liveState.autoAdvanceGroupTimerEnabled)}
          autoAdvanceGroupTimerMinutes={autoAdvanceGroupTimerMinutes}
          autoAdvanceNextGroup={Boolean(liveState.autoAdvanceNextGroup)}
          autoAdvanceStartRound={Boolean(liveState.autoAdvanceStartRound)}
          autoAdvanceStartRoundMinutes={autoAdvanceStartRoundMinutes}
          groupSize={groupSize}
          backtrackStep={backtrackStep}
          backlogClaims={backlogClaims}
          calledSoFarCount={calledSoFarClaims.length}
          controlForm={controlForm}
          controlMessage={controlMessage}
          controlSaving={controlSaving}
          currentTime={currentTime}
          demoStatus={demoStatus}
          isDemoEvent={Boolean(liveEvent.isDemo)}
          isDemoPaused={isDemoPaused}
          onToggleDemoPaused={toggleDemoPaused}
          currentEventClaims={currentEventClaims}
          currentRound={currentRound}
          autoAdvanceThresholdPercent={autoAdvanceThresholdPercent}
          hasPersonalClaim={Boolean(effectiveClaimResult)}
          isEventDetailsModalOpen={isEventDetailsModalOpen}
          isEventLive={isEventLive}
          isEventStarted={isEventStarted}
          isLastGroup={isLastGroup}
          eventStartTimeMs={eventStartTime ? eventStartTime.getTime() : null}
          liveEvent={liveEvent}
          liveState={liveState}
          onActivateFinalCall={activateFinalCall}
          onBacktrack={backtrack}
          onAutoAdvanceActionChange={updateAutoAdvanceAction}
          onCloseEvent={handleCloseEvent}
          onCloseEventDetails={closeEventDetailsModal}
          onDismissControlMessage={() => setControlMessage("")}
          onCloseScanner={() => setScannerActive(false)}
          onFieldChange={handleControlFieldChange}
          onIncrement={increment}
          onNewRound={newRound}
          isKeepScreenAwakeEnabled={isKeepScreenAwakeEnabled}
          isKeepScreenAwakeSupported={isKeepScreenAwakeSupported()}
          onToggleKeepScreenAwake={toggleKeepScreenAwake}
          onOpenDisplayScreen={openDisplayScreen}
          onOpenEventDetails={() => setIsEventDetailsModalOpen(true)}
          onOpenScanner={() => {
            setScanFeedback(null);
            setScannerActive(true);
          }}
          onOpenSelfClaim={openStaffSelfClaim}
          onPreviewAttendeeTicket={openAttendeeTicketPreview}
          onClearRaffleWinner={clearRaffleWinner}
          onCloseRaffle={closeRaffle}
          onOpenRaffle={openRaffle}
          onRaffleOptionChange={updateRaffleOption}
          onResetRaffleWinners={resetRaffleWinners}
          onSpinRaffle={spinRaffle}
          raffleEligibleClaims={raffleDrawClaims}
          raffleWinnerEntries={raffleWinnerClaims}
          onFetchLatestAnnouncement={handleFetchLatestAnnouncement}
          staffName={username || user}
          onDeleteArchivedEvent={handleDeleteArchivedEvent}
          onReadArchivedEvent={handleReadArchivedEvent}
          onReadArchivedEvents={handleReadArchivedEvents}
          onAutoAdvanceBacklogClearedPercentChange={updateAutoAdvanceBacklogClearedPercent}
          onGroupSizeChange={updateGroupSize}
          onAutoAdvanceGroupTimerMinutesChange={updateAutoAdvanceGroupTimerMinutes}
          onAutoAdvanceStartRoundMinutesChange={updateAutoAdvanceStartRoundMinutes}
          onAutoAdvanceTimerMinutesChange={updateAutoAdvanceTimerMinutes}
          onAutoAdvanceThresholdChange={updateAutoAdvanceThresholdPercent}
          onSaveEventDetails={handleSaveEventDetails}
          onStartEvent={handleStartEvent}
          onToggleAutoAdvance={toggleAutoAdvanceEnabled}
          queueDescription={queueDescription}
          queueTitle={queueTitle}
          scanFeedback={scanFeedback}
          scanLoading={scanLoading}
          scannerActive={scannerActive}
          scannerVideoRef={scannerVideoRef}
          totalPeopleWithNumbers={totalPeopleWithNumbers}
          preclaims={claimPreclaims}
          onAssignPreclaimAsStaff={handleAssignPreclaimAsStaff}
          onRefreshAllPreclaimMembershipsAsStaff={handleRefreshAllPreclaimMembershipsAsStaff}
          onRemovePreclaimAsStaff={handleRemovePreclaimAsStaff}
          onRemoveClaim={handleRemoveClaim}
          onMoveClaimBackToQueueAsStaff={handleMoveClaimBackToQueueAsStaff}
          showPreclaimQueue={showPreclaimQueue}
        />
      </>
    );
  }

  if (staffEndedEventTitle) {
    return (
      <>
        <AppHeader />
        <EventWrappedPage
          eventTitle={staffEndedEventTitle}
          onDismiss={() => {
            setStaffEndedEventTitle("");
            // The live -> ended transition also armed the attendee "thanks for
            // coming" card. Staff have already had their sign-off, so drop them
            // on the neutral "no event is live" page instead.
            setEndedEventTitle("");
          }}
        />
      </>
    );
  }

  /*
   * Access is resolved asynchronously, and until it is there is nothing
   * truthful to draw: the closed-event card and the claim gate are both
   * answers to "who are you", and showing either before that is known is what
   * produced the flash of Staff Login on the way to /control.
   *
   * The check no longer requires `loggedIn`, because the worst window is the
   * one before the session has been restored, when it is still false.
   */
  if (isCheckingAccess || isStaffHandoffPending) {
    return <LoadingScreen />;
  }

  // If event is not live, and user is not up or has already claimed, show closed event page
  if (
    !isEventLive &&
    (!effectiveClaimResult || hasClaimedCurrentRound || !showClaimQr) &&
    !hasManualStaffClaimAccess
  ) {
    /* Read twice below — once by the card, once by the header, which hides the
       staff login on it — so it is named rather than repeated. */
    const closedEventTitle = mode === null ? endedEventTitle : "";

    return (
      <>
        {/* Not on the "thanks for coming" card: that one is the end of an
            attendee's evening, and the staff who just closed the event have had
            their own send-off already. */}
        <AppHeader
          isStaffLoginPending={isStaffLoginPending}
          onStaffLogin={closedEventTitle ? undefined : handleStaffLogin}
        />
        <ClosedEventPage
          endedEventTitle={closedEventTitle}
          onDismissStaffLoginMessage={() => setStaffLoginMessage("")}
          staffLoginMessage={staffLoginMessage}
        />
      </>
    );
  }

  if (!claimAccessGranted && !effectiveClaimResult && !hasManualStaffClaimAccess) {
    return (
      <>
        <AppHeader
          isStaffLoginPending={isStaffLoginPending}
          onStaffLogin={handleStaffLogin}
        />
        <ClaimAccessGatePage
          claimAccessStatus={claimAccessStatus}
          liveEvent={liveEvent}
          liveState={liveState}
          onDismissStaffLoginMessage={() => setStaffLoginMessage("")}
          staffLoginMessage={staffLoginMessage}
        />
      </>
    );
  }

  return (
    <>
      {/* The attendee's only way out of a session: their page has no navbar,
          and the card below is the ticket itself. Hidden until there is
          something to leave — before that it would just be a dead control on
          the sign-in card. */}
      <AppHeader onLogout={loggedIn || effectiveClaimResult ? handleLogout : undefined} />
      <ClaimPage
      allowManualClaim={hasManualStaffClaimAccess && !claimAccessGranted}
      authError={authError}
      claimError={claimError}
      claimLoading={claimLoading}
      claimQrPayload={claimQrPayload}
      claimRecord={claimRecord}
      claimResult={effectiveClaimResult}
      currentTime={currentTime}
      currentRound={currentRound}
      eventStartLabel={eventStartLabel}
      eventStartTimeMs={eventStartTime ? eventStartTime.getTime() : null}
      hasClaimedCurrentRound={hasClaimedCurrentRound}
      isClaimRulesOpen={isClaimRulesOpen}
      isCheckingAccess={isCheckingAccess}
      isClaimWindowOpen={isClaimWindowOpen}
      isEventStarted={isEventStarted}
      isMember={isMember}
      liveCallLabel={liveCallLabel}
      liveEvent={liveEvent}
      liveState={liveState}
      loggedIn={loggedIn}
      memberEarlyAccessLabel={memberEarlyAccessLabel}
      memberEarlyAccessTime={memberEarlyAccessTime}
      onAcknowledgeRules={acknowledgeClaimRules}
      onManualClaim={hasManualStaffClaimAccess ? handleStaffManualClaim : assignDiscordNumber}
      onRetryClaim={retryClaimNow}
      canRetryClaim={isClaimRetryExhausted}
      onOpenClaimRules={openClaimRules}
      onOpenControlPanel={() => changeMode("control")}
      onOpenDisplayScreen={openDisplayScreen}
      onLogout={handleLogout}
      onOpenBookList={openBookList}
      onDismissAuthError={dismissAuthError}
      onDismissClaimError={() => setClaimError("")}
      onDismissRaffleJoinError={() => setRaffleJoinError("")}
      onStartOAuthGrant={() => startOAuthGrant()}
      raffleQrPayload={raffleQrPayload}
      raffleWinSignal={raffleWinSignal}
      isRafflePrizeCollected={isRafflePrizeCollected}
      canJoinRaffle={canJoinRaffle}
      hasJoinedRaffle={hasJoinedRaffle}
      onJoinRaffle={handleJoinRaffle}
      raffleJoinError={raffleJoinError}
      raffleJoinLoading={raffleJoinLoading}
      canStaffSelfRedeem={hasTrustedStaffAccess && showClaimQr}
      onStaffSelfRedeem={handleStaffSelfRedeem}
      onDismissStaffSelfRedeemError={() => setStaffSelfRedeemError("")}
      staffSelfRedeemError={staffSelfRedeemError}
      staffSelfRedeemLoading={staffSelfRedeemLoading}
      /* One flag, not two: showControlNavbar is already "this is staff", and
         ClaimPage had no second reading of it once the dead attendee scanner
         branch went. */
      showControlNavbar={hasTrustedStaffAccess}
      showClaimQr={showClaimQr}
      setScannerActive={setScannerActive}
      setScanFeedback={setScanFeedback}
      changeMode={changeMode}
      claimPreclaim={claimPreclaim}
      />
    </>
  );
}

export default App;
