/**
 * The prize raffle: a wheel on the display, spun from the control panel.
 *
 * Deliberately separate from the item-claim lifecycle. A raffle win is not an
 * item claim — it never touches `itemsClaimedCount`, `redeemedRound` or the
 * claim history the graphs are built from — so nothing here can move the
 * event's statistics. The only thing a spin records is the winning *number*,
 * and it records that for two reasons: so the winner's phone can show a prize
 * QR code, and so a later spin in the same event can leave them out.
 *
 * Numbers rather than claim IDs, because this state rides on the live event
 * document, which is world-readable. A claim ID contains the winner's Discord
 * user ID; a number is already up on the projector.
 */

import { formatClaimNumber, isStaffClaim } from "./staffNumbers.js";

/**
 * The wheel's run-up: it grows from the middle of the display out to its
 * spinning size before a single degree of rotation happens, so the room gets a
 * moment to read the names it is about to spin past.
 *
 * The move is timed to fill this window rather than to run for a fixed length,
 * because the window is measured from the press of Spin and the display only
 * hears about it once the write has been round the network. See the wheel,
 * which compresses the move into whatever is left of it — that is what keeps
 * the growing and the turning from happening on top of each other.
 */
export const RAFFLE_LEAD_IN_MS = 1200;

/**
 * How long the wheel turns for, once it has finished moving.
 *
 * Longer than the turn itself needs, because the back half of it is the
 * wind-down: see the timing function on .raffle-wheel-spinner, which spends the
 * last second and a half of this walking the final few names under the pointer.
 * The turn is over before the spin is — that gap is the suspense, and it is the
 * reason this is a number in its own right rather than however long five turns
 * happen to take.
 *
 * It has been both longer and shorter. Eleven seconds gave the ending all the
 * room it needed and turned the rest into waiting: three seconds of unreadable
 * blur at the front, and a tail so gentle that the last two names took five
 * seconds between them. This is the same shape with the waiting taken out.
 */
export const RAFFLE_SPIN_DURATION_MS = 6500;

/**
 * When the winner lands, measured from the moment Spin was pressed.
 *
 * The one number the display, the control panel and the winner's own phone all
 * work back from, which is what keeps the confetti, the announcement and the
 * winner's prize code on the same beat.
 */
export const RAFFLE_REVEAL_AFTER_MS = RAFFLE_LEAD_IN_MS + RAFFLE_SPIN_DURATION_MS;

/*
 * Whole turns the wheel makes before settling on the winner.
 *
 * Five rather than six: the same travel packed into a shorter spin is a faster
 * spin, and the front of it was already the part nobody could read. One turn
 * less is a second less of blur without touching the ending.
 */
export const RAFFLE_SPIN_TURNS = 5;

/* Capped for the same reason finalCallTargetNumbers is: this list lives on a
   document that is rewritten on every check-in, and an unbounded list on it can
   be grown until writes start failing and the event freezes. Nobody is running
   500 spins in one evening. */
export const RAFFLE_MAX_WINNERS = 500;

/*
 * How many times over a member counts in the draw. 1 is no advantage at all,
 * which is the default — a raffle treats everybody the same until staff say
 * otherwise.
 */
export const RAFFLE_MEMBER_CHANCES_MIN = 1;
export const RAFFLE_MEMBER_CHANCES_MAX = 5;

export const normalizeRaffleMemberChances = (value) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return RAFFLE_MEMBER_CHANCES_MIN;
  }

  return Math.max(
    RAFFLE_MEMBER_CHANCES_MIN,
    Math.min(RAFFLE_MEMBER_CHANCES_MAX, parsedValue),
  );
};

export const RAFFLE_PHASE = {
  idle: "idle",
  revealed: "revealed",
  spinning: "spinning",
};

