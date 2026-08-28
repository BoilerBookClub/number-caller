import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MemoQrCode from "./MemoQrCode";
import rough from "roughjs/bin/rough";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Monitor,
  PartyPopper,
  ScanLine,
  Settings,
} from "lucide-react";
import bbcLogo from "../assets/bbc_logo.png";
import { parseClaimRulesList } from "../claimRules";
import {
  SketchButton,
  SketchCard,
  SketchDialog,
  SketchIconButton,
  SketchMessageDialog,
} from "./SketchUI";
import Spinner from "./Spinner";
import StatusMark from "./StatusMark";
import { formatClaimNumber, isStaffClaim } from "../staffNumbers";
import { getEventTitleClassName } from "../titleFonts";
import { NAVBAR_ACTION_WIDEST_LABEL } from "../navbarAction";

/*
 * The code's intrinsic size. It is drawn as an SVG with a viewBox, so CSS is
 * free to scale it down on a narrow phone — this only has to be large enough
 * that the modules stay crisp at the size the card actually gives it.
 */
const CLAIM_QR_PIXEL_SIZE = 240;

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
  claimRecord,
  claimResult,
  liveState,
  onAcknowledgeRules,
}) {
  const claimRules = parseClaimRulesList(liveState?.claimRulesText);
  /* The rules are written for people standing in the queue, and staff are not in
     it: their code is live for the whole of every round rather than for the
     minutes their number is up. Rather than rewrite somebody's event rules for
     them, the difference is said once above them. See src/staffNumbers.js. */
  const isStaffTicket = isStaffClaim(claimRecord) || isStaffClaim(claimResult);

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
            {isStaffTicket ? (
              <p className="claim-rules-staff-note">
                                You&apos;re staff, so you aren&apos;t waiting for a group. Your QR code goes live here as soon as a round is announced. After grabbing an item, check it off yourself with the button or have a staff member scan your QR code.
              </p>
            ) : null}
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

/*
 * The live state of the event, as it rides along the top of the placeholder
 * code box: the countdown before the doors open, and what the display is doing
 * once they have. It sits inside the box because the box is the thing the
 * attendee is watching — as a separate panel lower down the card it was a long
 * way from the code whose absence it explains.
 */
function ClaimWaitStatus({
  currentRound,
  currentTime,
  eventStartTimeMs,
  isEventStarted,
  liveCallLabel,
  liveState,
}) {
  const isFinalCall = Boolean(liveState?.finalCall);
  const currentCallNumber = Number(liveState?.current ?? 0);
  const isRoundStartingSoon = !isFinalCall && currentCallNumber === 0;
  const hasEventStartTime = Number.isFinite(eventStartTimeMs);
  const hasCurrentTime = Number.isFinite(currentTime);
  const remainingUntilEventStartMs =
    hasEventStartTime && hasCurrentTime ? Math.max(0, eventStartTimeMs - currentTime) : 0;
  const shouldShowRoundOneCountdown =
    isRoundStartingSoon &&
    currentRound === 1 &&
    !isEventStarted &&
    hasEventStartTime &&
    remainingUntilEventStartMs > 0;

  if (isFinalCall) {
    return (
      <div className="claim-wait-status">
        <strong className="claim-wait-status-value">Final Call</strong>
      </div>
    );
  }

  if (isRoundStartingSoon) {
    return shouldShowRoundOneCountdown ? (
      <div className="claim-wait-status">
        <span className="claim-wait-status-label">Round 1 Starts In</span>
        <strong className="claim-wait-status-value">
          {formatCountdownDuration(remainingUntilEventStartMs)}
        </strong>
      </div>
    ) : (
      <div className="claim-wait-status">
        <strong className="claim-wait-status-value claim-wait-status-value--sentence">
          Round {currentRound} is Starting Soon
        </strong>
      </div>
    );
  }

  return (
    <div className="claim-wait-status claim-wait-status--pair">
      <div className="claim-wait-status-item">
        <span className="claim-wait-status-label">Round</span>
        <strong className="claim-wait-status-value">{currentRound}</strong>
      </div>
      <div className="claim-wait-status-item">
        <span className="claim-wait-status-label">Currently</span>
        <strong className="claim-wait-status-value">{liveCallLabel}</strong>
      </div>
    </div>
  );
}

/*
 * The code, with the number knocked out of the middle of it, and the line under
 * it saying where to take it.
 *
 * One component for both codes on the ticket. The item claim and the raffle
 * prize are the same object to whoever is holding the phone up and the same
 * object to the staff member scanning it, so they are drawn by the same code
 * rather than by two blocks that happen to agree today. What they carry — the
 * payload and the caption — is all that differs, and the payloads are the same
 * JSON shape a byte apart, so the knockout costs the same share of both.
 */
/*
 * The drawn ring on the rim of the hole in the middle of the code.
 *
 * roughjs directly rather than a wired element, because none of them draws a
 * bare circle — the same library underneath wired-elements, so the hand is the
 * same one that draws every other border on the page. Sized in real pixels off
 * the box rather than in a scaled viewBox, which is what keeps the line the
 * same weight here as everywhere else however large the code is drawn; the
 * observer is because the code's size is `min(17rem, 62vw)` and so moves with
 * the viewport. A fixed seed, so a redraw reproduces the line rather than
 * reshuffling it under the reader.
 *
 * Drawn a little inside the rim rather than on it, so the whole stroke — the
 * randomness in it included — stays within the hole and adds nothing to what
 * the error correction already has to absorb.
 *
 * The numbers are wired-elements' own, lifted from the `options()` its lib
 * builds every card, button and input border out of (node_modules/wired-
 * elements/lib/wired-lib.js). This ring used to carry a set of its own — a
 * single stroke at 1.6 — which is why it read as a different pen from
 * everything around it: every other line on the card is drawn twice, and the
 * double line *is* the wireframe look. Off by a tenth on the weight as well.
 * The rest of the set (curve fitting, step count, tightness) is rough's default
 * and wired's alike, so it is left unstated rather than restated.
 *
 * The two lines are drawn here rather than left to rough's own multi-stroke,
 * which is the setting wired's borders get their second line from. It works on
 * a rectangle because each edge is a straight line whose two passes are given
 * independent endpoints — they run apart down the whole edge, with white
 * between them. On an ellipse the second loop is the same loop jittered, and
 * the jitter keeps crossing back: measured, the two sat a median 0.7px apart,
 * which under a 1.5px stroke is not two lines at all but one 2.2px band. That
 * is what it looked like — a single thick line, the more obviously the closer
 * you got to it. maxRandomnessOffset, which is what spreads the rectangle's,
 * does nothing here: rough drives ellipse wobble from `roughness` alone.
 *
 * So: two loops, each drawn once, the inner one a hair smaller.
 *
 * Thinner than wired's 1.5, and deliberately. Weight is not read against the
 * screen, it is read against the thing it encloses: 1.5px around a 448px card
 * is a hairline, and the same 1.5px around a 127px ring is four times that in
 * proportion — which is why matching the number exactly still came out looking
 * like a marker pen beside a pencil. 1 is where the ring sits against a card
 * border at the same size, checked side by side rather than argued from the
 * figure.
 *
 * The gap is small on purpose too. Held wide enough to never touch, the pair
 * stops reading as one line drawn twice and starts reading as two rings, one
 * inside the other. At 1.6 they run together in places and apart in others,
 * which is what the card's own two passes do — those cross as well.
 *
 * The seeds are chosen rather than arbitrary. rough's ellipse walks a wobbly
 * loop and closes it with an overshoot that, on most seeds, comes out taller
 * than it is wide — over 400 of them the middling seed draws about 5% tall, and
 * the one this used to run (4242) drew 9%, which is enough to read as an egg
 * beside a card whose own corners are square. This pair was picked out of every
 * seed that draws round at all five sizes the ring is rendered at, from an 80px
 * box on a phone to 127px on a desktop: both loops stay within 1.2% of round
 * and 0.6px of centre, and the outer one keeps its ink 2.3px inside the hole.
 * The old seed came within half a pixel of the rim and put the outer half of
 * its stroke over the code itself.
 */
const CLAIM_QR_RING_OPTIONS = {
  bowing: 0.85,
  /* Each loop is one pass. The second line is the second ellipse below, not
     rough's multi-stroke — see the note above for why that is not the same. */
  disableMultiStroke: true,
  roughness: 1,
  stroke: "currentColor",
  strokeWidth: 1,
};

const CLAIM_QR_RING_OUTER_SEED = 1179;
const CLAIM_QR_RING_INNER_SEED = 730;

/* How far inside the outer loop the inner one runs — the nominal gap, which the
   wobble in both lines then opens and closes around. */
const CLAIM_QR_RING_GAP = 1.6;

const CLAIM_QR_RING_INSET = 4;

/*
 * Three digits are set smaller than one, in the same hole.
 *
 * The hole is fixed — it is what the code's error correction has to absorb, and
 * tests/claimQr.test.mjs measures how much of the worst Reed-Solomon block's
 * budget it spends. So only the type changes, which means only the number
 * carries this class; the knockout and the ring take their size from the shared
 * rule and can no longer drift away from it.
 */
const claimNumberSizeClassName = (claimNumberLabel) =>
  claimNumberLabel.length >= 3 ? " claim-qr-number--long" : "";

function ClaimQrRing({ className }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svgElement = svgRef.current;

    if (!svgElement) {
      return undefined;
    }

    const draw = () => {
      const { height, width } = svgElement.getBoundingClientRect();

      if (!width || !height) {
        return;
      }

      const generator = rough.svg(svgElement);
      const drawLoop = (inset, seed) =>
        generator.ellipse(width / 2, height / 2, width - inset * 2, height - inset * 2, {
          ...CLAIM_QR_RING_OPTIONS,
          seed,
        });

      svgElement.replaceChildren(
        drawLoop(CLAIM_QR_RING_INSET, CLAIM_QR_RING_OUTER_SEED),
        drawLoop(CLAIM_QR_RING_INSET + CLAIM_QR_RING_GAP, CLAIM_QR_RING_INNER_SEED),
      );
    };

    draw();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;

    resizeObserver?.observe(svgElement);

    return () => {
      resizeObserver?.disconnect();
    };
  }, []);

  return <svg ref={svgRef} className={className} aria-hidden="true" />;
}

