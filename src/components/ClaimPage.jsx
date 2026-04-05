import QRCode from "react-qr-code";
import bbcLogo from "../assets/bbc_logo.png";
import Spinner from "./Spinner";
import displayIcon from "../assets/display.svg";
import infoIcon from "../assets/info.svg";
import notificationIcon from "../assets/notification.svg";
import scanIcon from "../assets/scan.svg";
import settingsIcon from "../assets/settings.svg";
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
        {!showClaimQr && "Watch the display screen to see when your number is called."}
      </p>
      {isClaimActive ? (
        <div className="claim-qr-inline-block">
          <p className="eyebrow eyebrow--active rainbow-text">Show This To Staff After Picking an Item</p>
          <div className="claim-qr-box">
            <QRCode value={claimQrPayload} size={180} />
          </div>
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
          <span>Currently</span>
          <strong>{liveCallLabel}</strong>
        </div>
      </div>
      <div className={`claim-qr-panel${isClaimActive ? " claim-qr-panel--active" : ""}`}>
        {claimRecord ? (
          showClaimQr ? null : hasClaimedCurrentRound ? (
            <p className="status-message status-message--success">
              You already claimed an item in round {currentRound}. Your QR code will return when the next round reaches your number again.
            </p>
          ) : (
            <p>
              Your QR code will appear here once the display reaches number {claimRecord.number} in round {currentRound}.
            </p>
          )
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
            <Spinner size={48} />
          </div>
        )}
      </div>
    </div>
  );
}

function MemberClaimCard({
  allowManualClaim,
  authError,
  claimError,
  claimLoading,
  claimResult,
  eventStartLabel,
  isCheckingAccess,
  isClaimWindowOpen,
  isEventStarted,
  isMember,
  hasTrustedStaffAccess,
  liveEvent,
  liveState,
  loggedIn,
  memberEarlyAccessLabel,
  memberEarlyAccessTime,
  onManualClaim,
  onRefreshMembership,
  onStartOAuthGrant,
  membershipRefreshPrompt,
}) {
  return (
    <div className="entry-card claim-modal-card">
      <p className="eyebrow">Live Event</p>
      {liveEvent.timeframeLabel ? <p style={{ margin: 0 }}>{liveEvent.timeframeLabel}</p> : null}
      <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
      <p>
      </p>
      {!loggedIn ? (
        <button onClick={onStartOAuthGrant} disabled={isCheckingAccess || claimLoading}>
          {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
        </button>
      ) : null}
      {loggedIn && isCheckingAccess ? <p>Checking your membership...</p> : null}
      {loggedIn && !isCheckingAccess && authError ? <p className="entry-message">{authError}</p> : null}
      {loggedIn && claimLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
          <Spinner size={56} />
        </div>
      ) : null}
      {loggedIn && !isCheckingAccess && !claimLoading && !authError && !isClaimWindowOpen ? (
        <>
          <h2>Logged in</h2>
          <p>
            {isMember && memberEarlyAccessTime
              ? `Thanks for being a member! You can claim your number early starting at ${memberEarlyAccessLabel}.`
              : `You'll need to wait for the event to start at ${eventStartLabel} to get your number.`}
          </p>
        </>
      ) : null}
      {loggedIn && !isCheckingAccess && !claimLoading && !authError && isClaimWindowOpen && !claimResult ? (
        <>
          <h2>Logged in</h2>
          <p>
            {allowManualClaim
              ? isMember
                ? isEventStarted
                  ? "Thanks for being a member. Click Give Me a Number when you want to join the line."
                : "Thanks for being a member. Early claim access is open, so you can click Give Me a Number whenever you're ready."
              : "The event has started, so you can click Give Me a Number whenever you're ready."
            : isMember
              ? isEventStarted
                ? "Thanks for being a member. Your claim will be assigned automatically."
                : "Thanks for being a member. Early claim access is open, so your claim will be assigned automatically."
              : "The event has started, so your claim will be assigned automatically."}
        </p>
        </>
      ) : null}
      {loggedIn && !isCheckingAccess && !claimLoading && !authError && !claimResult && allowManualClaim ? (
        <button type="button" onClick={onManualClaim}>
          Give Me a Number
        </button>
      ) : null}
      {loggedIn && !isCheckingAccess && !claimLoading && !authError && !isClaimWindowOpen && !hasTrustedStaffAccess ? (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onRefreshMembership}>
            Refresh membership
          </button>
          {membershipRefreshPrompt ? (
            <div style={{ marginTop: 8 }} className="entry-message">
              Refresh failed — please re-login with Discord to continue.
              <div style={{ marginTop: 6 }}>
                <button type="button" onClick={onStartOAuthGrant}>Re-login with Discord</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {claimError ? <p className="entry-message">{claimError}</p> : null}
    </div>
  );
}

function ClaimPage(props) {
  const {
    claimResult,
    isClaimRulesOpen,
    onOpenClaimScanner,
    onOpenControlPanel,
    onOpenDisplayScreen,
    showControlNavbar,
    hasTrustedStaffAccess,
    setScannerActive,
    setScanFeedback,
    changeMode,
  } = props;

  const handleOpenScanner = () => {
    if (hasTrustedStaffAccess && setScannerActive && setScanFeedback && changeMode) {
      setScanFeedback(null);
      changeMode("control");
      setTimeout(() => setScannerActive(true), 0);
    } else if (onOpenClaimScanner) {
      onOpenClaimScanner();
    }
  };

  return (
    <div className="claim-page claim-page--focused">
      {claimResult ? (
        <div style={showControlNavbar ? { marginBottom: '6.5rem' } : undefined}>
          <ClaimResultCard {...props} />
        </div>
      ) : null}
      {!claimResult ? <MemberClaimCard {...props} /> : null}
      {claimResult && isClaimRulesOpen ? <ClaimRulesModal {...props} /> : null}
      {showControlNavbar ? (
        <div className="bottom-navbar">
          <button className="secondary-button bottom-navbar-button" type="button" onClick={handleOpenScanner}>
            <img src={scanIcon} alt="" className="button-icon" />
            <span>Open Scanner</span>
          </button>
          <button className="secondary-button bottom-navbar-button" type="button" onClick={onOpenControlPanel}>
            <img src={settingsIcon} alt="" className="button-icon" />
            <span>Control Panel</span>
          </button>
          <button className="secondary-button bottom-navbar-button" type="button" onClick={onOpenDisplayScreen}>
            <img src={displayIcon} alt="" className="button-icon" />
            <span>Open Display</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ClaimPage;

// Debug preclaim controls removed