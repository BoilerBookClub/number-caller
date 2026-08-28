/**
 * Whether an attendee's code can actually be scanned.
 *
 * The ticket knocks the attendee's number out of the middle of their QR code
 * and relies on error correction level H to reconstruct what the hole destroys.
 * That trade is sound in principle and the margin is not obvious by eye, so it
 * is computed here rather than asserted in a comment.
 *
 * The number that matters is not the one people quote. Level H recovers "about
 * 30%" of a code, but Reed-Solomon corrects per *block*, and a QR code of this
 * size is split into sixteen of them. A hole in the middle is one contiguous
 * blob, and interleaving does not spread a blob evenly — so the aggregate can
 * sit comfortably inside the budget while one individual block is over it, and
 * one block over budget is a code that does not decode at all.
 *
 * That is exactly what was happening: with the old JSON payload and the wider
 * hole a three-digit number needs, the worst block carried 16 damaged codewords
 * against a capacity of 15. Every attendee numbered 100 and up had a ticket
 * that could not be read.
 *
 * This reaches into qr.js, which is react-qr-code's own encoder, because the
 * question is about the matrix it produces and nothing else can answer it. If a
 * dependency bump moves those internals this test fails loudly, which is the
 * correct outcome for something that would otherwise fail silently on the night.
 */
import assert from "node:assert/strict";
import test from "node:test";

import QRCodeImpl from "qr.js/lib/QRCode.js";
import ErrorCorrectLevel from "qr.js/lib/ErrorCorrectLevel.js";
import RSBlock from "qr.js/lib/RSBlock.js";
import util from "qr.js/lib/util.js";

import { buildClaimQrPayload, buildRaffleQrPayload } from "../src/claimQr.js";

/*
 * The knockout diameter, as a fraction of the code's width. Kept in step by
 * hand with .claim-qr-number / .claim-qr-knockout / .claim-qr-ring in
 * src/App.css.
 *
 * One value, not two. The hole used to widen for a three-digit number, which
 * is the wrong thing to give ground on — the hole is what the error correction
 * has to absorb, and the digits are what can afford to be smaller. So the
 * circle is fixed here and .claim-qr-number--long shrinks the type inside it.
 */
const KNOCKOUT_DIAMETER = 0.40;

/*
 * How much of a block's correction budget the hole may spend.
 *
 * Not 100%: the budget also has to absorb everything the hole is not — glare on
 * a phone screen, a fingerprint, motion blur, a cracked display, the couple of
 * modules a rough-edged circle clips. Two thirds leaves that room.
 */
const MAX_BLOCK_BUDGET_USED = 0.7;

/** A claim as it actually exists: uuid event id, percent-encoded key, uuid token. */
const EVENT_ID = "3f6a1c88-4b2e-4d51-9a7c-1e2f3a4b5c6d";
const SAMPLE_CLAIM = {
  claimId: `${EVENT_ID}__${encodeURIComponent("discord:123456789012345678")}`,
  eventId: EVENT_ID,
  qrToken: "9c1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6",
};

/** Every module a QR code spends on structure rather than on data. */
const buildFunctionModuleMask = (size, version) => {
  const mask = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (row, column) => {
    if (row >= 0 && row < size && column >= 0 && column < size) {
      mask[row][column] = true;
    }
  };

  // Finder patterns and their separators, in three corners.
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      set(row, column);
      set(row, size - 1 - column);
      set(size - 1 - row, column);
    }
  }

  // Timing patterns.
  for (let index = 8; index < size - 8; index += 1) {
    set(6, index);
    set(index, 6);
  }

  // Alignment patterns, minus the three that would sit on a finder.
  const positions = util.getPatternPosition(version);
  const lastPosition = positions[positions.length - 1];

  positions.forEach((row) => {
    positions.forEach((column) => {
      const isFinderCorner =
        (row === 6 && column === 6) ||
        (row === 6 && column === lastPosition) ||
        (row === lastPosition && column === 6);

      if (isFinderCorner) {
        return;
      }

      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          set(row + rowOffset, column + columnOffset);
        }
      }
    });
  });

  // Format information, and the one module that is always dark.
  for (let index = 0; index < 9; index += 1) {
    set(8, index);
    set(index, 8);
  }
  for (let index = 0; index < 8; index += 1) {
    set(8, size - 1 - index);
    set(size - 1 - index, 8);
  }
  set(size - 8, 8);

  // Version information, from version 7 up.
  if (version >= 7) {
    for (let index = 0; index < 6; index += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        set(index, size - 11 + offset);
        set(size - 11 + offset, index);
      }
    }
  }

  return mask;
};

/** Every data module, in the order the encoder writes bits into them. */
const buildPlacementOrder = (size, functionMask) => {
  const order = [];
  let rowStep = -1;
  let row = size - 1;

  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) {
      column -= 1;
    }

    for (;;) {
      for (let offset = 0; offset < 2; offset += 1) {
        if (!functionMask[row][column - offset]) {
          order.push([row, column - offset]);
        }
      }

      row += rowStep;

      if (row < 0 || row >= size) {
        row -= rowStep;
        rowStep = -rowStep;
        break;
      }
    }
  }

  return order;
};

