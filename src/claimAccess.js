export const CLAIM_ACCESS_ROTATION_MS = 60_000;
export const CLAIM_ACCESS_GRANT_MS = 5 * 60_000;

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

export const buildClaimAccessCode = (secret, timestamp = Date.now()) => {
  if (!secret) {
    return "";
  }

  const bucket = Math.floor(timestamp / CLAIM_ACCESS_ROTATION_MS);

  return hashClaimAccessValue(`${secret}:${bucket}`);
};

export const isValidClaimAccessCode = (secret, candidateCode, timestamp = Date.now()) => {
  if (!secret || !candidateCode) {
    return false;
  }

  return [timestamp, timestamp - CLAIM_ACCESS_ROTATION_MS].some(
    (candidateTimestamp) => buildClaimAccessCode(secret, candidateTimestamp) === candidateCode,
  );
};