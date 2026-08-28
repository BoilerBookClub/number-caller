import { useEffect } from "react";

/**
 * Keeps two fixed-position fills matched to the page fade they sit in front of.
 *
 * The page fade is a gradient on the root element, running from its top
 * colour to its bottom colour over the height of the document — extended past
 * both ends so rubber-band overscroll has nothing white to reveal. Two things
 * pinned to the viewport rather than the document sit on top of that gradient,
 * and neither can just declare a colour of its own:
 *
 * - The rubber-band overhang itself. The browser paints it with the root's
 *   background *colour* alone — the gradient image is not drawn out there —
 *   so whatever single colour is set shows at both ends. One colour cannot
 *   serve both, so it follows the scroll instead: past the halfway mark the
 *   root switches to the gradient's bottom colour, the only end a bounce can
 *   reach from there. The swap is invisible when it happens — the gradient
 *   covers the whole document, so this colour is only ever seen in the
 *   overhang itself. The two colours live in index.css, on `:root` and
 *   `:root.page-past-middle`.
 *
 * - The bottom navbar's fade (App.css `.bottom-navbar-fade`), which stands in
 *   for the scrolling content it covers. That content is always at the
 *   gradient colour for its position in the *document*, but the fade is fixed
 *   to the *viewport*'s foot — so as the page scrolls, the colour behind it
 *   changes, and a fixed fade colour would fall out of step with anything but
 *   a page scrolled exactly to its end. It is kept in step here by computing,
 *   on every scroll, how far down the document the foot of the viewport
 *   currently is, and setting --bottom-navbar-fade-color (index.css declares
 *   the fallback) on the fade itself to the gradient's colour at that point.
 *
 * FADE_TOP_RGB / FADE_BOTTOM_RGB are plain copies of index.css's
 * --page-fade-top / --page-fade-bottom: a custom property cannot be read back
 * as numbers to interpolate between, so this keeps its own, and a change to
 * either pair has to be made in both places.
 */
const PAST_MIDDLE_CLASS = "page-past-middle";
const FADE_COLOR_PROPERTY = "--bottom-navbar-fade-color";
const FADE_ELEMENT_SELECTOR = ".bottom-navbar-fade";
/* How long after the last scroll event the page counts as having come to rest. */
const SCROLL_SETTLE_MS = 150;
const FADE_TOP_RGB = [0xfe, 0xf9, 0xef]; // --page-fade-top: #fef9ef
const FADE_BOTTOM_RGB = [0xf6, 0xfb, 0xff]; // --page-fade-bottom: #f6fbff

const fadeColorAt = (t) => {
  const clamped = Math.min(1, Math.max(0, t));
  const [r, g, b] = FADE_TOP_RGB.map(
    (channel, index) => channel + (FADE_BOTTOM_RGB[index] - channel) * clamped,
  );

  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
};

