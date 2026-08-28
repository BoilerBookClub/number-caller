import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEMO_PARTICIPANT_TYPE,
  getDemoJoinDelayMs,
  getDemoPickupDelayMs,
  getDemoRaffleCollectDelayMs,
  getDemoRaffleJoinDelayMs,
  planDemoParticipants,
  shouldDemoParticipantJoinRaffle,
  shouldDemoParticipantPickUp,
  shouldDemoWinnerCollectPrize,
  splitIntoBatches,
} from "./demoEvent";
import { hasClaimedInRound } from "./backtrack";

/**
 * Drives a demo event from the control panel.
 *
 * Fake attendees have no phone, so nothing would otherwise queue them, claim
 * their number when the doors open, or show a QR code to staff when their group
 * is called. This hook does those three things on their behalf, against the same
 * callables a real attendee's browser would reach for.
 *
 * It only runs where the event is being managed — the control panel, with staff
 * access — so the display screen never starts a second copy. Two staff tabs
 * *will* both drive, which is why every write it makes is idempotent: seeding is
 * keyed by participant index, and a second pickup in the same round comes back
 * as already-redeemed rather than as a second item.
 */
export default function useDemoEvent({
  claims,
  demoConfig,
  enabled,
  eventId,
  isEventStarted,
  isPaused,
  liveState,
  onAssignQueued,
  onJoinRaffle,
  onRedeem,
  onRedeemRafflePrize,
  onSeed,
}) {
  const [demoStatus, setDemoStatus] = useState("");
  /* Which participant indices have been handed to the server. Held in a ref, not
     state, because the drip loop reads it between renders and a stale copy would
     seed the same person twice. */
  const seededIndicesRef = useRef(new Set());
  const seededEventIdRef = useRef(null);
  const hasSeededQueueRef = useRef(false);
  const hasAssignedQueueRef = useRef(false);
  /* One entry per (claim, round, phase) already decided, so a participant is not
     re-rolled every time the roster subscription ticks. */
  const decidedPickupsRef = useRef(new Set());
  const pickupTimeoutsRef = useRef(new Map());
  const isPausedRef = useRef(isPaused);

  isPausedRef.current = isPaused;

  /* The callable takes these four fields; the rest of a planned participant is
     derived and would only be re-derived server-side anyway. */
  const toSeedPayload = ({ displayName, index, isMember, queued }) => ({
    displayName,
    index,
    isMember,
    queued,
  });

  /*
   * Cancels pickups that were scheduled but have not happened yet.
   *
   * Their decisions are dropped along with their timers. A cancelled pickup is
   * one that never took place, so leaving it on the decided list would retire
   * that participant for the rest of the round: pausing to look at a group and
   * then resuming used to mean nobody in it ever collected anything.
   */
  const clearPendingPickups = useCallback(() => {
    pickupTimeoutsRef.current.forEach((timeoutId, decisionKey) => {
      window.clearTimeout(timeoutId);
      decidedPickupsRef.current.delete(decisionKey);
    });
    pickupTimeoutsRef.current.clear();
  }, []);

  // A new event (or leaving demo mode) starts from nothing: the previous event's
  // indices and pickup decisions say nothing about this one.
  useEffect(() => {
    if (seededEventIdRef.current === eventId) {
      return;
    }

    seededEventIdRef.current = eventId;
    seededIndicesRef.current = new Set();
    decidedPickupsRef.current = new Set();
    hasSeededQueueRef.current = false;
    hasAssignedQueueRef.current = false;
    clearPendingPickups();
    setDemoStatus("");
  }, [clearPendingPickups, eventId]);

  useEffect(() => () => clearPendingPickups(), [clearPendingPickups]);

  /*
   * The early crowd.
   *
   * Everyone due before the doors open goes in at once, because they are meant
   * to already be waiting when staff arrive. The server decides whether that
   * means a queue entry or a number outright — a demo whose start time has
   * already passed has no queue for them to wait in.
   */
  useEffect(() => {
    if (!enabled || !eventId || isPaused || hasSeededQueueRef.current) {
      return undefined;
    }

    const queuedParticipants = planDemoParticipants({ config: demoConfig, eventId }).filter(
      ({ index, queued }) => queued && !seededIndicesRef.current.has(index),
    );

    if (!queuedParticipants.length) {
      hasSeededQueueRef.current = true;
      return undefined;
    }

    let isDisposed = false;
    hasSeededQueueRef.current = true;

    const seedQueue = async () => {
      try {
        for (const batch of splitIntoBatches(queuedParticipants)) {
          if (isDisposed || isPausedRef.current) {
            hasSeededQueueRef.current = false;
            return;
          }

          await onSeed({ eventId, participants: batch.map(toSeedPayload) });
          batch.forEach(({ index }) => seededIndicesRef.current.add(index));
        }

        if (!isDisposed) {
          setDemoStatus("");
        }
      } catch (error) {
        hasSeededQueueRef.current = false;

        if (!isDisposed) {
          setDemoStatus(error?.message || "Unable to add demo participants.");
        }
      }
    };

    void seedQueue();

    return () => {
      isDisposed = true;
    };
  }, [demoConfig, enabled, eventId, isPaused, onSeed]);

  /*
   * The doors opening.
   *
   * A real queued attendee's own browser claims their number the moment the
   * start time passes. Nothing server-side sweeps non-members, so the demo has
   * to ask for its queue to be converted.
   */
  useEffect(() => {
    if (!enabled || !eventId || !isEventStarted || isPaused || hasAssignedQueueRef.current) {
      return;
    }

    hasAssignedQueueRef.current = true;

    void onAssignQueued({ eventId }).catch((error) => {
      hasAssignedQueueRef.current = false;
      setDemoStatus(error?.message || "Unable to admit the demo queue.");
    });
  }, [enabled, eventId, isEventStarted, isPaused, onAssignQueued]);

  /*
   * Latecomers.
   *
   * A self-scheduling timer rather than anything driven by render, so the pace
   * is the pace regardless of how often the control panel redraws. One person
   * per tick, on a random gap, so the attendee counter and the joined graph fill
   * in over the demo instead of jumping to their final value.
   */
  useEffect(() => {
    if (!enabled || !eventId || !isEventStarted || isPaused) {
      return undefined;
    }

    const plan = planDemoParticipants({ config: demoConfig, eventId });
    let isDisposed = false;
    let timeoutId = null;

    /* The gap to the next arrival, given how far through the tail we are. See
       getDemoJoinDelayMs: the rate thins out as the room fills, and the gaps
       themselves are exponential so people cluster rather than file in. */
    const nextArrivalDelayMs = () => {
      const totalArrivals = plan.filter(({ queued }) => !queued).length || plan.length;
      const arrivedCount = plan.filter(
        ({ index, queued }) => !queued && seededIndicesRef.current.has(index),
      ).length;

      return getDemoJoinDelayMs(Math.random(), { arrivedCount, totalArrivals });
    };

    const admitNextParticipant = async () => {
      if (isDisposed) {
        return;
      }

      const nextParticipant = plan.find(({ index }) => !seededIndicesRef.current.has(index));

      // Everyone is in. The timer stops until the settings change.
      if (!nextParticipant) {
        return;
      }

      try {
        await onSeed({ eventId, participants: [toSeedPayload(nextParticipant)] });
        seededIndicesRef.current.add(nextParticipant.index);

        if (!isDisposed) {
          setDemoStatus("");
        }
      } catch (error) {
        if (!isDisposed) {
          setDemoStatus(error?.message || "Unable to add demo participants.");
        }
      }

      if (!isDisposed) {
        timeoutId = window.setTimeout(admitNextParticipant, nextArrivalDelayMs());
      }
    };

    timeoutId = window.setTimeout(admitNextParticipant, nextArrivalDelayMs());

    return () => {
      isDisposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [demoConfig, enabled, eventId, isEventStarted, isPaused, onSeed]);

  /*
   * Item pickups.
   *
   * Rolled once per participant per round the moment their group goes up, then
   * carried out after a short random delay — so a called group clears over a few
   * seconds the way a real one does, and the ones who lose the roll stay in the
   * backlog until final call gives them another chance.
   */
  useEffect(() => {
    if (!enabled || !eventId || isPaused) {
      return undefined;
    }

    const { current, finalCall, finalCallTargetNumbers, last, round } = liveState;
    /* Numbers, not claim ids — see src/eventState.js for why the list on the
       event document holds one and not the other. */
    const finalCallTargets = new Set(finalCallTargetNumbers ?? []);

    claims.forEach((claim) => {
      if (claim.participantType !== DEMO_PARTICIPANT_TYPE || hasClaimedInRound(claim, round)) {
        return;
      }

      const isUp = finalCall
        ? finalCallTargets.has(claim.number)
        : current > 0 && claim.number > last && claim.number <= current;

      if (!isUp) {
        return;
      }

      const decisionKey = `${claim.claimId}:${round}:${finalCall ? "final" : "group"}`;

      if (decidedPickupsRef.current.has(decisionKey)) {
        return;
      }

      decidedPickupsRef.current.add(decisionKey);

      if (
        !shouldDemoParticipantPickUp({
          isFinalCall: finalCall,
          pickupChancePercent: demoConfig.pickupChancePercent,
          randomValue: Math.random(),
        })
      ) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        pickupTimeoutsRef.current.delete(decisionKey);

        if (isPausedRef.current) {
          return;
        }

        void onRedeem({ claimId: claim.claimId, eventId }).catch((error) => {
          // Losing one pickup is not worth interrupting the demo for; the most
          // likely cause is the group moving on between the roll and the write.
          console.warn("Demo pickup failed", error?.message || error);
        });
      }, getDemoPickupDelayMs(Math.random()));

      pickupTimeoutsRef.current.set(decisionKey, timeoutId);
    });

    return undefined;
  }, [claims, demoConfig.pickupChancePercent, enabled, eventId, isPaused, liveState, onRedeem]);

  /*
   * Putting themselves forward for the raffle.
   *
   * Only when staff have asked people to opt in, which is the setting that puts
   * the Join button on a real attendee's ticket. Not everybody bothers — see
   * DEMO_RAFFLE_OPT_IN_PERCENT — because a wheel that always holds the entire
   * room never shows what the opt-in setting is for.
   *
   * Rolled once per participant per event and spread over a couple of minutes,
   * so the entry count climbs while the wheel is up rather than arriving whole.
   */
  useEffect(() => {
    if (!enabled || !eventId || isPaused || !onJoinRaffle) {
      return undefined;
    }

    if (!liveState.raffleOpen || !liveState.raffleRequireOptIn) {
      return undefined;
    }

    claims.forEach((claim) => {
      if (
        claim.participantType !== DEMO_PARTICIPANT_TYPE ||
        Number.isFinite(claim.raffleJoinedAtMs)
      ) {
        return;
      }

      const decisionKey = `raffle-join:${claim.claimId}`;

      if (decidedPickupsRef.current.has(decisionKey)) {
        return;
      }

      decidedPickupsRef.current.add(decisionKey);

      if (!shouldDemoParticipantJoinRaffle(Math.random())) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        pickupTimeoutsRef.current.delete(decisionKey);

        if (isPausedRef.current) {
          return;
        }

        void onJoinRaffle({ claimId: claim.claimId, eventId }).catch((error) => {
          console.warn("Demo raffle join failed", error?.message || error);
        });
      }, getDemoRaffleJoinDelayMs(Math.random()));

      pickupTimeoutsRef.current.set(decisionKey, timeoutId);
    });

    return undefined;
  }, [
    claims,
    enabled,
    eventId,
    isPaused,
    liveState.raffleOpen,
    liveState.raffleRequireOptIn,
    onJoinRaffle,
  ]);

  /*
   * Coming up to collect a prize.
   *
   * A win is announced on the display; the walk to the prize table is a
   * separate, slower thing, and some winners never make it — which is exactly
   * the case the collected/uncollected column in the winner list exists to show
   * staff, and it would always read "all collected" if every fake winner turned
   * up.
   *
   * This goes through the same scan path a real prize handover does, using the
   * demo claim's own QR token, so it records nothing a real one would not.
   */
  useEffect(() => {
    if (!enabled || !eventId || isPaused || !onRedeemRafflePrize) {
      return undefined;
    }

    const winnerNumbers = new Set(liveState.raffleWinnerNumbers ?? []);

    if (winnerNumbers.size === 0) {
      return undefined;
    }

    claims.forEach((claim) => {
      if (
        claim.participantType !== DEMO_PARTICIPANT_TYPE ||
        !winnerNumbers.has(claim.number) ||
        Number.isFinite(claim.raffleClaimedAtMs) ||
        !claim.qrToken
      ) {
        return;
      }

      const decisionKey = `raffle-collect:${claim.claimId}`;

      if (decidedPickupsRef.current.has(decisionKey)) {
        return;
      }

      decidedPickupsRef.current.add(decisionKey);

      if (!shouldDemoWinnerCollectPrize(Math.random())) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        pickupTimeoutsRef.current.delete(decisionKey);

        if (isPausedRef.current) {
          return;
        }

        void onRedeemRafflePrize({
          claimId: claim.claimId,
          eventId,
          qrToken: claim.qrToken,
        }).catch((error) => {
          console.warn("Demo raffle prize collection failed", error?.message || error);
        });
      }, getDemoRaffleCollectDelayMs(Math.random()));

      pickupTimeoutsRef.current.set(decisionKey, timeoutId);
    });

    return undefined;
  }, [
    claims,
    enabled,
    eventId,
    isPaused,
    liveState.raffleWinnerNumbers,
    onRedeemRafflePrize,
  ]);

  // Pausing stops pickups that were already scheduled, not only new rolls.
  useEffect(() => {
    if (isPaused) {
      clearPendingPickups();
    }
  }, [clearPendingPickups, isPaused]);

  return { demoStatus };
}
