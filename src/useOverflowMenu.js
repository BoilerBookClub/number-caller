import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* How much room the menu needs below its button before it flips above it. */
const MENU_FLIP_THRESHOLD_PX = 160;
const MENU_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The machinery behind a "..." button that opens a popover: where the popover
 * goes, and everything that ought to close it.
 *
 * Shared by the roster row's overflow menu and the app header's, which are the
 * same widget standing in two places — a trigger somewhere in the page and a
 * card portalled to the body, because what the trigger sits inside (a roster
 * list scrolling within a fixed max-height, a header row narrower than the menu
 * it opens) would otherwise clip it.
 *
 * `isEnabled` is the caller's "there is still something collapsed here". A row
 * or a header can widen back out while its menu is open — the buttons come back
 * inline and the trigger the menu is anchored to goes away — so the menu has to
 * go with it rather than hang off nothing.
 */
export function useOverflowMenu({ isEnabled = true } = {}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);

  useEffect(() => {
    if (!isEnabled) {
      setIsOpen(false);
    }
  }, [isEnabled]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const shouldFlipAbove = spaceBelow < MENU_FLIP_THRESHOLD_PX && rect.top > spaceBelow;

      setMenuPosition({
        right: Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - rect.right),
        ...(shouldFlipAbove
          ? { bottom: window.innerHeight - rect.top + MENU_GAP_PX }
          : { top: rect.bottom + MENU_GAP_PX }),
      });
    };

    updatePosition();

    /* Capture, so scrolling the container the trigger lives in — not only the
       page — keeps the menu on the button it belongs to. */
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((wasOpen) => !wasOpen), []);

  return {
    close,
    /* Guarded as well as closed by the effect above, so the render that turns
       the trigger back into inline buttons never also draws the popover. */
    isOpen: isOpen && isEnabled,
    menuPosition,
    menuRef,
    toggle,
    triggerRef,
  };
}
