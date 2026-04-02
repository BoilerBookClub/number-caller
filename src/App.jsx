import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import "./App.css";
import sound from "/sound.mp3";
import QRCode from "react-qr-code";
import {
  firebaseEnabled,
  getModeFromUrl,
  getScreenUrl,
  pushLiveState,
  subscribeToLiveState,
} from "./firebase";


const initialState = {
  title: "READING CARNIVAL",
  current: 0,
  last: 0,
  round: 1,
  finalCall: false,
};

const normalizeState = (nextState) => ({
  ...initialState,
  ...nextState,
});

function App() {
  const [mode, setMode] = useState(() => getModeFromUrl());
  const [state, setState] = useState(initialState);
  const [syncStatus, setSyncStatus] = useState(
    firebaseEnabled ? "connecting" : "disabled",
  );
  const [syncError, setSyncError] = useState("");
  const [isHydrated, setIsHydrated] = useState(!firebaseEnabled);
  const previousCurrentRef = useRef(initialState.current);
  const { current, finalCall: isFinalCall } = state;

  const dingSound = useRef(new Audio(sound));
  const displayUrl = getScreenUrl("display");
  const controlUrl = getScreenUrl("control");

  useEffect(() => {
    if (!firebaseEnabled) {
      return undefined;
    }

    return subscribeToLiveState({
      onState: (nextState) => {
        setState(normalizeState(nextState));
        setIsHydrated(true);
        setSyncStatus("live");
        setSyncError("");
      },
      onError: (error) => {
        setIsHydrated(true);
        setSyncStatus("error");
        setSyncError(error.message || "Unable to connect to Firebase.");
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

      // 🔊 Play sound
      if (dingSound.current) {
        dingSound.current.currentTime = 0;
        dingSound.current.play().catch(() => {});
      }
    }

    previousCurrentRef.current = current;
  }, [current, isFinalCall]);

  const persistState = async (newState) => {
    const nextState = normalizeState(newState);
    setState(nextState);

    if (!firebaseEnabled) {
      return;
    }

    try {
      setSyncStatus("syncing");
      await pushLiveState(nextState);
      setSyncStatus("live");
      setSyncError("");
    } catch (error) {
      setSyncStatus("error");
      setSyncError(error.message || "Unable to sync to Firebase.");
    }
  };

  const increment = (amount) => {
    persistState({
      ...state,
      last: state.current,
      current: state.current + amount,
      finalCall: false,
    });
  };

  const reset = () => {
    persistState({ ...initialState, title: state.title });
  };

  const newRound = () => {
    persistState({
      ...state,
      current: 0,
      last: 0,
      round: state.round + 1,
      finalCall: false,
    });
  };

  const finalCall = () => {
    persistState({ ...state, finalCall: true });
  };

  const updateTitle = (event) => {
    persistState({ ...state, title: event.target.value });
  };

  if (!mode) {
    return (
      <div className="mode-select">
        <h2>Choose a screen</h2>
        <button onClick={() => setMode("display")}>Display Screen</button>
        <button onClick={() => setMode("control")}>Control Screen</button>
        <div className={`sync-banner sync-banner--${syncStatus}`}>
          <strong>Sync:</strong> {syncStatus}
          {syncStatus === "disabled"
            ? " Configure Firebase env vars to sync online."
            : null}
          {syncError ? <div>{syncError}</div> : null}
        </div>
      </div>
    );
  }

  if (!isHydrated) {
    return (
      <div className="mode-select">
        <h2>Connecting to live event…</h2>
      </div>
    );
  }

  if (mode === "display") {
    return (
      <div className="display">
        <div className={`sync-banner sync-banner--${syncStatus}`}>
          <strong>Live status:</strong> {syncStatus}
          {syncError ? <div>{syncError}</div> : null}
        </div>
        <h1>Goodie Selection ROUND {state.round}</h1>
        <h1 className="carnival">{state.title}</h1>

        {state.current === 0 && !state.finalCall ? (
          <>
            <div className="final-call">
              <h1 className="rainbow-text">Starting Soon</h1>
            </div>
          </>
        ) : !state.finalCall ? (
          <>
            <h1>Numbers</h1>
            <h1 className="number rainbow-text">
              {state.last + 1}-{state.current}
            </h1>
            <h1>may select an item now! (OR IF YOU DON'T HAVE AN ITEM YET)</h1>
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
            <h1
              style={{
                lineHeight: "80%",
                marginBottom: "10px",
                fontSize: "2rem",
              }}
            >
              <u>IMPORTANT RULES</u>
            </h1>
            <li>
              When your number is called, select either ONE Book or ONE
              Succulent
            </li>
            <li>
              You will receive a stamp on your number AFTER you have selected
              your item.
            </li>
            <li>
              Keep this paper. After all numbers have been called, the process
              will restart and you&apos;ll get a chance to select another item.
              There is NO guarantee particular items will be available,
              everything is first come first serve.
            </li>
          </ol>

          <div className="qr-code">
            <QRCode
              value="https://www.boilerbookclub.com/announcements/reading-carnival-9-2025-s2tex-zke4e"
              size={160}
            />
            <h2
              style={{
                maxWidth: "200px",
                textAlign: "center",
                lineHeight: "90%",
                margin: "0",
                fontSize: "1.3rem",
              }}
            >
              Scan to See Book Descriptions!
            </h2>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "control") {
    return (
      <div className="control">
        <div className={`sync-banner sync-banner--${syncStatus}`}>
          <strong>Live status:</strong> {syncStatus}
          {syncError ? <div>{syncError}</div> : null}
        </div>
        <h1>Control Panel</h1>
        <div className="link-card">
          <p>Viewer screen</p>
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
        <label className="control-title-input">
          <span>Event Title</span>
          <input
            type="text"
            value={state.title}
            onChange={updateTitle}
            placeholder="Enter event title"
          />
        </label>
        <h2>Round {state.round}</h2>
        <h3>
          Current: {state.last + 1}–{state.current}
        </h3>
        <div>
          <button onClick={() => increment(5)}>+5</button>
          <button onClick={() => increment(10)}>+10</button>
          <button onClick={() => increment(20)}>+20</button>
        </div>
        <div>
          <button onClick={reset}>Reset</button>
          <button onClick={finalCall}>Final Call</button>
          <button onClick={newRound}>Start New Round</button>
        </div>
      </div>
    );
  }
}

export default App;