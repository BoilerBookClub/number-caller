import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

const db = getFirestore();

const TARGET_GUILD_ID = "835995185817059439";
const REQUIRED_ROLE_ID = "937848500287336478";
const SPECIAL_ROLE_IDS = ["835995868007104543"];
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.BBC_DISCORD_BOT_TOKEN || "";
const DISPLAY_FEED_LIMIT = 5;
const LIVE_EVENT_PATH = "events/live-number-caller";
const DISPLAY_FEED_PATH = "events/live-number-caller/public/display-feed";

const buildDiscordAvatarUrl = (userData) =>
  userData.avatar
    ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${Number(userData.discriminator ?? 0) % 5}.png`;

const fetchDiscordJson = async ({ accessToken, path, errorMessage }) => {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const respText = await response.text().catch(() => "");

  if (!response.ok) {
    // Log Discord response for debugging (do not log the access token)
    console.error("Discord API error", {
      path,
      status: response.status,
      statusText: response.statusText,
      body: respText,
    });

    throw new HttpsError(
      "unauthenticated",
      `${errorMessage} (status ${response.status})`,
      {
        path,
        status: response.status,
      },
    );
  }

  try {
    return JSON.parse(respText);
  } catch (err) {
    console.error("Discord API returned non-JSON response", { path, body: respText, error: err && (err.message || err) });
    throw new HttpsError("unauthenticated", errorMessage);
  }
};

const getHttpStatusFromError = (error) => {
  const statusFromDetails = error?.details?.status;
  if (typeof statusFromDetails === "number") {
    return statusFromDetails;
  }

  const statusMatch = String(error?.message || "").match(/status\s+(\d{3})/i);
  if (statusMatch) {
    const parsedStatus = Number.parseInt(statusMatch[1], 10);
    if (Number.isFinite(parsedStatus)) {
      return parsedStatus;
    }
  }

  return null;
};

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const fetchDiscordJsonWithRetry = async ({
  accessToken,
  path,
  errorMessage,
  retries = 2,
}) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchDiscordJson({ accessToken, path, errorMessage });
    } catch (error) {
      const status = getHttpStatusFromError(error);
      const shouldRetry =
        attempt < retries && (status === 429 || (status >= 500 && status < 600));

      if (!shouldRetry) {
        throw error;
      }

      await sleep(250 * (attempt + 1));
    }
  }

  throw new HttpsError("unavailable", errorMessage);
};

const getTimestampMs = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value?.toMillis === "function") {
    const timestampMs = value.toMillis();
    return Number.isFinite(timestampMs) ? timestampMs : null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsedValue = Date.parse(value);
  return Number.isNaN(parsedValue) ? null : parsedValue;
};

const setDateToClockTime = (date, clockTime) => {
  if (!clockTime || typeof clockTime !== "string") {
    return null;
  }

  const [hoursText, minutesText] = clockTime.split(":");
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  const nextDate = new Date(date);
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
};

const isLiveEventStarted = (liveEvent, nowMs = Date.now()) => {
  if (!liveEvent?.active) {
    return false;
  }

  const referenceTimestamp = getTimestampMs(liveEvent.startedAt) ?? nowMs;
  const referenceDate = new Date(referenceTimestamp);
  let eventStartDate = setDateToClockTime(referenceDate, liveEvent.timeframeStart);
  let eventEndDate = setDateToClockTime(referenceDate, liveEvent.timeframeEnd);

  if (!eventStartDate) {
    return true;
  }

  if (eventEndDate && eventEndDate <= eventStartDate) {
    eventEndDate.setDate(eventEndDate.getDate() + 1);
  }

  if (eventEndDate && referenceTimestamp > eventEndDate.getTime()) {
    eventStartDate.setDate(eventStartDate.getDate() + 1);
    eventEndDate.setDate(eventEndDate.getDate() + 1);
  }

  return nowMs >= eventStartDate.getTime();
};

const normalizeMemberCheckInLeadMinutes = (value) => {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 15;
  }

  return parsedValue;
};

const getMemberEligibleAtForLiveEvent = (liveEvent, nowMs = Date.now()) => {
  if (!liveEvent) {
    return null;
  }

  const referenceTimestamp = getTimestampMs(liveEvent.startedAt) ?? nowMs;
  const referenceDate = new Date(referenceTimestamp);
  let eventStartDate = setDateToClockTime(referenceDate, liveEvent.timeframeStart);
  let eventEndDate = setDateToClockTime(referenceDate, liveEvent.timeframeEnd);

  if (!eventStartDate) {
    return null;
  }

  if (eventEndDate && eventEndDate <= eventStartDate) {
    eventEndDate.setDate(eventEndDate.getDate() + 1);
  }

  if (eventEndDate && referenceTimestamp > eventEndDate.getTime()) {
    eventStartDate.setDate(eventStartDate.getDate() + 1);
  }

  const memberLeadMinutes = normalizeMemberCheckInLeadMinutes(
    liveEvent.state?.memberCheckInLeadMinutes,
  );

  return eventStartDate.getTime() - memberLeadMinutes * 60 * 1000;
};

const fetchDiscordGuildMemberRolesByBot = async ({
  discordUserId,
  retries = 2,
}) => {
  if (!DISCORD_BOT_TOKEN || !discordUserId) {
    return null;
  }

  const path = `/guilds/${TARGET_GUILD_ID}/members/${discordUserId}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      headers: {
        authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    });
    const responseBody = await response.text().catch(() => "");

    if (response.status === 404) {
      return [];
    }

    if (response.ok) {
      try {
        const payload = JSON.parse(responseBody);
        return Array.isArray(payload.roles) ? payload.roles : [];
      } catch {
        return [];
      }
    }

    const shouldRetry =
      attempt < retries && (response.status === 429 || (response.status >= 500 && response.status < 600));

    if (shouldRetry) {
      await sleep(250 * (attempt + 1));
      continue;
    }

    console.warn("Bot guild membership lookup failed", {
      path,
      responseBody,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }

  return null;
};

