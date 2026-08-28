export const CLAIM_ACCESS_ROTATION_MS = 60_000;
/**
 * How long a scan keeps showing the check-in screen rather than the "scan the
 * QR code" wall.
 *
 * Not a permission — the server re-checks the code on every call, and a stale
 * grant is cleared the moment it refuses one. It only has to outlast a Discord
 * login: an OAuth round trip, and whatever time the attendee spends deciding.
 */
export const CLAIM_ACCESS_GRANT_MS = 30 * 60_000;

const hashClaimAccessValue = (value) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 8);
};

export const createClaimAccessSecret = () =>
  globalThis.crypto?.randomUUID?.() ??
  `claim-access-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Used by the display (staff-only) to render the rotating QR code. Scanned codes
// are verified server-side in functions/index.js, which holds the matching
// implementation — keep the two in sync if this hash ever changes.
export const buildClaimAccessCode = (secret, timestamp = Date.now()) => {
  if (!secret) {
    return "";
  }

  const bucket = Math.floor(timestamp / CLAIM_ACCESS_ROTATION_MS);

  return hashClaimAccessValue(`${secret}:${bucket}`);
};