import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import rough from "roughjs/bin/rough";
import {
  ChartColumnIncreasing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Expand,
  ExternalLink,
  FastForward,
  FlaskConical,
  GripVertical,
  History,
  Info,
  Monitor,
  PartyPopper,
  Pause,
  Play,
  Plus,
  QrCode,
  ScanLine,
  Settings,
  SquarePen,
  Ticket,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import {
  SketchButton,
  SketchCard,
  SketchDialog,
  SketchDivider,
  SketchCombo,
  SketchIconButton,
  SketchInput,
  SketchMessageDialog,
  SketchProgress,
  SketchSearchInput,
  SketchSlider,
  SketchTextarea,
  SketchToggle,
  SketchVerticalDivider,
} from "./SketchUI";
import { RosterRowActions } from "./RosterRowActions";
import ScrollFade from "./ScrollFade";
import HeaderActionsMenu from "./HeaderActionsMenu";
import { getEventTitleClassName, TITLE_FONT_OPTIONS } from "../titleFonts";
import { getAvatarColors } from "../avatarColors";
import { DEMO_LIMITS } from "../demoEvent";
import { defaultQrUrl, getTimestampMs } from "../eventState";
import { formatElapsedDuration } from "../eventSchedule";
import {
  formatClaimNumber,
  isStaffClaim,
  partitionStaffClaims,
  projectQueueNumbers,
} from "../staffNumbers";
import { hasClaimedInRound } from "../backtrack";
import {
  buildBacktrackConfirmSkippedKey,
  buildQueuePanelOpenKey,
  readStoredBoolean,
  readStoredBooleanOrDefault,
} from "../claimSession";
import {
  getStaffWalkthroughPages,
  hasSeenStaffWalkthrough,
  markStaffWalkthroughSeen,
  resolveStaffWalkthroughRole,
  STAFF_WALKTHROUGH_ROLE,
} from "../staffWalkthrough";
import {
  normalizeRaffleMemberChances,
  RAFFLE_MEMBER_CHANCES_MAX,
  RAFFLE_MEMBER_CHANCES_MIN,
  RAFFLE_PHASE,
} from "../raffle";
import useRaffleSpin from "../useRaffleSpin";
import useAdvanceCooldown from "../useAdvanceCooldown";
import useScrollLock from "../useScrollLock";
import useScrollEdges from "../useScrollEdges";
import useIsNarrowViewport from "../useIsNarrowViewport";
import useCameraBackdropTone from "../useCameraBackdropTone";
import useFitTitleToRow from "../useFitTitleToRow";
import Spinner from "./Spinner";
import StatusMark from "./StatusMark";
import { NAVBAR_ACTION_WIDEST_LABEL } from "../navbarAction";

/* The demo colour. Shared by the create-form panel and the live banner, so a
   demo event reads the same before it starts as it does while it runs. */
const DEMO_PANEL_FILL = "#fff6e5";

const AUTO_SETTINGS_ANIMATION_MS = 180;
const GRAPH_PANEL_ANIMATION_MS = 180;
/*
 * How many rows any one of this panel's lists puts on screen at once.
 *
 * Every row here is drawn rather than styled: a row is a wired-card, a nested
 * wired-card for each badge, and two or three wired-buttons on the end — five
 * or so custom elements, each generating its own rough.js geometry and holding
 * a resize observer. That is fine for twenty of them and not fine for three
 * hundred, which is what the queue holds before the doors open on a full event.
 *
 * The attendee roster has always paged. The queue, the backlog and the final
 * call list rendered every row they were given, which is how a busy event
 * turned the control panel into something staff could not scroll.
 */
const ROSTER_PAGE_SIZE = 20;
/* Below this, the queue card is not wide enough to show the current-group
   and backlog lists side by side — same width the display page falls back
   to a single column at. */
const QUEUE_PANEL_SPLIT_BREAKPOINT_PX = 900;
/*
 * The width below which the header's circle buttons fold into one "..."
 * circle — see HeaderActionsMenu.
 *
 * Mirrored by the same breakpoint in App.css, where .control-actions--header is
 * already allowed to wrap: that wrap is what this replaces. Past this point the
 * lockup on the left plus six buttons on the right is more than the header row
 * can hold, and dropping the buttons onto a second line pushes the whole page
 * down to say what one circle can say in place. It moves with the number of
 * circles — a circle and its gap is roughly 60px of it.
 */
const HEADER_ACTIONS_COLLAPSE_BREAKPOINT_PX = 620;
/*
 * The width below which the navbar's third seat and the "..." menu trade
 * entries: the seat holds the staff member's own QR code, and Display drops
 * into the menu.
 *
 * Same width the navbar gives up its labels at (App.css, the phone tier), and
 * for the same reason — this is the tier where the app is being run from a
 * phone. Staff on a phone are walking the room with their own code in hand and
 * hardly ever open the display; the person putting the display on a projector
 * is at a laptop, where the seat holds Display exactly as it always has.
 * Neither action goes away at either width, they just swap places.
 */
const NAVBAR_SELF_CLAIM_BREAKPOINT_PX = 430;
/*
 * The width below which each chart's expand button is not rendered at all.
 *
 * The modal is a card inside a near-edge-to-edge backdrop, so on a phone it
 * hands back a chart the same width as the one already on the page: a button
 * that costs a tap to show the same thing. The two-column graph grid has
 * already collapsed to one column by here (App.css, same width), which is
 * where the tile stops being the smaller of the two.
 */
const GRAPH_EXPAND_BREAKPOINT_PX = 640;
const GRAPH_CHART_WIDTH = 760;
const GRAPH_CHART_HEIGHT = 250;
/* Tight into the bottom-left corner: just enough room for the tick labels,
   which are 24px in this viewBox and sit outside the axes. */
const GRAPH_CHART_PADDING = { top: 14, right: 14, bottom: 38, left: 42 };

/**
 * One page of a list, and the controls to move between pages.
 *
 * Shared by all four lists on this panel so they page identically. `items` is
 * the already-filtered, already-sorted array; the caller renders whatever comes
 * back in `pageItems`.
 *
 * The clamp matters as much as the slice: removing an attendee, or a filter
 * narrowing, can leave the stored page index past the end of the list, and this
 * is read during render rather than corrected in an effect so there is never a
 * frame showing an empty page that a re-render then fixes.
 */
function useListPage(items) {
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / ROSTER_PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageItems = useMemo(
    () => items.slice(safePageIndex * ROSTER_PAGE_SIZE, (safePageIndex + 1) * ROSTER_PAGE_SIZE),
    [items, safePageIndex],
  );

  return {
    firstShown: items.length === 0 ? 0 : safePageIndex * ROSTER_PAGE_SIZE + 1,
    lastShown: Math.min(items.length, (safePageIndex + 1) * ROSTER_PAGE_SIZE),
    pageCount,
    pageIndex: safePageIndex,
    pageItems,
    setPageIndex,
    total: items.length,
  };
}

/** The pager itself. Renders nothing when everything fits on one page. */
function ListPager({ label, page }) {
  if (page.pageCount <= 1) {
    return null;
  }

  return (
    <div className="roster-pagination" role="group" aria-label={label}>
      <SketchIconButton
        className="secondary-button roster-pagination-button"
        type="button"
        onClick={() => page.setPageIndex((current) => Math.max(0, current - 1))}
        disabled={page.pageIndex === 0}
        aria-label={`Previous page of ${label}`}
        title="Previous page"
      >
        <ChevronLeft aria-hidden="true" className="button-icon" />
      </SketchIconButton>
      <span className="roster-pagination-range" aria-live="polite">
        {page.firstShown}
        {"–"}
        {page.lastShown}
        {" of "}
        {page.total}
      </span>
      <SketchIconButton
        className="secondary-button roster-pagination-button"
        type="button"
        onClick={() =>
          page.setPageIndex((current) => Math.min(page.pageCount - 1, current + 1))
        }
        disabled={page.pageIndex >= page.pageCount - 1}
        aria-label={`Next page of ${label}`}
        title="Next page"
      >
        <ChevronRight aria-hidden="true" className="button-icon" />
      </SketchIconButton>
    </div>
  );
}

function formatGraphTimeLabel(timestampMs) {
  if (!Number.isFinite(timestampMs)) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
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

/** One rule per line, but always at least one row to type into. */
function splitClaimRules(claimRulesText) {
  const rules = String(claimRulesText ?? "").split("\n");

  return rules.length ? rules : [""];
}

/*
 * A setting slider that saves the value it is let go on.
 *
 * These sliders write to the live event, and the event document is subscribed
 * to by every display and every attendee's ticket. wired-slider reports each
 * step of a drag, so People Per Group dragged from 1 to 20 meant twenty writes
 * fanned out to the room — and twenty chances for two staff panels to land on
 * the same document at once.
 *
 * The reading beside the slider still follows the drag, off a draft held here.
 * Only the value the drag ends on is saved. The draft gives way whenever the
 * saved value changes underneath it, so a setting moved on another panel still
 * shows up here.
 *
 * `inactive` is for a slider whose feature is switched off. It stays draggable,
 * because the toggle beside it says plainly enough that nothing is listening,
 * but neither the reading nor the saved value moves.
 */
function SettingSlider({
  className = "queue-auto-advance-slider",
  formatValue,
  inactive = false,
  max,
  min,
  onCommit,
  step = 1,
  value,
  ...sliderProps
}) {
  const [draftValue, setDraftValue] = useState(value);
  const savedValueRef = useRef(value);

  if (savedValueRef.current !== value) {
    savedValueRef.current = value;
    setDraftValue(value);
  }

  return (
    <div className="queue-auto-advance-inline-control">
      <SketchSlider
        {...sliderProps}
        className={inactive ? `${className} queue-auto-advance-slider--inactive` : className}
        aria-disabled={inactive || undefined}
        min={min}
        max={max}
        step={step}
        value={draftValue}
        onChange={(event) => {
          if (inactive) {
            return;
          }

          setDraftValue(Number(event.target.value));
        }}
        onCommit={(event) => {
          if (inactive) {
            return;
          }

          onCommit(event.target.value);
        }}
      />
      <span>{formatValue(draftValue)}</span>
    </div>
  );
}

function EventDetailsModal({
  controlForm,
  controlMessage,
  controlSaving,
  demoStatus,
  isDemoEvent = false,
  isDemoPaused = false,
  isEventLive,
  isKeepScreenAwakeSupported = false,
  onClose,
  onFetchLatestAnnouncement,
  onFieldChange,
  onSubmit,
  onToggleDemoPaused,
}) {
  const [isLookingUpAnnouncement, setIsLookingUpAnnouncement] = useState(false);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const hasRequestedAnnouncementRef = useRef(false);
  /*
   * Cleared on unmount only.
   *
   * A per-run `cancelled` flag looks equivalent but is not: this effect's
   * dependencies change on re-render, so its cleanup fired while the lookup was
   * still in flight and the result was always thrown away — leaving the field
   * stuck on its loading dots.
   *
   * Set on every mount, not just at creation: StrictMode's dev mount/unmount/
   * remount runs the cleanup against a ref that survives it, so a mount-only
   * initial value stays false for the rest of the modal's life.
   */
  const isMountedRef = useRef(true);
  // Read inside the async callback without making it a dependency.
  const currentUrlRef = useRef(controlForm.qrUrl);

  currentUrlRef.current = controlForm.qrUrl;
  const contentRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const syncScrollHint = () => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const remaining = content.scrollHeight - content.scrollTop - content.clientHeight;
    setHasMoreBelow(remaining > 8);
  };

  const handleContentScroll = syncScrollHint;

  // The form's height depends on the rules list and on fonts settling, so
  // measure after layout rather than on first paint.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return undefined;
    }

    syncScrollHint();

    const frameId = window.requestAnimationFrame(syncScrollHint);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncScrollHint) : null;

    observer?.observe(content);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
    };
  });
  const parsedMemberCheckInLeadMinutes = Number.parseInt(controlForm.memberCheckInLeadMinutes, 10);
  const memberCheckInLeadMinutes = Number.isFinite(parsedMemberCheckInLeadMinutes)
    ? Math.max(0, Math.min(60, parsedMemberCheckInLeadMinutes))
    : 15;
  const memberCheckInLabel = `${memberCheckInLeadMinutes} minute${memberCheckInLeadMinutes === 1 ? "" : "s"}`;
  const isDemo = controlForm.isDemo === true;
  // Unset on a form built from a live event, where this never renders anyway.
  const keepScreenAwake = controlForm.keepScreenAwake !== false;
  const displayFeedEnabled = controlForm.displayFeedEnabled !== false;
  const readDemoNumber = (field, limits) => {
    const parsedValue = Number.parseInt(controlForm[field], 10);

    return Number.isFinite(parsedValue)
      ? Math.max(limits.min, Math.min(limits.max, parsedValue))
      : limits.min;
  };
  const demoParticipantCount = readDemoNumber(
    "demoParticipantCount",
    DEMO_LIMITS.participantCount,
  );
  const demoMemberPercent = readDemoNumber("demoMemberPercent", DEMO_LIMITS.memberPercent);
  const demoPreStartPercent = readDemoNumber("demoPreStartPercent", DEMO_LIMITS.preStartPercent);
  const demoPickupChancePercent = readDemoNumber(
    "demoPickupChancePercent",
    DEMO_LIMITS.pickupChancePercent,
  );
  const demoMemberCount = Math.round((demoParticipantCount * demoMemberPercent) / 100);
  const demoPreStartCount = Math.round((demoParticipantCount * demoPreStartPercent) / 100);
  const fallbackTitleFont = TITLE_FONT_OPTIONS[0]?.value || "londrina-shadow";
  const selectedTitleFont = TITLE_FONT_OPTIONS.some((option) => option.value === controlForm.titleFont)
    ? controlForm.titleFont
    : fallbackTitleFont;
  const eventTitleInputClassName = `event-modal-title-input event-title--${selectedTitleFont}`;

  // Rules are edited one per row but stored as the newline-joined string the
  // rest of the app (and the security rules) already expect.
  const claimRules = splitClaimRules(controlForm.claimRulesText);
  const commitRules = (nextRules) =>
    onFieldChange("claimRulesText")({ target: { value: nextRules.join("\n") } });
  const updateRule = (index, value) =>
    commitRules(
      claimRules.map((rule, ruleIndex) =>
        // Collapse any pasted newlines: one rule is one line.
        ruleIndex === index ? value.replace(/[\r\n]+/g, " ") : rule,
      ),
    );
  const addRule = () => commitRules([...claimRules, ""]);
  const addRuleAfter = (index) => {
    const nextRules = [...claimRules];
    nextRules.splice(index + 1, 0, "");
    commitRules(nextRules);
  };

  const moveRule = (fromIndex, toIndex) => {
    if (
      fromIndex === null ||
      toIndex === null ||
      fromIndex === toIndex ||
      toIndex < 0 ||
      toIndex >= claimRules.length
    ) {
      return;
    }

    const nextRules = [...claimRules];
    const [movedRule] = nextRules.splice(fromIndex, 1);

    nextRules.splice(toIndex, 0, movedRule);
    commitRules(nextRules);
  };

  // Reorder as the pointer passes over a row rather than on drop, so the list
  // shows where the rule will land.
  const handleRowDragOver = (index) => {
    if (draggingIndex === null || draggingIndex === index) {
      return;
    }

    moveRule(draggingIndex, index);
    setDraggingIndex(index);
  };

  // Dragging is unusable from a keyboard, so the handle also takes arrow keys.
  const handleGripKeyDown = (event, index) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    moveRule(index, event.key === "ArrowUp" ? index - 1 : index + 1);
  };
  const removeRule = (index) =>
    commitRules(claimRules.filter((_, ruleIndex) => ruleIndex !== index));

  const trimmedUrl = (controlForm.qrUrl || "").trim();
  const isOpenableUrl = /^https?:\/\//i.test(trimmedUrl);
  const openBookList = () => {
    if (isOpenableUrl) {
      window.open(trimmedUrl, "_blank", "noopener,noreferrer");
    }
  };

  /*
   * Creating an event prefills the book list with the newest announcement,
   * which is almost always the one being handed out.
   *
   * Only when creating — editing a live event must never overwrite a URL staff
   * chose — and only while the field still holds the default, so anything typed
   * (including while the lookup is in flight) wins.
   *
   * The field shows animated dots meanwhile. Nothing else reports on the lookup:
   * whether it finds a post, finds nothing or cannot reach the site, the field
   * ends up holding either that post's URL or the default announcements page,
   * which is a usable answer in its own right and needs no explaining.
   */
  useEffect(() => {
    if (isEventLive || hasRequestedAnnouncementRef.current) {
      return undefined;
    }

    hasRequestedAnnouncementRef.current = true;

    setIsLookingUpAnnouncement(true);

    onFetchLatestAnnouncement()
      .then((announcement) => {
        if (!isMountedRef.current) {
          return;
        }

        if (announcement?.url && currentUrlRef.current === defaultQrUrl) {
          onFieldChange("qrUrl")({ target: { value: announcement.url } });
        }

        setIsLookingUpAnnouncement(false);
      })
      .catch(() => {
        if (isMountedRef.current) {
          setIsLookingUpAnnouncement(false);
        }
      });

    return undefined;
  }, [isEventLive, onFetchLatestAnnouncement, onFieldChange]);

  /*
   * Typing during the lookup reveals the field again: what they type is the
   * value from then on, and the dots would otherwise sit over it.
   */
  const handleQrUrlChange = (event) => {
    setIsLookingUpAnnouncement(false);
    onFieldChange("qrUrl")(event);
  };

  return (
    <SketchDialog
      className="event-details-dialog"
      open
      onClose={onClose}
      elevation={2}
      role="dialog"
      aria-modal="true"
      aria-label="Event details"
    >
      <div className="event-modal">
        <div className="event-modal-header">
          <h2 className="event-modal-heading">
            {isEventLive ? "Edit Event Details" : "Create Event"}
          </h2>
          <SketchIconButton
            type="button"
            className="timeline-chart-close timeline-chart-close--modal"
            onClick={onClose}
            aria-label={isEventLive ? "Close event details" : "Cancel creating an event"}
            title={isEventLive ? "Close event details" : "Cancel creating an event"}
          >
            <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
          </SketchIconButton>
        </div>
        <div className="event-modal-content" ref={contentRef} onScroll={handleContentScroll}>
          <form className="control-form event-modal-form" onSubmit={onSubmit}>
            <div className="title-grid">
              <label className="control-input-group control-input-group--centered">
                <span>Event Title</span>
                <SketchInput
                  className={eventTitleInputClassName}
                  type="text"
                  value={controlForm.title}
                  onChange={onFieldChange("title")}
                  placeholder="Event Name Here..."
                  autoComplete="off"
                />
              </label>
              <label className="control-input-group control-input-group--centered control-input-group--compact title-font-select">
                <span>Event Title Font</span>
                {/* fullWidth so the drawn box fills the styled width instead of
                    hugging its text: without it the outline and the drop arrow
                    are placed from the text's own measured width, and the arrow
                    lands on top of a longer font name. */}
                <SketchCombo
                  className="title-font-combo"
                  fullWidth
                  selected={selectedTitleFont}
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
            <div className="control-input-group event-modal-url-group">
              <div className="event-modal-url-row">
                {/* Inside the grid so it centres over the field, not over the
                    field plus the two buttons beside it. */}
                <span className="event-modal-url-label">Book List URL</span>
                <SketchInput
                  className="event-modal-default-input event-modal-url-input"
                  type="url"
                  value={isLookingUpAnnouncement ? "" : controlForm.qrUrl}
                  onChange={handleQrUrlChange}
                  placeholder={isLookingUpAnnouncement ? "" : "Enter QR code destination"}
                />
                {/* Same grid cell as the field, so the dots sit where its text
                    will appear. Non-interactive: the field underneath still
                    takes focus and typing. */}
                {isLookingUpAnnouncement ? (
                  <span
                    className="event-modal-url-loading"
                    role="status"
                    aria-label="Looking up the latest announcement"
                  >
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                  </span>
                ) : null}
                <div className="field-row-trailing">
                  <SketchIconButton
                    type="button"
                    className="secondary-button event-modal-url-open"
                    onClick={openBookList}
                    disabled={!isOpenableUrl}
                    aria-label="Open the book list in a new tab"
                    title={isOpenableUrl ? "Open the book list in a new tab" : "Enter a valid URL first"}
                  >
                    <ExternalLink aria-hidden="true" className="button-icon" />
                  </SketchIconButton>
                </div>
              </div>
            </div>
            <div className="control-input-group event-modal-claim-rules-group">
              <span>Claim Rules</span>
              <small className="control-input-hint rules-editor-hint">
                Shown in the attendee rules modal before they start.
              </small>
              <div className="rules-editor">
                {claimRules.map((rule, index) => (
                  <div
                    className={`rules-editor-row${draggingIndex === index ? " rules-editor-row--dragging" : ""}`}
                    key={`rule-${index}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      handleRowDragOver(index);
                    }}
                    onDrop={(event) => event.preventDefault()}
                  >
                    <span className="rules-editor-number" aria-hidden="true">{index + 1}</span>
                    <SketchTextarea
                      autoGrow
                      className="event-modal-default-input rules-editor-input"
                      rows={1}
                      maxrows={8}
                      value={rule}
                      onChange={(event) => updateRule(index, event.target.value)}
                      onKeyDown={(event) => {
                        // Rules are stored one per line, so a newline inside one
                        // would split it. Enter starts the next rule instead.
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          addRuleAfter(index);
                        }
                      }}
                      placeholder={`Rule ${index + 1}`}
                      aria-label={`Claim rule ${index + 1}`}
                    />
                    <div className="field-row-trailing">
                    <SketchButton
                      type="button"
                      className="secondary-button rules-editor-grip"
                      draggable
                      onDragStart={(event) => {
                        setDraggingIndex(index);
                        // Firefox will not start a drag without payload.
                        event.dataTransfer.setData("text/plain", String(index));
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggingIndex(null)}
                      onKeyDown={(event) => handleGripKeyDown(event, index)}
                      aria-label={`Reorder rule ${index + 1}. Use the up and down arrow keys.`}
                      title="Drag to reorder"
                    >
                      <GripVertical aria-hidden="true" className="rules-editor-grip-icon" />
                    </SketchButton>
                    <SketchIconButton
                      type="button"
                      className="roster-remove-button rules-editor-remove"
                      onClick={() => removeRule(index)}
                      disabled={claimRules.length <= 1}
                      aria-label={`Remove claim rule ${index + 1}`}
                      title={claimRules.length <= 1 ? "Keep at least one rule" : "Remove this rule"}
                    >
                      <span className="roster-remove-glyph" aria-hidden="true">×</span>
                    </SketchIconButton>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rules-editor-actions">
                <SketchButton type="button" className="secondary-button" onClick={addRule}>
                  <div className="bottom-navbar-content">
                    <Plus aria-hidden="true" className="button-icon" />
                    <span>Add Rule</span>
                  </div>
                </SketchButton>
              </div>
            </div>
            <div className="time-grid time-grid--centered time-grid--event-details">
              {/* Paired so the two together span the field column: start opens
                  at its left edge and end closes on its right, in line with
                  every other box in the form. */}
              <div className="event-modal-time-pair">
                <label className="control-input-group control-input-group--centered control-input-group--time">
                  <span>Start Time</span>
                  <SketchInput
                    className="event-modal-default-input"
                    type="time"
                    value={controlForm.timeframeStart}
                    onChange={onFieldChange("timeframeStart")}
                  />
                </label>
                <label className="control-input-group control-input-group--centered control-input-group--time">
                  <span>End Time</span>
                  <SketchInput
                    className="event-modal-default-input"
                    type="time"
                    value={controlForm.timeframeEnd}
                    onChange={onFieldChange("timeframeEnd")}
                  />
                </label>
              </div>
              <label className="control-input-group control-input-group--centered control-input-group--time control-input-group--time-slider">
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
                  <span className="event-member-checkin-value">
                    {memberCheckInLabel} before event start
                  </span>
                </div>
              </label>
            </div>
            {/*
              Both creating and editing, unlike the two boxes below it: this one
              is event data rather than a decision fixed at creation, so a room
              that turns out to be the wrong place for names on a projector can
              be dealt with mid-event from Edit Event Details.
            */}
            <div className="control-input-group event-modal-feed-group">
              <SketchCard
                className="event-modal-feed-card sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title event-modal-feed-title">
                    <Monitor aria-hidden="true" className="button-icon" />
                    <span>Show the Activity Feed on the Display</span>
                  </span>
                  <SketchToggle
                    className="queue-auto-advance-toggle"
                    checked={displayFeedEnabled}
                    onChange={(event) =>
                      onFieldChange("displayFeedEnabled")({
                        target: { value: event.target.checked },
                      })
                    }
                  />
                </label>
                <span className="queue-auto-advance-setting-copy">
                  The running list in the bottom-left corner of the display, naming
                  people as they check in and pick up items. Turning it off leaves
                  the rest of the display exactly as it is — and it is the only
                  place there that shows attendee names and pictures.
                </span>
              </SketchCard>
            </div>
            {/*
              Running demo only. The pause is the difference between watching a
              demo and being able to inspect one: without it a called group
              clears itself while you are still reading it. It lives here rather
              than on a banner across the panel, which cost a row of the roster
              for a control that is touched twice a run.
            */}
            {isEventLive && isDemoEvent ? (
              <div className="control-input-group event-modal-demo-group">
                <SketchCard
                  className="event-modal-demo-card sketch-entry-card"
                  elevation={1}
                  fill={DEMO_PANEL_FILL}
                  strokeColor="#111111"
                >
                  <span className="queue-auto-advance-setting-title event-modal-demo-title">
                    <FlaskConical aria-hidden="true" className="button-icon" />
                    <span>Demo Event</span>
                  </span>
                  <span className="queue-auto-advance-setting-copy">
                    {demoStatus
                      || (isDemoPaused
                        ? "Paused. Nobody new will join and nobody will pick up an item until you resume."
                        : "Fake attendees are joining and picking up items on their own. Nothing here is saved to Past Events.")}
                  </span>
                  <SketchButton
                    type="button"
                    className={`secondary-button event-modal-demo-button${isDemoPaused ? " queue-corner-button--active" : ""}`}
                    onClick={onToggleDemoPaused}
                    disabled={!onToggleDemoPaused}
                  >
                    <div className="bottom-navbar-content">
                      {isDemoPaused ? (
                        <Play aria-hidden="true" className="button-icon" />
                      ) : (
                        <Pause aria-hidden="true" className="button-icon" />
                      )}
                      <span>{isDemoPaused ? "Resume Demo" : "Pause Demo"}</span>
                    </div>
                  </SketchButton>
                </SketchCard>
              </div>
            ) : null}
            {/*
              Creating only, and only where the browser can actually hold the
              lock — the header's toggle is disabled in the browsers that cannot,
              and a tickbox that quietly does nothing is worse than no tickbox.

              On by default because the machine running an event is the one
              nobody touches for two hours: the projector display and this panel
              both go dark on the OS screensaver mid-round unless something holds
              them. The copy points at the header because that is where the
              preference lives from here on — this box only sets it once, and
              staff who find the screen too bright need to know where to go.
            */}
            {!isEventLive && isKeepScreenAwakeSupported ? (
              <div className="control-input-group event-modal-awake-group">
                <SketchCard
                  className="event-modal-awake-card sketch-entry-card"
                  elevation={1}
                  fill="#ffffff"
                  strokeColor="#111111"
                >
                  <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                    <span className="queue-auto-advance-setting-title event-modal-awake-title">
                      <Coffee aria-hidden="true" className="button-icon" />
                      <span>Keep Screens Awake During the Event</span>
                    </span>
                    <SketchToggle
                      className="queue-auto-advance-toggle"
                      checked={keepScreenAwake}
                      onChange={(event) =>
                        onFieldChange("keepScreenAwake")({
                          target: { value: event.target.checked },
                        })
                      }
                    />
                  </label>
                  <span className="queue-auto-advance-setting-copy">
                    Stops this screen and the display from sleeping while the event
                    runs. You can turn it off at any time with the cup button at the
                    top right of the header, or under “...” there if the header is
                    narrow.
                  </span>
                </SketchCard>
              </div>
            ) : null}
            {/*
              Creating only. Whether an event is a demo decides whether its
              attendee list is kept when it closes, so letting it be flipped
              halfway through would leave the record ambiguous.
            */}
            {!isEventLive ? (
              <div className="control-input-group event-modal-demo-group">
                <SketchCard
                  className="event-modal-demo-card sketch-entry-card"
                  elevation={1}
                  fill={DEMO_PANEL_FILL}
                  strokeColor="#111111"
                >
                  <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                    <span className="queue-auto-advance-setting-title event-modal-demo-title">
                      <FlaskConical aria-hidden="true" className="button-icon" />
                      <span>Run as a Demo Event</span>
                    </span>
                    <SketchToggle
                      className="queue-auto-advance-toggle"
                      checked={isDemo}
                      onChange={(event) =>
                        onFieldChange("isDemo")({ target: { value: event.target.checked } })
                      }
                    />
                  </label>
                  <span className="queue-auto-advance-setting-copy">
                    Fills the event with fake attendees who join and pick up items on
                    their own, so you can rehearse a run. Nothing from a demo is saved
                    to Past Events.
                  </span>
                  {/* The same two-by-two the auto-advance panel uses, so the two
                      settings panels in this app are read the same way: white
                      tiles standing off the demo colour behind them. */}
                  {isDemo ? (
                    <div className="queue-auto-advance-settings-grid event-modal-demo-settings">
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Fake Attendees</span>
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            className="queue-auto-advance-slider"
                            min={DEMO_LIMITS.participantCount.min}
                            max={DEMO_LIMITS.participantCount.max}
                            step={1}
                            value={demoParticipantCount}
                            onChange={onFieldChange("demoParticipantCount")}
                          />
                          <span>
                            {demoParticipantCount} {demoParticipantCount === 1 ? "person" : "people"}
                          </span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          How many invented attendees this event runs with. They hold real
                          numbers and appear everywhere a real attendee would.
                        </span>
                      </SketchCard>
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Members</span>
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            className="queue-auto-advance-slider"
                            min={DEMO_LIMITS.memberPercent.min}
                            max={DEMO_LIMITS.memberPercent.max}
                            step={5}
                            value={demoMemberPercent}
                            onChange={onFieldChange("demoMemberPercent")}
                          />
                          <span>{demoMemberPercent}%</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          {demoMemberCount} of {demoParticipantCount} count as members, so
                          early check-in has someone to admit.
                        </span>
                      </SketchCard>
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Join Before Start</span>
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            className="queue-auto-advance-slider"
                            min={DEMO_LIMITS.preStartPercent.min}
                            max={DEMO_LIMITS.preStartPercent.max}
                            step={5}
                            value={demoPreStartPercent}
                            onChange={onFieldChange("demoPreStartPercent")}
                          />
                          <span>{demoPreStartPercent}%</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          {demoPreStartCount} queue up before the doors open; the other{" "}
                          {demoParticipantCount - demoPreStartCount} trickle in once the
                          event has started.
                        </span>
                      </SketchCard>
                      <SketchCard
                        className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                        elevation={1}
                        fill="#ffffff"
                        strokeColor="#111111"
                      >
                        <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                          <span className="queue-auto-advance-setting-title">Item Pickup Rate</span>
                        </label>
                        <div className="queue-auto-advance-inline-control">
                          <SketchSlider
                            className="queue-auto-advance-slider"
                            min={DEMO_LIMITS.pickupChancePercent.min}
                            max={DEMO_LIMITS.pickupChancePercent.max}
                            step={5}
                            value={demoPickupChancePercent}
                            onChange={onFieldChange("demoPickupChancePercent")}
                          />
                          <span>{demoPickupChancePercent}%</span>
                        </div>
                        <span className="queue-auto-advance-setting-copy">
                          How often someone called for a group actually takes an item. The
                          rest build up a backlog, and more of them come back for it at
                          final call.
                        </span>
                      </SketchCard>
                    </div>
                  ) : null}
                </SketchCard>
              </div>
            ) : null}
            {controlMessage ? <p className="entry-message">{controlMessage}</p> : null}
            <div className="control-actions">
              <SketchButton type="submit" disabled={controlSaving}>
                {controlSaving
                  ? "Saving..."
                  : isEventLive
                    ? "Save Event Details"
                    : isDemo
                      ? "Start Demo Event"
                      : "Start Event"}
              </SketchButton>
            </div>
          </form>
        </div>
        {/* Only while there is more to scroll to, so it is a cue and not decoration. */}
        <div
          className={`event-modal-scroll-hint${hasMoreBelow ? " event-modal-scroll-hint--visible" : ""}`}
          aria-hidden="true"
        >
          <ChevronDown className="event-modal-scroll-chevron" />
        </div>
      </div>
    </SketchDialog>
  );
}

/**
 * One attendee row.
 *
 * Memoised because the whole control panel re-renders every second (the event
 * timer), and every row is a wired-card that redraws itself to canvas on each
 * render. With a full house that was hundreds of canvas redraws per second for
 * a clock that changes one digit.
 */
const RosterRow = memo(function RosterRow({
  actions,
  claim,
  isClaimed = false,
  isWinner = false,
  showItemCount = true,
  showMemberBadge = true,
  statusLabel,
}) {
  const avatarLabel = claim.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";
  const cardRef = useRef(null);

  /*
   * Keeps the winner's sketched outline the size of the row it is drawn around.
   *
   * A pulsing row is a scaled row, and wired-card sizes its outline from
   * `getBoundingClientRect()` — the transformed box. Whatever makes it redraw
   * mid-breath (its own resize observer, most often a change in the list's
   * width) leaves it holding an outline drawn to a shrunken measurement, and it
   * keeps that outline until something else makes it look again.
   *
   * So it is asked to look again on every iteration of the breath. The
   * keyframes are at full size on that boundary, so the measurement it takes
   * there is the row's real one — and `wiredRender` with no argument only
   * redraws when what it measures differs from what it last drew, so a row
   * whose outline is already right pays nothing for the check. The same check
   * runs when the pulse stops, to straighten out an outline that was left
   * wrong by the last breath.
   */
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof card.wiredRender !== "function") {
      return undefined;
    }

    const redrawIfMissized = () => {
      card.wiredRender();
    };

    if (!isWinner) {
      redrawIfMissized();
      return undefined;
    }

    card.addEventListener("animationiteration", redrawIfMissized);

    return () => {
      card.removeEventListener("animationiteration", redrawIfMissized);
    };
  }, [isWinner]);

  return (
    <SketchCard
      ref={cardRef}
      /* A standing raffle win outranks a collected prize on the fill: it is the
         thing that just happened, and it is the only one of the two that ever
         goes away on its own. */
      className={`roster-row roster-row--sketch sketch-entry-card${isClaimed ? " roster-row--claimed" : ""}${isWinner ? " roster-row--winner" : ""}`}
      role="listitem"
      elevation={1}
      fill={isWinner ? "#fff6e5" : isClaimed ? "#e6f7ea" : "#fffdf8"}
      strokeColor={isClaimed && !isWinner ? "#186a3b" : "#111111"}
    >
      <div className="roster-row-content">
        <div className="roster-primary">
          <strong>{formatClaimNumber(claim.number)}</strong>
          {/* A member is marked by the rainbow ring around their picture. The
              per-name letter colours sit on the fallback rather than here,
              because the ring is itself a background. */}
          <div
            className={`roster-avatar${claim.isMember ? " avatar-member-ring" : ""}`}
            aria-hidden="true"
          >
            {claim.avatarUrl ? (
              <img src={claim.avatarUrl} alt="" className="roster-avatar-image" />
            ) : (
              <span
                className="roster-avatar-fallback"
                style={getAvatarColors(claim.displayName)}
              >
                {avatarLabel}
              </span>
            )}
          </div>
          <span>{claim.displayName}</span>
        </div>
        <div className="roster-meta">
          {statusLabel ? (
            <span className="roster-badge roster-badge--waiting">{statusLabel}</span>
          ) : null}
          {showItemCount && Number.isFinite(claim.itemsClaimedCount) ? (
            <SketchCard
              className="roster-badge roster-badge--items roster-badge--sketch"
              elevation={1}
              fill="#f2f4f7"
              strokeColor="#111111"
            >
              <span className="roster-badge-label">Items: {claim.itemsClaimedCount}</span>
            </SketchCard>
          ) : null}
          {/* Dropped in the side-by-side view: two lists in the width of one
              leaves no room for it, and the badge would collide with the name
              and the item count. */}
          {showMemberBadge ? (
            <SketchCard
              className={`roster-badge roster-badge--sketch ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
              elevation={1}
              fill={claim.isMember ? "#eaf3ff" : "#fff1dc"}
              strokeColor="#111111"
            >
              <span className="roster-badge-label">
                {claim.isMember ? "Member" : "Not Member"}
              </span>
            </SketchCard>
          ) : null}
          {actions}
        </div>
      </div>
    </SketchCard>
  );
});

