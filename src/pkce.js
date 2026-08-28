/**
 * PKCE (RFC 7636) helpers for the Discord login.
 *
 * Kept dependency-free and separate from the login hook so the transform can be
 * unit tested against the RFC's own worked example. A wrong challenge is not a
 * subtle bug — Discord rejects the exchange and nobody can log in at all.
 *
 * Uses globalThis rather than window so the same code runs under the test
 * runner. `crypto.subtle` needs a secure context, which https and localhost
 * both are; plain http on a LAN address is not, and there it is undefined.
 */

/** RFC 7636 requires base64url without padding. */
const toBase64Url = (bytes) => {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * The secret half of the exchange: high-entropy, never sent until the code is
 * redeemed. 32 random bytes encode to 43 characters, the RFC's minimum.
 */
export const createCodeVerifier = () =>
  toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

/**
 * The public half: SHA-256 of the verifier, sent with the authorize request.
 *
 * An authorization code intercepted at the redirect is useless without the
 * matching verifier, which is what makes it safe for the code to travel in a
 * URL the way an access token never was.
 */
export const createCodeChallenge = async (codeVerifier) => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );

  return toBase64Url(new Uint8Array(digest));
};