const resolveMembershipStatusForDiscordUser = async ({
  currentIsMember,
  discordUserId,
}) => {
  if (!discordUserId) {
    return {
      isMember: Boolean(currentIsMember),
      source: "preclaim",
    };
  }

  const botRoles = await fetchDiscordGuildMemberRolesByBot({ discordUserId });
  if (Array.isArray(botRoles)) {
    return {
      isMember: botRoles.includes(REQUIRED_ROLE_ID),
      source: "bot",
    };
  }

  const authUserRecord = await getAuth().getUser(discordUserId).catch(() => null);
  if (authUserRecord) {
    return {
      isMember: authUserRecord.customClaims?.member === true,
      source: "custom-claims",
    };
  }

  return {
    isMember: Boolean(currentIsMember),
    source: "preclaim",
  };
};

const buildDisplayFeedItem = ({ action, avatarUrl, isMember, username }) => ({
  action,
  avatarUrl: avatarUrl || "",
  id: crypto.randomUUID(),
  isMember: isMember === true,
  timestampMs: Date.now(),
  username: username || "Unknown attendee",
});

const pushDisplayFeedItem = async (item) => {
  const displayFeedRef = db.doc(DISPLAY_FEED_PATH);

  await db.runTransaction(async (transaction) => {
    const displayFeedSnapshot = await transaction.get(displayFeedRef);
    const existingItems = displayFeedSnapshot.exists
      ? displayFeedSnapshot.data()?.items
      : [];
    const nextItems = [item, ...(Array.isArray(existingItems) ? existingItems : [])]
      .slice(0, DISPLAY_FEED_LIMIT);

    transaction.set(displayFeedRef, {
      items: nextItems,
      updatedAt: Date.now(),
    });
  });
};

