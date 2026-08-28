import { useEffect, useRef } from "react";
import "wired-elements/lib/wired-spinner.js";
import bbcLogo from "../assets/bbc_logo.png";

/*
 * wired-spinner draws into a fixed 76x76 SVG (canvasSize() in the library) and
 * sets width/height attributes on it. Sizing the host element does nothing to
 * the drawing — it just leaves a 76px SVG parked in the top-left of whatever box
 * you gave it, which is why the ring sat up and to the left of the logo instead
 * of around it, and why it overflowed at small sizes.
 *
 * So: give the host its true intrinsic size, centre that box, then scale it. The
 * numbers below are the library's own geometry, in SVG units.
 */
const CANVAS_UNITS = 76; // the SVG the library draws into
const RING_UNITS = 60; // the ring it strokes: floor(76 * 0.8)
const ORBIT_UNITS = 25; // radius the moving knob travels
const KNOB_UNITS = 10; // half the knob's 20x20 box

// The knob sweeps ORBIT +/- KNOB, so anything within ORBIT - KNOB is clear of
// it. As a fraction of the ring's diameter that is 2 * (25 - 10) / 60 = 0.5.
const MAX_LOGO_RATIO = (2 * (ORBIT_UNITS - KNOB_UNITS)) / RING_UNITS;
const LOGO_RATIO = 0.44; // a little under the maximum, so the knob clears it

/**
 * Loading indicator: a sketch ring spinning around the club logo.
 *
 * `size` is the diameter of the visible ring, in pixels.
 */
export default function Spinner({ duration = 900, size = 72 }) {
  const spinnerRef = useRef(null);
  const numericSize = Number.isFinite(Number(size)) ? Number(size) : 72;
  const normalizedDuration = Number.isFinite(Number(duration)) ? Number(duration) : 900;

  // Scale the fixed canvas so the drawn ring ends up exactly `size` across.
  const scale = numericSize / RING_UNITS;
  const logoSize = Math.round(numericSize * Math.min(LOGO_RATIO, MAX_LOGO_RATIO));

  useEffect(() => {
    const spinnerElement = spinnerRef.current;
    if (!spinnerElement) {
      return undefined;
    }

    let frameId = null;
    let timeoutId = null;

    const applySpinnerState = () => {
      spinnerElement.spinning = true;
      spinnerElement.duration = normalizedDuration;

      if (typeof spinnerElement.requestUpdate === "function") {
        spinnerElement.requestUpdate();
      }

      if (typeof spinnerElement.wiredRender === "function") {
        spinnerElement.wiredRender(true);
      }
    };

    applySpinnerState();
    frameId = window.requestAnimationFrame(applySpinnerState);
    timeoutId = window.setTimeout(applySpinnerState, 0);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [normalizedDuration]);

  return (
    <div
      className="spinner-wrap"
      style={{ height: `${numericSize}px`, width: `${numericSize}px` }}
      role="status"
      aria-label="Loading"
    >
      <wired-spinner
        ref={spinnerRef}
        class="spinner-ring"
        spinning
        duration={normalizedDuration}
        aria-hidden="true"
        style={{
          height: `${CANVAS_UNITS}px`,
          width: `${CANVAS_UNITS}px`,
          // translate centres the 76x76 box on the wrapper's centre; scale then
          // grows it about that same centre, so the ring stays concentric with
          // the logo at every size.
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      />
      <img
        src={bbcLogo}
        alt=""
        aria-hidden="true"
        className="spinner-logo"
        style={{ height: `${logoSize}px`, width: `${logoSize}px` }}
      />
    </div>
  );
}

/** Full-height centred loading screen, for route and data loading states. */
export function LoadingScreen({ size = 96 }) {
  return (
    <div className="loading-screen">
      <Spinner size={size} />
    </div>
  );
}
