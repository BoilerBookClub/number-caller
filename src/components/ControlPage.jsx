import { useEffect, useRef, useState } from "react";
import {
  ChartColumnIncreasing,
  Expand,
  FastForward,
  Monitor,
  ScanLine,
  Settings,
  SquarePen,
  Users,
} from "lucide-react";
import {
  SketchButton,
  SketchCard,
  SketchDialog,
  SketchCombo,
  SketchIconButton,
  SketchInput,
  SketchProgress,
  SketchSlider,
  SketchToggle,
} from "./SketchUI";
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

function formatStatusDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function getTimestampMs(value) {
  if (!value) {
    return null;
  }

  if (typeof value?.toMillis === "function") {
    const timestampMs = value.toMillis();
    return Number.isFinite(timestampMs) ? timestampMs : null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsedValue = Date.parse(value);
  return Number.isNaN(parsedValue) ? null : parsedValue;
}

function getJoinedIdentityKey({ discordUserId, fallbackId }) {
  const normalizedDiscordUserId = typeof discordUserId === "string" ? discordUserId.trim() : "";

  if (normalizedDiscordUserId) {
    return `discord:${normalizedDiscordUserId}`;
  }

  if (fallbackId) {
    return `record:${String(fallbackId)}`;
  }

  return null;
}

function buildJoinedTimeline({ claims, preclaims }) {
  const allIdentityKeys = new Set();
  const joinedAtByIdentity = new Map();

  const registerJoinedRecord = ({ identityKey, joinedAtMs }) => {
    if (!identityKey) {
      return;
    }

    allIdentityKeys.add(identityKey);

    if (!Number.isFinite(joinedAtMs)) {
      return;
    }

    const currentJoinedAtMs = joinedAtByIdentity.get(identityKey);
    if (!Number.isFinite(currentJoinedAtMs) || joinedAtMs < currentJoinedAtMs) {
      joinedAtByIdentity.set(identityKey, joinedAtMs);
    }
  };

  (claims || []).forEach((claim) => {
    registerJoinedRecord({
      identityKey: getJoinedIdentityKey({
        discordUserId: claim.discordUserId,
        fallbackId: claim.claimId,
      }),
      joinedAtMs: getTimestampMs(claim.joinedAtMs) ?? getTimestampMs(claim.claimedAtMs),
    });
  });

  (preclaims || []).forEach((preclaim) => {
    registerJoinedRecord({
      identityKey: getJoinedIdentityKey({
        discordUserId: preclaim.discordUserId,
        fallbackId: preclaim.preclaimId,
      }),
      joinedAtMs: getTimestampMs(preclaim.createdAt),
    });
  });

  return {
    missingCount: Math.max(0, allIdentityKeys.size - joinedAtByIdentity.size),
    timestamps: Array.from(joinedAtByIdentity.values()).sort(
      (leftTimestamp, rightTimestamp) => leftTimestamp - rightTimestamp,
    ),
    total: allIdentityKeys.size,
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
  const parsedMemberCheckInLeadMinutes = Number.parseInt(controlForm.memberCheckInLeadMinutes, 10);
  const memberCheckInLeadMinutes = Number.isFinite(parsedMemberCheckInLeadMinutes)
    ? Math.max(0, Math.min(60, parsedMemberCheckInLeadMinutes))
    : 15;
  const memberCheckInLabel = `${memberCheckInLeadMinutes} minute${memberCheckInLeadMinutes === 1 ? "" : "s"}`;

  return (
    <SketchDialog
      className="event-details-dialog"
      open
      onClose={isEventLive ? onClose : undefined}
      elevation={2}
      role="dialog"
      aria-modal="true"
      aria-label="Event details"
    >
      <div className="event-modal">
        {isEventLive ? (
          <div className="event-modal-header">
            <SketchIconButton
              type="button"
              className="event-modal-close"
              onClick={onClose}
              aria-label="Close event details"
            >
              ×
            </SketchIconButton>
          </div>
        ) : null}
        <div className="event-modal-content">
          <h2>{isEventLive ? "Edit Event Details" : "Create Event"}</h2>
          <form className="control-form event-modal-form" onSubmit={onSubmit}>
            <div className="title-grid">
              <label className="control-input-group control-input-group--centered">
                <span>Event Title</span>
                <SketchInput
                  type="text"
                  value={controlForm.title}
                  onChange={onFieldChange("title")}
                  placeholder="Event Name Here..."
                  autoComplete="off"
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--compact title-font-select">
                <span>Event Title Font</span>
                <SketchCombo
                  className="title-font-combo"
                  selected={controlForm.titleFont}
                  onChange={onFieldChange("titleFont")}
                >
                  {TITLE_FONT_OPTIONS.map((option) => (
                    <wired-item key={option.value} value={option.value}>
                      {option.label}
                    </wired-item>
                  ))}
                </SketchCombo>
              </label>
            </div>
            <label className="control-input-group control-input-group--centered">
              <span>Book List URL</span>
              <SketchInput
                type="url"
                value={controlForm.qrUrl}
                onChange={onFieldChange("qrUrl")}
                placeholder="Enter QR code destination"
              />
            </label>
            <div className="time-grid time-grid--centered">
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>Start Time</span>
                <SketchInput
                  type="time"
                  value={controlForm.timeframeStart}
                  onChange={onFieldChange("timeframeStart")}
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--time">
                <span>End Time</span>
                <SketchInput
                  type="time"
                  value={controlForm.timeframeEnd}
                  onChange={onFieldChange("timeframeEnd")}
                />
              </label>
            </div>
            <label className="control-input-group control-input-group--centered control-input-group--compact">
              <span>Member Early Check-In</span>
              <div className="queue-auto-advance-inline-control event-member-checkin-inline-control">
                <SketchSlider
                  className="queue-auto-advance-slider event-member-checkin-slider"
                  min={0}
                  max={60}
                  step={1}
                  value={memberCheckInLeadMinutes}
                  onChange={onFieldChange("memberCheckInLeadMinutes")}
                />
                <span>{memberCheckInLeadMinutes} min</span>
              </div>
              <small className="control-input-hint">
                {memberCheckInLabel} before event start.
              </small>
            </label>
            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}
            <div className="control-actions">
              <SketchButton type="submit" disabled={controlSaving}>
                {controlSaving
                  ? "Saving..."
                  : isEventLive
                    ? "Save Event Details"
                    : "Start Event"}
              </SketchButton>
            </div>
          </form>
        </div>
      </div>
    </SketchDialog>
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
                <SketchProgress
                  className="queue-summary-progress"
                  value={Math.max(0, Math.min(1, claimedProgress)) * 100}
                  min={0}
                  max={100}
                  aria-hidden="true"
                />
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
      <div className="roster-list roster-list--group" role="list">
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
      <div className="roster-list roster-list--group" role="list">
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
      <SketchCard
        className="graph-expand-modal sketch-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} expanded view`}
        elevation={1}
        fill="#ffffff"
        strokeColor="#111111"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="graph-expand-modal-header">
          <h2>{title}</h2>
          <SketchIconButton
            type="button"
            className="timeline-chart-close timeline-chart-close--modal"
            onClick={onClose}
            aria-label={`Close expanded ${title.toLowerCase()}`}
            title={`Close expanded ${title.toLowerCase()}`}
          >
            <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
          </SketchIconButton>
        </div>
        <div className="graph-expand-modal-body">{children}</div>
      </SketchCard>
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
    <SketchCard
      className={`timeline-chart-card sketch-entry-card${isExpanded ? " timeline-chart-card--expanded" : ""}`}
      aria-label={title}
      role="region"
      elevation={1}
      fill="#ffffff"
      strokeColor="#111111"
    >
      <div className="timeline-chart-header">
        {!isExpanded ? (
          <div className="timeline-chart-title-row">
            <h3>{title}</h3>
            <div className="timeline-chart-actions">
              <SketchIconButton
                type="button"
                className="timeline-chart-expand"
                onClick={onExpand}
                aria-label={`Expand ${title.toLowerCase()}`}
                title={`Expand ${title.toLowerCase()}`}
              >
                <Expand
                  aria-hidden="true"
                  className="timeline-chart-expand-icon icon-animated icon-animate-pulse"
                />
              </SketchIconButton>
              {showCloseButton ? (
                <SketchIconButton
                  type="button"
                  className="timeline-chart-close"
                  onClick={onClose}
                  aria-label={`Hide ${title.toLowerCase()}`}
                  title={`Hide ${title.toLowerCase()}`}
                >
                  <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
                </SketchIconButton>
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
        <SketchCard
          className="graph-chart-shell sketch-entry-card"
          elevation={1}
          fill="#ffffff"
          strokeColor="#111111"
        >
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
        </SketchCard>
      ) : (
        <div className="graph-empty-state">
          <strong>{emptyText}</strong>
        </div>
      )}
      {note ? <p className="graph-inline-note">{note}</p> : null}
    </SketchCard>
  );
}

function AttendeeGraphsPanel({
  claims,
  joinedNote,
  joinedTimestamps,
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
            <SketchButton
              type="button"
              className="secondary-button roster-graphs-toolbar-button"
              onClick={onShowNumberClaims}
            >
              Show Joined
            </SketchButton>
          ) : null}
          {!isItemClaimsVisible ? (
            <SketchButton
              type="button"
              className="secondary-button roster-graphs-toolbar-button"
              onClick={onShowItemClaims}
            >
              Show Item Claims
            </SketchButton>
          ) : null}
        </div>
      ) : null}
      {isNumberClaimsVisible ? (
        <TimelineChart
          emptyText="No timestamped joins yet."
          note={joinedNote}
          onExpand={onExpandNumberClaims}
          onClose={onHideNumberClaims}
          showCloseButton={shouldShowChartCloseButtons}
          timestamps={joinedTimestamps}
          title="Joined"
          tone="claims"
          totalLabel="Joined"
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

function FullRoster({
  claims,
  isGraphOpen,
  onToggleGraph,
  onRequestConfirmation,
  preclaims,
  onAssignPreclaimAsStaff,
  onMoveClaimBackToQueueAsStaff,
  onRefreshAllPreclaimMembershipsAsStaff,
  onRefreshPreclaimMembershipAsStaff,
  onRemoveClaim,
  onRemovePreclaimAsStaff,
  showPreclaimQueue,
}) {
  const [expandedGraphTone, setExpandedGraphTone] = useState("");
  const [isGraphPanelMounted, setIsGraphPanelMounted] = useState(false);
  const [isNumberClaimsVisible, setIsNumberClaimsVisible] = useState(true);
  const [isItemClaimsVisible, setIsItemClaimsVisible] = useState(true);
  const [refreshingPreclaimIds, setRefreshingPreclaimIds] = useState(() => new Set());
  const [isRefreshingAllPreclaims, setIsRefreshingAllPreclaims] = useState(false);
  const joinedTimeline = buildJoinedTimeline({
    claims,
    preclaims,
  });
  const joinedTimestamps = joinedTimeline.timestamps;
  const joinedNote = joinedTimeline.missingCount > 0
    ? `${joinedTimeline.missingCount} attendee join${joinedTimeline.missingCount === 1 ? " is" : "s are"} missing a timestamp and excluded from this chart.`
    : "";

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

  const expandedGraphConfig =
    expandedGraphTone === "claims"
      ? {
          emptyText: "No timestamped joins yet.",
          note: joinedNote,
          timestamps: joinedTimestamps,
          title: "Joined",
          tone: "claims",
          totalLabel: "Joined",
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

  const getQueueCreatedAtMs = (queuedAttendee) => {
    const createdAtValue = queuedAttendee?.createdAt;
    if (createdAtValue?.toMillis) {
      return createdAtValue.toMillis();
    }

    const numericCreatedAt = Number(createdAtValue);
    return Number.isFinite(numericCreatedAt) ? numericCreatedAt : 0;
  };

  const sortedQueueEntries = (preclaims || [])
    .slice()
    .sort((leftPreclaim, rightPreclaim) => {
      const leftIsMember = Boolean(leftPreclaim?.isMember);
      const rightIsMember = Boolean(rightPreclaim?.isMember);

      if (leftIsMember !== rightIsMember) {
        return leftIsMember ? -1 : 1;
      }

      const createdAtDifference = getQueueCreatedAtMs(leftPreclaim) - getQueueCreatedAtMs(rightPreclaim);
      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return String(leftPreclaim?.preclaimId ?? "").localeCompare(String(rightPreclaim?.preclaimId ?? ""));
    });

  const usedClaimNumbers = new Set(
    claims
      .map((claim) => Number.parseInt(claim.number, 10))
      .filter((claimNumber) => Number.isFinite(claimNumber) && claimNumber > 0),
  );
  const queueEntriesWithProjectedNumbers = [];
  let nextProjectedNumber = 1;

  const findNextProjectedNumber = () => {
    while (usedClaimNumbers.has(nextProjectedNumber)) {
      nextProjectedNumber += 1;
    }

    return nextProjectedNumber;
  };

  sortedQueueEntries.forEach((queuedAttendee) => {
    const projectedNumber = findNextProjectedNumber();

    queueEntriesWithProjectedNumbers.push({
      ...queuedAttendee,
      projectedNumber,
    });

    usedClaimNumbers.add(projectedNumber);
    nextProjectedNumber = projectedNumber + 1;
  });

  return (
    <SketchCard
      className={`entry-card compact-card roster-card sketch-entry-card${isGraphOpen ? " roster-card--with-graphs" : ""}`}
      elevation={2}
    >
      <div className="roster-card-sticky-top">
        <div className="roster-card-header">
          <div className="roster-card-title-block">
            <h2>Attendee List</h2>
            <p className="roster-card-subtitle">
              {claims.length} attendee{claims.length === 1 ? "" : "s"}
              {showPreclaimQueue ? ` • ${queueEntriesWithProjectedNumbers.length} queued` : ""}
            </p>
          </div>
          <div className="queue-corner-actions queue-corner-actions--roster">
            <SketchIconButton
              className={`secondary-button queue-corner-button${isGraphOpen ? " queue-corner-button--active" : ""}`}
              type="button"
              onClick={onToggleGraph}
              aria-label={isGraphOpen ? "Hide attendee graphs" : "Show attendee graphs"}
              title={isGraphOpen ? "Hide attendee graphs" : "Show attendee graphs"}
            >
              <ChartColumnIncreasing
                aria-hidden="true"
                className="button-icon queue-corner-button-icon queue-corner-button-icon--graph icon-animated icon-animate-rise"
              />
            </SketchIconButton>
          </div>
        </div>
        {isGraphPanelMounted ? (
          <AttendeeGraphsPanel
            claims={claims}
            joinedNote={joinedNote}
            joinedTimestamps={joinedTimestamps}
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
      </div>
      {claims.length ? (
        <div className="roster-list roster-list--attendees" role="list">
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
                  {showPreclaimQueue ? (
                    <SketchButton
                      type="button"
                      className="secondary-button roster-inline-action"
                      onClick={() => {
                        if (!onMoveClaimBackToQueueAsStaff) return;
                        const confirmMsg = `Move ${claim.displayName || "attendee"} (#${claim.number}) back to queue?`;
                        const handleMoveToQueue = () => onMoveClaimBackToQueueAsStaff(claim.claimId);

                        if (typeof onRequestConfirmation === "function") {
                          onRequestConfirmation({
                            confirmLabel: "Move to Queue",
                            message: confirmMsg,
                            onConfirm: handleMoveToQueue,
                            title: "Move attendee back to queue?",
                            tone: "default",
                          });
                          return;
                        }

                        void handleMoveToQueue();
                      }}
                      disabled={!onMoveClaimBackToQueueAsStaff}
                      title="Move back to queue"
                      aria-label={`Move ${claim.displayName || "attendee"} (#${claim.number}) back to queue`}
                    >
                      Queue
                    </SketchButton>
                  ) : null}
                  <SketchIconButton
                    type="button"
                    className="roster-remove-button"
                    onClick={() => {
                      if (!onRemoveClaim) return;
                      const confirmMsg = `Remove ${claim.displayName || 'attendee'} (#${claim.number})?`;
                      const handleRemoveClaim = () => onRemoveClaim(claim.claimId);

                      if (typeof onRequestConfirmation === "function") {
                        onRequestConfirmation({
                          confirmLabel: "Remove",
                          message: confirmMsg,
                          onConfirm: handleRemoveClaim,
                          title: "Remove attendee?",
                          tone: "danger",
                        });
                        return;
                      }

                      void handleRemoveClaim();
                    }}
                    title="Remove number"
                    aria-label={`Remove ${claim.displayName || 'attendee'} (#${claim.number})`}
                  >
                    ×
                  </SketchIconButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p>No attendees have claimed a number yet.</p>
      )}
      {showPreclaimQueue ? (
        <div className="roster-queue-section">
          <div className="roster-queue-header">
            <h3 className="queue-backlog-title">Queue</h3>
            <SketchButton
              type="button"
              className="secondary-button roster-inline-action"
              onClick={() => {
                if (!onRefreshAllPreclaimMembershipsAsStaff || isRefreshingAllPreclaims) return;
                setIsRefreshingAllPreclaims(true);
                void onRefreshAllPreclaimMembershipsAsStaff().finally(() => {
                  setIsRefreshingAllPreclaims(false);
                });
              }}
              disabled={
                !queueEntriesWithProjectedNumbers.length ||
                !onRefreshAllPreclaimMembershipsAsStaff ||
                isRefreshingAllPreclaims
              }
              title="Refresh all queued memberships"
              aria-label="Refresh all queued memberships"
            >
              {isRefreshingAllPreclaims ? "Refreshing..." : "Refresh All"}
            </SketchButton>
          </div>
          {queueEntriesWithProjectedNumbers.length ? (
            <div className="roster-list roster-list--queue" role="list">
              {queueEntriesWithProjectedNumbers.map((queuedAttendee, queueIndex) => {
                const avatarLabel = queuedAttendee.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";
                const isRefreshingCurrentPreclaim = refreshingPreclaimIds.has(queuedAttendee.preclaimId);
                return (
                  <div key={queuedAttendee.preclaimId} className="roster-row" role="listitem">
                    <div className="roster-primary">
                      <strong>#{queuedAttendee.projectedNumber}</strong>
                      <div className="roster-avatar" aria-hidden="true">
                        {queuedAttendee.avatarUrl ? (
                          <img src={queuedAttendee.avatarUrl} alt="" className="roster-avatar-image" />
                        ) : (
                          <span className="roster-avatar-fallback">{avatarLabel}</span>
                        )}
                      </div>
                      <span>{queuedAttendee.displayName || "Unknown attendee"}</span>
                    </div>
                    <div className="roster-meta">
                      <span className="roster-badge roster-badge--waiting">Queue {queueIndex + 1}</span>
                      <span
                        className={`roster-badge ${queuedAttendee.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                      >
                        {queuedAttendee.isMember ? "Member" : "Not Member"}
                      </span>
                      <SketchButton
                        type="button"
                        className="secondary-button roster-inline-action"
                        onClick={() => {
                          if (!onAssignPreclaimAsStaff) return;
                          void onAssignPreclaimAsStaff(queuedAttendee.preclaimId);
                        }}
                        title={`Assign number ${queuedAttendee.projectedNumber}`}
                        aria-label={`Assign number ${queuedAttendee.projectedNumber} to ${queuedAttendee.displayName || "attendee"}`}
                      >
                        Assign Early
                      </SketchButton>
                      <SketchButton
                        type="button"
                        className="secondary-button roster-inline-action"
                        onClick={() => {
                          if (!onRefreshPreclaimMembershipAsStaff || isRefreshingCurrentPreclaim) return;
                          setRefreshingPreclaimIds((currentIds) => {
                            const nextIds = new Set(currentIds);
                            nextIds.add(queuedAttendee.preclaimId);
                            return nextIds;
                          });
                          void onRefreshPreclaimMembershipAsStaff(queuedAttendee.preclaimId).finally(() => {
                            setRefreshingPreclaimIds((currentIds) => {
                              const nextIds = new Set(currentIds);
                              nextIds.delete(queuedAttendee.preclaimId);
                              return nextIds;
                            });
                          });
                        }}
                        disabled={!onRefreshPreclaimMembershipAsStaff || isRefreshingCurrentPreclaim}
                        title="Refresh membership"
                        aria-label={`Refresh membership for ${queuedAttendee.displayName || "attendee"}`}
                      >
                        {isRefreshingCurrentPreclaim ? "..." : "Refresh"}
                      </SketchButton>
                      <SketchIconButton
                        type="button"
                        className="roster-remove-button"
                        onClick={() => {
                          if (!onRemovePreclaimAsStaff) return;
                          const confirmMsg = `Remove ${queuedAttendee.displayName || "attendee"} from queue? This logs them out.`;
                          const handleRemovePreclaim = () =>
                            onRemovePreclaimAsStaff(queuedAttendee.preclaimId);

                          if (typeof onRequestConfirmation === "function") {
                            onRequestConfirmation({
                              confirmLabel: "Remove",
                              message: confirmMsg,
                              onConfirm: handleRemovePreclaim,
                              title: "Remove attendee from queue?",
                              tone: "danger",
                            });
                            return;
                          }

                          void handleRemovePreclaim();
                        }}
                        title="Remove from queue"
                        aria-label={`Remove ${queuedAttendee.displayName || "attendee"} from queue`}
                      >
                        ×
                      </SketchIconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p>No attendees are currently queued.</p>
          )}
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
    </SketchCard>
  );
}

function ScannerModal({ onClose, scanFeedback, scanLoading, scannerVideoRef }) {
  return (
    <div className="scanner-modal" role="dialog" aria-modal="true" aria-label="Claim scanner">
      <SketchCard
        className="scanner-modal-card sketch-modal-card"
        elevation={2}
        fill="#ffffff"
        strokeColor="#111111"
      >
        <div className="scanner-modal-header">
          <SketchIconButton
            type="button"
            className="scanner-close-button"
            onClick={onClose}
            aria-label="Close scanner"
          >
            ×
          </SketchIconButton>
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
      </SketchCard>
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
  currentTime,
  currentEventClaims,
  currentRound,
  
  isEventDetailsModalOpen,
  isEventLive,
  isEventStarted,
  isLastGroup,
  liveState,
  eventStartTimeMs,
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
  onAssignPreclaimAsStaff,
  onMoveClaimBackToQueueAsStaff,
  onRefreshAllPreclaimMembershipsAsStaff,
  onRefreshPreclaimMembershipAsStaff,
  onRemovePreclaimAsStaff,
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
  const confirmActionRef = useRef(null);
  const [confirmDialogState, setConfirmDialogState] = useState({
    confirmLabel: "Confirm",
    message: "",
    open: false,
    title: "Confirm action",
    tone: "danger",
  });
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
  const isFinalCallTimerLocked = !autoAdvanceStartRound;
  const finalCallTimerLockHint = "Turn on Next Round first to edit this timer.";
  const currentRoundClaimedCount = currentEventClaims.filter(
    (claim) => claim.redeemedRound === currentRound,
  ).length;
  const currentRoundClaimedRatio =
    totalPeopleWithNumbers > 0 ? currentRoundClaimedCount / totalPeopleWithNumbers : 0;
  const hasScheduledEventStart = Number.isFinite(eventStartTimeMs);
  const eventCountdownMs = hasScheduledEventStart
    ? Math.max(0, eventStartTimeMs - currentTime)
    : 0;
  const eventElapsedMs = hasScheduledEventStart
    ? Math.max(0, currentTime - eventStartTimeMs)
    : 0;
  const eventTimerLabel = hasScheduledEventStart
    ? (isEventStarted ? "Live For:" : "Starts In:")
    : "Status:";
  const eventTimerValue = hasScheduledEventStart
    ? formatStatusDuration(isEventStarted ? eventElapsedMs : eventCountdownMs)
    : (isEventStarted ? "Live" : "--:--");
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

  const closeConfirmDialog = () => {
    confirmActionRef.current = null;
    setConfirmDialogState((currentState) => ({
      ...currentState,
      open: false,
    }));
  };

  const openConfirmDialog = ({
    confirmLabel = "Confirm",
    message = "",
    onConfirm,
    title = "Confirm action",
    tone = "danger",
  }) => {
    confirmActionRef.current = typeof onConfirm === "function" ? onConfirm : null;
    setConfirmDialogState({
      confirmLabel,
      message,
      open: true,
      title,
      tone,
    });
  };

  const handleConfirmDialogConfirm = () => {
    const confirmAction = confirmActionRef.current;

    closeConfirmDialog();

    if (typeof confirmAction !== "function") {
      return;
    }

    Promise.resolve(confirmAction()).catch((error) => {
      console.error("Confirm dialog action failed", error);
    });
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
                <SketchIconButton
                  className="secondary-button icon-button control-side-action"
                  type="button"
                  onClick={onOpenEventDetails}
                  aria-label="Edit event details"
                  title="Edit event details"
                >
                  <SquarePen aria-hidden="true" className="button-icon icon-animated icon-animate-wiggle" />
                </SketchIconButton>
                <SketchButton
                  className="danger-button control-side-action control-side-action--text"
                  type="button"
                  onClick={() =>
                    openConfirmDialog({
                      confirmLabel: "End Event",
                      message: "This will stop the live event for everyone.",
                      onConfirm: onCloseEvent,
                      title: "End this event?",
                      tone: "danger",
                    })
                  }
                  disabled={controlSaving}
                >
                  End Event
                </SketchButton>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stats-stack">
                <SketchCard className="stat-card stat-card--compact sketch-entry-card" elevation={1}>
                  <span>Round:</span>
                  <strong>{liveState.round}</strong>
                </SketchCard>
                <SketchCard className="stat-card stat-card--compact sketch-entry-card" elevation={1}>
                  <span>{eventTimerLabel}</span>
                  <strong>{eventTimerValue}</strong>
                </SketchCard>
                <SketchCard className="stat-card stat-card--compact sketch-entry-card" elevation={1}>
                  <span>Attendees:</span>
                  <strong>{totalPeopleWithNumbers}</strong>
                </SketchCard>
              </div>
              <SketchCard className="stat-card stat-card--progress sketch-entry-card" elevation={1}>
                <span>Round Progress</span>
                <strong>{currentRoundClaimedCount}/{totalPeopleWithNumbers}</strong>
                <SketchProgress
                  className="stat-progress"
                  value={Math.max(0, Math.min(1, currentRoundClaimedRatio)) * 100}
                  min={0}
                  max={100}
                  aria-hidden="true"
                />
                <small className="stat-progress-copy">
                  {totalPeopleWithNumbers > 0
                    ? `${Math.round(currentRoundClaimedRatio * 100)}% of attendees claimed an item`
                    : "No attendees yet"}
                </small>
              </SketchCard>
            </div>

            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}

           

            <SketchCard
              className={`entry-card compact-card queue-card sketch-entry-card${isAutoAdvanceSettingsMounted ? " queue-card--settings-open" : ""}`}
              elevation={2}
            >
              <div className="queue-card-sticky-top">
                <div className="queue-corner-actions">
                  <SketchIconButton
                    className={`secondary-button queue-corner-button${isAutoAdvanceSettingsOpen ? " queue-corner-button--active" : ""}`}
                    type="button"
                    onClick={() => setIsAutoAdvanceSettingsOpen((currentValue) => !currentValue)}
                    aria-label="Auto-advance settings"
                    title="Auto-advance settings"
                  >
                    <Settings
                      aria-hidden="true"
                      className="button-icon queue-corner-button-icon queue-corner-button-icon--settings icon-animated icon-animate-spin-slow"
                    />
                  </SketchIconButton>
                  <SketchIconButton
                    className={`secondary-button queue-corner-button${autoAdvanceEnabled ? " queue-corner-button--active" : ""}`}
                    type="button"
                    onClick={onToggleAutoAdvance}
                    aria-label={autoAdvanceEnabled ? "Disable auto-advance" : "Enable auto-advance"}
                    title={autoAdvanceEnabled ? "Disable auto-advance" : "Enable auto-advance"}
                  >
                    <FastForward
                      aria-hidden="true"
                      className="button-icon queue-corner-button-icon queue-corner-button-icon--auto icon-animated icon-animate-shift"
                    />
                  </SketchIconButton>
                </div>
                <h2 className="queue-title">
                  {!liveState.finalCall ? (
                    <Users aria-hidden="true" className="title-icon icon-animated icon-animate-float" />
                  ) : null}
                  <span>{queueTitle}</span>
                </h2>
                {!isAutoAdvanceSettingsMounted && activeQueueElapsedLabel ? (
                  <p className="queue-timer">Up for {activeQueueElapsedLabel}</p>
                ) : null}
                {isAutoAdvanceSettingsMounted ? (
                  <SketchCard
                    className={`queue-auto-advance-panel sketch-entry-card${isAutoAdvanceSettingsOpen ? " queue-auto-advance-panel--open" : " queue-auto-advance-panel--closing"}`}
                    elevation={1}
                  >
                    {activeQueueElapsedLabel ? (
                      <p className="queue-timer queue-timer--panel">Up for {activeQueueElapsedLabel}</p>
                    ) : null}
                    <p className="queue-auto-advance-summary">{autoAdvanceLabel}</p>
                    <div className="queue-auto-advance-settings-grid">
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Next Group</span>
                          <SketchToggle
                            className="queue-auto-advance-toggle"
                            checked={autoAdvanceNextGroup}
                            onChange={(event) =>
                              onAutoAdvanceActionChange("autoAdvanceNextGroup", event.target.checked)
                            }
                          />
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            className={`queue-auto-advance-slider${!autoAdvanceNextGroup ? " queue-auto-advance-slider--inactive" : ""}`}
                            min={10}
                            max={100}
                            step={1}
                            value={autoAdvanceThresholdPercent}
                            onChange={(event) => {
                              if (!autoAdvanceNextGroup) {
                                return;
                              }

                              onAutoAdvanceThresholdChange(event.target.value);
                            }}
                            aria-disabled={!autoAdvanceNextGroup}
                          />
                          <span>{autoAdvanceThresholdPercent}%</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          After this claimed threshold is reached, move to the next normal group.
                        </span>
                      </SketchCard>
                      {actionOptions.map((option) => (
                        <SketchCard
                          key={option.field}
                          className="queue-auto-advance-setting-card sketch-entry-card"
                          elevation={1}
                          fill="#ffffff"
                          strokeColor="#111111"
                        >
                          <label className="queue-auto-advance-setting-topline">
                            <span className="queue-auto-advance-setting-title">{option.label}</span>
                            <SketchToggle
                              className="queue-auto-advance-toggle"
                              checked={option.checked}
                              onChange={(event) =>
                                onAutoAdvanceActionChange(option.field, event.target.checked)
                              }
                            />
                          </label>
                          <span className="queue-auto-advance-setting-copy">{option.description}</span>
                        </SketchCard>
                      ))}
                      <SketchCard
                        key={isFinalCallTimerLocked ? "final-call-timer-locked" : "final-call-timer-unlocked"}
                        className={`queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card${isFinalCallTimerLocked ? " queue-auto-advance-setting-card--locked" : ""}`}
                        elevation={1}
                        fill={isFinalCallTimerLocked ? "#f2f2f2" : "#ffffff"}
                        strokeColor="#111111"
                        data-lock-hint={isFinalCallTimerLocked ? finalCallTimerLockHint : undefined}
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Final Call Timer</span>
                          <SketchToggle
                            key={isFinalCallTimerLocked ? "final-call-toggle-locked" : "final-call-toggle-unlocked"}
                            className={`queue-auto-advance-toggle${isFinalCallTimerLocked ? " queue-auto-advance-toggle--dimmed queue-auto-advance-toggle--inactive" : ""}`}
                            checked={autoAdvanceFinalCallTimerEnabled}
                            onChange={(event) => {
                              if (isFinalCallTimerLocked) {
                                return;
                              }

                              onAutoAdvanceActionChange(
                                "autoAdvanceFinalCallTimerEnabled",
                                event.target.checked,
                              );
                            }}
                            aria-disabled={isFinalCallTimerLocked}
                          />
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            key={`${isFinalCallTimerLocked ? "locked" : "unlocked"}-${autoAdvanceFinalCallTimerEnabled ? "enabled" : "disabled"}`}
                            className={`queue-auto-advance-slider${(!autoAdvanceStartRound || !autoAdvanceFinalCallTimerEnabled) ? " queue-auto-advance-slider--inactive" : ""}`}
                            min={1}
                            max={10}
                            step={1}
                            value={autoAdvanceFinalCallTimerMinutes}
                            onChange={(event) => {
                              if (!autoAdvanceStartRound || !autoAdvanceFinalCallTimerEnabled) {
                                return;
                              }

                              onAutoAdvanceTimerMinutesChange(event.target.value);
                            }}
                            aria-disabled={!autoAdvanceStartRound || !autoAdvanceFinalCallTimerEnabled}
                          />
                          <span>min</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          During final call, force next round after this timer even if threshold was not met.
                        </span>
                      </SketchCard>
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">People Per Group</span>
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            className="queue-auto-advance-slider"
                            min={1}
                            max={20}
                            step={1}
                            value={groupSize}
                            onChange={(event) => onGroupSizeChange(event.target.value)}
                          />
                          <span>{groupSize} {groupSize === 1 ? "person" : "people"}</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          Sets how many attendees are included when the next group starts. Current groups stay unchanged.
                        </span>
                      </SketchCard>
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Backlog Limit</span>
                          <SketchToggle
                            className="queue-auto-advance-toggle"
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
                          <SketchSlider
                            className={`queue-auto-advance-slider${!autoAdvanceBacklogLimitEnabled ? " queue-auto-advance-slider--inactive" : ""}`}
                            min={1}
                            max={20}
                            step={1}
                            value={autoAdvanceBacklogLimit}
                            onChange={(event) => {
                              if (!autoAdvanceBacklogLimitEnabled) {
                                return;
                              }

                              onAutoAdvanceBacklogLimitChange(event.target.value);
                            }}
                            aria-disabled={!autoAdvanceBacklogLimitEnabled}
                          />
                          <span>max waiting</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          Pause auto-advance when too many earlier numbers are still waiting.
                        </span>
                      </SketchCard>
                    </div>
                  </SketchCard>
                ) : null}
                <div className="queue-primary-action-wrap">
                  <SketchButton
                    className={`control-primary-action queue-primary-action${primaryQueueAction.isReady ? " ready-button" : ""}`}
                    type="button"
                    onClick={primaryQueueAction.onClick}
                    disabled={primaryQueueAction.disabled}
                  >
                    {primaryQueueAction.label}
                  </SketchButton>
                </div>
                {queueDescription ? <p>{queueDescription}</p> : null}
              </div>
              <div className="queue-card-body">
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
                          <SketchButton
                            className="secondary-button queue-backlog-toggle"
                            type="button"
                            onClick={() => setIsBacklogOpen((currentValue) => !currentValue)}
                          >
                            {isBacklogOpen ? "Hide" : "Show"} Backlog ({backlogClaims.length})
                          </SketchButton>
                        </div>
                        {isBacklogOpen ? <BacklogList claims={backlogClaims} /> : null}
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </SketchCard>

            <FullRoster
              claims={currentEventClaims}
              isGraphOpen={isAttendeeGraphOpen}
              onToggleGraph={() => setIsAttendeeGraphOpen((currentValue) => !currentValue)}
              onRequestConfirmation={openConfirmDialog}
              preclaims={preclaims}
              onAssignPreclaimAsStaff={onAssignPreclaimAsStaff}
              onMoveClaimBackToQueueAsStaff={onMoveClaimBackToQueueAsStaff}
              onRefreshAllPreclaimMembershipsAsStaff={onRefreshAllPreclaimMembershipsAsStaff}
              onRefreshPreclaimMembershipAsStaff={onRefreshPreclaimMembershipAsStaff}
              onRemovePreclaimAsStaff={onRemovePreclaimAsStaff}
              onRemoveClaim={onRemoveClaim}
              showPreclaimQueue={showPreclaimQueue}
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
        <SketchCard className="bottom-navbar sketch-navbar-card" elevation={1} strokeColor="#111111">
          <SketchButton
            className="bottom-navbar-button"
            type="button"
            onClick={onOpenScanner}
            disabled={scanLoading || !isEventLive}
          >
            <ScanLine aria-hidden="true" className="button-icon icon-animated icon-animate-scan" />
            <span>Open Scanner</span>
          </SketchButton>
          <SketchButton className="secondary-button bottom-navbar-button" type="button" onClick={onOpenDisplayScreen}>
            <Monitor aria-hidden="true" className="button-icon icon-animated icon-animate-pulse" />
            <span>Open Display</span>
          </SketchButton>
        </SketchCard>
      ) : (
        <SketchCard className="bottom-navbar sketch-navbar-card" elevation={1} strokeColor="#111111">
          <SketchButton className="secondary-button bottom-navbar-button" onClick={onHandleLogout}>
            Logout
          </SketchButton>
        </SketchCard>
      )}
      <SketchDialog className="sketch-confirm-dialog" open={confirmDialogState.open} onClose={closeConfirmDialog}>
        <div className="confirm-dialog-content">
          <h3 className="confirm-dialog-title">{confirmDialogState.title}</h3>
          {confirmDialogState.message ? (
            <p className="confirm-dialog-copy">{confirmDialogState.message}</p>
          ) : null}
          <div className="confirm-dialog-actions">
            <SketchButton type="button" className="secondary-button" onClick={closeConfirmDialog}>
              Cancel
            </SketchButton>
            <SketchButton
              type="button"
              className={confirmDialogState.tone === "danger" ? "danger-button" : ""}
              onClick={handleConfirmDialogConfirm}
            >
              {confirmDialogState.confirmLabel}
            </SketchButton>
          </div>
        </div>
      </SketchDialog>
    </div>
  );
}

export default ControlPage;