const clearDisplayFeed = async () => {
  await db.doc(DISPLAY_FEED_PATH).set({
    items: [],
    updatedAt: Date.now(),
  });
};

const toPositiveInteger = (value) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const buildUsedClaimNumberSet = (claimsSnapshot) => {
  const usedNumbers = new Set();

  claimsSnapshot.forEach((claimDoc) => {
    const claimNumber = toPositiveInteger(claimDoc.data()?.number);
    if (claimNumber) {
      usedNumbers.add(claimNumber);
    }
  });

  return usedNumbers;
};

const getFirstAvailableClaimNumber = (usedNumbers, startAt = 1) => {
  let nextNumber = Math.max(1, toPositiveInteger(startAt) ?? 1);

  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return nextNumber;
};

const writeClaimFromPreclaim = ({
  tx,
  claimRef,
  eventId,
  number,
  preclaimData,
}) => {
  const joinedAtValue = preclaimData.createdAt ?? Date.now();

  tx.set(claimRef, {
    avatarUrl: preclaimData.avatarUrl || "",
    claimedAt: Date.now(),
    joinedAt: joinedAtValue,
    discordUserId: preclaimData.discordUserId ?? null,
    displayName: preclaimData.displayName || "",
    eventId: eventId || null,
    isMember: preclaimData.isMember ?? false,
    itemClaimedAtMsHistory: [],
    itemsClaimedCount: 0,
    number,
    participantType: preclaimData.participantType || "",
    qrToken: crypto.randomUUID(),
    redeemedRound: 0,
    updatedAt: Date.now(),
  });
};

export const exchangeDiscordAccessToken = onCall(async (request) => {
  const accessToken = request.data?.accessToken?.trim();

  if (!accessToken || typeof accessToken !== "string") {
    throw new HttpsError("invalid-argument", "A Discord access token is required.");
  }

  const userData = await fetchDiscordJson({
    accessToken,
    path: "/users/@me",
    errorMessage: "Discord login failed.",
  });

  // Attempt to fetch guild membership info.
  // - 404 means the user is not in the guild (treat as non-member/non-staff).
  // - Other failures are treated as transient verification failures.
  let isMember = false;
  let hasFullAccess = false;
  try {
    const guildMemberData = await fetchDiscordJsonWithRetry({
      accessToken,
      path: `/users/@me/guilds/${TARGET_GUILD_ID}/member`,
      errorMessage: "Unable to verify Discord membership.",
    });

    const roles = Array.isArray(guildMemberData.roles) ? guildMemberData.roles : [];
    isMember = roles.includes(REQUIRED_ROLE_ID);
    hasFullAccess = SPECIAL_ROLE_IDS.some((roleId) => roles.includes(roleId));
  } catch (err) {
    const status = getHttpStatusFromError(err);

    if (status === 404) {
      // User is not in the guild; keep default access flags as false.
      console.warn("Guild membership check returned 404; treating user as non-member.", {
        error: err && (err.message || err),
        userId: userData.id,
      });
    } else {
      // For transient/non-404 errors, avoid silently downgrading known staff.
      // If the caller already has a trusted Firebase session for this same uid,
      // reuse those claims for continuity.
      const callerUid = request.auth?.uid || null;
      const callerToken = request.auth?.token || {};
      const canReuseCallerClaims = callerUid === userData.id;
      const hadStaffAccess = canReuseCallerClaims && callerToken.staff === true;
      const hadMemberAccess = canReuseCallerClaims && callerToken.member === true;

      if (hadStaffAccess || hadMemberAccess) {
        isMember = hadMemberAccess;
        hasFullAccess = hadStaffAccess;
        console.warn("Guild membership check failed; reusing caller token claims.", {
          error: err && (err.message || err),
          reusedClaims: { member: isMember, staff: hasFullAccess },
          userId: userData.id,
        });
      } else {
        console.error("Guild membership check failed and no trusted caller claims were available.", {
          error: err && (err.message || err),
          userId: userData.id,
        });
        throw new HttpsError(
          "unavailable",
          "Unable to verify Discord membership right now. Please try logging in again.",
        );
      }
    }
  }
  const firebaseCustomToken = await getAuth().createCustomToken(userData.id, {
    member: isMember,
    staff: hasFullAccess,
  });

  return {
    firebaseCustomToken,
    profile: {
      avatarUrl: buildDiscordAvatarUrl(userData),
      hasFullAccess,
      isMember,
      user: userData.id,
      username: userData.username || userData.id,
    },
  };
});

