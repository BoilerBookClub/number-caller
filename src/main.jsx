import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LucideProvider } from 'lucide-react'
import './index.css'
import './roughCompat'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary'

/*
 * Clears the notification service worker this app used to register.
 *
 * `public/notification-sw.js` and the code that registered it are both gone,
 * but a worker already installed on a returning attendee's phone is not — and
 * it will not clear itself. Normally it would: the browser re-fetches the
 * worker script periodically, gets a 404, and drops the registration. Here it
 * gets a 200 instead, because firebase.json rewrites every unmatched path to
 * /index.html, so the update fails on the MIME type and the old registration
 * survives indefinitely.
 *
 * That worker never had a fetch handler, so there is no stale content to serve
 * — this is about not leaving a dead worker resident on every device that has
 * ever opened the app, and about not having one in the way if a real service
 * worker is ever added.
 */
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
    .catch(() => {
      // Nothing here is worth interrupting a check-in over.
    });
}

/*
 * Hands the event-title stylesheet to the screen once it has arrived.
 *
 * index.html requests it with media="print" so eight third-party font files are
 * not in front of an attendee's first paint on a venue network three hundred
 * phones are already saturating. Something has to flip it to "all" afterwards,
 * and that used to be an onload attribute on the tag itself — which is inline
 * script, and the Content-Security-Policy in firebase.json does not allow any.
 *
 * Deliberately not awaited and never retried: if it fails the titles simply keep
 * the fallback stack in .event-title, which is a different face rather than no
 * text at all. Nothing here is worth interrupting a check-in over.
 */
const applyDeferredFontStylesheets = () => {
  try {
    document.querySelectorAll('link[data-font-swap][media="print"]').forEach((link) => {
      link.media = "all";
    });
  } catch {
    // A missing tag or a browser that will not let us touch it is not an error.
  }
};

if (document.readyState === "complete") {
  applyDeferredFontStylesheets();
} else {
  window.addEventListener("load", applyDeferredFontStylesheets, { once: true });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <LucideProvider strokeWidth={1.25}>
        <App />
      </LucideProvider>
    </ErrorBoundary>
  </StrictMode>,
)
