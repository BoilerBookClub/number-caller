/**
 * Fake participants for a demo event.
 *
 * A demo event is a real event in every respect the app can see: the fake
 * attendees are ordinary claim and preclaim documents, so the display, the
 * roster, the graphs, auto-advance and the backlog all exercise their real code
 * paths. The only two differences are that the event document carries
 * `isDemo: true` — which stops the close handler from filing it under Past
 * Events — and that a driver in the control panel stands in for the phones the
 * fake attendees do not have.
 *
 * Everything here is pure and deterministic given an event id, so two control
 * panels driving the same demo agree on who exists, what they are called and
 * whether they are members. The randomness that should *not* be reproducible —
 * when someone joins, whether they bother picking up an item — is rolled at the
 * moment it happens and passed in.
 */

/** Fake attendees are keyed `demo:{index}` where real ones are `discord:{uid}`. */
const DEMO_CLAIM_KEY_PREFIX = "demo";
export const DEMO_PARTICIPANT_TYPE = "demo";

/** How many participants one seed call may carry, matching the callable's cap. */
export const DEMO_SEED_BATCH_SIZE = 25;

export const DEMO_LIMITS = {
  memberPercent: { max: 100, min: 0 },
  /*
   * Matched to the largest event this is actually expected to run — the point
   * of a demo is to find out what a full house does to the control panel, the
   * backlog and the display, and a cap of 120 could not show that.
   *
   * Kept in step by hand with validDemoConfig in firestore.rules, which caps
   * the same field on the event document. Names stay unique to 900, so 300 is
   * comfortably inside what buildDemoDisplayName can distinguish.
   */
  participantCount: { max: 300, min: 1 },
  pickupChancePercent: { max: 100, min: 0 },
  preStartPercent: { max: 100, min: 0 },
};

export const initialDemoConfig = {
  /** Share of fake attendees flagged as members, so early check-in is exercised. */
  memberPercent: 40,
  participantCount: 24,
  /** Chance one of them actually picks up an item in a round they are called for. */
  pickupChancePercent: 80,
  /** Share who queue before the doors open; the rest trickle in once it starts. */
  preStartPercent: 60,
};

/* Names are two words joined together — "BoredSoup", "QuietLantern" — so they
   read as handles rather than as people, and nobody mistakes one for a real
   attendee in the roster. */
const DEMO_ADJECTIVES = [
  "Bored", "Quiet", "Brisk", "Sleepy", "Clever", "Rustic",
  "Velvet", "Amber", "Hollow", "Restless", "Crooked", "Gentle",
  "Wandering", "Marbled", "Frosted", "Idle", "Solemn", "Chipper",
  "Lucky", "Feral", "Polite", "Tangled", "Humble", "Wistful",
  "Brave", "Salty", "Nimble", "Drowsy", "Sturdy", "Faint",
];

const DEMO_NOUNS = [
  "Soup", "Lantern", "Compass", "Kettle", "Pebble", "Harbor",
  "Thicket", "Sparrow", "Anvil", "Meadow", "Ledger", "Bramble",
  "Cobble", "Willow", "Fable", "Cinder", "Beacon", "Mitten",
  "Sonnet", "Quarry", "Trellis", "Puddle", "Cricket", "Almanac",
  "Ferry", "Lintel", "Bassoon", "Domino", "Orchard", "Turnip",
];

const clampToLimit = (value, { max, min }, fallbackValue) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return fallbackValue;
  }

  return Math.max(min, Math.min(max, parsedValue));
};

export const normalizeDemoConfig = (nextConfig) => ({
  memberPercent: clampToLimit(
    nextConfig?.memberPercent,
    DEMO_LIMITS.memberPercent,
    initialDemoConfig.memberPercent,
  ),
  participantCount: clampToLimit(
    nextConfig?.participantCount,
    DEMO_LIMITS.participantCount,
    initialDemoConfig.participantCount,
  ),
  pickupChancePercent: clampToLimit(
    nextConfig?.pickupChancePercent,
    DEMO_LIMITS.pickupChancePercent,
    initialDemoConfig.pickupChancePercent,
  ),
  preStartPercent: clampToLimit(
    nextConfig?.preStartPercent,
    DEMO_LIMITS.preStartPercent,
    initialDemoConfig.preStartPercent,
  ),
});