export const assignPreclaimIfQueued = onCall(async (request) => {
  const eventId = request.data?.eventId;
  const claimKey = request.data?.claimKey;

  if (!eventId || typeof eventId !== "string" || !claimKey || typeof claimKey !== "string") {
    throw new HttpsError("invalid-argument", "eventId and claimKey are required.");
  }

  // Ensure caller is authenticated and matches the expected Discord user id
  const callerUid = request.auth?.uid || null;
  const expectedPrefix = "discord:";
  if (!claimKey.startsWith(expectedPrefix)) {
    throw new HttpsError("invalid-argument", "claimKey must be a discord claimKey.");
  }

  const discordUserId = claimKey.slice(expectedPrefix.length);

  if (!callerUid || callerUid !== discordUserId) {
    throw new HttpsError("permission-denied", "Not authorized to assign this preclaim.");
  }

  const preclaimId = `${eventId}__${encodeURIComponent(claimKey)}`;
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);

  const preSnap = await preclaimRef.get();

  if (!preSnap.exists) {
    return { assigned: false, reason: "no-preclaim" };
  }

  const pre = preSnap.data() || {};

  const now = Date.now();

  // If preclaim flagged as member but not yet eligible, don't assign
  if (pre.isMember && pre.memberEligibleAt && pre.memberEligibleAt > now) {
    return { assigned: false, reason: "member-not-eligible" };
  }

  // Perform transactional creation of claim and deletion of preclaim
  await db.runTransaction(async (tx) => {
    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const liveEventSnapshot = await tx.get(liveEventRef);
    const claimsSnapshot = await tx.get(db.collection(`${LIVE_EVENT_PATH}/claims`));
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    const currentNextClaimNumber = liveEvent.nextClaimNumber ?? 1;
    const usedNumbers = buildUsedClaimNumberSet(claimsSnapshot);
    const assignedNumber = getFirstAvailableClaimNumber(usedNumbers);

    // If live event doesn't match requested event, abort
    if (!liveEvent.eventId || liveEvent.eventId !== eventId) {
      throw new HttpsError("failed-precondition", "Event is not active or does not match.");
    }

    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${preclaimId}`);

    writeClaimFromPreclaim({
      tx,
      claimRef,
      eventId: liveEvent.eventId,
      number: assignedNumber,
      preclaimData: pre,
    });

    tx.delete(preclaimRef);

    const nextClaimNumber = Math.max(currentNextClaimNumber, assignedNumber + 1);

    tx.update(liveEventRef, {
      claimCount: (liveEvent.claimCount ?? 0) + 1,
      nextClaimNumber,
      updatedAt: Date.now(),
    });
  });

  return { assigned: true };
});

export const readPreclaimForUser = onCall(async (request) => {
  const eventId = request.data?.eventId;
  const claimKey = request.data?.claimKey;

  if (!eventId || typeof eventId !== "string" || !claimKey || typeof claimKey !== "string") {
    throw new HttpsError("invalid-argument", "eventId and claimKey are required.");
  }

  const callerUid = request.auth?.uid || null;
  const expectedPrefix = "discord:";
  if (!claimKey.startsWith(expectedPrefix)) {
    throw new HttpsError("invalid-argument", "claimKey must be a discord claimKey.");
  }

  const discordUserId = claimKey.slice(expectedPrefix.length);

  if (!callerUid || callerUid !== discordUserId) {
    throw new HttpsError("permission-denied", "Not authorized to read this preclaim.");
  }

  const preclaimId = `${eventId}__${encodeURIComponent(claimKey)}`;
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);

  const preSnap = await preclaimRef.get();

  if (!preSnap.exists) {
    return { exists: false };
  }

  return { exists: true, data: preSnap.data() };
});

export const listPreclaims = onCall(async (request) => {
  // Only staff may list all preclaims
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to list preclaims.');
  }

  const preclaimsCol = db.collection(`${LIVE_EVENT_PATH}/preclaims`);
  const snapshot = await preclaimsCol.orderBy('createdAt').get();

  const results = [];

  snapshot.forEach((docSnap) => {
    results.push({ id: docSnap.id, data: docSnap.data() });
  });

  return { preclaims: results };
});

export const assignPreclaimAsStaff = onCall(async (request) => {
  // Staff may assign any preclaim immediately
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to assign preclaims as staff.');
  }

  const preclaimId = request.data?.preclaimId;
  if (!preclaimId || typeof preclaimId !== 'string') {
    throw new HttpsError('invalid-argument', 'preclaimId is required.');
  }

  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);
  const preSnap = await preclaimRef.get();

  if (!preSnap.exists) {
    throw new HttpsError('not-found', 'Preclaim not found.');
  }

  const pre = preSnap.data() || {};

  await db.runTransaction(async (tx) => {
    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const liveEventSnapshot = await tx.get(liveEventRef);
    const claimsSnapshot = await tx.get(db.collection(`${LIVE_EVENT_PATH}/claims`));
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    const currentNextClaimNumber = liveEvent.nextClaimNumber ?? 1;
    const usedNumbers = buildUsedClaimNumberSet(claimsSnapshot);
    const assignedNumber = getFirstAvailableClaimNumber(usedNumbers);

    if (!liveEvent.eventId) {
      throw new HttpsError('failed-precondition', 'Event is not active.');
    }

    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${preclaimId}`);

    writeClaimFromPreclaim({
      tx,
      claimRef,
      eventId: liveEvent.eventId,
      number: assignedNumber,
      preclaimData: pre,
    });

    tx.delete(preclaimRef);

    const nextClaimNumber = Math.max(currentNextClaimNumber, assignedNumber + 1);

    tx.update(liveEventRef, {
      claimCount: (liveEvent.claimCount ?? 0) + 1,
      nextClaimNumber,
      updatedAt: Date.now(),
    });
  });

  return { assigned: true };
});