export const normalizeRaffleWinnerNumbers = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenNumbers = new Set();

  return value
    .map((entry) => Number.parseInt(entry, 10))
    /* Non-zero rather than positive: 0 is "no number", but a staff number is
       negative on purpose (see src/staffNumbers.js), and with staff allowed in
       the draw one of them can be the name on the projector. */
    .filter((entry) => Number.isFinite(entry) && entry !== 0)
    .filter((entry) => {
      if (seenNumbers.has(entry)) {
        return false;
      }

      seenNumbers.add(entry);

      return true;
    })
    .slice(-RAFFLE_MAX_WINNERS);
};

/**
 * Who is actually in the draw.
 *
 * Both screens compute this from the same roster and the same flags, because
 * the control panel picks the winner from it and the display draws the wheel
 * from it — a disagreement would land the pointer on the wrong name.
 */
export const getRaffleEligibleClaims = ({
  allowRepeatWinners = false,
  allowStaff = false,
  claims = [],
  membersOnly = false,
  requireOptIn = false,
  winnerNumbers = [],
}) => {
  const previousWinners = new Set(normalizeRaffleWinnerNumbers(winnerNumbers));

  return claims
    .filter((claim) => Number.isFinite(claim?.number) && claim.number !== 0)
    /* Staff are off the wheel unless staff have deliberately put themselves on
       it. Defaulted off here as well as in the event state, so a caller that
       forgets to pass the flag leaves them out rather than quietly drawing the
       person handing out the prizes. */
    .filter((claim) => allowStaff || !isStaffClaim(claim))
    .filter((claim) => !membersOnly || claim.isMember === true)
    // Opt-in: only people who pressed Join on their own ticket are drawn. The
    // stamp is written by the server onto their claim, so it cannot be
    // self-declared and staff can see who is actually in.
    .filter((claim) => !requireOptIn || Number.isFinite(claim?.raffleJoinedAtMs))
    .filter((claim) => allowRepeatWinners || !previousWinners.has(claim.number))
    .sort((leftClaim, rightClaim) => leftClaim.number - rightClaim.number);
};

/**
 * Picks a winner, respecting each entry's `weight`.
 *
 * Entries without a weight count once, so an unweighted list behaves exactly as
 * a uniform draw. Callers hand this the same segments the wheel is drawn from,
 * which is what guarantees the odds on screen are the odds being played: a
 * member with three chances owns three times the arc *and* three times the
 * probability, from one shared calculation.
 *
 * `randomValue` is injected so the draw is testable; callers pass Math.random().
 */
export const pickRaffleWinner = (eligibleClaims, randomValue = Math.random()) => {
  if (!Array.isArray(eligibleClaims) || eligibleClaims.length === 0) {
    return null;
  }

  const safeRandomValue = Number.isFinite(randomValue)
    ? Math.min(0.999999, Math.max(0, randomValue))
    : 0;
  const weights = eligibleClaims.map((claim) =>
    Number.isFinite(claim?.weight) && claim.weight > 0 ? claim.weight : 1,
  );
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let target = safeRandomValue * totalWeight;

  for (let index = 0; index < eligibleClaims.length; index += 1) {
    target -= weights[index];

    if (target < 0) {
      return eligibleClaims[index];
    }
  }

  return eligibleClaims[eligibleClaims.length - 1] ?? null;
};

/** What one entry is worth in the draw. */
export const getRaffleEntryWeight = (claim, memberChances) =>
  claim?.isMember === true ? normalizeRaffleMemberChances(memberChances) : 1;

/**
 * The wheel, as slices with real angles.
 *
 * Extra chances are drawn as a wider slice rather than as repeated entries on
 * the wheel. Duplicates would be the easy way to do it, but they make the wheel
 * lie about how many people are in the draw, and they give one person several
 * places the pointer could stop — so "who won" stops being a single slice.
 */