/*
 * The line under the code saying where to take it.
 *
 * Rendered by the card into its foot rather than by ClaimQrCode alongside the
 * box, because the box is the one thing on the card that is centred on its
 * middle — and anything travelling with it counts towards that middle and
 * pushes the code up by half its own height. See .claim-card-head.
 *
 * One appearance whether or not the code under it is live: the kickers on this
 * card are all the same yellow now, and what makes a live code obvious is the
 * number pulsing inside it rather than a second thing changing colour.
 */
function ClaimQrCaption({ children }) {
  return <p className="eyebrow claim-qr-caption">{children}</p>;
}

function ClaimQrCode({ claimNumberLabel, payload }) {
  const sizeClassName = claimNumberSizeClassName(claimNumberLabel);

  return (
    <div className="claim-qr-inline-block">
      <SketchCard className="claim-qr-box sketch-entry-card" elevation={1}>
        <div className="claim-qr-frame">
          {/*
            The number sits in a knocked-out square at the centre and the code
            is drawn around it. That costs modules, so the code is generated at
            the highest error correction level: level H reconstructs up to 30%
            of the codewords, while the square costs between 14% and 21% of the
            area depending on how many digits it has to hold. Those two numbers
            are a pair — widening .claim-qr-number without a level to absorb it
            is what would stop the code scanning.
          */}
          <MemoQrCode value={payload} size={CLAIM_QR_PIXEL_SIZE} level="H" />
          {/*
            The hole, as a sibling between the code and the number rather than a
            layer underneath the number itself: a child of the number would
            paint over it, however far its z-index were pushed down, and was
            burying the very digits it exists to make legible.
          */}
          <div className="claim-qr-knockout" aria-hidden="true" />
          <ClaimQrRing className="claim-qr-ring" />
          {/* The pulse is the tell that the code is up. It is on the number
              rather than on the card because the number is what the attendee is
              looking at, and it stops the moment the code stops being live. */}
          <div
            className={`assigned-number claim-qr-number${sizeClassName} claim-qr-number--live`}
          >
            {claimNumberLabel}
          </div>
        </div>
      </SketchCard>
    </div>
  );
}