export const removePreclaimAsStaff = onCall(async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to remove preclaims.');
  }

  const preclaimId = request.data?.preclaimId;
  if (!preclaimId || typeof preclaimId !== 'string') {
    throw new HttpsError('invalid-argument', 'preclaimId is required.');
  }

  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);
  const preSnap = await preclaimRef.get();

  if (!preSnap.exists) {
    throw new HttpsError('not-found', 'Preclaim not found.');
  }

  await preclaimRef.delete();

  return { removed: true };
});

export const refreshPreclaimMembershipAsStaff = onCall(async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError("permission-denied", "Not authorized to refresh queue membership.");
  }

  const preclaimId = request.data?.preclaimId;
  if (!preclaimId || typeof preclaimId !== "string") {
    throw new HttpsError("invalid-argument", "preclaimId is required.");
  }

  const liveEventRef = db.doc(LIVE_EVENT_PATH);
  const preclaimRef = db.doc(`${LIVE_EVENT_PATH}/preclaims/${preclaimId}`);
  const [liveEventSnapshot, preclaimSnapshot] = await Promise.all([
    liveEventRef.get(),
    preclaimRef.get(),
  ]);

  if (!preclaimSnapshot.exists) {
    throw new HttpsError("not-found", "Preclaim not found.");
  }

  const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;
  const preclaimData = preclaimSnapshot.data() || {};
  const membership = await resolveMembershipStatusForDiscordUser({
    currentIsMember: preclaimData.isMember,
    discordUserId: preclaimData.discordUserId,
  });
  const memberEligibleAt = membership.isMember ? getMemberEligibleAtForLiveEvent(liveEvent) : null;

  await preclaimRef.set(
    {
      isMember: membership.isMember,
      memberEligibleAt,
      updatedAt: Date.now(),
    },
    { merge: true },
  );

  return {
    isMember: membership.isMember,
    preclaimId,
    refreshed: true,
    source: membership.source,
  };
});

