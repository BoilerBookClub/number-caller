import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import QrScanner from "qr-scanner";
import QRCode from "react-qr-code";
import sound from "/sound.mp3";
import "./App.css";
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
  const rotatingClaimAccessUrl = rotatingClaimAccessCode
    ? buildClaimAccessUrl(rotatingClaimAccessCode)
    : "";
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
  const activeQueueClaimedCount = activeQueueClaims.filter(
    (claim) => claim.redeemedRound === currentRound,
  ).length;
  const isLastGroup =
    !liveState.finalCall && liveState.current > 0 && liveState.current >= totalPeopleWithNumbers;
  const queueTitle = liveState.finalCall ? "Final Call" : "Current Group";
  const queueDescription = liveState.finalCall
    ? `Showing everyone who had not claimed an item before final call started for round ${currentRound}.`
    : liveState.current === 0
      ? "Call the first group to start item pickup."
      : `Tracking attendees in numbers ${liveState.last + 1}-${liveState.current}.`;

  const changeMode = (nextMode) => {
    setMode(nextMode);
    window.history.replaceState({}, document.title, getScreenUrl(nextMode));
  };

  const openDisplayScreen = () => {
    window.open(displayUrl, "_blank", "noopener,noreferrer");
  };

  const openBookList = () => {
    window.open(qrCodeValue, "_blank", "noopener,noreferrer");
  };

  const handleLogout = () => {
    clearClaimAccessGrant();
    clearConfirmedClaimAccess();
    logout();
  };

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
    if (!loggedIn || !hasFullAccess || isCheckingAccess || mode !== null) {
      return;
    }

    changeMode("control");
  }, [hasFullAccess, isCheckingAccess, loggedIn, mode]);

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

    if (current > previousCurrent && !isFinalCall) {
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
  }, [current, isFinalCall]);

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
    if (!claimResult?.claimId) {
      setClaimRecord(null);
      return undefined;
    }

    return subscribeToClaim({
      claimId: claimResult.claimId,
      onClaim: (nextClaim) => {
        setClaimRecord(normalizeClaimRecord(claimResult.claimId, nextClaim));
      },
      onError: (error) => {
        console.error(error.message || "Unable to sync claim status.");
      },
    });
  }, [claimResult?.claimId]);

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

    const claimAccessCode = getClaimAccessCodeFromUrl();
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
      claimResult
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
    claimResult,
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

  const renderControlAccessDenied = () => (
    <div className="entry-screen">
      <div className="entry-card">
        <h2>Control Panel Access</h2>
        <p>Only Discord users with the special role can access the control panel.</p>
        {!loggedIn ? (
          <button onClick={startOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn ? (
          <button className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        ) : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login does not have the special role required to use staff controls.
          </p>
        ) : null}
      </div>
      <div className="entry-card">
        <h2>Return to Sign Up</h2>
        <p>Go back to the attendee page.</p>
        <button onClick={() => changeMode(null)}>Main Page</button>
      </div>
    </div>
  );

  const renderClosedEventPage = () => (
    <div className="entry-screen">
      <div className="entry-card">
        <h2>Staff Login</h2>
        <p>Log in with Discord to open the control panel and start the event.</p>
        {!loggedIn || !hasFullAccess ? (
          <button onClick={startOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn && hasFullAccess && !isCheckingAccess ? (
          <button onClick={() => changeMode("control")}>Open Control Panel</button>
        ) : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login is not on the staff allowlist, so it stays on this page.
          </p>
        ) : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
      </div>
    </div>
  );

  const renderClaimResult = () => (
    <div className="entry-card assigned-card claim-modal-card">
      <p className="eyebrow">You&apos;re in line</p>
      <h2>Your number is</h2>
      <div className={`assigned-number${showClaimQr ? " rainbow-text" : ""}`}>
        {claimResult.number}
      </div>
      <p>
        Your spot is saved. Watch the display screen to see when your number is called.
      </p>
      <button className="secondary-button" onClick={openBookList}>
        Open Book Descriptions
      </button>
      <div className="claim-status-grid">
        <div className="stat-card">
          <span>Round</span>
          <strong>{currentRound}</strong>
        </div>
        <div className="stat-card">
          <span>Currently Calling</span>
          <strong>{liveCallLabel}</strong>
        </div>
      </div>
      <div className="claim-qr-panel">
        {claimRecord ? (
          showClaimQr ? (
            <>
              <p className="eyebrow">Show This To Staff</p>
              <div className="claim-qr-box">
                <QRCode value={claimQrPayload} size={180} />
              </div>
              <p>
                Your turn is active for round {currentRound}. A staff member will scan
                this QR code after you pick one item.
              </p>
            </>
          ) : hasClaimedCurrentRound ? (
            <p className="status-message status-message--success">
              You already claimed one item in round {currentRound}. Your QR code will
              return when the next round reaches your number again.
            </p>
          ) : (
            <p>
              Your QR code will appear here once the display reaches number {claimRecord.number}
              in round {currentRound}.
            </p>
          )
        ) : (
          <p>Syncing your claim status…</p>
        )}
      </div>
    </div>
  );

  const renderMemberClaimCard = () => (
    <div className="entry-card claim-modal-card">
      <p className="eyebrow">Live Event</p>
      <h1>{liveState.title}</h1>
      {liveEvent.timeframeLabel ? <p>{liveEvent.timeframeLabel}</p> : null}
      <h2>Claim Your Number</h2>
      <p>Log in with Discord and we&apos;ll assign your number automatically.</p>
      {!loggedIn ? (
        <button onClick={startOAuthGrant} disabled={isCheckingAccess || claimLoading}>
          {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
        </button>
      ) : null}
      {loggedIn && isCheckingAccess ? <p>Checking your membership…</p> : null}
      {loggedIn && claimLoading ? <p>Assigning your number…</p> : null}
      {loggedIn && !isCheckingAccess && !claimLoading && !isClaimWindowOpen ? (
        <p>
          {isMember && memberEarlyAccessTime
            ? `Logged in. Because you have the member role, you can claim starting at ${memberEarlyAccessLabel}.`
            : `Logged in. You need to wait for the event to start at ${eventStartLabel}.`}
        </p>
      ) : null}
      {loggedIn && !isCheckingAccess && !claimLoading && isClaimWindowOpen && !claimResult ? (
        <p>
          {isMember
            ? isEventStarted
              ? "Logged in with the member role. Your claim will be assigned automatically."
              : "Logged in with the member role. Early claim access is open, so your claim will be assigned automatically."
            : "Logged in. The event has started, so your claim will be assigned automatically."}
        </p>
      ) : null}
      {claimError ? <p className="entry-message">{claimError}</p> : null}
      {loggedIn ? (
        <button className="secondary-button" onClick={handleLogout}>
          Logout
        </button>
      ) : null}
    </div>
  );

  const renderClaimPage = () => (
    <div className="claim-page claim-page--focused">
      {claimResult ? renderClaimResult() : null}
      {!claimResult ? renderMemberClaimCard() : null}
    </div>
  );

  const renderClaimAccessGatePage = () => (
    <div className="entry-screen">
      <div className="entry-card hero-card">
        <p className="eyebrow">Live Event</p>
        <h1>{liveState.title}</h1>
        {liveEvent.timeframeLabel ? <p>{liveEvent.timeframeLabel}</p> : null}
        <h2>Staff Login</h2>
        <p>
          Attendees must scan the in-person event QR code before they can log in and
          claim a number.
        </p>
        {!loggedIn || !hasFullAccess ? (
          <button onClick={startOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn && hasFullAccess && !isCheckingAccess ? (
          <button onClick={() => changeMode("control")}>Open Control Panel</button>
        ) : null}
        {claimAccessStatus ? <p className="entry-message">{claimAccessStatus}</p> : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
      </div>
    </div>
  );

  const renderDisplayPage = () => {
    if (!isEventLive) {
      return (
        <div className="display empty-state">
          <h1>The event isn&apos;t open yet.</h1>
        </div>
      );
    }

    return (
      <div className="display">
        <p className="eyebrow">{liveEvent.timeframeLabel}</p>
        <h1>Goodie Selection ROUND {liveState.round}</h1>
        <h1 className="carnival">{liveState.title}</h1>

        <div className="display-content-row">
          <div className="display-main">
            {liveState.current === 0 && !liveState.finalCall ? (
              <div className="final-call">
                <h1 className="rainbow-text">Starting Soon</h1>
              </div>
            ) : !liveState.finalCall ? (
              <>
                <h1>Numbers</h1>
                <h1 className="number rainbow-text">
                  {liveState.last + 1}-{liveState.current}
                </h1>
                <h1>may select an item now!</h1>
              </>
            ) : (
              <>
                <div className="final-call">
                  <h1 className="rainbow-text">FINAL CALL</h1>
                </div>
                <h2>If you have NOT gotten an item yet, please come forward</h2>
              </>
            )}
          </div>

          <div className="rules-qr-container">
            {rotatingClaimAccessUrl ? (
              <div className="qr-code qr-code--claim">
                <QRCode value={rotatingClaimAccessUrl} size={160} />
                <h2 className="qr-caption">Scan to Claim Your Number</h2>
                <p className="qr-helper-text">This attendee QR refreshes every minute.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderEventDetailsModal = () => (
    <div className="event-modal-backdrop" role="presentation">
      <div className="event-modal" role="dialog" aria-modal="true" aria-label="Event details">
        {isEventLive ? (
          <div className="event-modal-header">
            <button
              type="button"
              className="event-modal-close"
              onClick={closeEventDetailsModal}
              aria-label="Close event details"
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="event-modal-content">
          <h2>{isEventLive ? "Edit Event Details" : "Create Event"}</h2>
          <form
            className="control-form"
            onSubmit={isEventLive ? handleSaveEventDetails : handleStartEvent}
          >
            <label className="control-input-group control-input-group--centered">
              <span>Event Title</span>
              <input
                type="text"
                value={controlForm.title}
                onChange={handleControlFieldChange("title")}
                placeholder="Enter event title"
              />
            </label>
            <label className="control-input-group control-input-group--centered">
              <span>Book List URL</span>
              <input
                type="url"
                value={controlForm.qrUrl}
                onChange={handleControlFieldChange("qrUrl")}
                placeholder="Enter QR code destination"
              />
            </label>
            <div className="time-grid time-grid--centered">
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>Start Time</span>
                <input
                  type="time"
                  value={controlForm.timeframeStart}
                  onChange={handleControlFieldChange("timeframeStart")}
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>End Time</span>
                <input
                  type="time"
                  value={controlForm.timeframeEnd}
                  onChange={handleControlFieldChange("timeframeEnd")}
                />
              </label>
            </div>
            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}
            <div className="control-actions">
              <button type="submit" disabled={controlSaving}>
                {controlSaving
                  ? "Saving..."
                  : isEventLive
                    ? "Save Event Details"
                    : "Start Event"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  const renderControlPage = () => {
    if (isCheckingAccess) {
      return (
        <div className="mode-select">
          <h2>Checking Discord access…</h2>
        </div>
      );
    }

    if (!hasFullAccess) {
      return renderControlAccessDenied();
    }

    return (
      <div className="control">
        {!isEventLive ? renderEventDetailsModal() : null}
        {isEventLive ? (
          <>
            <div className={`control-dashboard${isEventDetailsModalOpen ? " control-dashboard--blurred" : ""}`}>
              <div className="control-event-header">
                <h1>{liveState.title}</h1>
                <p className="control-event-subtitle">{liveEvent.timeframeLabel}</p>
                <p className="control-event-subtitle control-event-link">{liveState.qrUrl}</p>
                <div className="control-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setIsEventDetailsModalOpen(true)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleCloseEvent}
                    disabled={controlSaving}
                  >
                    End Event
                  </button>
                </div>
              </div>

              <div className="stats-grid">
              <div className="stat-card">
                <span>Round</span>
                <strong>{liveState.round}</strong>
              </div>
              <div className="stat-card">
                <span>Currently Calling</span>
                <strong>
                  {liveState.current === 0
                    ? "Starting Soon"
                    : `${liveState.last + 1}-${liveState.current}`}
                </strong>
              </div>
              <div className="stat-card">
                <span>Attendees</span>
                <strong>{totalPeopleWithNumbers}</strong>
              </div>
              </div>

              {!liveState.finalCall ? (
              <>
                {!isLastGroup ? (
                  <div>
                    <button onClick={() => increment(10)}>
                      {liveState.round === 1 && liveState.current === 0
                        ? "Start Round 1"
                        : "Next Group"}
                    </button>
                  </div>
                ) : (
                  <p className="entry-message">
                    This is the last group. Use Final Call when you&apos;re ready.
                  </p>
                )}
                <div>
                  <button onClick={activateFinalCall}>Final Call</button>
                </div>
              </>
            ) : (
              <div>
                <button onClick={newRound}>Start Next Round</button>
              </div>
            )}

            <div className="entry-card compact-card queue-card">
              <h2>{queueTitle}</h2>
              <p>{queueDescription}</p>
              {activeQueueClaims.length ? (
                <>
                  <p className="queue-progress">
                    {activeQueueClaimedCount}/{activeQueueClaims.length} have claimed
                  </p>
                  {!liveState.finalCall && isLastGroup ? (
                    <p className="entry-message">This is the last group.</p>
                  ) : null}
                  <div className="roster-list" role="list">
                    {activeQueueClaims.map((claim) => {
                      const hasClaimedCurrentGroup = claim.redeemedRound === currentRound;

                      return (
                        <div key={claim.claimId} className="roster-row" role="listitem">
                          <div className="roster-primary">
                            <strong>#{claim.number}</strong>
                            <span>{claim.displayName}</span>
                          </div>
                          <div className="roster-meta">
                            <span
                              className={`roster-badge ${hasClaimedCurrentGroup ? "roster-badge--claimed" : "roster-badge--waiting"}`}
                            >
                              {hasClaimedCurrentGroup ? "Claimed" : "Waiting"}
                            </span>
                            <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                            <span
                              className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                            >
                              {claim.isMember ? "Member" : "Not Member"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p>
                  {liveState.finalCall
                    ? "Everyone from the final-call list has claimed an item."
                    : liveState.current === 0
                      ? "No group is active yet."
                      : "No attendees are in the current group."}
                </p>
              )}
            </div>

            <div className="entry-card compact-card roster-card">
              <h2>Attendee Roster</h2>
              <p>Total people with numbers: {totalPeopleWithNumbers}</p>
              {currentEventClaims.length ? (
                <div className="roster-list" role="list">
                  {currentEventClaims.map((claim) => (
                    <div key={claim.claimId} className="roster-row" role="listitem">
                      <div className="roster-primary">
                        <strong>#{claim.number}</strong>
                        <span>{claim.displayName}</span>
                      </div>
                      <div className="roster-meta">
                        <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                        <span
                          className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                        >
                          {claim.isMember ? "Member" : "Not Member"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No attendees have claimed a number yet.</p>
              )}
            </div>
            </div>
            {isEventDetailsModalOpen ? renderEventDetailsModal() : null}
          </>
        ) : null}

        {scannerActive ? (
          <div className="scanner-modal" role="dialog" aria-modal="true" aria-label="Claim scanner">
            <div className="scanner-modal-header">
              <button
                type="button"
                className="scanner-close-button"
                onClick={() => setScannerActive(false)}
                aria-label="Close scanner"
              >
                ×
              </button>
            </div>
            <div className="scanner-modal-body">
              <video ref={scannerVideoRef} className="scanner-video scanner-video--modal" muted playsInline />
            </div>
            <div className="scanner-modal-footer">
              <p>Point the camera at an attendee&apos;s QR code.</p>
            </div>
            {scanLoading ? (
              <div className="scanner-toast scanner-toast--loading">Processing scan…</div>
            ) : null}
            {scanFeedback ? (
              <div className={`scanner-toast scanner-toast--${scanFeedback.tone}`}>
                {scanFeedback.message}
              </div>
            ) : null}
          </div>
        ) : null}

        {isEventLive ? (
          <div className="bottom-navbar">
            <button className="secondary-button bottom-navbar-button" onClick={handleLogout}>
              Logout
            </button>
            <button
              className="bottom-navbar-button"
              type="button"
              onClick={() => {
                setScanFeedback(null);
                setScannerActive(true);
              }}
              disabled={scanLoading || !isEventLive}
            >
              Open Scanner
            </button>
            <button className="secondary-button bottom-navbar-button" onClick={openDisplayScreen}>
              Open Display Screen
            </button>
          </div>
        ) : (
          <div className="bottom-navbar">
            <button className="secondary-button bottom-navbar-button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </div>
    );
  };

  if (!isHydrated) {
    return (
      <div className="mode-select">
        <h2>Connecting to live event…</h2>
      </div>
    );
  }

  if (mode === "display") {
    return renderDisplayPage();
  }

  if (mode === "control") {
    return renderControlPage();
  }

  if (!isEventLive) {
    return renderClosedEventPage();
  }

  if (!claimAccessGranted && !claimResult) {
    return renderClaimAccessGatePage();
  }

  return renderClaimPage();
}

export default App;
