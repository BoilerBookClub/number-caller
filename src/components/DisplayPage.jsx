import QRCode from "react-qr-code";
import bbcLogo from "../assets/bbc_logo.png";
import { getEventTitleClassName } from "../titleFonts";
import { SketchCard, SketchProgress } from "./SketchUI";

function DisplayPage({
  displayFeedItems,
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
        <h1>No event is currently live.</h1>
      </div>
    );
  }

  const countdownLabel =
    nextQrCountdownSeconds === 1
      ? "Next QR code in 1 second"
      : `Next QR code in ${nextQrCountdownSeconds} seconds`;

  return (
    <div className="display">
      <div className="display-stage">
        <div className="display-header-group">
          <p className="eyebrow">{liveEvent.timeframeLabel}</p>
          <div className="display-title-row">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="display-logo" />
            <h1 className={getEventTitleClassName(liveState.titleFont, "carnival")}>{liveState.title}</h1>
          </div>
        </div>

        <div className="display-call-block">
          <h2 className="display-round">ROUND {liveState.round}</h2>
          <div className="display-content-row">
            <div className="display-main">
              {liveState.current === 0 && !liveState.finalCall ? (
                <div className="final-call">
                  <h1>Starting Soon</h1>
                </div>
              ) : !liveState.finalCall ? (
                <>
                  <h1 className="number">
                    {liveState.last + 1}-{liveState.current}
                  </h1>
                  <h2 className="display-call-subtitle">may select an item now!</h2>
                </>
              ) : (
                <>
                  <div className="final-call">
                    <h1>FINAL CALL</h1>
                  </div>
                  <h2 className="display-call-subtitle">If you have NOT gotten an item yet, please come forward</h2>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="display-stage-spacer" aria-hidden="true" />
      </div>

      {rotatingClaimAccessUrl ? (
        <div className="display-claim-qr-row">
          <SketchCard
            className="rules-qr-container sketch-entry-card"
            elevation={1}
            fill="#ffffff"
            strokeColor="#111111"
          >
            <div className="rules-qr-layout">
              <div className="qr-claim-copy">
                <h2 className="qr-caption">Scan to Claim Your Number</h2>
                <p className="qr-helper-text">This attendee QR refreshes every minute.</p>
                <div className="qr-refresh-status" aria-live="polite">
                  <p className="qr-refresh-label">{countdownLabel}</p>
                  <SketchProgress
                    className="qr-refresh-track"
                    value={Math.max(0, Math.min(1, qrRotationProgress)) * 100}
                    min={0}
                    max={100}
                    aria-hidden="true"
                  />
                </div>
              </div>
              <div className="qr-code qr-code--claim">
                <QRCode value={rotatingClaimAccessUrl} size={160} />
              </div>
            </div>
          </SketchCard>
        </div>
      ) : null}

      {displayFeedItems.length ? (
        <div className="display-feed-overlay" aria-live="polite" aria-atomic="false">
          {displayFeedItems.map((feedItem) => (
            <div key={feedItem.id} className="display-feed-item">
              <div className="display-feed-avatar" aria-hidden="true">
                {feedItem.avatarUrl ? (
                  <img src={feedItem.avatarUrl} alt="" className="display-feed-avatar-image" />
                ) : (
                  <span className="display-feed-avatar-fallback">
                    {(feedItem.username?.trim()?.charAt(0) ?? "?").toUpperCase()}
                  </span>
                )}
              </div>
              <p className="display-feed-copy">
                <strong className={`display-feed-name${feedItem.isMember ? " display-feed-name--member rainbow-text" : ""}`}>
                  {feedItem.username}
                </strong>{" "}
                {feedItem.action}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default DisplayPage;
