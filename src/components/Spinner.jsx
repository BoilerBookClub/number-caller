import { useEffect, useRef } from "react";
import "wired-elements/lib/wired-spinner.js";
import bbcLogo from "../assets/bbc_logo.png";

export default function Spinner({ duration = 900, size = 72 }) {
  const spinnerRef = useRef(null);
  const numericSize = typeof size === "number" ? size : parseInt(size, 10) || 72;
  const normalizedDuration = Number.isFinite(Number(duration)) ? Number(duration) : 900;
  const px = `${numericSize}px`;
  const logoPct = 0.56;
  const wrapperStyle = {
    width: px,
    height: px,
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
    isolation: "isolate",
  };
  const spinnerStyle = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "100%",
    height: "100%",
    transform: "translate(-50%, -50%)",
    margin: 0,
    padding: 0,
    color: "rgba(0, 0, 0, 0.9)",
    display: "block",
  };
  const logoStyle = {
    width: `${logoPct * 100}%`,
    height: `${logoPct * 100}%`,
    position: "relative",
    zIndex: 1,
    objectFit: "contain",
    borderRadius: "50%",
    background: "transparent",
  };

  useEffect(() => {
    const spinnerElement = spinnerRef.current;
    if (!spinnerElement) {
      return undefined;
    }

    let frameId = null;
    let timeoutId = null;
    let resizeObserver = null;

    const applySpinnerState = () => {
      spinnerElement.spinning = true;
      spinnerElement.duration = normalizedDuration;

      if (typeof spinnerElement.requestUpdate === "function") {
        spinnerElement.requestUpdate();
      }

      if (typeof spinnerElement.wiredRender === "function") {
        spinnerElement.wiredRender(true);
      }
    };

    applySpinnerState();
    frameId = window.requestAnimationFrame(applySpinnerState);
    timeoutId = window.setTimeout(applySpinnerState, 0);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        applySpinnerState();
      });
      resizeObserver.observe(spinnerElement);
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [normalizedDuration, numericSize]);

  return (
    <div className="spinner-wrap" style={wrapperStyle}>
      <wired-spinner
        ref={spinnerRef}
        className="spinner-ring"
        spinning
        duration={normalizedDuration}
        aria-hidden
        style={spinnerStyle}
      />
      <img
        src={bbcLogo}
        alt="logo"
        className="spinner-logo"
        style={logoStyle}
      />
    </div>
  );
}
