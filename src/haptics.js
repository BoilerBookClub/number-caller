/**
 * The phone buzzing when it is actually somebody's turn.
 *
 * Two moments earn one, and only two: the display reaching their number, and
 * winning a prize. Both are things an attendee is waiting on and is not
 * necessarily watching the screen for — a phone face-down on a table is the
 * case the confetti and the chime cannot reach, and the whole argument for a
 * haptic over one more thing that lights up. Anything more frequent than that
 * and the buzz stops meaning "you".
 *
 * Two ways of asking, because no single one covers the room:
 *
 * - navigator.vibrate, which is Android's, takes a pattern outright.
 * - iOS has never shipped it and still has no vibration API at all. What it
 *   does have, since 17.4, is a native switch control that taps the Taptic
 *   Engine when it flips — so the fallback keeps one off-screen and flips it.
 *   That is a side effect of a form control, not an API, which is worth being
 *   honest about: it is the only way to reach an iPhone from a web page, it is
 *   silent when it fails, and if Safari ever stops tapping on a switch it will
 *   simply go quiet rather than break anything.
 *
 * Neither is guaranteed even where it exists. The spec lets a browser ignore
 * vibration in a tab that has never been touched, which is exactly the state a
 * ticket left open on a table is in. A refusal is not an error, so nothing here
 * treats it as one.
 */

/* Two short pulses. Distinct from a notification's single buzz, and short
   enough not to be mistaken for a call. */
export const VIBRATE_TURN_PATTERN = [70, 60, 70];

/* Longer, and with a tail, because it is the rarer of the two and the one
   worth looking up for. */
export const VIBRATE_PRIZE_PATTERN = [50, 50, 50, 50, 220];

const vibrateWithApi = (pattern) => {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }

  try {
    return navigator.vibrate(pattern) === true;
  } catch {
    // Some browsers throw rather than return false when they will not vibrate.
    return false;
  }
};

/*
 * The switch, built once and kept.
 *
 * It has to be rendered to tap — hiding it with `display: none` takes the
 * control out of the layout and the haptic with it — so it is parked off in a
 * corner at zero opacity instead, deaf to pointers and out of the tab order.
 *
 * The feature test is the `switch` IDL property rather than the user agent:
 * a browser that has it is one that draws the control, and everywhere else
 * this returns false and costs nothing.
 */
let hapticSwitch = null;
let pendingTapTimers = [];

const supportsHapticSwitch = () =>
  typeof document !== "undefined" && "switch" in document.createElement("input");

const getHapticSwitch = () => {
  if (hapticSwitch) {
    return hapticSwitch;
  }

  const label = document.createElement("label");

  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";

  const input = document.createElement("input");

  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;

  label.appendChild(input);
  document.body.appendChild(label);
  hapticSwitch = input;

  return hapticSwitch;
};

/*
 * A pattern is [buzz, pause, buzz, pause, ...], so the even entries are the
 * buzzes. The switch has no duration to give — every flip is the same tap — so
 * what carries over is the rhythm: one tap where each buzz begins.
 */
const tapTimesForPattern = (pattern) => {
  const times = [];
  let elapsedMs = 0;

  pattern.forEach((durationMs, index) => {
    if (index % 2 === 0) {
      times.push(elapsedMs);
    }

    elapsedMs += durationMs;
  });

  return times;
};

const vibrateWithSwitch = (pattern) => {
  if (!supportsHapticSwitch()) {
    return false;
  }

  const input = getHapticSwitch();
  const tap = () => {
    input.click();
  };

  pendingTapTimers.forEach((timerId) => window.clearTimeout(timerId));
  pendingTapTimers = [];

  tapTimesForPattern(pattern).forEach((delayMs) => {
    if (delayMs === 0) {
      tap();
      return;
    }

    pendingTapTimers.push(window.setTimeout(tap, delayMs));
  });

  return true;
};

/** Fires one pattern, by whichever route this browser has. */
export const vibrate = (pattern) => vibrateWithApi(pattern) || vibrateWithSwitch(pattern);
