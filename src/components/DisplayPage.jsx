import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import MemoQrCode from "./MemoQrCode";
import bbcLogo from "../assets/bbc_logo.png";
import { getAvatarColors } from "../avatarColors";
import { fireRaffleConfetti } from "../confetti";
import { RAFFLE_PHASE } from "../raffle";
import { formatClaimNumber } from "../staffNumbers";
import { getEventTitleClassName } from "../titleFonts";
import useRaffleSpin from "../useRaffleSpin";
import { UpcomingEventsLink } from "./EntryPages";
import RaffleWheel from "./RaffleWheel";
import { SketchCard, SketchMessageDialog, SketchProgress } from "./SketchUI";

/**
 * The raffle, as the room sees it: the wheel, then the winner.
 *
 * It takes over the middle of the display in place of the called number, which
 * fades out beneath it rather than being swapped away. The check-in QR code
 * travels into the half beside the wheel and stays up, so somebody walking in
 * during a raffle can still join the event.
 */
function DisplayRaffleStage({
  eligibleSegments,
  hasRosterAccess,
  isActive,
  liveState,
  phase,
  winnerClaim,
}) {
  const isRevealed = phase === RAFFLE_PHASE.revealed;

  useEffect(() => {
    /* This stage stays mounted between raffles so it has something to fade out
       of, which means the reveal can land while nobody is looking at it — if
       staff put the wheel away mid-spin, say. No confetti over the round view. */
    if (!isRevealed || !isActive) {
      return;
    }

    void fireRaffleConfetti();
    // Keyed on the spin, not on the phase alone, so a second spin celebrates
    // again and a re-render of the same result does not.
  }, [isActive, isRevealed, liveState.raffleSpinCount]);

  /* Non-zero, not positive: a staff number is negative and staff can be in
     the draw. See src/staffNumbers.js. */
  const hasWinner = isRevealed && liveState.raffleWinnerNumber !== 0;

  return (
    <>
      {/*
        The only thing left in the normal flow. The wheel is a fixed overlay, so
        this column is what the stage lays out around and it stays put whether
        the wheel is in the middle of the screen or off the left edge.

        It is also where the win is announced. The reveal used to be a third
        layer floating over the wheel, which put the name on top of the slices
        it had just been drawn from and left this column repeating the draw
        count underneath it. Announcing it here instead means the room reads the
        result off the same line it has been reading the raffle off all along —
        and the caption comes back the moment the winner is cleared, so a wheel
        waiting on its next spin says what it is again.
      */}
      <div className="display-raffle-stage">
        {hasWinner ? (
          <RaffleWinnerReveal
            winnerClaim={winnerClaim}
            winnerNumber={liveState.raffleWinnerNumber}
          />
        ) : (
          <>
            <h2 className="display-round display-raffle-eyebrow">
              {liveState.raffleMembersOnly ? "MEMBERS-ONLY RAFFLE" : "PRIZE RAFFLE"}
            </h2>
            {/*
              An empty wheel has two very different causes and they used to look
              identical. The attendee names come from the roster, which only staff
              may read, so a display that is not signed in gets an empty list and
              used to report it as "nobody is eligible" — sending staff off to look
              for a problem with the draw instead of with this screen.
            */}
            <p className="display-raffle-status" aria-live="polite">
              {phase === RAFFLE_PHASE.spinning ? (
                <>
                  Spinning
                  {/* Three elements rather than three characters, so they can be
                      lit one after the other. Hidden from the live region, which
                      should announce "Spinning" and not a run of full stops. */}
                  <span className="raffle-ellipsis" aria-hidden="true">
                    <span className="raffle-ellipsis-dot">.</span>
                    <span className="raffle-ellipsis-dot">.</span>
                    <span className="raffle-ellipsis-dot">.</span>
                  </span>
                </>
              ) : !hasRosterAccess
                  ? "This screen is not signed in as staff, so it cannot load the names."
                  : eligibleSegments.length > 0
                    ? `${eligibleSegments.length} ${eligibleSegments.length === 1 ? "person is" : "people are"} in the draw`
                    : "Nobody is eligible for this raffle yet"}
            </p>
            {!hasRosterAccess ? (
              <p className="display-raffle-hint">
                Open the display from the control panel, on a browser signed in with a staff account.
              </p>
            ) : null}
          </>
        )}
      </div>

      <RaffleWheel
        phase={phase}
        segments={eligibleSegments}
        spinCount={liveState.raffleSpinCount}
        spinStartedAtMs={liveState.raffleSpinStartedAtMs}
        winnerNumber={liveState.raffleWinnerNumber}
      />
    </>
  );
}

