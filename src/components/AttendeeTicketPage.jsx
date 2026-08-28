import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { buildClaimQrPayload } from "../claimQr";
import { hasClaimedInRound } from "../backtrack";
import { ClaimResultCard, ClaimRulesModal, ClaimTicketDeck } from "./ClaimPage";
import { SketchButton, SketchCard } from "./SketchUI";
import { formatClaimNumber, isStaffClaim } from "../staffNumbers";

/**
 * One attendee's ticket, as their own phone renders it.
 *
 * Staff reach this from the attendee list. It exists for the times the
 * attendee's screen is not available to look at — a flat battery, a locked
 * phone, a walk-up who never signed in, or a demo participant who has no phone
 * at all — and for checking what somebody is actually being shown when they say
 * their code will not scan.
 *
 * It renders the real ClaimResultCard rather than a staff-side imitation of it,
 * so it cannot quietly drift out of step with the page attendees see. It is fed
 * from the live roster and the live call state, so a number being called while
 * staff are looking at it flips the card to "You're up!" exactly as it would in
 * the attendee's hand.
 */
function AttendeeTicketPage({
  claim,
  currentRound,
  currentTime,
  eventStartTimeMs,
  isEventStarted,
  liveCallLabel,
  liveState,
  onBack,
  onOpenBookList,
  raffleQrPayload = "",
}) {
  /* The event info, opened from the ticket's own corner button. Staff reach
     this page when somebody cannot show them their screen, and "what does the
     info button say?" is one of the things they get asked — an inert button
     made this page a picture of the ticket rather than the ticket. */
  const [isClaimRulesOpen, setIsClaimRulesOpen] = useState(false);
  const hasClaimedCurrentRound = hasClaimedInRound(claim, currentRound);
  const claimQrPayload =
    claim.claimId && claim.eventId && claim.qrToken
      ? buildClaimQrPayload({
          claimId: claim.claimId,
          eventId: claim.eventId,
          qrToken: claim.qrToken,
        })
      : "";
  /* The same three conditions the attendee's own page applies, so the QR is
     present here exactly when it is present there — including its absence once
     they have already picked something up this round. */
  const isStaffTicket = isStaffClaim(claim);
  /* Read the same way the attendee's own page reads it: a prize handover is
     recorded as nothing but this timestamp — see redeemRaffleByQrAsStaff. */
  const isRafflePrizeCollected = Number.isFinite(claim.raffleClaimedAtMs);
  const claimNumberLabel = formatClaimNumber(claim.number);
  /* The same three ways in the attendee's own page reads, including final
     call — which reaches back for people whose number the called group never
     got to. Staff open this page precisely when somebody's code will not come
     up on their own phone, so a gate that is stricter than the server's would
     leave them with nothing to scan and no way to see why. See src/App.jsx. */
  const isFinalCallTarget =
    Array.isArray(liveState.finalCallTargetNumbers) &&
    liveState.finalCallTargetNumbers.includes(claim.number);
  const showClaimQr =
    Boolean(claimQrPayload) &&
    // Staff collect from the moment the round is announced. Spelled out for the
    // same reason it is on the attendee's own page — see src/App.jsx.
    (isStaffTicket || liveState.current >= claim.number || isFinalCallTarget) &&
    !hasClaimedCurrentRound;
  const claimRecord = {
    claimId: claim.claimId,
    eventId: claim.eventId,
    isMember: claim.isMember,
    isStaff: isStaffTicket,
    itemsClaimedCount: claim.itemsClaimedCount,
    number: claim.number,
    qrToken: claim.qrToken,
    redeemedRound: claim.redeemedRound,
  };

  return (
    <div className="claim-page claim-page--focused attendee-ticket-page">
      {/*
        Named before the card, because the card underneath says "Your number is"
        in the second person. Without this, a staff member glancing at the screen
        has no way to tell whose ticket they are holding.
      */}
      <SketchCard
        className="attendee-ticket-banner sketch-entry-card"
        elevation={1}
        fill="#eaf3ff"
        strokeColor="#111111"
      >
        {/* The row lives in a child of the card, not on the card itself:
            wired-card slots its light-DOM children into a wrapper div, so flex
            rules set on the host arrange that wrapper rather than these two. */}
        <div className="attendee-ticket-banner-row">
          <SketchButton type="button" className="secondary-button attendee-ticket-back" onClick={onBack}>
            <div className="bottom-navbar-content">
              <ArrowLeft aria-hidden="true" className="button-icon" />
              <span>Back To Control</span>
            </div>
          </SketchButton>
          <div className="attendee-ticket-banner-copy">
            <span className="attendee-ticket-banner-eyebrow">Attendee View</span>
            <p className="attendee-ticket-banner-name">
              {claimNumberLabel} · {claim.displayName}
            </p>
          </div>
        </div>
      </SketchCard>

      {/* The same two-page panel the attendee is holding, arrows and all, so
          staff reading this over somebody's shoulder are on the same page as
          them — literally. It opens on the ticket rather than the prize: the
          reveal that turns an attendee's own screen is theirs, and staff came
          here from the roster to look at whichever code they were asked for. */}
      <ClaimTicketDeck
        claimNumber={claim.number}
        isRafflePrizeCollected={isRafflePrizeCollected}
        raffleQrPayload={raffleQrPayload}
      >
        <ClaimResultCard
          claimQrPayload={claimQrPayload}
          claimRecord={claimRecord}
          claimResult={{ ...claimRecord, existing: true }}
          currentRound={currentRound}
          currentTime={currentTime}
          eventStartTimeMs={eventStartTimeMs}
          hasClaimedCurrentRound={hasClaimedCurrentRound}
          isEventStarted={isEventStarted}
          liveCallLabel={liveCallLabel}
          liveState={liveState}
          onOpenBookList={onOpenBookList}
          onOpenClaimRules={() => setIsClaimRulesOpen(true)}
          showClaimQr={showClaimQr}
        />
      </ClaimTicketDeck>

      {isClaimRulesOpen ? (
        <ClaimRulesModal
          liveState={liveState}
          onAcknowledgeRules={() => setIsClaimRulesOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default AttendeeTicketPage;