export const refreshAllPreclaimMembershipsAsStaff = onCall(async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError("permission-denied", "Not authorized to refresh queue membership.");
  }

  const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
  const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;
  const activeEventId = liveEvent?.eventId;

  if (!activeEventId) {
    return {
      membersCount: 0,
      refreshedCount: 0,
      refreshedIds: [],
      sourceBreakdown: {},
      total: 0,
    };
  }

  const preclaimsSnapshot = await db
    .collection(`${LIVE_EVENT_PATH}/preclaims`)
    .where("eventId", "==", activeEventId)
    .get();

  if (preclaimsSnapshot.empty) {
    return {
      membersCount: 0,
      refreshedCount: 0,
      refreshedIds: [],
      sourceBreakdown: {},
      total: 0,
    };
  }

  const batch = db.batch();
  const refreshedIds = [];
  const sourceBreakdown = {};
  let membersCount = 0;

  for (const preclaimDoc of preclaimsSnapshot.docs) {
    const preclaimData = preclaimDoc.data() || {};
    const membership = await resolveMembershipStatusForDiscordUser({
      currentIsMember: preclaimData.isMember,
      discordUserId: preclaimData.discordUserId,
    });
    const memberEligibleAt = membership.isMember ? getMemberEligibleAtForLiveEvent(liveEvent) : null;

    batch.set(
      preclaimDoc.ref,
      {
        isMember: membership.isMember,
        memberEligibleAt,
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    refreshedIds.push(preclaimDoc.id);
    sourceBreakdown[membership.source] = (sourceBreakdown[membership.source] ?? 0) + 1;
    if (membership.isMember) {
      membersCount += 1;
    }
  }

  await batch.commit();

  return {
    membersCount,
    refreshedCount: refreshedIds.length,
    refreshedIds,
    sourceBreakdown,
    total: preclaimsSnapshot.size,
  };
});

export const removeClaim = onCall(async (request) => {
  if (!request.auth || request.auth.token.staff !== true) {
    throw new HttpsError('permission-denied', 'Not authorized to remove claims.');
  }

  const claimId = request.data?.claimId;
  if (!claimId || typeof claimId !== 'string') {
    throw new HttpsError('invalid-argument', 'claimId is required.');
  }

  const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
  const claimSnap = await claimRef.get();

  if (!claimSnap.exists) {
    throw new HttpsError('not-found', 'Claim not found.');
  }

  await claimRef.delete();

  return { removed: true };
});

export const syncDisplayFeedForClaimChanges = onDocumentWritten(
  `${LIVE_EVENT_PATH}/claims/{claimId}`,
  async (event) => {
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    if (!afterData) {
      return;
    }

    if (!beforeData) {
      const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

      if (!liveEvent?.active || !isLiveEventStarted(liveEvent)) {
        return;
      }

      if (afterData.eventId && liveEvent.eventId && afterData.eventId !== liveEvent.eventId) {
        return;
      }

      await pushDisplayFeedItem(buildDisplayFeedItem({
        action: `is #${afterData.number}`,
        avatarUrl: afterData.avatarUrl,
        isMember: afterData.isMember,
        username: afterData.displayName,
      }));
      return;
    }

    const beforeCount = beforeData.itemsClaimedCount ?? 0;
    const afterCount = afterData.itemsClaimedCount ?? 0;
    const beforeRound = beforeData.redeemedRound ?? 0;
    const afterRound = afterData.redeemedRound ?? 0;

    if (afterCount > beforeCount || afterRound > beforeRound) {
      await pushDisplayFeedItem(buildDisplayFeedItem({
        action: "claimed an item",
        avatarUrl: afterData.avatarUrl,
        isMember: afterData.isMember,
        username: afterData.displayName,
      }));
    }
  },
);

