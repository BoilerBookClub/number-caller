import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { SketchButton, SketchCard, SketchIconButton } from "./SketchUI";
import { useOverflowMenu } from "../useOverflowMenu";

/**
 * The header's circle buttons, folded into one "..." circle.
 *
 * Rendered instead of that row once the header runs out of width for it — see
 * HEADER_ACTIONS_COLLAPSE_BREAKPOINT_PX in ControlPage, which decides when.
 * It sits to the right of End Event rather than in the row's old place: End
 * Event is the one button in the header staff actually reach for mid-event, so
 * the collapse takes width away from the secondary actions and leaves the
 * primary one where it was.
 *
 * The circles become labelled rows on the way in. An icon-only button can get
 * away with carrying its name in a tooltip when it is one of four in a row that
 * staff learn by position, but a stack of anonymous circles in a popover is
 * a guessing game — and a menu has the width to just say what each one does.
 */
export default function HeaderActionsMenu({ actions, menuLabel = "More actions" }) {
  const { close, isOpen, menuPosition, menuRef, toggle, triggerRef } = useOverflowMenu();

  return (
    <>
      <SketchIconButton
        ref={triggerRef}
        type="button"
        className="secondary-button icon-button control-side-action header-overflow-button"
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
            <div className="header-overflow-menu-layer" ref={menuRef} style={menuPosition}>
              {/* Drawn to a canvas sized from its own box, and it mounts with
                  its buttons still laying out — so ask for the redraw that gets
                  the outline around the finished size. */}
              <SketchCard
                className="header-overflow-menu sketch-entry-card"
                elevation={1}
                fill="#fffdf8"
                redrawDelayMs={60}
                redrawOnResize
                strokeColor="#111111"
              >
                <div className="header-overflow-menu-items">
                  {actions.map(({ disabled, icon, isActive, key, label, onClick, title }) => (
                    <SketchButton
                      key={key}
                      type="button"
                      /* A toggle among the entries wears the same filled-in
                         state its circle does, so the menu says what the row
                         would have said. */
                      className={`secondary-button header-overflow-menu-item${
                        isActive ? " header-overflow-menu-item--on" : ""
                      }`}
                      aria-pressed={isActive === undefined ? undefined : isActive}
                      disabled={disabled}
                      /* Closed from the entry rather than from a click handler
                         on the wrapper: SketchButton swallows a disabled
                         button's click, so a tap that does nothing should not
                         dismiss the menu either. */
                      onClick={() => {
                        close();
                        onClick();
                      }}
                      title={title}
                    >
                      <div className="bottom-navbar-content">
                        {icon}
                        <span>{label}</span>
                      </div>
                    </SketchButton>
                  ))}
                </div>
              </SketchCard>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