export default function useOverscrollBackground() {
  useEffect(() => {
    const { documentElement } = document;
    let frameId = null;

    /*
     * The document's own measurements, taken outside the scroll handler.
     *
     * scrollHeight and clientHeight are layout reads: asking for either one
     * flushes whatever style and layout work is pending. Read from inside the
     * scroll frame — which is also where this writes a style — they made every
     * frame of every scroll a forced synchronous layout of the whole document,
     * on a page whose control panel is several hundred drawn elements deep.
     * That is the phone freezing mid-flick, and taps landing on a main thread
     * that is still laying the page out.
     *
     * Neither number can change while the page is merely being scrolled, so
     * they are taken when something that *can* change them happens — a resize,
     * or the ResizeObserver below — and the scroll frame reads window.scrollY
     * alone, which is free.
     */
    let scrollHeight = documentElement.scrollHeight;
    let clientHeight = documentElement.clientHeight;
    let isPastMiddle = null;

    const apply = () => {
      frameId = null;

      const scrollable = scrollHeight - clientHeight;

      // A page that does not scroll has no half to be past, and no scroll
      // position that could tell the two bounce directions apart. It keeps the
      // top colour, which is the one its content starts on.
      const nextIsPastMiddle = scrollable > 0 && window.scrollY > scrollable / 2;

      // Compared before writing: the class lives on the root, so toggling it is
      // the one write here that can cost more than the element it lands on.
      if (nextIsPastMiddle !== isPastMiddle) {
        isPastMiddle = nextIsPastMiddle;
        documentElement.classList.toggle(PAST_MIDDLE_CLASS, nextIsPastMiddle);
      }

      // Where the foot of the viewport sits in the document, as a fraction of
      // the document's height — 0 at the very top, 1 once scrolled all the way
      // down. scrollHeight is never less than clientHeight (body carries a
      // min-height), so this never has to guard a divide by zero.
      const documentPosition = (window.scrollY + clientHeight) / scrollHeight;
      const fadeColor = fadeColorAt(documentPosition);

      /*
       * Set on the fades themselves rather than on the root.
       *
       * A custom property is inherited, so writing one to the root is a change
       * every element in the document has to be re-resolved against — and this
       * one is written on every frame of every scroll. The two elements that
       * actually read it have no children, so writing it there costs a leaf
       * apiece instead of the whole tree.
       *
       * Re-queried each time rather than held: the fade is rendered per page,
       * so the node this is writing to is replaced whenever the route changes,
       * and writing to all of them unconditionally is what gets a freshly
       * mounted one off the stylesheet's fallback colour.
       */
      const fades = document.querySelectorAll(FADE_ELEMENT_SELECTOR);

      for (const fade of fades) {
        fade.style.setProperty(FADE_COLOR_PROPERTY, fadeColor);
      }
    };

    const schedule = () => {
      if (frameId != null) {
        return;
      }

      frameId = window.requestAnimationFrame(apply);
    };

    const remeasure = () => {
      scrollHeight = documentElement.scrollHeight;
      clientHeight = documentElement.clientHeight;
      schedule();
    };

    /*
     * One re-measure once the finger has let go and the page has come to rest.
     *
     * The two numbers above are refreshed by everything that is supposed to be
     * able to change them, but scrollHeight is the document's scrollable extent
     * and the observer below watches the root's box, which are the same height
     * in this app rather than the same thing. This is the backstop for the gap
     * between those two: it costs one layout read per gesture instead of one
     * per frame, and it lands while nothing is moving, which is the cheapest
     * moment in a scroll to ask the browser anything.
     */
    let settleTimeoutId = null;

    const scheduleOnScroll = () => {
      schedule();

      if (settleTimeoutId != null) {
        window.clearTimeout(settleTimeoutId);
      }

      settleTimeoutId = window.setTimeout(() => {
        settleTimeoutId = null;
        remeasure();
      }, SCROLL_SETTLE_MS);
    };

    remeasure();

    window.addEventListener("scroll", scheduleOnScroll, { passive: true });
    window.addEventListener("resize", remeasure);

    // Panels and modals open and close without scrolling or resizing anything,
    // and each one changes where the middle of the page is — and how tall the
    // document that middle is measured against is, which is the other half of
    // why the measurement above can safely sit out here.
    let resizeObserver = null;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(remeasure);
      resizeObserver.observe(documentElement);
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }

      if (settleTimeoutId != null) {
        window.clearTimeout(settleTimeoutId);
      }

      window.removeEventListener("scroll", scheduleOnScroll);
      window.removeEventListener("resize", remeasure);
      resizeObserver?.disconnect();
      documentElement.classList.remove(PAST_MIDDLE_CLASS);
      documentElement.style.removeProperty(FADE_COLOR_PROPERTY);

      for (const fade of document.querySelectorAll(FADE_ELEMENT_SELECTOR)) {
        fade.style.removeProperty(FADE_COLOR_PROPERTY);
      }
    };
  }, []);
}
