import { useState } from "react";
import QRCode from "react-qr-code";
import {
  BellRing,
  Info,
  Monitor,
  ScanLine,
  Settings,
} from "lucide-react";
import bbcLogo from "../assets/bbc_logo.png";
import { parseClaimRulesList } from "../claimRules";
import { SketchButton, SketchCard, SketchDialog, SketchIconButton } from "./SketchUI";
import Spinner from "./Spinner";
import { getEventTitleClassName } from "../titleFonts";

function formatCountdownDuration(remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ClaimRulesModal({
  liveState,
  onAcknowledgeRules,
}) {
  const claimRules = parseClaimRulesList(liveState?.claimRulesText);

  return (
    <SketchDialog
      className="claim-rules-dialog"
      open
      elevation={2}
      role="dialog"
      aria-modal="true"
      aria-label="Claim rules"
    >
      <div className="claim-rules-modal">
        <div className="claim-rules-content">
          <p className="eyebrow">Before You Start</p>
          <h2>Welcome to {liveState.title}!</h2>
          <div className="claim-rules-copy">
            <ol>
              {claimRules.map((ruleText, index) => (
                <li key={`${index}-${ruleText.slice(0, 20)}`}>{ruleText}</li>
              ))}
            </ol>
          </div>
          <div className="claim-rules-actions">
            <SketchButton type="button" onClick={onAcknowledgeRules}>
              Got it!
            </SketchButton>
          </div>
        </div>
      </div>
    </SketchDialog>
  );
}

function ClaimResultCard({
  areClaimNotificationsEnabled,
  claimQrPayload,
  claimRecord,
  claimResult,
  currentTime,
  currentRound,
  eventStartTimeMs,
  hasClaimedCurrentRound,
  isEventStarted,
  liveCallLabel,
  liveState,
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
    <SketchCard
      className={`entry-card assigned-card claim-modal-card sketch-entry-card${showClaimQr ? " claim-modal-card--active" : ""}`}
      elevation={2}
    >
      <SketchIconButton
        className={`secondary-button claim-corner-button claim-corner-button--left${areClaimNotificationsEnabled ? " claim-corner-button--active" : ""}`}
        type="button"
        onClick={onToggleClaimNotifications}
        aria-label={notificationButtonLabel}
        title={notificationButtonLabel}
      >
        <BellRing aria-hidden="true" className="button-icon icon-animated icon-animate-bell" />
      </SketchIconButton>
      <SketchIconButton
        className="secondary-button claim-corner-button claim-corner-button--right"
        type="button"
        onClick={onOpenClaimRules}
        aria-label="Read event info"
        title="Read event info"
      >
        <Info aria-hidden="true" className="button-icon icon-animated icon-animate-float" />
      </SketchIconButton>
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
          <SketchCard className="claim-qr-box sketch-entry-card" elevation={1}>
            <QRCode value={claimQrPayload} size={180} />
          </SketchCard>
        </div>
      ) : null}
      <div className="claim-card-actions">
        <SketchButton className="secondary-button" type="button" onClick={onOpenBookList}>
          Open Book Descriptions
        </SketchButton>
      </div>
      {!isClaimActive ? (() => {
        const isFinalCall = Boolean(liveState?.finalCall);
        const currentCallNumber = Number(liveState?.current ?? 0);
        const isRoundStartingSoon = !isFinalCall && currentCallNumber === 0;
        const hasEventStartTime = Number.isFinite(eventStartTimeMs);
        const hasCurrentTime = Number.isFinite(currentTime);
        const remainingUntilEventStartMs =
          hasEventStartTime && hasCurrentTime
            ? Math.max(0, eventStartTimeMs - currentTime)
            : 0;
        const shouldShowRoundOneCountdown =
          isRoundStartingSoon &&
          currentRound === 1 &&
          !isEventStarted &&
          hasEventStartTime &&
          remainingUntilEventStartMs > 0;

        if (isFinalCall) {
          return (
            <div className="claim-status-grid claim-status-grid--single">
              <SketchCard className="stat-card claim-status-card sketch-entry-card" elevation={1}>
                <strong>Final Call</strong>
              </SketchCard>
            </div>
          );
        }

        if (isRoundStartingSoon) {
          return shouldShowRoundOneCountdown ? (
            <div className="claim-status-grid claim-status-grid--single">
              <SketchCard className="stat-card claim-status-card sketch-entry-card" elevation={1}>
                <span>Round 1 Starts In</span>
                <strong>{formatCountdownDuration(remainingUntilEventStartMs)}</strong>
              </SketchCard>
            </div>
          ) : (
            <div className="claim-status-grid claim-status-grid--single">
              <SketchCard className="stat-card claim-status-card sketch-entry-card" elevation={1}>
                <strong>Round {currentRound} is Starting Soon</strong>
              </SketchCard>
            </div>
          );
        }

        return (
          <div className="claim-status-grid">
            <SketchCard className="stat-card sketch-entry-card" elevation={1}>
              <span>Round</span>
              <strong>{currentRound}</strong>
            </SketchCard>
            <SketchCard className="stat-card sketch-entry-card" elevation={1}>
              <span>Currently</span>
              <strong>{liveCallLabel}</strong>
            </SketchCard>
          </div>
        );
      })() : null}
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
    </SketchCard>
  );
}

