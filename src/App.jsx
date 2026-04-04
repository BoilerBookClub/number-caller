import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import sound from "/sound.mp3";
import "./App.css";
import ClaimPage from "./components/ClaimPage";
import {
  ClaimAccessGatePage,
  ClosedEventPage,
} from "./components/EntryPages";
import {
  buildClaimAccessCode,
  CLAIM_ACCESS_GRANT_MS,
  CLAIM_ACCESS_ROTATION_MS,
  createClaimAccessSecret,
  isValidClaimAccessCode,
} from "./claimAccess";
  import { enqueuePreclaim } from "./firebase";
import { buildClaimQrPayload, parseClaimQrPayload } from "./claimQr";
import {
  claimEventNumber,
  closeLiveEvent,
  buildClaimId,
  createLiveEvent,
  firebaseEnabled,
  getModeFromUrl,
  getScreenUrl,
  pushLiveState,
  redeemClaimByQr,
  subscribeToClaim,
  subscribeToClaims,
  subscribeToDisplayFeed,
  subscribeToLiveEvent,
  updateLiveEventDetails,
  assignPreclaimIfQueued,
  readPreclaimOnce,
  updatePreclaimMembership,
  signInWithDiscordAccessToken,
} from "./firebase";
import { DEFAULT_TITLE_FONT, normalizeTitleFont } from "./titleFonts";
import useDiscordLogin from "./useDiscordLogin";

const ControlPage = lazy(() => import("./components/ControlPage"));
const DisplayPage = lazy(() => import("./components/DisplayPage"));

const defaultQrUrl =
  "https://www.boilerbookclub.com/announcements/";
const DEFAULT_GROUP_SIZE = 10;

const initialState = {
  title: "BOILER BOOK CLUB EVENT",
  titleFont: DEFAULT_TITLE_FONT,
  qrUrl: defaultQrUrl,
  autoAdvanceEnabled: false,
  autoAdvanceBacklogLimitEnabled: false,
  autoAdvanceBacklogLimit: 10,
  autoAdvanceFinalCall: false,
  autoAdvanceFinalCallTimerEnabled: false,
  autoAdvanceFinalCallTimerMinutes: 5,
  autoAdvanceNextGroup: true,
  autoAdvanceStartRound: false,
  autoAdvanceThresholdPercent: 80,
  groupSize: DEFAULT_GROUP_SIZE,
  memberCheckInLeadMinutes: 15,
  current: 0,
  groupStartedAt: null,
  last: 0,
  round: 1,
  finalCall: false,
  finalCallTargetClaimIds: [],
};

const initialControlForm = {
  title: "",
  titleFont: initialState.titleFont,
  qrUrl: initialState.qrUrl,
  memberCheckInLeadMinutes: String(initialState.memberCheckInLeadMinutes),
  timeframeStart: "19:00",
  timeframeEnd: "21:00",
};

const normalizeMemberCheckInLeadMinutes = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return initialState.memberCheckInLeadMinutes;
  }

  return parsedValue;
};

const normalizeAutoAdvanceThresholdPercent = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 100) {
    return initialState.autoAdvanceThresholdPercent;
  }

  return parsedValue;
};

const normalizeAutoAdvanceTimerMinutes = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 240) {
    return initialState.autoAdvanceFinalCallTimerMinutes;
  }

  return parsedValue;
};

const normalizeAutoAdvanceBacklogLimit = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 500) {
    return initialState.autoAdvanceBacklogLimit;
  }

  return parsedValue;
};

const normalizeGroupSize = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 500) {
    return initialState.groupSize;
  }

  return parsedValue;
};

const normalizeNonNegativeInteger = (value, fallbackValue) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallbackValue;
  }

  return parsedValue;
};

const normalizeState = (nextState) => {
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
  const normalizedBacklogLimit = normalizeAutoAdvanceBacklogLimit(
    mergedState.autoAdvanceBacklogLimit,
  );
  const normalizedGroupSize = normalizeGroupSize(mergedState.groupSize);

  return {
    ...mergedState,
    autoAdvanceEnabled:
      typeof mergedState.autoAdvanceEnabled === "boolean"
        ? mergedState.autoAdvanceEnabled
        : normalizedThreshold > 0,
    autoAdvanceFinalCall:
      typeof mergedState.autoAdvanceFinalCall === "boolean"
        ? mergedState.autoAdvanceFinalCall
        : initialState.autoAdvanceFinalCall,
    autoAdvanceBacklogLimitEnabled:
      typeof mergedState.autoAdvanceBacklogLimitEnabled === "boolean"
        ? mergedState.autoAdvanceBacklogLimitEnabled
        : initialState.autoAdvanceBacklogLimitEnabled,
    autoAdvanceBacklogLimit: normalizedBacklogLimit,
    autoAdvanceFinalCallTimerEnabled:
      typeof mergedState.autoAdvanceFinalCallTimerEnabled === "boolean"
        ? mergedState.autoAdvanceFinalCallTimerEnabled
        : initialState.autoAdvanceFinalCallTimerEnabled,
    autoAdvanceFinalCallTimerMinutes: normalizedTimerMinutes,
    autoAdvanceNextGroup:
      typeof mergedState.autoAdvanceNextGroup === "boolean"
        ? mergedState.autoAdvanceNextGroup
        : initialState.autoAdvanceNextGroup,
    autoAdvanceStartRound:
      typeof mergedState.autoAdvanceStartRound === "boolean"
        ? mergedState.autoAdvanceStartRound
        : initialState.autoAdvanceStartRound,
    autoAdvanceThresholdPercent: normalizedThreshold,
      groupSize: normalizedGroupSize,
    current: normalizeNonNegativeInteger(mergedState.current, initialState.current),
    last: normalizeNonNegativeInteger(mergedState.last, initialState.last),
    round: normalizeNonNegativeInteger(mergedState.round, initialState.round),
  };
};

const normalizeLiveEvent = (nextEvent) => ({
  active: false,
  claimCount: 0,
  claimAccessSecret: "",
  eventId: null,
  nextClaimNumber: 1,
  timeframeEnd: "",
  timeframeLabel: "",
  timeframeStart: "",
  ...nextEvent,
  state: normalizeState(nextEvent?.state),
});

