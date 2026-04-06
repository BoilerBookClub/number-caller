import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import {
  auth,
  signInWithDiscordAccessToken,
  signOutTrustedAuth,
} from "./firebase";

const DISCORD_CLIENT_ID = "1329229896798441623";
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
  localStorage.removeItem("discordAvatarUrl");
  localStorage.removeItem("discordIsMember");
  localStorage.removeItem("discordHasFullAccess");
  localStorage.removeItem("accessToken");
  localStorage.removeItem("loginTime");
};

const readStoredSession = () => {
  const storedUser = localStorage.getItem("discordUser");
  const storedUsername = localStorage.getItem("discordUsername");
  const storedAvatarUrl = localStorage.getItem("discordAvatarUrl");
  const storedIsMember = localStorage.getItem("discordIsMember");
  const storedHasFullAccess = localStorage.getItem("discordHasFullAccess");
  const storedToken = localStorage.getItem("accessToken");
  const loginTime = Number(localStorage.getItem("loginTime"));
  const sessionExpired =
    !storedToken ||
    !loginTime ||
    Date.now() - loginTime > SESSION_EXPIRATION_TIME;

  return {
    accessToken: sessionExpired ? "" : storedToken,
    avatarUrl: sessionExpired ? "" : storedAvatarUrl || "",
    hasFullAccess: sessionExpired ? false : storedHasFullAccess === "true",
    isMember: sessionExpired ? false : storedIsMember === "true",
    sessionExpired,
    user: sessionExpired ? "" : storedUser || "",
    username: sessionExpired ? "" : storedUsername || storedUser || "",
  };
};

export default function useDiscordLogin() {
  const initialSession = readStoredSession();
  const [user, setUser] = useState(initialSession.user);
  const [username, setUsername] = useState(initialSession.username);
  const [avatarUrl, setAvatarUrl] = useState(initialSession.avatarUrl);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(!auth);
  const [firebaseSignedIn, setFirebaseSignedIn] = useState(Boolean(auth?.currentUser));
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [accessResolved, setAccessResolved] = useState(false);
  const [isMember, setIsMember] = useState(initialSession.isMember);
  const [hasFullAccess, setHasFullAccess] = useState(initialSession.hasFullAccess);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!auth) {
      setFirebaseAuthReady(true);
      setFirebaseSignedIn(false);
      return undefined;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setFirebaseSignedIn(Boolean(nextUser));
      setFirebaseAuthReady(true);
    });
  }, []);

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
    const shouldWaitForFirebaseAuth =
      !token && Boolean(storedAccessToken) && Boolean(auth) && !firebaseAuthReady;

    if (shouldWaitForFirebaseAuth) {
      return undefined;
    }

    if (!tokenToUse) {
      setAccessResolved(false);
      setIsMember(false);
      setHasFullAccess(false);
      void signOutTrustedAuth();
      finishLoading();
      return undefined;
    }

    if (token) {
      localStorage.setItem("accessToken", token);
      localStorage.setItem("loginTime", Date.now().toString());
      window.history.replaceState(
        {},
        document.title,
        returnPath,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    }

    setRoleLoading(true);
    setAccessResolved(false);

    signInWithDiscordAccessToken({ accessToken: tokenToUse })
      .then((profile) => {
        if (isDisposed) {
          return;
        }

        setUser(profile.user || "");
        setUsername(profile.username || profile.user || "");
        setAvatarUrl(profile.avatarUrl || "");
        setIsMember(Boolean(profile.isMember));
        setHasFullAccess(Boolean(profile.hasFullAccess));
        setAccessResolved(true);
        localStorage.setItem("discordUser", profile.user || "");
        localStorage.setItem("discordUsername", profile.username || profile.user || "");
        localStorage.setItem("discordAvatarUrl", profile.avatarUrl || "");
        localStorage.setItem("discordIsMember", profile.isMember ? "true" : "false");
        localStorage.setItem("discordHasFullAccess", profile.hasFullAccess ? "true" : "false");
        localStorage.setItem("accessToken", tokenToUse);
        localStorage.setItem("loginTime", Date.now().toString());
        setAuthError("");
      })
      .catch((error) => {
        if (isDisposed) {
          return;
        }

        const isMembershipCheckUnavailable =
          error?.code === "functions/unavailable" ||
          String(error?.message || "").includes("Unable to verify Discord membership right now");

        if (isMembershipCheckUnavailable && storedSession.user) {
          setUser(storedSession.user || "");
          setUsername(storedSession.username || storedSession.user || "");
          setAvatarUrl(storedSession.avatarUrl || "");
          setIsMember(Boolean(storedSession.isMember));
          setHasFullAccess(Boolean(storedSession.hasFullAccess));
          setAccessResolved(true);
          setAuthError(error.message || "Unable to verify Discord membership right now. Please try logging in again.");
          return;
        }

        clearStoredSession();
        setUser("");
        setUsername("");
        setAvatarUrl("");
        setAccessResolved(false);
        setIsMember(false);
        setHasFullAccess(false);
        setAuthError(error.message || "Unable to log in with Discord.");
        void signOutTrustedAuth();
      })
      .finally(() => {
        if (!isDisposed) {
          setRoleLoading(false);
        }
        finishLoading();
      });

    return () => {
      isDisposed = true;
    };
  }, [firebaseAuthReady]);

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
    setAvatarUrl("");
    setAccessResolved(false);
    setIsMember(false);
    setHasFullAccess(false);
    setAuthError("");
    clearStoredSession();
    void signOutTrustedAuth();
  };

  return {
    accessResolved,
    authError,
    avatarUrl,
    firebaseAuthReady,
    firebaseSignedIn,
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
