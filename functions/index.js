import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
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

    throw new HttpsError("unauthenticated", `${errorMessage} (status ${response.status})`);
  }

  try {
    return JSON.parse(respText);
  } catch (e) {
    console.error("Discord API returned non-JSON response", { path, body: respText });
    throw new HttpsError("unauthenticated", errorMessage);
  }
};

const buildDisplayFeedItem = ({ action, avatarUrl, username }) => ({
  action,
  avatarUrl: avatarUrl || "",
  id: crypto.randomUUID(),
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

export const exchangeDiscordAccessToken = onCall(async (request) => {
  const accessToken = request.data?.accessToken?.trim();

  if (!accessToken || typeof accessToken !== "string") {
    throw new HttpsError("invalid-argument", "A Discord access token is required.");
  }

  const [userData, guildMemberData] = await Promise.all([
    fetchDiscordJson({
      accessToken,
      path: "/users/@me",
      errorMessage: "Discord login failed.",
    }),
    fetchDiscordJson({
      accessToken,
      path: `/users/@me/guilds/${TARGET_GUILD_ID}/member`,
      errorMessage: "Unable to verify Discord membership.",
    }),
  ]);

  const roles = Array.isArray(guildMemberData.roles) ? guildMemberData.roles : [];
  const isMember = roles.includes(REQUIRED_ROLE_ID);
  const hasFullAccess = SPECIAL_ROLE_IDS.some((roleId) => roles.includes(roleId));
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
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    let nextClaimNumber = liveEvent.nextClaimNumber ?? 1;

    // If live event doesn't match requested event, abort
    if (!liveEvent.eventId || liveEvent.eventId !== eventId) {
      throw new HttpsError("failed-precondition", "Event is not active or does not match.");
    }

    const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${preclaimId}`);

    tx.set(claimRef, {
      avatarUrl: pre.avatarUrl || "",
      claimedAt: Date.now(),
      discordUserId: pre.discordUserId ?? null,
      displayName: pre.displayName || "",
      eventId: liveEvent.eventId || null,
      isMember: pre.isMember ?? false,
      itemClaimedAtMsHistory: [],
      itemsClaimedCount: 0,
      number: nextClaimNumber,
      participantType: pre.participantType || "",
      qrToken: crypto.randomUUID(),
      redeemedRound: 0,
      updatedAt: Date.now(),
    });

    tx.delete(preclaimRef);

    nextClaimNumber += 1;

    tx.update(liveEventRef, {
      claimCount: nextClaimNumber - 1,
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

export const syncDisplayFeedForClaimChanges = onDocumentWritten(
  `${LIVE_EVENT_PATH}/claims/{claimId}`,
  async (event) => {
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    if (!afterData) {
      return;
    }

    if (!beforeData) {
      await pushDisplayFeedItem(buildDisplayFeedItem({
        action: "joined",
        avatarUrl: afterData.avatarUrl,
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
        username: afterData.displayName,
      }));
    }
  },
);

export const processMemberPreclaims = onSchedule("every 1 minutes", async (context) => {
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
    const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
    let nextClaimNumber = liveEvent.nextClaimNumber ?? 1;

    snapshot.forEach((preDoc) => {
      const data = preDoc.data() || {};

      // Only process preclaims for the current live event
      if (!data.eventId || data.eventId !== liveEvent.eventId) {
        return;
      }

      const claimId = preDoc.id;
      const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);

      tx.set(claimRef, {
        avatarUrl: data.avatarUrl || "",
        claimedAt: Date.now(),
        discordUserId: data.discordUserId ?? null,
        displayName: data.displayName || "",
        eventId: liveEvent.eventId || null,
        isMember: data.isMember ?? false,
        itemClaimedAtMsHistory: [],
        itemsClaimedCount: 0,
        number: nextClaimNumber,
        participantType: data.participantType || "",
        qrToken: crypto.randomUUID(),
        redeemedRound: 0,
        updatedAt: Date.now(),
      });

      tx.delete(preDoc.ref);

      nextClaimNumber += 1;
    });

    tx.update(liveEventRef, {
      claimCount: nextClaimNumber - 1,
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
      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
      let nextClaimNumber = liveEvent.nextClaimNumber ?? 1;

      snapshot.forEach((preDoc) => {
        const data = preDoc.data() || {};

        if (!data.eventId || data.eventId !== liveEvent.eventId) {
          return;
        }

        const claimId = preDoc.id;
        const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);

        tx.set(claimRef, {
          avatarUrl: data.avatarUrl || "",
          claimedAt: Date.now(),
          discordUserId: data.discordUserId ?? null,
          displayName: data.displayName || "",
          eventId: liveEvent.eventId || null,
          isMember: data.isMember ?? false,
          itemClaimedAtMsHistory: [],
          itemsClaimedCount: 0,
          number: nextClaimNumber,
          participantType: data.participantType || "",
          qrToken: crypto.randomUUID(),
          redeemedRound: 0,
          updatedAt: Date.now(),
        });

        tx.delete(preDoc.ref);

        nextClaimNumber += 1;
      });

      tx.update(liveEventRef, {
        claimCount: nextClaimNumber - 1,
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
      const liveEvent = liveEventSnapshot.exists ? liveEventSnapshot.data() : {};
      let nextClaimNumber = liveEvent.nextClaimNumber ?? 1;

      snapshot.forEach((preDoc) => {
        const data = preDoc.data() || {};
        const claimId = preDoc.id;
        const claimRef = db.doc(`${LIVE_EVENT_PATH}/claims/${claimId}`);

        tx.set(claimRef, {
          avatarUrl: data.avatarUrl || "",
          claimedAt: Date.now(),
          discordUserId: data.discordUserId ?? null,
          displayName: data.displayName || "",
          eventId: liveEvent.eventId || afterData.eventId || null,
          isMember: data.isMember ?? false,
          itemClaimedAtMsHistory: [],
          itemsClaimedCount: 0,
          number: nextClaimNumber,
          participantType: data.participantType || "",
          qrToken: crypto.randomUUID(),
          redeemedRound: 0,
          updatedAt: Date.now(),
        });

        tx.delete(preDoc.ref);

        nextClaimNumber += 1;
      });

      tx.update(liveEventRef, {
        claimCount: nextClaimNumber - 1,
        nextClaimNumber,
        updatedAt: Date.now(),
      });
    });
  },
);