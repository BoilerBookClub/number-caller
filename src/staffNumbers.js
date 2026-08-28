/**
 * Staff numbers, which sit before #1.
 *
 * Staff are handed a number like everybody else — they need one for the same
 * reasons an attendee does, so their ticket has an identity, a QR code and a
 * row in the roster — but it is deliberately not a place in the queue. Staff
 * are running the event; they are not standing in a group waiting to be called.
 *
 * The representation is a negative integer: -1, -2, -3, allocated from their
 * own counter on the live event. Negative rather than a separate field, because
 * *one* number per claim is what everything downstream is built on — the wheel,
 * the winner list, the QR payload, every sort — and a second identity field
 * would have to be threaded through all of it. Negative also gets three things
 * for free that would otherwise be rules to remember:
 *
 *   - they sort before #1, which is exactly where they belong;
 *   - the group call window (`number > last && number <= current`) can never
 *     reach them, so staff are never called with a group;
 *   - anything that already asked for `number > 0` excludes them by default,
 *     which is the safe direction for a raffle.
 *
 * They are shown as S1, S2 — never as "#-1", which reads as a bug.
 */

/** Whether a claim number is a staff number rather than a place in the queue. */
const isStaffNumber = (number) => Number.isFinite(Number(number)) && Number(number) < 0;

/** Whether a claim belongs to staff, from either the flag or the number. */
export const isStaffClaim = (claim) =>
  claim?.isStaff === true || isStaffNumber(claim?.number);

/**
 * The claim number as it is shown to a human: S1 for staff, #12 for everyone
 * else. Every screen that prints a number goes through here, so staff never
 * leak out as a negative anywhere.
 */
export const formatClaimNumber = (number) => {
  const parsedNumber = Number(number);

  if (!Number.isFinite(parsedNumber) || parsedNumber === 0) {
    return "";
  }

  return isStaffNumber(parsedNumber) ? `S${Math.abs(parsedNumber)}` : `#${parsedNumber}`;
};

/** The nth staff number, as it is stored. */
const buildStaffNumber = (staffIndex) => -Math.abs(Math.trunc(staffIndex));

/**
 * The numbers the server will hand the people currently waiting in the queue.
 *
 * It counts up from the event's own counters, because that is exactly what
 * allocateClaimNumber does in functions/index.js — one monotonic counter for
 * attendees, another for staff, and neither is ever wound back when a claim is
 * removed. Filling the gaps left by removals instead agreed with the server
 * right up until staff removed somebody: from then on the queue promised #5 and
 * the attendee was handed #12, and Assign Early said the wrong number out loud.
 * Recycling is deliberately not what the server does — a reused number could
 * belong to a group that has already been called.
 *
 * Staff come out negative, off their own counter, so somebody waiting in the
 * queue is shown the S-number they will actually get rather than a place in a
 * line they are not standing in.
 *
 * It remains a projection and cannot be anything else: anybody claiming between
 * now and the doors opening moves the counter along, and the server assigns in
 * join order rather than in whatever order this list happens to be sorted.
 *
 * The server is the authority. Keep this in step with allocateClaimNumber.
 */
export const projectQueueNumbers = ({
  nextClaimNumber = 1,
  nextStaffNumber = 1,
  queueEntries = [],
} = {}) => {
  const toCounter = (value) => {
    const parsedValue = Number.parseInt(value, 10);

    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1;
  };

  let claimCounter = toCounter(nextClaimNumber);
  let staffCounter = toCounter(nextStaffNumber);

  return queueEntries.map((queueEntry) => {
    if (queueEntry?.isStaff === true) {
      const projectedNumber = buildStaffNumber(staffCounter);

      staffCounter += 1;

      return { ...queueEntry, projectedNumber };
    }

    const projectedNumber = claimCounter;

    claimCounter += 1;

    return { ...queueEntry, projectedNumber };
  });
};

/** Splits a roster into its staff and its attendees, each keeping its order. */
export const partitionStaffClaims = (claims = []) => {
  const staffClaims = [];
  const attendeeClaims = [];

  claims.forEach((claim) => {
    if (isStaffClaim(claim)) {
      staffClaims.push(claim);
      return;
    }

    attendeeClaims.push(claim);
  });

  return { attendeeClaims, staffClaims };
};
