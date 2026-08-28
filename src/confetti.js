/**
 * The celebration bursts, in one place.
 *
 * canvas-confetti is loaded on first use and kept: it is ~7 kB that most
 * attendees never need, and importing it per burst would make the raffle
 * reveal wait on the network at exactly the wrong moment.
 *
 * The stylesheet honours prefers-reduced-motion, but a full-screen particle
 * burst is fired from JavaScript and has to check for itself.
 */

/*
 * The longest edge of the drawing buffer, in pixels.
 *
 * The library's own canvas is sized to the viewport, which is fine on a phone
 * and ruinous on the thing this app is really built for: a projector or a big
 * panel running at native resolution, where every frame means clearing eight
 * million pixels and drawing a thousand shapes over them. Confetti is the one
 * thing on screen that nobody looks at closely, so the buffer is capped and
 * stretched back over the screen by CSS — softer edges on a 4K display, and a
 * quarter of the fill.
 *
 * The cap is applied to the longer edge and the shorter one follows it, so the
 * buffer keeps the screen's aspect and the stretch stays uniform. Physics is
 * in buffer pixels, which means a capped screen also gets proportionally
 * larger, livelier confetti rather than a fine mist seen from the back row.
 */
const MAX_CANVAS_EDGE = 1600;

let confettiModulePromise = null;
/* One cannon and one canvas for the life of the page. The library's default
   export adds and removes its canvas around every animation; the raffle fires
   four bursts inside a second, and a fresh compositing layer each time is
   exactly the wrong thing to be doing while one is running. */
let cannon = null;
let cannonCanvas = null;
/* Rebuilding the canvas mid-flight would pull it out from under a running
   animation, so a resize is only acted on between bursts. */
let burstsInFlight = 0;

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const getTargetCanvasSize = () => {
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = document.documentElement.clientHeight || window.innerHeight;
  const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(width, height, 1));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const createCannonCanvas = ({ height, width }) => {
  const canvas = document.createElement("canvas");

  /* Set before the canvas is ever fired on: canvas-confetti hands control of it
     to its worker on the first burst, and after that the drawing buffer can no
     longer be resized from here — which is why a resize replaces the canvas
     rather than reshaping it. */
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  });
  /* Over everything, which on the round view it got for free by being the last
     positioned thing on the page. The raffle put a stacking order on the
     screen — the wheel's layer sits at 4 — and an unlayered canvas fell in
     behind it, so the celebration was going off underneath the wheel. */
  canvas.style.zIndex = "2000";
  document.body.appendChild(canvas);

  return canvas;
};

const loadConfetti = async () => {
  if (!confettiModulePromise) {
    confettiModulePromise = import("canvas-confetti");
  }

  return (await confettiModulePromise).default;
};

const getCannon = async () => {
  const confetti = await loadConfetti();
  const size = getTargetCanvasSize();
  const isStale =
    cannonCanvas !== null &&
    (cannonCanvas.width !== size.width || cannonCanvas.height !== size.height);

  if (isStale && burstsInFlight === 0) {
    cannon.reset();
    cannonCanvas.remove();
    cannon = null;
    cannonCanvas = null;
  }

  if (!cannon) {
    cannonCanvas = createCannonCanvas(size);
    /* `resize: false` because the canvas is sized here, to the cap above,
       rather than to the viewport. `useWorker` keeps the particle loop off the
       main thread, where React, the wheel and the reveal animation are. */
    cannon = confetti.create(cannonCanvas, { resize: false, useWorker: true });
  }

  return cannon;
};

/** Fires on whichever cannon is current, and keeps the in-flight count honest. */
const fireBurst = (options) => {
  if (!cannon) {
    return;
  }

  burstsInFlight += 1;

  const settle = () => {
    burstsInFlight -= 1;
  };

  Promise.resolve(cannon(options)).then(settle, settle);
};

/** One burst. Resolves false when it was skipped for reduced motion. */
const fireConfetti = async (options) => {
  if (prefersReducedMotion()) {
    return false;
  }

  await getCannon();
  fireBurst(options);

  return true;
};

/*
 * The burst for a group being called, and the shape every other burst on the
 * display is built from.
 *
 * Default `scalar`, which is to say default-sized pieces. The library draws in
 * buffer pixels and the buffer is capped above, so on anything bigger than
 * 1600px the whole canvas is already being stretched over the screen — and a
 * scalar on top of that is a magnification of a magnification. That is what
 * made the raffle's confetti come out as huge soft blobs next to this one's.
 */
const CALL_BURST = {
  particleCount: 80,
  spread: 200,
  origin: { y: 0.6 },
  ticks: 170,
};

/** The burst for a group being called. */
export const fireCallConfetti = async () => fireConfetti(CALL_BURST);

/**
 * The raffle reveal: the group call's burst, twice over, with cannons from
 * both sides of the room.
 *
 * Bigger than a group call by repeating a burst the display already runs well
 * rather than by drawing heavier pieces. Every count and every scalar here is
 * the call's, so the two read as the same confetti — one of them just goes on
 * for longer, which is what a reveal that runs for several seconds needs.
 *
 * Aimed at the middle of the screen rather than at the wheel: the winner's
 * name is announced in the column beside it, so the celebration belongs across
 * both halves.
 */
export const fireRaffleConfetti = async () => {
  if (prefersReducedMotion()) {
    return false;
  }

  await getCannon();

  const sideCannons = () => {
    fireBurst({ angle: 60, origin: { x: 0, y: 0.75 }, particleCount: 50, spread: 80, startVelocity: 55, ticks: 170 });
    fireBurst({ angle: 120, origin: { x: 1, y: 0.75 }, particleCount: 50, spread: 80, startVelocity: 55, ticks: 170 });
  };

  sideCannons();
  fireBurst(CALL_BURST);
  window.setTimeout(sideCannons, 520);
  window.setTimeout(() => fireBurst(CALL_BURST), 900);

  return true;
};
