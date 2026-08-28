/**
 * Colours for letter avatars.
 *
 * An attendee who has no Discord picture — every fake attendee in a demo, and
 * any real one whose avatar failed to come across — falls back to the first
 * letter of their name. A whole roster of those in one colour reads as a column
 * of identical blobs, so each name gets a colour of its own.
 *
 * The colour is a pure function of the name, so the same person is the same
 * colour in the roster, the queue and the display feed, and stays that colour
 * across reloads and across the two control panels driving one event.
 */

/**
 * Light fills with ink dark enough to read on them. The first pair is the blue
 * every letter avatar used to be, so nothing about the existing look is lost —
 * it is now one option among several.
 */
const AVATAR_COLORS = [
  { background: "#eaf3ff", color: "#225a9a" },
  { background: "#fdeaf1", color: "#a12b5c" },
  { background: "#eafaef", color: "#1f7a45" },
  { background: "#fff3d6", color: "#8a5a12" },
  { background: "#f0eaff", color: "#5a3ea1" },
  { background: "#e4f7f7", color: "#16707a" },
  { background: "#ffece1", color: "#a5502a" },
  { background: "#f1f6da", color: "#5c7016" },
];

/** FNV-1a. Only needs to spread names evenly over the palette. */
const hashName = (value) => {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

/** The `{ background, color }` pair for one name, for use as an inline style. */
export const getAvatarColors = (name) => AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
