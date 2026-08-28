import { onAuthStateChanged } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  auth,
  refreshTrustedSession,
  signInWithDiscordAuthCode,
  signOutTrustedAuth,
} from "./firebase";
import { planAuthStep } from "./authStep";
import { createCodeChallenge, createCodeVerifier } from "./pkce";

const DISCORD_CLIENT_ID =
  import.meta.env.VITE_DISCORD_CLIENT_ID || "1329229896798441623";
/**
 * How long a Discord login is trusted from localStorage before the page insists
 * on re-verifying.
 */
const SESSION_EXPIRATION_TIME = 24 * 60 * 60 * 1000;
const DISCORD_REDIRECT_PATH = "/";
const POST_LOGIN_PATH_KEY = "discordPostLoginPath";
const OAUTH_STATE_KEY = "discordOAuthState";
const OAUTH_VERIFIER_KEY = "discordOAuthVerifier";
// Set by hand in the emulator to sign in without Discord: "dev:staff",
// "dev:member" or "dev:guest". The server only honours it under the emulator.
const DEV_LOGIN_KEY = "devLogin";
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

const createOAuthState = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Confirms the redirect we are handling belongs to a login this tab started.
 *
 * Without it, anyone could hand a victim a link carrying their own Discord
 * credentials and silently sign the victim in as them — the victim then claims
 * a number, reads rules and shows a QR code that belongs to the attacker's
 * account. The nonce is single-use and scoped to this tab.
 */
const consumeOAuthState = (returnedState) => {
  const expectedState = window.sessionStorage.getItem(OAUTH_STATE_KEY);
  window.sessionStorage.removeItem(OAUTH_STATE_KEY);

  return Boolean(expectedState) && expectedState === returnedState;
};

const consumeCodeVerifier = () => {
  const verifier = window.sessionStorage.getItem(OAUTH_VERIFIER_KEY);
  window.sessionStorage.removeItem(OAUTH_VERIFIER_KEY);

  return verifier || "";
};

/**
 * Removes the Discord access token the implicit flow used to leave behind.
 *
 * Anyone who logged in before the authorization-code flow shipped still has a
 * real, possibly still-valid Discord token sitting in localStorage. Migrating
 * stops new ones being written but does nothing about those, so the token would
 * simply sit there — which is the exact exposure this change exists to remove.
 * Runs on load, for every visitor, once.
 */
const purgeLegacyAccessToken = () => {
  if (localStorage.getItem("accessToken") !== null) {
    localStorage.removeItem("accessToken");
  }
};

const clearStoredSession = () => {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("discordUser");
  localStorage.removeItem("discordUsername");
  localStorage.removeItem("discordAvatarUrl");
  localStorage.removeItem("discordIsMember");
  localStorage.removeItem("discordHasFullAccess");
  localStorage.removeItem("loginTime");
};

const writeStoredSession = (profile) => {
  localStorage.setItem("discordUser", profile.user || "");
  localStorage.setItem("discordUsername", profile.username || profile.user || "");
  localStorage.setItem("discordAvatarUrl", profile.avatarUrl || "");
  localStorage.setItem("discordIsMember", profile.isMember ? "true" : "false");
  localStorage.setItem("discordHasFullAccess", profile.hasFullAccess ? "true" : "false");
  localStorage.setItem("loginTime", Date.now().toString());
};

/**
 * The signed-in user as this browser last saw them.
 *
 * Only the display fields live here now. Access itself is carried by the
 * Firebase session and its custom claims, which the rules and the callables
 * both check — this used to also hold a live Discord access token, which is
 * exactly what the authorization-code flow removed.
 */
const readStoredSession = () => {
  purgeLegacyAccessToken();

  const storedUser = localStorage.getItem("discordUser");
  const storedUsername = localStorage.getItem("discordUsername");
  const storedAvatarUrl = localStorage.getItem("discordAvatarUrl");
  const storedIsMember = localStorage.getItem("discordIsMember");
  const storedHasFullAccess = localStorage.getItem("discordHasFullAccess");
  const loginTime = Number(localStorage.getItem("loginTime"));
  /*
   * Only ever a cache: a Discord session is re-verified against the guild on
   * load, so a stale copy costs nothing and 24 hours is a housekeeping bound.
   */
  const sessionExpired =
    !storedUser ||
    !loginTime ||
    Date.now() - loginTime > SESSION_EXPIRATION_TIME;

  return {
    avatarUrl: sessionExpired ? "" : storedAvatarUrl || "",
    hasFullAccess: sessionExpired ? false : storedHasFullAccess === "true",
    isMember: sessionExpired ? false : storedIsMember === "true",
    sessionExpired,
    user: sessionExpired ? "" : storedUser || "",
    username: sessionExpired ? "" : storedUsername || storedUser || "",
  };
};

