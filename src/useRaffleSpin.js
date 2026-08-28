import { useEffect, useState } from "react";

import { getRaffleSpinPhase, RAFFLE_PHASE, RAFFLE_REVEAL_AFTER_MS } from "./raffle";

/**
 * Where the wheel is in its spin, to the millisecond.
 *
 * Deliberately not derived from App's one-second clock tick: the reveal is a
 * single moment shared by the projector, the control panel and the winner's
 * phone, and a burst of confetti arriving up to a second after the wheel has
 * visibly stopped reads as a bug. The timeout below fires on the frame the
 * spin actually ends.
 *
 * A screen that opens mid-spin gets the remaining time rather than a fresh
 * one, and a screen that opens after it lands goes straight to `revealed`.
 */
export default function useRaffleSpin({ spinCount, spinStartedAtMs, winnerNumber }) {
  const [phase, setPhase] = useState(() =>
    getRaffleSpinPhase({ spinCount, spinStartedAtMs, winnerNumber }),
  );

  useEffect(() => {
    const nextPhase = getRaffleSpinPhase({ spinCount, spinStartedAtMs, winnerNumber });

    setPhase(nextPhase);

    if (nextPhase !== RAFFLE_PHASE.spinning) {
      return undefined;
    }

    const remainingMs = Math.max(0, spinStartedAtMs + RAFFLE_REVEAL_AFTER_MS - Date.now());
    const timeoutId = window.setTimeout(() => {
      setPhase(RAFFLE_PHASE.revealed);
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [spinCount, spinStartedAtMs, winnerNumber]);

  return phase;
}
