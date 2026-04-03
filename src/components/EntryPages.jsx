import bbcLogo from "../assets/bbc_logo.png";
import { getEventTitleClassName } from "../titleFonts";

function ControlAccessDenied({
  authError,
  handleLogout,
  hasFullAccess,
  isCheckingAccess,
  loggedIn,
  onMainPage,
  onStartOAuthGrant,
}) {
  return (
    <div className="entry-screen">
      <div className="entry-card">
        <h2>Control Panel Access</h2>
        <p>Only Discord users with the special role can access the control panel.</p>
        {!loggedIn ? (
          <button onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn ? (
          <button className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        ) : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login does not have the special role required to use staff controls.
          </p>
        ) : null}
      </div>
      <div className="entry-card">
        <h2>Return to Sign Up</h2>
        <p>Go back to the attendee page.</p>
        <button onClick={onMainPage}>Main Page</button>
      </div>
    </div>
  );
}

function ClosedEventPage({
  authError,
  endedEventTitle,
  hasFullAccess,
  isCheckingAccess,
  loggedIn,
  onOpenControl,
  onStartOAuthGrant,
}) {
  return (
    <div className="entry-screen">
      {endedEventTitle ? (
        <div className="entry-card hero-card">
          <p className="eyebrow">Event Complete</p>
          <h1>Thanks for coming to {endedEventTitle}!!!</h1>
        </div>
      ) : null}
      <div className="entry-card">
        <h2 className="entry-heading-with-logo">
          <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
          <span>Event Staff Login</span>
        </h2>
        <div className="entry-staff-action">
          {!loggedIn || !hasFullAccess ? (
            <button onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
              {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
            </button>
          ) : null}
          {loggedIn && hasFullAccess && !isCheckingAccess ? (
            <button onClick={onOpenControl}>Open Control Panel</button>
          ) : null}
        </div>
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login is not on the staff allowlist.
          </p>
        ) : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
      </div>
    </div>
  );
}

function ClaimAccessGatePage({
  authError,
  claimAccessStatus,
  hasFullAccess,
  isCheckingAccess,
  liveEvent,
  liveState,
  loggedIn,
  onOpenControl,
  onStartOAuthGrant,
}) {
  return (
    <div className="entry-screen">
      <div className="entry-card hero-card">
        <p className="eyebrow">Live Event</p>
        <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
        {liveEvent.timeframeLabel ? <p>{liveEvent.timeframeLabel}</p> : null}
        <h2>Staff Login</h2>
        {!loggedIn || !hasFullAccess ? (
          <button onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn && hasFullAccess && !isCheckingAccess ? (
          <button onClick={onOpenControl}>Open Control Panel</button>
        ) : null}
        {claimAccessStatus ? <p className="entry-message">{claimAccessStatus}</p> : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
      </div>
    </div>
  );
}

export { ClaimAccessGatePage, ClosedEventPage, ControlAccessDenied };