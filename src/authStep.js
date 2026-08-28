/**
 * What the login effect should do on this run.
 *
 * Pulled out as a pure function because the effect it drives re-runs for
 * reasons it causes itself — signing in flips both firebaseAuthReady and
 * firebaseSignedIn — and getting the order of those conditions wrong is not a
 * visible mistake. It shipped once as a spinner that never stopped: the re-run
 * saw a URL whose code had already been consumed and a profile not yet written,
 * concluded nobody was signed in, and tore down the session that had just been
 * created. Every branch below is covered by tests/helpers.test.mjs.
 *
 * Order matters and is deliberate:
 *
 * 1. A finished login wins over everything, so a late re-run does no work.
 * 2. A code in the URL is the strongest signal there is — it is single-use and
 *    must be redeemed on the run that finds it.
 * 3. A dev login is the emulator's stand-in for that code.
 * 4. An exchange already in flight is re-attached to rather than restarted.
 *    This is the branch whose absence caused the hang.
 * 5. Only once none of those apply does Firebase's persisted session decide
 *    whether there is a session to refresh or nothing to sign in as.
 */
export const planAuthStep = ({
  devLogin,
  firebaseAuthReady,
  firebaseSignedIn,
  hasAuth,
  hasPendingExchange,
  redirectedCode,
  sessionSettled,
  storedUser,
}) => {
  if (!redirectedCode && sessionSettled) {
    return "settled";
  }

  if (redirectedCode) {
    return "exchange-code";
  }

  if (devLogin) {
    return "exchange-dev";
  }

  if (hasPendingExchange) {
    return "reattach";
  }

  // Firebase has not reported its persisted session yet. Deciding now would sign
  // out anyone who simply reloaded the page.
  if (hasAuth && !firebaseAuthReady) {
    return "wait-for-firebase";
  }

  if (storedUser && firebaseSignedIn) {
    return "refresh";
  }

  return "signed-out";
};