function MemberClaimCard({
  allowManualClaim,
  authError,
  claimError,
  claimLoading,
  claimResult,
  currentTime,
  eventStartTimeMs,
  isCheckingAccess,
  isClaimWindowOpen,
  isEventStarted,
  isMember,
  liveEvent,
  liveState,
  loggedIn,
  memberEarlyAccessTime,
  onManualClaim,
  onStartOAuthGrant,
}) {
  const memberEarlyAccessTimeMs =
    memberEarlyAccessTime instanceof Date ? memberEarlyAccessTime.getTime() : Number(memberEarlyAccessTime);
  const hasMemberEarlyAccessTime = Number.isFinite(memberEarlyAccessTimeMs);
  const hasEventStartTime = Number.isFinite(eventStartTimeMs);
  const assignmentWindowOpensAtMs =
    isMember && hasMemberEarlyAccessTime ? memberEarlyAccessTimeMs : hasEventStartTime ? eventStartTimeMs : null;
  const assignmentCountdownMs =
    Number.isFinite(assignmentWindowOpensAtMs) && Number.isFinite(currentTime)
      ? Math.max(0, assignmentWindowOpensAtMs - currentTime)
      : null;
  const showAssignmentCountdown =
    loggedIn &&
    !isCheckingAccess &&
    !claimLoading &&
    !authError &&
    !claimResult &&
    !isClaimWindowOpen &&
    Number.isFinite(assignmentCountdownMs) &&
    assignmentCountdownMs > 0;
  const assignmentCountdownLabel =
    isMember && hasMemberEarlyAccessTime ? "Member early check-in opens in" : "Event opens in";
  const [isManualClaimDialogOpen, setIsManualClaimDialogOpen] = useState(false);

  const closeManualClaimDialog = () => {
    setIsManualClaimDialogOpen(false);
  };

  const handleConfirmManualClaim = () => {
    setIsManualClaimDialogOpen(false);

    if (typeof onManualClaim === "function") {
      onManualClaim();
    }
  };

  return (
    <SketchCard className="entry-card claim-modal-card sketch-entry-card" elevation={2}>
      <p className="eyebrow">Live Event</p>
      {!loggedIn ? <p className="eyebrow">Reserve Your Spot</p> : null}
      {liveEvent.timeframeLabel ? <p style={{ margin: 0 }}>{liveEvent.timeframeLabel}</p> : null}
      <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
      <p>
      </p>
      {!loggedIn ? (
        <SketchButton onClick={onStartOAuthGrant} disabled={isCheckingAccess || claimLoading}>
          {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
        </SketchButton>
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
            You&apos;re in the queue to reserve a spot. We&apos;ll assign your number as soon as your window opens.
          </p>
          {showAssignmentCountdown ? (
            <p>
              {assignmentCountdownLabel}: <strong>{formatCountdownDuration(assignmentCountdownMs)}</strong>
            </p>
          ) : null}
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
        <SketchButton type="button" onClick={() => setIsManualClaimDialogOpen(true)}>
          Give Me a Number
        </SketchButton>
      ) : null}
      {claimError ? <p className="entry-message">{claimError}</p> : null}
      <SketchDialog
        className="sketch-confirm-dialog"
        open={isManualClaimDialogOpen}
        onClose={closeManualClaimDialog}
      >
        <div className="confirm-dialog-content">
          <h3 className="confirm-dialog-title">Give yourself a number now?</h3>
          <p className="confirm-dialog-copy">
            This will assign you a number immediately.
          </p>
          <div className="confirm-dialog-actions">
            <SketchButton type="button" className="secondary-button" onClick={closeManualClaimDialog}>
              Cancel
            </SketchButton>
            <SketchButton type="button" onClick={handleConfirmManualClaim}>
              Give Me a Number
            </SketchButton>
          </div>
        </div>
      </SketchDialog>
    </SketchCard>
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
        <SketchCard className="bottom-navbar sketch-navbar-card" elevation={1} strokeColor="#111111">
          <div className="bottom-navbar-row">
            <SketchButton className="secondary-button bottom-navbar-button" type="button" onClick={handleOpenScanner}>
              <div className="bottom-navbar-content">
                <ScanLine aria-hidden="true" className="button-icon icon-animated icon-animate-scan" />
                <span>Open Scanner</span>
              </div>
            </SketchButton>
            <SketchButton className="secondary-button bottom-navbar-button" type="button" onClick={onOpenControlPanel}>
              <div className="bottom-navbar-content">
                <Settings aria-hidden="true" className="button-icon icon-animated icon-animate-spin-slow" />
                <span>Control Panel</span>
              </div>
            </SketchButton>
            <SketchButton className="secondary-button bottom-navbar-button" type="button" onClick={onOpenDisplayScreen}>
              <div className="bottom-navbar-content">
                <Monitor aria-hidden="true" className="button-icon icon-animated icon-animate-pulse" />
                <span>Open Display</span>
              </div>
            </SketchButton>
          </div>
        </SketchCard>
      ) : null}
    </div>
  );
}

export default ClaimPage;

// Debug preclaim controls removed
