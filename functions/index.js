import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
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

  if (!response.ok) {
    throw new HttpsError("unauthenticated", errorMessage);
  }

  return response.json();
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