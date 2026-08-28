import { useState } from "react";

import bbcLogo from "../assets/bbc_logo.png";
import { SketchButton, SketchCard, SketchConfirmDialog, SketchMessageDialog } from "./SketchUI";
import { getEventTitleClassName } from "../titleFonts";

/* The club's public calendar. The only useful next step for someone who lands
   here between events, so both closed-event cards offer it. */
const UPCOMING_EVENTS_URL = "https://www.boilerbookclub.com/events";

/*
 * A SketchButton wrapped in an anchor, because SketchButton renders a
 * <wired-button> custom element and cannot take an href of its own. The anchor
 * owns the navigation and the focus stop; the custom element is taken out of
 * the tab order so the pair is a single target rather than two.
 */
function UpcomingEventsLink() {
  return (
    <a
      className="entry-hero-link"
      href={UPCOMING_EVENTS_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      <SketchButton className="secondary-button" tabIndex={-1}>
        See Upcoming Events
      </SketchButton>
    </a>
  );
}

/**
 * Shown at /control to someone signed in who does not hold the staff role.
 *
 * It no longer offers a login of its own. There is exactly one way in — the
 * staff button on "/" — and anyone reaching /control signed out is redirected
 * there instead of being shown a second login card. Logging out here is enough
 * to leave: it makes the redirect fire and lands them on that button.
 *
 * It confirms first, the same as the header's circle does — one button on an
 * otherwise empty card is an easy thing to hit on the way to reading it.
 */
function ControlAccessDenied({
  authError,
  handleLogout,
  hasFullAccess,
  isCheckingAccess,
  onDismissAuthError,
}) {
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  return (
    <div className="entry-screen">
      <SketchCard className="entry-card-centered-login entry-hero sketch-entry-card" elevation={2}>
        <h2 className="entry-heading-with-logo">
          <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
          <span>Event Staff Login</span>
        </h2>
        <div className="entry-staff-action entry-staff-action--stack">
          <SketchButton className="secondary-button" onClick={() => setIsLogoutConfirmOpen(true)}>
            Logout
          </SketchButton>
        </div>
        <SketchConfirmDialog
          open={isLogoutConfirmOpen}
          title="Log out?"
          message="You'll need to sign in with Discord again to try the staff panel."
          confirmLabel="Log Out"
          tone="danger"
          onCancel={() => setIsLogoutConfirmOpen(false)}
          onConfirm={() => {
            setIsLogoutConfirmOpen(false);
            handleLogout();
          }}
        />
        <SketchMessageDialog message={authError} onDismiss={onDismissAuthError} />
        {!hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login does not have the special role required to use staff controls.
          </p>
        ) : null}
      </SketchCard>
    </div>
  );
}

/*
 * Staff login is not here: it is the circle in the top-right of the header,
 * where Logout sits once anyone is signed in. See AppHeader's onStaffLogin.
 * This page keeps the message dialog that login can raise, because a refusal
 * has to be read next to the card it applies to rather than under the corner
 * it was started from.
 */
function ClosedEventPage({
  endedEventTitle,
  onDismissStaffLoginMessage,
  staffLoginMessage,
}) {
  return (
    <div className="entry-screen">
      {endedEventTitle ? (
        <SketchCard className="entry-card hero-card entry-hero sketch-entry-card" elevation={2}>
          <div className="entry-hero-lockup">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
            <p className="eyebrow">The Event Has Ended</p>
          </div>
          <div className="entry-hero-body">
            <h1>Thanks for coming to {endedEventTitle}!</h1>
            <p className="entry-hero-note">See you again soon ;)</p>
          </div>
          <div className="entry-staff-action">
            <UpcomingEventsLink />
          </div>
        </SketchCard>
      ) : (
        <SketchCard className="entry-card hero-card entry-hero sketch-entry-card" elevation={2}>
          <div className="entry-hero-body">
            <h1>No event is currently live</h1>
            <p className="entry-hero-note">Looks like you're a little early! Check out our upcoming events below. If you're staff, use the login button in the top corner to start an event.</p>
            <SketchMessageDialog message={staffLoginMessage} onDismiss={onDismissStaffLoginMessage} />
          </div>
          <div className="entry-staff-action">
            <UpcomingEventsLink />
          </div>
        </SketchCard>
      )}
    </div>
  );
}

/**
 * The attendee gate: a live event is running, but this visitor has not scanned
 * a check-in code.
 *
 * The header carries the staff login here too, because "/" is now the only way
 * in and this is what "/" looks like during an event. Without it, a staff
 * member opening /control mid-event would be redirected here and find no way to
 * sign in — at exactly the moment they need one.
 */
function ClaimAccessGatePage({
  claimAccessStatus,
  liveEvent,
  liveState,
  onDismissStaffLoginMessage,
  staffLoginMessage,
}) {
  return (
    <div className="entry-screen">
      <SketchCard className="entry-card-centered hero-card entry-hero sketch-entry-card" elevation={2}>
        <p className="eyebrow eyebrow--live">
          <span className="eyebrow-live-dot" aria-hidden="true" />
          Live Event
        </p>
        {liveEvent.timeframeLabel ? <p className="entry-hero-note">{liveEvent.timeframeLabel}</p> : null}
        <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
        {claimAccessStatus ? <p className="entry-message">{claimAccessStatus}</p> : null}
        <SketchMessageDialog message={staffLoginMessage} onDismiss={onDismissStaffLoginMessage} />
      </SketchCard>
    </div>
  );
}

/**
 * Shown to staff right after they end an event.
 *
 * Ending an event signs staff out, which used to drop them on the attendee
 * "no event is open" page — a confusing thing to see immediately after running
 * one. This says goodbye to the person who just did the work.
 */
function EventWrappedPage({ eventTitle, onDismiss }) {
  return (
    <div className="entry-screen">
      <SketchCard className="entry-card hero-card entry-hero sketch-entry-card" elevation={2}>
        <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
        <p className="eyebrow">That&apos;s a Wrap</p>
        <h1>Congrats on an amazing event!</h1>
        <p>
          {eventTitle ? `${eventTitle} is` : "The event is"} closed out and everyone
          has been signed off. The attendee list and totals are saved under Past
          Events.
        </p>
        <div className="staff-landing-actions">
          <SketchButton type="button" onClick={onDismiss}>
            Done
          </SketchButton>
        </div>
      </SketchCard>
    </div>
  );
}

export {
  ClaimAccessGatePage,
  ClosedEventPage,
  ControlAccessDenied,
  EventWrappedPage,
  UpcomingEventsLink,
};