const getTimestampMs = (value) => {
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

const normalizeClaimRecord = (claimId, nextClaim) => {
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

const buildClaimResultFromRecord = (claimRecord) => {
  if (!claimRecord) {
    return null;
  }

  return {
    claimId: claimRecord.claimId,
    existing: true,
    isMember: claimRecord.isMember ?? false,
    itemsClaimedCount: normalizeNonNegativeInteger(claimRecord.itemsClaimedCount, 0),
    number: normalizeNonNegativeInteger(claimRecord.number, 0),
    qrToken: claimRecord.qrToken ?? "",
    redeemedRound: normalizeNonNegativeInteger(claimRecord.redeemedRound, 0),
  };
};

const normalizeRosterClaim = (nextClaim) => {
  const storedDisplayName = nextClaim.displayName?.trim() ?? "";
  const resolvedDisplayName =
    !storedDisplayName
      ? nextClaim.discordUserId || "Unknown attendee"
      : storedDisplayName;

  return {
    claimId: nextClaim.claimId,
    avatarUrl: nextClaim.avatarUrl ?? "",
    claimedAtMs: getTimestampMs(nextClaim.claimedAt),
    displayName: resolvedDisplayName,
    eventId: nextClaim.eventId ?? null,
    isMember: nextClaim.isMember ?? false,
    itemClaimedAtMsHistory: getTimestampMsList(nextClaim.itemClaimedAtMsHistory),
    itemsClaimedCount: normalizeNonNegativeInteger(nextClaim.itemsClaimedCount, 0),
    number: normalizeNonNegativeInteger(nextClaim.number, 0),
    participantType: nextClaim.participantType ?? "discord",
    redeemedAtMs: getTimestampMs(nextClaim.redeemedAt),
    redeemedRound: normalizeNonNegativeInteger(nextClaim.redeemedRound, 0),
  };
};

const formatClockTime = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(`2000-01-01T${value}`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatElapsedDuration = (elapsedMs) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatTimeRange = (start, end) => {
  if (!start || !end) {
    return "";
  }

  return `${formatClockTime(start)} - ${formatClockTime(end)}`;
};

const getTimeParts = (value) => {
  if (!value) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return { hours, minutes };
};

const setDateToTime = (date, value) => {
  const timeParts = getTimeParts(value);

  if (!timeParts) {
    return null;
  }

  const nextDate = new Date(date);

  nextDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
  return nextDate;
};

const getEventSchedule = ({ memberCheckInLeadMinutes, now, startedAt, timeframeEnd, timeframeStart }) => {
  const referenceTimestamp = getTimestampMs(startedAt) ?? now;

  if (!referenceTimestamp) {
    return {
      eventEndTime: null,
      eventStartTime: null,
      memberEarlyAccessTime: null,
    };
  }

  const referenceDate = new Date(referenceTimestamp);
  let eventStartTime = setDateToTime(referenceDate, timeframeStart);
  let eventEndTime = setDateToTime(referenceDate, timeframeEnd);

  if (!eventStartTime || !eventEndTime) {
    return {
      eventEndTime,
      eventStartTime,
      memberEarlyAccessTime: eventStartTime
        ? new Date(eventStartTime.getTime() - memberCheckInLeadMinutes * 60 * 1000)
        : null,
    };
  }

  if (eventEndTime <= eventStartTime) {
    eventEndTime.setDate(eventEndTime.getDate() + 1);
  }

  if (referenceTimestamp > eventEndTime.getTime()) {
    eventStartTime.setDate(eventStartTime.getDate() + 1);
    eventEndTime.setDate(eventEndTime.getDate() + 1);
  }

  return {
    eventEndTime,
    eventStartTime,
    memberEarlyAccessTime: new Date(
      eventStartTime.getTime() - memberCheckInLeadMinutes * 60 * 1000,
    ),
  };
};

const buildEventId = () =>
  globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}`;

const CLAIM_ACCESS_GRANT_KEY = "number-caller-claim-access-grant";
const CONFIRMED_CLAIM_ACCESS_KEY = "number-caller-confirmed-claim-access";
const PERSISTED_CLAIM_SESSION_KEY = "number-caller-persisted-claim-session";

const readClaimAccessGrant = () => {
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

const writeClaimAccessGrant = (grant) => {
  window.sessionStorage.setItem(CLAIM_ACCESS_GRANT_KEY, JSON.stringify(grant));
};

const clearClaimAccessGrant = () => {
  window.sessionStorage.removeItem(CLAIM_ACCESS_GRANT_KEY);
};

const readConfirmedClaimAccess = () => {
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

const writeConfirmedClaimAccess = (confirmedAccess) => {
  window.localStorage.setItem(
    CONFIRMED_CLAIM_ACCESS_KEY,
    JSON.stringify(confirmedAccess),
  );
};

const clearConfirmedClaimAccess = () => {
  window.localStorage.removeItem(CONFIRMED_CLAIM_ACCESS_KEY);
};

const readPersistedClaimSession = () => {
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

const writePersistedClaimSession = (claimSession) => {
  window.localStorage.setItem(
    PERSISTED_CLAIM_SESSION_KEY,
    JSON.stringify(claimSession),
  );
};

const clearPersistedClaimSession = () => {
  window.localStorage.removeItem(PERSISTED_CLAIM_SESSION_KEY);
};

const buildClaimNotificationsEnabledKey = (eventId, claimId) =>
  `claimNotificationsEnabled:${eventId}:${claimId}`;

const buildClaimRulesAcknowledgedKey = (eventId, claimId) =>
  `claimRulesAcknowledged:${eventId}:${claimId}`;

const buildClaimLastNotifiedRoundKey = (eventId, claimId) =>
  `claimLastNotifiedRound:${eventId}:${claimId}`;

const readStoredBoolean = (key) => window.localStorage.getItem(key) === "true";

const getBrowserNotificationPermission = () => {
  if (!("Notification" in window) || !window.isSecureContext) {
    return "unsupported";
  }

  return window.Notification.permission;
};

const sendBrowserNotification = async ({ body, registration, tag, title }) => {
  if (!("Notification" in window) || !window.isSecureContext) {
    return false;
  }

  const notificationOptions = {
    body,
    data: {
      url: window.location.href,
    },
    tag,
  };

  if (registration?.showNotification) {
    try {
      await registration.showNotification(title, notificationOptions);
      return true;
    } catch {
      // Fall back to the window notification API if the worker is not ready yet.
    }
  }

  try {
    const notification = new window.Notification(title, notificationOptions);

    notification.onclick = () => {
      window.focus();
    };

    return true;
  } catch {
    return false;
  }
};

const getClaimAccessCodeFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("claim")?.trim() ?? "";
};

const buildClaimAccessUrl = (accessCode) => {
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

function App() {
  const [mode, setMode] = useState(() => getModeFromUrl());
  const [liveEvent, setLiveEvent] = useState(() => normalizeLiveEvent(null));
  const [endedEventTitle, setEndedEventTitle] = useState("");
  const [isHydrated, setIsHydrated] = useState(!firebaseEnabled);
  const [controlForm, setControlForm] = useState(initialControlForm);
  const [controlMessage, setControlMessage] = useState("");
  const [controlSaving, setControlSaving] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [claimRecord, setClaimRecord] = useState(null);
  const [claimRoster, setClaimRoster] = useState([]);
  const [claimError, setClaimError] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [membershipRefreshPrompt, setMembershipRefreshPrompt] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [isEventDetailsModalOpen, setIsEventDetailsModalOpen] = useState(false);
  const [isClaimRulesOpen, setIsClaimRulesOpen] = useState(false);
  const [areClaimNotificationsEnabled, setAreClaimNotificationsEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    getBrowserNotificationPermission(),
  );
  const [claimAccessGranted, setClaimAccessGranted] = useState(false);
  const [claimAccessStatus, setClaimAccessStatus] = useState("");
  const [isStaffSelfClaimMode, setIsStaffSelfClaimMode] = useState(false);
  const [displayFeedItems, setDisplayFeedItems] = useState([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const autoAdvanceQueueKeyRef = useRef("");
  const confettiModuleRef = useRef(null);
  const previousCurrentRef = useRef(initialState.current);
  const previousEventIdRef = useRef(null);
  const qrScannerModuleRef = useRef(null);
  const scannerRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scanHandlerRef = useRef(null);
  const notificationRegistrationRef = useRef(null);
  const {
    accessResolved,
    authError,
    avatarUrl,
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

  const dingSound = useRef(new Audio(sound));
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
  const { eventEndTime, eventStartTime, memberEarlyAccessTime } = getEventSchedule({
    memberCheckInLeadMinutes,
    now: currentTime,
    startedAt: liveEvent.startedAt,
    timeframeEnd: liveEvent.timeframeEnd,
    timeframeStart: liveEvent.timeframeStart,
  });
  const hasEventTimeEnded = Boolean(eventEndTime) && currentTime >= eventEndTime.getTime();
  const isAttendeeEventLive = isEventLive && !hasEventTimeEnded;
  const isEventStarted = !eventStartTime || currentTime >= eventStartTime.getTime();
  const isClaimWindowOpen =
    !eventStartTime ||
    currentTime >= eventStartTime.getTime() ||
    (isMember && memberEarlyAccessTime && currentTime >= memberEarlyAccessTime.getTime());
  const liveCallLabel =
    liveState.current === 0 ? "Starting Soon" : `${liveState.last + 1}-${liveState.current}`;
  const eventStartLabel = liveEvent.timeframeStart
    ? formatClockTime(liveEvent.timeframeStart)
    : "the event start";
  const memberEarlyAccessLabel = memberEarlyAccessTime
    ? formatClockTime(memberEarlyAccessTime.toTimeString().slice(0, 5))
    : eventStartLabel;
  const rotatingClaimAccessCode = buildClaimAccessCode(
    liveEvent.claimAccessSecret,
    currentTime,
  );
  const claimAccessCode = getClaimAccessCodeFromUrl();
  const rotatingClaimAccessUrl = rotatingClaimAccessCode
    ? buildClaimAccessUrl(rotatingClaimAccessCode)
    : "";
  const qrRotationElapsedMs = currentTime % CLAIM_ACCESS_ROTATION_MS;
  const qrRotationRemainingMs = CLAIM_ACCESS_ROTATION_MS - qrRotationElapsedMs;
  const qrRotationProgress = qrRotationElapsedMs / CLAIM_ACCESS_ROTATION_MS;
  const nextQrCountdownSeconds = Math.ceil(qrRotationRemainingMs / 1000);
  const attendeeClaimKey = loggedIn && hasTrustedAttendeeAccess && user ? `discord:${user}` : "";
  const persistedClaimSession = readPersistedClaimSession();
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
  const claimNotificationsEnabledKey =
    liveEvent.eventId && attendeeClaimId
      ? buildClaimNotificationsEnabledKey(liveEvent.eventId, attendeeClaimId)
      : "";
  const claimLastNotifiedRoundKey =
    liveEvent.eventId && attendeeClaimId
      ? buildClaimLastNotifiedRoundKey(liveEvent.eventId, attendeeClaimId)
      : "";
  const effectiveClaimResult = claimResult ?? buildClaimResultFromRecord(claimRecord);
  const attendeeClaimNumber = claimRecord?.number ?? claimResult?.number ?? null;
  const hasClaimedCurrentRound = claimRecord?.redeemedRound === currentRound;
  const hasReachedClaimNumber =
    typeof claimRecord?.number === "number" && liveState.current >= claimRecord.number;
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
  const currentEventClaims = claimRoster
    .filter((claim) => claim.eventId === liveEvent.eventId)
    .sort((leftClaim, rightClaim) => leftClaim.number - rightClaim.number);
  const totalPeopleWithNumbers = currentEventClaims.length;
  const currentGroupClaims = currentEventClaims.filter(
    (claim) => claim.number > liveState.last && claim.number <= liveState.current,
  );
  const finalCallTargetClaims = (liveState.finalCallTargetClaimIds ?? [])
    .map((claimId) =>
      currentEventClaims.find((claim) => claim.claimId === claimId) ?? null,
    )
    .filter(Boolean);
  const finalCallTargetClaimIdSet = new Set(liveState.finalCallTargetClaimIds ?? []);
  const backlogClaims = currentEventClaims.filter((claim) => {
    if (claim.redeemedRound === currentRound) {
      return false;
    }

    if (liveState.finalCall) {
      return finalCallTargetClaimIdSet.has(claim.claimId);
    }

    return liveState.current > 0 && claim.number <= liveState.last;
  });
  const activeQueueElapsedLabel =
    liveState.groupStartedAt && (liveState.finalCall || liveState.current > 0)
      ? formatElapsedDuration(Math.max(0, currentTime - liveState.groupStartedAt))
      : "";
  const activeQueueClaims = liveState.finalCall ? finalCallTargetClaims : currentGroupClaims;
  const backlogCount = backlogClaims.length;
  const finalCallTargetClaimIdsKey = (liveState.finalCallTargetClaimIds ?? []).join(",");
  const activeQueueClaimedCount = activeQueueClaims.filter(
    (claim) => claim.redeemedRound === currentRound,
  ).length;
  const isLastGroup =
    !liveState.finalCall && liveState.current > 0 && liveState.current >= totalPeopleWithNumbers;
  const autoAdvanceThresholdPercent = normalizeAutoAdvanceThresholdPercent(
    liveState.autoAdvanceThresholdPercent,
  );
  const autoAdvanceThresholdRatio = autoAdvanceThresholdPercent / 100;
  const autoAdvanceBacklogLimit = normalizeAutoAdvanceBacklogLimit(
    liveState.autoAdvanceBacklogLimit,
  );
  const autoAdvanceFinalCallTimerMinutes = normalizeAutoAdvanceTimerMinutes(
    liveState.autoAdvanceFinalCallTimerMinutes,
  );
  const groupSize = normalizeGroupSize(liveState.groupSize);
  const autoAdvanceFinalCallTimerMs = autoAdvanceFinalCallTimerMinutes * 60 * 1000;
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
    !effectiveClaimResult;
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

  useEffect(() => {
    if (mode !== "control" || isCheckingAccess || hasTrustedStaffAccess) {
      return;
    }

    changeMode(null, { replace: true });
  }, [changeMode, hasTrustedStaffAccess, isCheckingAccess, mode]);

  const openDisplayScreen = () => {
    window.open(displayUrl, "_blank", "noopener,noreferrer");
  };

  const openBookList = () => {
    window.open(qrCodeValue, "_blank", "noopener,noreferrer");
  };

  const handleLogout = useCallback(() => {
    clearClaimAccessGrant();
    clearConfirmedClaimAccess();
    clearPersistedClaimSession();
    setIsStaffSelfClaimMode(false);
    logout();
  }, [logout]);

  const openStaffSelfClaim = useCallback(() => {
    setIsStaffSelfClaimMode(true);
    changeMode(null);
  }, [changeMode]);

  const resetClaimFlow = () => {
    setAreClaimNotificationsEnabled(false);
    setClaimResult(null);
    setClaimRecord(null);
    setClaimError("");
    setClaimLoading(false);
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

  const toggleClaimNotifications = async () => {
    if (!("Notification" in window) || !window.isSecureContext) {
      setNotificationPermission("unsupported");
      return;
    }

    if (areClaimNotificationsEnabled) {
      if (claimNotificationsEnabledKey) {
        window.localStorage.removeItem(claimNotificationsEnabledKey);
      }

      setAreClaimNotificationsEnabled(false);
      setNotificationPermission(window.Notification.permission);
      return;
    }

    let permission = window.Notification.permission;

    if (permission === "default") {
      permission = await window.Notification.requestPermission();
    }

    setNotificationPermission(permission);

    if (permission !== "granted") {
      return;
    }

    if (claimNotificationsEnabledKey) {
      window.localStorage.setItem(claimNotificationsEnabledKey, "true");
    }

    setAreClaimNotificationsEnabled(true);
    window.alert("Notifications are on. You will get an alert when your number is called.");
  };

  const closeEventDetailsModal = () => {
    if (!isEventLive) {
      return;
    }

    setIsEventDetailsModalOpen(false);
  };

  useEffect(() => {
    const handlePopState = () => {
      setMode(getModeFromUrl());
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      notificationRegistrationRef.current = null;
      return undefined;
    }

    let isDisposed = false;

    const registerNotificationWorker = async () => {
      try {
        await navigator.serviceWorker.register("/notification-sw.js");
        const registration = await navigator.serviceWorker.ready;

        if (!isDisposed) {
          notificationRegistrationRef.current = registration;
        }
      } catch (error) {
        if (!isDisposed) {
          notificationRegistrationRef.current = null;
          console.error(error.message || "Unable to register notification service worker.");
        }
      }
    };

    void registerNotificationWorker();

    return () => {
      isDisposed = true;
    };
  }, []);

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

  useEffect(() => {
    if (!shouldRedirectToControl) {
      return;
    }

    changeMode("control", { replace: true });
  }, [changeMode, shouldRedirectToControl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!shouldLockBackgroundScroll) {
      return undefined;
    }

    const { body, documentElement } = document;
    const lockedScrollY = window.scrollY;

    documentElement.classList.add("modal-scroll-locked");
    body.classList.add("modal-scroll-locked");
    body.style.top = `-${lockedScrollY}px`;

    return () => {
      documentElement.classList.remove("modal-scroll-locked");
      body.classList.remove("modal-scroll-locked");
      body.style.top = "";
      window.scrollTo(0, lockedScrollY);
    };
  }, [shouldLockBackgroundScroll]);

  useEffect(() => {
    const previousCurrent = previousCurrentRef.current;

    if (current > previousCurrent && !isFinalCall && shouldCelebrateCurrentCall) {
      const celebrateCurrentCall = async () => {
        if (!confettiModuleRef.current) {
          const confettiModule = await import("canvas-confetti");
          confettiModuleRef.current = confettiModule.default;
        }

        confettiModuleRef.current({
          particleCount: 80,
          spread: 200,
          origin: { y: 0.6 },
        });
      };

      void celebrateCurrentCall();

      if (dingSound.current) {
        dingSound.current.currentTime = 0;
        dingSound.current.play().catch(() => {});
      }
    }

    previousCurrentRef.current = current;
  }, [current, isFinalCall, shouldCelebrateCurrentCall]);

  useEffect(() => {
    if (!isEventLive) {
      setControlForm(initialControlForm);
      return;
    }

    setControlForm({
      qrUrl: liveState.qrUrl,
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
    resetClaimFlow();
  }, [liveEvent.eventId]);

  useEffect(() => {
    if (!isEventLive) {
      setDisplayFeedItems([]);
      return undefined;
    }

    return subscribeToDisplayFeed({
      onFeed: (nextFeedItems) => {
        setDisplayFeedItems(nextFeedItems);
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync display feed.");
      },
    });
  }, [isEventLive]);

  useEffect(() => {
    if (!effectiveClaimResult || !claimRulesAcknowledgedKey) {
      setIsClaimRulesOpen(false);
      return;
    }

    setIsClaimRulesOpen(!readStoredBoolean(claimRulesAcknowledgedKey));
  }, [claimRulesAcknowledgedKey, effectiveClaimResult]);

  useEffect(() => {
    if (!effectiveClaimResult || !claimNotificationsEnabledKey) {
      setAreClaimNotificationsEnabled(false);
      return;
    }

    setAreClaimNotificationsEnabled(readStoredBoolean(claimNotificationsEnabledKey));
  }, [claimNotificationsEnabledKey, effectiveClaimResult]);

  useEffect(() => {
    setNotificationPermission(getBrowserNotificationPermission());
  }, []);

  useEffect(() => {
    const refreshNotificationPermission = () => {
      setNotificationPermission(getBrowserNotificationPermission());
    };

    window.addEventListener("focus", refreshNotificationPermission);
    document.addEventListener("visibilitychange", refreshNotificationPermission);

    return () => {
      window.removeEventListener("focus", refreshNotificationPermission);
      document.removeEventListener("visibilitychange", refreshNotificationPermission);
    };
  }, []);

  useEffect(() => {
    if (
      !showClaimQr ||
      !effectiveClaimResult ||
      !areClaimNotificationsEnabled ||
      notificationPermission !== "granted" ||
      !claimLastNotifiedRoundKey
    ) {
      return;
    }

    const lastNotifiedRound = Number.parseInt(
      window.localStorage.getItem(claimLastNotifiedRoundKey) ?? "0",
      10,
    );

    if (lastNotifiedRound === currentRound) {
      return;
    }

    let isDisposed = false;

    const notifyForRound = async () => {
      const didSend = await sendBrowserNotification({
        body: `Number ${effectiveClaimResult.number} is up in round ${currentRound}. Come grab an item and show your QR code to staff.`,
        registration: notificationRegistrationRef.current,
        tag: `${effectiveClaimResult.claimId}-round-${currentRound}`,
        title: `${liveState.title}: It's your turn`,
      });

      if (isDisposed) {
        return;
      }

      if (didSend) {
        window.localStorage.setItem(claimLastNotifiedRoundKey, String(currentRound));
        return;
      }

      setNotificationPermission(getBrowserNotificationPermission());
    };

    void notifyForRound();

    return () => {
      isDisposed = true;
    };
  }, [
    areClaimNotificationsEnabled,
    claimLastNotifiedRoundKey,
    currentRound,
    effectiveClaimResult,
    liveState.title,
    notificationPermission,
    showClaimQr,
  ]);

  useEffect(() => {
    if (isAttendeeEventLive) {
      previousLiveEventTitleRef.current = liveState.title?.trim() || initialState.title;
    }

    const wasEventLive = previousIsEventLiveRef.current;

    if (isAttendeeEventLive) {
      setEndedEventTitle("");
    } else if (wasEventLive) {
      setEndedEventTitle(previousLiveEventTitleRef.current);
    }

    previousIsEventLiveRef.current = isAttendeeEventLive;
  }, [isAttendeeEventLive, liveState.title]);

  useEffect(() => {
    if (!attendeeClaimId || !hasTrustedAttendeeAccess) {
      setClaimRecord(null);
      return undefined;
    }

    return subscribeToClaim({
      claimId: attendeeClaimId,
      onClaim: (nextClaim) => {
        const nextClaimRecord = normalizeClaimRecord(attendeeClaimId, nextClaim);

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
    if (!loggedIn || !user) {
      clearPersistedClaimSession();
      return;
    }

    if (!claimRecord?.claimId || !claimRecord.eventId) {
      return;
    }

    writePersistedClaimSession({
      claimId: claimRecord.claimId,
      eventId: claimRecord.eventId,
      userId: user,
    });
  }, [claimRecord, loggedIn, user]);

  useEffect(() => {
    if (!liveEvent.eventId) {
      clearPersistedClaimSession();
      return;
    }

    if (persistedClaimEventId && persistedClaimEventId !== liveEvent.eventId) {
      clearPersistedClaimSession();
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

    // If the user has claim access but the claim window isn't open yet,
    // enqueue them into the pre-claim queue so they'll be assigned automatically
    // when the event opens.
    (async () => {
      try {
        if (
          loggedIn &&
          claimAccessGranted &&
          liveEvent.eventId &&
          !isClaimWindowOpen &&
          user &&
          !attendeeClaimId
        ) {
          await enqueuePreclaim({
            claimKey: `discord:${user}`,
            avatarUrl,
            discordUserId: user,
            displayName: username || user,
            eventId: liveEvent.eventId,
            isMember,
            memberEligibleAt: memberEarlyAccessTime ? memberEarlyAccessTime.getTime() : null,
            participantType: "discord",
          });
        }
      } catch (e) {
        // Non-fatal: continue without blocking the UI
        // eslint-disable-next-line no-console
        console.warn("enqueuePreclaim failed:", e?.message || e);
      }
    })();
  }, [
    claimAccessGranted,
    liveEvent.eventId,
    loggedIn,
    user,
    isClaimWindowOpen,
    attendeeClaimId,
    avatarUrl,
    username,
    isMember,
  ]);

  

  

  const assignDiscordNumber = useCallback(async () => {
    if (
      claimLoading ||
      !loggedIn ||
      !hasTrustedAttendeeAccess ||
      !liveEvent.eventId ||
      !user
    ) {
      return;
    }

    setClaimLoading(true);

    try {
      const params = {
        claimKey: `discord:${user}`,
        avatarUrl,
        discordUserId: user,
        displayName: username || user,
        eventId: liveEvent.eventId,
        isMember,
        participantType: "discord",
      };

      // Debug: log intent and params
      // eslint-disable-next-line no-console
      console.debug("assignDiscordNumber: calling claimEventNumber", params);

      const result = await claimEventNumber(params);

      // eslint-disable-next-line no-console
      console.debug("assignDiscordNumber: success", result);

      setClaimResult(result);
      setClaimError("");
      setIsStaffSelfClaimMode(false);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("assignDiscordNumber: failed", error && (error.message || error));
      setClaimError(error.message || "Unable to assign a number right now.");
    } finally {
      setClaimLoading(false);
    }
  }, [
    avatarUrl,
    claimLoading,
    hasTrustedAttendeeAccess,
    isMember,
    liveEvent.eventId,
    loggedIn,
    user,
    username,
  ]);

  const handleStaffManualClaim = useCallback(async () => {
    if (!liveEvent.eventId || !loggedIn || !user) return;
    const proceed = window.confirm("Give yourself a number now? This will assign you a number immediately.");

    if (!proceed) return;

    setClaimLoading(true);

    try {
      const params = {
        claimKey: `discord:${user}`,
        avatarUrl: avatarUrl ?? "",
        discordUserId: user,
        displayName: username || user,
        eventId: liveEvent.eventId,
        isMember: isMember ?? false,
        participantType: "discord",
      };

      // eslint-disable-next-line no-console
      console.debug("handleStaffManualClaim: calling claimEventNumber", params);

      const result = await claimEventNumber(params);

      // eslint-disable-next-line no-console
      console.debug("handleStaffManualClaim: claimEventNumber result", result);

      setClaimResult(result);
      setClaimError("");
      setControlMessage("Assigned number.");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("handleStaffManualClaim: assign failed", e && (e.message || e));
      setControlMessage(e?.message || "Unable to assign number.");
    } finally {
      setClaimLoading(false);
      setIsStaffSelfClaimMode(false);
    }
  }, [liveEvent.eventId, loggedIn, user, isMember, memberEarlyAccessTime, avatarUrl, username]);

  const refreshMembershipAndUpdatePreclaim = useCallback(async () => {
    if (!loggedIn || !user || !liveEvent.eventId) {
      return;
    }

    // Try to reuse stored Discord access token if available
    const storedAccessToken = window.localStorage.getItem("accessToken");

    let profile = null;

    if (storedAccessToken) {
      try {
        profile = await signInWithDiscordAccessToken({ accessToken: storedAccessToken });
      } catch (e) {
        // If the stored token is invalid or expired, do NOT auto-redirect.
        // Instead, surface a re-auth prompt so the user can re-login explicitly.
        // eslint-disable-next-line no-console
        console.warn("refresh membership sign-in failed:", e?.message || e);
        setMembershipRefreshPrompt(true);
        return;
      }
    }

    try {
      const memberEligibleAt = profile.isMember && memberEarlyAccessTime
        ? memberEarlyAccessTime.getTime()
        : null;

      await updatePreclaimMembership({
        claimKey: `discord:${user}`,
        eventId: liveEvent.eventId,
        isMember: profile.isMember,
        memberEligibleAt,
        displayName: profile.username || username || user,
        avatarUrl: profile.avatarUrl || avatarUrl,
      });

      // If claim window open, try to assign immediately
      if (isClaimWindowOpen) {
        void assignDiscordNumber();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Unable to update preclaim membership:", e?.message || e);
    }
  }, [
    loggedIn,
    user,
    liveEvent.eventId,
    memberEarlyAccessTime,
    startOAuthGrant,
    username,
    avatarUrl,
    isClaimWindowOpen,
    assignDiscordNumber,
  ]);

  useEffect(() => {
    if (!isAttendeeEventLive || !liveEvent.eventId || !liveEvent.claimAccessSecret) {
      setClaimAccessGranted(false);
      setClaimAccessStatus("");
      clearClaimAccessGrant();
      return;
    }

    const storedGrant = readClaimAccessGrant();
    const confirmedAccess = readConfirmedClaimAccess();
    const hasStoredGrant =
      storedGrant?.eventId === liveEvent.eventId && storedGrant?.expiresAt > currentTime;
    const hasConfirmedAccess =
      loggedIn &&
      confirmedAccess?.eventId === liveEvent.eventId &&
      confirmedAccess?.userId === user;
    const hasFreshCode = isValidClaimAccessCode(
      liveEvent.claimAccessSecret,
      claimAccessCode,
      currentTime,
    );

    if (hasFreshCode) {
      writeClaimAccessGrant({
        eventId: liveEvent.eventId,
        expiresAt: currentTime + CLAIM_ACCESS_GRANT_MS,
      });
      setClaimAccessGranted(true);
      setClaimAccessStatus("");
      return;
    }

    if (hasConfirmedAccess) {
      setClaimAccessGranted(true);
      setClaimAccessStatus("");
      return;
    }

    if (hasStoredGrant) {
      setClaimAccessGranted(true);
      setClaimAccessStatus("");
      return;
    }

    setClaimAccessGranted(false);
    setClaimAccessStatus(
      claimAccessCode
        ? "That attendee QR code expired. Scan the current event QR code to claim a number."
        : "Scan the in-person event QR code to claim a number.",
    );
  }, [
    claimAccessCode,
    currentTime,
    isAttendeeEventLive,
    liveEvent.claimAccessSecret,
    liveEvent.eventId,
    loggedIn,
    user,
  ]);

  useEffect(() => {
    if (!shouldSubscribeToRosterData) {
      setClaimRoster([]);
      return undefined;
    }

    return subscribeToClaims({
      onClaims: (nextClaims) => {
        const normalizedClaims = nextClaims.map((nextClaim) => normalizeRosterClaim(nextClaim));
        setClaimRoster(normalizedClaims);
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync attendee claims.");
      },
    });
  }, [shouldSubscribeToRosterData]);

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

    const timeoutId = window.setTimeout(() => {
      setScanFeedback(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scanFeedback]);

  useEffect(() => {
    scanHandlerRef.current = async (rawValue) => {
      if (!rawValue || scanLoading) {
        return;
      }

      const payload = parseClaimQrPayload(rawValue);

      if (!payload) {
        setScanFeedback({
          tone: "error",
          message: "That QR code is not a valid attendee claim code.",
        });
        return;
      }

      setScanLoading(true);

      try {
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
          message: error.message || "Unable to mark that attendee as claimed.",
        });
      } finally {
        setScanLoading(false);

        if (scannerActive && scannerRef.current) {
          scannerRef.current.start().catch((error) => {
            setScanFeedback({
              tone: "error",
              message: error.message || "Unable to restart the camera scanner.",
            });
            setScannerActive(false);
          });
        }
      }
    };
  }, [scanLoading, scannerActive]);

  useEffect(() => {
    if (!scannerActive || !scannerVideoRef.current || !hasTrustedStaffAccess || !isEventLive) {
      return undefined;
    }

    let isDisposed = false;
    let scanner = null;

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
            scanner.stop();
            void scanHandlerRef.current?.(
              typeof result === "string" ? result : result?.data ?? "",
            );
          },
          {
            highlightCodeOutline: true,
            highlightScanRegion: true,
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

  useEffect(() => {
    if (
      !isAttendeeEventLive ||
      !claimAccessGranted ||
      !loggedIn ||
      !hasTrustedAttendeeAccess ||
      isCheckingAccess ||
      !isClaimWindowOpen ||
      claimLoading ||
      effectiveClaimResult
    ) {
      return;
    }
    void assignDiscordNumber();
  }, [
    assignDiscordNumber,
    claimLoading,
    claimAccessGranted,
    effectiveClaimResult,
    isClaimWindowOpen,
    isCheckingAccess,
    isAttendeeEventLive,
    loggedIn,
    hasTrustedAttendeeAccess,
  ]);

  // Fallback: if the server-side preclaim processor didn't run for some reason,
  // detect a preclaim and attempt to assign the claim client-side when the
  // claim window opens.
  useEffect(() => {
    let cancelled = false;

    const tryAssignFromPreclaim = async () => {
      if (!loggedIn || !user || !liveEvent.eventId || claimRecord || claimLoading) {
        return;
      }

      const claimKey = `discord:${user}`;

      try {
        // Ask the server to process this user's preclaim if it exists.
        // eslint-disable-next-line no-console
        console.debug("tryAssignFromPreclaim: calling assignPreclaimIfQueued", { eventId: liveEvent.eventId, claimKey });

        const resp = await assignPreclaimIfQueued({
          eventId: liveEvent.eventId,
          claimKey,
        });

        // eslint-disable-next-line no-console
        console.debug("tryAssignFromPreclaim: response", resp);

        if (cancelled) return;

        if (resp?.assigned) {
          // Server created the claim; fetch/refresh client-side claim state.
          // eslint-disable-next-line no-console
          console.debug("tryAssignFromPreclaim: assigned true, calling assignDiscordNumber");
          await assignDiscordNumber();
        }
      } catch (e) {
        // If callable throws due to permission/other issues, log and continue.
        // eslint-disable-next-line no-console
        console.warn("preclaim-check failed:", e?.message || e);
      }
    };

    if (isClaimWindowOpen) {
      void tryAssignFromPreclaim();
    }

    return () => {
      cancelled = true;
    };
  }, [
    isClaimWindowOpen,
    loggedIn,
    user,
    liveEvent.eventId,
    claimRecord,
    claimLoading,
    assignDiscordNumber,
  ]);

  const persistState = useCallback(async (newState) => {
    const nextState = normalizeState(newState);
    setLiveEvent((currentEvent) => ({
      ...currentEvent,
      state: nextState,
    }));

    if (!firebaseEnabled || !isEventLive) {
      return;
    }

    try {
      await pushLiveState(nextState);
    } catch (error) {
      console.error(error.message || "Unable to sync live event state.");
      setControlMessage(error.message || "Unable to sync live event state.");
    }
  }, [isEventLive]);

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
      finalCallTargetClaimIds: [],
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
      finalCallTargetClaimIds: [],
      groupStartedAt,
      last: 0,
      round: nextRound ? liveState.round + 1 : liveState.round,
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

  const updateAutoAdvanceBacklogLimit = useCallback((value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceBacklogLimit: normalizeAutoAdvanceBacklogLimit(value),
    });
  }, [liveState, persistState]);

  const toggleAutoAdvanceEnabled = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      autoAdvanceEnabled: !liveState.autoAdvanceEnabled,
      autoAdvanceThresholdPercent:
        !liveState.autoAdvanceEnabled && normalizeAutoAdvanceThresholdPercent(liveState.autoAdvanceThresholdPercent) === 0
          ? 100
          : normalizeAutoAdvanceThresholdPercent(liveState.autoAdvanceThresholdPercent),
    });
  }, [liveState, persistState]);

  const updateAutoAdvanceAction = useCallback((field, value) => {
    setControlMessage("");
    persistState({
      ...liveState,
      [field]: value,
    });
  }, [liveState, persistState]);

  const newRound = useCallback(() => {
    setControlMessage("");
    persistState({
      ...liveState,
      current: 0,
      finalCall: false,
      finalCallTargetClaimIds: [],
      groupStartedAt: null,
      last: 0,
      round: liveState.round + 1,
    });
  }, [liveState, persistState]);

  const activateFinalCall = useCallback(() => {
    setControlMessage("");
    const groupStartedAt = Date.now();
    persistState({
      ...liveState,
      finalCall: true,
      finalCallTargetClaimIds: currentEventClaims
        .filter((claim) => claim.redeemedRound !== currentRound)
        .map((claim) => claim.claimId),
      groupStartedAt,
    });
  }, [currentEventClaims, currentRound, liveState, persistState]);

  useEffect(() => {
    if (!canManageEvent) {
      return;
    }

    const queueKey = isFinalCall
      ? `round:${currentRound}:final:${finalCallTargetClaimIdsKey}`
      : current === 0
        ? `round:${currentRound}:pending-start`
        : `round:${currentRound}:group:${last + 1}-${current}`;
    const isEmptyFinalCallQueue = isFinalCall && activeQueueClaims.length === 0;
    const finalCallElapsedMs =
      isFinalCall && liveState.groupStartedAt
        ? Math.max(0, currentTime - liveState.groupStartedAt)
        : 0;
    const shouldAdvanceFinalCallByTimer =
      isFinalCall &&
      liveState.autoAdvanceStartRound &&
      liveState.autoAdvanceFinalCallTimerEnabled &&
      autoAdvanceFinalCallTimerMs > 0 &&
      finalCallElapsedMs >= autoAdvanceFinalCallTimerMs;
    const isBacklogTooLarge =
      liveState.autoAdvanceBacklogLimitEnabled && backlogCount > autoAdvanceBacklogLimit;

    if (autoAdvanceQueueKeyRef.current !== queueKey) {
      autoAdvanceQueueKeyRef.current = "";
    }

    if (!liveState.autoAdvanceEnabled) {
      return;
    }

    if (isBacklogTooLarge) {
      return;
    }

    if (!isFinalCall && current === 0) {
      if (
        !liveState.autoAdvanceStartRound ||
        totalPeopleWithNumbers === 0 ||
        autoAdvanceQueueKeyRef.current === queueKey
      ) {
        return;
      }

      autoAdvanceQueueKeyRef.current = queueKey;
      startRoundQueue(false);
      return;
    }

    if (
      !shouldAdvanceFinalCallByTimer &&
      (autoAdvanceThresholdPercent <= 0 ||
        (!isEmptyFinalCallQueue && activeQueueClaims.length === 0))
    ) {
      return;
    }

    const claimedRatio = isEmptyFinalCallQueue
      ? 1
      : activeQueueClaimedCount / activeQueueClaims.length;

    const shouldAdvanceByThreshold = claimedRatio >= autoAdvanceThresholdRatio;

    if (!shouldAdvanceByThreshold && !shouldAdvanceFinalCallByTimer) {
      return;
    }

    if (autoAdvanceQueueKeyRef.current === queueKey) {
      return;
    }

    if (isFinalCall && !liveState.autoAdvanceStartRound) {
      return;
    }

    if (!isFinalCall && isLastGroup && !liveState.autoAdvanceFinalCall) {
      return;
    }

    if (!isFinalCall && !isLastGroup && !liveState.autoAdvanceNextGroup) {
      return;
    }

    autoAdvanceQueueKeyRef.current = queueKey;

    if (isFinalCall) {
      startRoundQueue(true);
      return;
    }

    if (isLastGroup) {
      activateFinalCall();
      return;
    }

    increment(groupSize);
  }, [
    activeQueueClaimedCount,
    activeQueueClaims.length,
    activateFinalCall,
    autoAdvanceBacklogLimit,
    autoAdvanceFinalCallTimerMs,
    autoAdvanceThresholdPercent,
    autoAdvanceThresholdRatio,
    backlogCount,
    currentRound,
    currentTime,
    canManageEvent,
    finalCallTargetClaimIdsKey,
    groupSize,
    increment,
    current,
    isFinalCall,
    isLastGroup,
    last,
    liveState.autoAdvanceEnabled,
    liveState.autoAdvanceBacklogLimitEnabled,
    liveState.autoAdvanceFinalCall,
    liveState.autoAdvanceFinalCallTimerEnabled,
    liveState.autoAdvanceNextGroup,
    liveState.groupStartedAt,
    liveState.autoAdvanceStartRound,
    startRoundQueue,
    totalPeopleWithNumbers,
  ]);

  const handleControlFieldChange = (field) => (event) => {
    setControlForm((currentForm) => ({
      ...currentForm,
      [field]: event.target.value,
    }));
  };

  const validateTimeframe = () => {
    if (!controlForm.timeframeStart || !controlForm.timeframeEnd) {
      return "Add both a start time and an end time.";
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

    return "";
  };

  const buildEventStateFromForm = (baseState = liveState) =>
    normalizeState({
      ...baseState,
      memberCheckInLeadMinutes: normalizeMemberCheckInLeadMinutes(
        controlForm.memberCheckInLeadMinutes,
      ),
      qrUrl: controlForm.qrUrl.trim() || defaultQrUrl,
      title: controlForm.title.trim() || initialState.title,
      titleFont: normalizeTitleFont(controlForm.titleFont),
    });

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

    try {
      await createLiveEvent({
        claimAccessSecret: createClaimAccessSecret(),
        eventId: buildEventId(),
        state: buildEventStateFromForm(initialState),
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
      setControlMessage(error.message || "Unable to start the event.");
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
        state: buildEventStateFromForm(),
        timeframeEnd: controlForm.timeframeEnd,
        timeframeLabel: formatTimeRange(
          controlForm.timeframeStart,
          controlForm.timeframeEnd,
        ),
        timeframeStart: controlForm.timeframeStart,
      });
      setControlMessage("Event details saved.");
      setIsEventDetailsModalOpen(false);
    } catch (error) {
      setControlMessage(error.message || "Unable to save event details.");
    } finally {
      setControlSaving(false);
    }
  };

  const handleCloseEvent = async () => {
    const shouldCloseEvent = window.confirm(
      "End this event? This will stop the live event for everyone.",
    );

    if (!shouldCloseEvent) {
      return;
    }

    setControlSaving(true);

    try {
      await closeLiveEvent({ state: initialState });
      setControlMessage("");
      handleLogout();
      changeMode(null, { replace: true });
    } catch (error) {
      setControlMessage(error.message || "Unable to close the event.");
    } finally {
      setControlSaving(false);
    }
  };

  if (!isHydrated) {
    return (
      <div className="mode-select">
        <h2>Connecting to live event…</h2>
      </div>
    );
  }

  if (mode === "display") {
    return (
      <Suspense fallback={<div className="mode-select"><h2>Loading display...</h2></div>}>
        <DisplayPage
          displayFeedItems={displayFeedItems}
          nextQrCountdownSeconds={nextQrCountdownSeconds}
          qrRotationProgress={qrRotationProgress}
          isEventLive={isEventLive}
          liveEvent={liveEvent}
          liveState={liveState}
          rotatingClaimAccessUrl={rotatingClaimAccessUrl}
        />
      </Suspense>
    );
  }

  if (shouldRedirectToControl) {
    return (
      <div className="mode-select">
        <h2>Opening control panel...</h2>
      </div>
    );
  }

  if (mode === "control") {
    if (isCheckingAccess) {
      return (
        <div className="mode-select">
          <h2>Checking Discord access...</h2>
        </div>
      );
    }

    if (!hasTrustedStaffAccess) {
      return (
        <div className="mode-select">
          <h2>Returning to main page...</h2>
        </div>
      );
    }

    return (
      <Suspense fallback={<div className="mode-select"><h2>Loading control panel...</h2></div>}>
        <ControlPage
          activeQueueClaims={activeQueueClaims}
          activeQueueElapsedLabel={activeQueueElapsedLabel}
          autoAdvanceBacklogLimit={autoAdvanceBacklogLimit}
          autoAdvanceBacklogLimitEnabled={Boolean(liveState.autoAdvanceBacklogLimitEnabled)}
          autoAdvanceEnabled={Boolean(liveState.autoAdvanceEnabled)}
          autoAdvanceFinalCall={Boolean(liveState.autoAdvanceFinalCall)}
          autoAdvanceFinalCallTimerEnabled={Boolean(liveState.autoAdvanceFinalCallTimerEnabled)}
          autoAdvanceFinalCallTimerMinutes={autoAdvanceFinalCallTimerMinutes}
          autoAdvanceNextGroup={Boolean(liveState.autoAdvanceNextGroup)}
          autoAdvanceStartRound={Boolean(liveState.autoAdvanceStartRound)}
          groupSize={groupSize}
          backlogClaims={backlogClaims}
          controlForm={controlForm}
          controlMessage={controlMessage}
          controlSaving={controlSaving}
          currentEventClaims={currentEventClaims}
          currentRound={currentRound}
          autoAdvanceThresholdPercent={autoAdvanceThresholdPercent}
          hasPersonalClaim={Boolean(effectiveClaimResult)}
          isEventDetailsModalOpen={isEventDetailsModalOpen}
          isEventLive={isEventLive}
          isLastGroup={isLastGroup}
          liveEvent={liveEvent}
          liveState={liveState}
          onActivateFinalCall={activateFinalCall}
          onAutoAdvanceActionChange={updateAutoAdvanceAction}
          onCloseEvent={handleCloseEvent}
          onCloseEventDetails={closeEventDetailsModal}
          onCloseScanner={() => setScannerActive(false)}
          onFieldChange={handleControlFieldChange}
          onHandleLogout={handleLogout}
          onIncrement={increment}
          onNewRound={newRound}
          onOpenDisplayScreen={openDisplayScreen}
          onOpenEventDetails={() => setIsEventDetailsModalOpen(true)}
          onOpenScanner={() => {
            setScanFeedback(null);
            setScannerActive(true);
          }}
          onOpenSelfClaim={openStaffSelfClaim}
          onAutoAdvanceBacklogLimitChange={updateAutoAdvanceBacklogLimit}
          onGroupSizeChange={updateGroupSize}
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
        />
      </Suspense>
    );
  }

  // If event is not live, and user is not up or has already claimed, show closed event page
  if (
    !isAttendeeEventLive &&
    (!effectiveClaimResult || hasClaimedCurrentRound || !showClaimQr) &&
    !hasManualStaffClaimAccess
  ) {
    return (
      <ClosedEventPage
        authError={authError}
        endedEventTitle={mode === null ? endedEventTitle : ""}
        handleLogout={handleLogout}
        hasFullAccess={hasFullAccess}
        isCheckingAccess={isCheckingAccess}
        loggedIn={loggedIn}
        onOpenControl={() => changeMode("control")}
        onStartOAuthGrant={() => startOAuthGrant("/control")}
      />
    );
  }

  if (!claimAccessGranted && !effectiveClaimResult && !hasManualStaffClaimAccess) {
    return (
      <ClaimAccessGatePage
        authError={authError}
        claimAccessStatus={claimAccessStatus}
        handleLogout={handleLogout}
        hasFullAccess={hasFullAccess}
        isCheckingAccess={isCheckingAccess}
        liveEvent={liveEvent}
        liveState={liveState}
        loggedIn={loggedIn}
        onOpenControl={() => changeMode("control")}
        onStartOAuthGrant={() => startOAuthGrant()}
      />
    );
  }

  return (
    <ClaimPage
      allowManualClaim={hasManualStaffClaimAccess && !claimAccessGranted}
      authError={authError}
      areClaimNotificationsEnabled={areClaimNotificationsEnabled}
      claimError={claimError}
      claimLoading={claimLoading}
      claimQrPayload={claimQrPayload}
      claimRecord={claimRecord}
      claimResult={effectiveClaimResult}
      currentRound={currentRound}
      eventStartLabel={eventStartLabel}
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
      notificationPermission={notificationPermission}
      onAcknowledgeRules={acknowledgeClaimRules}
      onManualClaim={hasManualStaffClaimAccess ? handleStaffManualClaim : assignDiscordNumber}
      onOpenClaimRules={openClaimRules}
      onOpenClaimScanner={() => {
        setScanFeedback(null);
        setScannerActive(true);
      }}
      onOpenControlPanel={() => changeMode("control")}
      onOpenDisplayScreen={openDisplayScreen}
      membershipRefreshPrompt={membershipRefreshPrompt}
      onLogout={handleLogout}
      onOpenBookList={openBookList}
      onStartOAuthGrant={() => startOAuthGrant()}
      onToggleClaimNotifications={toggleClaimNotifications}
      showControlNavbar={hasTrustedStaffAccess}
      showClaimQr={showClaimQr}
      onRefreshMembership={refreshMembershipAndUpdatePreclaim}
      hasTrustedStaffAccess={hasTrustedStaffAccess}
      setScannerActive={setScannerActive}
      setScanFeedback={setScanFeedback}
      changeMode={changeMode}
    />
  );
}

export default App;
