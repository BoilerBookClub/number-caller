import bbcLogo from "../assets/bbc_logo.png";
import { SketchButton, SketchCard } from "./SketchUI";
import { getEventTitleClassName } from "../titleFonts";

function ControlAccessDenied({
  authError,
  handleLogout,
  hasFullAccess,
  isCheckingAccess,
  loggedIn,
  onStartOAuthGrant,
}) {
  return (
    <div className="entry-screen">
      <SketchCard className="entry-card-centered-login sketch-entry-card" elevation={2}>
        <h2 className="entry-heading-with-logo">
          <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
          <span>Event Staff Login</span>
        </h2>
        <div className="entry-staff-action entry-staff-action--stack">
          {!loggedIn ? (
            <SketchButton onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
              {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
            </SketchButton>
          ) : null}
          {loggedIn ? (
            <SketchButton className="secondary-button" onClick={handleLogout}>
              Logout
            </SketchButton>
          ) : null}
        </div>
        {authError ? <p className="entry-message">{authError}</p> : null}
        {loggedIn && !hasFullAccess && !isCheckingAccess ? (
          <p className="entry-message">
            This login does not have the special role required to use staff controls.
          </p>
        ) : null}
      </SketchCard>
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
        <SketchCard className="entry-card hero-card sketch-entry-card" elevation={2}>
            <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
          <p className="eyebrow">The Event Has Ended</p>
          <h1>Thanks for coming to {endedEventTitle}!</h1>
          <p className="eyebrow">See you again soon ;)</p>
        </SketchCard>
      ) : null}
      {!endedEventTitle ? (
        <SketchCard className="entry-card-centered sketch-entry-card" elevation={2}>
          <h2 className="entry-heading-with-logo">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="inline-logo inline-logo--heading" />
            <span>Event Staff Login</span>
          </h2>
          <div className="entry-staff-action">
            {!loggedIn ? (
              <SketchButton onClick={onStartOAuthGrant} disabled={isCheckingAccess}>
                {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
              </SketchButton>
            ) : null}
            {loggedIn && hasFullAccess && !isCheckingAccess ? (
              <SketchButton onClick={onOpenControl}>Open Control Panel</SketchButton>
            ) : null}
            {loggedIn && !hasFullAccess && !isCheckingAccess ? (
              <SketchButton className="secondary-button" onClick={handleLogout}>
                Logout
              </SketchButton>
            ) : null}
          </div>
          {loggedIn && !hasFullAccess && !isCheckingAccess ? (
            <p className="entry-message">
              This login is not on the staff allowlist.
            </p>
          ) : null}
          {authError ? <p className="entry-message">{authError}</p> : null}
        </SketchCard>
      ) : null}
    </div>
  );
}

function ClaimAccessGatePage({
  claimAccessStatus,
  liveEvent,
  liveState,
}) {
  return (
    <div className="entry-screen">
      <SketchCard className="entry-card-centered hero-card sketch-entry-card" elevation={2}>
        <p className="eyebrow">Live Event</p>
        {liveEvent.timeframeLabel ? <p style={{ marginBottom: "0rem" }}>{liveEvent.timeframeLabel}</p> : null}
        <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
        {claimAccessStatus ? <p className="entry-message">{claimAccessStatus}</p> : null}
      </SketchCard>
    </div>
  );
}

export { ClaimAccessGatePage, ClosedEventPage, ControlAccessDenied };
