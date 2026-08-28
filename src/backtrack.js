/**
 * Rewinding the queue.
 *
 * The forward path a round takes is: pending (nothing called) -> group 1 ->
 * group 2 -> ... -> last group -> final call -> the next round, pending again.
 * This walks that same path backwards, one step per press, so staff can undo a
 * group called too early without closing and restarting the event.
 *
 * It is deliberately a pure function of the queue state: the control panel
 * needs to describe the step in a confirmation dialog before it happens, and
 * the same description has to be the thing that is actually written.
 *
 * Nothing here touches claims. A pickup that has already happened stays
 * recorded, and `redeemedRound` keeps that attendee out of the group when it
 * comes round again — see hasClaimedInRound below, which reads
 * "claimed in this round or a later one" precisely so a rewind cannot hand
 * somebody a second item.
 */

const toNonNegativeInteger = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
};

/**
 * Has this attendee already had their item for this pass of the queue?
 *
 * "In this round or a later one" rather than "in this round" is what makes the
 * back button safe: a rewind can put the queue back into a round somebody has
 * already claimed past, and the pickup they have already had has to keep them
 * out of the group when it is called a second time. Rounds only ever move
 * forward otherwise, so everywhere else this is an equality check.
 *
 * The server holds the same test in functions/index.js — it is the authority,
 * and this copy only decides what the screens show. Keep the two in step.
 */
export const hasClaimedInRound = (claim, round) => {
  const redeemedRound = toNonNegativeInteger(claim?.redeemedRound);

  return redeemedRound > 0 && redeemedRound >= toNonNegativeInteger(round);
};

/** The step numbers a rewind can land on, for the label and for the caller. */
export const BACKTRACK_STEP = {
  finalCall: "final-call",
  group: "group",
  pendingRound: "pending-round",
  previousRoundFinalCall: "previous-round-final-call",
};

/**
 * Where the last group of a round ended.
 *
 * Only needed when reopening a round that has already been left behind: the
 * event document keeps one queue position, so the position the previous round
 * finished on has to be rebuilt from the roster. Groups are called in whole
 * multiples of the group size, so the last one ends at the first multiple that
 * covers everybody.
 *
 * "Everybody" is the highest number issued, not how many people are holding
 * one. Numbers are never recycled, so any removal from the roster leaves the
 * two different, and a rewind that stopped at the count would reopen a round
 * that never reaches its last few attendees. Callers that have not been taught
 * the difference yet fall back to the count, which is what it always was.
 */
const getLastGroupEnd = ({ groupSize, highestClaimNumber, totalPeopleWithNumbers }) => {
  if (groupSize <= 0) {
    return 0;
  }

  const lastNumber = Math.max(
    Number.isFinite(highestClaimNumber) ? highestClaimNumber : 0,
    totalPeopleWithNumbers,
  );

  if (lastNumber <= 0) {
    return groupSize;
  }

  return Math.ceil(lastNumber / groupSize) * groupSize;
};

const buildGroupLabel = (last, current) => `Group ${last + 1}-${current}`;

/**
 * The one step back from the queue state given, or null when there is nothing
 * behind it — round 1 with nothing called yet is the start of the event.
 *
 * The returned `current`, `last`, `round` and `finalCall` are the queue fields
 * to write; `label` names the step for the confirmation dialog.
 */
export const getBacktrackStep = ({
  current = 0,
  finalCall = false,
  groupSize = 1,
  highestClaimNumber = 0,
  last = 0,
  round = 1,
  totalPeopleWithNumbers = 0,
} = {}) => {
  const safeGroupSize = Number.isFinite(groupSize) && groupSize > 0 ? Math.trunc(groupSize) : 1;
  const safeCurrent = Number.isFinite(current) && current > 0 ? Math.trunc(current) : 0;
  const safeLast = Number.isFinite(last) && last > 0 ? Math.trunc(last) : 0;
  const safeRound = Number.isFinite(round) && round > 0 ? Math.trunc(round) : 1;

  /* Final call sits on top of the last group without moving the queue, so
     stepping out of it only has to put the group back on the display. */
  if (finalCall) {
    return {
      current: safeCurrent,
      finalCall: false,
      kind: BACKTRACK_STEP.group,
      label: safeCurrent > 0 ? buildGroupLabel(safeLast, safeCurrent) : `Round ${safeRound}`,
      last: safeLast,
      round: safeRound,
    };
  }

  if (safeCurrent > 0) {
    /* Mid-round: `last` is where the previous group ended, which is exactly
       what `current` was one press ago. Reading it rather than subtracting a
       group size keeps the rewind honest when the size was changed mid-round. */
    if (safeLast > 0) {
      const previousLast = Math.max(0, safeLast - safeGroupSize);

      return {
        current: safeLast,
        finalCall: false,
        kind: BACKTRACK_STEP.group,
        label: buildGroupLabel(previousLast, safeLast),
        last: previousLast,
        round: safeRound,
      };
    }

    // The first group of the round: behind it the round had not started.
    return {
      current: 0,
      finalCall: false,
      kind: BACKTRACK_STEP.pendingRound,
      label: `Round ${safeRound}, before its first group`,
      last: 0,
      round: safeRound,
    };
  }

  // Nothing called. Behind a pending round is the previous round's final call.
  if (safeRound <= 1) {
    return null;
  }

  const previousRound = safeRound - 1;
  const lastGroupEnd = getLastGroupEnd({
    groupSize: safeGroupSize,
    highestClaimNumber,
    totalPeopleWithNumbers,
  });

  return {
    current: lastGroupEnd,
    finalCall: true,
    kind: BACKTRACK_STEP.previousRoundFinalCall,
    label: `Final Call for round ${previousRound}`,
    last: Math.max(0, lastGroupEnd - safeGroupSize),
    round: previousRound,
  };
};
