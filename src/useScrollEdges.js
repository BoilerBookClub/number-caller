import { useCallback, useEffect, useRef, useState } from "react";

/* A row is ~4rem, so a couple of pixels either way is rounding, not content. */
const EDGE_TOLERANCE_PX = 2;

/**
 * Which edges of a scrolling list still have content past them.
 *
 * Used to fade the top and bottom of a list only while it is actually cut off.
 * A permanent fade would be worse than none: it would tell staff that a list of
 * three attendees continues past the edge when it does not, which is exactly the
 * question the fade exists to answer.
 *
 * The measurement is re-taken after every render rather than on scroll alone,
 * because the thing that most often changes whether a roster overflows is a row
 * arriving or leaving, which fires neither a scroll nor a resize of the list
 * itself. Same shape as the create form's scroll hint.
 */
export default function useScrollEdges(elementRef) {
  const [edges, setEdges] = useState({ hasContentAbove: false, hasContentBelow: false });

  const syncEdges = useCallback(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = element;
    const hasContentAbove = scrollTop > EDGE_TOLERANCE_PX;
    const hasContentBelow = scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE_PX;

    // Compared before setting: this runs on every render, and returning a fresh
    // object each time would re-render forever.
    setEdges((currentEdges) =>
      currentEdges.hasContentAbove === hasContentAbove &&
      currentEdges.hasContentBelow === hasContentBelow
        ? currentEdges
        : { hasContentAbove, hasContentBelow },
    );
  }, [elementRef]);

  /*
   * The observer is attached to an element, not to a render.
   *
   * The measurement below really does have to run after every render — a row
   * arriving or leaving is what most often changes whether a list overflows,
   * and that fires neither a scroll nor a resize. The observer does not: it was
   * simply sharing the effect, so a page that re-renders once a second off the
   * clock was building and tearing down a ResizeObserver and a requestAnimationFrame
   * every second, four times over on the control panel.
   *
   * Tracked by element rather than by dependency array because the lists are
   * conditionally rendered — the roster's node does not exist until the first
   * attendee claims a number — so the ref goes from null to an element between
   * renders, and an effect keyed on anything stable would never see it appear.
   */
  const observedElementRef = useRef(null);
  const observerRef = useRef(null);
  const frameRef = useRef(null);

  /*
   * The scroll handler's own frame, kept apart from the one above.
   *
   * A flick through a long roster fires scroll as fast as the browser can
   * deliver it, and syncEdges reads three layout properties off the list every
   * time — each of which flushes any style work the app has queued since the
   * last one. What it does with those three numbers is decide whether two
   * fades are on, so a frame of lag in the answer is not something anyone can
   * see, and one measurement per frame is all the screen can show. Coalescing
   * to a frame turns a momentum scroll's worth of forced layouts into one per
   * paint — which is the difference between the list scrolling and the phone
   * catching up on layout while your finger is already somewhere else.
   *
   * Deliberately not shared with the post-render measurement, which has to be
   * able to run on a render that the very next scroll event would otherwise
   * cancel out.
   */
  const scrollFrameRef = useRef(null);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current != null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncEdges();
    });
  }, [syncEdges]);

  const detach = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (scrollFrameRef.current != null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }

    observerRef.current?.disconnect();
    observerRef.current = null;
    observedElementRef.current = null;
  }, []);

  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      detach();
      return;
    }

    syncEdges();

    if (observedElementRef.current === element) {
      return;
    }

    detach();
    observedElementRef.current = element;

    // Fonts and the drawn row frames settle a frame late, which changes the
    // scroll height out from under the first measurement.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      syncEdges();
    });

    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(syncEdges);
      observerRef.current.observe(element);
    }
  });

  // Unmount only. The effect above has no dependency array, so its own cleanup
  // would run after every render and take the observer with it.
  useEffect(() => detach, [detach]);

  return { ...edges, onScroll: handleScroll };
}

/** The class names that draw the fades, for a list in the given scroll state. */
export const buildScrollFadeClassName = ({ hasContentAbove, hasContentBelow }) =>
  `${hasContentAbove ? " scroll-fade--top" : ""}${hasContentBelow ? " scroll-fade--bottom" : ""}`;
