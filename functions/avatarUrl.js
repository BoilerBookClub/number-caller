/* eslint-env node */
/**
 * Whether an avatar image may be shown.
 *
 * The avatar URL is taken from the request body on every check-in path — it is
 * not derived from the verified token — and it is rendered straight into an
 * <img src> on the control panel's roster and on the projector's activity feed.
 * "Any absolute https URL", which is what this used to accept, therefore let any
 * attendee holding a Discord account put an arbitrary image in front of the
 * room. That is the same exposure the profanity filter exists to close for
 * display names, and images had no equivalent gate.
 *
 * Kept out of index.js and free of Firestore so it can be unit tested without an
 * emulator — the same reason displayNameFilter.js sits beside it. Nothing here
 * touches the database or the network.
 */

/**
 * Hosts an avatar may be served from.
 *
 * Every legitimate value is built by buildDiscordAvatarUrl in index.js, which
 * only ever produces cdn.discordapp.com. media.discordapp.net is Discord's own
 * resizing proxy for the same assets and is accepted alongside it.
 */
export const ALLOWED_AVATAR_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

const ALLOWED_AVATAR_HOST_SET = new Set(ALLOWED_AVATAR_HOSTS);

const MAX_AVATAR_URL_LENGTH = 2048;

/**
 * The avatar URL to store, or "" for anything not clearly Discord's.
 *
 * Matched on the parsed hostname rather than on the string. A prefix or
 * "contains" test on the raw text is defeated by a lookalike host
 * (https://cdn.discordapp.com.example.invalid/x.png) and by an embedded-
 * credential URL (https://cdn.discordapp.com@example.invalid/x.png), both of
 * which read as Discord's and are not.
 *
 * A refused URL falls back to "" rather than throwing, exactly as a refused
 * display name falls back to "Guest": nobody should lose their number over the
 * avatar on their Discord profile. Every render site already draws "" as the
 * letter avatar.
 */
export const sanitizeAvatarUrl = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmedValue = value.trim();

  if (!trimmedValue || trimmedValue.length > MAX_AVATAR_URL_LENGTH) {
    return "";
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    return "";
  }

  if (parsedUrl.protocol !== "https:" || !ALLOWED_AVATAR_HOST_SET.has(parsedUrl.hostname)) {
    return "";
  }

  // https://cdn.discordapp.com@evil.invalid/ is already refused above, because
  // the host there is evil.invalid and the CDN name is only the username. This
  // catches the mirror image, https://evil.invalid@cdn.discordapp.com/, which
  // does resolve to the CDN and so passes the host check. Refused rather than
  // stripped: no legitimate avatar carries credentials.
  if (parsedUrl.username || parsedUrl.password) {
    return "";
  }

  return trimmedValue;
};
