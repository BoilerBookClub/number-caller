import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildRaffleDisplaySegments,
  buildRaffleSegmentLabel,
  getRaffleLandingFraction,
  getRaffleNextRotation,
  getRaffleSpinTiming,
  getRaffleWinnerRotation,
  RAFFLE_PHASE,
} from "../raffle";

const WHEEL_VIEWBOX_SIZE = 400;
const WHEEL_CENTER = WHEEL_VIEWBOX_SIZE / 2;
const WHEEL_RADIUS = 192;
/* The disc at the middle, as a radius in viewBox units. Must agree with the
   width on .raffle-wheel-hub in App.css, which is what actually draws it. */
const WHEEL_HUB_RADIUS = 17;
/* How far in from the rim a label finishes. The text is anchored at its far
   end and grows back towards the hub, so this is the only thing holding it off
   the wheel's outer stroke. */
const WHEEL_LABEL_RIM_INSET = 12;
/* How much of the wheel the display actually shows once it is parked off the
   left edge. The labels are sized against this rather than the full radius, so
   a name cannot run off into the part nobody can see. Must agree with
   --raffle-wheel-shift in App.css, which is what decides how much shows. */
const WHEEL_VISIBLE_FRACTION = 0.4;

/* Carnival stripes, in the ink and paper the rest of the app is drawn in. Six
   entries rather than four so a wheel whose slice count is a multiple of four
   does not end up with two same-coloured slices meeting at twelve o'clock. */
const WHEEL_SEGMENT_FILLS = [
  "#ffd166",
  "#f78c6b",
  "#8fd694",
  "#7fbfe8",
  "#c9a0dc",
  "#ffe9a8",
];

/** Polar to cartesian, with 0° at twelve o'clock and angles running clockwise. */
const pointOnWheel = (angleDegrees, radius) => {
  const angleRadians = (angleDegrees * Math.PI) / 180;

  return {
    x: WHEEL_CENTER + radius * Math.sin(angleRadians),
    y: WHEEL_CENTER - radius * Math.cos(angleRadians),
  };
};

