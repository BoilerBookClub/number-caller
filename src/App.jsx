import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import QRCode from "react-qr-code";
import sound from "/sound.mp3";
import "./App.css";
import {
  claimEventNumber,
  closeLiveEvent,
  createLiveEvent,
  firebaseEnabled,
  getModeFromUrl,
  getScreenUrl,
  pushLiveState,
  subscribeToLiveEvent,
  updateLiveEventDetails,
} from "./firebase";
import useDiscordLogin from "./useDiscordLogin";

const defaultQrUrl =
  "https://www.boilerbookclub.com/announcements/reading-carnival-9-2025-s2tex-zke4e";

const initialState = {
  title: "READING CARNIVAL",
  qrUrl: defaultQrUrl,
  current: 0,
  last: 0,
  round: 1,
  finalCall: false,
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
  eventId: null,
  nextClaimNumber: 1,
  timeframeEnd: "",
  timeframeLabel: "",
  timeframeStart: "",
  ...nextEvent,
  state: normalizeState(nextEvent?.state),
});

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

const buildEventId = () =>
  globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}`;

function App() {
  const [mode, setMode] = useState(() => getModeFromUrl());
  const [liveEvent, setLiveEvent] = useState(() => normalizeLiveEvent(null));
  const [isHydrated, setIsHydrated] = useState(!firebaseEnabled);
  const [controlForm, setControlForm] = useState(initialControlForm);
  const [controlMessage, setControlMessage] = useState("");
  const [controlSaving, setControlSaving] = useState(false);
  const [claimChoice, setClaimChoice] = useState(null);
  const [guestEmail, setGuestEmail] = useState("");
  const [claimResult, setClaimResult] = useState(null);
  const [claimError, setClaimError] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const previousCurrentRef = useRef(initialState.current);
  const previousEventIdRef = useRef(null);
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
  } = useDiscordLogin();

  const dingSound = useRef(new Audio(sound));
  const liveState = liveEvent.state;
  const { current, finalCall: isFinalCall } = liveState;
  const claimUrl = getScreenUrl(null);
  const controlUrl = getScreenUrl("control");
  const displayUrl = getScreenUrl("display");
  const isCheckingAccess = authLoading || roleLoading;
  const isEventLive = liveEvent.active;
  const qrCodeValue = liveState.qrUrl.trim() || defaultQrUrl;

  const changeMode = (nextMode) => {
    setMode(nextMode);
    window.history.replaceState({}, document.title, getScreenUrl(nextMode));
  };

  const resetClaimFlow = () => {
    setClaimChoice(null);
    setGuestEmail("");
    setClaimResult(null);
    setClaimError("");
    setClaimLoading(false);
  };

  const selectClaimChoice = (nextChoice) => {
    setClaimChoice(nextChoice);
    setClaimError("");
    setClaimResult(null);
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
    if (
      claimChoice !== "member" ||
      !isEventLive ||
      !loggedIn ||
      isCheckingAccess ||
      claimLoading ||
      claimResult
    ) {
      return;
    }

    if (!isMember) {
      setClaimChoice(null);
      setClaimError("Your Discord account is not a verified club member.");
      return;
    }

    const assignDiscordNumber = async () => {
      setClaimLoading(true);

      try {
        const result = await claimEventNumber({
          claimKey: `discord:${user}`,
          discordUserId: user,
          displayName: user,
          eventId: liveEvent.eventId,
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
    claimChoice,
    claimLoading,
    claimResult,
    isCheckingAccess,
    isEventLive,
    isMember,
    liveEvent.eventId,
    loggedIn,
    user,
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
      last: liveState.current,
    });
  };

  const resetNumbers = () => {
    persistState({
      ...initialState,
      qrUrl: liveState.qrUrl,
      title: liveState.title,
    });
  };

  const newRound = () => {
    persistState({
      ...liveState,
      current: 0,
      finalCall: false,
      last: 0,
      round: liveState.round + 1,
    });
  };

  const activateFinalCall = () => {
    persistState({ ...liveState, finalCall: true });
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

  const handleGuestClaim = async (event) => {
    event.preventDefault();

    const normalizedEmail = guestEmail.trim().toLowerCase();

    if (!normalizedEmail.endsWith("@purdue.edu")) {
      setClaimError("Use your @purdue.edu email address.");
      return;
    }

    setClaimLoading(true);

    try {
      const result = await claimEventNumber({
        claimKey: `email:${normalizedEmail}`,
        displayName: normalizedEmail,
        email: normalizedEmail,
        eventId: liveEvent.eventId,
        participantType: "email",
      });

      setClaimResult(result);
      setClaimError("");
    } catch (error) {
      setClaimError(error.message || "Unable to assign a number right now.");
    } finally {
      setClaimLoading(false);
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
          <button className="secondary-button" onClick={logout}>
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
        <h1>The event isn&apos;t open yet.</h1>
        <p>Check back during the event window to claim your number.</p>
        {!firebaseEnabled ? (
          <p className="entry-message">Firebase is not configured for this build.</p>
        ) : null}
      </div>
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
    <div className="entry-card assigned-card">
      <p className="eyebrow">You&apos;re in line</p>
      <h2>Your number is</h2>
      <div className="assigned-number">{claimResult.number}</div>
      <p>
        {claimResult.existing
          ? "You already claimed a number for this event."
          : "Your spot is saved. Watch the display screen to see when your number is called."}
      </p>
      <button className="secondary-button" onClick={resetClaimFlow}>
        Back
      </button>
    </div>
  );

  const renderMemberClaimCard = () => (
    <div className="entry-card">
      <h2>Discord Member Login</h2>
      <p>Log in with Discord and we&apos;ll assign your number automatically.</p>
      {!loggedIn ? (
        <button onClick={startOAuthGrant} disabled={isCheckingAccess || claimLoading}>
          {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
        </button>
      ) : null}
      {loggedIn && isCheckingAccess ? <p>Checking your membership…</p> : null}
      {loggedIn && isMember && claimLoading ? <p>Assigning your number…</p> : null}
      {claimError ? <p className="entry-message">{claimError}</p> : null}
      <button className="secondary-button" onClick={resetClaimFlow}>
        Back
      </button>
      {loggedIn ? (
        <button className="secondary-button" onClick={logout}>
          Logout
        </button>
      ) : null}
    </div>
  );

  const renderGuestClaimCard = () => (
    <form className="entry-card" onSubmit={handleGuestClaim}>
      <h2>Purdue Email</h2>
      <p>Enter your @purdue.edu email and we&apos;ll assign your number.</p>
      <label className="control-input-group">
        <span>Purdue Email</span>
        <input
          type="email"
          value={guestEmail}
          onChange={(event) => setGuestEmail(event.target.value)}
          placeholder="name@purdue.edu"
        />
      </label>
      {claimError ? <p className="entry-message">{claimError}</p> : null}
      <button type="submit" disabled={claimLoading}>
        {claimLoading ? "Assigning Number..." : "Claim Number"}
      </button>
      <button className="secondary-button" type="button" onClick={resetClaimFlow}>
        Back
      </button>
    </form>
  );

  const renderClaimPage = () => (
    <div className="claim-page">
      <div className="entry-card hero-card">
        <p className="eyebrow">Live Event</p>
        <h1>{liveState.title}</h1>
        {liveEvent.timeframeLabel ? <p>{liveEvent.timeframeLabel}</p> : null}
        <h2>Are you a member?</h2>
        <div className="choice-row">
          <button onClick={() => selectClaimChoice("member")}>Yes</button>
          <button className="secondary-button" onClick={() => selectClaimChoice("guest")}>No</button>
        </div>
        {claimError && !claimChoice ? (
          <p className="entry-message">{claimError}</p>
        ) : null}
        {loggedIn && hasFullAccess ? (
          <button className="secondary-button" onClick={() => changeMode("control")}>
            Open Control Panel
          </button>
        ) : null}
      </div>

      {claimResult ? renderClaimResult() : null}
      {!claimResult && claimChoice === "member" ? renderMemberClaimCard() : null}
      {!claimResult && claimChoice === "guest" ? renderGuestClaimCard() : null}
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
            <h1>may select an item now! (OR IF YOU DON&apos;T HAVE AN ITEM YET)</h1>
          </>
        ) : (
          <>
            <div className="final-call">
              <h1 className="rainbow-text">FINAL CALL</h1>
            </div>
            <h2>If you have NOT gotten an item yet, please come forward</h2>
          </>
        )}

        <div className="rules-qr-container">
          <ol>
            <h1 className="rules-heading">
              <u>IMPORTANT RULES</u>
            </h1>
            <li>When your number is called, select either ONE Book or ONE Succulent</li>
            <li>You will receive a stamp on your number AFTER you have selected your item.</li>
            <li>
              Keep this paper. After all numbers have been called, the process will
              restart and you&apos;ll get a chance to select another item. There is NO
              guarantee particular items will be available, everything is first come
              first serve.
            </li>
          </ol>

          <div className="qr-code">
            <QRCode value={qrCodeValue} size={160} />
            <h2 className="qr-caption">Scan to See Book Descriptions!</h2>
          </div>
        </div>
      </div>
    );
  };

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
        <div className="control-toolbar">
          <button className="secondary-button" onClick={() => changeMode(null)}>
            Main Page
          </button>
          <button className="secondary-button" onClick={logout}>
            Logout
          </button>
        </div>
        <h1>Control Panel</h1>
        <div className="link-card-row">
          <div className="link-card">
            <p>Attendee sign-up page</p>
            <a href={claimUrl} target="_blank" rel="noreferrer">
              {claimUrl}
            </a>
          </div>
          <div className="link-card">
            <p>Display screen</p>
            <a href={displayUrl} target="_blank" rel="noreferrer">
              {displayUrl}
            </a>
          </div>
          <div className="link-card">
            <p>Control screen</p>
            <a href={controlUrl} target="_blank" rel="noreferrer">
              {controlUrl}
            </a>
          </div>
        </div>

        <form className="control-form" onSubmit={isEventLive ? handleSaveEventDetails : handleStartEvent}>
          <label className="control-input-group">
            <span>Event Title</span>
            <input
              type="text"
              value={controlForm.title}
              onChange={handleControlFieldChange("title")}
              placeholder="Enter event title"
            />
          </label>
          <label className="control-input-group">
            <span>QR Code URL</span>
            <input
              type="url"
              value={controlForm.qrUrl}
              onChange={handleControlFieldChange("qrUrl")}
              placeholder="Enter QR code destination"
            />
          </label>
          <div className="time-grid">
            <label className="control-input-group">
              <span>Start Time</span>
              <input
                type="time"
                value={controlForm.timeframeStart}
                onChange={handleControlFieldChange("timeframeStart")}
              />
            </label>
            <label className="control-input-group">
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
            {isEventLive ? (
              <button
                className="secondary-button"
                type="button"
                onClick={handleCloseEvent}
                disabled={controlSaving}
              >
                End Event
              </button>
            ) : null}
          </div>
        </form>

        {isEventLive ? (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <span>Timeframe</span>
                <strong>{liveEvent.timeframeLabel}</strong>
              </div>
              <div className="stat-card">
                <span>Numbers Claimed</span>
                <strong>{liveEvent.claimCount}</strong>
              </div>
              <div className="stat-card">
                <span>Currently Calling</span>
                <strong>
                  {liveState.current === 0
                    ? "Starting Soon"
                    : `${liveState.last + 1}-${liveState.current}`}
                </strong>
              </div>
            </div>

            <h2>Round {liveState.round}</h2>
            <h3>
              Current: {liveState.last + 1}–{liveState.current}
            </h3>
            <div>
              <button onClick={() => increment(5)}>+5</button>
              <button onClick={() => increment(10)}>+10</button>
              <button onClick={() => increment(20)}>+20</button>
            </div>
            <div>
              <button onClick={resetNumbers}>Reset</button>
              <button onClick={activateFinalCall}>Final Call</button>
              <button onClick={newRound}>Start New Round</button>
            </div>
          </>
        ) : (
          <div className="entry-card compact-card">
            <h2>No live event</h2>
            <p>Start a live event to open attendee sign-ups and the display screen.</p>
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

  return renderClaimPage();
}

export default App;
