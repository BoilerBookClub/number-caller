const DEFAULT_CLAIM_RULE_LINES = [
  "When your number is called, you can come up and claim one item.",
  "Before your number is called, read the book descriptions, which are linked below your number, so you know what you'd like to grab.",
  "After you claim your item, a staff member will scan your QR code to confirm your claim.",
  "There will likely be multiple rounds of goodie selection, so once the current round ends, you'll be up again for more. You'll want to stick around.",
];

const MAX_CLAIM_RULES_TEXT_LENGTH = 6000;

export const DEFAULT_CLAIM_RULES_TEXT = DEFAULT_CLAIM_RULE_LINES.join("\n");

export const normalizeClaimRulesText = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_CLAIM_RULES_TEXT;
  }

  return value
    .replace(/\r\n/g, "\n")
    .slice(0, MAX_CLAIM_RULES_TEXT_LENGTH);
};

export const parseClaimRulesList = (value) => {
  const normalizedText = normalizeClaimRulesText(value);
  const parsedLines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(\d+[\).\s-]+|[-*]\s+)/, "").trim())
    .filter(Boolean);

  return parsedLines.length ? parsedLines : [...DEFAULT_CLAIM_RULE_LINES];
};
