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
  ControlAccessDenied,
} from "./components/EntryPages";
import {
  buildClaimAccessCode,
  CLAIM_ACCESS_GRANT_MS,
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
  getScreenUrl,
  pushLiveState,
  redeemClaimByQr,
  subscribeToClaim,
  subscribeToClaims,
  subscribeToLiveEvent,
  subscribeToUsers,
  updateLiveEventDetails,
} from "./firebase";
import useDiscordLogin from "./useDiscordLogin";

const defaultQrUrl =
  "https://www.boilerbookclub.com/announcements/";

const initialState = {
  title: "BOILER BOOK CLUB EVENT",
  qrUrl: defaultQrUrl,
  current: 0,
  last: 0,
  round: 1,
  finalCall: false,
  finalCallTargetClaimIds: [],
};

const initialControlForm = {
  title: initialState.title,
  qrUrl: initialState.qrUrl,
  timeframeStart: "19:00",
  timeframeEnd: "21:00",
};

const normalizeState = (nextState) => ({
  ...initialState,
  ...nextState,
});

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
    itemsClaimedCount: claimRecord.itemsClaimedCount ?? 0,
    number: claimRecord.number ?? 0,
    qrToken: claimRecord.qrToken ?? "",
    redeemedRound: claimRecord.redeemedRound ?? 0,
  };
};

const looksLikeDiscordId = (value) => /^\d{16,20}$/.test(value ?? "");

