import { useEffect, useState } from "react";

const MAX_MESSAGES = 200;

function formatMessage(level, args) {
  try {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    return `${new Date().toLocaleTimeString()} [${level}] ${text}`;
  } catch {
    return `${new Date().toLocaleTimeString()} [${level}] (unserializable)`;
  }
}

export default function OnScreenLogger() {
  const [visible, setVisible] = useState(false);
  const [messages, setMessages] = useState(() => []);

  useEffect(() => {
    if (!globalThis) return undefined;

    // Ensure a global message store exists
    if (!globalThis.__onscreen_logger_messages) {
      globalThis.__onscreen_logger_messages = [];
    }

    // Wrap console methods once
    if (!globalThis.__onscreen_logger_installed) {
      const levels = ["log", "info", "warn", "error", "debug"];
      levels.forEach((level) => {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
          try {
            const msg = formatMessage(level, args);
            globalThis.__onscreen_logger_messages.push(msg);
            if (globalThis.__onscreen_logger_messages.length > MAX_MESSAGES) {
              globalThis.__onscreen_logger_messages.shift();
            }
            window.dispatchEvent(new CustomEvent("onscreen-log", { detail: msg }));
          } catch {
            // ignore
          }
          orig(...args);
        };
      });
      globalThis.__onscreen_logger_installed = true;
    }

    const handle = () => {
      // New message appended
      const list = globalThis.__onscreen_logger_messages || [];
      setMessages(list.slice(-100).reverse());
    };

    window.addEventListener("onscreen-log", handle);

    // Initialize with existing messages
    setMessages((globalThis.__onscreen_logger_messages || []).slice(-100).reverse());

    return () => {
      window.removeEventListener("onscreen-log", handle);
    };
  }, []);

  if (!visible) {
    return (
      <div style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999 }}>
        <button
          onClick={() => setVisible(true)}
          style={{ padding: "8px 10px", fontSize: "14px" }}
        >
          Show Logs
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        width: "94%",
        maxWidth: 720,
        height: "45%",
        background: "rgba(0,0,0,0.85)",
        color: "#e6e6e6",
        padding: 8,
        fontSize: 12,
        overflowY: "auto",
        zIndex: 9999,
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>Console (most recent first)</strong>
        <div>
          <button onClick={() => setMessages([])} style={{ marginRight: 8 }}>Clear</button>
          <button onClick={() => setVisible(false)}>Hide</button>
        </div>
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.25em" }}>
        {messages.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No console messages yet.</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.03)", marginBottom: 6 }}>
              {m}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