export default function useDiscordLogin() {
  /*
   * Read once, on mount, rather than on every render.
   *
   * Only the first render's copy is ever used — every line below it is a
   * useState initializer — but as a bare call it ran on all of them, and the
   * page re-renders once a second off the clock. That is nine localStorage
   * reads and a purgeLegacyAccessToken sweep per second, for an answer that
   * was thrown away. The effect below reads its own fresh copy, which is the
   * one that has to be current.
   */
  const [initialSession] = useState(readStoredSession);
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
  const exchangeRef = useRef({ key: "", promise: null });
  // Signing in flips firebaseSignedIn, which re-runs the effect below. Without
  // this the fresh session would immediately be handed to a refresh call it does
  // not need, costing a Discord round trip on every login.
  const sessionSettledRef = useRef(false);
  // Whether exchangeRef holds an exchange that has not resolved yet. See the
  // comment at its only read, below: it is what keeps a login alive across the
  // effect re-run that signing in causes.
  const exchangeInFlightRef = useRef(false);

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
    let isDisposed = false;

    const finishLoading = () => {
      if (!isDisposed) {
        setLoading(false);
      }
    };

    if (storedSession.sessionExpired) {
      clearStoredSession();
    }

    // The code comes back in the query string, where the implicit grant used to
    // return a token in the fragment.
    const params = new URLSearchParams(window.location.search);
    const redirectedCode = params.get("code");
    /*
     * Only read where it is about to be used.
     *
     * readPostLoginPath removes the key as it reads, and this used to run
     * before planAuthStep had decided anything — so a run that turned out to be
     * "wait-for-firebase" still ate the stored path, and the run that actually
     * completed the login fell back to "/". Reachable whenever there is no code
     * in the URL, which is what a login cancelled at Discord looks like.
     */
    const readReturnPath = () => readPostLoginPath() ?? DISCORD_REDIRECT_PATH;
    const hasValidOAuthState = redirectedCode
      ? consumeOAuthState(params.get("state"))
      : false;

    if (redirectedCode && !hasValidOAuthState) {
      window.history.replaceState({}, document.title, DISCORD_REDIRECT_PATH);
      clearStoredSession();
      setAuthError("That login link did not come from this device. Please log in again.");
      setAccessResolved(false);
      finishLoading();
      return undefined;
    }

    const devLogin = window.localStorage.getItem(DEV_LOGIN_KEY) || "";
    const codeVerifier = redirectedCode ? consumeCodeVerifier() : "";

    if (redirectedCode && !codeVerifier) {
      window.history.replaceState({}, document.title, DISCORD_REDIRECT_PATH);
      clearStoredSession();
      setAuthError("That login could not be completed in this tab. Please log in again.");
      setAccessResolved(false);
      finishLoading();
      return undefined;
    }

    /*
     * An exchange started by an earlier run of this effect that has not resolved.
     *
     * Signing in flips firebaseAuthReady and firebaseSignedIn, so the exchange
     * itself re-runs this effect and disposes the run that started it. That
     * re-run cannot rediscover the login on its own: the code has already been
     * stripped from the URL, and the profile is only written once the exchange
     * resolves.
     *
     * The old implicit flow got this continuity for free — it wrote the access
     * token to localStorage before exchanging, so a re-run recomputed the same
     * key and re-attached to the same promise. An authorization code is
     * single-use and must not be persisted, so it is held here instead.
     */
    const pendingExchange = exchangeInFlightRef.current ? exchangeRef.current : null;

    const step = planAuthStep({
      devLogin,
      firebaseAuthReady,
      firebaseSignedIn,
      hasAuth: Boolean(auth),
      hasPendingExchange: Boolean(pendingExchange),
      redirectedCode,
      sessionSettled: sessionSettledRef.current,
      storedUser: storedSession.user,
    });

    // Already signed in on this page load; a later re-run has nothing to add.
    if (step === "settled") {
      finishLoading();
      return undefined;
    }

    if (step === "wait-for-firebase") {
      return undefined;
    }

    if (step === "signed-out") {
      // Firebase has reported in and has no session, so there is nothing left to
      // refresh from. The stored profile goes too: it is display data for a
      // session that no longer exists, and keeping it showed a signed-in name
      // above a signed-out app.
      clearStoredSession();
      setUser("");
      setUsername("");
      setAvatarUrl("");
      setAccessResolved(false);
      setIsMember(false);
      setHasFullAccess(false);
      void signOutTrustedAuth();
      finishLoading();
      return undefined;
    }

    if (step === "exchange-code") {
      window.history.replaceState({}, document.title, readReturnPath());
      // Deferred: this hook's effects are registered before App's, so a
      // synchronous dispatch fires before the popstate listener exists and the
      // route never leaves "/" — you land on the attendee page until a reload.
      window.setTimeout(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 0);
    }

    /*
     * One exchange per login, shared between effect runs.
     *
     * This effect re-runs when firebaseAuthReady flips, and again for every
     * StrictMode double-invoke. Simply remembering "already handled" was wrong:
     * the first run would start the request, get disposed before it resolved,
     * and drop the profile — while the second run skipped the call entirely and
     * never signed anyone in. Holding the promise means one round trip, with
     * whichever run is still mounted applying it. It matters more now: an
     * authorization code is single-use, so a second exchange would fail.
     */
    const exchangeKey = step === "exchange-code"
      ? `code:${redirectedCode}`
      : step === "exchange-dev"
        ? `dev:${devLogin}`
        : step === "reattach"
          ? pendingExchange.key
          : `refresh:${storedSession.user}`;

    if (exchangeRef.current.key !== exchangeKey) {
      exchangeInFlightRef.current = true;
      exchangeRef.current = {
        key: exchangeKey,
        promise: step === "exchange-code"
          ? signInWithDiscordAuthCode({
            code: redirectedCode,
            codeVerifier,
            redirectUri: buildDiscordRedirectUri(),
          })
          : step === "exchange-dev"
            ? signInWithDiscordAuthCode({
              code: devLogin,
              codeVerifier: "",
              redirectUri: buildDiscordRedirectUri(),
            })
            : refreshTrustedSession().then((access) => ({
              avatarUrl: storedSession.avatarUrl,
              hasFullAccess: access.hasFullAccess,
              isMember: access.isMember,
              user: storedSession.user,
              username: storedSession.username,
            })),
      };
    }

    setRoleLoading(true);
    setAccessResolved(false);

    exchangeRef.current.promise
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
        sessionSettledRef.current = true;
        writeStoredSession(profile);
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

        exchangeRef.current = { key: "", promise: null };
        clearStoredSession();
        setUser("");
        setUsername("");
        setAvatarUrl("");
        setAccessResolved(false);
        setIsMember(false);
        setHasFullAccess(false);
        setAuthError(error.message || "Unable to log in.");
        void signOutTrustedAuth();
      })
      .finally(() => {
        // Not guarded by isDisposed: the exchange really has settled, whichever
        // run of the effect is still mounted to hear about it.
        exchangeInFlightRef.current = false;

        if (!isDisposed) {
          setRoleLoading(false);
        }
        finishLoading();
      });

    return () => {
      isDisposed = true;
    };
  }, [firebaseAuthReady, firebaseSignedIn]);

  /* Memoised: App threads this into handleStaffLogin's useCallback, and the
     whole page re-renders once a second off the event clock — so a fresh
     identity here rewrote that callback, and the header's props with it, on
     every tick. */
  const startOAuthGrant = useCallback(async (returnPath) => {
    // Callers fire this from a click handler and ignore the promise, so it has
    // to report its own failures. crypto.subtle is the one that can genuinely be
    // missing: it is undefined outside a secure context, which is what serving
    // the app over plain http on a LAN address would do.
    try {
      const normalizedReturnPath = normalizeReturnPath(
        returnPath ?? `${window.location.pathname}${window.location.search}`,
      );
      const oauthState = createOAuthState();
      const codeVerifier = createCodeVerifier();
      const codeChallenge = await createCodeChallenge(codeVerifier);

      window.sessionStorage.setItem(POST_LOGIN_PATH_KEY, normalizedReturnPath);
      window.sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
      window.sessionStorage.setItem(OAUTH_VERIFIER_KEY, codeVerifier);

      const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
      authorizeUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", buildDiscordRedirectUri());
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "identify guilds guilds.members.read");
      authorizeUrl.searchParams.set("state", oauthState);
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");

      /*
       * Plain navigation, not window.open.
       *
       * This runs after `await createCodeChallenge(...)`, which breaks the
       * user-gesture chain — and a window.open outside a gesture is exactly
       * what a popup blocker exists to stop. Targeting "_parent" made it a
       * navigation in practice on most browsers, but "most" is not a good bet
       * when the population is three hundred phones and a large share of them
       * are iOS Safari. location.assign has no popup semantics to be blocked.
       */
      window.location.assign(authorizeUrl.toString());
    } catch {
      setAuthError("This browser cannot start a secure login here. Open the site over https.");
    }
  }, []);

  const dismissAuthError = useCallback(() => {
    setAuthError("");
  }, []);

  const logout = useCallback((reason = "") => {
    exchangeRef.current = { key: "", promise: null };
    exchangeInFlightRef.current = false;
    sessionSettledRef.current = false;
    setUser("");
    setUsername("");
    setAvatarUrl("");
    setAccessResolved(false);
    setIsMember(false);
    setHasFullAccess(false);
    setAuthError(typeof reason === "string" ? reason : "");
    clearStoredSession();
    void signOutTrustedAuth();
  }, []);

  return {
    accessResolved,
    authError,
    avatarUrl,
    dismissAuthError,
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