/**
 * The reveal, in the raffle's own caption slot.
 *
 * It takes the place of "PRIZE RAFFLE" and the draw count for as long as a
 * winner is standing, and hands the slot straight back when the winner is
 * cleared. Sitting in the column beside the wheel rather than over it, it has
 * the display's plain paper behind it — so the ink is plain ink, with none of
 * the layered halo it needed to hold its own against the slices.
 */
function RaffleWinnerReveal({ winnerClaim, winnerNumber }) {
  return (
    <div className="raffle-reveal" role="status" aria-live="assertive">
      <p className="display-round display-raffle-eyebrow raffle-reveal-banner">WINNER!</p>
      {/* Number, separator, name — the same shape the slice carries on the
          wheel, so the reveal reads as that label made large rather than as a
          different way of writing it. */}
      <p className="raffle-reveal-name">
        <span className="raffle-reveal-number">
          {formatClaimNumber(winnerNumber).replace(/^#/, "")}
        </span>
        {winnerClaim?.displayName ? (
          <>
            <span className="raffle-reveal-dot" aria-hidden="true">
              ·
            </span>
            <span className="raffle-reveal-who">{winnerClaim.displayName}</span>
          </>
        ) : null}
      </p>
      <p className="raffle-reveal-copy">Come up and show your raffle QR code to staff!</p>
    </div>
  );
}

function DisplayPage({
  displayFeedItems,
  isEventLive,
  liveEvent,
  liveState,
  nextQrCountdownSeconds,
  qrRotationProgress,
  hasRosterAccess,
  onDismissStaffLoginMessage,
  raffleEligibleClaims,
  raffleWinnerClaim,
  rotatingClaimAccessUrl,
  staffLoginMessage,
}) {
  // Above the early return: the spin phase decides how much of the screen the
  // wheel is taking, and a hook cannot sit behind a conditional.
  const rafflePhase = useRaffleSpin({
    spinCount: liveState.raffleSpinCount,
    spinStartedAtMs: liveState.raffleSpinStartedAtMs,
    winnerNumber: liveState.raffleWinnerNumber,
  });

  /*
   * The event title, centred in the band above the called number: the strip
   * running from the very top of the screen down to the top of the ROUND line.
   * The time rides above the title rather than being centred alongside it, so
   * what lands in the middle of the band is the title itself.
   *
   * Measured rather than written in CSS, because the bottom edge of that band
   * is not a length the stylesheet knows. The round view is fixed and centred
   * on the viewport, so its first line lands wherever the height of the whole
   * called-number column happens to put it — and that column is a different
   * height for a number, for "Starting Soon" and for "FINAL CALL".
   *
   * Published as a translation rather than a position, so the title keeps its
   * place in the stage's grid: lifting it out of the flow would collapse the
   * row it occupies and drag the raffle's own heading up the screen with it.
   *
   * Which means the measurement has to read past its own last result, and the
   * way it does that is by subtracting the translation currently on the block —
   * taken from the computed matrix, so a reading during the 620ms glide is
   * still exact, because the box and the matrix are interpolated together.
   * Reading the untransformed position off `offsetTop` instead does not work:
   * a transformed element is an `offsetParent`, so the number that comes back
   * is measured from the block's own top edge and the whole band is out by
   * however far down the page the block sits.
   */
  const displayRef = useRef(null);
  const headerRef = useRef(null);
  const titleRowRef = useRef(null);
  const eyebrowRef = useRef(null);
  const logoRef = useRef(null);
  const titleRef = useRef(null);
  const roundLineRef = useRef(null);
  const centreTitleInBand = useCallback(() => {
    const root = displayRef.current;
    const header = headerRef.current;
    const titleRow = titleRowRef.current;
    const roundLine = roundLineRef.current;
    if (!root || !header || !titleRow || !roundLine) {
      return;
    }

    const applied = window.getComputedStyle(header).transform;
    const appliedShift =
      applied && applied !== "none" ? new DOMMatrixReadOnly(applied).m42 : 0;
    // Both boxes are in viewport terms: the round line because it is fixed, the
    // title because a client rect always is.
    const bandHeight = roundLine.getBoundingClientRect().top;
    const titleBox = titleRow.getBoundingClientRect();
    const titleCentre = titleBox.top - appliedShift + titleBox.height / 2;
    root.style.setProperty(
      "--display-title-shift",
      `${Math.round(bandHeight / 2 - titleCentre)}px`,
    );

    /*
     * And how much room the block has above it to give away.
     *
     * The time hangs off the top of the title row and outside its box, so it is
     * the first thing over the edge when the band is deep enough to pull the
     * whole block up — which is what a raffle's two-line title does. What goes
     * out is the time's own untransformed top; the stylesheet keeps the margin
     * and works out the rest, so the amount is a decision written in lengths
     * rather than a number arrived at here.
     */
    const eyebrow = eyebrowRef.current;
    if (eyebrow) {
      root.style.setProperty(
        "--display-title-headroom",
        `${Math.round(eyebrow.getBoundingClientRect().top - appliedShift)}px`,
      );
    }
  }, []);

  /*
   * The logo, slid across whatever the title is not using of its own box.
   *
   * A heading that wraps is as wide as the space it was given, not as wide as
   * its longest line, and the centred text leaves the difference standing
   * either side of itself. The logo is laid out against that box, so a title
   * that takes two lines pushed it half the leftover away from the words. It
   * never showed while the title was one line — a box with one line in it is
   * exactly as wide as the line — and the raffle is what makes it wrap, because
   * the column narrows to the gap beside the wheel.
   *
   * The lines are measured off a range over the heading's text rather than off
   * the heading itself, which is the only way to ask where the text actually
   * ended up rather than how much room it was offered.
   *
   * Moved by a transform, and this is the whole reason the fix is a shift
   * rather than a narrower heading: the heading is what the wrapping is
   * measured in, so resizing it would feed the answer back into the question.
   * A transform is not laid out, so the title wraps exactly as it did before
   * and the reading holds.
   *
   * Half the leftover, because the text is centred in the heading and so is
   * inset by the same amount at each end. The logo is hung off the heading's
   * left edge by the stylesheet, and half the leftover is the distance from
   * there to where the words actually begin.
   */
  const alignLogoToTitleText = useCallback(() => {
    const logo = logoRef.current;
    const title = titleRef.current;
    if (!logo || !title) {
      return;
    }

    const lines = document.createRange();
    lines.selectNodeContents(title);
    const lineBoxes = Array.from(lines.getClientRects());
    const widestLine = lineBoxes.reduce(
      (widest, line) => Math.max(widest, line.width),
      0,
    );
    const unusedWidth = title.getBoundingClientRect().width - widestLine;
    logo.style.setProperty(
      "--display-logo-shift",
      `${Math.max(0, unusedWidth) / 2}px`,
    );

    /*
     * And, on one line, the pair goes back to being what is centred.
     *
     * The logo is out of the flow precisely so that a wrapped title is centred
     * on its own words rather than dragged right by a logo standing beside the
     * top line — beside line one and nothing else, which is the thing that
     * looks wrong. A title that fits on one line has no such problem: the logo
     * is level with all of it, the two read as one lockup, and centring the
     * words alone leaves the lockup sitting left of the middle by half the room
     * the logo takes.
     *
     * So the row is nudged back by half of that room. The whole row moves, logo
     * and words together, which is what keeps this from feeding back into
     * anything: the overhang is the distance from the logo's left edge to where
     * the text starts, and a translation applied to both ends of that
     * measurement does not change it. The line boxes are already in hand from
     * the shift above, so the count comes free — a line box per line, and the
     * tops tell them apart.
     *
     * Published on the display rather than on the row itself, like the vertical
     * shift beside it, so that the layouts which do not want it can turn it off
     * for the row and everything inside the row at once.
     */
    const root = displayRef.current;
    if (!root) {
      return;
    }

    const firstLine = lineBoxes[0];
    const isOneLine =
      Boolean(firstLine) &&
      new Set(lineBoxes.map((line) => Math.round(line.top))).size === 1;
    const overhang = isOneLine
      ? firstLine.left - logo.getBoundingClientRect().left
      : 0;
    root.style.setProperty(
      "--display-title-pair-shift",
      `${Math.max(0, overhang) / 2}px`,
    );
  }, []);

  const layOutTitle = useCallback(() => {
    alignLogoToTitleText();
    centreTitleInBand();
  }, [alignLogoToTitleText, centreTitleInBand]);

  /*
   * Before paint, and after anything that changes the height of the column the
   * title is centred against — a round ticking over, a switch to FINAL CALL, the
   * raffle taking the middle of the screen.
   *
   * Listed explicitly rather than run after every render. Each pass does a
   * getComputedStyle, a DOMMatrix parse, three getBoundingClientRects and a
   * Range.getClientRects, all of which force synchronous layout — and this
   * screen re-renders once a second for the QR countdown, which moves none of
   * the boxes being measured. Everything else that can shift them without a
   * render of its own — a resize, the web fonts landing, the glide into and out
   * of a raffle — is covered by the ResizeObserver below.
   */
  useLayoutEffect(layOutTitle, [
    layOutTitle,
    liveEvent.timeframeLabel,
    liveState.current,
    liveState.finalCall,
    liveState.last,
    liveState.raffleOpen,
    liveState.round,
    liveState.title,
    liveState.titleFont,
    rafflePhase,
  ]);

  useEffect(() => {
    const titleRow = titleRowRef.current;
    const roundLine = roundLineRef.current;
    if (!titleRow || !roundLine) {
      return undefined;
    }

    /* The two ends of the band and the page itself: a resize carries every
       clamped font size on this screen with it. The web fonts land later
       still, and move both ends a few pixels without anything re-rendering.
       The row is also what the title's own wrapping follows — it is the width
       the heading is laid out in, so it changes on every frame of the glide
       into and out of a raffle, and the logo's shift is re-read with it. */
    const observer = new ResizeObserver(layOutTitle);
    observer.observe(titleRow);
    observer.observe(roundLine);
    observer.observe(document.documentElement);
    let isCurrent = true;
    document.fonts?.ready?.then(() => {
      if (isCurrent) {
        layOutTitle();
      }
    });

    return () => {
      isCurrent = false;
      observer.disconnect();
    };
  }, [layOutTitle, isEventLive]);

  if (!isEventLive) {
    return (
              <SketchCard className="entry-card hero-card entry-hero sketch-entry-card" elevation={2}>
                <div className="entry-hero-body">
                  <h1>No event is currently live</h1>
                  <p>Looks like you're a little early! Check out our upcoming events below. If you're staff, use the login button below to start an event.</p>
                  <SketchMessageDialog message={staffLoginMessage} onDismiss={onDismissStaffLoginMessage} />
                </div>
                <div className="entry-staff-action">
                  <UpcomingEventsLink />
                </div>
              </SketchCard>
    );
  }

  const countdownLabel =
    nextQrCountdownSeconds === 1
      ? "Next QR code in 1 second"
      : `Next QR code in ${nextQrCountdownSeconds} seconds`;
  /*
   * One flag, for the whole raffle, and the only thing the change between the
   * two views is driven by. The wheel takes the left half of the display, so
   * the event info and the check-in card slide into the right half and the
   * activity feed — which lives in the bottom-left corner the wheel now covers
   * — fades out for the duration. All of that is in the stylesheet, hung off
   * the one class below; nothing here is timed in JavaScript.
   */
  const isRaffleOpen = Boolean(liveState.raffleOpen);
  /*
   * Where the raffle is up to, published on the root as a class.
   *
   * The wheel's own layer knows its phase, but on a one-column screen the spin
   * is not a thing that happens to the wheel alone: the wheel takes the whole
   * screen for it, so the time, the logo, the title and the check-in card have
   * to stand down for the length of it and come back around the winner — and
   * the wheel itself leaves at the reveal, because there is no half of the
   * screen left for a result to be announced in beside it. All of that is in
   * the stylesheet, on the condensed breakpoint, hung off these two classes;
   * the projector layout ignores them and is unchanged.
   *
   * Gated on the raffle being open so that a closed raffle's leftover winner —
   * the state the wheel fades out of — does not keep the display in its
   * reveal arrangement.
   */
  const rafflePhaseClass = !isRaffleOpen
    ? ""
    : rafflePhase === RAFFLE_PHASE.spinning
      ? " display--raffle-spinning"
      : rafflePhase === RAFFLE_PHASE.revealed
        ? " display--raffle-revealed"
        : "";

  return (
    <div
      className={`display${isRaffleOpen ? " display--raffle" : ""}${rafflePhaseClass}`}
      ref={displayRef}
    >
      <div className="display-stage">
        <div className="display-header-group" ref={headerRef}>
          <div className="display-title-row" ref={titleRowRef}>
            {/* Inside the title's own row, and hung above it by the stylesheet
                rather than stacked with it, because the title is what has to
                end up in the middle of the band and the time only has to stay
                directly over it. */}
            <p className="eyebrow" ref={eyebrowRef}>
              {liveEvent.timeframeLabel}
            </p>
            {/* Beside the whole heading rather than inside its text, so that it
                is centred against every line of a title that wraps and not just
                the first. What closes the gap to the words is the measured
                shift below. */}
            <img
              src={bbcLogo}
              alt="Boiler Book Club logo"
              className="display-logo"
              ref={logoRef}
            />
            <h1
              className={getEventTitleClassName(liveState.titleFont, "carnival")}
              ref={titleRef}
            >
              {liveState.title}
            </h1>
          </div>
        </div>

        {/*
          Both middles of the display, stacked in one cell and crossfaded.

          Neither is unmounted when the other takes over: the round view is what
          gives this cell its height, so keeping it there is what stops the title
          above and the check-in card below from jumping vertically at the very
          moment they are sliding across. Everything the raffle draws — the
          caption, the wheel, the reveal — is inside its own layer too, so it
          fades as one thing and holds its position while it goes.
        */}
        <div className="display-call-block">
          <div
            className={`display-call-layer display-call-layer--round${
              isRaffleOpen ? " display-call-layer--hidden" : ""
            }`}
            aria-hidden={isRaffleOpen}
          >
            <h2 className="display-round" ref={roundLineRef}>
              ROUND {liveState.round}
            </h2>
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

          <div
            className={`display-call-layer display-call-layer--raffle${
              isRaffleOpen ? "" : " display-call-layer--hidden"
            }`}
            aria-hidden={!isRaffleOpen}
          >
            <DisplayRaffleStage
              eligibleSegments={raffleEligibleClaims}
              hasRosterAccess={hasRosterAccess}
              isActive={isRaffleOpen}
              liveState={liveState}
              phase={rafflePhase}
              winnerClaim={raffleWinnerClaim}
            />
          </div>
        </div>

        <div className="display-stage-spacer" aria-hidden="true" />
      </div>

      {/*
        The feed and the QR card used to be two independently positioned fixed
        overlays anchored to the same corner region, so on a typical projector
        width they sat on top of each other — and neither reserved any layout
        space, letting the called number hide behind them on a short screen.
        They are now two cells of one grid row that the stage lays out around.
      */}
      <div className="display-bottom-bar">
        <div className="display-feed-slot" aria-live="polite" aria-atomic="false">
          {displayFeedItems.map((feedItem) => (
            <div key={feedItem.id} className="display-feed-item">
              {/*
                A member is marked by a rainbow ring around the picture. The
                per-name letter colours sit on the fallback rather than on this
                wrapper because the ring is itself a background — the two cannot
                share the property.
              */}
              <div
                className={`display-feed-avatar${feedItem.isMember ? " avatar-member-ring" : ""}`}
                aria-hidden="true"
              >
                {feedItem.avatarUrl ? (
                  <img src={feedItem.avatarUrl} alt="" className="display-feed-avatar-image" />
                ) : (
                  <span
                    className="display-feed-avatar-fallback"
                    style={getAvatarColors(feedItem.username)}
                  >
                    {(feedItem.username?.trim()?.charAt(0) ?? "?").toUpperCase()}
                  </span>
                )}
              </div>
              <p className="display-feed-copy">
                <strong className="display-feed-name">{feedItem.username}</strong>{" "}
                {feedItem.action}
              </p>
            </div>
          ))}
        </div>

        {/*
          The check-in code, or an explanation of where it went.

          The secret behind this QR is staff-only by security rule, so the
          rotating URL is empty on any display that is not holding a staff
          session — and this used to render nothing at all in that case. A
          projector showing a live event, no QR, and no reason why is the worst
          possible failure here: it is the only way into the event, the room
          cannot check in, and there is nothing on screen for staff to act on.
          It is not hypothetical either — a Discord lookup that fails without
          usable cached claims signs the tab out mid-event.

          So the slot always says something. The raffle stage beside it has
          reported this same condition for exactly this reason; this is the same
          message in the place it actually costs somebody their number.
        */}
        <div className="display-claim-qr-slot">
          <SketchCard
            className="rules-qr-container sketch-entry-card"
            elevation={1}
            fill="#ffffff"
            strokeColor="#111111"
          >
            {rotatingClaimAccessUrl ? (
              <div className="rules-qr-layout">
                <div className="qr-claim-copy">
                  <h2 className="qr-caption">Scan to Claim Your Number</h2>
                  <div className="qr-refresh-status" aria-live="polite">
                    <p className="qr-refresh-label">{countdownLabel}</p>
                    <SketchProgress
                      className="qr-refresh-track"
                      /* Whole percent. The bar is decoration the room never
                         reads a value off, and every distinct value it is
                         handed costs a full rough.js redraw — see the note in
                         SketchUI. Rounding holds it to a hundred redraws over
                         a rotation instead of one per render. */
                      value={Math.round(Math.max(0, Math.min(1, qrRotationProgress)) * 100)}
                      min={0}
                      max={100}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <div className="qr-code qr-code--claim">
                  <MemoQrCode value={rotatingClaimAccessUrl} size={160} />
                </div>
              </div>
            ) : (
              <div className="rules-qr-layout rules-qr-layout--unavailable">
                <div className="qr-claim-copy">
                  <h2 className="qr-caption">Check-in code unavailable</h2>
                  <p className="display-raffle-status" role="status" aria-live="assertive">
                    {hasRosterAccess
                      ? "Waiting for the check-in code from the event."
                      : "This screen is not signed in as staff, so it cannot show the check-in code."}
                  </p>
                  <p className="display-raffle-hint">
                    {hasRosterAccess
                      ? "If this does not clear, reopen the display from the control panel."
                      : "Open the display from the control panel, on a browser signed in with a staff account."}
                  </p>
                </div>
              </div>
            )}
          </SketchCard>
        </div>

        <div className="display-bottom-bar-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}

export default DisplayPage;