export const buildRaffleSegments = ({ claims = [], memberChances = 1 } = {}) => {
  const weights = claims.map((claim) => getRaffleEntryWeight(claim, memberChances));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || 1;
  let cursorAngle = 0;

  return claims.map((claim, index) => {
    const sweepAngle = (360 * weights[index]) / totalWeight;
    const startAngle = cursorAngle;

    cursorAngle += sweepAngle;

    return {
      displayName: claim.displayName,
      endAngle: startAngle + sweepAngle,
      isMember: claim.isMember === true,
      midAngle: startAngle + sweepAngle / 2,
      number: claim.number,
      startAngle,
      sweepAngle,
      weight: weights[index],
    };
  });
};

/**
 * How many slices the wheel will actually draw.
 *
 * Above this the wheel stops being a picture of the draw and becomes a picture
 * of a draw. At three hundred entries each slice is 1.2 degrees wide and the
 * label is floored at its 4.5px minimum inside a 400-unit viewBox — six hundred
 * SVG nodes producing a grey smear that nobody past the second row can read,
 * for the single most theatrical moment of the evening.
 *
 * A hundred and fifty is where the geometry runs out rather than where it is
 * comfortable. The labels sit on a radius of 180 in that viewBox, so there are
 * about seven and a half units of arc per slice for type already floored at
 * 4.5 — legible, with a little under its own height in clear space either
 * side. Past here the names start touching.
 */
const RAFFLE_MAX_DRAWN_SEGMENTS = 150;

/**
 * The slices to draw, which is not always the same as the entries in the draw.
 *
 * Below the cap this hands back exactly what it was given, and the wheel keeps
 * its original promise: slice width is entry weight, so a member with three
 * chances owns three times the arc and three times the probability, and what
 * the room can see is what the draw is doing.
 *
 * Above the cap that promise cannot be kept by any wheel — the arcs are thinner
 * than the lines drawing them — so it is traded rather than pretended at. What
 * comes back is an evenly spaced sample of the pool with the winner guaranteed
 * to be in it, laid out in equal slices. The draw itself is untouched: the
 * winner is still picked from the full weighted pool before the wheel moves
 * (see pickRaffleWinner, which the control panel calls on the complete list),
 * so the odds are unchanged and only the picture is a summary.
 *
 * The count stays honest either way, because the caption beside the wheel says
 * how many people are actually in the draw rather than counting slices.
 *
 * Order is preserved so the wheel still reads low numbers to high, and the
 * sample is taken by fixed stride rather than at random so every screen showing
 * the same spin draws the same wheel.
 */
export const buildRaffleDisplaySegments = ({
  maxSegments = RAFFLE_MAX_DRAWN_SEGMENTS,
  segments = [],
  winnerNumber = 0,
} = {}) => {
  if (!Array.isArray(segments) || segments.length <= maxSegments) {
    return segments;
  }

  const winnerIndex = segments.findIndex((segment) => segment?.number === winnerNumber);
  const stride = segments.length / maxSegments;
  const sampledIndices = new Set();

  for (let slot = 0; slot < maxSegments; slot += 1) {
    sampledIndices.add(Math.min(segments.length - 1, Math.floor(slot * stride)));
  }

  /* The winner has to be on the wheel the wheel is turning towards. Swapping
     rather than adding keeps the slice count at the cap, and the neighbour it
     replaces is the sampled index closest to them — so the wheel's spread does
     not visibly bunch up around the winner. */
  if (winnerIndex >= 0 && !sampledIndices.has(winnerIndex)) {
    const nearest = [...sampledIndices].reduce((closest, index) =>
      Math.abs(index - winnerIndex) < Math.abs(closest - winnerIndex) ? index : closest,
    );

    sampledIndices.delete(nearest);
    sampledIndices.add(winnerIndex);
  }

  /* Equal slices, because a sample cannot carry weights honestly: the entries
     it left out had weight too, and widening the survivors in proportion to
     their own would misreport the odds rather than summarise them. */
  return buildRaffleSegments({
    claims: [...sampledIndices]
      .sort((left, right) => left - right)
      .map((index) => segments[index]),
    memberChances: 1,
  });
};

