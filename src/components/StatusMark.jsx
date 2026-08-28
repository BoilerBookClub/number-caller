import { useEffect, useRef } from "react";
import rough from "roughjs/bin/rough";

/*
 * The verdict, drawn rather than typeset.
 *
 * A tick, a cross or a heads-up bang inside a ring, in the same hand as the
 * cards and the scanner's alignment frame. Each stroke is dashed to its own
 * length and released in order, so the ring goes round and the mark lands
 * inside it the way somebody would actually draw the two.
 *
 * Shared: the scanner shows it over the camera when a code is redeemed, and the
 * attendee's ticket shows it — on their own phone and in the staff-side copy of
 * that page — when their item is marked as claimed.
 */
const STATUS_MARK_UNITS = 132;
const STATUS_MARK_CENTRE = STATUS_MARK_UNITS / 2;

const STATUS_MARK_OPTIONS = {
  bowing: 0.8,
  disableMultiStroke: true,
  maxRandomnessOffset: 2,
  roughness: 1.3,
  seed: 24,
  stroke: "currentColor",
  strokeWidth: 5,
};

// How long each stroke takes and how far apart they start. A ring and two
// strokes are done inside 700ms, which leaves the mark standing for most of the
// time it is on screen rather than still assembling itself.
const STATUS_MARK_STROKE_MS = 260;
const STATUS_MARK_STAGGER_MS = 130;

/**
 * The strokes each tone is made of, ring first so the mark lands on top of it.
 *
 * Coordinates are in the mark's own pixel box: the ring just inside the edges,
 * with the mark held well within it.
 */
function buildStatusMarkShapes(generator, tone) {
  const ring = generator.circle(
    STATUS_MARK_CENTRE,
    STATUS_MARK_CENTRE,
    STATUS_MARK_UNITS - 18,
    STATUS_MARK_OPTIONS,
  );

  if (tone === "error") {
    return [
      ring,
      generator.line(46, 46, 86, 86, STATUS_MARK_OPTIONS),
      generator.line(86, 46, 46, 86, STATUS_MARK_OPTIONS),
    ];
  }

  if (tone === "success") {
    return [
      ring,
      generator.linearPath(
        [
          [41, 68],
          [59, 87],
          [93, 45],
        ],
        STATUS_MARK_OPTIONS,
      ),
    ];
  }

  // Anything else is a heads-up rather than a verdict — an attendee already
  // seen to, most often — so it gets neither mark.
  return [
    ring,
    generator.line(66, 36, 66, 74, STATUS_MARK_OPTIONS),
    generator.line(66, 91, 66, 94, STATUS_MARK_OPTIONS),
  ];
}

/**
 * `tone` is one of "success", "error", or anything else for the heads-up bang.
 * Colour comes from CSS: the strokes are drawn in currentColor.
 */
export default function StatusMark({ className = "", tone }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) {
      return;
    }

    // rough.svg hands back drawn <g> elements, the same way the scanner's
    // alignment frame is built.
    svgElement.replaceChildren(...buildStatusMarkShapes(rough.svg(svgElement), tone));

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      return;
    }

    // Each <g> holds one <path> per stroke. Dashing each path to its own length
    // is what lets one keyframe — offset to zero — draw strokes of any length
    // at the same speed.
    const paths = svgElement.querySelectorAll("path");

    paths.forEach((path, index) => {
      const length = path.getTotalLength();

      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.animation =
        `statusMarkDraw ${STATUS_MARK_STROKE_MS}ms ease-out ` +
        `${index * STATUS_MARK_STAGGER_MS}ms forwards`;
    });
  }, [tone]);

  return (
    <svg
      ref={svgRef}
      className={`status-mark status-mark--${tone}${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${STATUS_MARK_UNITS} ${STATUS_MARK_UNITS}`}
      aria-hidden="true"
    />
  );
}
