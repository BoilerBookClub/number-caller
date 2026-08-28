import { useCallback, useEffect, useState } from "react";
import { readStoredBoolean } from "./claimSession";

/*
 * The one preference behind every screen this app is showing on a given device.
 *
 * Staff run an event with the control panel in one tab and the display on the
 * projector in another, and both go dark on the OS screensaver mid-round. The
 * Wake Lock API is per-document and the browser drops the lock the moment a tab
 * is hidden, so one tab cannot hold the screen on for the other — which is why
 * this is a stored preference rather than a lock owned by the control panel.
 * Both routes run the hook, both re-take the lock whenever they become the
 * visible tab, and the screen stays on across a switch between them because
 * whichever one the user is looking at is holding it.
 *
 * localStorage rather than component state so the choice reaches the tab that
 * is not currently rendering the toggle (via the `storage` event, which fires
 * in every *other* tab of the origin) and so a display opened later, or a tab
 * reloaded mid-event, comes back with it already on.
 */
const KEEP_SCREEN_AWAKE_STORAGE_KEY = "keepScreenAwake";

export const isKeepScreenAwakeSupported = () =>
  typeof navigator !== "undefined" && "wakeLock" in navigator;

export default function useKeepScreenAwake() {
  const [isEnabled, setIsEnabled] = useState(() =>
    readStoredBoolean(KEEP_SCREEN_AWAKE_STORAGE_KEY),
  );

  const setKeepScreenAwake = useCallback((nextIsEnabled) => {
    setIsEnabled(nextIsEnabled);
    window.localStorage.setItem(
      KEEP_SCREEN_AWAKE_STORAGE_KEY,
      nextIsEnabled ? "true" : "false",
    );
  }, []);

  const toggleKeepScreenAwake = useCallback(() => {
    setKeepScreenAwake(!readStoredBoolean(KEEP_SCREEN_AWAKE_STORAGE_KEY));
  }, [setKeepScreenAwake]);

  // The other tabs of this browser, following whichever one was toggled.
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== KEEP_SCREEN_AWAKE_STORAGE_KEY) {
        return;
      }

      setIsEnabled(event.newValue === "true");
    };

    window.addEventListener("storage", handleStorage);

    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!isEnabled || !isKeepScreenAwakeSupported()) {
      return undefined;
    }

    let sentinel = null;
    let isCancelled = false;

    const acquire = async () => {
      /* A hidden document is refused the lock outright, so a background tab
         does not ask — it waits for the visibilitychange below. */
      if (isCancelled || sentinel || document.visibilityState !== "visible") {
        return;
      }

      try {
        const nextSentinel = await navigator.wakeLock.request("screen");

        if (isCancelled) {
          void nextSentinel.release();
          return;
        }

        sentinel = nextSentinel;
        /* The browser releases the lock itself when the tab is hidden and does
           not tell us any other way; without this the sentinel stays non-null
           and the tab never asks for a fresh one on the way back. */
        nextSentinel.addEventListener("release", () => {
          if (sentinel === nextSentinel) {
            sentinel = null;
          }
        });
      } catch {
        /* Refused (hidden tab, battery saver, an embedding page's permissions
           policy) — the toggle stays on and the next visibilitychange tries
           again, because none of those are permanent. */
        sentinel = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (sentinel) {
        void sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [isEnabled]);

  return {
    isKeepScreenAwakeEnabled: isEnabled,
    setKeepScreenAwake,
    toggleKeepScreenAwake,
  };
}
