const CLAIM_QR_KIND = "number-caller-claim";

export const createClaimQrToken = () =>
  globalThis.crypto?.randomUUID?.() ??
  `claim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const buildClaimQrPayload = ({ claimId, eventId, qrToken }) =>
  JSON.stringify({
    claimId,
    eventId,
    kind: CLAIM_QR_KIND,
    qrToken,
  });

export const parseClaimQrPayload = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    if (
      parsed?.kind !== CLAIM_QR_KIND ||
      typeof parsed.claimId !== "string" ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.qrToken !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};