/**
 * Where the wheel is in a spin, from state alone.
 *
 * The winner test is "has a number at all", not "has a positive one". 0 is the
 * absence of a winner — it is what clearRaffleWinner writes — but a staff number
 * is negative on purpose (see src/staffNumbers.js), and staff let into the draw
 * can win like anybody else. Read as positive, a staff win left every screen in
 * `idle`: the wheel never turned, nothing was ever announced, and the spin that
 * had already been written to the event was invisible to the room.
 */
export const getRaffleSpinPhase = ({
  nowMs = Date.now(),
  spinCount = 0,
  spinStartedAtMs = null,
  winnerNumber = 0,
} = {}) => {
  if (!(spinCount > 0) || !Number.isFinite(winnerNumber) || winnerNumber === 0) {
    return RAFFLE_PHASE.idle;
  }

  if (!Number.isFinite(spinStartedAtMs)) {
    return RAFFLE_PHASE.revealed;
  }

  return nowMs - spinStartedAtMs < RAFFLE_REVEAL_AFTER_MS
    ? RAFFLE_PHASE.spinning
    : RAFFLE_PHASE.revealed;
};

/**
 * How much of a spin a screen still has to animate, in milliseconds.
 *
 * Both stretches are counted back from the moment Spin was pressed rather than
 * given fixed lengths, so a screen that opens part-way through a spin gets
 * whatever is left of each and still lands on the winner at the same instant
 * as every other screen in the room.
 *
 * A spin with no start time recorded has none of either. That is the same
 * reading getRaffleSpinPhase takes of a missing timestamp, and it is not only
 * the mid-spin case it decides: clearing the winner nulls the start time but
 * deliberately leaves the spin count standing, so that a later spin still
 * reads as new. A screen opening onto that cleared wheel counts spins from
 * zero and so finds the standing count new to it, and this is the only thing
 * left saying the spin it belongs to finished long ago. Counted as no time
 * elapsed, every refresh looked like Spin had been pressed on the frame the
 * page loaded, and the wheel turned five times over on a raffle with nothing
 * on it to win.
 */
export const getRaffleSpinTiming = ({ nowMs = Date.now(), spinStartedAtMs = null } = {}) => {
  const elapsedMs = Number.isFinite(spinStartedAtMs)
    ? nowMs - spinStartedAtMs
    : RAFFLE_REVEAL_AFTER_MS;

  return {
    leadInMs: Math.max(0, RAFFLE_LEAD_IN_MS - elapsedMs),
    spinMs: Math.min(
      RAFFLE_SPIN_DURATION_MS,
      Math.max(0, RAFFLE_REVEAL_AFTER_MS - Math.max(elapsedMs, RAFFLE_LEAD_IN_MS)),
    ),
  };
};

/**
 * Where the pointer sits, in degrees clockwise from twelve o'clock.
 *
 * Three o'clock, because the wheel spins parked off the left edge of the
 * display with only its right-hand sliver showing — so the rim the room can
 * actually see is the one facing right. It also happens to be the angle at
 * which the radial slice labels come out horizontal, which is why a name under
 * the pointer is readable from the back of the room.
 */
export const RAFFLE_POINTER_ANGLE = 90;

/**
 * How much of the winning slice the pointer is allowed to land in, as a
 * fraction of its width, centred on the middle.
 *
 * Short of 1 so the pointer never comes to rest on a seam, where which of two
 * names it is picking out would be a matter of opinion — at 0.72 there is
 * always a seventh of the slice to spare on either side.
 */
export const RAFFLE_LANDING_SPREAD = 0.72;

/**
 * Whereabouts in their slice this winner is landed on, in [0, 1).
 *
 * Every screen works this out for itself from state they all hold, so they all
 * stop in the same place — the same reason the winner is drawn on the control
 * panel and merely animated here. Not Math.random, and not the clock: a second
 * projector opening mid-spin would then be turning towards a slightly
 * different resting angle than the first, and the two would disagree by a few
 * degrees for the rest of the night.
 *
 * The spin count is in the mix as well as the number, so somebody who wins
 * twice in an evening is not landed on identically both times.
 */
