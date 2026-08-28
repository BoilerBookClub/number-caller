import { useCallback, useEffect, useRef, useState } from "react";

/* Long enough that a double-tap on a phone cannot get through, short enough
   that staff working a fast room never wait on the panel. Module-local: the
   only caller is the default parameter below, and nothing outside this file
   has ever needed the number. */
const ADVANCE_COOLDOWN_MS = 5000;

/**
 * A short grey-out on a button that moves the whole room forward.
 *
 * The round's primary action is one button that keeps changing what it does —
 * Start Round, then Next Group, then Final Call, then Next Round — and a
 * second press landing a beat after the first skips a step nobody in the room
 * has read yet. It is worst exactly where the wording changes: the thumb is
 * already on its way down when Next Group turns into Final Call, and the
 * press it was aiming at the group lands on the call that ends the round.
 *
 * So the cooldown is not tied to the press but to the step: `stateKey` is the
 * state the button is acting on, and every change to it — a press of the
 * button, an auto-advance, a backtrack — leaves the next step greyed out for
 * a beat whether or not the wording stayed the same. The returned `start` is
 * for the press itself, which has to grey the button while the write is still
 * in flight and the state has not moved yet.
 */
export default function useAdvanceCooldown(stateKey, cooldownMs = ADVANCE_COOLDOWN_MS) {
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const timeoutIdRef = useRef(0);

  const start = useCallback(() => {
    // Restarts a cooldown already running, rather than stacking a second one.
    window.clearTimeout(timeoutIdRef.current);
    setIsCoolingDown(true);
    timeoutIdRef.current = window.setTimeout(() => {
      setIsCoolingDown(false);
    }, cooldownMs);
  }, [cooldownMs]);

  /* The key on the first render is whatever state the panel opened on, not a
     step anyone just took — opening the panel mid-round must not grey the
     button. */
  const previousStateKeyRef = useRef(stateKey);

  useEffect(() => {
    if (previousStateKeyRef.current === stateKey) {
      return;
    }

    previousStateKeyRef.current = stateKey;
    start();
  }, [stateKey, start]);

  useEffect(() => () => {
    window.clearTimeout(timeoutIdRef.current);
  }, []);

  return [isCoolingDown, start];
}
