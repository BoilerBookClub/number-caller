import QRCode from "react-qr-code";

function DisplayPage({ isEventLive, liveEvent, liveState, rotatingClaimAccessUrl }) {
  if (!isEventLive) {
    return (
      <div className="display empty-state">
        <h1>The event isn&apos;t open yet.</h1>
      </div>
    );
  }

  return (
    <div className="display">
      <p className="eyebrow">{liveEvent.timeframeLabel}</p>
      <h1 className="carnival">{liveState.title}</h1>
      <h1>ROUND {liveState.round}</h1>

      <div className="display-content-row">
        <div className="display-main">
          {liveState.current === 0 && !liveState.finalCall ? (
            <div className="final-call">
              <h1 className="rainbow-text">Starting Soon</h1>
            </div>
          ) : !liveState.finalCall ? (
            <>
              <h1 className="number rainbow-text">
                {liveState.last + 1}-{liveState.current}
              </h1>
              <h1>may select an item now!</h1>
            </>
          ) : (
            <>
              <div className="final-call">
                <h1 className="rainbow-text">FINAL CALL</h1>
              </div>
              <h2>If you have NOT gotten an item yet, please come forward</h2>
            </>
          )}
        </div>

      </div>

      {rotatingClaimAccessUrl ? (
        <div className="display-claim-qr-row">
          <div className="rules-qr-container">
            <div className="qr-claim-copy">
              <h2 className="qr-caption">Scan to Claim Your Number</h2>
              <p className="qr-helper-text">This attendee QR refreshes every minute.</p>
            </div>
            <div className="qr-code qr-code--claim">
              <QRCode value={rotatingClaimAccessUrl} size={160} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DisplayPage;