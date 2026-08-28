/*
 * What an attendee's ticket encodes, and how the scanner reads it back.
 *
 * The payload is deliberately terse, because its length decides how many
 * modules the code needs and therefore how large each one is drawn. The old
 * shape was JSON — `{"claimId":…,"eventId":…,"kind":"number-caller-claim",
 * "qrToken":…}` — which came to 207 bytes for a real claim and pushed the code
 * to version 16, an 81x81 grid. Two thirds of that was redundant: `claimId`
 * already begins with `eventId`, and the kind was a twenty-character sentence.
 *
 * At 105 bytes the same claim is version 10, a 57x57 grid, so every module is
 * drawn around 40% larger inside the same box. That is the single biggest thing
 * that decides whether a code scans across a table in poor light.
 *
 * It matters for a second reason. The number is knocked out of the middle of
 * the code, which destroys whatever codewords sit under it, and Reed-Solomon
 * corrects per *block* rather than across the code as a whole — so a
 * contiguous hole concentrates its damage rather than spreading it. Measured
 * against the real payload (see tests/claimQr.test.mjs, which does the
 * arithmetic rather than trusting it): the old JSON payload with the wide
 * three-digit hole put 16 damaged codewords into a block that can correct 15,
 * and did not decode at all. The compact payload leaves the worst block at
 * around two thirds of its budget.
 *
 * Nothing here reaches the server. The callables take claimId, eventId and
 * qrToken as separate arguments, so this format is entirely between the ticket
 * and the scanner and can change without a deploy of the functions.
 */

/*
 * One character each, because these are compared and never read by a human.
 * A raffle prize can never be scanned as an item claim (or the other way
 * round) even though both carry the same claim id and token: the scanner
 * branches on this, and the two callables it reaches do entirely different
 * things.
 */
const CLAIM_QR_KIND = "c";
const RAFFLE_QR_KIND = "r";

/*
 * Bumped if the field order or the separator ever changes, so a ticket left
 * open on a phone across a deploy is rejected cleanly by the scanner rather
 * than parsed into the wrong fields.
 */
const CLAIM_QR_VERSION = "1";

/*
 * Not a character any field can contain. A claim id is an event uuid, two
 * underscores and a percent-encoded participant key; an event id is a uuid; a
 * qrToken is a uuid. None of them can produce a `|`, and percent-encoding is
 * what guarantees that for the one field built from user-adjacent input.
 */
const FIELD_SEPARATOR = "|";

/*
 * The event id is not carried. A claim id is `${eventId}__${participantKey}` —
 * see buildClaimId in src/firebase.js and buildAttendeeClaimId in
 * functions/index.js, which are the same construction on both sides — so
 * sending both put a 36-character uuid into the code twice for nothing. That
 * duplication alone was 36 of the bytes that pushed the old payload up a
 * version and shrank every module.
 *
 * The participant key is percent-encoded before it is joined on, and neither a
 * uuid event id nor a percent-encoded key can contain a double underscore, so
 * the first `__` is unambiguously the seam.
 */
const CLAIM_ID_SEPARATOR = "__";

const buildQrPayloadOfKind = ({ claimId, qrToken }, kind) =>
  [CLAIM_QR_VERSION, kind, claimId, qrToken].join(FIELD_SEPARATOR);

const readEventIdFromClaimId = (claimId) => {
  const seamIndex = claimId.indexOf(CLAIM_ID_SEPARATOR);

  return seamIndex > 0 ? claimId.slice(0, seamIndex) : "";
};

export const buildClaimQrPayload = (claim) => buildQrPayloadOfKind(claim, CLAIM_QR_KIND);

/**
 * The winner's prize code. Reuses the claim's own token rather than minting a
 * second one: the token is what proves the code came from that attendee's
 * ticket, and whether they may claim a prize is decided server-side from the
 * event's winner list, not from anything encoded here.
 */
export const buildRaffleQrPayload = (claim) => buildQrPayloadOfKind(claim, RAFFLE_QR_KIND);

const parseQrPayloadOfKind = (value, kind) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parts = value.trim().split(FIELD_SEPARATOR);

  if (parts.length !== 4) {
    return null;
  }

  const [payloadVersion, payloadKind, claimId, qrToken] = parts;

  if (payloadVersion !== CLAIM_QR_VERSION || payloadKind !== kind) {
    return null;
  }

  if (!claimId || !qrToken) {
    return null;
  }

  const eventId = readEventIdFromClaimId(claimId);

  if (!eventId) {
    return null;
  }

  /* The scanner hands these straight to a callable that interpolates them into
     a document path, and the server rejects an id carrying a slash — but there
     is no reason to spend a round trip finding that out. */
  if (claimId.includes("/")) {
    return null;
  }

  return { claimId, eventId, qrToken };
};

export const parseClaimQrPayload = (value) => parseQrPayloadOfKind(value, CLAIM_QR_KIND);

export const parseRaffleQrPayload = (value) => parseQrPayloadOfKind(value, RAFFLE_QR_KIND);