export const syncDisplayFeedForQueueJoins = onDocumentCreated(
  `${LIVE_EVENT_PATH}/preclaims/{preclaimId}`,
  async (event) => {
    const preclaimData = event.data?.data();

    if (!preclaimData) {
      return;
    }

    const liveEventSnapshot = await db.doc(LIVE_EVENT_PATH).get();
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : null;

    if (!liveEvent?.active) {
      return;
    }

    if (preclaimData.eventId && liveEvent.eventId && preclaimData.eventId !== liveEvent.eventId) {
      return;
    }

    await pushDisplayFeedItem(buildDisplayFeedItem({
      action: "queued",
      avatarUrl: preclaimData.avatarUrl,
      isMember: preclaimData.isMember,
      username: preclaimData.displayName,
    }));
  },
);

export const processMemberPreclaims = onSchedule("every 1 minutes", async () => {
  const now = Date.now();
  const preclaimsCol = db.collection(`${LIVE_EVENT_PATH}/preclaims`);

  const snapshot = await preclaimsCol
    .where("isMember", "==", true)
    .where("memberEligibleAt", "<=", now)
    .orderBy("memberEligibleAt")
    .limit(200)
    .get();

  if (snapshot.empty) {
    return;
  }

  await db.runTransaction(async (tx) => {
    const liveEventRef = db.doc(LIVE_EVENT_PATH);
    const liveEventSnapshot = await tx.get(liveEventRef);
    const claimsSnapshot = await tx.get(db.collection(`${LIVE_EVENT_PATH}/claims`));
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    const currentNextClaimNumber = liveEvent.nextClaimNumber ?? 1;
    const usedNumbers = buildUsedClaimNumberSet(claimsSnapshot);
    let highestAssignedNumber = 0;
    let assignedCount = 0;

    snapshot.forEach((preDoc) => {
      const data = preDoc.data() || {};

      // Only process preclaims for the current live event
      if (!data.eventId || data.eventId !== liveEvent.eventId) {
        return;
      }

      const claimId = preDoc.id;
      const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
      const assignedNumber = getFirstAvailableClaimNumber(usedNumbers);

      writeClaimFromPreclaim({
        tx,
        claimRef,
        eventId: liveEvent.eventId,
        number: assignedNumber,
        preclaimData: data,
      });

      tx.delete(preDoc.ref);

      usedNumbers.add(assignedNumber);
      highestAssignedNumber = Math.max(highestAssignedNumber, assignedNumber);
      assignedCount += 1;
    });

    if (assignedCount === 0) {
      return;
    }

    const nextClaimNumber = Math.max(currentNextClaimNumber, highestAssignedNumber + 1);

    tx.update(liveEventRef, {
      claimCount: (liveEvent.claimCount ?? 0) + assignedCount,
      nextClaimNumber,
      updatedAt: Date.now(),
    });
  });
});

