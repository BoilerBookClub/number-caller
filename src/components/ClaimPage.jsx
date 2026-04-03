import QRCode from "react-qr-code";

function ClaimResultCard({
  claimQrPayload,
  claimRecord,
  claimResult,
  currentRound,
  hasClaimedCurrentRound,
  liveCallLabel,
  onOpenBookList,
  showClaimQr,
}) {
  return (
    <div className="entry-card assigned-card claim-modal-card">
      <p className="eyebrow">{showClaimQr ? "You&apos;re up!" : "You&apos;re in line"}</p>
      <h2>Your number is</h2>
      <div className={`assigned-number${showClaimQr ? " rainbow-text" : ""}`}>
        {claimResult.number}
      </div>
      <p>
        {showClaimQr
          ? "Come up and grab an item!"
          : "Your spot is saved. Watch the display screen to see when your number is called."}
      </p>
      <button className="secondary-button" onClick={onOpenBookList}>
        Open Book Descriptions
      </button>
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
      <div className="claim-qr-panel">
        {claimRecord ? (
          showClaimQr ? (
            <>
              <p className="eyebrow">Show This To Staff</p>
              <div className="claim-qr-box">
                <QRCode value={claimQrPayload} size={180} />
              </div>
              <p>
                Your turn is active for round {currentRound}. A staff member will scan
                this QR code after you pick one item.
              </p>
            </>
          ) : hasClaimedCurrentRound ? (
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
      <h1>{liveState.title}</h1>
      {liveEvent.timeframeLabel ? <p>{liveEvent.timeframeLabel}</p> : null}
      <h2>Claim Your Number</h2>
      <p>Log in with Discord and we&apos;ll assign your number automatically.</p>
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
  const { claimResult } = props;

  return (
    <div className="claim-page claim-page--focused">
      {claimResult ? <ClaimResultCard {...props} /> : null}
      {!claimResult ? <MemberClaimCard {...props} /> : null}
    </div>
  );
}

export default ClaimPage;