const buildSegmentPath = (startAngle, endAngle) => {
  const start = pointOnWheel(startAngle, WHEEL_RADIUS);
  const end = pointOnWheel(endAngle, WHEEL_RADIUS);
  const isLargeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
    `L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 ${isLargeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    "Z",
  ].join(" ");
};

/**
 * The prize wheel.
 *
 * It draws the eligible attendees as slices and turns so that the winning
 * slice finishes under the pointer. The winner is decided before the spin
 * starts and written to the event, so this is pure animation — every screen
 * showing the wheel turns to the same name, and one that opens halfway through
 * picks the spin up where it is rather than starting a second one.
 */
function RaffleWheel({ phase, segments, spinCount, spinStartedAtMs, winnerNumber }) {
  const [rotation, setRotation] = useState(0);
  const [transitionMs, setTransitionMs] = useState(0);
  const [transitionDelayMs, setTransitionDelayMs] = useState(0);
  /* How long the wheel has to grow into place for this spin. Null until a spin
     sets it, and unused on the way back down, where the wheel shrinks on the
     resting duration from the stylesheet. */
  const [stageMs, setStageMs] = useState(null);
  /* The last aim the wheel took: which spin it was for, where it left the
     wheel pointing, and the slices the angle was worked out from. */
  const lastSpinRef = useRef({ count: 0, rotation: 0, segments: null });
  /*
   * The slices are frozen from the moment a spin starts until the wheel is
   * idle again. Attendees keep joining while the wheel is turning, and
   * re-slicing it underneath a running animation moves every label — including
   * the one the pointer is heading for, which would land it on the wrong
   * person.
   *
   * Held through the reveal as well, which it was not before: the freeze used
   * to lift the instant the spin ended, so a single check-in during those
   * eleven seconds re-cut the whole wheel on the frame it stopped. Every label
   * jumped at once and the winning slice slid out from under the pointer — the
   * wheel appeared to snap at the exact moment the room was watching it land.
   * Nothing may move again until the winner has been cleared.
   *
   * Nothing, that is, except a wheel with no slices on it at all, which is the
   * one list this may not go on holding. An empty wheel has nothing to keep
   * still and no landing angle worth protecting — the angle it is holding was
   * worked out from a list with nothing in it — so it takes the roster the
   * moment one arrives, and freezes on that instead.
   *
   * Which is not a hypothetical. The names come from the roster, staff-only,
   * and a display left alone long enough for its session to lapse loses them
   * and shows an empty wheel, as it should. Signing back in brings the roster
   * back — but if the wheel had a winner standing at the time, or was mid-spin,
   * it was staged, and the freeze threw every one of those names away. The
   * wheel then stayed blank however many times the roster came round again,
   * and the only way out of it was to clear the raffle. Same for a display
   * opened part-way through a spin, which has been staged since its first
   * frame and had an empty list to freeze from the start.
   */
  const [frozenSegments, setFrozenSegments] = useState(segments);
  const isSpinning = phase === RAFFLE_PHASE.spinning;
  /*
   * Anything but idle: the wheel is off the middle of the screen, turning or
   * parked on a result. It is what stages the wheel further down, and it is
   * also exactly the stretch over which the slices have to hold still.
   */
  const isStaged = phase !== RAFFLE_PHASE.idle;

  const hasFrozenSegments = frozenSegments.length > 0;

  useEffect(() => {
    if (isStaged && hasFrozenSegments) {
      return;
    }

    setFrozenSegments(segments);
  }, [hasFrozenSegments, isStaged, segments]);

  const eligibleSegments = isStaged ? frozenSegments : segments;
  /*
   * What actually gets drawn, which above the segment cap is a sample of the pool
   * rather than all of it — see buildRaffleDisplaySegments for why, and for why
   * the draw itself is untouched by this.
   *
   * Memoised on the winner as well as the list, because the winner is what the
   * sample is guaranteed to contain: a spin landing on somebody the stride
   * happened to skip has to put them back on the wheel before the pointer gets
   * there. Both inputs hold still for the length of a spin — the list because
   * it is frozen above, the winner because it is written once when Spin is
   * pressed — so this cannot re-cut the wheel mid-turn.
   */
  const wheelSegments = useMemo(
    () => buildRaffleDisplaySegments({ segments: eligibleSegments, winnerNumber }),
    [eligibleSegments, winnerNumber],
  );
  const segmentCount = wheelSegments.length;

  /*
   * A layout effect, so the growing and the turning are set on the same style
   * change as the class that stages the wheel. A frame in between would start
   * the grow on the stylesheet's resting duration and there would be no taking
   * it back: a transition already under way keeps the timing it started with.
   */
  useLayoutEffect(() => {
    /*
     * Closing the raffle puts the spin count back to zero, and the wheel now
     * stays mounted through that so it has something to fade out of. So the
     * count has to be let go of here as well: without it the ref would still be
     * holding the last raffle's number, and the first spin of the next one —
     * which starts from one again — would be read as a spin already run and
     * would never turn. The rotation is kept, so nothing jumps.
     */
    if (!(spinCount > 0)) {
      lastSpinRef.current = { ...lastSpinRef.current, count: 0 };

      return;
    }

    /*
     * Two things send the wheel round to the winner.
     *
     * A spin is the usual one. The other is the slices being replaced under a
     * wheel that is already staged, which the freeze above permits in exactly
     * one case — an empty wheel taking a roster that arrived late. It has to
     * re-aim when that happens: the angle it is sitting at was worked out from
     * a list with nothing in it, so drawing the new names without moving would
     * park the pointer on whichever of them the arithmetic happened to leave
     * under it, and announce somebody else. On a wheel that has already landed
     * there is no time left to animate, which is exactly right — the names
     * appear already correctly under the pointer rather than sliding into
     * place, because a moment ago there was nothing there to slide.
     */
    const isNewSpin = spinCount !== lastSpinRef.current.count;
    const hasNewSegments = isStaged && wheelSegments !== lastSpinRef.current.segments;

    if (!isNewSpin && !hasNewSegments) {
      return;
    }

    /* Somewhere in the winning slice rather than exactly on its middle, worked
       out from the spin so every screen stops in the same place. */
    const winnerRotation = getRaffleWinnerRotation(wheelSegments, winnerNumber, {
      landingFraction: getRaffleLandingFraction({ spinCount, winnerNumber }),
    });
    const nextRotation = getRaffleNextRotation(lastSpinRef.current.rotation, winnerRotation);
    /*
     * The rotation is handed to CSS immediately but held back by a delay, so
     * the wheel finishes growing into its place off the left edge before it
     * turns a degree. See getRaffleSpinTiming for how much of each stretch is
     * left — including the case of a spin whose start time has been cleared,
     * which has none of either and must not turn at all.
     */
    const { leadInMs: remainingLeadInMs, spinMs: remainingSpinMs } = getRaffleSpinTiming({
      spinStartedAtMs,
    });
    const shouldAnimate =
      remainingSpinMs > 0 && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    lastSpinRef.current = { count: spinCount, rotation: nextRotation, segments: wheelSegments };
    /*
     * The grow is given exactly the lead-in that is left, not a fixed length of
     * its own.
     *
     * The lead-in is counted from the press of Spin, but this screen only
     * starts growing when the write reaches it, so a fixed grow ran on into the
     * turn by however long the network took — and on a slow one the wheel
     * started turning the instant it started growing, which is the whole thing
     * this is meant to keep apart. Matching the two means the wheel is always
     * finished growing on the frame the rotation is released, and a screen that
     * joins after the lead-in has run out simply snaps to size, as it must to
     * stay on the same beat as everyone else.
     */
    setStageMs(shouldAnimate ? remainingLeadInMs : 0);
    setTransitionDelayMs(shouldAnimate ? remainingLeadInMs : 0);
    setTransitionMs(shouldAnimate ? remainingSpinMs : 0);
    setRotation(nextRotation);
    // winnerNumber is read for the target angle but is not a trigger: it
    // arrives with the spin that is already in this list. wheelSegments is one
    // now, and only bites in the one case above — the freeze holds it still
    // through every spin that has slices to hold, so a check-in during a spin
    // still cannot move the slice the wheel is heading for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaged, spinCount, spinStartedAtMs, wheelSegments]);

  /*
   * Two limits, whichever bites first.
   *
   * Slice count sets it as before — more people, thinner slices, smaller type.
   * The second limit is new and comes from the labels now growing inwards from
   * the rim: on a wheel with only a few slices the type is at its largest, and
   * a long name at that size would run past the hub and out the far side. This
   * measures the longest label against the radial run it actually has.
   */
  const longestLabelLength = wheelSegments.reduce(
    (longest, segment) => Math.max(longest, buildRaffleSegmentLabel(segment).length),
    1,
  );
  const labelRunLength = Math.min(
    WHEEL_RADIUS - WHEEL_LABEL_RIM_INSET - WHEEL_HUB_RADIUS - 4,
    WHEEL_RADIUS * 2 * WHEEL_VISIBLE_FRACTION - WHEEL_LABEL_RIM_INSET - 4,
  );
  /* Driven by the tightest slice on the wheel, not the plain count: with member
     chances turned up the slices are no longer all the same width, and sizing
     off an average would overflow the narrow ones. */
  const narrowestSweep = wheelSegments.reduce(
    (narrowest, segment) => Math.min(narrowest, segment.sweepAngle ?? 360),
    360,
  );
  const labelFontSize = Math.min(
    15,
    Math.max(4.5, (250 * narrowestSweep) / 360),
    // ~0.55em per character is a serviceable average for the app's face.
    labelRunLength / (0.55 * longestLabelLength),
  );

  /*
   * Once a spin has been called the wheel leaves the middle of the screen and
   * slides off the left edge, grown taller than the display, with only the
   * right third of it — the part under the pointer — still showing.
   *
   * The point of the move is legibility: a wheel of a full roster drawn small
   * and whole is a smear, but two thirds of it wasted off-screen buys a radius
   * big enough that one slice fills a good part of the screen height. The
   * labels come out horizontal at that edge, so the names scrolling past the
   * pointer can be read from the back of the room.
   *
   * It stays there through the reveal, winning slice parked at the pointer,
   * with the announcement in the column beside it.
   */

  return (
    <div className="raffle-wheel-viewport">
      <div
        className={`raffle-wheel${isSpinning ? " raffle-wheel--spinning" : ""}${
          isStaged ? " raffle-wheel--staged" : ""
        }`}
        /* Only on the way up. Dropped again the moment the wheel is unstaged,
           in the same render that takes the class off, so the shrink runs on
           the stylesheet's duration rather than on the last spin's leftovers. */
        style={isStaged && stageMs !== null ? { "--raffle-wheel-stage-ms": `${stageMs}ms` } : undefined}
      >
      <div
        className="raffle-wheel-spinner"
        style={{
          transform: `rotate(${rotation}deg)`,
          transitionDelay: `${transitionDelayMs}ms`,
          transitionDuration: `${transitionMs}ms`,
        }}
      >
        <svg
          className="raffle-wheel-svg"
          viewBox={`0 0 ${WHEEL_VIEWBOX_SIZE} ${WHEEL_VIEWBOX_SIZE}`}
          role="img"
          /* The pool, not the slice count — above the cap the wheel draws a
             sample, and a screen reader should hear how many people are
             actually in the draw rather than how many arcs were painted. */
          aria-label={`Raffle wheel with ${eligibleSegments.length} ${
            eligibleSegments.length === 1 ? "entry" : "entries"
          }`}
        >
          {segmentCount === 0 ? (
            <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS} fill="#f4ede0" />
          ) : null}
          {segmentCount === 1 ? (
            <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS} fill={WHEEL_SEGMENT_FILLS[0]} />
          ) : null}
          {segmentCount > 1
            ? wheelSegments.map((segment, index) => (
                <path
                  key={`slice-${segment.number}`}
                  d={buildSegmentPath(segment.startAngle, segment.endAngle)}
                  fill={WHEEL_SEGMENT_FILLS[index % WHEEL_SEGMENT_FILLS.length]}
                  /* No divider. The six-colour cycle already separates
                     neighbours — and it never repeats at the seam, whatever the
                     slice count — so a rule between every pair was just noise
                     at the widths a full roster produces. */
                  stroke="none"
                />
              ))
            : null}
          {/* The rim. Thin, now that it is the only ink on the wheel. */}
          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r={WHEEL_RADIUS}
            fill="none"
            stroke="#111111"
            strokeWidth="1.5"
          />
          {wheelSegments.map((segment) => (
            <text
              key={`label-${segment.number}`}
              className="raffle-wheel-label"
              x="0"
              y="0"
              fill="#111111"
              fontSize={labelFontSize}
              textAnchor="end"
              dominantBaseline="middle"
              /*
                Out along the slice's midline to just inside the rim, then
                turned so the text reads from the hub outwards.
                `text-anchor: end` puts the label's far end at that point and
                grows it back towards the hub, which does two things: the name
                lands on the wide outer edge of the slice where there is room
                for it, and no label can ever run off the rim however long the
                name is — it eats into the empty middle instead.
              */
              transform={[
                `translate(${WHEEL_CENTER} ${WHEEL_CENTER})`,
                `rotate(${segment.midAngle})`,
                `translate(0 ${-(WHEEL_RADIUS - WHEEL_LABEL_RIM_INSET)})`,
                "rotate(-90)",
              ].join(" ")}
            >
              {buildRaffleSegmentLabel(segment)}
            </text>
          ))}
        </svg>
      </div>
      <div className="raffle-wheel-pointer" aria-hidden="true" />
      <div className="raffle-wheel-hub" aria-hidden="true">
      </div>
      </div>
    </div>
  );
}

/*
 * Memoised, because the display re-renders once a second — the clock the round
 * timers run on ticks whether or not a raffle is up — and this component is a
 * couple of hundred SVG nodes. Diffing all of them every second while the wheel
 * is mid-spin is work landing in the middle of an animation, and every prop
 * here is either a primitive or the memoised segment list, so the comparison
 * that skips it is exact rather than a guess.
 */
export default memo(RaffleWheel);