/** FNV-1a. Only needs to spread event ids across the PRNG's seed space. */
const hashSeed = (value) => {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

/** mulberry32: small, seeded, and good enough to shuffle a guest list. */
const createSeededRandom = (seed) => {
  let state = hashSeed(seed) || 1;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffled = (values, random) => {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
};

/**
 * A unique two-word name per index.
 *
 * Walking the noun list one step at a time and the adjective list one extra
 * step per lap means the first 900 indices are all distinct pairs, so a demo
 * never shows the same handle twice.
 */
const buildDemoDisplayName = (index, { adjectives, nouns }) => {
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.trunc(index) : 0;
  const adjective =
    adjectives[(safeIndex + Math.floor(safeIndex / adjectives.length)) % adjectives.length];

  return `${adjective}${nouns[safeIndex % nouns.length]}`;
};

const buildDemoClaimKey = (index) => `${DEMO_CLAIM_KEY_PREFIX}:${index}`;

const buildDemoClaimId = (eventId, index) =>
  `${eventId}__${encodeURIComponent(buildDemoClaimKey(index))}`;

/**
 * The full guest list for a demo event.
 *
 * Membership and join timing are drawn as exact counts from two independent
 * shuffles rather than rolled per person, so "40% members" produces 40% of the
 * room and not a binomial spread around it — which at 10 participants is the
 * difference between a settings panel that works and one that looks broken.
 */
export const planDemoParticipants = ({ config, eventId }) => {
  const { memberPercent, participantCount, preStartPercent } = normalizeDemoConfig(config);
  const random = createSeededRandom(`${eventId}:participants`);
  const adjectives = shuffled(DEMO_ADJECTIVES, createSeededRandom(`${eventId}:adjectives`));
  const nouns = shuffled(DEMO_NOUNS, createSeededRandom(`${eventId}:nouns`));
  const indices = Array.from({ length: participantCount }, (_, index) => index);
  const memberCount = Math.round((participantCount * memberPercent) / 100);
  const preStartCount = Math.round((participantCount * preStartPercent) / 100);
  const memberIndices = new Set(shuffled(indices, random).slice(0, memberCount));
  const preStartIndices = new Set(shuffled(indices, random).slice(0, preStartCount));

  return indices.map((index) => ({
    claimId: buildDemoClaimId(eventId, index),
    claimKey: buildDemoClaimKey(index),
    displayName: buildDemoDisplayName(index, { adjectives, nouns }),
    index,
    isMember: memberIndices.has(index),
    queued: preStartIndices.has(index),
  }));
};

export const splitIntoBatches = (values, batchSize = DEMO_SEED_BATCH_SIZE) => {
  const size = Math.max(1, Math.trunc(batchSize));
  const batches = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
};

/**
 * Final call is the round's last chance, so more of the stragglers take it —
 * but not all of them, because a demo that always empties its backlog never
 * shows what the backlog controls are for.
 */
export const getDemoPickupChancePercent = ({ isFinalCall, pickupChancePercent }) => {
  const chance = clampToLimit(
    pickupChancePercent,
    DEMO_LIMITS.pickupChancePercent,
    initialDemoConfig.pickupChancePercent,
  );

  return isFinalCall ? Math.round(chance + (100 - chance) / 2) : chance;
};

export const shouldDemoParticipantPickUp = ({
  isFinalCall,
  pickupChancePercent,
  randomValue,
}) => randomValue * 100 < getDemoPickupChancePercent({ isFinalCall, pickupChancePercent });

/* ------------------------------------------------------------------------- *
 * Timing
 *
 * All of this used to be a uniform pick out of a narrow band — a new arrival
 * every 1.5 to 5 seconds, a pickup 1 to 7 seconds after being called. Uniform
 * is the one distribution human behaviour never has, and at a glance it showed:
 * arrivals came in on a metronome, and a called group cleared as a block
 * because every single delay landed inside the same six-second window.
 *
 * What people actually do has two properties worth reproducing. Arrivals are
 * independent, so the gaps between them are exponential — which means real
 * clustering (three people through the door at once, then nothing for half a
 * minute) rather than an even drip. And reaction times are heavy-tailed: most
 * of a group looks up and comes over quickly, and a few take much longer,
 * which is where a backlog comes from in the first place.
 * ------------------------------------------------------------------------- */

const clampMs = (value, minMs, maxMs) =>
  Math.max(minMs, Math.min(maxMs, Math.round(value)));

/**
 * A draw from an exponential distribution with the given mean.
 *
 * The distribution of the gap between independent events, which is what both
 * "when does the next person walk in" and "how long before this one reacts"
 * actually are. Most draws land below the mean and a few land far above it.
 *
 * `randomValue` is passed in rather than drawn here so the tests are
 * deterministic; the guard keeps u = 1 from returning Infinity.
 */
const sampleExponentialMs = (randomValue, meanMs) => {
  const uniform = Number.isFinite(randomValue)
    ? Math.min(0.999_999, Math.max(0, randomValue))
    : 0.5;

  return -Math.log(1 - uniform) * meanMs;
};

/* Arrivals. The window is how long the whole latecomer tail should take, and
   it scales with the size of the room so a 24-person demo does not trickle in
   as slowly as a 300-person one. */
const DEMO_ARRIVAL_PER_PERSON_MS = 2_000;
const DEMO_ARRIVAL_WINDOW_MIN_MS = 30_000;
const DEMO_ARRIVAL_WINDOW_MAX_MS = 4 * 60_000;
/* How much slower arrivals are at the end of the window than at the start.
   A room fills in a rush and then thins out; a flat rate does not read as a
   door at all. */
const DEMO_ARRIVAL_LATE_SLOWDOWN = 3;
const DEMO_JOIN_GAP_MIN_MS = 200;
const DEMO_JOIN_GAP_MAX_MS = 40_000;

/**
 * How long until the next fake attendee walks in.
 *
 * The mean gap is the remaining window divided by the people still to arrive,
 * stretched as the tail goes on, and the actual gap is an exponential draw
 * around it. Two people arriving in the same second and then a forty-second
 * lull are both ordinary results, which is the point.
 */
export const getDemoJoinDelayMs = (
  randomValue,
  { arrivedCount = 0, totalArrivals = 1 } = {},
) => {
  const total = Math.max(1, Math.trunc(totalArrivals));
  const windowMs = clampMs(
    total * DEMO_ARRIVAL_PER_PERSON_MS,
    DEMO_ARRIVAL_WINDOW_MIN_MS,
    DEMO_ARRIVAL_WINDOW_MAX_MS,
  );
  /* The slowdown below stretches the average gap by this much over the run, so
     the base gap is divided by it to keep the whole tail inside the window. */
  const stretch = 1 + (DEMO_ARRIVAL_LATE_SLOWDOWN - 1) / 2;
  const baseGapMs = windowMs / (total * stretch);
  const progress = Math.min(1, Math.max(0, arrivedCount / total));
  const meanGapMs = baseGapMs * (1 + progress * (DEMO_ARRIVAL_LATE_SLOWDOWN - 1));

  return clampMs(
    sampleExponentialMs(randomValue, meanGapMs),
    DEMO_JOIN_GAP_MIN_MS,
    DEMO_JOIN_GAP_MAX_MS,
  );
};

/* Pickups. The floor is the part nobody beats — noticing the number, standing
   up, crossing the room — and the exponential on top of it is the rest. */
const DEMO_PICKUP_REACTION_MS = 1_200;
const DEMO_PICKUP_MEAN_EXTRA_MS = 6_000;
const DEMO_PICKUP_MAX_MS = 45_000;

/**
 * How long after their group goes up before a fake attendee collects.
 *
 * Median lands around five seconds and the tail runs to the better part of a
 * minute, so a called group clears the way a real one does: most of it quickly,
 * a few stragglers holding the last of it open. That spread is what the group
 * timer and the backlog threshold exist to handle, and a uniform delay never
 * produced enough of it to exercise either.
 */
export const getDemoPickupDelayMs = (randomValue) =>
  clampMs(
    DEMO_PICKUP_REACTION_MS + sampleExponentialMs(randomValue, DEMO_PICKUP_MEAN_EXTRA_MS),
    DEMO_PICKUP_REACTION_MS,
    DEMO_PICKUP_MAX_MS,
  );

/* ------------------------------------------------------------------------- *
 * Raffle
 *
 * Two separate behaviours, and they are separate for the same reason they are
 * separate in the app: putting your name in is not collecting a prize.
 * ------------------------------------------------------------------------- */

/** Share who put themselves forward when staff ask people to opt in. */
export const DEMO_RAFFLE_OPT_IN_PERCENT = 70;
/** Share of winners who actually come to the prize table. */
const DEMO_RAFFLE_COLLECT_PERCENT = 85;

/* Opting in is something people do while looking at their phone anyway, so it
   is spread over a couple of minutes rather than being a scramble. */
const DEMO_RAFFLE_JOIN_MEAN_MS = 25_000;
const DEMO_RAFFLE_JOIN_MAX_MS = 150_000;
/* Collecting a prize means getting up and walking to a different table, which
   is slower than an item pickup and much more spread out. */
const DEMO_RAFFLE_COLLECT_FLOOR_MS = 4_000;
const DEMO_RAFFLE_COLLECT_MEAN_EXTRA_MS = 18_000;
const DEMO_RAFFLE_COLLECT_MAX_MS = 120_000;

export const shouldDemoParticipantJoinRaffle = (randomValue) =>
  Number.isFinite(randomValue) && randomValue * 100 < DEMO_RAFFLE_OPT_IN_PERCENT;

export const shouldDemoWinnerCollectPrize = (randomValue) =>
  Number.isFinite(randomValue) && randomValue * 100 < DEMO_RAFFLE_COLLECT_PERCENT;

export const getDemoRaffleJoinDelayMs = (randomValue) =>
  clampMs(sampleExponentialMs(randomValue, DEMO_RAFFLE_JOIN_MEAN_MS), 500, DEMO_RAFFLE_JOIN_MAX_MS);

export const getDemoRaffleCollectDelayMs = (randomValue) =>
  clampMs(
    DEMO_RAFFLE_COLLECT_FLOOR_MS
      + sampleExponentialMs(randomValue, DEMO_RAFFLE_COLLECT_MEAN_EXTRA_MS),
    DEMO_RAFFLE_COLLECT_FLOOR_MS,
    DEMO_RAFFLE_COLLECT_MAX_MS,
  );
