import { useEffect, useState } from "react";
import autoIcon from "../assets/skip.svg";
import displayIcon from "../assets/display.svg";
import editIcon from "../assets/edit.svg";
import expandIcon from "../assets/expand.svg";
import graphIcon from "../assets/graph.svg";
import groupIcon from "../assets/group.svg";
import scanIcon from "../assets/scan.svg";
import settingsIcon from "../assets/settings.svg";
import { getEventTitleClassName, TITLE_FONT_OPTIONS } from "../titleFonts";

const AUTO_SETTINGS_ANIMATION_MS = 180;
const GRAPH_PANEL_ANIMATION_MS = 180;
const GRAPH_CHART_WIDTH = 760;
const GRAPH_CHART_HEIGHT = 250;
const GRAPH_CHART_PADDING = { top: 18, right: 18, bottom: 34, left: 44 };

function formatGraphTimeLabel(timestampMs) {
  if (!Number.isFinite(timestampMs)) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
}

function formatGraphWindowLabel(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Instant";
  }

  const totalMinutes = Math.round(durationMs / 60000);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!minutes) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function buildYAxisTicks(maxCount, chartHeight) {
  if (!Number.isFinite(maxCount) || maxCount <= 0) {
    return [
      {
        label: 0,
        y: GRAPH_CHART_PADDING.top + chartHeight,
      },
    ];
  }

  const tickValues =
    maxCount <= 4
      ? Array.from({ length: maxCount + 1 }, (_, index) => index)
      : (() => {
          const step = Math.ceil(maxCount / 4);
          const values = [];

          for (let tickValue = 0; tickValue < maxCount; tickValue += step) {
            values.push(tickValue);
          }

          values.push(maxCount);

          return Array.from(new Set(values)).sort((leftValue, rightValue) => leftValue - rightValue);
        })();

  return tickValues
    .map((tickValue) => ({
      label: tickValue,
      y: GRAPH_CHART_PADDING.top + chartHeight - (tickValue / maxCount) * chartHeight,
    }))
    .sort((leftTick, rightTick) => leftTick.y - rightTick.y);
}

function buildTimelineGraph(timestamps) {
  const sortedTimestamps = timestamps
    .filter((timestampMs) => Number.isFinite(timestampMs))
    .sort((leftTimestamp, rightTimestamp) => leftTimestamp - rightTimestamp);
  const firstTimestampMs = sortedTimestamps[0] ?? null;
  const lastTimestampMs = sortedTimestamps[sortedTimestamps.length - 1] ?? null;
  const chartWidth = GRAPH_CHART_WIDTH - GRAPH_CHART_PADDING.left - GRAPH_CHART_PADDING.right;
  const chartHeight = GRAPH_CHART_HEIGHT - GRAPH_CHART_PADDING.top - GRAPH_CHART_PADDING.bottom;
  const durationMs =
    Number.isFinite(firstTimestampMs) && Number.isFinite(lastTimestampMs)
      ? lastTimestampMs - firstTimestampMs
      : 0;
  const graphPoints = sortedTimestamps.length
    ? [
        { count: 0, timeMs: firstTimestampMs },
        ...sortedTimestamps.map((timeMs, index) => ({ count: index + 1, timeMs })),
      ]
    : [];
  const pointCoordinates = graphPoints.map((point, index) => {
    const xRatio =
      durationMs > 0
        ? (point.timeMs - firstTimestampMs) / durationMs
        : graphPoints.length > 1
          ? index / (graphPoints.length - 1)
          : 0;
      const yRatio = sortedTimestamps.length > 0 ? point.count / sortedTimestamps.length : 0;

    return {
      count: point.count,
      timeMs: point.timeMs,
      x: GRAPH_CHART_PADDING.left + xRatio * chartWidth,
      y: GRAPH_CHART_PADDING.top + chartHeight - yRatio * chartHeight,
    };
  });
  const linePath = pointCoordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = pointCoordinates.length
    ? `${linePath} L ${pointCoordinates[pointCoordinates.length - 1].x.toFixed(2)} ${(GRAPH_CHART_PADDING.top + chartHeight).toFixed(2)} L ${GRAPH_CHART_PADDING.left} ${(GRAPH_CHART_PADDING.top + chartHeight).toFixed(2)} Z`
    : "";
  const yAxisTicks = buildYAxisTicks(sortedTimestamps.length, chartHeight);
  const xAxisTicks = !sortedTimestamps.length
    ? []
    : durationMs > 0
      ? [
          { label: formatGraphTimeLabel(firstTimestampMs), x: GRAPH_CHART_PADDING.left },
          {
            label: formatGraphTimeLabel(firstTimestampMs + durationMs / 2),
            x: GRAPH_CHART_PADDING.left + chartWidth / 2,
          },
          {
            label: formatGraphTimeLabel(lastTimestampMs),
            x: GRAPH_CHART_PADDING.left + chartWidth,
          },
        ]
      : [{ label: formatGraphTimeLabel(firstTimestampMs), x: GRAPH_CHART_PADDING.left + chartWidth / 2 }];

  return {
    areaPath,
    durationMs,
    firstTimestampMs,
    lastTimestampMs,
    linePath,
    pointCoordinates,
    sortedTimestamps,
    xAxisTicks,
    yAxisTicks,
  };
}