/**
 * A row in the group list or the backlog list, with its own buttons.
 *
 * The buttons are built in here rather than passed down as an `actions`
 * element, which is what makes the memo on this and on RosterRow actually do
 * something. Passed in, the element was rebuilt by the parent on every render,
 * so the shallow compare failed every time and RosterRow's memo never once
 * bailed out — and this panel re-renders every second off the event clock, so
 * every visible row was redrawing its wired outline once a second all evening.
 *
 * Everything here is a scalar or a callback the panel holds stable, so a row
 * now re-renders only when that attendee actually changes.
 */
const GroupRosterRow = memo(function GroupRosterRow({
  claim,
  isClaimed = false,
  showMemberBadge = true,
  onPreviewAttendeeTicket,
  onRemoveClaim,
  onRequestConfirmation,
}) {
  const claimNumberLabel = formatClaimNumber(claim.number);

  return (
    <RosterRow
      claim={claim}
      isClaimed={isClaimed}
      showMemberBadge={showMemberBadge}
      actions={
        <RosterRowActions
          menuLabel={`More actions for ${claim.displayName || `number ${claimNumberLabel}`}`}
        >
          <SketchIconButton
            type="button"
            className="secondary-button roster-qr-button"
            onClick={() => onPreviewAttendeeTicket?.(claim.claimId)}
            disabled={!onPreviewAttendeeTicket}
            title={`Open ${claim.displayName || "attendee"}'s ticket`}
            aria-label={`Open the attendee view of ${claim.displayName || "attendee"} (${claimNumberLabel})`}
          >
            <QrCode aria-hidden="true" className="button-icon" />
          </SketchIconButton>
          <SketchIconButton
            type="button"
            className="roster-remove-button"
            disabled={!onRemoveClaim}
            onClick={() => {
              if (!onRemoveClaim) return;
              const confirmMsg = `Remove ${claim.displayName || "attendee"} (${claimNumberLabel})?`;
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
            title="Remove attendee from the event"
            aria-label={`Remove ${claim.displayName || "attendee"} (${claimNumberLabel})`}
          >
            <Trash2 aria-hidden="true" className="button-icon" />
          </SketchIconButton>
        </RosterRowActions>
      }
    />
  );
});

function ClaimList({
  claims,
  currentRound,
  elapsedLabel,
  emptyText,
  isFinalCall,
  isSplitView = false,
  onPreviewAttendeeTicket,
  onRemoveClaim,
  onRequestConfirmation,
}) {
  // Above the empty-list return: the fade is a hook, and hooks cannot sit
  // behind a branch.
  const groupListRef = useRef(null);
  const groupListEdges = useScrollEdges(groupListRef);
  /* Paged, because this list is not always a group. During final call it holds
     everyone still outstanding, which is capped at a thousand rather than at a
     group size. */
  const page = useListPage(claims);

  if (!claims.length) {
    return <p>{emptyText}</p>;
  }

  const claimedCount = claims.filter((claim) => hasClaimedInRound(claim, currentRound)).length;
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
            item.label === "Claimed" ? (
              <div
                key={item.label}
                className={`queue-summary-card queue-summary-card--claimed${isGroupFullyClaimed ? " queue-summary-card--complete" : ""}`}
              >
                <div className="queue-claimed-progress-wrap">
                  <SketchProgress
                    className="queue-claimed-progress"
                    value={Math.max(0, Math.min(1, claimedProgress)) * 100}
                    min={0}
                    max={100}
                    aria-hidden="true"
                  />
                  <span className="queue-claimed-progress-label">
                    <span className="progress-label-main">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </span>
                    {elapsedLabel ? (
                      <span className="progress-label-time">Up for {elapsedLabel}</span>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : (
              <div
                key={item.label}
                className={`queue-summary-card${item.label === "Claimed" && isGroupFullyClaimed ? " queue-summary-card--complete" : ""}`}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            )
          ) : null,
        )}
      </div>
      <ScrollFade edges={groupListEdges}>
        <div
          className="roster-list roster-list--group"
          role="list"
          ref={groupListRef}
          onScroll={groupListEdges.onScroll}
        >
          {page.pageItems.map((claim) => (
            <GroupRosterRow
              key={claim.claimId}
              claim={claim}
              isClaimed={hasClaimedInRound(claim, currentRound)}
              showMemberBadge={!isSplitView}
              onPreviewAttendeeTicket={onPreviewAttendeeTicket}
              onRemoveClaim={onRemoveClaim}
              onRequestConfirmation={onRequestConfirmation}
            />
          ))}
        </div>
      </ScrollFade>
      <ListPager label="the current list" page={page} />
    </>
  );
}

function BacklogList({
  calledSoFarCount,
  claims,
  currentTime,
  isSplitView = false,
  onPreviewAttendeeTicket,
  onRemoveClaim,
  onRequestConfirmation,
}) {
  const backlogListRef = useRef(null);
  const backlogListEdges = useScrollEdges(backlogListRef);
  /* Paged: the backlog is everyone called who has not collected, so on a busy
     round it is most of the room. */
  const page = useListPage(claims);

  const clearedCount = Math.max(0, (calledSoFarCount ?? 0) - claims.length);
  const isBacklogFullyCleared = calledSoFarCount > 0 && clearedCount === calledSoFarCount;
  const clearedProgress = calledSoFarCount ? clearedCount / calledSoFarCount : 0;
  /*
   * The newest arrival who is still waiting. Paired with the cleared count it
   * says how stale the backlog is: a long time here means nobody new has
   * joined it and the ones left are the ones who are not coming back.
   */
  const lastJoinedAtMs = useMemo(
    () =>
      claims.reduce((latest, claim) => {
        const joinedAtMs =
          getTimestampMs(claim.joinedAtMs) ?? getTimestampMs(claim.claimedAtMs);

        if (!Number.isFinite(joinedAtMs)) {
          return latest;
        }

        return latest === null || joinedAtMs > latest ? joinedAtMs : latest;
      }, null),
    [claims],
  );
  const lastJoinedLabel =
    lastJoinedAtMs === null
      ? ""
      : formatElapsedDuration(Math.max(0, (currentTime ?? Date.now()) - lastJoinedAtMs));

  return (
    <div className="queue-backlog-panel">
      {calledSoFarCount ? (
        <div className="queue-summary" aria-label="Backlog status">
          <div
            className={`queue-summary-card queue-summary-card--claimed${isBacklogFullyCleared ? " queue-summary-card--complete" : ""}`}
          >
            <div className="queue-claimed-progress-wrap">
              <SketchProgress
                className="queue-claimed-progress"
                value={Math.max(0, Math.min(1, clearedProgress)) * 100}
                min={0}
                max={100}
                aria-hidden="true"
              />
              <span className="queue-claimed-progress-label">
                <span className="progress-label-main">
                  <span>Cleared</span>
                  <strong>
                    {clearedCount}/{calledSoFarCount ?? 0}
                  </strong>
                </span>
                {lastJoinedLabel ? (
                  <span className="progress-label-time">Last join {lastJoinedLabel}</span>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      ) : null}
      {!claims.length ? (
        <p className="queue-backlog-empty">
          {calledSoFarCount
            ? "Backlog empty \u2014 everyone called so far has claimed."
            : "Backlog empty \u2014 nobody has been called yet."}
        </p>
      ) : null}
      <ScrollFade edges={backlogListEdges}>
        <div
          className="roster-list roster-list--group"
          role="list"
          ref={backlogListRef}
          onScroll={backlogListEdges.onScroll}
        >
          {page.pageItems.map((claim) => (
            <GroupRosterRow
              key={claim.claimId}
              claim={claim}
              showMemberBadge={!isSplitView}
              onPreviewAttendeeTicket={onPreviewAttendeeTicket}
              onRemoveClaim={onRemoveClaim}
              onRequestConfirmation={onRequestConfirmation}
            />
          ))}
        </div>
      </ScrollFade>
      <ListPager label="the backlog" page={page} />
    </div>
  );
}

function GraphModalOverlay({ children, onClose }) {
  useScrollLock();

  return (
    <div className="graph-expand-backdrop" role="presentation" onClick={onClose}>
      {children}
    </div>
  );
}

// Preclaim queue is now embedded inside FullRoster; no modal component needed.

function TimelineChart({
  emptyText,
  isExpanded = false,
  onClose,
  onExpand,
  redrawSignal,
  showEmptyGraphWhenNoData = false,
  showExpandButton = true,
  title,
  tone,
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
  const hasDataPoints = timeline.sortedTimestamps.length > 0;
  const shouldRenderGraphShell = hasDataPoints || showEmptyGraphWhenNoData;

  return (
    <SketchCard
      className={`timeline-chart-card sketch-entry-card${isExpanded ? " timeline-chart-card--expanded" : ""}`}
      aria-label={isExpanded ? `${title} expanded view` : title}
      aria-modal={isExpanded ? "true" : undefined}
      role={isExpanded ? "dialog" : "region"}
      elevation={1}
      fill="#ffffff"
      redrawDelayMs={240}
      redrawOnResize
      redrawSignal={redrawSignal}
      strokeColor="#111111"
      onClick={isExpanded ? (event) => event.stopPropagation() : undefined}
    >
      <div className="timeline-chart-header">
        <div className="timeline-chart-title-row">
          <h3>
            {title} ({timeline.sortedTimestamps.length})
          </h3>
          <div className="timeline-chart-actions">
            {isExpanded ? (
              <SketchIconButton
                type="button"
                className="timeline-chart-close timeline-chart-close--modal"
                onClick={onClose}
                aria-label={`Close expanded ${title.toLowerCase()}`}
                title={`Close expanded ${title.toLowerCase()}`}
              >
                <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
              </SketchIconButton>
            ) : showExpandButton ? (
              <SketchIconButton
                type="button"
                className="timeline-chart-expand"
                onClick={onExpand}
                aria-label={`Expand ${title.toLowerCase()}`}
                title={`Expand ${title.toLowerCase()}`}
              >
                <Expand
                  aria-hidden="true"
                  className="timeline-chart-expand-icon"
                />
              </SketchIconButton>
            ) : null}
          </div>
        </div>
      </div>
      {/* A plain div: the plot's own axes are its frame. A drawn card here put a
          second box around every chart, inside the card that already has one. */}
      {shouldRenderGraphShell ? (
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
            {hasDataPoints && timeline.areaPath ? (
              <path d={timeline.areaPath} className="graph-area" style={{ fill: `url(#${gradientId})` }} />
            ) : null}
            {hasDataPoints && timeline.linePath ? <path d={timeline.linePath} className={lineClassName} /> : null}
            {hasDataPoints && timeline.pointCoordinates.slice(1).map((point) => (
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
    </SketchCard>
  );
}

/*
 * Both charts, always. Each used to carry its own close button, which left the
 * panel in a half-open state nobody asked for — closing the whole panel with
 * the graph button says the same thing in one click, so the per-chart close
 * buttons and the "Show ..." toolbar that undid them are gone.
 *
 * A SketchCard rather than a div, to sit behind the header in the same drawn
 * frame the queue card's settings panel uses.
 */
function AttendeeGraphsPanel({
  claims,
  joinedTimestamps,
  onExpandItemClaims,
  onExpandNumberClaims,
  panelClassName,
  showExpandButtons = true,
}) {
  const itemClaimTimestamps = claims
    .flatMap((claim) => {
      if (claim.itemClaimedAtMsHistory.length > 0) {
        return claim.itemClaimedAtMsHistory;
      }

      return Number.isFinite(claim.redeemedAtMs) ? [claim.redeemedAtMs] : [];
    })
    .filter((timestampMs) => Number.isFinite(timestampMs));

  return (
    <SketchCard
      className={`roster-graphs-panel sketch-entry-card ${panelClassName}`}
      elevation={1}
      fill="#fffdf8"
      redrawOnResize
      redrawSignal={panelClassName}
      strokeColor="#111111"
    >
      {/* The two-column grid lives on this inner div, not on the card:
          wired-card slots its children into a plain block inside its own shadow
          root, so a grid declared on the host never reaches them. */}
      <div className="roster-graphs-grid">
        <TimelineChart
          emptyText="No timestamped joins yet."
          onExpand={onExpandNumberClaims}
          redrawSignal={panelClassName}
          showEmptyGraphWhenNoData
          showExpandButton={showExpandButtons}
          timestamps={joinedTimestamps}
          title="Joined"
          tone="claims"
        />
        <TimelineChart
          emptyText="No timestamped item claims yet."
          onExpand={onExpandItemClaims}
          redrawSignal={panelClassName}
          showEmptyGraphWhenNoData
          showExpandButton={showExpandButtons}
          timestamps={itemClaimTimestamps}
          title="Item Claims"
          tone="items"
        />
      </div>
    </SketchCard>
  );
}

/**
 * One person on the roster, staff or attendee.
 *
 * Shared by both lists in the panel rather than written out twice for the staff
 * section: the row carries the ticket preview, the move-to-queue action and the
 * remove action, and two copies of that drift apart the first time one of them
 * gains a button.
 */
const RosterClaimRow = memo(function RosterClaimRow({
  claim,
  onMoveClaimBackToQueueAsStaff,
  onPreviewAttendeeTicket,
  onRemoveClaim,
  onRequestConfirmation,
  showPreclaimQueue,
}) {
  const avatarLabel = claim.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";
  /* S1 for staff, #12 for everybody else. See src/staffNumbers.js. */
  const claimNumberLabel = formatClaimNumber(claim.number);

  return (
    <SketchCard
      className="roster-row roster-row--sketch sketch-entry-card"
      role="listitem"
      elevation={1}
      fill="#fffdf8"
      strokeColor="#111111"
    >
      <div className="roster-row-content">
        <div className="roster-primary">
          <strong>{claimNumberLabel}</strong>
          {/* A member is marked by the rainbow ring around their picture. The
              per-name letter colours sit on the fallback rather than here,
              because the ring is itself a background. */}
          <div
            className={`roster-avatar${claim.isMember ? " avatar-member-ring" : ""}`}
            aria-hidden="true"
          >
            {claim.avatarUrl ? (
              <img src={claim.avatarUrl} alt="" className="roster-avatar-image" />
            ) : (
              <span
                className="roster-avatar-fallback"
                style={getAvatarColors(claim.displayName)}
              >
                {avatarLabel}
              </span>
            )}
          </div>
          <span>{claim.displayName}</span>
        </div>
        <div className="roster-meta">
          <SketchCard
            className="roster-badge roster-badge--items roster-badge--sketch"
            elevation={1}
            fill="#f2f4f7"
            strokeColor="#111111"
          >
            <span className="roster-badge-label">Items: {claim.itemsClaimedCount}</span>
          </SketchCard>
          <SketchCard
            className={`roster-badge roster-badge--sketch ${claim.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
            elevation={1}
            fill={claim.isMember ? "#eaf3ff" : "#fff1dc"}
            strokeColor="#111111"
          >
            <span className="roster-badge-label">
              {claim.isMember ? "Member" : "Not Member"}
            </span>
          </SketchCard>
          <RosterRowActions
            menuLabel={`More actions for ${claim.displayName || `number ${claimNumberLabel}`}`}
          >
            {showPreclaimQueue ? (
              <SketchButton
                type="button"
                className="secondary-button roster-inline-action"
                onClick={() => {
                  if (!onMoveClaimBackToQueueAsStaff) return;
                  const confirmMsg = `Move ${claim.displayName || "attendee"} (${claimNumberLabel}) back to queue?`;
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
                aria-label={`Move ${claim.displayName || "attendee"} (${claimNumberLabel}) back to queue`}
              >
                Queue
              </SketchButton>
            ) : null}
            {/* Opens their ticket as they see it, for anyone who
                cannot show their own: a flat phone, a walk-up who never
                signed in, or a demo participant. */}
            <SketchIconButton
              type="button"
              className="secondary-button roster-qr-button"
              onClick={() => onPreviewAttendeeTicket?.(claim.claimId)}
              disabled={!onPreviewAttendeeTicket}
              title={`Open ${claim.displayName || "attendee"}'s ticket`}
              aria-label={`Open the attendee view of ${claim.displayName || "attendee"} (${claimNumberLabel})`}
            >
              <QrCode aria-hidden="true" className="button-icon" />
            </SketchIconButton>
            <SketchIconButton
              type="button"
              className="roster-remove-button"
              onClick={() => {
                if (!onRemoveClaim) return;
                const confirmMsg = `Remove ${claim.displayName || 'attendee'} (${claimNumberLabel})?`;
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
              title="Remove attendee from the event"
              aria-label={`Remove ${claim.displayName || 'attendee'} (${claimNumberLabel})`}
            >
              {/* A bin rather than a ×: on a row that already sits
                  inside panels and popovers, a × reads as "close
                  this", not "take this person off the event". */}
              <Trash2 aria-hidden="true" className="button-icon" />
            </SketchIconButton>
          </RosterRowActions>
        </div>
      </div>
    </SketchCard>
  );
});

function FullRoster({
  claims,
  isGraphOpen,
  nextClaimNumber,
  nextStaffNumber,
  onToggleGraph,
  onRequestConfirmation,
  preclaims,
  onAssignPreclaimAsStaff,
  onMoveClaimBackToQueueAsStaff,
  onRefreshAllPreclaimMembershipsAsStaff,
  onRemoveClaim,
  onPreviewAttendeeTicket,
  onRemovePreclaimAsStaff,
  showPreclaimQueue,
}) {
  const [expandedGraphTone, setExpandedGraphTone] = useState("");
  const isGraphExpandDisabled = useIsNarrowViewport(GRAPH_EXPAND_BREAKPOINT_PX);
  const [isGraphPanelMounted, setIsGraphPanelMounted] = useState(false);
  const [rosterSearchQuery, setRosterSearchQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState("all");
  const [itemClaimFilter, setItemClaimFilter] = useState("all");
  /* The queue gets its own search and filters rather than sharing the roster's:
     they sit over two different lists in the same card, and one search box
     driving both would empty whichever list staff were not looking at. */
  const [queueSearchQuery, setQueueSearchQuery] = useState("");
  const [queueMemberFilter, setQueueMemberFilter] = useState("all");
  const [rosterPage, setRosterPage] = useState(0);
  const [isRefreshingAllPreclaims, setIsRefreshingAllPreclaims] = useState(false);
  const rosterListRef = useRef(null);
  const queueListRef = useRef(null);
  const rosterListEdges = useScrollEdges(rosterListRef);
  const queueListEdges = useScrollEdges(queueListRef);
  /* One list, staff at the head of it: their numbers are negative, so the sort
     the roster already arrives in puts them above #1 without a section of their
     own. Split here only for the two counts on the card and for the turnout
     graph, which is attendees. See src/staffNumbers.js. */
  /* Memoised, all of it, because this panel re-renders once a second off the
     event clock and none of these inputs move on a clock tick. Unmemoised, a
     full house meant re-partitioning the roster, rebuilding the join timeline
     over every claim and preclaim, re-sorting the queue and re-filtering the
     roster every second. */
  const { attendeeClaims, staffClaims } = useMemo(
    () => partitionStaffClaims(claims),
    [claims],
  );
  /* Attendees only, matching the attendee count on the card and the figures a
     closed event is archived with: staff running the door are not turnout. */
  const joinedTimeline = useMemo(
    () => buildJoinedTimeline({ claims: attendeeClaims, preclaims }),
    [attendeeClaims, preclaims],
  );
  const joinedTimestamps = joinedTimeline.timestamps;

  useEffect(() => {
    if (isGraphOpen) {
      setIsGraphPanelMounted(true);
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

  /* Also closes it on a rotate or resize down past the breakpoint: the button
     that opened it is gone at that width, so leaving the modal up would strand
     a view the page can no longer reach. */
  useEffect(() => {
    if ((!isGraphOpen || isGraphExpandDisabled) && expandedGraphTone) {
      setExpandedGraphTone("");
    }
  }, [expandedGraphTone, isGraphExpandDisabled, isGraphOpen]);

  const expandedGraphConfig =
    expandedGraphTone === "claims"
      ? {
          emptyText: "No timestamped joins yet.",
          showEmptyGraphWhenNoData: true,
          timestamps: joinedTimestamps,
          title: "Joined",
          tone: "claims",
        }
      : expandedGraphTone === "items"
        ? {
            emptyText: "No timestamped item claims yet.",
            timestamps: claims
              .flatMap((claim) => {
                if (claim.itemClaimedAtMsHistory.length > 0) {
                  return claim.itemClaimedAtMsHistory;
                }

                return Number.isFinite(claim.redeemedAtMs) ? [claim.redeemedAtMs] : [];
              })
              .filter((timestampMs) => Number.isFinite(timestampMs)),
            showEmptyGraphWhenNoData: true,
            title: "Item Claims",
            tone: "items",
          }
        : null;

  /* Sorted and numbered together, and memoised: the projection depends on the
     order, so splitting them would only mean two memos with the same inputs. */
  const queueEntriesWithProjectedNumbers = useMemo(() => {
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

        const createdAtDifference =
          getQueueCreatedAtMs(leftPreclaim) - getQueueCreatedAtMs(rightPreclaim);
        if (createdAtDifference !== 0) {
          return createdAtDifference;
        }

        return String(leftPreclaim?.preclaimId ?? "").localeCompare(
          String(rightPreclaim?.preclaimId ?? ""),
        );
      });

    /* Counted up from the event's own allocators rather than filled into the
       gaps left by removals, which is what the server actually does. See
       projectQueueNumbers. */
    return projectQueueNumbers({
      nextClaimNumber,
      nextStaffNumber,
      queueEntries: sortedQueueEntries,
    });
  }, [nextClaimNumber, nextStaffNumber, preclaims]);

  const normalizedQueueSearchQuery = queueSearchQuery.trim().toLowerCase();
  /* Filtered after the numbers are projected, never before: the projection
     counts up the whole queue in order, so numbering a filtered slice would
     hand the first match the number that belongs to whoever is actually next. */
  const filteredQueueEntries = useMemo(
    () =>
      queueEntriesWithProjectedNumbers.filter((queuedAttendee) => {
        const isMemberMatch =
          queueMemberFilter === "all" ||
          (queueMemberFilter === "member" && queuedAttendee.isMember === true) ||
          (queueMemberFilter === "non-member" && queuedAttendee.isMember !== true) ||
          (queueMemberFilter === "staff" && queuedAttendee.isStaff === true);

        if (!isMemberMatch) {
          return false;
        }

        if (!normalizedQueueSearchQuery) {
          return true;
        }

        const queuedDisplayName = String(queuedAttendee.displayName ?? "").toLowerCase();
        /* The projected number, because that is the number on the row: the
           queue entry itself does not have one yet. */
        const projectedNumberLabel = formatClaimNumber(queuedAttendee.projectedNumber).toLowerCase();
        return (
          queuedDisplayName.includes(normalizedQueueSearchQuery) ||
          projectedNumberLabel.includes(normalizedQueueSearchQuery)
        );
      }),
    [
      normalizedQueueSearchQuery,
      queueEntriesWithProjectedNumbers,
      queueMemberFilter,
    ],
  );
  const hasActiveQueueFilters =
    normalizedQueueSearchQuery.length > 0 || queueMemberFilter !== "all";

  const normalizedRosterSearchQuery = rosterSearchQuery.trim().toLowerCase();
  const matchesRosterFilters = useCallback((claim) => {
    const isMemberMatch =
      memberFilter === "all" ||
      (memberFilter === "member" && claim.isMember === true) ||
      (memberFilter === "non-member" && claim.isMember !== true) ||
      (memberFilter === "staff" && isStaffClaim(claim));

    if (!isMemberMatch) {
      return false;
    }

    const hasClaimedAnyItem = Number.isFinite(Number(claim.itemsClaimedCount))
      ? Number(claim.itemsClaimedCount) > 0
      : false;
    const isItemClaimMatch =
      itemClaimFilter === "all" ||
      (itemClaimFilter === "claimed" && hasClaimedAnyItem) ||
      (itemClaimFilter === "unclaimed" && !hasClaimedAnyItem);

    if (!isItemClaimMatch) {
      return false;
    }

    if (!normalizedRosterSearchQuery) {
      return true;
    }

    const claimDisplayName = String(claim.displayName ?? "").toLowerCase();
    /* Searched by the label rather than the stored value, so typing "S2" finds
       a staff member and "-2" — which nobody has ever seen on screen — does
       not. */
    const claimNumberLabel = formatClaimNumber(claim.number).toLowerCase();
    return (
      claimDisplayName.includes(normalizedRosterSearchQuery) ||
      claimNumberLabel.includes(normalizedRosterSearchQuery)
    );
  }, [itemClaimFilter, memberFilter, normalizedRosterSearchQuery]);
  const filteredRosterClaims = useMemo(
    () => claims.filter(matchesRosterFilters),
    [claims, matchesRosterFilters],
  );
  const shownCount = filteredRosterClaims.length;
  const hasActiveRosterFilters =
    normalizedRosterSearchQuery.length > 0 || memberFilter !== "all" || itemClaimFilter !== "all";
  const rosterPageCount = Math.max(1, Math.ceil(filteredRosterClaims.length / ROSTER_PAGE_SIZE));
  /* Filtering/removing attendees can leave rosterPage pointing past the new
     last page; clamped here rather than in state so the effect below (which
     resets to page 0 on a filter change) doesn't fight this render's slice. */
  const safeRosterPage = Math.min(rosterPage, rosterPageCount - 1);
  const paginatedRosterClaims = filteredRosterClaims.slice(
    safeRosterPage * ROSTER_PAGE_SIZE,
    (safeRosterPage + 1) * ROSTER_PAGE_SIZE,
  );
  /* The queue pages like everything else here. It used to render every entry,
     which before the doors open on a full event is the whole room — and each
     row is five drawn elements, so a long queue was what made this panel stop
     responding at the one moment staff need it. */
  const queuePage = useListPage(filteredQueueEntries);
  const { setPageIndex: setQueuePageIndex } = queuePage;

  useEffect(() => {
    setRosterPage(0);
  }, [normalizedRosterSearchQuery, memberFilter, itemClaimFilter]);

  useEffect(() => {
    setQueuePageIndex(0);
  }, [normalizedQueueSearchQuery, queueMemberFilter, setQueuePageIndex]);

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
              {attendeeClaims.length} attendee{attendeeClaims.length === 1 ? "" : "s"}
              {staffClaims.length ? ` • ${staffClaims.length} staff` : ""}
              {hasActiveRosterFilters ? ` • ${shownCount} shown` : ""}
              {showPreclaimQueue
                ? hasActiveQueueFilters
                  ? ` • ${filteredQueueEntries.length}/${queueEntriesWithProjectedNumbers.length} queued shown`
                  : ` • ${queueEntriesWithProjectedNumbers.length} queued`
                : ""}
            </p>
          </div>
          <div className="queue-corner-primary">
            <SketchIconButton
              className={`secondary-button queue-corner-button${isGraphOpen ? " queue-corner-button--active" : ""}`}
              type="button"
              onClick={onToggleGraph}
              aria-label={isGraphOpen ? "Hide attendee graphs" : "Show attendee graphs"}
              title={isGraphOpen ? "Hide attendee graphs" : "Show attendee graphs"}
            >
              <ChartColumnIncreasing
                aria-hidden="true"
                className="button-icon queue-corner-button-icon queue-corner-button-icon--graph"
              />
            </SketchIconButton>
          </div>
        </div>
        {isGraphPanelMounted ? (
          <AttendeeGraphsPanel
            /* The full roster, staff included: this prop feeds the item-claims
               graph, and an item a staff member took off the table is an item
               that left it. Turnout is the other graph, and its timestamps come
               from joinedTimeline, which is attendees only. */
            claims={claims}
            joinedTimestamps={joinedTimestamps}
            onExpandItemClaims={() => setExpandedGraphTone("items")}
            onExpandNumberClaims={() => setExpandedGraphTone("claims")}
            panelClassName={isGraphOpen ? "roster-graphs-panel--open" : "roster-graphs-panel--closing"}
            showExpandButtons={!isGraphExpandDisabled}
          />
        ) : null}
        <div className="roster-filter-row" role="group" aria-label="Attendee filters">
          <SketchSearchInput
            className="roster-filter-search"
            placeholder="Search attendee or number"
            value={rosterSearchQuery}
            onChange={(event) => setRosterSearchQuery(event.target.value)}
          />
          <SketchCombo
            className="roster-filter-combo"
            fullWidth
            selected={memberFilter}
            onChange={(event) => setMemberFilter(event.target.value)}
          >
            <wired-item value="all">All attendees</wired-item>
            <wired-item value="member">Members only</wired-item>
            <wired-item value="non-member">Non-members only</wired-item>
            <wired-item value="staff">Staff only</wired-item>
          </SketchCombo>
          <SketchCombo
            className="roster-filter-combo"
            fullWidth
            selected={itemClaimFilter}
            onChange={(event) => setItemClaimFilter(event.target.value)}
          >
            <wired-item value="all">All claim states</wired-item>
            <wired-item value="claimed">Gotten items</wired-item>
            <wired-item value="unclaimed">No items yet</wired-item>
          </SketchCombo>
        </div>
      </div>
      {/*
        Everybody with a number, in one list, staff at the top of it. Their
        numbers are negative — see src/staffNumbers.js — so they land above #1
        on their own, and the Staff filter in the dropdown above is how you look
        at them by themselves.
      */}
      {claims.length ? (
        <ScrollFade edges={rosterListEdges}>
          <div
            className="roster-list roster-list--attendees"
            role="list"
            ref={rosterListRef}
            onScroll={rosterListEdges.onScroll}
          >
            {paginatedRosterClaims.length ? (
              paginatedRosterClaims.map((claim) => (
                <RosterClaimRow
                  key={claim.claimId}
                  claim={claim}
                  onMoveClaimBackToQueueAsStaff={onMoveClaimBackToQueueAsStaff}
                  onPreviewAttendeeTicket={onPreviewAttendeeTicket}
                  onRemoveClaim={onRemoveClaim}
                  onRequestConfirmation={onRequestConfirmation}
                  showPreclaimQueue={showPreclaimQueue}
                />
              ))
            ) : (
              <p className="roster-filter-empty">No attendees match the current search/filters.</p>
            )}
          </div>
        </ScrollFade>
      ) : (
        <p>No attendees have claimed a number yet.</p>
      )}
      {rosterPageCount > 1 ? (
        <div className="roster-pagination" role="group" aria-label="Attendee list pages">
          <SketchIconButton
            className="secondary-button roster-pagination-button"
            type="button"
            onClick={() => setRosterPage((currentPage) => Math.max(0, currentPage - 1))}
            disabled={safeRosterPage === 0}
            aria-label="Previous page of attendees"
            title="Previous page"
          >
            <ChevronLeft aria-hidden="true" className="button-icon" />
          </SketchIconButton>
          <span className="roster-pagination-range" aria-live="polite">
            {safeRosterPage * ROSTER_PAGE_SIZE + 1}
            {"–"}
            {Math.min(filteredRosterClaims.length, (safeRosterPage + 1) * ROSTER_PAGE_SIZE)}
          </span>
          <SketchIconButton
            className="secondary-button roster-pagination-button"
            type="button"
            onClick={() => setRosterPage((currentPage) => Math.min(rosterPageCount - 1, currentPage + 1))}
            disabled={safeRosterPage >= rosterPageCount - 1}
            aria-label="Next page of attendees"
            title="Next page"
          >
            <ChevronRight aria-hidden="true" className="button-icon" />
          </SketchIconButton>
        </div>
      ) : null}
      {showPreclaimQueue ? (
        <div className="roster-queue-section">
          {/* Drawn rule rather than a CSS hairline, so the split reads like the
              rest of the panel. */}
          <SketchDivider className="roster-queue-divider" />
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
              title="Re-check all queued memberships"
              aria-label="Re-check all queued memberships"
            >
              {isRefreshingAllPreclaims ? "Re-checking..." : "Re-check Memberships"}
            </SketchButton>
          </div>
          {/* The same row of controls the roster above has, over the queue's own
              list. Only drawn once somebody is actually queued: three empty
              filters over "nobody is queued" is furniture. */}
          {queueEntriesWithProjectedNumbers.length ? (
            <div className="roster-filter-row" role="group" aria-label="Queue filters">
              <SketchSearchInput
                className="roster-filter-search"
                placeholder="Search queued attendee or number"
                value={queueSearchQuery}
                onChange={(event) => setQueueSearchQuery(event.target.value)}
              />
              <SketchCombo
                className="roster-filter-combo"
                fullWidth
                selected={queueMemberFilter}
                onChange={(event) => setQueueMemberFilter(event.target.value)}
              >
                <wired-item value="all">All queued</wired-item>
                <wired-item value="member">Members only</wired-item>
                <wired-item value="non-member">Non-members only</wired-item>
                <wired-item value="staff">Staff only</wired-item>
              </SketchCombo>
            </div>
          ) : null}
          {queueEntriesWithProjectedNumbers.length ? (
            <ScrollFade edges={queueListEdges}>
              <div
                className="roster-list roster-list--queue"
                role="list"
                ref={queueListRef}
                onScroll={queueListEdges.onScroll}
              >
                {queuePage.pageItems.length ? (
                  queuePage.pageItems.map((queuedAttendee) => {
                    const avatarLabel = queuedAttendee.displayName?.trim()?.charAt(0)?.toUpperCase() || "?";
                    return (
                      <SketchCard
                        key={queuedAttendee.preclaimId}
                        className="roster-row roster-row--sketch sketch-entry-card"
                        role="listitem"
                        elevation={1}
                        fill="#fffdf8"
                        strokeColor="#111111"
                      >
                        <div className="roster-row-content">
                          <div className="roster-primary">
                            <strong>{formatClaimNumber(queuedAttendee.projectedNumber)}</strong>
                            <div
                              className={`roster-avatar${queuedAttendee.isMember ? " avatar-member-ring" : ""}`}
                              aria-hidden="true"
                            >
                              {queuedAttendee.avatarUrl ? (
                                <img src={queuedAttendee.avatarUrl} alt="" className="roster-avatar-image" />
                              ) : (
                                <span
                                  className="roster-avatar-fallback"
                                  style={getAvatarColors(queuedAttendee.displayName)}
                                >
                                  {avatarLabel}
                                </span>
                              )}
                            </div>
                            <span>{queuedAttendee.displayName || "Unknown attendee"}</span>
                          </div>
                          <div className="roster-meta">
                            <SketchCard
                              className={`roster-badge roster-badge--sketch ${queuedAttendee.isMember ? "roster-badge--member" : "roster-badge--guest"}`}
                              elevation={1}
                              fill={queuedAttendee.isMember ? "#eaf3ff" : "#fff1dc"}
                              strokeColor="#111111"
                            >
                              <span className="roster-badge-label">
                                {queuedAttendee.isMember ? "Member" : "Not Member"}
                              </span>
                            </SketchCard>
                            <RosterRowActions
                              menuLabel={`More actions for ${queuedAttendee.displayName || `number ${formatClaimNumber(queuedAttendee.projectedNumber)}`}`}
                            >
                              <SketchButton
                                type="button"
                                className="secondary-button roster-inline-action"
                                onClick={() => {
                                  if (!onAssignPreclaimAsStaff) return;
                                  void onAssignPreclaimAsStaff(queuedAttendee.preclaimId);
                                }}
                                title={`Assign number ${formatClaimNumber(queuedAttendee.projectedNumber)}`}
                                aria-label={`Assign number ${formatClaimNumber(queuedAttendee.projectedNumber)} to ${queuedAttendee.displayName || "attendee"}`}
                              >
                                Assign Early
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
                                <Trash2 aria-hidden="true" className="button-icon" />
                              </SketchIconButton>
                            </RosterRowActions>
                          </div>
                        </div>
                      </SketchCard>
                    );
                  })
                ) : (
                  <p className="roster-filter-empty">
                    No queued attendees match the current search/filters.
                  </p>
                )}
              </div>
            </ScrollFade>
          ) : (
            <p>No attendees are currently queued.</p>
          )}
          <ListPager label="the queue" page={queuePage} />
        </div>
      ) : null}
      {expandedGraphConfig ? (
        <GraphModalOverlay onClose={() => setExpandedGraphTone("")}>
          <TimelineChart
            emptyText={expandedGraphConfig.emptyText}
            isExpanded
            onClose={() => setExpandedGraphTone("")}
            showEmptyGraphWhenNoData={expandedGraphConfig.showEmptyGraphWhenNoData}
            title={expandedGraphConfig.title}
            tone={expandedGraphConfig.tone}
            timestamps={expandedGraphConfig.timestamps}
          />
        </GraphModalOverlay>
      ) : null}
    </SketchCard>
  );
}


/** The headline numbers for a past event, and how to read them off a record. */
const PAST_EVENT_METRICS = [
  { key: "attendeeCount", label: "Attendees", read: (e) => e.attendeeCount },
  { key: "memberCount", label: "Members", read: (e) => e.memberCount },
  { key: "itemsClaimed", label: "Items Claimed", read: (e) => e.itemsClaimed },
  { key: "attendeesWithItems", label: "Got An Item", read: (e) => e.attendeesWithItems },
  { key: "rounds", label: "Rounds", read: (e) => e.rounds },
];

/**
 * Percentage change against a baseline.
 *
 * A baseline of zero has no meaningful percentage, so report the absolute
 * change instead of dividing by zero — which is the case when this is the only
 * event on record and everything is being compared against nothing.
 */
function buildMetricDelta(currentValue, baselineValue) {
  const current = Number(currentValue) || 0;
  const baseline = Number(baselineValue) || 0;

  if (baseline === 0) {
    return {
      baseline,
      isPercent: false,
      label: current === 0 ? "—" : `+${current}`,
      tone: current > 0 ? "up" : "flat",
    };
  }

  const percent = Math.round(((current - baseline) / baseline) * 100);
  // Within a few percent counts as unchanged, so amber reads as "about the same"
  // rather than being reserved for an exact tie nobody ever hits.
  const tone = Math.abs(percent) <= 5 ? "flat" : percent > 0 ? "up" : "down";

  return {
    baseline,
    isPercent: true,
    label: `${percent > 0 ? "+" : ""}${percent}%`,
    tone,
  };
}

/** Mean of every other event, so a single event compares against zeroes. */
function buildAverageBaseline(events, excludeEventId) {
  const others = events.filter((event) => event.eventId !== excludeEventId);

  if (!others.length) {
    return null;
  }

  return PAST_EVENT_METRICS.reduce((baseline, metric) => {
    const total = others.reduce((sum, event) => sum + (Number(metric.read(event)) || 0), 0);
    return { ...baseline, [metric.key]: total / others.length };
  }, {});
}

function formatArchiveDate(timestampMs) {
  if (!Number.isFinite(timestampMs)) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestampMs));
}

const README_URL = "https://github.com/BoilerBookClub/number-caller#staff-guide";

/**
 * The staff walkthrough, one short page at a time.
 *
 * Shown by itself the first time somebody opens a control panel for an event —
 * the whole deck if they created it, three pages about the scanning table if they
 * did not — and reachable afterwards from the info button. See
 * src/staffWalkthrough.js for the decks and for how the two roles are told
 * apart.
 *
 * `required` is the first-time showing: no close button and no dismissing by
 * clicking away, because the point is that everyone running a table has been
 * through it once. Opened by hand later it closes like any other modal.
 */
function StaffWalkthroughModal({
  hasPersonalClaim,
  onClose,
  onGetNumber,
  onSeen,
  required = false,
  role,
}) {
  useScrollLock();

  const pages = getStaffWalkthroughPages(role);
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[pageIndex];
  const isFirstPage = pageIndex === 0;
  const isLastPage = pageIndex === pages.length - 1;
  const bodyRef = useRef(null);
  const bodyEdges = useScrollEdges(bodyRef);

  // Page four of the deck should not open halfway down because page three was
  // scrolled there.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [pageIndex]);

  /* Reaching the last page is what counts as having read the deck, not the Done
     press that follows it. Closing marks it read as well, but only the first of
     the two survives a tab closed on the last page or a panel that remounts
     under a reconnect — and somebody who has paged through the whole thing
     should not be cornered by the required showing a second time. */
  useEffect(() => {
    if (isLastPage) {
      onSeen?.();
    }
  }, [isLastPage, onSeen]);

  const goBack = () => setPageIndex((current) => Math.max(0, current - 1));
  const goNext = () =>
    setPageIndex((current) => Math.min(pages.length - 1, current + 1));

  return (
    <div
      className="past-events-backdrop"
      role="presentation"
      onClick={required ? undefined : onClose}
    >
      <SketchCard
        className="sketch-modal-card past-events-modal staff-walkthrough-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Staff walkthrough"
        elevation={1}
        fill="#fffdf8"
        strokeColor="#111111"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="past-events-header">
          <div className="staff-walkthrough-heading">
            <p className="staff-walkthrough-step">
              Step {pageIndex + 1} of {pages.length}
            </p>
            <h2>{page.title}</h2>
          </div>
          {required ? null : (
            <SketchIconButton
              type="button"
              className="timeline-chart-close timeline-chart-close--modal"
              onClick={onClose}
              aria-label="Close the staff walkthrough"
              title="Close the staff walkthrough"
            >
              <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
            </SketchIconButton>
          )}
        </div>
        <ScrollFade edges={bodyEdges}>
          <div
            className="past-events-body staff-walkthrough-body"
            ref={bodyRef}
            onScroll={bodyEdges.onScroll}
          >
            {page.isFinish ? (
              <div className="staff-walkthrough-finish">
                <p className="staff-walkthrough-intro">
                  That's everything. You can reopen this from the info button in the
                  header whenever you need it.
                </p>
                <p className="staff-walkthrough-intro">
                  You have a QR code of your own, which has already been given to you. When the display is
                  showing &ldquo;Starting Soon&rdquo;, you can go pick something up. It stays good for the rest
                  of that round. Show it to whoever is scanning after you pick something
                  up, or mark it off with the button yourself.
                </p>
                {onGetNumber ? (
                  <SketchButton
                    type="button"
                    className="staff-walkthrough-claim-button"
                    onClick={onGetNumber}
                  >
                    <div className="bottom-navbar-content">
                      <Ticket aria-hidden="true" className="button-icon" />
                      <span>{hasPersonalClaim ? "View My QR Code" : "Get My QR Code"}</span>
                    </div>
                  </SketchButton>
                ) : null}
                {role === STAFF_WALKTHROUGH_ROLE.organizer ? (
                  <p className="staff-walkthrough-readme">
                    The{" "}
                    <a href={README_URL} target="_blank" rel="noopener noreferrer">
                      project README
                    </a>{" "}
                    covers the same ground in more detail, plus setup and deployment.
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                {page.intro ? (
                  <p className="staff-walkthrough-intro">{page.intro}</p>
                ) : null}
                {page.ordered ? (
                  <ol className="staff-guide-list">
                    {page.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ol>
                ) : (
                  <ul className="staff-guide-list">
                    {page.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </ScrollFade>
        <div className="staff-walkthrough-footer">
          <SketchButton
            type="button"
            className="secondary-button staff-walkthrough-nav"
            onClick={goBack}
            disabled={isFirstPage}
          >
            Back
          </SketchButton>
          {/* Dots rather than a progress bar: the deck is short enough to count,
              and it tells you how much is left before you start. */}
          <div className="staff-walkthrough-dots" aria-hidden="true">
            {pages.map((dotPage, dotIndex) => (
              <span
                className={`staff-walkthrough-dot${dotIndex === pageIndex ? " staff-walkthrough-dot--active" : ""}${dotIndex < pageIndex ? " staff-walkthrough-dot--done" : ""}`}
                key={dotPage.title}
              />
            ))}
          </div>
          <SketchButton
            type="button"
            className="staff-walkthrough-nav"
            onClick={isLastPage ? onClose : goNext}
          >
            {isLastPage ? "Done" : "Next"}
          </SketchButton>
        </div>
      </SketchCard>
    </div>
  );
}

/**
 * Past events and their metrics.
 *
 * Attendees are archived when an event ends, so this is the only place the
 * history is visible — the archive is not readable from a client directly.
 */
function PastEventsModal({
  onClose,
  onDeleteArchivedEvent,
  onReadArchivedEvent,
  onReadArchivedEvents,
  onRequestConfirmation,
}) {
  const [events, setEvents] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedEventId, setExpandedEventId] = useState("");
  const [openSections, setOpenSections] = useState(() => new Set());
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [baselineChoice, setBaselineChoice] = useState("previous");
  const [deletingEventId, setDeletingEventId] = useState("");

  useScrollLock();

  useEffect(() => {
    let cancelled = false;

    onReadArchivedEvents()
      .then((nextEvents) => {
        if (!cancelled) setEvents(nextEvents);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error?.message || "Could not load past events.");
      });

    return () => {
      cancelled = true;
    };
  }, [onReadArchivedEvents]);

  const eventList = useMemo(() => events ?? [], [events]);

  /*
   * A deleted event can still be the expanded row or the chosen baseline, and
   * both would then point at nothing — so drop those selections once it is gone
   * from the list.
   */
  useEffect(() => {
    if (expandedEventId && !eventList.some((event) => event.eventId === expandedEventId)) {
      setExpandedEventId("");
      setExpandedEvent(null);
      setOpenSections(new Set());
    }

    if (
      baselineChoice !== "previous" &&
      baselineChoice !== "average" &&
      !eventList.some((event) => event.eventId === baselineChoice)
    ) {
      setBaselineChoice("previous");
    }
  }, [baselineChoice, eventList, expandedEventId]);

  /*
   * What each event's numbers are measured against. "Previous" means the next
   * older event in the list, so every row gets its own baseline; the other two
   * choices are fixed. With nothing to compare to, the baseline is zero and the
   * deltas fall back to absolute change.
   */
  const baselineFor = (pastEvent) => {
    if (baselineChoice === "average") {
      return buildAverageBaseline(eventList, pastEvent.eventId);
    }

    if (baselineChoice === "previous") {
      const index = eventList.findIndex((event) => event.eventId === pastEvent.eventId);
      return index >= 0 ? eventList[index + 1] ?? null : null;
    }

    const chosen = eventList.find((event) => event.eventId === baselineChoice);
    return chosen && chosen.eventId !== pastEvent.eventId ? chosen : null;
  };

  const baselineLabel =
    baselineChoice === "average"
      ? "the average of other events"
      : baselineChoice === "previous"
        ? "the previous event"
        : eventList.find((event) => event.eventId === baselineChoice)?.title || "another event";

  /**
   * Graphs and the attendee list open independently, but both need the same
   * fetched detail — so switching events loads once and keeps whichever
   * sections were already open.
   */
  const toggleSection = async (eventId, section) => {
    const isSameEvent = expandedEventId === eventId;
    const nextSections = isSameEvent ? new Set(openSections) : new Set();

    if (nextSections.has(section)) {
      nextSections.delete(section);
    } else {
      nextSections.add(section);
    }

    setOpenSections(nextSections);

    if (!nextSections.size) {
      setExpandedEventId("");
      setExpandedEvent(null);
      return;
    }

    setExpandedEventId(eventId);

    if (isSameEvent && expandedEvent) {
      return;
    }

    setExpandedEvent(null);
    setIsLoadingDetail(true);

    try {
      setExpandedEvent(await onReadArchivedEvent({ eventId }));
    } catch (error) {
      setErrorMessage(error?.message || "Could not load that event.");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  /**
   * Deleting a past event throws its attendees away for good — the archive is
   * the only copy once the live collections have been cleared — so this always
   * goes through the same confirmation the roster uses.
   */
  const deleteEvent = async (pastEvent) => {
    setDeletingEventId(pastEvent.eventId);
    setErrorMessage("");

    try {
      await onDeleteArchivedEvent({ eventId: pastEvent.eventId });
      setEvents((currentEvents) =>
        (currentEvents ?? []).filter((event) => event.eventId !== pastEvent.eventId),
      );
    } catch (error) {
      setErrorMessage(error?.message || "Could not delete that event.");
    } finally {
      setDeletingEventId("");
    }
  };

  const requestDeleteEvent = (pastEvent) => {
    if (!onDeleteArchivedEvent) return;

    const handleDelete = () => deleteEvent(pastEvent);
    const message = `Delete "${pastEvent.title}"? Its attendees and metrics are erased for good.`;

    if (typeof onRequestConfirmation === "function") {
      onRequestConfirmation({
        confirmLabel: "Delete",
        message,
        onConfirm: handleDelete,
        title: "Delete past event?",
        tone: "danger",
      });
      return;
    }

    void handleDelete();
  };

  return (
    <div className="past-events-backdrop" role="presentation" onClick={onClose}>
      <SketchCard
        className="sketch-modal-card past-events-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Past events"
        elevation={1}
        fill="#fffdf8"
        strokeColor="#111111"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="past-events-header">
          <h2>Past Events</h2>
          <SketchIconButton
            type="button"
            className="timeline-chart-close timeline-chart-close--modal"
            onClick={onClose}
            aria-label="Close past events"
            title="Close past events"
          >
            <span className="timeline-chart-close-glyph" aria-hidden="true">×</span>
          </SketchIconButton>
        </div>
        <div className="past-events-body">
          {errorMessage ? <p className="entry-message">{errorMessage}</p> : null}
          {events === null && !errorMessage ? (
            <div className="past-events-loading">
              <Spinner size={72} />
            </div>
          ) : null}
          {events !== null && events.length === 0 ? (
            <p className="past-events-empty">No past events yet. They are saved automatically when an event ends.</p>
          ) : null}

          {eventList.length ? (
            <div className="past-events-compare">
              <span className="past-events-compare-label">Compare against</span>
              <SketchCombo
                className="past-events-compare-combo"
                fullWidth
                selected={baselineChoice}
                onChange={(event) => setBaselineChoice(event.target.value)}
              >
                <wired-item value="previous">Previous event</wired-item>
                <wired-item value="average">Average of other events</wired-item>
                {eventList.map((event) => (
                  <wired-item key={event.eventId} value={event.eventId}>
                    {event.title}
                  </wired-item>
                ))}
              </SketchCombo>
            </div>
          ) : null}

          <div className="past-events-list" role="list">
            {eventList.map((pastEvent) => {
              const isExpanded = expandedEventId === pastEvent.eventId;
              const showGraphs = isExpanded && openSections.has("graphs");
              const showAttendees = isExpanded && openSections.has("attendees");
              const isDeleting = deletingEventId === pastEvent.eventId;

              return (
                <SketchCard
                  key={pastEvent.eventId}
                  className="past-event-card sketch-entry-card"
                  role="listitem"
                  elevation={1}
                  fill="#ffffff"
                  strokeColor="#111111"
                >
                  <div className="past-event-header">
                    <div className="past-event-title-block">
                      <strong>{pastEvent.title}</strong>
                      <span className="past-event-date">
                        {formatArchiveDate(pastEvent.closedAtMs)}
                        {pastEvent.timeframeLabel ? ` · ${pastEvent.timeframeLabel}` : ""}
                      </span>
                    </div>
                    <div className="past-event-actions">
                      <SketchButton
                        type="button"
                        className="secondary-button roster-inline-action"
                        onClick={() => toggleSection(pastEvent.eventId, "graphs")}
                      >
                        {showGraphs ? "Hide Graphs" : "Graphs"}
                      </SketchButton>
                      <SketchButton
                        type="button"
                        className="secondary-button roster-inline-action"
                        onClick={() => toggleSection(pastEvent.eventId, "attendees")}
                      >
                        {showAttendees ? "Hide Attendees" : "Attendees"}
                      </SketchButton>
                      <SketchIconButton
                        type="button"
                        className="roster-remove-button"
                        disabled={!onDeleteArchivedEvent || isDeleting}
                        onClick={() => requestDeleteEvent(pastEvent)}
                        title="Delete this event"
                        aria-label={`Delete ${pastEvent.title}`}
                      >
                        <span className="roster-remove-glyph" aria-hidden="true">×</span>
                      </SketchIconButton>
                    </div>
                  </div>

                  <div className="past-event-metrics">
                    {PAST_EVENT_METRICS.map((metric) => {
                      const value = metric.read(pastEvent);
                      const delta = buildMetricDelta(
                        value,
                        baselineFor(pastEvent) ? baselineFor(pastEvent)[metric.key] : 0,
                      );

                      return (
                        <SketchCard
                          className="past-event-metric sketch-entry-card"
                          key={metric.key}
                          elevation={1}
                          fill="#ffffff"
                          strokeColor="#111111"
                        >
                          <span className="past-event-metric-label">{metric.label}</span>
                          <strong>
                            {metric.key === "attendeesWithItems"
                              ? `${value}/${pastEvent.attendeeCount}`
                              : value}
                          </strong>
                          <span
                            className={`past-event-delta past-event-delta--${delta.tone}`}
                            title={`Compared with ${baselineLabel}`}
                          >
                            {delta.label}
                          </span>
                        </SketchCard>
                      );
                    })}
                  </div>

                  {isExpanded ? (
                    <div className="past-event-attendees">
                      {isLoadingDetail ? (
                        <div className="past-events-loading past-events-loading--inline">
                          <Spinner size={48} />
                        </div>
                      ) : null}
                      {showGraphs && expandedEvent ? (
                        <div className="past-event-graphs">
                          <TimelineChart
                            emptyText="No timestamped joins were recorded."
                            showEmptyGraphWhenNoData
                                            showExpandButton={false}
                            timestamps={expandedEvent.attendees
                              .map((attendee) => attendee.joinedAtMs)
                              .filter((value) => Number.isFinite(value))}
                            title="Joined"
                            tone="claims"
                          />
                          <TimelineChart
                            emptyText="No timestamped item claims were recorded."
                            showEmptyGraphWhenNoData
                                            showExpandButton={false}
                            timestamps={expandedEvent.attendees.flatMap((attendee) =>
                              attendee.itemClaimedAtMsHistory?.length
                                ? attendee.itemClaimedAtMsHistory
                                : Number.isFinite(attendee.redeemedAtMs)
                                  ? [attendee.redeemedAtMs]
                                  : [],
                            )}
                            title="Item Claims"
                            tone="items"
                          />
                        </div>
                      ) : null}
                      {showAttendees && expandedEvent?.attendees?.length ? (
                        <div className="roster-list roster-list--group" role="list">
                          {expandedEvent.attendees.map((attendee) => (
                            <RosterRow
                              key={attendee.claimId}
                              claim={attendee}
                              statusLabel={attendee.itemsClaimedCount > 0 ? "" : "No items"}
                            />
                          ))}
                        </div>
                      ) : null}
                      {showAttendees && !isLoadingDetail && expandedEvent && !expandedEvent.attendees.length ? (
                        <p>No attendees were recorded for this event.</p>
                      ) : null}
                    </div>
                  ) : null}
                </SketchCard>
              );
            })}
          </div>
        </div>
      </SketchCard>
    </div>
  );
}

/*
 * Drawn here rather than with a SketchCard, because the one thing this frame
 * needs is the one thing wired-elements fixes internally: how far apart the two
 * strokes of a sketched line fall. wired-lib hardcodes maxRandomnessOffset at 2,
 * so widening the stroke enough to read over a camera image only fused the pair
 * into a single slab. Driving roughjs directly — the same library underneath
 * wired-elements, so the hand is identical — separates the two concerns.
 *
 * Four corner brackets rather than a closed box: the frame is a guide, not a
 * boundary — the region actually read is larger than it — and corners say
 * "line it up in here" without drawing a line anyone might try to fit a code
 * inside. It is also the shape every camera app uses for this, so it needs no
 * explaining.
 *
 * Each bracket is drawn twice, a fixed distance apart, rather than left to
 * roughjs's own double pass: that pass puts its second stroke wherever the
 * noise lands, which on a straight edge is often right on top of the first.
 * Drawing the pair outright is what guarantees daylight along both arms.
 *
 * Sizes are in real pixels rather than a scaled viewBox, so the frame keeps the
 * weight of the drawn borders elsewhere at any screen size. currentColor hands
 * the tone back to CSS, and the seeds are fixed so a redraw reproduces the same
 * line instead of reshuffling it under the viewer.
 */
const SCANNER_RETICLE_OPTIONS = {
  bowing: 0.6,
  disableMultiStroke: true,
  maxRandomnessOffset: 2,
  roughness: 1.2,
  stroke: "currentColor",
  strokeWidth: 2,
};

const SCANNER_RETICLE_INSET = 10;
const SCANNER_RETICLE_GAP = 6;
const SCANNER_RETICLE_SEEDS = [42, 1337];
/* How far each arm runs along its side, as a fraction of the shorter one. Short
   enough that the four brackets never meet on a square frame, long enough to
   fix the corner in the eye. */
const SCANNER_RETICLE_ARM_RATIO = 0.22;

/** One corner's two arms, as a path that turns at the corner point. */
function buildScannerReticleCorners({ arm, height, width }, inset) {
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;

  return [
    [
      [left, top + arm],
      [left, top],
      [left + arm, top],
    ],
    [
      [right - arm, top],
      [right, top],
      [right, top + arm],
    ],
    [
      [right, bottom - arm],
      [right, bottom],
      [right - arm, bottom],
    ],
    [
      [left + arm, bottom],
      [left, bottom],
      [left, bottom - arm],
    ],
  ];
}

function ScannerReticle({ isHidden, videoRef }) {
  const svgRef = useRef(null);
  /* Drawn over the room, so it takes its ink from the room: pale over a dark
     scene, dark over a light one. Parked while the frame is hidden — there is
     nothing to read against behind the scan status. */
  const backdropTone = useCameraBackdropTone(videoRef, { isActive: !isHidden });

  useEffect(() => {
    const svgElement = svgRef.current;

    if (!svgElement) {
      return undefined;
    }

    const draw = () => {
      const { width, height } = svgElement.getBoundingClientRect();

      if (!width || !height) {
        return;
      }

      const generator = rough.svg(svgElement);
      const arm = Math.min(width, height) * SCANNER_RETICLE_ARM_RATIO;

      svgElement.replaceChildren(
        ...SCANNER_RETICLE_SEEDS.flatMap((seed, index) => {
          const inset = SCANNER_RETICLE_INSET + index * SCANNER_RETICLE_GAP;

          // A seed per corner as well as per pass, so the four are not four
          // copies of one wobble rotated about the middle.
          return buildScannerReticleCorners({ arm, height, width }, inset).map(
            (points, cornerIndex) =>
              generator.linearPath(points, {
                ...SCANNER_RETICLE_OPTIONS,
                seed: seed + cornerIndex,
              }),
          );
        }),
      );
    };

    draw();

    // The frame is sized in viewport units, so a rotation or a resize changes it.
    // The pulse is a transform and leaves the border box alone, so it never
    // triggers this.
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;

    resizeObserver?.observe(svgElement);

    return () => {
      resizeObserver?.disconnect();
    };
  }, []);

  return (
    <div
      className={
        `scanner-reticle scanner-reticle--on-${backdropTone}` +
        `${isHidden ? " scanner-reticle--hidden" : ""}`
      }
      aria-hidden="true"
    >
      <svg ref={svgRef} className="scanner-reticle-frame" />
    </div>
  );
}

/* ---- Scan status ------------------------------------------------------
 *
 * One centred report on the scan, in place of the strip that used to sit at the
 * foot of the screen. The camera pauses while a scan is in flight and the feed
 * dims behind the report, so the middle of the screen — where the operator is
 * already looking — is where the answer lands.
 */

// How long the wash takes to clear once the verdict is done with. Mirrors the
// transition on .scanner-status--leaving; the pair has to stay in step, since
// this is what holds the overlay in the DOM long enough to be seen fading.
const SCANNER_STATUS_LEAVE_MS = 260;

/**
 * The middle of the screen while a scan is in flight, and just after it lands.
 *
 * The spinner while the code is being redeemed, then the verdict, which
 * App.jsx clears on a timer. What it shows is held in state rather than read
 * straight off the props, because the two part company on the way out: the
 * props go quiet the instant the verdict is cleared, and this has to keep
 * drawing the mark for as long as the wash behind it takes to fade.
 */
function ScannerStatusOverlay({ scanFeedback, scanLoading }) {
  const isShowing = scanLoading || Boolean(scanFeedback);
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!isShowing) {
      return;
    }

    setReport(scanLoading ? { tone: "loading" } : scanFeedback);
  }, [isShowing, scanFeedback, scanLoading]);

  // Cleared only once the fade is over, so the spinner stops its frame loop and
  // the mark leaves the accessibility tree rather than lingering invisibly.
  useEffect(() => {
    if (isShowing || !report) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setReport(null);
    }, SCANNER_STATUS_LEAVE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isShowing, report]);

  if (!report) {
    return null;
  }

  const isLoading = report.tone === "loading";

  return (
    <div
      className={`scanner-status${isShowing ? "" : " scanner-status--leaving"}`}
      role="status"
      aria-live="polite"
      aria-hidden={isShowing ? undefined : "true"}
    >
      {isLoading ? (
        <>
          <Spinner size={104} />
          <p className="scanner-status-message">
            Processing scan
            <span className="scanner-status-ellipsis" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        </>
      ) : (
        <>
          {/* Keyed on the message so a second scan redraws the mark rather
              than leaving the first one's strokes standing. */}
          <StatusMark key={report.message} tone={report.tone} />
          <p className="scanner-status-message">{report.message}</p>
        </>
      )}
    </div>
  );
}

function ScannerModal({ onClose, scanFeedback, scanLoading, scannerVideoRef }) {
  /* The guide frame and the hint below it are for lining a code up, and once
     one has been read there is nothing left to line up: both step aside for
     the centred status, and come back when it clears. */
  const isScanReported = scanLoading || Boolean(scanFeedback);

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
            <span className="sketch-icon-glyph" aria-hidden="true">×</span>
          </SketchIconButton>
        </div>
        <div className="scanner-modal-body">
          <video ref={scannerVideoRef} className="scanner-video scanner-video--modal" muted playsInline />
          {/* A guide, not a boundary: qr-scanner reads a centred square of two
              thirds of the camera's shorter side, which always covers more of
              the screen than this frame does, so anything framed here scans. */}
          <ScannerReticle isHidden={isScanReported} videoRef={scannerVideoRef} />
        </div>
        <div
          className={`scanner-modal-footer${isScanReported ? " scanner-modal-footer--hidden" : ""}`}
        >
          <SketchCard className="scanner-hint-card" elevation={1} redrawOnResize>
            <p>Point the camera at an attendee&apos;s QR code.</p>
          </SketchCard>
        </div>
        <ScannerStatusOverlay scanFeedback={scanFeedback} scanLoading={scanLoading} />
      </SketchCard>
    </div>
  );
}

/**
 * The raffle, as the other half of the queue card.
 *
 * Deliberately built to the same shape as the group panel it swaps with —
 * corner controls, a title, a settings drawer, one primary action, then a list
 * in the body. Calling a group and running a raffle are mutually exclusive
 * things to be doing with the display, so they are mutually exclusive panels
 * rather than a panel and a modal on top of it.
 */
function RafflePanel({
  eligibleClaims,
  liveState,
  onOptionChange,
  onPreviewAttendeeTicket,
  onRemoveClaim,
  onRequestConfirmation,
  onResetWinners,
  primaryAction,
  winnerEntries,
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsMounted, setIsSettingsMounted] = useState(false);
  const winnerListRef = useRef(null);
  const winnerListEdges = useScrollEdges(winnerListRef);
  const phase = useRaffleSpin({
    spinCount: liveState.raffleSpinCount,
    spinStartedAtMs: liveState.raffleSpinStartedAtMs,
    winnerNumber: liveState.raffleWinnerNumber,
  });
  const isSpinning = phase === RAFFLE_PHASE.spinning;
  const isRevealed = phase === RAFFLE_PHASE.revealed;
  const eligibleCount = eligibleClaims.length;
  const memberChances = normalizeRaffleMemberChances(liveState.raffleMemberChances);
  /* Members-only already restricts the wheel to members, so weighting them
     against each other changes nothing. Shown inactive rather than hidden, so
     the setting does not appear to have gone missing. */
  const isMemberChancesActive = !liveState.raffleMembersOnly;
  const drawSummary = isSpinning
    ? "Spinning the wheel..."
    : `${eligibleCount} ${eligibleCount === 1 ? "person" : "people"} in the draw${liveState.raffleMembersOnly ? " (members only)" : ""}${liveState.raffleRequireOptIn ? " (joined)" : ""}${liveState.raffleAllowStaff ? " (staff included)" : ""}`;
  const collectedCount = winnerEntries.filter((entry) => entry.hasCollectedPrize).length;
  const collectedProgress = winnerEntries.length > 0 ? collectedCount / winnerEntries.length : 0;

  /* Mirrors the group panel's settings drawer, including the closing
     animation, so the two feel like one control in two modes. */
  useEffect(() => {
    if (isSettingsOpen) {
      setIsSettingsMounted(true);
      return undefined;
    }

    if (!isSettingsMounted) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsSettingsMounted(false);
    }, AUTO_SETTINGS_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSettingsMounted, isSettingsOpen]);

  return (
    <SketchCard
      className={`entry-card compact-card queue-card sketch-entry-card${isSettingsMounted ? " queue-card--settings-open" : ""}`}
      elevation={2}
    >
      <div className="queue-card-sticky-top">
        <div className="queue-corner-actions">
          <SketchIconButton
            className={`secondary-button queue-corner-button${isSettingsOpen ? " queue-corner-button--active" : ""}`}
            type="button"
            onClick={() => setIsSettingsOpen((currentValue) => !currentValue)}
            aria-label="Raffle settings"
            title="Raffle settings"
          >
            <Settings
              aria-hidden="true"
              className="button-icon queue-corner-button-icon queue-corner-button-icon--settings"
            />
          </SketchIconButton>
        </div>
        <div className="queue-corner-primary">
          <SketchButton
            className={`control-primary-action queue-primary-action${primaryAction.isReady ? " ready-button" : ""}${primaryAction.isDisplaySwitch ? " queue-primary-action--switch" : ""}`}
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
          >
            {primaryAction.label}
          </SketchButton>
        </div>
        <h2 className="queue-title">
          <span>Raffle</span>
        </h2>
        {/* Stays put under the title whether or not the drawer is open, like
            the group panel's round label — the draw count is what the panel is
            about, not a setting, so it should not appear to move into the
            settings drawer. */}
        <p className="queue-timer queue-round-label">{drawSummary}</p>

        {isSettingsMounted ? (
          <SketchCard
            className={`queue-auto-advance-panel sketch-entry-card${isSettingsOpen ? " queue-auto-advance-panel--open" : " queue-auto-advance-panel--closing"}`}
            elevation={1}
          >
            <p className="queue-auto-advance-summary">
              {liveState.raffleMembersOnly
                ? "Members only, and previous winners are excluded unless you allow repeats."
                : "Everyone with a number is in the draw."}
            </p>
            <div className="queue-auto-advance-settings-grid">
              <SketchCard
                className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title">Members Only</span>
                  <SketchToggle
                    className="queue-auto-advance-toggle"
                    checked={Boolean(liveState.raffleMembersOnly)}
                    onChange={(event) => onOptionChange("raffleMembersOnly", event.target.checked)}
                  />
                </label>
                <span className="queue-auto-advance-setting-copy">
                  {liveState.raffleMembersOnly
                    ? "Only members are on the wheel."
                    : "Everyone with a number is on the wheel."}
                </span>
              </SketchCard>
              <SketchCard
                className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title">Member Chances</span>
                </label>
                <SettingSlider
                  inactive={!isMemberChancesActive}
                  min={RAFFLE_MEMBER_CHANCES_MIN}
                  max={RAFFLE_MEMBER_CHANCES_MAX}
                  step={1}
                  value={memberChances}
                  formatValue={(chances) => `${chances}x`}
                  onCommit={(nextValue) =>
                    onOptionChange(
                      "raffleMemberChances",
                      normalizeRaffleMemberChances(nextValue),
                    )
                  }
                />
                <span className="queue-auto-advance-setting-copy">
                  {!isMemberChancesActive
                    ? "No effect while Members Only is on — everybody on the wheel is a member."
                    : memberChances === 1
                      ? "Members and guests have the same chance. Raise this to give members a wider slice."
                      : `Members get ${memberChances} entries to a guest's one, and a slice ${memberChances} times as wide.`}
                </span>
              </SketchCard>
              <SketchCard
                className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title">Staff In Draw</span>
                  <SketchToggle
                    className="queue-auto-advance-toggle"
                    checked={Boolean(liveState.raffleAllowStaff)}
                    onChange={(event) => onOptionChange("raffleAllowStaff", event.target.checked)}
                  />
                </label>
                <span className="queue-auto-advance-setting-copy">
                  {liveState.raffleAllowStaff
                    ? "Staff are on the wheel alongside the attendees."
                    : "Staff are off the wheel. The people running the raffle do not win it."}
                </span>
              </SketchCard>
              <SketchCard
                className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title">Must Join</span>
                  <SketchToggle
                    className="queue-auto-advance-toggle"
                    checked={Boolean(liveState.raffleRequireOptIn)}
                    onChange={(event) =>
                      onOptionChange("raffleRequireOptIn", event.target.checked)
                    }
                  />
                </label>
                <span className="queue-auto-advance-setting-copy">
                  {liveState.raffleRequireOptIn
                    ? "Attendees get a Join button on their ticket, and only those who press it are on the wheel."
                    : "Everybody eligible is on the wheel without having to do anything."}
                </span>
              </SketchCard>
              <SketchCard
                className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title">Repeat Winners</span>
                  <SketchToggle
                    className="queue-auto-advance-toggle"
                    checked={Boolean(liveState.raffleAllowRepeatWinners)}
                    onChange={(event) =>
                      onOptionChange("raffleAllowRepeatWinners", event.target.checked)
                    }
                  />
                </label>
                <span className="queue-auto-advance-setting-copy">
                  {liveState.raffleAllowRepeatWinners
                    ? "Previous winners are back on the wheel and can win again."
                    : "Anyone who has already won this event is off the wheel."}
                </span>
              </SketchCard>
              <SketchCard
                className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                elevation={1}
                fill="#ffffff"
                strokeColor="#111111"
              >
                {/*
                  A div rather than the <label> the other cards use: those wrap
                  a toggle, and wrapping a button in a label instead gives you
                  an interactive control inside a label for nothing. Same
                  classes, so it sits in the corner exactly where the toggles do.

                  The button reads "Clear" because the card is already titled
                  Winner List — the two are read together, the way a toggle is.
                */}
                <div className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                  <span className="queue-auto-advance-setting-title">Winner List</span>
                  <SketchButton
                    className="secondary-button roster-inline-action"
                    type="button"
                    disabled={isSpinning || winnerEntries.length === 0}
                    title="Clear the winner list"
                    aria-label="Clear the winner list"
                    onClick={() =>
                      onRequestConfirmation({
                        confirmLabel: "Clear Winners",
                        message:
                          "Every previous winner goes back into the draw and their prize QR codes stop working.",
                        onConfirm: onResetWinners,
                        title: "Clear the winner list?",
                        tone: "danger",
                      })
                    }
                  >
                    Clear
                  </SketchButton>
                </div>
                <span className="queue-auto-advance-setting-copy">
                  {winnerEntries.length === 0
                    ? "Nobody has won yet, so there is nothing to clear."
                    : "Puts every winner back in the draw and stops their prize codes working."}
                </span>
              </SketchCard>
            </div>
          </SketchCard>
        ) : null}

      </div>

      <div className="queue-card-body">
        {winnerEntries.length > 0 ? (
          <>
            {/* Same bar as the queue's Claimed card, reused rather than
                reinvented: staff already read that shape as "how many of
                these people are done," and a collected prize is the same
                question asked of the winner list instead of the group. */}
            <div className="queue-summary" aria-label="Prize collection status">
              <div
                className={`queue-summary-card queue-summary-card--claimed${collectedCount === winnerEntries.length ? " queue-summary-card--complete" : ""}`}
              >
                <div className="queue-claimed-progress-wrap">
                  <SketchProgress
                    className="queue-claimed-progress"
                    value={Math.max(0, Math.min(1, collectedProgress)) * 100}
                    min={0}
                    max={100}
                    aria-hidden="true"
                  />
                  <span className="queue-claimed-progress-label">
                    <span className="progress-label-main">
                      <span>Prizes Collected</span>
                      <strong>
                        {collectedCount}/{winnerEntries.length}
                      </strong>
                    </span>
                  </span>
                </div>
              </div>
            </div>
            {/* Same row as the attendee list, for the same reason: staff are
                already reading these all evening, and a winner is an attendee
                with one extra fact attached. */}
            <ScrollFade edges={winnerListEdges}>
              <div
                className="roster-list raffle-winner-roster"
                role="list"
                ref={winnerListRef}
                onScroll={winnerListEdges.onScroll}
              >
                {winnerEntries.map((entry) => (
                  <RosterRow
                    key={entry.number}
                    /*
                      The one the wheel just landed on, marked in the list itself
                      rather than announced in a card above it. It is the same row
                      staff are already reading, in the paper the announcement used
                      to be printed on, and it settles back into an ordinary row
                      the moment the winner is cleared — or the moment the display
                      goes back to the group, which clears the winner with it.
                    */
                    isWinner={
                      isRevealed &&
                      liveState.raffleOpen &&
                      entry.number === liveState.raffleWinnerNumber
                    }
                    claim={
                      entry.claim ?? {
                        avatarUrl: "",
                        displayName: "No longer on the roster",
                        isMember: false,
                        number: entry.number,
                      }
                    }
                    isClaimed={entry.hasCollectedPrize}
                    showItemCount={false}
                    actions={
                      <RosterRowActions
                        menuLabel={`More actions for ${entry.claim?.displayName || `number ${formatClaimNumber(entry.number)}`}`}
                      >
                        {/* The same two controls the attendee list carries, so a
                            winner can be dealt with without leaving here: open
                            their ticket when their own phone cannot, or take them
                            off the event entirely. Both need a claim that is
                            still on the roster. */}
                        <SketchIconButton
                          type="button"
                          className="secondary-button roster-qr-button"
                          onClick={() => onPreviewAttendeeTicket?.(entry.claim.claimId)}
                          disabled={!entry.claim || !onPreviewAttendeeTicket}
                          title={`Open ${entry.claim?.displayName || "attendee"}'s ticket`}
                          aria-label={`Open the attendee view of ${entry.claim?.displayName || "attendee"} (${formatClaimNumber(entry.number)})`}
                        >
                          <QrCode aria-hidden="true" className="button-icon" />
                        </SketchIconButton>
                        <SketchIconButton
                          type="button"
                          className="roster-remove-button"
                          disabled={!entry.claim || !onRemoveClaim}
                          onClick={() => {
                            if (!entry.claim || !onRemoveClaim) {
                              return;
                            }

                            onRequestConfirmation({
                              confirmLabel: "Remove",
                              message: `Remove ${entry.claim.displayName || "attendee"} (${formatClaimNumber(entry.number)}) from the event? This also takes away their number and their prize code.`,
                              onConfirm: () => onRemoveClaim(entry.claim.claimId),
                              title: "Remove attendee?",
                              tone: "danger",
                            });
                          }}
                          title="Remove attendee from the event"
                          aria-label={`Remove ${entry.claim?.displayName || "attendee"} (${formatClaimNumber(entry.number)})`}
                        >
                          <Trash2 aria-hidden="true" className="button-icon" />
                        </SketchIconButton>
                      </RosterRowActions>
                    }
                  />
                ))}
              </div>
            </ScrollFade>
            <p className="raffle-winner-history-copy">
              Prize codes stay valid all event, so an earlier winner can still collect after a
              later spin. Collecting a prize never counts as an item claim.
            </p>
          </>
        ) : (
          <p className="roster-filter-empty">
            Nobody has won a prize yet. Put the wheel up and press Spin.
          </p>
        )}
      </div>
    </SketchCard>
  );
}

function ControlPage({
  headerActionsNode,
  activeQueueClaims,
  activeQueueElapsedLabel,
  autoAdvanceBacklogClearedPercent,
  autoAdvanceBacklogLimitEnabled,
  autoAdvanceEnabled,
  autoAdvanceFinalCallTimerEnabled,
  autoAdvanceFinalCallTimerMinutes,
  autoAdvanceGroupTimerEnabled,
  autoAdvanceGroupTimerMinutes,
  autoAdvanceNextGroup,
  autoAdvanceStartRound,
  autoAdvanceStartRoundMinutes,
  autoAdvanceThresholdPercent,
  groupSize,
  backlogClaims,
  backtrackStep,
  calledSoFarCount,
  controlForm,
  controlMessage,
  controlSaving,
  currentTime,
  currentEventClaims,
  currentRound,
  demoStatus,
  hasPersonalClaim,
  isDemoEvent,
  isDemoPaused,
  isEventDetailsModalOpen,
  isKeepScreenAwakeEnabled,
  isKeepScreenAwakeSupported,
  isEventLive,
  isEventStarted,
  isLastGroup,
  liveState,
  eventStartTimeMs,
  onActivateFinalCall,
  onBacktrack,
  onToggleDemoPaused,
  onAutoAdvanceActionChange,
  onAutoAdvanceBacklogClearedPercentChange,
  onAutoAdvanceGroupTimerMinutesChange,
  onAutoAdvanceStartRoundMinutesChange,
  onAutoAdvanceTimerMinutesChange,
  onAutoAdvanceThresholdChange,
  onCloseEvent,
  onCloseEventDetails,
  onDismissControlMessage,
  onFieldChange,
  onIncrement,
  onOpenDisplayScreen,
  onToggleKeepScreenAwake,
  onFetchLatestAnnouncement,
  onOpenEventDetails,
  staffName,
  onDeleteArchivedEvent,
  onReadArchivedEvent,
  onReadArchivedEvents,
  onOpenScanner,
  onOpenSelfClaim,
  onPreviewAttendeeTicket,
  onClearRaffleWinner,
  onCloseRaffle,
  onOpenRaffle,
  onRaffleOptionChange,
  onResetRaffleWinners,
  onSpinRaffle,
  raffleEligibleClaims,
  raffleWinnerEntries,
  preclaims,
  onAssignPreclaimAsStaff,
  onMoveClaimBackToQueueAsStaff,
  onRefreshAllPreclaimMembershipsAsStaff,
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
  roundElapsedLabel,
  scanFeedback,
  scanLoading,
  scannerActive,
  scannerVideoRef,
  totalPeopleWithNumbers,
}) {
  const [isPastEventsOpen, setIsPastEventsOpen] = useState(false);
  /* Which half of the queue card is on screen. Local to this panel — it is a
     view, not event state, so two staff can be looking at different halves. */
  const [activePanel, setActivePanel] = useState("groups");
  /* The walkthrough, and which deck it is showing. `required` is the automatic
     first showing, which cannot be dismissed until it has been paged through;
     opening it from the info button is not. */
  const [walkthrough, setWalkthrough] = useState({
    open: false,
    required: false,
    role: STAFF_WALKTHROUGH_ROLE.organizer,
  });
  const [isAutoAdvanceSettingsOpen, setIsAutoAdvanceSettingsOpen] = useState(false);
  const [isAutoAdvanceSettingsMounted, setIsAutoAdvanceSettingsMounted] = useState(false);
  const [isAttendeeGraphOpen, setIsAttendeeGraphOpen] = useState(false);
  /* Current-group defaults open (matching what this panel always showed
     before it became toggleable); backlog defaults closed, as it always
     has. Either, neither, or — screen permitting — both can be open.
     Whichever staff last picked is remembered per event — see the
     groupPanelOpenKey/backlogPanelOpenKey effects below. */
  const [isGroupPanelOpen, setIsGroupPanelOpen] = useState(true);
  const [isBacklogOpen, setIsBacklogOpen] = useState(false);
  const isQueuePanelSplitDisabled = useIsNarrowViewport(QUEUE_PANEL_SPLIT_BREAKPOINT_PX);
  const isHeaderActionsCollapsed = useIsNarrowViewport(HEADER_ACTIONS_COLLAPSE_BREAKPOINT_PX);
  const isSelfClaimInNavbar = useIsNarrowViewport(NAVBAR_SELF_CLAIM_BREAKPOINT_PX);
  const confirmActionRef = useRef(null);
  const [confirmDialogState, setConfirmDialogState] = useState({
    /* When set, the dialog grows a checkbox above its buttons and hands its
       value to the confirm action. Only the back button uses it so far. */
    checkboxLabel: "",
    confirmLabel: "Confirm",
    message: "",
    open: false,
    title: "Confirm action",
    tone: "danger",
  });
  const [isConfirmDialogChecked, setIsConfirmDialogChecked] = useState(false);
  /* Whether staff have already told this browser to stop asking before a
     rewind. Per event, and read once the event id is known rather than on
     every render — see buildBacktrackConfirmSkippedKey. */
  const backtrackConfirmSkippedKey = liveEvent?.eventId
    ? buildBacktrackConfirmSkippedKey(liveEvent.eventId)
    : "";
  const [isBacktrackConfirmSkipped, setIsBacktrackConfirmSkipped] = useState(false);

  useEffect(() => {
    if (!backtrackConfirmSkippedKey) {
      setIsBacktrackConfirmSkipped(false);
      return;
    }

    setIsBacktrackConfirmSkipped(readStoredBoolean(backtrackConfirmSkippedKey));
  }, [backtrackConfirmSkippedKey]);

  /* Which of the current-group/backlog lists staff had open last, per event —
     same idea as backtrackConfirmSkippedKey above. */
  const groupPanelOpenKey = liveEvent?.eventId
    ? buildQueuePanelOpenKey(liveEvent.eventId, "group")
    : "";
  const backlogPanelOpenKey = liveEvent?.eventId
    ? buildQueuePanelOpenKey(liveEvent.eventId, "backlog")
    : "";

  useEffect(() => {
    setIsGroupPanelOpen(
      groupPanelOpenKey ? readStoredBooleanOrDefault(groupPanelOpenKey, true) : true,
    );
  }, [groupPanelOpenKey]);

  useEffect(() => {
    setIsBacklogOpen(
      backlogPanelOpenKey ? readStoredBooleanOrDefault(backlogPanelOpenKey, false) : false,
    );
  }, [backlogPanelOpenKey]);

  /*
   * Everyone working an event goes through the walkthrough once.
   *
   * Whoever created the event from this browser gets the full deck the moment it
   * starts; anyone else opening the panel gets the four scanning-table pages
   * instead. Seen is remembered per event and per deck, so the next event asks
   * again and somebody promoted from helper to organizer still sees the deck
   * they have not read.
   */
  const walkthroughEventId = isEventLive ? liveEvent?.eventId || "" : "";

  useEffect(() => {
    if (!walkthroughEventId) {
      return;
    }

    const role = resolveStaffWalkthroughRole(walkthroughEventId);

    if (hasSeenStaffWalkthrough(walkthroughEventId, role)) {
      return;
    }

    setWalkthrough({ open: true, required: true, role });
  }, [walkthroughEventId]);

  const openWalkthrough = () => {
    setWalkthrough({
      open: true,
      required: false,
      role: walkthroughEventId
        ? resolveStaffWalkthroughRole(walkthroughEventId)
        : STAFF_WALKTHROUGH_ROLE.organizer,
    });
  };

  /* Stable across renders: the modal fires this from an effect the moment the
     last page comes up, and a fresh identity every render would rewrite the key
     on every one of them. */
  const markWalkthroughSeen = useCallback(() => {
    markStaffWalkthroughSeen(walkthroughEventId, walkthrough.role);
  }, [walkthroughEventId, walkthrough.role]);

  const closeWalkthrough = () => {
    markWalkthroughSeen();
    setWalkthrough((current) => ({ ...current, open: false }));
  };

  /* Leaves for the claim screen, so the deck it was opened from is finished
     with either way — mark it read before the panel unmounts. */
  const handleWalkthroughGetNumber = () => {
    closeWalkthrough();
    onOpenSelfClaim?.();
  };
  /*
   * Which of the two the room is looking at. The display can only be doing one
   * of these things at a time, and every event starts on the round.
   */
  const isWheelUp = Boolean(liveState.raffleOpen);
  const rafflePhase = useRaffleSpin({
    spinCount: liveState.raffleSpinCount,
    spinStartedAtMs: liveState.raffleSpinStartedAtMs,
    winnerNumber: liveState.raffleWinnerNumber,
  });
  const isRaffleSpinning = rafflePhase === RAFFLE_PHASE.spinning;
  const queueEmptyText = liveState.finalCall
    ? "Everyone from the final-call list has claimed an item."
    : liveState.current === 0
      ? ""
      : "No attendees are in the current group.";
  const isCurrentGroupFullyClaimed =
    !liveState.finalCall &&
    liveState.current > 0 &&
    activeQueueClaims.length > 0 &&
    activeQueueClaims.every((claim) => hasClaimedInRound(claim, currentRound));
  const canStartRound = totalPeopleWithNumbers > 0;
  const isReadyForFinalCall = isLastGroup && isCurrentGroupFullyClaimed;
  const isFinalCallFullyClaimed =
    liveState.finalCall &&
    (activeQueueClaims.length === 0 ||
      activeQueueClaims.every((claim) => hasClaimedInRound(claim, currentRound)));
  const currentRoundClaimedCount = currentEventClaims.filter((claim) =>
    hasClaimedInRound(claim, currentRound),
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
    ? (isEventStarted ? "Live For: " : "Starts In: ")
    : "Status: ";
  const eventTimerValue = hasScheduledEventStart
    ? formatStatusDuration(isEventStarted ? eventElapsedMs : eventCountdownMs)
    : (isEventStarted ? "Live" : "--:--");
  /* What turning the corner button on would actually do, spelled out for the
     confirm dialog below — every setting, not just the ones currently active,
     since staff are agreeing to the whole configuration, off switches
     included. */
  const autoAdvanceConfigSummary = [
    `${groupSize} ${groupSize === 1 ? "person" : "people"} per group.`,
    autoAdvanceNextGroup
      ? `Next group at ${autoAdvanceThresholdPercent}% claimed.`
      : "Next group: off, advance manually.",
    autoAdvanceGroupTimerEnabled
      ? `Group timer: ${autoAdvanceGroupTimerMinutes} minute${autoAdvanceGroupTimerMinutes === 1 ? "" : "s"}.`
      : "Group timer: off.",
    autoAdvanceStartRound
      ? `Next round starts after ${autoAdvanceStartRoundMinutes} minute${autoAdvanceStartRoundMinutes === 1 ? "" : "s"}.`
      : "Next round: off, start it yourself.",
    autoAdvanceFinalCallTimerEnabled
      ? `Final call timer: ${autoAdvanceFinalCallTimerMinutes} minute${autoAdvanceFinalCallTimerMinutes === 1 ? "" : "s"}.`
      : "Final call timer: off.",
    autoAdvanceBacklogLimitEnabled
      ? `Backlog limit: holds until ${autoAdvanceBacklogClearedPercent}% cleared.`
      : "Backlog limit: off.",
  ].join(" ");
  const shouldShowInlineBacklog = liveState.finalCall;
  const backlogToggleLabel = `Backlog (${backlogClaims.length})`;
  /* Both lists actually on screen at once, each in half the width. */
  const isQueueSplitView = isGroupPanelOpen && isBacklogOpen;
  /* On a screen too narrow for the two lists to sit side by side, opening one
     closes the other — same single-selection feel as the Groups/Raffle tabs
     above, just without forcing a choice: both can still be closed. */
  const handleToggleGroupPanel = () => {
    setIsGroupPanelOpen((current) => {
      const next = !current;
      if (next && isQueuePanelSplitDisabled) {
        setIsBacklogOpen(false);
        if (backlogPanelOpenKey) {
          window.localStorage.setItem(backlogPanelOpenKey, "false");
        }
      }
      if (groupPanelOpenKey) {
        window.localStorage.setItem(groupPanelOpenKey, String(next));
      }
      return next;
    });
  };
  const handleToggleBacklogPanel = () => {
    setIsBacklogOpen((current) => {
      const next = !current;
      if (next && isQueuePanelSplitDisabled) {
        setIsGroupPanelOpen(false);
        if (groupPanelOpenKey) {
          window.localStorage.setItem(groupPanelOpenKey, "false");
        }
      }
      if (backlogPanelOpenKey) {
        window.localStorage.setItem(backlogPanelOpenKey, String(next));
      }
      return next;
    });
  };
  useEffect(() => {
    if (isQueuePanelSplitDisabled && isGroupPanelOpen && isBacklogOpen) {
      setIsBacklogOpen(false);
    }
  }, [isQueuePanelSplitDisabled, isGroupPanelOpen, isBacklogOpen]);
  /*
   * Each panel's primary action doubles as the way to hand the display over.
   *
   * The room is looking at exactly one of the two, so the interesting question
   * on the panel that is *not* being shown is never "what is the next step
   * here" — it is "put this on the screen". Rather than a separate on-air
   * button in each corner, the panel you are looking at while the other one is
   * up offers the handover as its one action, and goes back to offering the
   * next step the moment it has the display. The ON DISPLAY badge on the tabs
   * says which of them that is.
   */
  const baseQueueAction = liveState.raffleOpen
    ? {
        /* Not mid-spin: the wheel is the only thing announcing a winner, and
           pulling it off the screen while it is still turning takes the result
           away from the room before anyone has seen it. */
        disabled: isRaffleSpinning,
        isDisplaySwitch: true,
        label: "Display Group",
        onClick: onCloseRaffle,
      }
    : !liveState.finalCall
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
            /* Nothing called yet means the round is pending, whichever round it
               is — and with the Next Round timer off, this button is the only way
               out of that state. */
            label:
              liveState.current === 0
                ? `Start Round ${liveState.round}`
                : "Next Group",
            onClick: () => onIncrement(groupSize),
          }
      : {
          disabled: false,
          isReady: isFinalCallFullyClaimed,
          label: "Next Round",
          onClick: onNewRound,
        };

  /*
   * Every step of that progression greys its own button out for a beat once
   * taken — see useAdvanceCooldown. The press starts the cooldown itself,
   * because the write is still in flight and the state below has not moved
   * yet; the state change restarts it, so the five seconds are counted from
   * the step actually landing, and so a step nobody pressed — an auto-advance,
   * a backtrack — gets the same guard.
   *
   * The display handover is left alone: it puts the group back on the screen
   * rather than moving the round on, and nothing is skipped by pressing it
   * twice.
   */
  const queueStateKey = `${liveState.round}:${liveState.current}:${liveState.finalCall ? "final" : "group"}`;
  const [isQueueAdvanceCoolingDown, startQueueAdvanceCooldown] =
    useAdvanceCooldown(queueStateKey);
  const primaryQueueAction = baseQueueAction.isDisplaySwitch
    ? baseQueueAction
    : {
        ...baseQueueAction,
        disabled: baseQueueAction.disabled || isQueueAdvanceCoolingDown,
        /* Plainly greyed while it waits, rather than greyed and still wearing
           the ready green. */
        isReady: baseQueueAction.isReady && !isQueueAdvanceCoolingDown,
        onClick: () => {
          startQueueAdvanceCooldown();
          baseQueueAction.onClick?.();
        },
      };

  /* The title sits in the same row as the settings circle and the cluster
     opposite, and those two are sized by their own labels — so how much room
     it has left is a measurement, not a breakpoint. See useFitTitleToRow. */
  const {
    isStacked: isQueueHeaderStacked,
    rowRef: queueHeaderRef,
    textRef: queueTitleTextRef,
    titleRef: queueTitleRef,
  } = useFitTitleToRow(queueTitle);

  /*
   * The raffle's half of the same idea, lifted out of the raffle panel so the
   * navbar can carry it too — one definition, so the corner button and the
   * navbar can never disagree about what the next step is.
   *
   * Same progression as Start Round -> Next Group: the primary action is
   * whatever the single next step happens to be.
   *
   * A landed result takes a step of its own. Spinning straight over the top of
   * a winner meant the only thing announcing them could vanish on one press,
   * before the room had finished reacting or the winner had come up. Clearing
   * is now a deliberate act, and only then does the button offer another spin.
   */
  const canSpinRaffle = isWheelUp && raffleEligibleClaims.length > 0 && !isRaffleSpinning;
  const primaryRaffleAction = !isWheelUp
    ? {
        disabled: false,
        isDisplaySwitch: true,
        label: "Display Raffle",
        onClick: onOpenRaffle,
      }
    : rafflePhase === RAFFLE_PHASE.revealed
      ? { disabled: false, isReady: true, label: "Clear Winner", onClick: onClearRaffleWinner }
      : {
          disabled: !canSpinRaffle,
          isReady: canSpinRaffle,
          label: isRaffleSpinning ? "Spinning..." : "Spin",
          onClick: onSpinRaffle,
        };

  /*
   * The navbar's middle seat: the same manual action the panel is offering in
   * its top-right corner, so staff can call the next group or spin the wheel
   * without scrolling back up to the card.
   *
   * It follows the display rather than the open tab — the room is looking at
   * exactly one of the two, and the button that matters is the one that moves
   * what the room can see.
   */
  const navbarPrimaryAction = isWheelUp ? primaryRaffleAction : primaryQueueAction;

  const closeConfirmDialog = () => {
    confirmActionRef.current = null;
    setIsConfirmDialogChecked(false);
    setConfirmDialogState((currentState) => ({
      ...currentState,
      open: false,
    }));
  };

  /* Stable across renders: every roster row is handed this, and the memoised
     rows below only skip a re-render while the callbacks they were given keep
     their identity. */
  const openConfirmDialog = useCallback(({
    checkboxLabel = "",
    confirmLabel = "Confirm",
    message = "",
    onConfirm,
    title = "Confirm action",
    tone = "danger",
  }) => {
    confirmActionRef.current = typeof onConfirm === "function" ? onConfirm : null;
    setIsConfirmDialogChecked(false);
    setConfirmDialogState({
      checkboxLabel,
      confirmLabel,
      message,
      open: true,
      title,
      tone,
    });
  }, []);

  const handleConfirmDialogConfirm = () => {
    const confirmAction = confirmActionRef.current;
    // Read before closing, which resets it.
    const isChecked = isConfirmDialogChecked;

    closeConfirmDialog();

    if (typeof confirmAction !== "function") {
      return;
    }

    Promise.resolve(confirmAction(isChecked)).catch((error) => {
      console.error("Confirm dialog action failed", error);
    });
  };

  /*
   * The back button.
   *
   * It asks first, because a rewind changes what the whole room is looking at
   * and what everyone's phone will do — but it is the sort of thing staff end
   * up doing several times in a row, so the dialog can be dismissed for the
   * rest of the event.
   */
  const handleBacktrack = () => {
    if (!backtrackStep || typeof onBacktrack !== "function") {
      return;
    }

    if (isBacktrackConfirmSkipped) {
      onBacktrack();
      return;
    }

    openConfirmDialog({
      checkboxLabel: "Don't ask again for this event",
      confirmLabel: "Go Back",
      message: [
        `The queue goes back to ${backtrackStep.label}.`,
        "Items already picked up stay recorded, and nobody who has claimed gets a second one — only the people who missed their turn can still claim.",
        "Anyone whose group is now ahead of the queue has their QR code hidden again until it is their turn.",
        autoAdvanceEnabled ? "Auto-advance is turned off so it cannot step straight forward again." : "",
      ]
        .filter(Boolean)
        .join(" "),
      onConfirm: (shouldSkipNextTime) => {
        if (shouldSkipNextTime && backtrackConfirmSkippedKey) {
          window.localStorage.setItem(backtrackConfirmSkippedKey, "true");
          setIsBacktrackConfirmSkipped(true);
        }

        onBacktrack();
      },
      title: "Go back a step?",
      tone: "danger",
    });
  };

  /*
   * The auto-advance corner button.
   *
   * Turning it off is reversible with a second tap, so it goes straight
   * through. Turning it on hands the queue over to a timer staff might not be
   * watching, so it asks first — and shows the whole configuration, since
   * that is what is about to start running unattended.
   */
  const handleToggleAutoAdvance = () => {
    if (typeof onToggleAutoAdvance !== "function") {
      return;
    }

    if (autoAdvanceEnabled) {
      onToggleAutoAdvance();
      return;
    }

    openConfirmDialog({
      confirmLabel: "Turn On",
      message: autoAdvanceConfigSummary,
      onConfirm: () => onToggleAutoAdvance(),
      title: "Turn on auto-advance?",
      tone: "default",
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

  /*
   * Follow the wheel onto the screen.
   *
   * The raffle is shared state, so a second staff tab — or another person
   * entirely — can put the wheel up. When that happens this panel switches to
   * match, rather than leaving staff looking at a group queue while the room
   * watches a prize wheel. Taking it down does not switch back: the winner list
   * is still worth reading.
   */
  useEffect(() => {
    if (liveState.raffleOpen) {
      setActivePanel("raffle");
    }
  }, [liveState.raffleOpen]);

  useEffect(() => {
    if (!isEventLive) {
      setActivePanel("groups");
    }
  }, [isEventLive]);

  /*
   * The header's secondary actions, as data rather than markup, because the
   * header renders them two ways: as a row of icon-only circles when it has the
   * width, and as the labelled entries of a "..." menu when it does not. Each
   * carries both names it needs — `title`, which is the circle's tooltip and its
   * accessible name, and `label`, which is what the menu says out loud.
   *
   * End Event is not one of these. It is the primary action and never collapses
   * — see the portal below, where it keeps its place either way.
   */
  const headerActions = [
    {
      icon: <SquarePen aria-hidden="true" className="button-icon" />,
      key: "edit-event",
      label: "Edit Event",
      onClick: onOpenEventDetails,
      title: "Edit event details",
    },
    /*
     * One seat, holding whichever of the two the navbar is not holding — see
     * NAVBAR_SELF_CLAIM_BREAKPOINT_PX. Both actions are always reachable; the
     * phone tier just puts the one staff use in the room a thumb away and
     * files the other one here.
     */
    isSelfClaimInNavbar
      ? {
          icon: <Monitor aria-hidden="true" className="button-icon" />,
          key: "display-screen",
          label: "Display",
          onClick: onOpenDisplayScreen,
          title: "Open the display screen",
        }
      : {
          /* Where staff find their own QR code. It is issued to them
             automatically once they open a live event — see src/App.jsx — so
             this is a way back to a code they already hold rather than a form to
             fill in, and it stays enabled either way: disabling it on
             hasPersonalClaim locked staff out of their own code for the rest of
             the event, and claiming twice is not a risk it needs to guard since
             claimNumberAsAttendee returns the claim that already exists. */
          disabled: !onOpenSelfClaim,
          icon: <Ticket aria-hidden="true" className="button-icon" />,
          key: "self-claim",
          label: hasPersonalClaim ? "Your QR Code" : "Get Your QR Code",
          onClick: onOpenSelfClaim,
          title: hasPersonalClaim ? "View your QR code" : "Get your own QR code",
        },
    {
      icon: <History aria-hidden="true" className="button-icon" />,
      key: "past-events",
      label: "Past Events",
      onClick: () => setIsPastEventsOpen(true),
      title: "View past events",
    },
    {
      /* A toggle rather than an action, which is why it is the one entry that
         carries `isActive`: staff need to see at a glance whether the screens
         are being held awake, because nothing else on the page shows it.

         It reads "this screen and the display" because the preference is stored
         per device and every route runs the wake-lock hook — see
         src/useKeepScreenAwake.js — so a display open in another tab of this
         browser follows the toggle too. */
      disabled: !isKeepScreenAwakeSupported,
      icon: <Coffee aria-hidden="true" className="button-icon" />,
      isActive: isKeepScreenAwakeEnabled,
      key: "keep-screen-awake",
      label: isKeepScreenAwakeEnabled ? "Allow Screens to Sleep" : "Keep Screens Awake",
      onClick: onToggleKeepScreenAwake,
      title: isKeepScreenAwakeSupported
        ? isKeepScreenAwakeEnabled
          ? "This screen and the display stay awake — tap to allow sleeping"
          : "Keep this screen and the display awake"
        : "This browser cannot keep the screen awake",
    },
    {
      /* Also here, not just on the landing screen: most of what it explains is
         only relevant once an event is running. */
      /* The only one whose spoken name is not its tooltip: the tooltip names
         the subject, a screen reader wants the verb. */
      ariaLabel: "Open the staff walkthrough",
      icon: <Info aria-hidden="true" className="button-icon" />,
      key: "walkthrough",
      label: "How to Run an Event",
      onClick: openWalkthrough,
      title: "How to run an event",
    },
  ];

  return (
    <div className="control">
      {/* Paired with the navbar near the end of this tree, which only a live
          event has: the landing's one control, Logout, is in the header now, so
          there is no bar down there for this to fade into. */}
      {isEventLive ? <div className="bottom-navbar-fade" aria-hidden="true" /> : null}
      {/*
        No live event: show staff where they stand and let them choose. This used
        to open the create dialog immediately with no way out, which read as the
        app being stuck rather than idle.
      */}
      {!isEventLive ? (
        <div className="entry-screen staff-landing">
          <SketchCard className="entry-card hero-card sketch-entry-card" elevation={2}>
            <p className="eyebrow">Staff Control Panel</p>
            <h1>No event is running</h1>
            {staffName ? (
              <p className="staff-landing-identity">
                Signed in as <strong>{staffName}</strong>
              </p>
            ) : null}
            {/*
              Every button wraps its label in the same element. A bare text node
              and an icon+label flex row produce slightly different content
              boxes, which showed up as one button being taller than the other.
            */}
            <div className="staff-landing-actions">
              <SketchButton type="button" onClick={onOpenEventDetails}>
                <div className="bottom-navbar-content">
                  <span>Create Event</span>
                </div>
              </SketchButton>
              <SketchButton
                type="button"
                className="secondary-button"
                onClick={() => setIsPastEventsOpen(true)}
              >
                <div className="bottom-navbar-content">
                  <History aria-hidden="true" className="button-icon" />
                  <span>Past Events</span>
                </div>
              </SketchButton>
            </div>
          </SketchCard>
        </div>
      ) : null}

      {!isEventLive && isEventDetailsModalOpen ? (
        <EventDetailsModal
          controlForm={controlForm}
          controlMessage={controlMessage}
          controlSaving={controlSaving}
          isEventLive={false}
          isKeepScreenAwakeSupported={isKeepScreenAwakeSupported}
          onClose={onCloseEventDetails}
          onFetchLatestAnnouncement={onFetchLatestAnnouncement}
          onFieldChange={onFieldChange}
          onSubmit={onStartEvent}
        />
      ) : null}
      {isEventLive ? (
        <>
          <div className={`control-dashboard${isEventDetailsModalOpen ? " control-dashboard--blurred" : ""}`}>
            <div className="control-event-header">
              <p className="control-event-timer">
                <span>{eventTimerLabel}</span>
                <strong>{eventTimerValue}</strong>
              </p>
              {/* The action buttons live in the app header now (see the portal
                  below) so they sit beside the logo/"Event Pass" lockup; the
                  room they used to take up below the title is padding on
                  .control-event-header instead. */}
              <h1 className={getEventTitleClassName(liveState.titleFont)}>{liveState.title}</h1>
            </div>
            {headerActionsNode
              ? createPortal(
                  <div className="control-actions control-actions--header">
                    {/* Wide enough for the row: the four circles in their usual
                        order, ahead of End Event. Narrow: nothing here, and the
                        "..." below stands in for all four. */}
                    {isHeaderActionsCollapsed
                      ? null
                      : headerActions.map(({ ariaLabel, disabled, icon, isActive, key, onClick, title }) => (
                          <SketchIconButton
                            key={key}
                            className={`secondary-button icon-button control-side-action${
                              isActive ? " control-side-action--on" : ""
                            }`}
                            type="button"
                            onClick={onClick}
                            disabled={disabled}
                            /* Only the toggle carries a pressed state; the rest
                               are plain actions and `undefined` leaves the
                               attribute off them entirely. */
                            aria-pressed={isActive === undefined ? undefined : isActive}
                            aria-label={ariaLabel ?? title}
                            title={title}
                          >
                            {icon}
                          </SketchIconButton>
                        ))}
                    {/* Far right of the circle buttons, and it keeps that place
                        on a narrow header — the "..." goes to the right of it
                        rather than in the row's old spot, so the one button
                        staff reach for mid-event never moves. */}
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
                    {isHeaderActionsCollapsed ? (
                      <HeaderActionsMenu actions={headerActions} menuLabel="More event actions" />
                    ) : null}
                  </div>,
                  headerActionsNode,
                )
              : null}

            <SketchMessageDialog message={controlMessage} onDismiss={onDismissControlMessage} />



            {/*
              The swap between the two jobs the display can be doing.
              
              Presented as tabs rather than a button that opens something,
              because these are two views of one panel and only one of them can
              be true of the room at a time. Whichever half the display is
              actually showing wears the ON DISPLAY badge — exactly one of them
              always does — so staff can see what the projector is doing from
              whichever half they are looking at.
            */}
            <div className="panel-switch" role="tablist" aria-label="Control panel mode">
              <SketchButton
                type="button"
                role="tab"
                aria-selected={activePanel === "groups"}
                className={`panel-switch-tab${activePanel === "groups" ? " panel-switch-tab--active" : " secondary-button"}`}
                onClick={() => setActivePanel("groups")}
              >
                <div className="bottom-navbar-content">
                  <Users aria-hidden="true" className="button-icon" />
                  <span>Groups</span>
                  {isWheelUp ? null : (
                    <SketchCard
                      className="panel-switch-live"
                      elevation={1}
                      aria-label="The round is on the display"
                    >
                      ON DISPLAY
                    </SketchCard>
                  )}
                </div>
              </SketchButton>
              <SketchButton
                type="button"
                role="tab"
                aria-selected={activePanel === "raffle"}
                className={`panel-switch-tab${activePanel === "raffle" ? " panel-switch-tab--active" : " secondary-button"}`}
                onClick={() => setActivePanel("raffle")}
              >
                <div className="bottom-navbar-content">
                  <PartyPopper aria-hidden="true" className="button-icon" />
                  <span>Raffle</span>
                  {liveState.raffleOpen ? (
                    <SketchCard
                      className="panel-switch-live"
                      elevation={1}
                      aria-label="The wheel is on the display"
                    >
                      ON DISPLAY
                    </SketchCard>
                  ) : null}
                </div>
              </SketchButton>
            </div>

            {activePanel === "raffle" ? (
              <RafflePanel
                eligibleClaims={raffleEligibleClaims}
                liveState={liveState}
                onOptionChange={onRaffleOptionChange}
                onPreviewAttendeeTicket={onPreviewAttendeeTicket}
                onRemoveClaim={onRemoveClaim}
                onRequestConfirmation={openConfirmDialog}
                onResetWinners={onResetRaffleWinners}
                primaryAction={primaryRaffleAction}
                winnerEntries={raffleWinnerEntries}
              />
            ) : (
              <SketchCard
                className={`entry-card compact-card queue-card sketch-entry-card${isAutoAdvanceSettingsMounted ? " queue-card--settings-open" : ""}`}
                elevation={2}
              >
                <div
                  className={`queue-card-sticky-top${isQueueHeaderStacked ? " queue-card-sticky-top--stacked" : ""}`}
                  ref={queueHeaderRef}
                >
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
                        className="button-icon queue-corner-button-icon queue-corner-button-icon--settings"
                      />
                    </SketchIconButton>
                  </div>
                  {/* Forward and back in one place: the primary action is the
                      next step the round takes, and this is the step it just
                      took, undone. It names the step it would land on so staff
                      can see where they are going before they press it. */}
                  <div className="queue-corner-primary">
                    <SketchIconButton
                      className={`secondary-button queue-corner-button${autoAdvanceEnabled ? " queue-corner-button--active" : ""}`}
                      type="button"
                      onClick={handleToggleAutoAdvance}
                      disabled={!onToggleAutoAdvance}
                      aria-pressed={autoAdvanceEnabled}
                      aria-label={autoAdvanceEnabled ? "Turn off auto-advance" : "Turn on auto-advance"}
                      title={autoAdvanceEnabled ? "Turn off auto-advance" : "Turn on auto-advance"}
                    >
                      <FastForward
                        aria-hidden="true"
                        className="button-icon queue-corner-button-icon queue-corner-button-icon--auto-advance"
                      />
                    </SketchIconButton>
                    <SketchIconButton
                      className="secondary-button queue-corner-button queue-back-button"
                      type="button"
                      onClick={handleBacktrack}
                      disabled={!backtrackStep || !onBacktrack}
                      aria-label={
                        backtrackStep
                          ? `Go back to ${backtrackStep.label}`
                          : "Nothing to go back to yet"
                      }
                      title={
                        backtrackStep
                          ? `Go back to ${backtrackStep.label}`
                          : "Nothing to go back to yet"
                      }
                    >
                      <Undo2
                        aria-hidden="true"
                        className="button-icon queue-corner-button-icon queue-back-button-icon"
                      />
                    </SketchIconButton>
                    <SketchButton
                      className={`control-primary-action queue-primary-action${primaryQueueAction.isReady ? " ready-button" : ""}${primaryQueueAction.isDisplaySwitch ? " queue-primary-action--switch" : ""}`}
                      type="button"
                      onClick={primaryQueueAction.onClick}
                      disabled={primaryQueueAction.disabled}
                    >
                      {primaryQueueAction.label}
                    </SketchButton>
                  </div>
                  <p className="queue-timer queue-round-label">Round {liveState.round}</p>
                  <h2 className="queue-title" ref={queueTitleRef}>
                    <span ref={queueTitleTextRef}>{queueTitle}</span>
                  </h2>
                  <div className="queue-round-progress">
                    {/*
                      The bar carries its own label instead of a card around it. The
                      hachured fill is open enough to read text through, so the count
                      sits centred on the bar rather than stacked above it.
                    */}
                    <div className="stat-progress-wrap">
                      <SketchProgress
                        className="stat-progress"
                        value={Math.max(0, Math.min(1, currentRoundClaimedRatio)) * 100}
                        min={0}
                        max={100}
                        aria-hidden="true"
                      />
                      <span className="stat-progress-label">
                        <span className="progress-label-main">
                          <span>Round Progress</span>
                          <strong>{currentRoundClaimedCount}/{totalPeopleWithNumbers}</strong>
                        </span>
                        {roundElapsedLabel ? (
                          <span className="progress-label-time">Up for {roundElapsedLabel}</span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  {isAutoAdvanceSettingsMounted ? (
                    <SketchCard
                      className={`queue-auto-advance-panel sketch-entry-card${isAutoAdvanceSettingsOpen ? " queue-auto-advance-panel--open" : " queue-auto-advance-panel--closing"}`}
                      elevation={1}
                    >
                      <div className="queue-auto-advance-settings-grid">
                        <SketchCard
                          className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                          elevation={1}
                          fill="#ffffff"
                          strokeColor="#111111"
                        >
                          <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                            <span className="queue-auto-advance-setting-title">People Per Group</span>
                          </label>
                          <SettingSlider
                            min={1}
                            max={20}
                            step={1}
                            value={groupSize}
                            formatValue={(size) => `${size} ${size === 1 ? "person" : "people"}`}
                            onCommit={onGroupSizeChange}
                          />
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
                            <span className="queue-auto-advance-setting-title">Next Group</span>
                            <SketchToggle
                              className="queue-auto-advance-toggle"
                              checked={autoAdvanceNextGroup}
                              onChange={(event) =>
                                onAutoAdvanceActionChange("autoAdvanceNextGroup", event.target.checked)
                              }
                            />
                          </label>
                          <SettingSlider
                            inactive={!autoAdvanceNextGroup}
                            min={10}
                            max={100}
                            step={1}
                            value={autoAdvanceThresholdPercent}
                            formatValue={(percent) => `${percent}%`}
                            onCommit={onAutoAdvanceThresholdChange}
                          />
                          <span className="queue-auto-advance-setting-copy">
                            After this claimed threshold is reached, move to the next normal group.
                          </span>
                        </SketchCard>
                        <SketchCard
                          className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                          elevation={1}
                          fill="#ffffff"
                          strokeColor="#111111"
                        >
                          <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                            <span className="queue-auto-advance-setting-title">Group Timer</span>
                            <SketchToggle
                              className="queue-auto-advance-toggle"
                              checked={autoAdvanceGroupTimerEnabled}
                              onChange={(event) =>
                                onAutoAdvanceActionChange(
                                  "autoAdvanceGroupTimerEnabled",
                                  event.target.checked,
                                )
                              }
                            />
                          </label>
                          <SettingSlider
                            key={autoAdvanceGroupTimerEnabled ? "group-timer-enabled" : "group-timer-disabled"}
                            inactive={!autoAdvanceGroupTimerEnabled}
                            min={1}
                            max={10}
                            step={1}
                            value={autoAdvanceGroupTimerMinutes}
                            formatValue={(minutes) => `${minutes} min`}
                            onCommit={onAutoAdvanceGroupTimerMinutesChange}
                          />
                          <span className="queue-auto-advance-setting-copy">
                            Move to the next group once the current one has been up this long, even if the threshold was not met.
                          </span>
                        </SketchCard>
                        {/* The slider only appears once the toggle is on: with it
                            off there is no timer at all and staff start the round
                            themselves, so an inactive slider would suggest a
                            countdown that is not running. */}
                        <SketchCard
                          className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                          elevation={1}
                          fill="#ffffff"
                          strokeColor="#111111"
                        >
                          <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                            <span className="queue-auto-advance-setting-title">Next Round</span>
                            <SketchToggle
                              className="queue-auto-advance-toggle"
                              checked={autoAdvanceStartRound}
                              onChange={(event) =>
                                onAutoAdvanceActionChange("autoAdvanceStartRound", event.target.checked)
                              }
                            />
                          </label>
                          {autoAdvanceStartRound ? (
                            <SettingSlider
                              min={1}
                              max={10}
                              step={1}
                              value={autoAdvanceStartRoundMinutes}
                              formatValue={(minutes) => `${minutes} min`}
                              onCommit={onAutoAdvanceStartRoundMinutesChange}
                            />
                          ) : null}
                          <span className="queue-auto-advance-setting-copy">
                            {autoAdvanceStartRound
                              ? "Once a round is pending, its first group is called after this long."
                              : "Off: a pending round waits until you start it yourself."}
                          </span>
                        </SketchCard>
                        {/* No longer tied to Next Round: this timer is what ends
                            final call, and Next Round only governs what happens
                            to the pending round afterwards. */}
                        <SketchCard
                          className="queue-auto-advance-setting-card queue-auto-advance-setting-card--inline sketch-entry-card"
                          elevation={1}
                          fill="#ffffff"
                          strokeColor="#111111"
                        >
                          <label className="queue-auto-advance-setting-topline queue-auto-advance-setting-topline--label">
                            <span className="queue-auto-advance-setting-title">Final Call Timer</span>
                            <SketchToggle
                              className="queue-auto-advance-toggle"
                              checked={autoAdvanceFinalCallTimerEnabled}
                              onChange={(event) =>
                                onAutoAdvanceActionChange(
                                  "autoAdvanceFinalCallTimerEnabled",
                                  event.target.checked,
                                )
                              }
                            />
                          </label>
                          {autoAdvanceFinalCallTimerEnabled ? (
                            <SettingSlider
                              min={1}
                              max={10}
                              step={1}
                              value={autoAdvanceFinalCallTimerMinutes}
                              formatValue={(minutes) => `${minutes} min`}
                              onCommit={onAutoAdvanceTimerMinutesChange}
                            />
                          ) : null}
                          <span className="queue-auto-advance-setting-copy">
                            {autoAdvanceFinalCallTimerEnabled
                              ? "End final call after this long and leave the next round pending."
                              : "Off: final call runs until you press Next Round."}
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
                          <SettingSlider
                            key={autoAdvanceBacklogLimitEnabled ? "backlog-enabled" : "backlog-disabled"}
                            inactive={!autoAdvanceBacklogLimitEnabled}
                            min={10}
                            max={100}
                            step={5}
                            value={autoAdvanceBacklogClearedPercent}
                            formatValue={(percent) => `${percent}% cleared`}
                            onCommit={onAutoAdvanceBacklogClearedPercentChange}
                          />
                          <span className="queue-auto-advance-setting-copy">
                            Hold auto-advance until this much of everyone already called has claimed.
                          </span>
                        </SketchCard>
                      </div>
                    </SketchCard>
                  ) : null}
                  {queueDescription ? <p>{queueDescription}</p> : null}
                </div>
                <div className="queue-card-body">
                  {shouldShowInlineBacklog ? (
                    <BacklogList
                      calledSoFarCount={calledSoFarCount}
                      claims={backlogClaims}
                      currentTime={currentTime}
                      onPreviewAttendeeTicket={onPreviewAttendeeTicket}
                      onRemoveClaim={onRemoveClaim}
                      onRequestConfirmation={openConfirmDialog}
                    />
                  ) : (
                    <>
                      <div
                        className="panel-switch queue-panel-toggle-row"
                        role="group"
                        aria-label="Show or hide the current group and backlog lists"
                      >
                        <SketchButton
                          type="button"
                          aria-pressed={isGroupPanelOpen}
                          className={`queue-panel-toggle${isGroupPanelOpen ? " panel-switch-tab--active" : " secondary-button"}`}
                          onClick={handleToggleGroupPanel}
                        >
                          <div className="queue-panel-toggle-content">
                            <div className="queue-panel-toggle-sizer" aria-hidden="true">
                              <span className="queue-panel-toggle-sizer-row">
                                <Users aria-hidden="true" className="button-icon" />
                                <span>Current Group</span>
                              </span>
                              <span className="queue-panel-toggle-sizer-row">
                                <Clock aria-hidden="true" className="button-icon" />
                                <span>{backlogToggleLabel}</span>
                              </span>
                            </div>
                            <div className="bottom-navbar-content">
                              <Users aria-hidden="true" className="button-icon" />
                              <span>Current Group</span>
                            </div>
                          </div>
                        </SketchButton>
                        <SketchButton
                          type="button"
                          aria-pressed={isBacklogOpen}
                          className={`queue-panel-toggle${isBacklogOpen ? " panel-switch-tab--active" : " secondary-button"}`}
                          onClick={handleToggleBacklogPanel}
                        >
                          <div className="queue-panel-toggle-content">
                            <div className="queue-panel-toggle-sizer" aria-hidden="true">
                              <span className="queue-panel-toggle-sizer-row">
                                <Users aria-hidden="true" className="button-icon" />
                                <span>Current Group</span>
                              </span>
                              <span className="queue-panel-toggle-sizer-row">
                                <Clock aria-hidden="true" className="button-icon" />
                                <span>{backlogToggleLabel}</span>
                              </span>
                            </div>
                            <div className="bottom-navbar-content">
                              <Clock aria-hidden="true" className="button-icon" />
                              <span>{backlogToggleLabel}</span>
                            </div>
                          </div>
                        </SketchButton>
                      </div>
                      <div
                        className={`queue-panel-lists${isGroupPanelOpen && isBacklogOpen ? " queue-panel-lists--split" : ""}`}
                      >
                        {isGroupPanelOpen ? (
                          <div className="queue-panel-list">
                            <ClaimList
                              claims={activeQueueClaims}
                              currentRound={currentRound}
                              elapsedLabel={activeQueueElapsedLabel}
                              emptyText={queueEmptyText}
                              isFinalCall={liveState.finalCall}
                              isSplitView={isQueueSplitView}
                              onPreviewAttendeeTicket={onPreviewAttendeeTicket}
                              onRemoveClaim={onRemoveClaim}
                              onRequestConfirmation={openConfirmDialog}
                            />
                          </div>
                        ) : null}
                        {isGroupPanelOpen && isBacklogOpen ? (
                          <div className="queue-panel-divider" aria-hidden="true">
                            <SketchVerticalDivider />
                          </div>
                        ) : null}
                        {isBacklogOpen ? (
                          <div className="queue-panel-list">
                            <BacklogList
                              calledSoFarCount={calledSoFarCount}
                              claims={backlogClaims}
                              currentTime={currentTime}
                              isSplitView={isQueueSplitView}
                              onPreviewAttendeeTicket={onPreviewAttendeeTicket}
                              onRemoveClaim={onRemoveClaim}
                              onRequestConfirmation={openConfirmDialog}
                            />
                          </div>
                        ) : null}
                        {!isGroupPanelOpen && !isBacklogOpen ? (
                          <p>Nothing shown — pick a list above.</p>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </SketchCard>
            )}

            <FullRoster
              claims={currentEventClaims}
              isGraphOpen={isAttendeeGraphOpen}
              /* The event's own allocators, so the queue projects the numbers
                 the server will actually hand out. See FullRoster. */
              nextClaimNumber={liveEvent?.nextClaimNumber}
              nextStaffNumber={liveEvent?.nextStaffNumber}
              onToggleGraph={() => setIsAttendeeGraphOpen((currentValue) => !currentValue)}
              onRequestConfirmation={openConfirmDialog}
              preclaims={preclaims}
              onAssignPreclaimAsStaff={onAssignPreclaimAsStaff}
              onMoveClaimBackToQueueAsStaff={onMoveClaimBackToQueueAsStaff}
              onRefreshAllPreclaimMembershipsAsStaff={onRefreshAllPreclaimMembershipsAsStaff}
              onPreviewAttendeeTicket={onPreviewAttendeeTicket}
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
              demoStatus={demoStatus}
              isDemoEvent={isDemoEvent}
              isDemoPaused={isDemoPaused}
              isEventLive
              onClose={onCloseEventDetails}
              onFetchLatestAnnouncement={onFetchLatestAnnouncement}
              onFieldChange={onFieldChange}
              onSubmit={onSaveEventDetails}
              onToggleDemoPaused={onToggleDemoPaused}
            />
          ) : null}
        </>
      ) : null}

      {isPastEventsOpen ? (
        <PastEventsModal
          onClose={() => setIsPastEventsOpen(false)}
          onDeleteArchivedEvent={onDeleteArchivedEvent}
          onReadArchivedEvent={onReadArchivedEvent}
          onReadArchivedEvents={onReadArchivedEvents}
          onRequestConfirmation={openConfirmDialog}
        />
      ) : null}

      {walkthrough.open ? (
        <StaffWalkthroughModal
          hasPersonalClaim={hasPersonalClaim}
          onClose={closeWalkthrough}
          /* No number to take before an event exists, and none to view from the
             landing screen either. */
          onGetNumber={isEventLive && onOpenSelfClaim ? handleWalkthroughGetNumber : null}
          onSeen={markWalkthroughSeen}
          required={walkthrough.required}
          role={walkthrough.role}
        />
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
          <div className="bottom-navbar-row">
            {/* aria-label rather than the wording alone: below 430px the label
                is hidden and the icon is the whole button, so the name has to
                live somewhere the stylesheet cannot take away. */}
            <SketchButton
              aria-label="Scanner"
              className="bottom-navbar-button"
              type="button"
              onClick={onOpenScanner}
              disabled={scanLoading || !isEventLive}
            >
              <div className="bottom-navbar-content">
                <ScanLine aria-hidden="true" className="button-icon" />
                <span className="navbar-button-label">Scanner</span>
              </div>
            </SketchButton>
            <SketchButton
              className={`bottom-navbar-button bottom-navbar-button--primary${navbarPrimaryAction.isReady ? " ready-button" : ""}`}
              type="button"
              onClick={navbarPrimaryAction.onClick}
              disabled={navbarPrimaryAction.disabled}
            >
              <div className="bottom-navbar-content">
                {/* The icon rides with the label rather than sitting outside the
                    reservation: the reserved cell is as wide as the longest
                    wording this button can carry, so an icon parked at its edge
                    drifted a whole word away from a short label like Spin. */}
                <span className="navbar-action-label">
                  <span className="navbar-action-label-sizer" aria-hidden="true">
                    {NAVBAR_ACTION_WIDEST_LABEL}
                  </span>
                  <span className="navbar-action-label-text">
                    {isWheelUp ? (
                      <PartyPopper aria-hidden="true" className="button-icon" />
                    ) : (
                      <Users aria-hidden="true" className="button-icon" />
                    )}
                    <span className="navbar-action-label-word">{navbarPrimaryAction.label}</span>
                  </span>
                </span>
              </div>
            </SketchButton>
            {/* The seat that trades with the "..." menu on a phone — see
                NAVBAR_SELF_CLAIM_BREAKPOINT_PX. Its label is hidden at every
                width this branch is taken at, so the wording it carries is the
                aria-label. */}
            {isSelfClaimInNavbar ? (
              <SketchButton
                aria-label={hasPersonalClaim ? "Your QR code" : "Get your QR code"}
                className="secondary-button bottom-navbar-button"
                type="button"
                onClick={onOpenSelfClaim}
                disabled={!onOpenSelfClaim}
              >
                <div className="bottom-navbar-content">
                  <Ticket aria-hidden="true" className="button-icon" />
                  <span className="navbar-button-label">
                    {hasPersonalClaim ? "Your Code" : "Get Code"}
                  </span>
                </div>
              </SketchButton>
            ) : (
              <SketchButton
                aria-label="Display"
                className="secondary-button bottom-navbar-button"
                type="button"
                onClick={onOpenDisplayScreen}
              >
                <div className="bottom-navbar-content">
                  <Monitor aria-hidden="true" className="button-icon" />
                  <span className="navbar-button-label">Display</span>
                </div>
              </SketchButton>
            )}
          </div>
        </SketchCard>
      ) : null}
      <SketchDialog className="sketch-confirm-dialog" open={confirmDialogState.open} onClose={closeConfirmDialog}>
        <div className="confirm-dialog-content">
          <h3 className="confirm-dialog-title">{confirmDialogState.title}</h3>
          {confirmDialogState.message ? (
            <p className="confirm-dialog-copy">{confirmDialogState.message}</p>
          ) : null}
          {confirmDialogState.checkboxLabel ? (
            <label className="confirm-dialog-checkbox">
              <input
                type="checkbox"
                checked={isConfirmDialogChecked}
                onChange={(event) => setIsConfirmDialogChecked(event.target.checked)}
              />
              <span>{confirmDialogState.checkboxLabel}</span>
            </label>
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
