import { useState } from "react";
import { LogIn, LogOut } from "lucide-react";

import bbcLogo from "../assets/bbc_logo.png";
import { SketchButton, SketchConfirmDialog, SketchIconButton } from "./SketchUI";

/**
 * The club mark, shown above every screen except the display — that one is
 * built to be read from across a room, and a header sized for a phone would
 * just be clutter on it. Never sticky: it scrolls off with the rest of the
 * page rather than shadowing content on the way down.
 *
 * actionsSlotRef, when given, mounts an empty right-aligned container here
 * that a caller (the live control screen) portals its own action buttons
 * into — that way this component doesn't need to know anything about them.
 *
 * onLogout, when given, fills that same right-aligned slot with a single
 * circle button, drawn to match the control screen's row of circles. The
 * attendee ticket has nowhere else to put it: the card below is the QR code
 * and belongs to the event, not to the session.
 *
 * onStaffLogin is the same corner from the other side: the way in, for the
 * screens shown to someone who is not signed in. Both live here now rather than
 * in a bottom bar, so the way in and the way out are one control in one place
 * on every screen that has either. Only one of the two is ever passed.
 *
 * Logout asks first. The circle sits in the corner of every signed-in screen,
 * a thumb's width from where a phone is held, and the click cannot be undone:
 * an attendee who takes it loses the ticket they are holding, and staff have to
 * go back through Discord. onLogout is called only once the dialog is answered.
 *
 * It keeps its words where Logout is a bare circle: Logout is offered to
 * someone who already knows what they are signed in to, but this one has to be
 * found by a staff member looking for a way in, on a page addressed to
 * attendees. An icon alone in the corner is not that.
 */
export default function AppHeader({
  actionsSlotRef,
  isStaffLoginPending = false,
  onLogout,
  onStaffLogin,
}) {
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-lockup">
        <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo app-header-logo" />
        <span className="app-header-title">Event Pass</span>
      </div>
      {actionsSlotRef ? (
        <div ref={actionsSlotRef} className="app-header-actions" />
      ) : onLogout ? (
        <div className="app-header-actions">
          <SketchIconButton
            className="secondary-button icon-button app-header-action"
            type="button"
            onClick={() => setIsLogoutConfirmOpen(true)}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut aria-hidden="true" className="button-icon" />
          </SketchIconButton>
        </div>
      ) : onStaffLogin ? (
        <div className="app-header-actions">
          <SketchButton
            className="secondary-button app-header-login"
            type="button"
            onClick={onStaffLogin}
            disabled={isStaffLoginPending}
            title={isStaffLoginPending ? "Checking Discord..." : "Staff login"}
          >
            <div className="bottom-navbar-content">
              <LogIn aria-hidden="true" className="button-icon" />
              <span>{isStaffLoginPending ? "Checking Discord..." : "Staff Login"}</span>
            </div>
          </SketchButton>
        </div>
      ) : null}
      {/* Outside .app-header-actions on purpose: wired-dialog's host box is an
          empty inline element (all of it is painted from a fixed overlay), and
          a row with a gap would still count it as an item and push the circle
          off its corner. */}
      {onLogout ? (
        <SketchConfirmDialog
          open={isLogoutConfirmOpen}
          title="Log out?"
          message="You'll need to sign in again to get back to this screen."
          confirmLabel="Log Out"
          tone="danger"
          onCancel={() => setIsLogoutConfirmOpen(false)}
          onConfirm={() => {
            setIsLogoutConfirmOpen(false);
            onLogout();
          }}
        />
      ) : null}
    </header>
  );
}
