function EventDetailsModal({
  controlForm,
  controlMessage,
  controlSaving,
  isEventLive,
  onClose,
  onFieldChange,
  onSubmit,
}) {
  return (
    <div className="event-modal-backdrop" role="presentation">
      <div className="event-modal" role="dialog" aria-modal="true" aria-label="Event details">
        {isEventLive ? (
          <div className="event-modal-header">
            <button
              type="button"
              className="event-modal-close"
              onClick={onClose}
              aria-label="Close event details"
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="event-modal-content">
          <h2>{isEventLive ? "Edit Event Details" : "Create Event"}</h2>
          <form className="control-form" onSubmit={onSubmit}>
            <label className="control-input-group control-input-group--centered">
              <span>Event Title</span>
              <input
                type="text"
                value={controlForm.title}
                onChange={onFieldChange("title")}
                placeholder="Enter event title"
              />
            </label>
            <label className="control-input-group control-input-group--centered">
              <span>Book List URL</span>
              <input
                type="url"
                value={controlForm.qrUrl}
                onChange={onFieldChange("qrUrl")}
                placeholder="Enter QR code destination"
              />
            </label>
            <div className="time-grid time-grid--centered">
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>Start Time</span>
                <input
                  type="time"
                  value={controlForm.timeframeStart}
                  onChange={onFieldChange("timeframeStart")}
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>End Time</span>
                <input
                  type="time"
                  value={controlForm.timeframeEnd}
                  onChange={onFieldChange("timeframeEnd")}
                />
              </label>
            </div>
            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}
            <div className="control-actions">
              <button type="submit" disabled={controlSaving}>
                {controlSaving
                  ? "Saving..."
                  : isEventLive
                    ? "Save Event Details"
                    : "Start Event"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ClaimList({ claims, currentRound, emptyText, isLastGroup, isFinalCall }) {
  if (!claims.length) {
    return <p>{emptyText}</p>;
  }

  const claimedCount = claims.filter((claim) => claim.redeemedRound === currentRound).length;

  return (
    <>
      <p className="queue-progress">
        {claimedCount}/{claims.length} have claimed
      </p>
      {!isFinalCall && isLastGroup ? (
        <p className="entry-message">This is the last group.</p>
      ) : null}
      <div className="roster-list" role="list">
        {claims.map((claim) => {
          const hasClaimedCurrentGroup = claim.redeemedRound === currentRound;

          return (
            <div key={claim.claimId} className="roster-row" role="listitem">
              <div className="roster-primary">
                <strong>#{claim.number}</strong>
                <span>{claim.displayName}</span>
              </div>
              <div className="roster-meta">
                <span
                  className={`roster-badge ${hasClaimedCurrentGroup ? "roster-badge--claimed" : "roster-badge--waiting"}`}
                >
                  {hasClaimedCurrentGroup ? "Claimed" : "Waiting"}
                </span>
                <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                <span
                  className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                >
                  {claim.isMember ? "Member" : "Not Member"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function FullRoster({ claims, totalPeopleWithNumbers }) {
  return (
    <div className="entry-card compact-card roster-card">
      <h2>Attendee Roster</h2>
      <p>Total people with numbers: {totalPeopleWithNumbers}</p>
      {claims.length ? (
        <div className="roster-list" role="list">
          {claims.map((claim) => (
            <div key={claim.claimId} className="roster-row" role="listitem">
              <div className="roster-primary">
                <strong>#{claim.number}</strong>
                <span>{claim.displayName}</span>
              </div>
              <div className="roster-meta">
                <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                <span
                  className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                >
                  {claim.isMember ? "Member" : "Not Member"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p>No attendees have claimed a number yet.</p>
      )}
    </div>
  );
}

function ScannerModal({ onClose, scanFeedback, scanLoading, scannerVideoRef }) {
  return (
    <div className="scanner-modal" role="dialog" aria-modal="true" aria-label="Claim scanner">
      <div className="scanner-modal-header">
        <button
          type="button"
          className="scanner-close-button"
          onClick={onClose}
          aria-label="Close scanner"
        >
          ×
        </button>
      </div>
      <div className="scanner-modal-body">
        <video ref={scannerVideoRef} className="scanner-video scanner-video--modal" muted playsInline />
      </div>
      <div className="scanner-modal-footer">
        <p>Point the camera at an attendee&apos;s QR code.</p>
      </div>
      {scanLoading ? <div className="scanner-toast scanner-toast--loading">Processing scan...</div> : null}
      {scanFeedback ? (
        <div className={`scanner-toast scanner-toast--${scanFeedback.tone}`}>
          {scanFeedback.message}
        </div>
      ) : null}
    </div>
  );
}

function ControlPage({
  controlForm,
  controlMessage,
  controlSaving,
  currentEventClaims,
  currentRound,
  isEventDetailsModalOpen,
  isEventLive,
  isLastGroup,
  liveEvent,
  liveState,
  onActivateFinalCall,
  onCloseEvent,
  onCloseEventDetails,
  onFieldChange,
  onHandleLogout,
  onIncrement,
  onOpenDisplayScreen,
  onOpenEventDetails,
  onOpenScanner,
  onCloseScanner,
  onNewRound,
  onStartEvent,
  onSaveEventDetails,
  queueDescription,
  queueTitle,
  activeQueueClaims,
  scanFeedback,
  scanLoading,
  scannerActive,
  scannerVideoRef,
  totalPeopleWithNumbers,
}) {
  const queueEmptyText = liveState.finalCall
    ? "Everyone from the final-call list has claimed an item."
    : liveState.current === 0
      ? "No group is active yet."
      : "No attendees are in the current group.";
  const isCurrentGroupFullyClaimed =
    !liveState.finalCall &&
    liveState.current > 0 &&
    activeQueueClaims.length > 0 &&
    activeQueueClaims.every((claim) => claim.redeemedRound === currentRound);
  const isReadyForFinalCall = isLastGroup && isCurrentGroupFullyClaimed;
  const isFinalCallFullyClaimed =
    liveState.finalCall &&
    activeQueueClaims.length > 0 &&
    activeQueueClaims.every((claim) => claim.redeemedRound === currentRound);

  return (
    <div className="control">
      {!isEventLive ? (
        <EventDetailsModal
          controlForm={controlForm}
          controlMessage={controlMessage}
          controlSaving={controlSaving}
          isEventLive={false}
          onClose={onCloseEventDetails}
          onFieldChange={onFieldChange}
          onSubmit={onStartEvent}
        />
      ) : null}
      {isEventLive ? (
        <>
          <div className={`control-dashboard${isEventDetailsModalOpen ? " control-dashboard--blurred" : ""}`}>
            <div className="control-event-header">
              <h1>{liveState.title}</h1>
              <p className="control-event-subtitle">{liveEvent.timeframeLabel}</p>
              <p className="control-event-subtitle control-event-link">{liveState.qrUrl}</p>
              <div className="control-actions">
                <button className="secondary-button" type="button" onClick={onOpenEventDetails}>
                  Edit Event Details
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={onCloseEvent}
                  disabled={controlSaving}
                >
                  End Event
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <span>Round</span>
                <strong>{liveState.round}</strong>
              </div>
              <div className="stat-card">
                <span>Currently Calling</span>
                <strong>
                  {liveState.current === 0
                    ? "Starting Soon"
                    : `${liveState.last + 1}-${liveState.current}`}
                </strong>
              </div>
              <div className="stat-card">
                <span>Attendees</span>
                <strong>{totalPeopleWithNumbers}</strong>
              </div>
            </div>

            {!liveState.finalCall ? (
              <>
                {!isLastGroup ? (
                  <div>
                    <button
                      className={isCurrentGroupFullyClaimed ? "ready-button" : undefined}
                      onClick={() => onIncrement(10)}
                    >
                      {liveState.round === 1 && liveState.current === 0
                        ? "Start Round 1"
                        : "Next Group"}
                    </button>
                  </div>
                ) : (
                  <p className="entry-message">
                    This is the last group. Use Final Call when you&apos;re ready.
                  </p>
                )}
                <div>
                  <button
                    className={isReadyForFinalCall ? "ready-button" : undefined}
                    onClick={onActivateFinalCall}
                  >
                    Final Call
                  </button>
                </div>
              </>
            ) : (
              <div>
                <button
                  className={isFinalCallFullyClaimed ? "ready-button" : undefined}
                  onClick={onNewRound}
                >
                  Start Next Round
                </button>
              </div>
            )}

            <div className="entry-card compact-card queue-card">
              <h2>{queueTitle}</h2>
              <p>{queueDescription}</p>
              <ClaimList
                claims={activeQueueClaims}
                currentRound={currentRound}
                emptyText={queueEmptyText}
                isFinalCall={liveState.finalCall}
                isLastGroup={isLastGroup}
              />
            </div>

            <FullRoster claims={currentEventClaims} totalPeopleWithNumbers={totalPeopleWithNumbers} />
          </div>
          {isEventDetailsModalOpen ? (
            <EventDetailsModal
              controlForm={controlForm}
              controlMessage={controlMessage}
              controlSaving={controlSaving}
              isEventLive
              onClose={onCloseEventDetails}
              onFieldChange={onFieldChange}
              onSubmit={onSaveEventDetails}
            />
          ) : null}
        </>
      ) : null}

      {scannerActive ? (
        <ScannerModal
          onClose={onCloseScanner}
          scanFeedback={scanFeedback}
          scanLoading={scanLoading}
          scannerVideoRef={scannerVideoRef}
        />
      ) : null}

      {isEventLive ? (
        <div className="bottom-navbar">
          <button className="secondary-button bottom-navbar-button" onClick={onHandleLogout}>
            Logout
          </button>
          <button
            className="bottom-navbar-button"
            type="button"
            onClick={onOpenScanner}
            disabled={scanLoading || !isEventLive}
          >
            Open Scanner
          </button>
          <button className="secondary-button bottom-navbar-button" onClick={onOpenDisplayScreen}>
            Open Display Screen
          </button>
        </div>
      ) : (
        <div className="bottom-navbar">
          <button className="secondary-button bottom-navbar-button" onClick={onHandleLogout}>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

export default ControlPage;