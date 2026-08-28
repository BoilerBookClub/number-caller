import { buildScrollFadeClassName } from "../useScrollEdges";

/**
 * The box a faded list's mask lives on — a wrapper around the scroller, never
 * the scroller itself.
 *
 * The fade is a `mask-image` (App.css, `.scroll-fade--top` and friends), and a
 * mask has to be applied to whatever the element it sits on paints. Put it on
 * the scroll container and that is a different picture on every frame of every
 * scroll, so WebKit stops handing the list to the compositor and repaints the
 * whole thing instead — which on a phone, with every row drawn as a rough.js
 * SVG, is a flick that outruns the paint: the screen goes blank for a beat,
 * then arrives all at once, and taps queue behind the catch-up. Out here the
 * mask is a static image over a box that does not move, and the scroller inside
 * keeps a composited layer of its own.
 *
 * The scroller stays exactly as it was — its classes, its ref, its onScroll and
 * its role all belong to the element that actually scrolls, which is also the
 * element useScrollEdges measures. Only the fade classes moved.
 *
 * ---
 *
 * This element must stay a plain block box: no padding, no border, no
 * `overflow`, no `display: flow-root` or `flex`, no `contain`. Any one of those
 * makes it a block formatting context, and `.roster-list` carries a
 * `margin-top: 1.25rem` that currently collapses straight through it. Trap that
 * margin inside and the wrapper grows a 1.25rem band of empty space above the
 * first row — which is then what the top fade fades, instead of the row. A mask
 * does not establish a formatting context, which is the only reason this works
 * at all; everything else on that list does.
 */
export default function ScrollFade({ edges, children }) {
  return <div className={`scroll-fade${buildScrollFadeClassName(edges)}`}>{children}</div>;
}
