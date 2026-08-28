// The avatar URL is attacker-supplied and ends up in an <img src> on a projector
// in front of a room, so what this accepts is a security boundary rather than a
// formatting preference. See functions/avatarUrl.js.
import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAvatarUrl } from "../functions/avatarUrl.js";

test("keeps a real Discord CDN avatar", () => {
  const url = "https://cdn.discordapp.com/avatars/123/abc.png";
  assert.equal(sanitizeAvatarUrl(url), url);
});

test("keeps a Discord media proxy avatar", () => {
  const url = "https://media.discordapp.net/avatars/123/abc.png";
  assert.equal(sanitizeAvatarUrl(url), url);
});

test("keeps the default embed avatar the server builds for a user with no picture", () => {
  const url = "https://cdn.discordapp.com/embed/avatars/3.png";
  assert.equal(sanitizeAvatarUrl(url), url);
});

// The finding itself: any https URL used to be accepted.
test("refuses an arbitrary https host", () => {
  assert.equal(sanitizeAvatarUrl("https://example.invalid/anything.png"), "");
});

// A prefix or "contains" test on the raw string would accept both of these.
test("refuses a lookalike host that only starts with the CDN name", () => {
  assert.equal(sanitizeAvatarUrl("https://cdn.discordapp.com.example.invalid/x.png"), "");
});

test("refuses a host that merely contains the CDN name", () => {
  assert.equal(sanitizeAvatarUrl("https://example.invalid/cdn.discordapp.com/x.png"), "");
});

test("refuses credentials naming the CDN in front of another host", () => {
  assert.equal(sanitizeAvatarUrl("https://cdn.discordapp.com@example.invalid/x.png"), "");
});

test("refuses credentials in front of the real CDN", () => {
  assert.equal(sanitizeAvatarUrl("https://example.invalid@cdn.discordapp.com/x.png"), "");
});

test("refuses a subdomain of the allowed host", () => {
  assert.equal(sanitizeAvatarUrl("https://evil.cdn.discordapp.com/x.png"), "");
});

test("refuses non-https schemes on an allowed host", () => {
  assert.equal(sanitizeAvatarUrl("http://cdn.discordapp.com/avatars/123/abc.png"), "");
});

test("refuses javascript: and data: payloads", () => {
  assert.equal(sanitizeAvatarUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeAvatarUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "");
});

test("refuses anything that is not a parseable absolute URL", () => {
  assert.equal(sanitizeAvatarUrl("/avatars/123/abc.png"), "");
  assert.equal(sanitizeAvatarUrl("cdn.discordapp.com/avatars/123/abc.png"), "");
  assert.equal(sanitizeAvatarUrl("   "), "");
});

test("refuses non-strings and over-long values", () => {
  assert.equal(sanitizeAvatarUrl(undefined), "");
  assert.equal(sanitizeAvatarUrl(null), "");
  assert.equal(sanitizeAvatarUrl(42), "");
  assert.equal(sanitizeAvatarUrl({}), "");
  assert.equal(
    sanitizeAvatarUrl(`https://cdn.discordapp.com/${"a".repeat(2100)}.png`),
    "",
  );
});

test("trims surrounding whitespace on an otherwise valid URL", () => {
  const url = "https://cdn.discordapp.com/avatars/123/abc.png";
  assert.equal(sanitizeAvatarUrl(`  ${url}  `), url);
});