/*
 * "That's yours" — the attendee's half of a scan.
 *
 * Staff see the tick over the camera the moment a code is redeemed; until now
 * the attendee saw only their QR quietly turn into a grey placeholder, which is
 * a poor thing to hand somebody who has just been marked off. This is the same
 * drawn tick, on their screen, for a couple of seconds.
 *
 * Only ever a tick: a scan that fails is staff's problem to sort out at the
 * table, and a red cross on the attendee's phone would only send them looking
 * for something to do about it.
 *
 * Both halves of the ticket raise it — an item marked off on the first page and
 * a prize handed over on the second — because from the attendee's side the two
 * are the same moment: they held a code up, and something happened out of their
 * sight. Only the wording under the tick differs.
 *
 * Portalled to the body because the ticket deck it is raised from slides its
 * pages with a transform, and a transform makes a containing block that a fixed
 * overlay inside it would be trapped in.
 */
const CLAIM_MARKED_VISIBLE_MS = 2200;

function ClaimMarkedOverlay({ detail, title }) {
  return createPortal(
    <div className="claim-marked" role="status">
      <StatusMark className="claim-marked-mark" tone="success" />
      <p className="claim-marked-title">{title}</p>
      {detail ? <p className="claim-marked-round">{detail}</p> : null}
    </div>,
    document.body,
  );
}

/*
 * True for as long as the confirmation is on screen, and only for a flip that
 * happens while this component is mounted.
 *
 * The confirmation fires on the edge, not the state: the ref is seeded with
 * whatever is true at mount, so opening the page on an already-done claim — a
 * reload, or staff opening this attendee's ticket after the fact — shows
 * nothing, while the flip that arrives on the live subscription shows the tick.
 *
 * Which means it lands on every way the thing gets marked: a staff scan, a
 * staff-side mark from the roster, and the self-redeem button.
 */