function EventDetailsModal({
  controlForm,
  controlMessage,
  controlSaving,
  isEventLive,
  onClose,
  onFieldChange,
  onSubmit,
}) {
  return (
    <div className="event-modal-backdrop" role="presentation">
      <div className="event-modal" role="dialog" aria-modal="true" aria-label="Event details">
        {isEventLive ? (
          <div className="event-modal-header">
            <button
              type="button"
              className="event-modal-close"
              onClick={onClose}
              aria-label="Close event details"
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="event-modal-content">
          <h2>{isEventLive ? "Edit Event Details" : "Create Event"}</h2>
          <form className="control-form event-modal-form" onSubmit={onSubmit}>
            <div className="title-grid">
              <label className="control-input-group control-input-group--centered">
                <span>Event Title</span>
                <input
                  type="text"
                  value={controlForm.title}
                  onChange={onFieldChange("title")}
                  placeholder="Event Name Here..."
                  autoComplete="off"
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--compact title-font-select">
                <span>Event Title Font</span>
                <select value={controlForm.titleFont} onChange={onFieldChange("titleFont")}>
                  {TITLE_FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="control-input-group control-input-group--centered">
              <span>Book List URL</span>
              <input
                type="url"
                value={controlForm.qrUrl}
                onChange={onFieldChange("qrUrl")}
                placeholder="Enter QR code destination"
              />
            </label>
            <div className="time-grid time-grid--centered">
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>Start Time</span>
                <input
                  type="time"
                  value={controlForm.timeframeStart}
                  onChange={onFieldChange("timeframeStart")}
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>End Time</span>
                <input
                  type="time"
                  value={controlForm.timeframeEnd}
                  onChange={onFieldChange("timeframeEnd")}
                />
              </label>
            </div>
            <label className="control-input-group control-input-group--centered control-input-group--compact">
              <span>Member Early Check-In</span>
              <input
                type="number"
                min="0"
                step="1"
                value={controlForm.memberCheckInLeadMinutes}
                onChange={onFieldChange("memberCheckInLeadMinutes")}
                placeholder="15"
              />
              <small className="control-input-hint">
                Minutes before the event start that members can claim a number.
              </small>
            </label>
            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}
            <div className="control-actions">
              <button type="submit" disabled={controlSaving}>
                {controlSaving
                  ? "Saving..."
                  : isEventLive
                    ? "Save Event Details"
                    : "Start Event"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ClaimList({ claims, currentRound, emptyText, isLastGroup, isFinalCall }) {
  if (!claims.length) {
    return <p>{emptyText}</p>;
  }

  const claimedCount = claims.filter((claim) => claim.redeemedRound === currentRound).length;
  const isGroupFullyClaimed = claimedCount === claims.length;
  const claimedProgress = claims.length > 0 ? claimedCount / claims.length : 0;
  const queueSummaryItems = [
    {
      label: "Up For",
      value: isFinalCall ? "Final Call" : null,
    },
    {
      label: "Claimed",
      value: `${claimedCount}/${claims.length}`,
    },
  ];

  return (
    <>
      <div className="queue-summary" aria-label="Current queue status">
        {queueSummaryItems.map((item) =>
          item.value ? (
            <div
              key={item.label}
              className={`queue-summary-card${item.label === "Claimed" && isGroupFullyClaimed ? " queue-summary-card--complete" : ""}`}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.label === "Claimed" ? (
                <div className="queue-summary-progress" aria-hidden="true">
                  <div
                    className="queue-summary-progress-fill"
                    style={{ width: `${Math.max(0, Math.min(1, claimedProgress)) * 100}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null,
        )}
        {!isFinalCall && isLastGroup ? (
          <div className="queue-summary-card queue-summary-card--alert">
            <span>Queue Status</span>
            <strong>Last group ready for Final Call</strong>
          </div>
        ) : null}
      </div>
      <div className="roster-list" role="list">
        {claims.map((claim) => {
          const hasClaimedCurrentGroup = claim.redeemedRound === currentRound;
          const avatarLabel = claim.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";

          return (
            <div key={claim.claimId} className="roster-row" role="listitem">
              <div className="roster-primary">
                <strong>#{claim.number}</strong>
                                <div className="roster-avatar" aria-hidden="true">
                  {claim.avatarUrl ? (
                    <img src={claim.avatarUrl} alt="" className="roster-avatar-image" />
                  ) : (
                    <span className="roster-avatar-fallback">{avatarLabel}</span>
                  )}
                </div>
                <span>{claim.displayName}</span>
              </div>
              <div className="roster-meta">
                <span
                  className={`roster-badge ${hasClaimedCurrentGroup ? "roster-badge--claimed" : "roster-badge--waiting"}`}
                >
                  {hasClaimedCurrentGroup ? "Claimed" : "Waiting"}
                </span>
                <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                <span
                  className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                >
                  {claim.isMember ? "Member" : "Not Member"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function BacklogList({ claims }) {
  return (
    <div className="queue-backlog-panel">
      <div className="queue-summary queue-summary--single" aria-label="Backlog status">
        <div className="queue-summary-card queue-summary-card--alert">
          <span>Backlog</span>
          <strong>{claims.length} waiting</strong>
        </div>
      </div>
      {!claims.length ? <p>No backlog for this round.</p> : null}
      <div className="roster-list" role="list">
        {claims.map((claim) => {
          const avatarLabel = claim.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";

          return (
            <div key={claim.claimId} className="roster-row" role="listitem">
              <div className="roster-primary">
                <strong>#{claim.number}</strong>
                <div className="roster-avatar" aria-hidden="true">
                  {claim.avatarUrl ? (
                    <img src={claim.avatarUrl} alt="" className="roster-avatar-image" />
                  ) : (
                    <span className="roster-avatar-fallback">{avatarLabel}</span>
                  )}
                </div>
                <span>{claim.displayName}</span>
              </div>
              <div className="roster-meta">
                <span className="roster-badge roster-badge--waiting">Waiting</span>
                <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                <span
                  className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                >
                  {claim.isMember ? "Member" : "Not Member"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GraphModalOverlay({ children, onClose, title }) {
  useEffect(() => {
    const { body, documentElement } = document;
    const lockedScrollY = window.scrollY;

    documentElement.classList.add("modal-scroll-locked");
    body.classList.add("modal-scroll-locked");
    body.style.top = `-${lockedScrollY}px`;

    return () => {
      documentElement.classList.remove("modal-scroll-locked");
      body.classList.remove("modal-scroll-locked");
      body.style.top = "";
      window.scrollTo(0, lockedScrollY);
    };
  }, []);

  return (
    <div className="graph-expand-backdrop" role="presentation" onClick={onClose}>
      <div
        className="graph-expand-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} expanded view`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="graph-expand-modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="timeline-chart-close timeline-chart-close--modal"
            onClick={onClose}
            aria-label={`Close expanded ${title.toLowerCase()}`}
            title={`Close expanded ${title.toLowerCase()}`}
          >
            <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
          </button>
        </div>
        <div className="graph-expand-modal-body">{children}</div>
      </div>
    </div>
  );
}

// Preclaim queue is now embedded inside FullRoster; no modal component needed.

function TimelineChart({
  emptyText,
  isExpanded = false,
  note,
  onClose,
  onExpand,
  showCloseButton,
  title,
  tone,
  totalLabel,
  timestamps,
}) {
  const chartLabel = `${title} chart`;
  const timeline = buildTimelineGraph(timestamps);
  const gradientId = `timelineGraphFill-${tone}`;
  const lineClassName = `graph-line graph-line--${tone}`;
  const pointClassName = `graph-point graph-point--${tone}`;
  const gradientStops =
    tone === "items"
      ? {
          end: "#f29e38",
          start: "#f6bf66",
        }
      : {
          end: "#2d8f51",
          start: "#63c283",
        };

  return (
    <section
      className={`timeline-chart-card${isExpanded ? " timeline-chart-card--expanded" : ""}`}
      aria-label={title}
    >
      <div className="timeline-chart-header">
        {!isExpanded ? (
          <div className="timeline-chart-title-row">
            <h3>{title}</h3>
            <div className="timeline-chart-actions">
              <button
                type="button"
                className="timeline-chart-expand"
                onClick={onExpand}
                aria-label={`Expand ${title.toLowerCase()}`}
                title={`Expand ${title.toLowerCase()}`}
              >
                <img src={expandIcon} alt="" className="timeline-chart-expand-icon" />
              </button>
              {showCloseButton ? (
                <button
                  type="button"
                  className="timeline-chart-close"
                  onClick={onClose}
                  aria-label={`Hide ${title.toLowerCase()}`}
                  title={`Hide ${title.toLowerCase()}`}
                >
                  <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="timeline-chart-summary">
          <div className="graph-summary-card">
            <span>{totalLabel}</span>
            <strong>{timeline.sortedTimestamps.length}</strong>
          </div>
          <div className="graph-summary-card">
            <span>First Event</span>
            <strong>{formatGraphTimeLabel(timeline.firstTimestampMs)}</strong>
          </div>
          <div className="graph-summary-card">
            <span>Time Span</span>
            <strong>{formatGraphWindowLabel(timeline.durationMs)}</strong>
          </div>
        </div>
      </div>
      {timeline.sortedTimestamps.length ? (
        <div className="graph-chart-shell">
          <svg
            viewBox={`0 0 ${GRAPH_CHART_WIDTH} ${GRAPH_CHART_HEIGHT}`}
            className="graph-chart"
            role="img"
            aria-label={chartLabel}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={gradientStops.start} stopOpacity="0.3" />
                <stop offset="100%" stopColor={gradientStops.end} stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {timeline.yAxisTicks.map((tick) => (
              <g key={`y-${title}-${tick.label}`}>
                <line
                  className="graph-grid-line"
                  x1={GRAPH_CHART_PADDING.left}
                  x2={GRAPH_CHART_PADDING.left + (GRAPH_CHART_WIDTH - GRAPH_CHART_PADDING.left - GRAPH_CHART_PADDING.right)}
                  y1={tick.y}
                  y2={tick.y}
                />
                <text
                  className="graph-axis-label"
                  x={GRAPH_CHART_PADDING.left - 10}
                  y={tick.y + 4}
                  textAnchor="end"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            <line
              className="graph-axis-line"
              x1={GRAPH_CHART_PADDING.left}
              x2={GRAPH_CHART_PADDING.left}
              y1={GRAPH_CHART_PADDING.top}
              y2={GRAPH_CHART_HEIGHT - GRAPH_CHART_PADDING.bottom}
            />
            <line
              className="graph-axis-line"
              x1={GRAPH_CHART_PADDING.left}
              x2={GRAPH_CHART_WIDTH - GRAPH_CHART_PADDING.right}
              y1={GRAPH_CHART_HEIGHT - GRAPH_CHART_PADDING.bottom}
              y2={GRAPH_CHART_HEIGHT - GRAPH_CHART_PADDING.bottom}
            />
            {timeline.areaPath ? (
              <path d={timeline.areaPath} className="graph-area" style={{ fill: `url(#${gradientId})` }} />
            ) : null}
            {timeline.linePath ? <path d={timeline.linePath} className={lineClassName} /> : null}
            {timeline.pointCoordinates.slice(1).map((point) => (
              <circle
                key={`${title}-${point.timeMs}-${point.count}`}
                className={pointClassName}
                cx={point.x}
                cy={point.y}
                r="4.5"
              />
            ))}
            {timeline.xAxisTicks.map((tick) => (
              <text
                key={`${title}-${tick.x}-${tick.label}`}
                className="graph-axis-label"
                x={tick.x}
                y={GRAPH_CHART_HEIGHT - 12}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            ))}
          </svg>
        </div>
      ) : (
        <div className="graph-empty-state">
          <strong>{emptyText}</strong>
        </div>
      )}
      {note ? <p className="graph-inline-note">{note}</p> : null}
    </section>
  );
}

function AttendeeGraphsPanel({
  claims,
  isItemClaimsVisible,
  isNumberClaimsVisible,
  onExpandItemClaims,
  onExpandNumberClaims,
  onHideItemClaims,
  onHideNumberClaims,
  panelClassName,
  onShowItemClaims,
  onShowNumberClaims,
}) {
  const numberClaimTimestamps = claims
    .map((claim) => claim.claimedAtMs)
    .filter((timestampMs) => Number.isFinite(timestampMs));
  const numberClaimMissingCount = claims.length - numberClaimTimestamps.length;
  const itemClaimTimestamps = claims
    .flatMap((claim) => {
      if (claim.itemClaimedAtMsHistory.length > 0) {
        return claim.itemClaimedAtMsHistory;
      }

      return Number.isFinite(claim.redeemedAtMs) ? [claim.redeemedAtMs] : [];
    })
    .filter((timestampMs) => Number.isFinite(timestampMs));
  const untimestampedItemClaimCount = claims.reduce((missingCount, claim) => {
    const historyCount = claim.itemClaimedAtMsHistory.length;

    if (historyCount > 0) {
      return missingCount + Math.max(0, claim.itemsClaimedCount - historyCount);
    }

    if (claim.itemsClaimedCount > 0 && Number.isFinite(claim.redeemedAtMs)) {
      return missingCount + Math.max(0, claim.itemsClaimedCount - 1);
    }

    return missingCount + Math.max(0, claim.itemsClaimedCount);
  }, 0);
  const numberClaimNote = numberClaimMissingCount > 0
    ? `${numberClaimMissingCount} attendee claim${numberClaimMissingCount === 1 ? " is" : "s are"} missing a timestamp and excluded from this chart.`
    : "";
  const itemClaimNote = untimestampedItemClaimCount > 0
    ? `${untimestampedItemClaimCount} older item claim${untimestampedItemClaimCount === 1 ? " is" : "s are"} missing timestamps and excluded from this chart.`
    : "";

  const shouldShowChartCloseButtons = isNumberClaimsVisible && isItemClaimsVisible;

  return (
    <div
      className={`roster-graphs-panel ${panelClassName}${shouldShowChartCloseButtons ? " roster-graphs-panel--split" : ""}`}
    >
      {!isNumberClaimsVisible || !isItemClaimsVisible ? (
        <div className="roster-graphs-toolbar">
          {!isNumberClaimsVisible ? (
            <button
              type="button"
              className="secondary-button roster-graphs-toolbar-button"
              onClick={onShowNumberClaims}
            >
              Show Number Claims
            </button>
          ) : null}
          {!isItemClaimsVisible ? (
            <button
              type="button"
              className="secondary-button roster-graphs-toolbar-button"
              onClick={onShowItemClaims}
            >
              Show Item Claims
            </button>
          ) : null}
        </div>
      ) : null}
      {isNumberClaimsVisible ? (
        <TimelineChart
          emptyText="No timestamped number claims yet."
          note={numberClaimNote}
          onExpand={onExpandNumberClaims}
          onClose={onHideNumberClaims}
          showCloseButton={shouldShowChartCloseButtons}
          timestamps={numberClaimTimestamps}
          title="Number Claims"
          tone="claims"
          totalLabel="Claims"
        />
      ) : null}
      {isItemClaimsVisible ? (
        <TimelineChart
          emptyText="No timestamped item claims yet."
          note={itemClaimNote}
          onExpand={onExpandItemClaims}
          onClose={onHideItemClaims}
          showCloseButton={shouldShowChartCloseButtons}
          timestamps={itemClaimTimestamps}
          title="Item Claims"
          tone="items"
          totalLabel="Items"
        />
      ) : null}
    </div>
  );
}

function FullRoster({ claims, isGraphOpen, onToggleGraph, preclaims, onFetchPreclaims, onAssignPreclaimAsStaff, onRemoveClaim, liveEventId, showPreclaimQueue }) {
  const [expandedGraphTone, setExpandedGraphTone] = useState("");
  const [isGraphPanelMounted, setIsGraphPanelMounted] = useState(false);
  const [isNumberClaimsVisible, setIsNumberClaimsVisible] = useState(true);
  const [isItemClaimsVisible, setIsItemClaimsVisible] = useState(true);

  useEffect(() => {
    if (isGraphOpen) {
      setIsGraphPanelMounted(true);
      setIsNumberClaimsVisible(true);
      setIsItemClaimsVisible(true);
      return undefined;
    }

    if (!isGraphPanelMounted) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsGraphPanelMounted(false);
    }, GRAPH_PANEL_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isGraphOpen, isGraphPanelMounted]);

  useEffect(() => {
    if (!isGraphOpen && expandedGraphTone) {
      setExpandedGraphTone("");
    }
  }, [expandedGraphTone, isGraphOpen]);

  useEffect(() => {
    if (showPreclaimQueue && typeof onFetchPreclaims === "function") {
      void onFetchPreclaims();
    }
  }, [showPreclaimQueue, onFetchPreclaims]);

  const expandedGraphConfig =
    expandedGraphTone === "claims"
      ? {
          emptyText: "No timestamped number claims yet.",
          note: claims.filter((claim) => Number.isFinite(claim.claimedAtMs)).length < claims.length
            ? `${claims.length - claims.filter((claim) => Number.isFinite(claim.claimedAtMs)).length} attendee claim${claims.length - claims.filter((claim) => Number.isFinite(claim.claimedAtMs)).length === 1 ? " is" : "s are"} missing a timestamp and excluded from this chart.`
            : "",
          timestamps: claims
            .map((claim) => claim.claimedAtMs)
            .filter((timestampMs) => Number.isFinite(timestampMs)),
          title: "Number Claims",
          tone: "claims",
          totalLabel: "Claims",
        }
      : expandedGraphTone === "items"
        ? {
            emptyText: "No timestamped item claims yet.",
            note: claims.reduce((missingCount, claim) => {
              const historyCount = claim.itemClaimedAtMsHistory.length;

              if (historyCount > 0) {
                return missingCount + Math.max(0, claim.itemsClaimedCount - historyCount);
              }

              if (claim.itemsClaimedCount > 0 && Number.isFinite(claim.redeemedAtMs)) {
                return missingCount + Math.max(0, claim.itemsClaimedCount - 1);
              }

              return missingCount + Math.max(0, claim.itemsClaimedCount);
            }, 0)
              ? `${claims.reduce((missingCount, claim) => {
                  const historyCount = claim.itemClaimedAtMsHistory.length;

                  if (historyCount > 0) {
                    return missingCount + Math.max(0, claim.itemsClaimedCount - historyCount);
                  }

                  if (claim.itemsClaimedCount > 0 && Number.isFinite(claim.redeemedAtMs)) {
                    return missingCount + Math.max(0, claim.itemsClaimedCount - 1);
                  }

                  return missingCount + Math.max(0, claim.itemsClaimedCount);
                }, 0)} older item claim${claims.reduce((missingCount, claim) => {
                  const historyCount = claim.itemClaimedAtMsHistory.length;

                  if (historyCount > 0) {
                    return missingCount + Math.max(0, claim.itemsClaimedCount - historyCount);
                  }

                  if (claim.itemsClaimedCount > 0 && Number.isFinite(claim.redeemedAtMs)) {
                    return missingCount + Math.max(0, claim.itemsClaimedCount - 1);
                  }

                  return missingCount + Math.max(0, claim.itemsClaimedCount);
                }, 0) === 1 ? " is" : "s are"} missing timestamps and excluded from this chart.`
              : "",
            timestamps: claims
              .flatMap((claim) => {
                if (claim.itemClaimedAtMsHistory.length > 0) {
                  return claim.itemClaimedAtMsHistory;
                }

                return Number.isFinite(claim.redeemedAtMs) ? [claim.redeemedAtMs] : [];
              })
              .filter((timestampMs) => Number.isFinite(timestampMs)),
            title: "Item Claims",
            tone: "items",
            totalLabel: "Items",
          }
        : null;

  return (
    <div className={`entry-card compact-card roster-card${isGraphOpen ? " roster-card--with-graphs" : ""}`}>
      <div className="roster-card-header">
        <div className="roster-card-title-block">
          <h2>Attendee List</h2>
          <p className="roster-card-subtitle">
            {claims.length} attendee{claims.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="queue-corner-actions queue-corner-actions--roster">
          <button
            className={`secondary-button queue-corner-button${isGraphOpen ? " queue-corner-button--active" : ""}`}
            type="button"
            onClick={onToggleGraph}
            aria-label={isGraphOpen ? "Hide attendee graphs" : "Show attendee graphs"}
            title={isGraphOpen ? "Hide attendee graphs" : "Show attendee graphs"}
          >
            <img
              src={graphIcon}
              alt=""
              className="button-icon queue-corner-button-icon queue-corner-button-icon--graph"
            />
          </button>
        </div>
      </div>
      {isGraphPanelMounted ? (
        <AttendeeGraphsPanel
          claims={claims}
          isItemClaimsVisible={isItemClaimsVisible}
          isNumberClaimsVisible={isNumberClaimsVisible}
          onExpandItemClaims={() => setExpandedGraphTone("items")}
          onExpandNumberClaims={() => setExpandedGraphTone("claims")}
          onHideItemClaims={() => setIsItemClaimsVisible(false)}
          onHideNumberClaims={() => setIsNumberClaimsVisible(false)}
          onShowItemClaims={() => setIsItemClaimsVisible(true)}
          onShowNumberClaims={() => setIsNumberClaimsVisible(true)}
          panelClassName={isGraphOpen ? "roster-graphs-panel--open" : "roster-graphs-panel--closing"}
        />
      ) : null}
      {claims.length ? (
        <div className="roster-list" role="list">
          {claims.map((claim) => {
            const avatarLabel = claim.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";

            return (
              <div key={claim.claimId} className="roster-row" role="listitem">
                <div className="roster-primary">
                  <strong>#{claim.number}</strong>
                                    <div className="roster-avatar" aria-hidden="true">
                    {claim.avatarUrl ? (
                      <img src={claim.avatarUrl} alt="" className="roster-avatar-image" />
                    ) : (
                      <span className="roster-avatar-fallback">{avatarLabel}</span>
                    )}
                  </div>
                  <span>{claim.displayName}</span>
                </div>
                <div className="roster-meta">
                  <span className="roster-badge">Items: {claim.itemsClaimedCount}</span>
                  <span
                    className={`roster-badge ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                  >
                    {claim.isMember ? "Member" : "Not Member"}
                  </span>
                  <button
                    type="button"
                    className="roster-remove-button"
                    onClick={() => {
                      if (!onRemoveClaim) return;
                      const confirmMsg = `Remove ${claim.displayName || 'attendee'} (#${claim.number})?`;
                      if (window.confirm(confirmMsg)) {
                        void onRemoveClaim(claim.claimId);
                      }
                    }}
                    title="Remove number"
                    aria-label={`Remove ${claim.displayName || 'attendee'} (#${claim.number})`}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p>No attendees have claimed a number yet.</p>
      )}
      {showPreclaimQueue ? (
        <div className="queue-backlog-panel">
          <h3 className="queue-backlog-title">Preclaim Queue</h3>
          <div className="queue-summary queue-summary--single" aria-label="Preclaim counts">
            <div className="queue-summary-card queue-summary-card--alert">
              <span>Queued</span>
              <strong>{(preclaims || []).length} waiting</strong>
            </div>
          </div>
          <section>
            <h4>Members</h4>
            { (preclaims || []).filter((p) => p.isMember).length === 0 ? (
              <p>No members in queue.</p>
            ) : (
              <div className="roster-list">
                { (preclaims || []).filter((p) => p.isMember).map((m) => (
                  <div key={m.preclaimId} className="roster-row" role="listitem">
                    <div className="roster-primary">
                      <div className="roster-avatar" aria-hidden="true">
                        {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="roster-avatar-image" /> : <span className="roster-avatar-fallback">{(m.displayName||'?').charAt(0).toUpperCase()}</span>}
                      </div>
                      <span>{m.displayName}</span>
                    </div>
                    <div className="roster-meta">
                      <button className="secondary-button" type="button" onClick={() => onAssignPreclaimAsStaff && onAssignPreclaimAsStaff(m.preclaimId)}>Assign Number</button>
                    </div>
                  </div>
                )) }
              </div>
            ) }
          </section>
          <section style={{ marginTop: '0.75rem' }}>
            <h4>Regulars</h4>
            { (preclaims || []).filter((p) => !p.isMember).length === 0 ? (
              <p>No regulars in queue.</p>
            ) : (
              <div className="roster-list">
                { (preclaims || []).filter((p) => !p.isMember).map((m) => (
                  <div key={m.preclaimId} className="roster-row" role="listitem">
                    <div className="roster-primary">
                      <div className="roster-avatar" aria-hidden="true">
                        {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="roster-avatar-image" /> : <span className="roster-avatar-fallback">{(m.displayName||'?').charAt(0).toUpperCase()}</span>}
                      </div>
                      <span>{m.displayName}</span>
                    </div>
                    <div className="roster-meta">
                      <button className="secondary-button" type="button" onClick={() => onAssignPreclaimAsStaff && onAssignPreclaimAsStaff(m.preclaimId)}>Assign Number</button>
                    </div>
                  </div>
                )) }
              </div>
            ) }
          </section>
        </div>
      ) : null}
      {expandedGraphConfig ? (
        <GraphModalOverlay onClose={() => setExpandedGraphTone("")} title={expandedGraphConfig.title}>
          <TimelineChart
            emptyText={expandedGraphConfig.emptyText}
            isExpanded
            note={expandedGraphConfig.note}
            showCloseButton={false}
            title={expandedGraphConfig.title}
            tone={expandedGraphConfig.tone}
            totalLabel={expandedGraphConfig.tone === "claims" ? "Claims" : "Items"}
            timestamps={expandedGraphConfig.timestamps}
          />
        </GraphModalOverlay>
      ) : null}
    </div>
  );
}

function ScannerModal({ onClose, scanFeedback, scanLoading, scannerVideoRef }) {
  return (
    <div className="scanner-modal" role="dialog" aria-modal="true" aria-label="Claim scanner">
      <div className="scanner-modal-header">
        <button
          type="button"
          className="scanner-close-button"
          onClick={onClose}
          aria-label="Close scanner"
        >
          ×
        </button>
      </div>
      <div className="scanner-modal-body">
        <video ref={scannerVideoRef} className="scanner-video scanner-video--modal" muted playsInline />
      </div>
      <div className="scanner-modal-footer">
        <p>Point the camera at an attendee&apos;s QR code.</p>
      </div>
      {scanLoading ? <div className="scanner-toast scanner-toast--loading">Processing scan...</div> : null}
      {scanFeedback ? (
        <div className={`scanner-toast scanner-toast--${scanFeedback.tone}`}>
          {scanFeedback.message}
        </div>
      ) : null}
    </div>
  );
}

function ControlPage({
  activeQueueClaims,
  activeQueueElapsedLabel,
  autoAdvanceBacklogLimit,
  autoAdvanceBacklogLimitEnabled,
  autoAdvanceEnabled,
  autoAdvanceFinalCall,
  autoAdvanceFinalCallTimerEnabled,
  autoAdvanceFinalCallTimerMinutes,
  autoAdvanceNextGroup,
  autoAdvanceStartRound,
  autoAdvanceThresholdPercent,
  groupSize,
  backlogClaims,
  controlForm,
  controlMessage,
  controlSaving,
  currentEventClaims,
  currentRound,
  
  isEventDetailsModalOpen,
  isEventLive,
  isLastGroup,
  liveState,
  onActivateFinalCall,
  onAutoAdvanceActionChange,
  onAutoAdvanceBacklogLimitChange,
  onAutoAdvanceTimerMinutesChange,
  onAutoAdvanceThresholdChange,
  onCloseEvent,
  onCloseEventDetails,
  onFieldChange,
  onHandleLogout,
  onIncrement,
  onOpenDisplayScreen,
  onOpenEventDetails,
  onOpenScanner,
  preclaims,
  onFetchPreclaims,
  onAssignPreclaimAsStaff,
  onRemoveClaim,
  showPreclaimQueue,
  liveEvent,
  
  onCloseScanner,
  onNewRound,
  onGroupSizeChange,
  onStartEvent,
  onSaveEventDetails,
  onToggleAutoAdvance,
  queueDescription,
  queueTitle,
  scanFeedback,
  scanLoading,
  scannerActive,
  scannerVideoRef,
  totalPeopleWithNumbers,
}) {
  const [isAutoAdvanceSettingsOpen, setIsAutoAdvanceSettingsOpen] = useState(false);
  const [isAutoAdvanceSettingsMounted, setIsAutoAdvanceSettingsMounted] = useState(false);
  const [isAttendeeGraphOpen, setIsAttendeeGraphOpen] = useState(false);
  const [isBacklogOpen, setIsBacklogOpen] = useState(false);
  const queueEmptyText = liveState.finalCall
    ? "Everyone from the final-call list has claimed an item."
    : liveState.current === 0
      ? ""
      : "No attendees are in the current group.";
  const isCurrentGroupFullyClaimed =
    !liveState.finalCall &&
    liveState.current > 0 &&
    activeQueueClaims.length > 0 &&
    activeQueueClaims.every((claim) => claim.redeemedRound === currentRound);
  const canStartRound = totalPeopleWithNumbers > 0;
  const isReadyForFinalCall = isLastGroup && isCurrentGroupFullyClaimed;
  const isFinalCallFullyClaimed =
    liveState.finalCall &&
    (activeQueueClaims.length === 0 ||
      activeQueueClaims.every((claim) => claim.redeemedRound === currentRound));
  const currentRoundClaimedCount = currentEventClaims.filter(
    (claim) => claim.redeemedRound === currentRound,
  ).length;
  const currentRoundClaimedRatio =
    totalPeopleWithNumbers > 0 ? currentRoundClaimedCount / totalPeopleWithNumbers : 0;
  const autoAdvanceDetails = [];

  if (autoAdvanceEnabled && autoAdvanceThresholdPercent > 0) {
    autoAdvanceDetails.push(`Threshold: ${autoAdvanceThresholdPercent}% claimed.`);
  }

  if (autoAdvanceEnabled && autoAdvanceFinalCallTimerEnabled) {
    autoAdvanceDetails.push(
      `Final call timer: ${autoAdvanceFinalCallTimerMinutes} minute${autoAdvanceFinalCallTimerMinutes === 1 ? "" : "s"}.`,
    );
  }

  if (autoAdvanceEnabled && autoAdvanceBacklogLimitEnabled) {
    autoAdvanceDetails.push(
      `Pause auto-advance when backlog is above ${autoAdvanceBacklogLimit}.`,
    );
  }

  const actionOptions = [
    {
      checked: autoAdvanceFinalCall,
      description: "After the last group, enter final call.",
      field: "autoAdvanceFinalCall",
      label: "Final Call",
    },
    {
      checked: autoAdvanceStartRound,
      description: "After final call or a pending round, start the next round's first group.",
      field: "autoAdvanceStartRound",
      label: "Next Round",
    },
  ];

  const autoAdvanceLabel = autoAdvanceEnabled
    ? autoAdvanceDetails.join(" ") || "Auto-advance is on."
    : "Auto-advance is off.";
  const shouldShowInlineBacklog = liveState.finalCall;
  const primaryQueueAction = !liveState.finalCall
    ? isLastGroup
      ? {
          disabled: false,
          isReady: isReadyForFinalCall,
          label: "Final Call",
          onClick: onActivateFinalCall,
        }
      : {
          disabled: liveState.current === 0 && !canStartRound,
          isReady: isCurrentGroupFullyClaimed,
          label:
            liveState.round === 1 && liveState.current === 0
              ? "Start Round 1"
              : "Next Group",
          onClick: () => onIncrement(groupSize),
        }
    : {
        disabled: false,
        isReady: isFinalCallFullyClaimed,
        label: "Start Next Round",
        onClick: onNewRound,
      };

  useEffect(() => {
    if (isAutoAdvanceSettingsOpen) {
      setIsAutoAdvanceSettingsMounted(true);
      return undefined;
    }

    if (!isAutoAdvanceSettingsMounted) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsAutoAdvanceSettingsMounted(false);
    }, AUTO_SETTINGS_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAutoAdvanceSettingsMounted, isAutoAdvanceSettingsOpen]);

  useEffect(() => {
    if (!isEventLive && isAttendeeGraphOpen) {
      setIsAttendeeGraphOpen(false);
    }
  }, [isAttendeeGraphOpen, isEventLive]);

  return (
    <div className="control">
      {!isEventLive ? (
        <EventDetailsModal
          controlForm={controlForm}
          controlMessage={controlMessage}
          controlSaving={controlSaving}
          isEventLive={false}
          onClose={onCloseEventDetails}
          onFieldChange={onFieldChange}
          onSubmit={onStartEvent}
        />
      ) : null}
      {isEventLive ? (
        <>
          <div className={`control-dashboard${isEventDetailsModalOpen ? " control-dashboard--blurred" : ""}`}>
            <div className="control-event-header">
            <p className="control-event-subtitle">{liveEvent.timeframeLabel}</p>
              <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
              <div className="control-actions control-actions--header">
                <button
                  className="secondary-button icon-button control-side-action"
                  type="button"
                  onClick={onOpenEventDetails}
                  aria-label="Edit event details"
                  title="Edit event details"
                >
                  <img src={editIcon} alt="" className="button-icon" />
                </button>
                <button
                  className="danger-button control-side-action control-side-action--text"
                  type="button"
                  onClick={onCloseEvent}
                  disabled={controlSaving}
                >
                  End Event
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stats-stack">
                <div className="stat-card stat-card--compact">
                  <span>Round:</span>
                  <strong>{liveState.round}</strong>
                </div>
                <div className="stat-card stat-card--compact">
                  <span>Attendees:</span>
                  <strong>{totalPeopleWithNumbers}</strong>
                </div>
              </div>
              <div className="stat-card stat-card--progress">
                <span>Round Progress</span>
                <strong>{currentRoundClaimedCount}/{totalPeopleWithNumbers}</strong>
                <div className="stat-progress" aria-hidden="true">
                  <div
                    className="stat-progress-fill"
                    style={{ width: `${Math.max(0, Math.min(1, currentRoundClaimedRatio)) * 100}%` }}
                  />
                </div>
                <small className="stat-progress-copy">
                  {totalPeopleWithNumbers > 0
                    ? `${Math.round(currentRoundClaimedRatio * 100)}% of attendees claimed an item`
                    : "No attendees yet"}
                </small>
              </div>
            </div>

            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}

           

            <div className="entry-card compact-card queue-card">
              <div className="queue-corner-actions">
                <button
                  className={`secondary-button queue-corner-button${isAutoAdvanceSettingsOpen ? " queue-corner-button--active" : ""}`}
                  type="button"
                  onClick={() => setIsAutoAdvanceSettingsOpen((currentValue) => !currentValue)}
                  aria-label="Auto-advance settings"
                  title="Auto-advance settings"
                >
                  <img src={settingsIcon} alt="" className="button-icon queue-corner-button-icon queue-corner-button-icon--settings" />
                </button>
                <button
                  className={`secondary-button queue-corner-button${autoAdvanceEnabled ? " queue-corner-button--active" : ""}`}
                  type="button"
                  onClick={onToggleAutoAdvance}
                  aria-label={autoAdvanceEnabled ? "Disable auto-advance" : "Enable auto-advance"}
                  title={autoAdvanceEnabled ? "Disable auto-advance" : "Enable auto-advance"}
                >
                  <img src={autoIcon} alt="" className="button-icon queue-corner-button-icon queue-corner-button-icon--auto" />
                </button>
              </div>
              <h2 className="queue-title">
                {!liveState.finalCall ? <img src={groupIcon} alt="" className="title-icon" /> : null}
                <span>{queueTitle}</span>
              </h2>
              {!isAutoAdvanceSettingsMounted && activeQueueElapsedLabel ? (
                <p className="queue-timer">Up for {activeQueueElapsedLabel}</p>
              ) : null}
              {isAutoAdvanceSettingsMounted ? (
                <div className={`queue-auto-advance-panel${isAutoAdvanceSettingsOpen ? " queue-auto-advance-panel--open" : " queue-auto-advance-panel--closing"}`}>
                  {activeQueueElapsedLabel ? (
                    <p className="queue-timer queue-timer--panel">Up for {activeQueueElapsedLabel}</p>
                  ) : null}
                  <p className="queue-auto-advance-summary">{autoAdvanceLabel}</p>
                  <div className="queue-auto-advance-settings-grid">
                    <div className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline">
                      <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                        <span className="queue-auto-advance-setting-title">Next Group</span>
                        <input
                          type="checkbox"
                          checked={autoAdvanceNextGroup}
                          onChange={(event) =>
                            onAutoAdvanceActionChange("autoAdvanceNextGroup", event.target.checked)
                          }
                        />
                      </label>
                      <div className="queue-auto-advance-inline-control">
                        <select
                          value={String(autoAdvanceThresholdPercent || 100)}
                          onChange={(event) => onAutoAdvanceThresholdChange(event.target.value)}
                        >
                          <option value="50">50%</option>
                          <option value="60">60%</option>
                          <option value="70">70%</option>
                          <option value="80">80%</option>
                          <option value="90">90%</option>
                          <option value="100">100%</option>
                        </select>
                      </div>
                      <span className="queue-auto-advance-setting-copy">
                        After this claimed threshold is reached, move to the next normal group.
                      </span>
                    </div>
                    {actionOptions.map((option) => (
                      <label key={option.field} className="queue-auto-advance-setting-card">
                        <span className="queue-auto-advance-setting-topline">
                          <span className="queue-auto-advance-setting-title">{option.label}</span>
                          <input
                            type="checkbox"
                            checked={option.checked}
                            onChange={(event) =>
                              onAutoAdvanceActionChange(option.field, event.target.checked)
                            }
                          />
                        </span>
                        <span className="queue-auto-advance-setting-copy">{option.description}</span>
                      </label>
                    ))}
                    <div className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline">
                      <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                        <span className="queue-auto-advance-setting-title">Final Call Timer</span>
                        <input
                          type="checkbox"
                          checked={autoAdvanceFinalCallTimerEnabled}
                          onChange={(event) =>
                            onAutoAdvanceActionChange(
                              "autoAdvanceFinalCallTimerEnabled",
                              event.target.checked,
                            )
                          }
                          disabled={!autoAdvanceStartRound}
                        />
                      </label>
                      <div className="queue-auto-advance-inline-control">
                        <input
                          type="number"
                          min="1"
                          max="240"
                          step="1"
                          value={autoAdvanceFinalCallTimerMinutes}
                          onChange={(event) => onAutoAdvanceTimerMinutesChange(event.target.value)}
                          disabled={!autoAdvanceStartRound || !autoAdvanceFinalCallTimerEnabled}
                        />
                        <span>min</span>
                      </div>
                      <span className="queue-auto-advance-setting-copy">
                        During final call, force next round after this timer even if threshold was not met.
                      </span>
                    </div>
                    <div className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline">
                      <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                        <span className="queue-auto-advance-setting-title">People Per Group</span>
                      </label>
                      <div className="queue-auto-advance-inline-control">
                        <input
                          type="number"
                          min="1"
                          max="500"
                          step="1"
                          value={groupSize}
                          onChange={(event) => onGroupSizeChange(event.target.value)}
                        />
                        <span>people</span>
                      </div>
                      <span className="queue-auto-advance-setting-copy">
                        Sets how many attendees are included when the next group starts. Current groups stay unchanged.
                      </span>
                    </div>
                    <div className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline">
                      <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                        <span className="queue-auto-advance-setting-title">Backlog Limit</span>
                        <input
                          type="checkbox"
                          checked={autoAdvanceBacklogLimitEnabled}
                          onChange={(event) =>
                            onAutoAdvanceActionChange(
                              "autoAdvanceBacklogLimitEnabled",
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                      <div className="queue-auto-advance-inline-control">
                        <input
                          type="number"
                          min="0"
                          max="500"
                          step="1"
                          value={autoAdvanceBacklogLimit}
                          onChange={(event) => onAutoAdvanceBacklogLimitChange(event.target.value)}
                          disabled={!autoAdvanceBacklogLimitEnabled}
                        />
                        <span>max waiting</span>
                      </div>
                      <span className="queue-auto-advance-setting-copy">
                        Pause auto-advance when too many earlier numbers are still waiting.
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="queue-primary-action-wrap">
                <button
                  className={`control-primary-action queue-primary-action${primaryQueueAction.isReady ? " ready-button" : ""}`}
                  type="button"
                  onClick={primaryQueueAction.onClick}
                  disabled={primaryQueueAction.disabled}
                >
                  {primaryQueueAction.label}
                </button>
              </div>
              {queueDescription ? <p>{queueDescription}</p> : null}
              {shouldShowInlineBacklog ? (
                <BacklogList claims={backlogClaims} />
              ) : (
                <>
                  <ClaimList
                    claims={activeQueueClaims}
                    currentRound={currentRound}
                    emptyText={queueEmptyText}
                    isFinalCall={liveState.finalCall}
                    isLastGroup={isLastGroup}
                  />
                  {backlogClaims.length > 0 ? (
                    <>
                      <div className="queue-backlog-toggle-wrap">
                        <button
                          className="secondary-button queue-backlog-toggle"
                          type="button"
                          onClick={() => setIsBacklogOpen((currentValue) => !currentValue)}
                        >
                          {isBacklogOpen ? "Hide" : "Show"} Backlog ({backlogClaims.length})
                        </button>
                      </div>
                      {isBacklogOpen ? <BacklogList claims={backlogClaims} /> : null}
                    </>
                  ) : null}
                </>
              )}
            </div>

            <FullRoster
              claims={currentEventClaims}
              isGraphOpen={isAttendeeGraphOpen}
              onToggleGraph={() => setIsAttendeeGraphOpen((currentValue) => !currentValue)}
              preclaims={preclaims}
              onFetchPreclaims={onFetchPreclaims}
              onAssignPreclaimAsStaff={onAssignPreclaimAsStaff}
              onRemoveClaim={onRemoveClaim}
              liveEventId={liveEvent?.eventId}
            />
          </div>
          {isEventDetailsModalOpen ? (
            <EventDetailsModal
              controlForm={controlForm}
              controlMessage={controlMessage}
              controlSaving={controlSaving}
              isEventLive
              onClose={onCloseEventDetails}
              onFieldChange={onFieldChange}
              onSubmit={onSaveEventDetails}
            />
          ) : null}
        </>
      ) : null}

      {scannerActive ? (
        <ScannerModal
          onClose={onCloseScanner}
          scanFeedback={scanFeedback}
          scanLoading={scanLoading}
          scannerVideoRef={scannerVideoRef}
        />
      ) : null}

      {isEventLive ? (
        <div className="bottom-navbar">
          <button
            className="bottom-navbar-button"
            type="button"
            onClick={onOpenScanner}
            disabled={scanLoading || !isEventLive}
          >
            <img src={scanIcon} alt="" className="button-icon" />
            <span>Open Scanner</span>
          </button>
          <button className="secondary-button bottom-navbar-button" type="button" onClick={onOpenDisplayScreen}>
            <img src={displayIcon} alt="" className="button-icon" />
            <span>Open Display</span>
          </button>
        </div>
      ) : (
        <div className="bottom-navbar">
          <button className="secondary-button bottom-navbar-button" onClick={onHandleLogout}>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

export default ControlPage;