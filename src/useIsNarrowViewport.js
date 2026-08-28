import { useEffect, useState } from "react";

/**
 * Whether the viewport is at or below the given width.
 *
 * Layout breakpoints elsewhere in this app live entirely in CSS `@media`
 * queries, but a couple of decisions (like whether two lists have room to
 * sit side by side) have to be made in JS so a click handler can decide
 * whether to enforce single-selection. This is the one shared way to ask
 * that question from script.
 */
export default function useIsNarrowViewport(breakpointPx) {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpointPx,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const handleChange = (event) => setIsNarrow(event.matches);

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [breakpointPx]);

  return isNarrow;
}