function useJustMarked(isMarked) {
  const [showMark, setShowMark] = useState(false);
  const wasMarkedRef = useRef(isMarked);

  useEffect(() => {
    const wasMarked = wasMarkedRef.current;
    wasMarkedRef.current = isMarked;

    if (!isMarked || wasMarked) {
      return undefined;
    }

    setShowMark(true);

    const timeoutId = window.setTimeout(() => {
      setShowMark(false);
    }, CLAIM_MARKED_VISIBLE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isMarked]);

  return showMark;
}

/*
 * A dialog raised from inside the ticket, moved to the body to open.
 *
 * The deck slides its two pages with a transform, and a transform makes a
 * containing block for everything fixed inside it — so wired-dialog's own
 * full-screen overlay was being laid out against the card that raised it
 * rather than against the viewport: drawn inside the panel, under the deck's
 * edge fade, and behind the page it came from. The ticket's rules modal never
 * had the problem because it is rendered by the page, outside the deck; these
 * are rendered by the cards inside it.
 *
 * Same reason ClaimMarkedOverlay is portalled. Nothing in the stylesheet
 * reaches a dialog through an ancestor — every rule is on the dialog's own
 * class, z-index included — so moving one costs it nothing, and React events
 * still bubble through the tree it was written in rather than the one it
 * lands in.
 */
function TicketDialogPortal({ children }) {
  return createPortal(children, document.body);
}

function ClaimResultCard({
  canJoinRaffle,
  canStaffSelfRedeem,
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
  onOpenClaimRules,
  onOpenBookList,
  onDismissRaffleJoinError,
  onDismissStaffSelfRedeemError,
  onJoinRaffle,
  onStaffSelfRedeem,
  hasJoinedRaffle,
  raffleJoinError,
  raffleJoinLoading,
  showClaimQr,
  staffSelfRedeemError,
  staffSelfRedeemLoading,
}) {
  const isClaimActive = Boolean(showClaimQr && claimRecord);
  const showClaimedMark = useJustMarked(hasClaimedCurrentRound);
  /* Asked before it is recorded, because nothing undoes it: the round is
     stamped on the claim and there is no staff control that takes it back, so
     a pocket press would cost them the pickup until the next round. */
  const [isSelfRedeemConfirmOpen, setIsSelfRedeemConfirmOpen] = useState(false);
  const showSelfRedeem = Boolean(isClaimActive && canStaffSelfRedeem && onStaffSelfRedeem);
  const isStaffTicket = isStaffClaim(claimRecord) || isStaffClaim(claimResult);
  /* S1 rather than the negative it is stored as. See src/staffNumbers.js. */
  const claimNumberLabel = formatClaimNumber(claimResult.number).replace(/^#/, "");
  const claimNumberSizeClass = claimNumberSizeClassName(claimNumberLabel);
  const claimNumberClassName = `assigned-number claim-qr-number${claimNumberSizeClass}`;

  return (
    <SketchCard
      className={`entry-card assigned-card claim-modal-card sketch-entry-card${showClaimQr ? " claim-modal-card--active" : ""}`}
      elevation={2}
    >
      <SketchIconButton
        className="secondary-button claim-corner-button claim-corner-button--right"
        type="button"
        onClick={onOpenClaimRules}
        aria-label="Read event info"
        title="Read event info"
      >
        <Info aria-hidden="true" className="button-icon" />
      </SketchIconButton>
      {/*
        The card's contents, in a box of their own.

        wired-card slots what it is given into a plain block <div> inside its
        own shadow root, so a flex column declared on the card itself stops at
        that div and never reaches these three — which is why the head and the
        foot were not splitting anything, and why every pixel the 4:3 shape
        asked for pooled underneath the button instead. The column, and the
        height it has to fill, both live on this element, which is on our side
        of the boundary. See .claim-card-body.
      */}
      <div className="claim-card-body">
        <div className="claim-card-head">
          <div className="claim-ticket-logo-wrap">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="claim-ticket-logo" />
          </div>
          <p className="eyebrow">
            {showClaimQr ? "You're up!" : isStaffTicket ? "You're staff" : "You're in line"}
          </p>
        </div>
        {isClaimActive ? (
          <ClaimQrCode claimNumberLabel={claimNumberLabel} payload={claimQrPayload} />
        ) : (
          /*
            The waiting state holds the code's place rather than leaving a gap
            that fills in later: a greyed box of the same footprint, wrapped
            around the same number in the same spot, so the arrival of the real
            code moves nothing — the box included, which is why it is drawn in the
            same ink as everything else rather than in the placeholder grey it
            used to use. Only what it holds says it is waiting.
          */
          <div className="claim-qr-inline-block claim-qr-inline-block--placeholder">
            <SketchCard
              className="claim-qr-box claim-qr-box--placeholder sketch-entry-card"
              elevation={1}
              redrawOnResize
              redrawSignal={`${claimNumberLabel}-${currentRound}-${hasClaimedCurrentRound}`}
            >
              <div className="claim-qr-frame claim-qr-frame--placeholder">
                {/* Along the head of the stand-in, opposite the wait status along
                    its foot, labelling the number between them. It belongs to the
                    stand-in rather than to the card because the real code has
                    nothing for it to label — the number is drawn inside the code
                    itself, and a heading over a thing being held up to a scanner
                    is one more line between it and the scanner. */}
                <p className="claim-qr-frame-heading">
                  {isStaffTicket ? "Your staff code is" : "Your number is"}
                </p>
                {/* The same ring, in the same place at the same size, so the
                    number is already inside it before the code arrives to be
                    drawn around it — the stand-in's whole job is that the swap
                    moves nothing. */}
                <ClaimQrRing className="claim-qr-ring" />
                <div className={claimNumberClassName}>{claimNumberLabel}</div>
                <ClaimWaitStatus
                  currentRound={currentRound}
                  currentTime={currentTime}
                  eventStartTimeMs={eventStartTimeMs}
                  isEventStarted={isEventStarted}
                  liveCallLabel={liveCallLabel}
                  liveState={liveState}
                />
              </div>
            </SketchCard>
          </div>
        )}
        <div className="claim-card-foot">
          {/* What the code says, or what the space where it will be says. Both
              live here rather than under the box so the box keeps the card's
              centre line to itself. */}
          {isClaimActive ? (
            <ClaimQrCaption>
              {showSelfRedeem
                ? "Show This To Staff, Or Mark It Yourself Below"
                : "Show This To Staff After Picking an Item"}
            </ClaimQrCaption>
          ) : claimRecord ? (
            <p
              className={`claim-qr-placeholder-copy${hasClaimedCurrentRound ? " claim-qr-placeholder-copy--claimed" : ""}`}
            >
              {hasClaimedCurrentRound
                ? isStaffTicket
                  ? `You already claimed an item in round ${currentRound}. Your QR code will return when round ${currentRound + 1} is announced.`
                  : `You already claimed an item in round ${currentRound}. Your QR code will return when the next round reaches your number again.`
                : `Your QR code will appear here once the display reaches number ${claimRecord.number} in round ${currentRound}.`}
            </p>
          ) : (
            <div className="claim-qr-placeholder-pending">
              <Spinner size={40} />
            </div>
          )}
        {/*
          The staff member's own pickup, recorded without a second phone.

          Staff hold the permission the scanner is checking for, so the code
          above is the only reason one of them has to find another to point a
          camera at them. The button is the same call that scan makes — see
          handleStaffSelfRedeem in src/App.jsx — and the code stays on the card
          rather than being replaced by it, because a staff member standing at
          the table with a queue behind them may still find it quicker to be
          scanned like everybody else.

          It appears on exactly the same condition the code does, so it can
          never offer a pickup the server would refuse, and it goes when the
          code goes: the claim comes back through the live subscription with
          this round stamped on it and the whole card turns over to "you already
          claimed an item in round N".
        */}
        {showSelfRedeem ? (
          <div className="claim-self-redeem">
            <SketchButton
              className="claim-self-redeem-button"
              type="button"
              onClick={() => setIsSelfRedeemConfirmOpen(true)}
              disabled={staffSelfRedeemLoading}
            >
              {staffSelfRedeemLoading ? "Marking..." : "I Claimed an Item"}
            </SketchButton>
            <p className="claim-self-redeem-copy">
              Staff can record their own pickup instead of being scanned.
            </p>
            <TicketDialogPortal>
              <SketchDialog
                className="sketch-confirm-dialog"
                open={isSelfRedeemConfirmOpen}
                onClose={() => setIsSelfRedeemConfirmOpen(false)}
              >
                <div className="confirm-dialog-content">
                  <h3 className="confirm-dialog-title">Mark your item as claimed?</h3>
                  <p className="confirm-dialog-copy">
                    This records your pickup for round {currentRound}, the same as being
                    scanned. Your code will come back next round.
                  </p>
                  <div className="confirm-dialog-actions">
                    <SketchButton
                      type="button"
                      className="secondary-button"
                      onClick={() => setIsSelfRedeemConfirmOpen(false)}
                    >
                      Cancel
                    </SketchButton>
                    <SketchButton
                      type="button"
                      onClick={() => {
                        setIsSelfRedeemConfirmOpen(false);
                        onStaffSelfRedeem();
                      }}
                    >
                      Mark Claimed
                    </SketchButton>
                  </div>
                </div>
              </SketchDialog>
              <SketchMessageDialog
                message={staffSelfRedeemError}
                onDismiss={onDismissStaffSelfRedeemError}
              />
            </TicketDialogPortal>
          </div>
        ) : null}
        {/*
          Opting in to the raffle, when staff have asked people to put themselves
          forward for it. Sits directly under the code because that is the part of
          the ticket an attendee is already looking at, and once they are in it
          stays as a confirmation rather than disappearing — the question "am I in
          the raffle?" needs an answer on screen, not the absence of a button.
        */}
        {canJoinRaffle ? (
          <div className="claim-raffle-join">
            {hasJoinedRaffle ? (
              <p className="claim-raffle-joined">
                <PartyPopper aria-hidden="true" className="button-icon" />
                <span>You&apos;re in the raffle</span>
              </p>
            ) : (
              <>
                <SketchButton
                  className="claim-raffle-join-button"
                  type="button"
                  onClick={onJoinRaffle}
                  disabled={raffleJoinLoading}
                >
                  {raffleJoinLoading ? "Joining..." : "Join the Raffle"}
                </SketchButton>
                <p className="claim-raffle-join-copy">
                  You have to join to be on the prize wheel.
                </p>
              </>
            )}
            <TicketDialogPortal>
              <SketchMessageDialog
                message={raffleJoinError}
                onDismiss={onDismissRaffleJoinError}
              />
            </TicketDialogPortal>
          </div>
        ) : null}
        <div className="claim-card-actions">
          <SketchButton className="secondary-button" type="button" onClick={onOpenBookList}>
            Book Choices
          </SketchButton>
        </div>
        </div>
      </div>
      {showClaimedMark ? (
        <ClaimMarkedOverlay
          detail={Number.isFinite(currentRound) ? `Round ${currentRound}` : ""}
          title="Item claimed"
        />
      ) : null}
    </SketchCard>
  );
}

/*
 * The raffle prize code.
 *
 * The second page of the ticket rather than a card stacked above it: winning a
 * prize and being called up for an item are unrelated, can be true at the same
 * time, and are collected at different tables — but only one of them is ever
 * being shown to somebody, and two panels on a phone meant the one they were
 * holding the screen up for was half off the bottom of it. See ClaimTicketDeck.
 *
 * The same card as the ticket, down to the logo and the number knocked out of
 * the middle of the code, because it is the same ticket: an attendee holds the
 * phone up and a staff member scans what is on it, and a prize code that looked
 * like a different kind of object made them both stop and work out which was
 * which. The wording is the whole difference — which is also the only thing
 * that decides which table it is taken to.
 *
 * It stays for the rest of the event because nothing records the handover
 * beyond a timestamp — see redeemRaffleByQrAsStaff — so once that timestamp
 * exists the card says so rather than still asking to be scanned.
 */
/*
 * What the prize code is, for whoever taps the corner of it.
 *
 * The ticket's own info button opens the event's rules, which are about the
 * item line and say nothing about a prize. Somebody who has just been thrown to
 * a second code they were not expecting needs the shorter answer: you won, it
 * is a different table, and your place in the line is still where it was.
 */
const RAFFLE_PRIZE_INFO = [
  "You won a raffle prize.",
  "Take this code to the prize table and show it to staff. They scan it, and hand your prize over.",
  "This is separate from the item line. Your number there has not changed — swipe back to it with the arrow.",
  "The code stays on this page for the rest of the event.",
];

function RafflePrizeInfoDialog({ onClose }) {
  return (
    <TicketDialogPortal>
      <SketchDialog
        className="claim-rules-dialog"
        open
        elevation={2}
        role="dialog"
        aria-modal="true"
        aria-label="Raffle prize info"
        onClose={onClose}
      >
        <div className="claim-rules-modal">
          <div className="claim-rules-content">
            <p className="eyebrow">Your Prize</p>
            <h2>You won the raffle!</h2>
            <div className="claim-rules-copy">
              <ol>
                {RAFFLE_PRIZE_INFO.map((line) => (
                  <li key={line.slice(0, 24)}>{line}</li>
                ))}
              </ol>
            </div>
            <div className="claim-rules-actions">
              <SketchButton type="button" onClick={onClose}>
                Got it!
              </SketchButton>
            </div>
          </div>
        </div>
      </SketchDialog>
    </TicketDialogPortal>
  );
}

/*
 * What stands in the code's place once the prize has been handed over.
 *
 * The code goes rather than greying out. A collected prize code is still a
 * valid-looking square on a screen somebody is about to hold up at the item
 * table, and the two codes are the same card with different wording — so
 * leaving it there invites exactly the mix-up the wording is trying to prevent.
 * The scanner would refuse it, but only after a queue had watched it fail.
 *
 * It keeps the ticket stand-in's box, so the page does not resize under a
 * swipe, and puts nothing in it but the tick. The number goes with the code:
 * it was in the middle of the card to be read out at a table, and there is no
 * table left to read it at — the prize is in their hands.
 */
function RafflePrizeCollectedBox() {
  return (
    <div className="claim-qr-inline-block claim-qr-inline-block--placeholder">
      <SketchCard
        className="claim-qr-box claim-qr-box--placeholder sketch-entry-card"
        elevation={1}
        redrawOnResize
      >
        <div className="claim-qr-frame claim-qr-frame--collected">
          <StatusMark className="raffle-collected-mark" tone="success" />
        </div>
      </SketchCard>
    </div>
  );
}

function RaffleWinCard({ claimNumber, isPrizeCollected = false, raffleQrPayload }) {
  /* S1 rather than the negative it is stored as. See src/staffNumbers.js. */
  const claimNumberLabel = formatClaimNumber(claimNumber).replace(/^#/, "");
  /* Its own, rather than the ticket's, because this card is rendered on the
     attendee's phone and in the staff-side preview and has to answer in both. */
  const [isPrizeInfoOpen, setIsPrizeInfoOpen] = useState(false);
  /* The same tick the ticket raises when an item is marked off, for the same
     reason: staff scan the code out of the attendee's sight, and without this
     the only thing that happened on their screen was a code quietly going
     away. It fires wherever they are — the overlay is portalled, so it does
     not matter that this card may be the page they are not looking at. */
  const showCollectedMark = useJustMarked(isPrizeCollected);

  return (
    <SketchCard
      className={`entry-card assigned-card claim-modal-card raffle-win-card sketch-entry-card${isPrizeCollected ? " raffle-win-card--collected" : " claim-modal-card--active"}`}
      elevation={2}
    >
      {/* Same corner, same icon as the ticket's, so the way to ask what a card
          is does not move between the two pages. */}
      <SketchIconButton
        className="secondary-button claim-corner-button claim-corner-button--right"
        type="button"
        onClick={() => setIsPrizeInfoOpen(true)}
        aria-label="Read raffle prize info"
        title="Read raffle prize info"
      >
        <Info aria-hidden="true" className="button-icon" />
      </SketchIconButton>
      {/*
        The card's contents, in a box of their own.

        wired-card slots what it is given into a plain block <div> inside its
        own shadow root, so a flex column declared on the card itself stops at
        that div and never reaches these three — which is why the head and the
        foot were not splitting anything, and why every pixel the 4:3 shape
        asked for pooled underneath the button instead. The column, and the
        height it has to fill, both live on this element, which is on our side
        of the boundary. See .claim-card-body.
      */}
      <div className="claim-card-body">
        <div className="claim-card-head">
          <div className="claim-ticket-logo-wrap">
            <img src={bbcLogo} alt="Boiler Book Club logo" className="claim-ticket-logo" />
          </div>
          {/* Nothing in its place once the prize is collected. The tick in the
              box below says it, the line under that box says it in words, and
              a third telling of it directly above them made a receipt out of a
              card whose whole content is now one mark. */}
          {isPrizeCollected ? null : <p className="eyebrow">You won the raffle!</p>}
        </div>
        {isPrizeCollected ? (
          <RafflePrizeCollectedBox />
        ) : (
          <ClaimQrCode claimNumberLabel={claimNumberLabel} payload={raffleQrPayload} />
        )}
        <div className="claim-card-foot">
          <ClaimQrCaption>
            {isPrizeCollected ? "Prize Already Collected" : "Show This To Staff At The Prize Table"}
          </ClaimQrCaption>
          {isPrizeInfoOpen ? (
            <RafflePrizeInfoDialog onClose={() => setIsPrizeInfoOpen(false)} />
          ) : null}
        </div>
      </div>
      {showCollectedMark ? (
        <ClaimMarkedOverlay detail="Enjoy your prize!" title="Prize collected" />
      ) : null}
    </SketchCard>
  );
}

/*
 * The line above the ticket that says a prize is waiting.
 *
 * Deliberately one line: the prize code is a swipe away and this only has to
 * be enough to send somebody there, so it is a signpost rather than a second
 * copy of the card. It goes when staff scan the code, which is the only record
 * that the handover happened.
 *
 * The chevron is the half of it that only makes sense from the other page: it
 * points at the prize code, so once the prize code is what is on the screen it
 * is pointing at where the reader already is. It fades rather than unmounting —
 * the same way the deck's own arrows do, and for the same reason: the banner
 * must not change width under a swipe that can still be turned back.
 */
function ClaimPrizeBanner({ isPrizeShowing = false, onShowPrize }) {
  return (
    <SketchCard className="claim-prize-banner sketch-entry-card" elevation={1} fill="#fff6e5">
      <button type="button" className="claim-prize-banner-button" onClick={onShowPrize}>
        <PartyPopper aria-hidden="true" className="button-icon" />
        <span className="claim-prize-banner-copy">
          <strong>You won the raffle!</strong> Show your prize code to staff.
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`button-icon claim-prize-banner-chevron${
            isPrizeShowing ? " claim-prize-banner-chevron--hidden" : ""
          }`}
        />
      </button>
    </SketchCard>
  );
}

/*
 * How far a finger travels before the gesture is read as horizontal. Under
 * this both axes are still open, so a swipe that starts a few degrees off
 * square still turns the page and a scroll that drifts sideways still scrolls.
 */
const DECK_AXIS_LOCK_PX = 8;
/* The share of the panel's width that commits a turn, and the ceiling on it —
   a phone held in landscape is wide enough that a fifth of it is a long drag. */
const DECK_COMMIT_RATIO = 0.2;
const DECK_COMMIT_MAX_PX = 90;
const DECK_COMMIT_MIN_PX = 24;
/* What a drag past the first or last page actually moves: rubber banding
   rather than a dead edge, so the gesture answers and visibly refuses. */
const DECK_OVERSCROLL_DAMPING = 0.28;

const TICKET_PAGE = 0;
const PRIZE_PAGE = 1;

/*
 * The ticket and the prize code, as two pages of one panel.
 *
 * Only a winner ever has a second page, and only a winner gets the arrows, the
 * swipe or the viewport that carries them: with no prize this renders the
 * ticket exactly as it was, with no wrapper and no listeners, because that is
 * what almost every attendee is looking at all night.
 *
 * The arrows live in the slides rather than in the cards so neither card has
 * to know it is in a deck — which is what lets the same two cards render on
 * their own in the staff-side preview. Both pages are stretched to one height,
 * so they are one panel that turns rather than two cards of different sizes
 * swapping places, and the arrow on each sits at the same point down the edge.
 */
function ClaimTicketDeck({
  children,
  claimNumber,
  isRafflePrizeCollected = false,
  raffleQrPayload,
  raffleWinSignal = 0,
}) {
  const hasRafflePrize = Boolean(raffleQrPayload);
  const [page, setPage] = useState(TICKET_PAGE);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const turnedForWinSignalRef = useRef(0);

  /*
   * Turning to the prize the moment it is won, wherever they were — including
   * mid-round with their own number on the screen, because the prize is the
   * thing that just happened and the arrow back to their number is right there.
   *
   * Keyed on the signal rather than on having a prize at all: the payload is
   * the same string every time, so a second win would not change it, and a
   * previous winner would otherwise be thrown to their old code every time
   * somebody else won.
   */
  useEffect(() => {
    if (!hasRafflePrize) {
      setPage(TICKET_PAGE);
      setDragOffsetPx(0);
      return;
    }

    if (raffleWinSignal <= 0 || raffleWinSignal === turnedForWinSignalRef.current) {
      return;
    }

    turnedForWinSignalRef.current = raffleWinSignal;
    setPage(PRIZE_PAGE);
  }, [hasRafflePrize, raffleWinSignal]);

  if (!hasRafflePrize) {
    return children;
  }

  const settleDrag = () => {
    const drag = dragRef.current;

    dragRef.current = null;
    setDragOffsetPx(0);

    if (!drag || drag.axis !== "x") {
      return;
    }

    const viewportWidth = viewportRef.current?.clientWidth ?? 0;
    const commitPx = Math.max(
      DECK_COMMIT_MIN_PX,
      Math.min(DECK_COMMIT_MAX_PX, viewportWidth * DECK_COMMIT_RATIO),
    );

    if (drag.offsetPx <= -commitPx) {
      setPage(PRIZE_PAGE);
    } else if (drag.offsetPx >= commitPx) {
      setPage(TICKET_PAGE);
    }
  };

  const handleTouchStart = (event) => {
    if (event.touches.length !== 1) {
      dragRef.current = null;
      setDragOffsetPx(0);
      return;
    }

    const touch = event.touches[0];

    dragRef.current = { axis: null, offsetPx: 0, startX: touch.clientX, startY: touch.clientY };
  };

  /*
   * No preventDefault anywhere in here: React listens for touchmove passively,
   * so the page is kept still by `touch-action: pan-y` on the viewport instead.
   * That also means the browser owns vertical scrolling throughout — the axis
   * lock below only decides whether this component draws anything.
   */
  const handleTouchMove = (event) => {
    const drag = dragRef.current;

    if (!drag || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - drag.startX;
    const deltaY = touch.clientY - drag.startY;

    if (drag.axis === null) {
      if (Math.abs(deltaX) < DECK_AXIS_LOCK_PX && Math.abs(deltaY) < DECK_AXIS_LOCK_PX) {
        return;
      }

      drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    }

    if (drag.axis !== "x") {
      return;
    }

    const isPastEnd = (page === TICKET_PAGE && deltaX > 0) || (page === PRIZE_PAGE && deltaX < 0);

    drag.offsetPx = isPastEnd ? deltaX * DECK_OVERSCROLL_DAMPING : deltaX;
    setDragOffsetPx(drag.offsetPx);
  };

  return (
    <div className="claim-deck">
      {isRafflePrizeCollected ? null : (
        <ClaimPrizeBanner
          isPrizeShowing={page === PRIZE_PAGE}
          onShowPrize={() => setPage(PRIZE_PAGE)}
        />
      )}
      {/* The gesture is listened for on the track rather than on the viewport
          around it, because the viewport's box reaches a peek past the panel on
          every side — including up over the banner — and it can only afford to
          be transparent to clicks there if nothing is listening on it. */}
      <div className="claim-deck-viewport" ref={viewportRef}>
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={settleDrag}
          onTouchCancel={settleDrag}
          className={`claim-deck-track${dragOffsetPx === 0 ? "" : " claim-deck-track--dragging"}`}
          /* The gap between the pages is the track's, so the shift to the second
             one has to clear it as well as the page's own width. */
          style={{
            transform: `translate3d(calc(${
              page === TICKET_PAGE ? "0px" : "-100% - var(--deck-gap)"
            } + ${dragOffsetPx}px), 0, 0)`,
          }}
        >
          {/* inert rather than hidden: the page off to the side is still laid
              out — it is what gives the track its width — so without this its
              buttons stay tabbable and its text stays in the reading order. */}
          <div className="claim-deck-slide" inert={page !== TICKET_PAGE}>
            {children}
            <SketchIconButton
              className="secondary-button claim-deck-arrow claim-deck-arrow--next"
              type="button"
              onClick={() => setPage(PRIZE_PAGE)}
              aria-label="Show your raffle prize code"
              title="Your raffle prize code"
            >
              <ChevronRight aria-hidden="true" className="button-icon" />
            </SketchIconButton>
          </div>
          <div className="claim-deck-slide" inert={page !== PRIZE_PAGE}>
            <RaffleWinCard
              claimNumber={claimNumber}
              isPrizeCollected={isRafflePrizeCollected}
              raffleQrPayload={raffleQrPayload}
            />
            <SketchIconButton
              className="secondary-button claim-deck-arrow claim-deck-arrow--prev"
              type="button"
              onClick={() => setPage(TICKET_PAGE)}
              aria-label="Back to your number"
              title="Back to your number"
            >
              <ChevronLeft aria-hidden="true" className="button-icon" />
            </SketchIconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberClaimCard({
  allowManualClaim,
  authError,
  canRetryClaim,
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
  onDismissAuthError,
  onDismissClaimError,
  onManualClaim,
  onRetryClaim,
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
      <p className="eyebrow eyebrow--live">
        <span className="eyebrow-live-dot" aria-hidden="true" />
        Live Event
      </p>
      {!loggedIn ? <p className="eyebrow">Reserve Your Spot</p> : null}
      {liveEvent.timeframeLabel ? <p style={{ margin: 0 }}>{liveEvent.timeframeLabel}</p> : null}
      <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
      {!loggedIn ? (
        <SketchButton onClick={onStartOAuthGrant} disabled={isCheckingAccess || claimLoading}>
          {isCheckingAccess ? "Checking Discord..." : "Login with Discord"}
        </SketchButton>
      ) : null}
      {loggedIn && isCheckingAccess ? <p>Checking your membership...</p> : null}
      {loggedIn && !isCheckingAccess ? (
        <SketchMessageDialog message={authError} onDismiss={onDismissAuthError} />
      ) : null}
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
      <SketchMessageDialog message={claimError} onDismiss={onDismissClaimError} />
      {/*
        The way back when the page has stopped trying by itself.

        Check-in retries a handful of times and then gives up rather than
        looping — see src/claimRetry.js — which would otherwise leave an
        attendee looking at an error with nothing to do about it. Their press
        clears the backoff and starts over from nothing, because whatever was
        wrong may well have been fixed by the time they get here.
      */}
      {canRetryClaim ? (
        <div className="claim-retry-action">
          <p className="claim-retry-copy">
            We couldn&apos;t get you a number just then. Check your connection and try again.
          </p>
          <SketchButton type="button" onClick={onRetryClaim} disabled={claimLoading}>
            {claimLoading ? "Trying..." : "Try Again"}
          </SketchButton>
        </div>
      ) : null}
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
    isRafflePrizeCollected,
    onOpenControlPanel,
    onOpenDisplayScreen,
    raffleQrPayload,
    raffleWinSignal,
    showControlNavbar,
    setScannerActive,
    setScanFeedback,
    changeMode,
  } = props;

  /*
   * The scanner lives on the control panel, so this goes there and opens it.
   *
   * There is no attendee branch, because there is no attendee who can reach
   * this button: the navbar it sits on only renders when showControlNavbar,
   * which App passes as hasTrustedStaffAccess. There used to be one, calling an
   * onOpenClaimScanner prop, and it could not have worked either — App's own
   * effect switches the scanner straight back off for any route other than
   * /control, so an attendee pressing it would have got a flicker and nothing
   * else.
   *
   * The deferral is the load-bearing part. changeMode swaps the route to
   * /control on this tick; asking for the scanner in the same tick asks a
   * screen that has not mounted yet, and that same effect reads the route as
   * still being the attendee page and cancels it. A macrotask puts the request
   * after the route has actually changed.
   */
  const handleOpenScanner = () => {
    if (!setScannerActive || !setScanFeedback || !changeMode) {
      return;
    }

    setScanFeedback(null);
    changeMode("control");
    window.setTimeout(() => setScannerActive(true), 0);
  };

  return (
    <div className={`claim-page claim-page--focused${claimResult ? "" : " claim-page--prompt"}`}>
      {showControlNavbar ? <div className="bottom-navbar-fade" aria-hidden="true" /> : null}
      {claimResult ? (
        <div
          className={`claim-ticket-stack${showControlNavbar ? " has-bottom-navbar-clearance" : ""}`}
        >
          <ClaimTicketDeck
            claimNumber={claimResult.number}
            isRafflePrizeCollected={isRafflePrizeCollected}
            raffleQrPayload={raffleQrPayload}
            raffleWinSignal={raffleWinSignal}
          >
            <ClaimResultCard {...props} />
          </ClaimTicketDeck>
        </div>
      ) : null}
      {!claimResult ? <MemberClaimCard {...props} /> : null}
      {claimResult && isClaimRulesOpen ? <ClaimRulesModal {...props} /> : null}
      {showControlNavbar ? (
        <SketchCard className="bottom-navbar sketch-navbar-card" elevation={1} strokeColor="#111111">
          <div className="bottom-navbar-row">
            {/* aria-label rather than the wording alone: below 550px the two
                outer labels are hidden and their icons are the whole buttons,
                so the names have to live somewhere the stylesheet cannot take
                away. The middle button keeps its wording at every width — see
                its own note below. */}
            <SketchButton
              aria-label="Scanner"
              className="secondary-button bottom-navbar-button"
              type="button"
              onClick={handleOpenScanner}
            >
              <div className="bottom-navbar-content">
                <ScanLine aria-hidden="true" className="button-icon" />
                <span className="navbar-button-label">Scanner</span>
              </div>
            </SketchButton>
            {/* The middle seat, built exactly as the control panel's own navbar
                builds its — same reservation, same width, label kept at every
                width. A gear alone cannot say Control Panel the way a scan
                frame says Scanner, and this is the one button on the bar that
                staff are heading for; it is also the seat the panel's primary
                action occupies, so sharing the reservation keeps the bar from
                shifting under the thumb as staff move between the two screens.
                --primary here is the seat, not the styling: it carries the
                sizing only, and secondary-button still sets the look. */}
            <SketchButton
              aria-label="Control Panel"
              className="secondary-button bottom-navbar-button bottom-navbar-button--primary"
              type="button"
              onClick={onOpenControlPanel}
            >
              <div className="bottom-navbar-content">
                <span className="navbar-action-label">
                  <span className="navbar-action-label-sizer" aria-hidden="true">
                    {NAVBAR_ACTION_WIDEST_LABEL}
                  </span>
                  <span className="navbar-action-label-text">
                    <Settings aria-hidden="true" className="button-icon" />
                    <span className="navbar-action-label-word">Control Panel</span>
                  </span>
                </span>
              </div>
            </SketchButton>
            <SketchButton
              aria-label="Display"
              className="secondary-button bottom-navbar-button"
              type="button"
              onClick={onOpenDisplayScreen}
            >
              <div className="bottom-navbar-content">
                <Monitor aria-hidden="true" className="button-icon" />
                <span className="navbar-button-label">Display</span>
              </div>
            </SketchButton>
          </div>
        </SketchCard>
      ) : null}
    </div>
  );
}

export default ClaimPage;
/* Also rendered by the staff-facing ticket preview, so what staff are shown of
   an attendee's screen is literally the attendee's screen and cannot drift from
   it. See AttendeeTicketPage. */
export { ClaimResultCard, ClaimRulesModal, ClaimTicketDeck, RaffleWinCard };

// Debug preclaim controls removed
