import React from "react";
import AppHeader from "./components/AppHeader";
import { SketchButton, SketchCard } from "./components/SketchUI";
import { resetScrollLock } from "./useScrollLock";

const REPORT_URL = import.meta.env.VITE_ERROR_REPORT_URL;

/**
 * Last line of defence for the whole app.
 *
 * Rendered in the same sketch style as every other screen, because on the
 * projector this is what a room full of people would be looking at.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Uncaught error:", error, info);

    // A crash with a modal open leaves <body> fixed and offset, which can put
    // this screen and its buttons outside the viewport.
    try {
      resetScrollLock();
    } catch {
      // Never let recovery cleanup mask the original failure.
    }

    if (!REPORT_URL) {
      return;
    }

    try {
      const body = JSON.stringify({
        componentStack: info?.componentStack ?? "",
        message: error?.message ?? String(error),
        path: window.location.pathname,
        stack: error?.stack ?? "",
        timestampMs: Date.now(),
        userAgent: navigator.userAgent,
      });

      // keepalive so the report survives the reload that usually follows.
      void fetch(REPORT_URL, {
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
        method: "POST",
      }).catch(() => {});
    } catch {
      // Reporting must never mask the original failure.
    }
  }

  handleReload() {
    try {
      window.location.reload();
    } catch {
      // Some embedded webviews refuse reload(); navigating always works.
      window.location.assign(window.location.pathname + window.location.search);
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <>
        <AppHeader />
        <div className="entry-screen">
          <SketchCard className="entry-card hero-card sketch-entry-card app-error-card" elevation={2}>
            <p className="eyebrow">Something Went Wrong</p>
            <h1>This screen needs a refresh.</h1>
            <div className="staff-landing-actions">
              <SketchButton type="button" onClick={this.handleReload}>
                Reload
              </SketchButton>
            </div>
          </SketchCard>
        </div>
      </>
    );
  }
}

export default ErrorBoundary;
