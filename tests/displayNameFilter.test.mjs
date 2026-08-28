// Unit tests for the display-name profanity filter — the one screen that stands
// between a name typed into a Discord profile and a projector at a student
// event. No emulator, no browser.
//
// Run with:  npm run test:unit

import assert from "node:assert/strict";
import test from "node:test";

import { containsProfanity } from "../functions/displayNameFilter.js";

test("profanity is caught through substitution, spacing and full-width forms", () => {
  for (const name of [
    "fuck",
    "FUCK",
    "fvck",
    "fuuuck",
    "sh1t",
    "b!tch",
    "a55hole",
    "n1gger",
    "f u c k",
    "f.u.c.k",
    "F_U_C_K",
    "ｆｕｃｋ",
  ]) {
    assert.ok(containsProfanity(name), name);
  }
});

test("the supplemental list covers impersonation and terms the dataset omits", () => {
  for (const name of ["admin", "Moderator", "Event Staff", "Hitler"]) {
    assert.ok(containsProfanity(name), name);
  }
});

/*
 * The supplemental terms are anchored to word boundaries, and these are the
 * names that paid for it before they were.
 *
 * Every one of these was silently replaced with "Guest" on the projector:
 * "therapist" carries "rapist", "badminton" and "Padmini" carry "admin",
 * "torpedo" and "pedometer" carry "pedo", and "Nazir" and "Nazira" — real
 * given names belonging to real people — carry "nazi". Doing that to somebody
 * is worse than the thing the filter exists to prevent, and it happened
 * without a word to anyone.
 */
test("a supplemental term buried inside an ordinary word or name is not caught", () => {
  for (const name of [
    "therapist",
    "badminton",
    "Padmini",
    "Nazir",
    "Nazira",
    "torpedo",
    "pedometer",
    "spicy",
    "despicable",
    "sysadmin_dave",
  ]) {
    assert.equal(containsProfanity(name), false, name);
  }
});

/* The other half of the same bargain: anchoring must not have opened a hole.
   The collapsed view strips separators before matching, so a spaced-out term
   is the whole string by the time it gets here and still hits its boundaries. */
test("anchoring does not let a whole-name term or a spaced-out one through", () => {
  for (const name of [
    "Admin",
    "ADMIN",
    "Event Admin",
    "administrator",
    "BBC Staff",
    "bbcstaff",
    "nazi",
    "n a z i",
    "N.A.Z.I",
    "heil hitler",
    "rapist",
    "a rapist",
    "pedo",
    "pedophile",
    "tranny",
    "t r a n n y",
    "groyper",
    "raghead",
  ]) {
    assert.ok(containsProfanity(name), name);
  }
});

test("innocent words that merely contain a rude substring are not caught", () => {
  // The dataset's own whitelist, which the collapsed-view pass must not defeat.
  for (const name of ["Scunthorpe", "classic", "assassin", "Titan Ic", "Mass Hall", "Book Club"]) {
    assert.equal(containsProfanity(name), false, name);
  }
});

test("a non-string, or an empty name, is not profane", () => {
  for (const value of ["", null, undefined, 42, {}]) {
    assert.equal(containsProfanity(value), false, String(value));
  }
});
