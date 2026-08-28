import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { SketchCard, SketchIconButton } from "./SketchUI";
import { useCompactRoster } from "../useCompactRoster";
import { useOverflowMenu } from "../useOverflowMenu";

/**
 * The buttons on the end of a roster row.
 *
 * On a roomy viewport they are the row: replace, ticket, remove, whatever the
 * list hands over, sitting inline exactly as they always have. On a narrow one
 * they collapse behind a single "..." circle and open in a popover, because
 * three buttons plus a number, an avatar, a name and two badges have nowhere
 * to go on a phone.
 *
 * The popover is portalled to the body rather than positioned inside the row:
 * roster lists scroll inside a fixed max-height, and an absolutely positioned
 * menu would be clipped by that. See useOverflowMenu, which owns that and the
 * rest of the popover's behaviour.
 */
function RosterRowActions({ children, menuLabel = "More actions" }) {
  const isCompact = useCompactRoster();
  const { close, isOpen, menuPosition, menuRef, toggle, triggerRef } = useOverflowMenu({
    isEnabled: isCompact,
  });

  if (!isCompact) {
    return <>{children}</>;
  }

  return (
    <>
      <SketchIconButton
        ref={triggerRef}
        type="button"
        className="roster-overflow-button"
        aria-expanded={isOpen ? "true" : "false"}
        aria-haspopup="true"
        aria-label={menuLabel}
        title={menuLabel}
        onClick={toggle}
      >
        <Ellipsis aria-hidden="true" className="button-icon" />
      </SketchIconButton>
      {isOpen && menuPosition
        ? createPortal(
            <div className="roster-overflow-menu-layer" ref={menuRef} style={menuPosition}>
              {/* The card is drawn to a canvas sized from its own box, and it
                  mounts here with its buttons still laying out — so ask for the
                  redraw that gets the outline around the finished size. */}
              <SketchCard
                className="roster-overflow-menu sketch-entry-card"
                elevation={1}
                fill="#fffdf8"
                redrawDelayMs={60}
                redrawOnResize
                strokeColor="#111111"
              >
                {/* The same buttons, in the same shapes, so a row reads the
                    same whichever side of the breakpoint it is on. Any of them
                    finishing the job means the menu has served its purpose. */}
                <div className="roster-overflow-menu-items" onClick={close}>
                  {children}
                </div>
              </SketchCard>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export { RosterRowActions };
