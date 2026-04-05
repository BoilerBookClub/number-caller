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
      <div className="entry-card-centered">
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
      <div className="entry-card-centered">
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
  handleLogout,
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
            <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
          <p className="eyebrow">The Event Has Ended</p>
          <h1>Thanks for coming to {endedEventTitle}!</h1>
          <p className="eyebrow">See you again soon ;)</p>
        </div>
      ) : null}
      {!endedEventTitle ? (
        <div className="entry-card-centered">
          <h2 className="entry-heading-with-logo">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
            <span>Event Staff Login</span>
          </h2>
          <div className="entry-staff-action">
            {!loggedIn ? (
              <button onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
                {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
              </button>
            ) : null}
            {loggedIn && hasFullAccess && !isCheckingAccess ? (
              <button onClick={onOpenControl}>Open Control Panel</button>
            ) : null}
            {loggedIn && !hasFullAccess && !isCheckingAccess ? (
              <button className="secondary-button" onClick={handleLogout}>
                Logout
              </button>
            ) : null}
          </div>
          {loggedIn && !hasFullAccess && !isCheckingAccess ? (
            <p className="entry-message">
              This login is not on the staff allowlist.
            </p>
          ) : null}
          {authError ? <p className="entry-message">{authError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ClaimAccessGatePage({
  authError,
  claimAccessStatus,
  handleLogout,
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
      <div className="entry-card-centered hero-card">
        <p className="eyebrow">Live Event</p>
        {liveEvent.timeframeLabel ? <p style={{ marginBottom: "0rem" }}>{liveEvent.timeframeLabel}</p> : null}
        <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
        {claimAccessStatus ? <p className="entry-message">{claimAccessStatus}</p> : null}
        {authError ? <p className="entry-message">{authError}</p> : null}
      </div>
        <div className="entry-card-centered-login">
        <h2 className="entry-heading-with-logo">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
            <span>Event Staff Login</span>
        </h2>
        {/* Reserved spot label removed from staff login; shown on join modal after QR scan */}
        {!loggedIn ? (
          <button onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn && hasFullAccess && !isCheckingAccess ? (
          <button onClick={onOpenControl}>Open Control Panel</button>
        ) : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <button className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        ) : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login is not on the staff allowlist.
          </p>
        ) : null}
        </div>
    </div>
  );
}

export { ClaimAccessGatePage, ClosedEventPage, ControlAccessDenied };