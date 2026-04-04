import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import QrScanner from "qr-scanner";
import sound from "/sound.mp3";
import "./App.css";
import ClaimPage from "./components/ClaimPage";
import ControlPage from "./components/ControlPage";
import DisplayPage from "./components/DisplayPage";
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
import { buildClaimQrPayload, parseClaimQrPayload } from "./claimQr";
import {
  claimEventNumber,
  closeLiveEvent,
  buildClaimId,
  createLiveEvent,
  firebaseEnabled,
  getModeFromUrl,
  readClaimOnce,
  readLiveEventOnce,
  getScreenUrl,
  pushLiveState,
  redeemClaimByQr,
  subscribeToClaim,
  subscribeToClaims,
  subscribeToLiveEvent,
  subscribeToUsers,
  updateLiveEventDetails,
} from "./firebase";
import { DEFAULT_TITLE_FONT, normalizeTitleFont } from "./titleFonts";
import useDiscordLogin from "./useDiscordLogin";

const defaultQrUrl =
  "https://www.boilerbookclub.com/announcements/";
const QUEUE_SIZE = 10;

const initialState = {
  title: "BOILER BOOK CLUB EVENT",
  titleFont: DEFAULT_TITLE_FONT,
  qrUrl: defaultQrUrl,
  autoAdvanceEnabled: false,
  autoAdvanceBacklogLimitEnabled: false,
  autoAdvanceBacklogLimit: 10,
  autoAdvanceFinalCall: true,
  autoAdvanceFinalCallTimerEnabled: false,
  autoAdvanceFinalCallTimerMinutes: 5,
  autoAdvanceNextGroup: true,
  autoAdvanceStartRound: true,
  autoAdvanceThresholdPercent: 80,
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

const looksLikeDiscordId = (value) => /^\d{16,20}$/.test(value ?? "");

const normalizeRosterClaim = (nextClaim, userProfilesByUserId) => {
  const profile = nextClaim.discordUserId
    ? userProfilesByUserId[nextClaim.discordUserId]
    : null;
  const profileUsername = profile?.username ?? "";
  const storedDisplayName = nextClaim.displayName?.trim() ?? "";
  const resolvedDisplayName =
    !storedDisplayName || looksLikeDiscordId(storedDisplayName)
      ? profileUsername || nextClaim.discordUserId || "Unknown attendee"
      : storedDisplayName;

  return {
    claimId: nextClaim.claimId,
    avatarUrl: profile?.avatarUrl ?? "",
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

const getTodayTime = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date();
  const [hours, minutes] = value.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  date.setHours(hours, minutes, 0, 0);
  return date;
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

const DISPLAY_FEED_ITEM_LIFETIME_MS = 100_000;

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
  const [userProfilesByUserId, setUserProfilesByUserId] = useState({});
  const [claimError, setClaimError] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [scanFeedback, setScanFeedback] = useState(null);
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
  const [displayFeedItems, setDisplayFeedItems] = useState([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const autoAdvanceQueueKeyRef = useRef("");
  const previousCurrentRef = useRef(initialState.current);
  const previousEventIdRef = useRef(null);
  const previousClaimFeedSnapshotRef = useRef(null);
  const scannerRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scanHandlerRef = useRef(null);
  const notificationRegistrationRef = useRef(null);
  const displayFeedTimeoutsRef = useRef(new Map());
  const {
    accessResolved,
    authError,
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
  const isCheckingAccess = authLoading || roleLoading || (loggedIn && !accessResolved);
  const isEventLive = liveEvent.active;
  const qrCodeValue = liveState.qrUrl.trim() || defaultQrUrl;
  const currentRound = liveState.round;
  const eventStartTime = getTodayTime(liveEvent.timeframeStart);
  const eventEndTime = getTodayTime(liveEvent.timeframeEnd);
  const memberCheckInLeadMinutes = normalizeMemberCheckInLeadMinutes(
    liveState.memberCheckInLeadMinutes,
  );
  const memberEarlyAccessTime = eventStartTime
    ? new Date(eventStartTime.getTime() - memberCheckInLeadMinutes * 60 * 1000)
    : null;
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
  const attendeeClaimKey = loggedIn && user ? `discord:${user}` : "";
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
  const isAttendeeClaimRoute =
    mode === null &&
    typeof attendeeClaimNumber === "number" &&
    attendeeClaimNumber > liveState.last &&
    attendeeClaimNumber <= liveState.current;
  const shouldCelebrateCurrentCall = isDisplayRoute || isAttendeeClaimRoute;
  const shouldRedirectToControl =
    loggedIn && hasFullAccess && !isCheckingAccess && mode === null && !claimAccessCode;
  const shouldLockBackgroundScroll =
    (mode === null && Boolean(claimResult) && isClaimRulesOpen) ||
    (mode === "control" && isEventLive && isEventDetailsModalOpen);

  const pushDisplayFeedItem = useCallback((item) => {
    const feedItemId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const nextFeedItem = {
      id: feedItemId,
      ...item,
    };

    setDisplayFeedItems((currentItems) => [nextFeedItem, ...currentItems].slice(0, 5));

    const timeoutId = window.setTimeout(() => {
      setDisplayFeedItems((currentItems) =>
        currentItems.filter((currentItem) => currentItem.id !== feedItemId),
      );
      displayFeedTimeoutsRef.current.delete(feedItemId);
    }, DISPLAY_FEED_ITEM_LIFETIME_MS);

    displayFeedTimeoutsRef.current.set(feedItemId, timeoutId);
  }, []);

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
    if (mode !== "control" || isCheckingAccess || hasFullAccess) {
      return;
    }

    changeMode(null, { replace: true });
  }, [changeMode, hasFullAccess, isCheckingAccess, mode]);

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
    logout();
  }, [logout]);

  const resetClaimFlow = () => {
    setAreClaimNotificationsEnabled(false);
    setClaimResult(null);
    setClaimRecord(null);
    setClaimError("");
    setClaimLoading(false);
    setIsClaimRulesOpen(false);
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
    if (!firebaseEnabled) {
      return undefined;
    }

    let isDisposed = false;

    const syncLiveEvent = async () => {
      try {
        const nextEvent = await readLiveEventOnce();

        if (isDisposed) {
          return;
        }

        setLiveEvent(normalizeLiveEvent(nextEvent));
        setIsHydrated(true);
      } catch (error) {
        if (!isDisposed) {
          setIsHydrated(true);
          console.error(error.message || "Unable to refresh live event state.");
        }
      }
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        void syncLiveEvent();
      }
    };

    const handlePageShow = () => {
      void syncLiveEvent();
    };

    void syncLiveEvent();

    const intervalId = window.setInterval(() => {
      void syncLiveEvent();
    }, 5_000);

    window.addEventListener("focus", handleVisibilityRefresh);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityRefresh);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
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

  useEffect(() => () => {
    displayFeedTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    displayFeedTimeoutsRef.current.clear();
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
      confetti({
        particleCount: 80,
        spread: 200,
        origin: { y: 0.6 },
      });

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
    previousClaimFeedSnapshotRef.current = null;
    displayFeedTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    displayFeedTimeoutsRef.current.clear();
    setDisplayFeedItems([]);
    resetClaimFlow();
  }, [liveEvent.eventId]);

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
    if (!attendeeClaimId) {
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
  }, [attendeeClaimId]);

  useEffect(() => {
    if (!attendeeClaimId) {
      return undefined;
    }

    let isDisposed = false;

    const syncClaimRecord = async () => {
      try {
        const nextClaim = await readClaimOnce({ claimId: attendeeClaimId });

        if (isDisposed) {
          return;
        }

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
      } catch (error) {
        if (!isDisposed) {
          console.error(error.message || "Unable to refresh claim status.");
        }
      }
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        void syncClaimRecord();
      }
    };

    const handlePageShow = () => {
      void syncClaimRecord();
    };

    void syncClaimRecord();

    const intervalId = window.setInterval(() => {
      void syncClaimRecord();
    }, 3_000);

    window.addEventListener("focus", handleVisibilityRefresh);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityRefresh);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
  }, [attendeeClaimId]);

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
  }, [claimAccessGranted, liveEvent.eventId, loggedIn, user]);

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
    if (!isEventLive) {
      setClaimRoster([]);
      previousClaimFeedSnapshotRef.current = null;
      return undefined;
    }

    return subscribeToClaims({
      onClaims: (nextClaims) => {
        const normalizedClaims = nextClaims.map((nextClaim) =>
          normalizeRosterClaim(nextClaim, userProfilesByUserId),
        );
        const nextClaimSnapshot = new Map(
          normalizedClaims.map((nextClaim) => [
            nextClaim.claimId,
            {
              avatarUrl: nextClaim.avatarUrl,
              displayName: nextClaim.displayName,
              itemsClaimedCount: nextClaim.itemsClaimedCount ?? 0,
              redeemedRound: nextClaim.redeemedRound ?? 0,
            },
          ]),
        );
        const previousClaimSnapshot = previousClaimFeedSnapshotRef.current;

        if (previousClaimSnapshot) {
          nextClaimSnapshot.forEach((nextClaim, claimId) => {
            const previousClaim = previousClaimSnapshot.get(claimId);

            if (!previousClaim) {
              pushDisplayFeedItem({
                action: "joined",
                avatarUrl: nextClaim.avatarUrl,
                username: nextClaim.displayName,
              });
              return;
            }

            if (
              nextClaim.itemsClaimedCount > previousClaim.itemsClaimedCount ||
              nextClaim.redeemedRound > previousClaim.redeemedRound
            ) {
              pushDisplayFeedItem({
                action: "claimed an item",
                avatarUrl: nextClaim.avatarUrl,
                username: nextClaim.displayName,
              });
            }
          });
        }

        previousClaimFeedSnapshotRef.current = nextClaimSnapshot;
        setClaimRoster(normalizedClaims);
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync attendee claims.");
      },
    });
  }, [isEventLive, pushDisplayFeedItem, userProfilesByUserId]);

  useEffect(() => {
    if (!isEventLive) {
      setUserProfilesByUserId({});
      return undefined;
    }

    return subscribeToUsers({
      onUsers: (nextUsers) => {
        setUserProfilesByUserId(
          nextUsers.reduce((accumulator, nextUser) => {
            accumulator[nextUser.userId] = {
              avatarUrl: nextUser.avatarUrl || "",
              username: nextUser.username || nextUser.userId,
            };
            return accumulator;
          }, {}),
        );
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync Discord user profiles.");
      },
    });
  }, [isEventLive]);

  useEffect(() => {
    if (mode === "control" && isEventLive && hasFullAccess) {
      return;
    }

    setScannerActive(false);
  }, [hasFullAccess, isEventLive, mode]);

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
            ? `Number ${result.number} already claimed an item in round ${result.round}.`
            : `Marked number ${result.number} as claimed for round ${result.round}.`,
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
    if (!scannerActive || !scannerVideoRef.current || !hasFullAccess || !isEventLive) {
      return undefined;
    }

    const scanner = new QrScanner(
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

    scanner.start().catch((error) => {
      setScanFeedback({
        tone: "error",
        message: error.message || "Unable to start the camera scanner.",
      });
      setScannerActive(false);
    });

    return () => {
      scanner.destroy();

      if (scannerRef.current === scanner) {
        scannerRef.current = null;
      }
    };
  }, [hasFullAccess, isEventLive, scannerActive]);

  useEffect(() => {
    if (
      !isAttendeeEventLive ||
      !claimAccessGranted ||
      !loggedIn ||
      isCheckingAccess ||
      !isClaimWindowOpen ||
      claimLoading ||
      effectiveClaimResult
    ) {
      return;
    }

    const assignDiscordNumber = async () => {
      setClaimLoading(true);

      try {
        const result = await claimEventNumber({
          claimKey: `discord:${user}`,
          discordUserId: user,
          displayName: username || user,
          eventId: liveEvent.eventId,
          isMember,
          participantType: "discord",
        });

        setClaimResult(result);
        setClaimError("");
      } catch (error) {
        setClaimError(error.message || "Unable to assign a number right now.");
      } finally {
        setClaimLoading(false);
      }
    };

    void assignDiscordNumber();
  }, [
    claimLoading,
    claimAccessGranted,
    effectiveClaimResult,
    isClaimWindowOpen,
    isCheckingAccess,
    isAttendeeEventLive,
    isMember,
    liveEvent.eventId,
    loggedIn,
    user,
    username,
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
      current: QUEUE_SIZE,
      finalCall: false,
      finalCallTargetClaimIds: [],
      groupStartedAt,
      last: 0,
      round: nextRound ? liveState.round + 1 : liveState.round,
    });
  }, [liveState, persistState, totalPeopleWithNumbers]);

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

    increment(QUEUE_SIZE);
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
    finalCallTargetClaimIdsKey,
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

    if (controlForm.timeframeEnd <= controlForm.timeframeStart) {
      return "The end time must be after the start time.";
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

  const buildEventStateFromForm = () =>
    normalizeState({
      ...liveState,
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
        state: buildEventStateFromForm(),
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
      <DisplayPage
        displayFeedItems={displayFeedItems}
        nextQrCountdownSeconds={nextQrCountdownSeconds}
        qrRotationProgress={qrRotationProgress}
        isEventLive={isEventLive}
        liveEvent={liveEvent}
        liveState={liveState}
        rotatingClaimAccessUrl={rotatingClaimAccessUrl}
      />
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

    if (!hasFullAccess) {
      return (
        <div className="mode-select">
          <h2>Returning to main page...</h2>
        </div>
      );
    }

    return (
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
        backlogClaims={backlogClaims}
        controlForm={controlForm}
        controlMessage={controlMessage}
        controlSaving={controlSaving}
        currentEventClaims={currentEventClaims}
        currentRound={currentRound}
        autoAdvanceThresholdPercent={autoAdvanceThresholdPercent}
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
        onAutoAdvanceBacklogLimitChange={updateAutoAdvanceBacklogLimit}
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
    );
  }

  if (!isAttendeeEventLive) {
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

  if (!claimAccessGranted && !effectiveClaimResult) {
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
      onOpenClaimRules={openClaimRules}
      onLogout={handleLogout}
      onOpenBookList={openBookList}
      onStartOAuthGrant={() => startOAuthGrant()}
      onToggleClaimNotifications={toggleClaimNotifications}
      showClaimQr={showClaimQr}
    />
  );
}

export default App;
