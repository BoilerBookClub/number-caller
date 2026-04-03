import QRCode from "react-qr-code";
import bbcLogo from "../assets/bbc_logo.png";
import infoIcon from "../assets/info.svg";
import notificationIcon from "../assets/notification.svg";
import { getEventTitleClassName } from "../titleFonts";

function ClaimRulesModal({
  liveState,
  onAcknowledgeRules,
}) {
  return (
    <div className="claim-rules-backdrop" role="presentation">
      <div className="claim-rules-modal" role="dialog" aria-modal="true" aria-label="Claim rules">
        <div className="claim-rules-content">
          <p className="eyebrow">Before You Start</p>
          <h2>Welcome to {liveState.title}!</h2>
          <div className="claim-rules-copy">
            <ol>
                <li>You will be assigned a number sequentially based on when you arrived.</li>
                <li>When your number is called, you can come up and claim one item.</li>
                <li>Before your number is called, read the book descriptions, which are linked below your
              number, so you know what you&apos;d like to grab.</li>
                <li>After you claim your item, a staff member will scan your QR code to confirm your claim.</li>
                <li>There will likely be multiple rounds of goodie selection, so once the current round
              ends, you&apos;ll be up again for more. You&apos;ll want to stick around.</li>
            </ol>
          </div>
          <div className="claim-rules-actions">
            <button type="button" onClick={onAcknowledgeRules}>
              Got it!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClaimResultCard({
  areClaimNotificationsEnabled,
  claimQrPayload,
  claimRecord,
  claimResult,
  currentRound,
  hasClaimedCurrentRound,
  liveCallLabel,
  notificationPermission,
  onOpenClaimRules,
  onOpenBookList,
  onToggleClaimNotifications,
  showClaimQr,
}) {
  const notificationButtonLabel = areClaimNotificationsEnabled
    ? "Notifications On"
    : notificationPermission === "unsupported"
      ? "Notifications Unavailable"
      : "Notifications Off";
  const isClaimActive = Boolean(showClaimQr && claimRecord);

  return (
    <div className={`entry-card assigned-card claim-modal-card${showClaimQr ? " claim-modal-card--active" : ""}`}>
      <button
        className={`secondary-button claim-corner-button claim-corner-button--left${areClaimNotificationsEnabled ? " claim-corner-button--active" : ""}`}
        type="button"
        onClick={onToggleClaimNotifications}
        aria-label={notificationButtonLabel}
        title={notificationButtonLabel}
      >
        <img src={notificationIcon} alt="" className="button-icon" />
      </button>
      <button
        className="secondary-button claim-corner-button claim-corner-button--right"
        type="button"
        onClick={onOpenClaimRules}
        aria-label="Read event info"
        title="Read event info"
      >
        <img src={infoIcon} alt="" className="button-icon" />
      </button>
      <div className="claim-ticket-logo-wrap">
        <img src={bbcLogo} alt="Boiler Book Club logo" className="claim-ticket-logo" />
      </div>
      <p className={`eyebrow${showClaimQr ? " eyebrow--active rainbow-text" : ""}`}>
        {showClaimQr ? "You're up!" : "You're in line"}
      </p>
      <h2>Your number is</h2>
      <div className={`assigned-number${showClaimQr ? " rainbow-text" : ""}`}>
        {claimResult.number}
      </div>
      <p>
        {showClaimQr
          ? `Your turn is active for round ${currentRound}. A staff member will scan this QR code after you pick one item.`
          : "Your spot is saved. Watch the display screen to see when your number is called."}
      </p>
      {isClaimActive ? (
        <div className="claim-qr-inline-block">
          <div className="claim-qr-box">
            <QRCode value={claimQrPayload} size={180} />
          </div>
          <p className="eyebrow eyebrow--active rainbow-text">Show This To Staff</p>
        </div>
      ) : null}
      <div className="claim-card-actions">
        <button className="secondary-button" type="button" onClick={onOpenBookList}>
          Open Book Descriptions
        </button>
      </div>
      <div className="claim-status-grid">
        <div className="stat-card">
          <span>Round</span>
          <strong>{currentRound}</strong>
        </div>
        <div className="stat-card">
          <span>Currently Calling</span>
          <strong>{liveCallLabel}</strong>
        </div>
      </div>
      <div className={`claim-qr-panel${isClaimActive ? " claim-qr-panel--active" : ""}`}>
        {claimRecord ? (
          showClaimQr ? null : hasClaimedCurrentRound ? (
            <p className="status-message status-message--success">
              You already claimed one item in round {currentRound}. Your QR code will
              return when the next round reaches your number again.
            </p>
          ) : (
            <p>
              Your QR code will appear here once the display reaches number {claimRecord.number}
              in round {currentRound}.
            </p>
          )
        ) : (
          <p>Syncing your claim status...</p>
        )}
      </div>
    </div>
  );
}

function MemberClaimCard({
  claimError,
  claimLoading,
  claimResult,
  eventStartLabel,
  isCheckingAccess,
  isClaimWindowOpen,
  isEventStarted,
  isMember,
  liveEvent,
  liveState,
  loggedIn,
  memberEarlyAccessLabel,
  memberEarlyAccessTime,
  onLogout,
  onStartOAuthGrant,
}) {
  return (
    <div className="entry-card claim-modal-card">
      <p className="eyebrow">Live Event</p>
      <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
      {liveEvent.timeframeLabel ? <p>{liveEvent.timeframeLabel}</p> : null}
      <h2>Claim Your Number</h2>
      <p>Log in with Discord and we'll assign your number automatically.</p>
      {!loggedIn ? (
        <button onClick={onStartOAuthGrant} disabled={isCheckingAccess || claimLoading}>
          {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
        </button>
      ) : null}
      {loggedIn && isCheckingAccess ? <p>Checking your membership...</p> : null}
      {loggedIn && claimLoading ? <p>Assigning your number...</p> : null}
      {loggedIn && !isCheckingAccess && !claimLoading && !isClaimWindowOpen ? (
        <p>
          {isMember && memberEarlyAccessTime
            ? `Logged in. Because you have the member role, you can claim starting at ${memberEarlyAccessLabel}.`
            : `Logged in. You need to wait for the event to start at ${eventStartLabel}.`}
        </p>
      ) : null}
      {loggedIn && !isCheckingAccess && !claimLoading && isClaimWindowOpen && !claimResult ? (
        <p>
          {isMember
            ? isEventStarted
              ? "Logged in with the member role. Your claim will be assigned automatically."
              : "Logged in with the member role. Early claim access is open, so your claim will be assigned automatically."
            : "Logged in. The event has started, so your claim will be assigned automatically."}
        </p>
      ) : null}
      {claimError ? <p className="entry-message">{claimError}</p> : null}
      {loggedIn ? (
        <button className="secondary-button" onClick={onLogout}>
          Logout
        </button>
      ) : null}
    </div>
  );
}

function ClaimPage(props) {
  const { claimResult, isClaimRulesOpen } = props;

  return (
    <div className="claim-page claim-page--focused">
      {claimResult ? <ClaimResultCard {...props} /> : null}
      {!claimResult ? <MemberClaimCard {...props} /> : null}
      {claimResult && isClaimRulesOpen ? <ClaimRulesModal {...props} /> : null}
    </div>
  );
}

export default ClaimPage;