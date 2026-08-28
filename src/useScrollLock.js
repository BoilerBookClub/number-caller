import { useEffect } from "react";

/**
 * Freezes background scrolling while a modal is open.
 *
 * App and the graph overlay each had their own copy of this, and both captured
 * their own `scrollY` and wrote `body.style.top`. Opening one modal on top of
 * another meant the inner one's cleanup restored the outer one's scroll
 * position. A shared reference count means the page is only unlocked once the
 * last modal closes, and only the first lock records where to scroll back to.
 */
let activeLockCount = 0;
let lockedScrollY = 0;

/**
 * Force the page back to a scrollable state.
 *
 * If a component throws while a modal is open its cleanup never runs, leaving
 * <body> at position: fixed with a negative top offset — which can push whatever
 * renders next out of the viewport entirely. The error boundary calls this so
 * its own UI is reachable.
 */
export function resetScrollLock() {
  activeLockCount = 0;

  const { body, documentElement } = document;

  documentElement.classList.remove("modal-scroll-locked");
  body.classList.remove("modal-scroll-locked");
  body.style.top = "";
}

export default function useScrollLock(isLocked = true) {
  useEffect(() => {
    if (!isLocked) {
      return undefined;
    }

    const { body, documentElement } = document;

    if (activeLockCount === 0) {
      lockedScrollY = window.scrollY;
      documentElement.classList.add("modal-scroll-locked");
      body.classList.add("modal-scroll-locked");
      body.style.top = `-${lockedScrollY}px`;
    }

    activeLockCount += 1;

    return () => {
      activeLockCount -= 1;

      if (activeLockCount > 0) {
        return;
      }

      documentElement.classList.remove("modal-scroll-locked");
      body.classList.remove("modal-scroll-locked");
      body.style.top = "";
      window.scrollTo(0, lockedScrollY);
    };
  }, [isLocked]);
}
