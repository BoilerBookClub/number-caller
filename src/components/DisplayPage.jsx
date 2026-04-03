import QRCode from "react-qr-code";
import bbcLogo from "../assets/bbc_logo.png";
import { getEventTitleClassName } from "../titleFonts";

function DisplayPage({
  isEventLive,
  liveEvent,
  liveState,
  nextQrCountdownSeconds,
  qrRotationProgress,
  rotatingClaimAccessUrl,
}) {
  if (!isEventLive) {
    return (
      <div className="display empty-state">
        <h1>The event isn&apos;t open yet.</h1>
      </div>
    );
  }

  const countdownLabel =
    nextQrCountdownSeconds === 1
      ? "Next QR code in 1 second"
      : `Next QR code in ${nextQrCountdownSeconds} seconds`;

  return (
    <div className="display">
      <div className="display-logo-wrap">
        <img src={bbcLogo} alt="Boiler Book Club logo" className="display-logo" />
      </div>
      <p className="eyebrow">{liveEvent.timeframeLabel}</p>
      <h1 className={getEventTitleClassName(liveState.titleFont, "carnival")}>{liveState.title}</h1>
      <h2 style={{ color: "#7b5200" }}>ROUND {liveState.round}</h2>

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
                            <h2 style={{ color: "#7b5200" }}>may select an item now!</h2>
            </>
          ) : (
            <>
              <div className="final-call">
                <h1 className="rainbow-text">FINAL CALL</h1>
              </div>
              <h2 style={{ color: "#7b5200" }}>If you have NOT gotten an item yet, please come forward</h2>
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
              <div className="qr-refresh-status" aria-live="polite">
                <p className="qr-refresh-label">{countdownLabel}</p>
                <div className="qr-refresh-track" aria-hidden="true">
                  <div
                    className="qr-refresh-fill"
                    style={{ width: `${Math.max(0, Math.min(1, qrRotationProgress)) * 100}%` }}
                  />
                </div>
              </div>
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