export const getRaffleLandingFraction = ({ spinCount = 0, winnerNumber = 0 } = {}) => {
  const safeSpinCount = Number.isFinite(spinCount) ? Math.trunc(spinCount) : 0;
  const safeWinnerNumber = Number.isFinite(winnerNumber) ? Math.trunc(winnerNumber) : 0;
  let mixed =
    (Math.imul(safeSpinCount + 1, 0x27d4eb2d) ^ Math.imul(safeWinnerNumber + 1, 0x165667b1)) >>> 0;

  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
};

/**
 * How far to turn the wheel so the winner's slice sits under the pointer,
 * given segments from buildRaffleSegments laid out clockwise from twelve
 * o'clock.
 *
 * `landingFraction` says where across that slice to stop, 0 being its leading
 * edge and 1 its trailing one. It defaults to dead centre, which is where the
 * wheel used to stop every single time — and it showed: the name is drawn
 * along the middle of its slice, so a wheel that always stopped on the middle
 * always presented the winning name squared up under the pointer, looking
 * rather more arranged than drawn. See getRaffleLandingFraction.
 *
 * Returns 0 when the winner is not on the wheel, which happens when the roster
 * moved between the spin being written and this screen reading it. The wheel
 * still stops somewhere sane rather than throwing.
 */
export const getRaffleWinnerRotation = (
  segments,
  winnerNumber,
  { landingFraction = 0.5, pointerAngle = RAFFLE_POINTER_ANGLE } = {},
) => {
  const winnerSegment = Array.isArray(segments)
    ? segments.find((segment) => segment?.number === winnerNumber)
    : null;

  if (!winnerSegment || !Number.isFinite(winnerSegment.midAngle)) {
    return 0;
  }

  const sweepAngle = Number.isFinite(winnerSegment.sweepAngle) ? winnerSegment.sweepAngle : 0;
  const safeFraction = Number.isFinite(landingFraction)
    ? Math.min(1, Math.max(0, landingFraction))
    : 0.5;
  // Turning the wheel by the difference brings the chosen point of the slice
  // round to the pointer. Slices are no longer all the same width, so both the
  // midpoint and the offset off it have to come from the slice itself rather
  // than from its index.
  const landingAngle =
    winnerSegment.midAngle + (safeFraction - 0.5) * RAFFLE_LANDING_SPREAD * sweepAngle;

  return (((pointerAngle - landingAngle) % 360) + 360) % 360;
};

/**
 * The next total rotation for a wheel currently sitting at `currentRotation`.
 * Always forward, and always at least RAFFLE_SPIN_TURNS whole turns, so a
 * second spin never crawls a few degrees or visibly rewinds.
 */
export const getRaffleNextRotation = (currentRotation, winnerRotation) => {
  const safeCurrent = Number.isFinite(currentRotation) ? currentRotation : 0;
  const safeWinner = Number.isFinite(winnerRotation) ? winnerRotation : 0;
  let nextRotation = Math.ceil(safeCurrent / 360) * 360 + RAFFLE_SPIN_TURNS * 360 + safeWinner;

  while (nextRotation <= safeCurrent) {
    nextRotation += 360;
  }

  return nextRotation;
};

/** The wheel's label for one attendee. Long names are cut, never the number. */
export const buildRaffleSegmentLabel = ({ displayName, number }, maxNameLength = 14) => {
  const safeName = typeof displayName === "string" ? displayName.trim() : "";
  const trimmedName =
    safeName.length > maxNameLength ? `${safeName.slice(0, maxNameLength - 1)}…` : safeName;

  /* Without the digits, so the slice reads as "S3 · Ada" for staff rather than
     as the negative the number is actually stored as. */
  const numberLabel = formatClaimNumber(number).replace(/^#/, "");

  return trimmedName ? `${numberLabel} · ${trimmedName}` : numberLabel;
};
