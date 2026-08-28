import { useCallback, useLayoutEffect, useRef, useState } from "react";

/*
 * Keeps a panel's title on one line beside the controls that share its row.
 *
 * The header is a grid: the title in an elastic column, the settings circle and
 * the primary-action cluster in columns that size to their own content. The
 * clusters cannot give anything up — three drawn circles and a button whose
 * label is nowrap — so everything they need comes out of the title's column,
 * which has a zero minimum and hands it over. "Group 101-120" is a name, not
 * prose: on a phone it was breaking across two lines, growing the row and
 * running the lockup into the buttons beside it.
 *
 * So the title is measured against the room actually left for it and takes the
 * squeeze in its type size instead. A media query cannot do this: what the
 * title has to fit into is the card's width minus two clusters whose widths
 * depend on what their buttons currently say ("Start Round 12" is a good deal
 * wider than "Next Group"), and the card is not the viewport.
 */

/*
 * The floor, in px. Below this the heading would be set smaller than the round
 * label underneath it, at which point it has stopped reading as the title of
 * anything. A card this narrow gets the stacked layout instead.
 */
const MINIMUM_TITLE_PX = 15;

/* Sub-pixel differences are the browser's rounding, not a title that no longer
   fits, and acting on them would set a fractional size on every resize. */
const FIT_TOLERANCE_PX = 0.5;

const CONTROL_CLUSTER_SELECTOR =
  ":scope > .queue-corner-actions, :scope > .queue-corner-primary";

/**
 * Wire `rowRef` to the header grid, `titleRef` to the heading and `textRef` to
 * the span holding its words. `isStacked` is true when even the floor will not
 * fit beside the controls, and the caller puts the row into the layout where
 * the title takes a line of its own — see .queue-card-sticky-top--stacked.
 *
 * `titleText` is taken only as the signal that the words changed; the width is
 * always measured from the DOM, since the same string is a different width in
 * a hand-drawn font at a different size.
 */
export default function useFitTitleToRow(titleText) {
  const titleRef = useRef(null);
  const textRef = useRef(null);
  const [isStacked, setIsStacked] = useState(false);
  /* Held as state rather than in a ref, because the panel this header belongs
     to is swapped in and out by the Groups/Raffle tabs without unmounting the
     component around it: a ref would be filled in on the way back without the
     effect below ever hearing about it, and the title would keep whatever size
     it was last given. */
  const [rowElement, setRowElement] = useState(null);
  const rowRef = useCallback((node) => setRowElement(node), []);

  const fitTitle = useCallback(() => {
    const titleElement = titleRef.current;
    const textElement = textRef.current;

    if (!rowElement || !titleElement || !textElement) {
      return;
    }

    /* Back to the size the stylesheet asks for before anything is read: both
       measurements below are taken at that size, and it is not a constant —
       the heading is em-sized off a body font that is itself clamped to the
       viewport, so it moves under us. */
    titleElement.style.fontSize = "";
    const basePx = Number.parseFloat(window.getComputedStyle(titleElement).fontSize);

    /* What the title wants. The span is nowrap and keeps its own minimum as a
       flex item, so it holds its full width and overflows a cell too small for
       it rather than being squeezed by one — which is what makes this the
       width the words need, not the width they have been given. */
    const wantedPx = textElement.getBoundingClientRect().width;

    /* What is left of the row once the clusters have taken theirs. Measured
       from the clusters rather than from the title's own cell so that the
       answer does not depend on the layout currently in force: in the stacked
       layout the title's cell is the whole row, and reading that would say it
       fits, unstack it, and put us straight back where we started. */
    const gapPx = Number.parseFloat(window.getComputedStyle(rowElement).columnGap) || 0;
    const controlClusters = rowElement.querySelectorAll(CONTROL_CLUSTER_SELECTOR);
    let controlsPx = 0;

    controlClusters.forEach((cluster) => {
      controlsPx += cluster.getBoundingClientRect().width + gapPx;
    });

    const rowPx = rowElement.clientWidth;
    const availablePx = rowPx - controlsPx;

    if (!Number.isFinite(basePx) || wantedPx <= 0 || rowPx <= 0) {
      return;
    }

    if (wantedPx <= availablePx + FIT_TOLERANCE_PX) {
      setIsStacked(false);
      return;
    }

    const fittedPx = basePx * (availablePx / wantedPx);

    if (fittedPx >= MINIMUM_TITLE_PX) {
      titleElement.style.fontSize = `${fittedPx}px`;
      setIsStacked(false);
      return;
    }

    /* Nothing left to shrink into: the title takes a row of its own, where it
       has the whole card and almost always fits at full size. Almost — a long
       group on a very narrow phone still gets the same treatment against the
       full width, so the one-line promise holds either way. */
    setIsStacked(true);

    if (wantedPx > rowPx + FIT_TOLERANCE_PX) {
      titleElement.style.fontSize = `${Math.max(MINIMUM_TITLE_PX, basePx * (rowPx / wantedPx))}px`;
    }
  }, [rowElement]);

  useLayoutEffect(() => {
    fitTitle();

    if (!rowElement || typeof ResizeObserver !== "function") {
      return undefined;
    }

    /*
     * The row for its width, and each cluster for its own: a button whose label
     * changes from "Next Group" to "Start Round 12" takes more of the row
     * without the row itself moving, and the title has to give way to it.
     *
     * Re-entry is not a concern. Setting the size changes the row's height, not
     * its width, and a resize observation is reported once a frame against the
     * last size reported — so the pass this triggers measures the same widths,
     * computes the same size, changes nothing, and ends there.
     */
    const observer = new ResizeObserver(fitTitle);

    observer.observe(rowElement);
    rowElement.querySelectorAll(CONTROL_CLUSTER_SELECTOR).forEach((cluster) => {
      observer.observe(cluster);
    });

    /* The hands this is set in arrive after the first paint and are wider than
       the fallback they replace, which moves nothing the observer is watching. */
    let isCancelled = false;

    document.fonts?.ready.then(() => {
      if (!isCancelled) {
        fitTitle();
      }
    });

    return () => {
      isCancelled = true;
      observer.disconnect();
    };
  }, [fitTitle, rowElement, titleText]);

  return { isStacked, rowRef, textRef, titleRef };
}
