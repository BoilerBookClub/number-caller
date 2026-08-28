/* eslint-env node */
/**
 * Whether a display name may go on the projector.
 *
 * The name is taken from the request body on every check-in path — a Discord
 * username is not verified either — so this screen is the only thing between a
 * profile name and a room full of people. See sanitizeDisplayName in index.js
 * for what a refusal does (it falls back to "Guest" rather than throwing).
 *
 * Kept out of index.js and free of Firestore so it can be unit tested without an
 * emulator — see tests/displayNameFilter.test.mjs. Nothing here touches the
 * database or the network.
 */
import {
  englishDataset,
  englishRecommendedTransformers,
  pattern,
  RegExpMatcher,
} from "obscenity";


/**
 * Terms the English dataset does not carry that still have no place on a
 * projector at a student event: a handful of hate terms it omits, and the words
 * an attendee could use to pass themselves off as running the event.
 */
const SUPPLEMENTAL_BLACKLIST = [
  "trany", "kike", "gook", "chink", "spic", "wetback", "raghead",
  "groyper", "heilhitler", "hitler", "nazi",
  "rapist", "pedo", "pedophile",
  "bbcstaf", "eventstaf", "admin", "moderator", "administrator",
];
/*
 * Two spellings above are not typos, and one word is not missing by accident.
 *
 * The English preset collapses repeated letters in the *input* before matching
 * — down to one, except b/e/o/l/s/g which may keep two — and does not do the
 * same to the pattern. So a pattern has to be written the way the input will
 * arrive: "tranny" never matches, because the text it would match became
 * "trany" on the way in. Same for the doubled f in "staff".
 *
 * By that same rule "kkk" collapses to "k", which would match every word
 * containing one, so it is left out rather than written unusable. The dataset
 * already carries the slurs it stands in for.
 *
 * Phrases carry no spaces because they are matched against the collapsed view
 * below, which has already had them removed.
 */

/*
 * Every supplemental term is matched at word boundaries.
 *
 * `|term|` is obscenity's boundary assertion: the match has to start at the
 * start of the string or after a non-word character, and end at the end of the
 * string or before one.
 *
 * Without it these were substring matches, and the cost was not theoretical.
 * "therapist" contains "rapist". "badminton" and "Padmini" contain "admin".
 * "torpedo" and "pedometer" contain "pedo". "Nazir" and "Nazira" — which are
 * real given names belonging to real people — contain "nazi". Every one of
 * those was silently replaced with "Guest" on the projector, which is a worse
 * thing to do to somebody than the thing the filter is here to prevent.
 * Anchoring took a measured 19 false positives down to zero.
 *
 * It costs almost nothing in coverage. Both views are still matched, and the
 * collapsed view strips separators before this runs — so "n a z i" and
 * "N.A.Z.I" collapse to a bare "nazi" that is itself the whole string, and
 * still match. What no longer matches is a term buried inside a longer run of
 * letters, which is exactly the case that was catching bystanders.
 *
 * The dataset's own terms are unaffected; it brings its own patterns and its
 * own whitelist.
 */

const buildMatcher = () => {
  const dataset = englishDataset.build();

  return new RegExpMatcher({
    ...dataset,
    ...englishRecommendedTransformers,
    blacklistedTerms: [
      ...dataset.blacklistedTerms,
      ...SUPPLEMENTAL_BLACKLIST.map((term, index) => ({
        id: 100_000 + index,
        pattern: pattern`|${term}|`,
      })),
    ],
  });
};

// Building the dataset compiles a few hundred patterns, so it happens once per
// function instance rather than once per name.
let cachedMatcher = null;

const getMatcher = () => {
  if (!cachedMatcher) {
    cachedMatcher = buildMatcher();
  }

  return cachedMatcher;
};

/**
 * The separator-stripped view of a name.
 *
 * The matcher's own transformers handle substitution inside a word — "fvck",
 * "sh1t", full-width and confusable letters all match on their own. What they
 * deliberately do not do is remove separators (the preset ships with
 * skipNonAlphabeticTransformer commented out, to avoid false positives across
 * word boundaries), so "f u c k" and "f.u.c.k" walk straight through. Matching
 * this view as well closes that off, and the dataset's whitelist still applies
 * to it, so "Scunthorpe" and "classic" stay clean.
 */
const buildCollapsedView = (value) =>
  value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const containsProfanity = (value) => {
  if (typeof value !== "string" || !value) {
    return false;
  }

  const matcher = getMatcher();

  return matcher.hasMatch(value) || matcher.hasMatch(buildCollapsedView(value));
};