/**
 * Which RS block each codeword in the interleaved stream belongs to.
 *
 * Data codewords go out round-robin across the blocks, skipping any block that
 * has run out; then the error-correction codewords do the same. This is what
 * decides whether a contiguous hole is shared out or lands on one block.
 */
const buildInterleaveMap = (blocks) => {
  const longestDataRun = Math.max(...blocks.map((block) => block.dataCount));
  const ecCount = blocks[0].totalCount - blocks[0].dataCount;
  const map = [];

  for (let index = 0; index < longestDataRun; index += 1) {
    blocks.forEach((block, blockIndex) => {
      if (index < block.dataCount) {
        map.push(blockIndex);
      }
    });
  }

  for (let index = 0; index < ecCount; index += 1) {
    blocks.forEach((_, blockIndex) => map.push(blockIndex));
  }

  return map;
};

/** The worst block's share of its own correction budget, for one hole size. */
const measureKnockout = (payload, diameterFraction) => {
  const code = new QRCodeImpl(-1, ErrorCorrectLevel.H);
  code.addData(payload);
  code.make();

  const size = code.modules.length;
  const version = (size - 17) / 4;
  const functionMask = buildFunctionModuleMask(size, version);
  const placementOrder = buildPlacementOrder(size, functionMask);
  const blocks = RSBlock.getRSBlocks(version, ErrorCorrectLevel.H);
  const interleaveMap = buildInterleaveMap(blocks);

  const centre = (size - 1) / 2;
  const radius = (diameterFraction * size) / 2;
  const isUnderKnockout = (row, column) =>
    Math.hypot(row - centre, column - centre) <= radius;

  const damagedCodewords = new Set();
  placementOrder.forEach(([row, column], bitIndex) => {
    if (isUnderKnockout(row, column)) {
      damagedCodewords.add(Math.floor(bitIndex / 8));
    }
  });

  const damagedPerBlock = new Array(blocks.length).fill(0);
  damagedCodewords.forEach((codeword) => {
    const blockIndex = interleaveMap[codeword];

    if (blockIndex !== undefined) {
      damagedPerBlock[blockIndex] += 1;
    }
  });

  /* Reed-Solomon corrects half as many errors as it has EC codewords, because
     a decoder has to work out *where* each error is as well as what it should
     have been. The hole's position is obvious to us and invisible to a scanner,
     so none of this can be claimed as the cheaper erasure case. */
  const worstBlockShare = Math.max(
    ...damagedPerBlock.map((damaged, blockIndex) => {
      const block = blocks[blockIndex];
      return damaged / Math.floor((block.totalCount - block.dataCount) / 2);
    }),
  );

  return { size, version, worstBlockShare };
};

test("the claim payload stays small enough to keep the modules large", () => {
  const payload = buildClaimQrPayload(SAMPLE_CLAIM);
  const { size, version } = measureKnockout(payload, KNOCKOUT_DIAMETER);

  assert.ok(payload.length <= 128, `claim payload grew to ${payload.length} bytes`);
  /* Version 10 is a 57x57 grid. The JSON payload this replaced needed version
     16, an 81x81 grid — the same box on the same phone, with every module drawn
     40% smaller, which is what a code has to give up to be read across a table
     in bad light. */
  assert.ok(version <= 10, `claim code grew to version ${version} (${size} modules)`);
});

test("the knocked-out number leaves every RS block inside its budget", () => {
  const payload = buildClaimQrPayload(SAMPLE_CLAIM);

  const { worstBlockShare } = measureKnockout(payload, KNOCKOUT_DIAMETER);

  assert.ok(
    worstBlockShare <= MAX_BLOCK_BUDGET_USED,
    `a ${(KNOCKOUT_DIAMETER * 100).toFixed(0)}% hole spends `
      + `${(worstBlockShare * 100).toFixed(0)}% of the worst block's correction `
      + `budget (max ${MAX_BLOCK_BUDGET_USED * 100}%)`,
  );
});

test("the raffle prize code is measured the same way and fits too", () => {
  // Same fields, one character different, so it lands on the same version — but
  // it is the code a winner holds up at the prize table, so it is asserted
  // rather than assumed.
  const { worstBlockShare } = measureKnockout(
    buildRaffleQrPayload(SAMPLE_CLAIM),
    KNOCKOUT_DIAMETER,
  );

  assert.ok(worstBlockShare <= MAX_BLOCK_BUDGET_USED);
});

test("a hole the size of the one that shipped broken is still detected as broken", () => {
  // The old geometry: a 52% circle on the old 207-byte JSON payload. This is
  // the regression this whole file exists to catch, so the measurement is
  // checked against a case that must fail.
  const oldPayload = JSON.stringify({
    claimId: SAMPLE_CLAIM.claimId,
    eventId: SAMPLE_CLAIM.eventId,
    kind: "number-caller-claim",
    qrToken: SAMPLE_CLAIM.qrToken,
  });
  const { worstBlockShare } = measureKnockout(oldPayload, 0.52);

  assert.ok(
    worstBlockShare > 1,
    `expected the old geometry to exceed a block's budget, got ${worstBlockShare.toFixed(2)}`,
  );
});