export const processMemberPreclaimsOnEventUpdate = onDocumentUpdated(
  LIVE_EVENT_PATH,
  async (event) => {
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    if (!afterData) {
      return;
    }

    const now = Date.now();
    const preclaimsCol = db.collection(`${LIVE_EVENT_PATH}/preclaims`);

    const snapshot = await preclaimsCol
      .where("isMember", "==", true)
      .where("memberEligibleAt", "<=", now)
      .orderBy("memberEligibleAt")
      .limit(500)
      .get();

    if (snapshot.empty) {
      return;
    }

    await db.runTransaction(async (tx) => {
      const liveEventRef = db.doc(LIVE_EVENT_PATH);
      const liveEventSnapshot = await tx.get(liveEventRef);
      const claimsSnapshot = await tx.get(db.collection(`${LIVE_EVENT_PATH}/claims`));
      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
      const currentNextClaimNumber = liveEvent.nextClaimNumber ?? 1;
      const usedNumbers = buildUsedClaimNumberSet(claimsSnapshot);
      let highestAssignedNumber = 0;
      let assignedCount = 0;

      snapshot.forEach((preDoc) => {
        const data = preDoc.data() || {};

        if (!data.eventId || data.eventId !== liveEvent.eventId) {
          return;
        }

        const claimId = preDoc.id;
        const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
        const assignedNumber = getFirstAvailableClaimNumber(usedNumbers);

        writeClaimFromPreclaim({
          tx,
          claimRef,
          eventId: liveEvent.eventId,
          number: assignedNumber,
          preclaimData: data,
        });

        tx.delete(preDoc.ref);

        usedNumbers.add(assignedNumber);
        highestAssignedNumber = Math.max(highestAssignedNumber, assignedNumber);
        assignedCount += 1;
      });

      if (assignedCount === 0) {
        return;
      }

      const nextClaimNumber = Math.max(currentNextClaimNumber, highestAssignedNumber + 1);

      tx.update(liveEventRef, {
        claimCount: (liveEvent.claimCount ?? 0) + assignedCount,
        nextClaimNumber,
        updatedAt: Date.now(),
      });
    });
  },
);

export const resetDisplayFeedForLiveEventChanges = onDocumentUpdated(
  LIVE_EVENT_PATH,
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const didEventChange = beforeData?.eventId !== afterData?.eventId;
    const didCloseEvent = beforeData?.active && !afterData?.active;

    if (!didEventChange && !didCloseEvent) {
      return;
    }

    await clearDisplayFeed();
  },
);

export const processPreclaimsOnEventStart = onDocumentUpdated(
  LIVE_EVENT_PATH,
  async (event) => {
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    if (!afterData) {
      return;
    }

    // Only run when the event becomes active (false -> true)
    if (beforeData?.active || !afterData.active) {
      return;
    }

    const preclaimsCol = db.collection(`${LIVE_EVENT_PATH}/preclaims`);
    const snapshot = await preclaimsCol.orderBy("createdAt").get();

    if (snapshot.empty) {
      return;
    }

    await db.runTransaction(async (tx) => {
      const liveEventRef = db.doc(LIVE_EVENT_PATH);
      const liveEventSnapshot = await tx.get(liveEventRef);
      const claimsSnapshot = await tx.get(db.collection(`${LIVE_EVENT_PATH}/claims`));
      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
      const currentNextClaimNumber = liveEvent.nextClaimNumber ?? 1;
      const usedNumbers = buildUsedClaimNumberSet(claimsSnapshot);
      let highestAssignedNumber = 0;
      let assignedCount = 0;

      snapshot.forEach((preDoc) => {
        const data = preDoc.data() || {};
        const claimId = preDoc.id;
        const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);
        const assignedNumber = getFirstAvailableClaimNumber(usedNumbers);

        writeClaimFromPreclaim({
          tx,
          claimRef,
          eventId: liveEvent.eventId || afterData.eventId,
          number: assignedNumber,
          preclaimData: data,
        });

        tx.delete(preDoc.ref);

        usedNumbers.add(assignedNumber);
        highestAssignedNumber = Math.max(highestAssignedNumber, assignedNumber);
        assignedCount += 1;
      });

      if (assignedCount === 0) {
        return;
      }

      const nextClaimNumber = Math.max(currentNextClaimNumber, highestAssignedNumber + 1);

      tx.update(liveEventRef, {
        claimCount: (liveEvent.claimCount ?? 0) + assignedCount,
        nextClaimNumber,
        updatedAt: Date.now(),
      });
    });
  },
);