const normalizeRosterClaim = (nextClaim, usernamesByUserId) => {
  const profileUsername = nextClaim.discordUserId
    ? usernamesByUserId[nextClaim.discordUserId]
    : "";
  const storedDisplayName = nextClaim.displayName?.trim() ?? "";
  const resolvedDisplayName =
    !storedDisplayName || looksLikeDiscordId(storedDisplayName)
      ? profileUsername || nextClaim.discordUserId || "Unknown attendee"
      : storedDisplayName;

  return {
    claimId: nextClaim.claimId,
    displayName: resolvedDisplayName,
    eventId: nextClaim.eventId ?? null,
    isMember: nextClaim.isMember ?? false,
    itemsClaimedCount: nextClaim.itemsClaimedCount ?? 0,
    number: nextClaim.number ?? 0,
    participantType: nextClaim.participantType ?? "discord",
    redeemedRound: nextClaim.redeemedRound ?? 0,
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
  const [usernamesByUserId, setUsernamesByUserId] = useState({});
  const [claimError, setClaimError] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [isEventDetailsModalOpen, setIsEventDetailsModalOpen] = useState(false);
  const [claimAccessGranted, setClaimAccessGranted] = useState(false);
  const [claimAccessStatus, setClaimAccessStatus] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const previousCurrentRef = useRef(initialState.current);
  const previousEventIdRef = useRef(null);
  const scannerRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scanHandlerRef = useRef(null);
  const {
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
  const { current, finalCall: isFinalCall } = liveState;
  const displayUrl = getScreenUrl("display");
  const isCheckingAccess = authLoading || roleLoading;
  const isEventLive = liveEvent.active;
  const qrCodeValue = liveState.qrUrl.trim() || defaultQrUrl;
  const currentRound = liveState.round;
  const eventStartTime = getTodayTime(liveEvent.timeframeStart);
  const memberEarlyAccessTime = eventStartTime
    ? new Date(eventStartTime.getTime() - 30 * 60 * 1000)
    : null;
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
  const attendeeClaimKey = loggedIn && user ? `discord:${user}` : "";
  const attendeeClaimId =
    liveEvent.eventId && attendeeClaimKey
      ? buildClaimId(liveEvent.eventId, attendeeClaimKey)
      : claimResult?.claimId ?? "";
  const effectiveClaimResult = claimResult ?? buildClaimResultFromRecord(claimRecord);
  const hadAttendeeClaim = Boolean(effectiveClaimResult);
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
  const activeQueueClaims = liveState.finalCall ? finalCallTargetClaims : currentGroupClaims;
  const isLastGroup =
    !liveState.finalCall && liveState.current > 0 && liveState.current >= totalPeopleWithNumbers;
  const queueTitle = liveState.finalCall ? "Final Call" : "Current Group";
  const queueDescription = liveState.finalCall
    ? `Showing everyone who had not claimed an item before final call started for round ${currentRound}.`
    : liveState.current === 0
      ? "Call the first group to start item pickup."
      : `Tracking attendees in numbers ${liveState.last + 1}-${liveState.current}.`;
  const isDisplayRoute = mode === "display";
  const isAttendeeClaimRoute =
    mode === null &&
    typeof attendeeClaimNumber === "number" &&
    attendeeClaimNumber > liveState.last &&
    attendeeClaimNumber <= liveState.current;
  const shouldCelebrateCurrentCall = isDisplayRoute || isAttendeeClaimRoute;

  const changeMode = (nextMode, options = {}) => {
    const { replace = false } = options;

    setMode(nextMode);
    window.history[replace ? "replaceState" : "pushState"](
      {},
      document.title,
      getScreenUrl(nextMode),
    );
  };

  const openDisplayScreen = () => {
    window.open(displayUrl, "_blank", "noopener,noreferrer");
  };

  const openBookList = () => {
    window.open(qrCodeValue, "_blank", "noopener,noreferrer");
  };

  const handleLogout = useCallback(() => {
    clearClaimAccessGrant();
    clearConfirmedClaimAccess();
    logout();
  }, [logout]);

  const resetClaimFlow = () => {
    setClaimResult(null);
    setClaimRecord(null);
    setClaimError("");
    setClaimLoading(false);
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
    if (
      !loggedIn ||
      !hasFullAccess ||
      isCheckingAccess ||
      mode !== null ||
      claimAccessCode
    ) {
      return;
    }

    changeMode("control", { replace: true });
  }, [claimAccessCode, hasFullAccess, isCheckingAccess, loggedIn, mode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

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
      return;
    }

    setControlForm({
      qrUrl: liveState.qrUrl,
      timeframeEnd: liveEvent.timeframeEnd || initialControlForm.timeframeEnd,
      timeframeStart:
        liveEvent.timeframeStart || initialControlForm.timeframeStart,
      title: liveState.title,
    });
  }, [
    isEventLive,
    liveEvent.timeframeEnd,
    liveEvent.timeframeStart,
    liveState.qrUrl,
    liveState.title,
  ]);

  useEffect(() => {
    if (previousEventIdRef.current === liveEvent.eventId) {
      return;
    }

    previousEventIdRef.current = liveEvent.eventId;
    resetClaimFlow();
  }, [liveEvent.eventId]);

  useEffect(() => {
    if (isEventLive) {
      previousLiveEventTitleRef.current = liveState.title?.trim() || initialState.title;
    }

    const wasEventLive = previousIsEventLiveRef.current;

    if (isEventLive) {
      setEndedEventTitle("");
    } else if (wasEventLive && mode !== "control") {
      const completedEventTitle = previousLiveEventTitleRef.current;

      if (hadAttendeeClaim) {
        setEndedEventTitle(completedEventTitle);
      }

      if (loggedIn) {
        handleLogout();
      }
    }

    previousIsEventLiveRef.current = isEventLive;
  }, [hadAttendeeClaim, handleLogout, isEventLive, liveState.title, loggedIn, mode]);

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
    if (!loggedIn || !claimAccessGranted || !liveEvent.eventId) {
      return;
    }

    writeConfirmedClaimAccess({
      eventId: liveEvent.eventId,
      userId: user,
    });
  }, [claimAccessGranted, liveEvent.eventId, loggedIn, user]);

  useEffect(() => {
    if (!isEventLive || !liveEvent.eventId || !liveEvent.claimAccessSecret) {
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
    isEventLive,
    liveEvent.claimAccessSecret,
    liveEvent.eventId,
    loggedIn,
    user,
  ]);

  useEffect(() => {
    if (!isEventLive) {
      setClaimRoster([]);
      return undefined;
    }

    return subscribeToClaims({
      onClaims: (nextClaims) => {
        setClaimRoster(
          nextClaims.map((nextClaim) => normalizeRosterClaim(nextClaim, usernamesByUserId)),
        );
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync attendee claims.");
      },
    });
  }, [isEventLive, usernamesByUserId]);

  useEffect(() => {
    if (!isEventLive) {
      setUsernamesByUserId({});
      return undefined;
    }

    return subscribeToUsers({
      onUsers: (nextUsers) => {
        setUsernamesByUserId(
          nextUsers.reduce((accumulator, nextUser) => {
            accumulator[nextUser.userId] = nextUser.username || nextUser.userId;
            return accumulator;
          }, {}),
        );
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync Discord usernames.");
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
      !isEventLive ||
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
    isEventLive,
    isMember,
    liveEvent.eventId,
    loggedIn,
    user,
    username,
  ]);

  const persistState = async (newState) => {
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
  };

  const increment = (amount) => {
    persistState({
      ...liveState,
      current: liveState.current + amount,
      finalCall: false,
      finalCallTargetClaimIds: [],
      last: liveState.current,
    });
  };

  const newRound = () => {
    persistState({
      ...liveState,
      current: 0,
      finalCall: false,
      finalCallTargetClaimIds: [],
      last: 0,
      round: liveState.round + 1,
    });
  };

  const activateFinalCall = () => {
    persistState({
      ...liveState,
      finalCall: true,
      finalCallTargetClaimIds: currentEventClaims
        .filter((claim) => claim.redeemedRound !== currentRound)
        .map((claim) => claim.claimId),
    });
  };

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

  const buildEventStateFromForm = () =>
    normalizeState({
      ...liveState,
      qrUrl: controlForm.qrUrl.trim() || defaultQrUrl,
      title: controlForm.title.trim() || initialState.title,
    });

  const handleStartEvent = async (event) => {
    event.preventDefault();
    const timeframeError = validateTimeframe();

    if (timeframeError) {
      setControlMessage(timeframeError);
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
      setControlMessage("Event started.");
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

    if (timeframeError) {
      setControlMessage(timeframeError);
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
      setControlMessage("Event closed.");
      changeMode(null);
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
        isEventLive={isEventLive}
        liveEvent={liveEvent}
        liveState={liveState}
        rotatingClaimAccessUrl={rotatingClaimAccessUrl}
      />
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
        <ControlAccessDenied
          authError={authError}
          handleLogout={handleLogout}
          hasFullAccess={hasFullAccess}
          isCheckingAccess={isCheckingAccess}
          loggedIn={loggedIn}
          onMainPage={() => changeMode(null)}
          onStartOAuthGrant={startOAuthGrant}
        />
      );
    }

    return (
      <ControlPage
        activeQueueClaims={activeQueueClaims}
        controlForm={controlForm}
        controlMessage={controlMessage}
        controlSaving={controlSaving}
        currentEventClaims={currentEventClaims}
        currentRound={currentRound}
        isEventDetailsModalOpen={isEventDetailsModalOpen}
        isEventLive={isEventLive}
        isLastGroup={isLastGroup}
        liveEvent={liveEvent}
        liveState={liveState}
        onActivateFinalCall={activateFinalCall}
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
        onSaveEventDetails={handleSaveEventDetails}
        onStartEvent={handleStartEvent}
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

  if (!isEventLive) {
    return (
      <ClosedEventPage
        authError={authError}
        endedEventTitle={mode === null ? endedEventTitle : ""}
        hasFullAccess={hasFullAccess}
        isCheckingAccess={isCheckingAccess}
        loggedIn={loggedIn}
        onOpenControl={() => changeMode("control")}
        onStartOAuthGrant={startOAuthGrant}
      />
    );
  }

  if (!claimAccessGranted && !effectiveClaimResult) {
    return (
      <ClaimAccessGatePage
        authError={authError}
        claimAccessStatus={claimAccessStatus}
        hasFullAccess={hasFullAccess}
        isCheckingAccess={isCheckingAccess}
        liveEvent={liveEvent}
        liveState={liveState}
        loggedIn={loggedIn}
        onOpenControl={() => changeMode("control")}
        onStartOAuthGrant={startOAuthGrant}
      />
    );
  }

  return (
    <ClaimPage
      claimError={claimError}
      claimLoading={claimLoading}
      claimQrPayload={claimQrPayload}
      claimRecord={claimRecord}
      claimResult={effectiveClaimResult}
      currentRound={currentRound}
      eventStartLabel={eventStartLabel}
      hasClaimedCurrentRound={hasClaimedCurrentRound}
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
      onLogout={handleLogout}
      onOpenBookList={openBookList}
      onStartOAuthGrant={startOAuthGrant}
      showClaimQr={showClaimQr}
    />
  );
}

export default App;
