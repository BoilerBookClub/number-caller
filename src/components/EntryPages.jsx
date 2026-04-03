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
  hasFullAccess,
  isCheckingAccess,
  loggedIn,
  onOpenControl,
  onStartOAuthGrant,
}) {
  return (
    <div className="entry-screen">
      <div className="entry-card">
        <h2>Staff Login</h2>
        <p>Log in with Discord to open the control panel and start the event.</p>
        {!loggedIn || !hasFullAccess ? (
          <button onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
          </button>
        ) : null}
        {loggedIn && hasFullAccess && !isCheckingAccess ? (
          <button onClick={onOpenControl}>Open Control Panel</button>
        ) : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login is not on the staff allowlist, so it stays on this page.
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
        <h1>{liveState.title}</h1>
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