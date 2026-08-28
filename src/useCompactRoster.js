import { useSyncExternalStore } from "react";

/*
 * The width below which a roster row folds its buttons into an overflow menu.
 *
 * Mirrored by the same breakpoint in App.css, where the row already breaks its
 * name and its badges onto separate lines. Past that point there is no room
 * left for three buttons on the end of the row, so they move behind a "..."
 * instead of pushing the name out of the row.
 */
const COMPACT_ROSTER_QUERY = "(max-width: 700px)";

/*
 * One matchMedia listener for every row on the page rather than one per row.
 *
 * A full house is hundreds of roster rows, and each of them asks this same
 * question. Subscribing them all to a single shared MediaQueryList keeps that
 * to one browser-side listener, and useSyncExternalStore hands every row the
 * same answer in the same render pass.
 */
const mediaQueryList =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_ROSTER_QUERY)
    : null;

function subscribe(onStoreChange) {
  if (!mediaQueryList) {
    return () => {};
  }

  mediaQueryList.addEventListener("change", onStoreChange);
  return () => mediaQueryList.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return mediaQueryList ? mediaQueryList.matches : false;
}

/* Server-rendered/prerendered markup has no viewport, so assume the roomy row. */
function getServerSnapshot() {
  return false;
}

export function useCompactRoster() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
