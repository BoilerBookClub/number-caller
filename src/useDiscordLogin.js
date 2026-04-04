import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const DISCORD_CLIENT_ID = "1329229896798441623";
const TARGET_GUILD_ID = "835995185817059439";
const REQUIRED_ROLE_ID = "937848500287336478";
const SPECIAL_ROLE_IDS = ["835995868007104543"];
const SESSION_EXPIRATION_TIME = 24 * 60 * 60 * 1000;
const DISCORD_REDIRECT_PATH = "/";
const POST_LOGIN_PATH_KEY = "discordPostLoginPath";

const buildDiscordRedirectUri = () =>
  new URL(DISCORD_REDIRECT_PATH, window.location.origin).toString();

const normalizeReturnPath = (value) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DISCORD_REDIRECT_PATH;
  }

  return value;
};

const readPostLoginPath = () => {
  const storedPath = window.sessionStorage.getItem(POST_LOGIN_PATH_KEY);

  if (!storedPath) {
    return null;
  }

  window.sessionStorage.removeItem(POST_LOGIN_PATH_KEY);
  return normalizeReturnPath(storedPath);
};

const clearStoredSession = () => {
  localStorage.removeItem("discordUser");
  localStorage.removeItem("discordUsername");
  localStorage.removeItem("accessToken");
  localStorage.removeItem("loginTime");
};

const readStoredSession = () => {
  const storedUser = localStorage.getItem("discordUser");
  const storedUsername = localStorage.getItem("discordUsername");
  const storedToken = localStorage.getItem("accessToken");
  const loginTime = Number(localStorage.getItem("loginTime"));
  const sessionExpired =
    !storedToken ||
    !loginTime ||
    Date.now() - loginTime > SESSION_EXPIRATION_TIME;

  return {
    accessToken: sessionExpired ? "" : storedToken,
    sessionExpired,
    user: sessionExpired ? "" : storedUser || "",
    username: sessionExpired ? "" : storedUsername || storedUser || "",
  };
};

const fetchDiscordUser = async (token) => {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Discord login failed.");
  }

  return response.json();
};

const persistDiscordUser = async (userData) => {
  if (!db) {
    return;
  }

  const avatarUrl = userData.avatar
    ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${Number(userData.discriminator ?? 0) % 5}.png`;

  try {
    const userDocRef = doc(db, "users", userData.id);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      await setDoc(userDocRef, {
        username: userData.username,
        avatarUrl,
        roles: [],
        firstLogin: true,
      });
      return;
    }

    await setDoc(
      userDocRef,
      {
        username: userData.username,
        avatarUrl,
      },
      { merge: true },
    );
  } catch (error) {
    console.warn("Unable to persist Discord user profile to Firestore.", error);
  }
};

export default function useDiscordLogin() {
  const initialSession = readStoredSession();
  const [user, setUser] = useState(initialSession.user);
  const [username, setUsername] = useState(initialSession.username);
  const [accessToken, setAccessToken] = useState(initialSession.accessToken);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [accessResolved, setAccessResolved] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const storedSession = readStoredSession();
    const { accessToken: storedAccessToken, sessionExpired } = storedSession;
    let isDisposed = false;

    const finishLoading = () => {
      if (!isDisposed) {
        setLoading(false);
      }
    };

    if (sessionExpired) {
      clearStoredSession();
    }

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("access_token");
    const returnPath =
      readPostLoginPath() ?? normalizeReturnPath(params.get("state"));
    const tokenToUse = token || storedAccessToken;

    if (!tokenToUse) {
      finishLoading();
      return undefined;
    }

    if (!token && storedSession.user) {
      setUser(storedSession.user);
      setUsername(storedSession.username);
      setAccessToken(tokenToUse);
      setAuthError("");
      finishLoading();
      return undefined;
    }

    if (token) {
      localStorage.setItem("accessToken", token);
      localStorage.setItem("loginTime", Date.now().toString());
      setAccessToken(token);
      window.history.replaceState(
        {},
        document.title,
        returnPath,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    }

    fetchDiscordUser(tokenToUse)
      .then(async (userData) => {
        if (isDisposed) {
          return;
        }

        setUser(userData.id);
        setUsername(userData.username || userData.id);
        setAccessToken(tokenToUse);
        localStorage.setItem("discordUser", userData.id);
        localStorage.setItem("discordUsername", userData.username || userData.id);
        localStorage.setItem("accessToken", tokenToUse);
        localStorage.setItem("loginTime", Date.now().toString());
        await persistDiscordUser(userData);
        setAuthError("");
      })
      .catch((error) => {
        if (isDisposed) {
          return;
        }

        clearStoredSession();
        setUser("");
        setUsername("");
        setAccessToken("");
        setAuthError(error.message || "Unable to log in with Discord.");
      })
      .finally(() => {
        finishLoading();
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    if (!user || !accessToken) {
      setIsMember(false);
      setHasFullAccess(false);
      setAccessResolved(false);
      return;
    }

    const checkUserRole = async () => {
      setRoleLoading(true);
      setAccessResolved(false);

      try {
        const response = await fetch(
          `https://discord.com/api/v10/users/@me/guilds/${TARGET_GUILD_ID}/member`,
          {
            headers: {
              authorization: `Bearer ${accessToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error("Unable to verify Discord membership.");
        }

        const data = await response.json();
        const nextIsMember = data.roles.includes(REQUIRED_ROLE_ID);
        const nextHasFullAccess = SPECIAL_ROLE_IDS.some((roleId) =>
          data.roles.includes(roleId),
        );

        console.info("Discord roles fetched", {
          user,
          roles: data.roles,
          requiredRoleId: REQUIRED_ROLE_ID,
          specialRoleIds: SPECIAL_ROLE_IDS,
          isMember: nextIsMember,
          hasFullAccess: nextHasFullAccess,
        });

        setIsMember(nextIsMember);
        setHasFullAccess(nextHasFullAccess);
        setAuthError("");

        if (db) {
          try {
            const userDocRef = doc(db, "users", user);
            await setDoc(
              userDocRef,
              {
                roles: data.roles,
                isMember: nextIsMember,
                hasFullAccess: nextHasFullAccess,
              },
              { merge: true },
            );
          } catch (error) {
            console.warn(
              "Unable to persist Discord role data to Firestore.",
              error,
            );
          }
        }
      } catch (error) {
        setIsMember(false);
        setHasFullAccess(false);
        setAuthError(error.message || "Unable to verify Discord access.");
      } finally {
        setRoleLoading(false);
        setAccessResolved(true);
      }
    };

    checkUserRole();
  }, [accessToken, user]);

  const startOAuthGrant = (returnPath) => {
    const redirectUri = encodeURIComponent(buildDiscordRedirectUri());
    const normalizedReturnPath = normalizeReturnPath(
      returnPath ?? `${window.location.pathname}${window.location.search}`,
    );

    window.sessionStorage.setItem(
      POST_LOGIN_PATH_KEY,
      normalizedReturnPath,
    );

    window.open(
      `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=token&scope=identify%20guilds%20guilds.members.read`,
      "_parent",
    );
  };

  const logout = () => {
    setUser("");
    setUsername("");
    setAccessToken("");
    setAccessResolved(false);
    setIsMember(false);
    setHasFullAccess(false);
    setAuthError("");
    clearStoredSession();
  };

  return {
    accessResolved,
    authError,
    hasFullAccess,
    isMember,
    loading,
    loggedIn: user !== "",
    logout,
    roleLoading,
    startOAuthGrant,
    user,
    username,
  };
}