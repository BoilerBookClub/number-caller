/**
 * How hard the attendee page is allowed to keep asking for a number.
 *
 * The check-in effects are written as "if there is no claim yet, get one", and
 * their own dependencies include the loading flag they set — so a failed call
 * flips that flag back and re-runs the effect immediately. Without a bound that
 * is a tight loop, one callable per network round trip, on every phone in the
 * room at once. It is at its worst exactly when it does most damage: the
 * failures that trigger it are the ones a busy event produces, so three hundred
 * devices start hammering the callable at the moment it is already struggling,
 * and the retries themselves keep it struggling.
 *
 * Kept apart from App.jsx and free of React so the policy can be unit tested —
 * see tests/helpers.test.mjs.
 */

/**
 * Failures worth trying again.
 *
 * Anything to do with the network or with the far end being busy: retrying is
 * the right answer and it will probably work. Everything else — a rejected
 * code, a closed event, an argument the server will not accept — will fail the
 * same way forever, so it is reported once and left alone.
 *
 * Codes arrive from the callable SDK prefixed with `functions/`. Bare codes are
 * matched too, because a thrown FirebaseError is not the only way to get here.
 */
const TRANSIENT_CLAIM_ERROR_CODES = new Set([
  "functions/aborted",
  "functions/cancelled",
  "functions/deadline-exceeded",
  "functions/internal",
  "functions/resource-exhausted",
  "functions/unavailable",
  "functions/unknown",
  "aborted",
  "cancelled",
  "deadline-exceeded",
  "internal",
  "resource-exhausted",
  "unavailable",
  "unknown",
]);

export const isTransientClaimError = (error) => {
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";

  if (code) {
    return TRANSIENT_CLAIM_ERROR_CODES.has(code);
  }

  /*
   * No code at all is the shape a `fetch` that never reached anywhere takes —
   * which is the single most likely failure on a venue network, and the one it
   * is most worth trying again.
   */
  return true;
};

/** How many times a transient failure is retried before the page gives up. */
export const MAX_CLAIM_ATTEMPTS = 5;

/** The first retry's delay. Each subsequent one doubles it. */
const CLAIM_RETRY_BASE_DELAY_MS = 1_000;
/**
 * The ceiling on a single wait.
 *
 * Low enough that somebody watching the screen sees it recover on its own,
 * high enough that three hundred devices are not all back inside a second.
 */
export const CLAIM_RETRY_MAX_DELAY_MS = 15_000;

/**
 * How long to wait before attempt number `attemptCount`.
 *
 * Zero for the first attempt: an attendee who has just scanned should not sit
 * through a delay that exists for the failure case. After that it doubles.
 *
 * `randomValue` is the jitter, and it is the part that matters at this scale.
 * Three hundred phones that all failed on the same overloaded second would,
 * without it, all come back on the same later second and reproduce the burst
 * that caused the failure. Spreading each wait across a window breaks that up.
 * Passed in rather than taken from Math.random so the tests are deterministic.
 */
export const getClaimRetryDelayMs = (attemptCount, randomValue = Math.random()) => {
  if (!Number.isFinite(attemptCount) || attemptCount <= 0) {
    return 0;
  }

  const exponentialDelayMs = Math.min(
    CLAIM_RETRY_MAX_DELAY_MS,
    CLAIM_RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1),
  );
  /* Full jitter across the low half of the window, so the delays stay spread
     without any of them collapsing to nothing. */
  const jitterFraction = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;

  return Math.round(exponentialDelayMs * (0.5 + jitterFraction * 0.5));
};

/**
 * How long the doors-open sweep waits before its first attempt.
 *
 * Every other first attempt in this app is immediate, deliberately: somebody
 * standing at the display who has just scanned should not sit through a delay
 * that exists for the failure case. The queue is the exception, because what
 * triggers it is a clock rather than a person — every queued phone in the room
 * crosses the event start time inside the same second, and each one then opens
 * a transaction against the single document every check-in has to write.
 *
 * Nothing is waiting on that burst: the server sweeps the whole queue every
 * minute, so a phone that hangs back thirty seconds is very often handed its
 * number by the sweep before its own attempt even fires. Spread flat rather
 * than exponentially, because the goal is an even arrival rate and not a
 * backoff — this is the first attempt, nothing has failed yet.
 *
 * `randomValue` is injected so the tests are deterministic; callers pass
 * Math.random().
 */
const DOORS_OPEN_JITTER_MAX_MS = 30_000;

export const getDoorsOpenJitterMs = (randomValue = Math.random()) => {
  const safeRandomValue = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;

  return Math.round(safeRandomValue * DOORS_OPEN_JITTER_MAX_MS);
};

/**
 * Whether another attempt is allowed.
 *
 * A non-transient failure stops on the spot: trying it again is guaranteed to
 * produce the same refusal, and doing so costs the same as a retry that might
 * have worked.
 */
export const shouldRetryClaim = ({ attemptCount, error }) => {
  if (!isTransientClaimError(error)) {
    return false;
  }

  return Number.isFinite(attemptCount) && attemptCount < MAX_CLAIM_ATTEMPTS;
};

/** A fresh counter, for a new event or a new attendee. */
export const createClaimRetryState = (key = "") => ({ attemptCount: 0, key });

/**
 * Advances the counter, resetting it when the thing being retried has changed.
 *
 * The key is the event and the attendee together: a different event is a
 * different question, and the attempts spent on the last one say nothing about
 * this one.
 */
export const nextClaimRetryState = (state, key) =>
  state?.key === key
    ? { attemptCount: (state.attemptCount ?? 0) + 1, key }
    : { attemptCount: 1, key };
