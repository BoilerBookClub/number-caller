import { getTimestampMs } from "./eventState";

/** Clock-time formatting and the event schedule window, in the venue's timezone. */
export const formatClockTime = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(`2000-01-01T${value}`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export const formatElapsedDuration = (elapsedMs) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const formatTimeRange = (start, end) => {
  if (!start || !end) {
    return "";
  }

  return `${formatClockTime(start)} - ${formatClockTime(end)}`;
};

export const isValidClockTime = (value) => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(":").map(Number);

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const getTimeParts = (value) => {
  if (!value) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return { hours, minutes };
};

const setDateToTime = (date, value) => {
  const timeParts = getTimeParts(value);

  if (!timeParts) {
    return null;
  }

  const nextDate = new Date(date);

  nextDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
  return nextDate;
};

/**
 * The event's three instants, preferring the ones the staff browser already
 * resolved.
 *
 * A schedule is entered as wall-clock text ("19:00") in the venue's timezone.
 * The staff browser resolves that where it is unambiguous and stores the result
 * on the event as `eventStartAtMs`, `eventEndAtMs` and `memberEarlyAccessAtMs`;
 * the Cloud Functions read those, because they run in UTC and cannot resolve
 * "19:00" at all.
 *
 * This did not, and re-derived the whole schedule from the clock-time strings
 * using `Date.setHours` — which resolves them in *the viewing device's*
 * timezone. Everybody in one room usually agrees, which is why it never showed;
 * a phone that has travelled, or has its clock set by hand, disagreed with the
 * server about whether the doors were open, when member early access began, and
 * what the round-one countdown said.
 *
 * The stored values win where they exist. The clock-time derivation stays as
 * the fallback for events created before they did, where being approximately
 * right beats refusing to answer — the same shape isLiveEventStarted uses on
 * the server.
 */
export const getEventSchedule = ({
  eventEndAtMs,
  eventStartAtMs,
  memberCheckInLeadMinutes,
  memberEarlyAccessAtMs,
  now,
  startedAt,
  timeframeEnd,
  timeframeStart,
}) => {
  const toDate = (value) => {
    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) && parsedValue > 0 ? new Date(parsedValue) : null;
  };
  const storedStartTime = toDate(eventStartAtMs);

  if (storedStartTime) {
    const storedEndTime = toDate(eventEndAtMs);
    const storedMemberEarlyAccessTime = toDate(memberEarlyAccessAtMs);

    return {
      eventEndTime: storedEndTime,
      eventStartTime: storedStartTime,
      /* Derived from the stored start rather than the local clock, so a missing
         early-access stamp on an older event still lands the same distance
         before the same instant. */
      memberEarlyAccessTime:
        storedMemberEarlyAccessTime
        ?? new Date(storedStartTime.getTime() - memberCheckInLeadMinutes * 60 * 1000),
    };
  }

  const referenceTimestamp = getTimestampMs(startedAt) ?? now;

  if (!referenceTimestamp) {
    return {
      eventEndTime: null,
      eventStartTime: null,
      memberEarlyAccessTime: null,
    };
  }

  const referenceDate = new Date(referenceTimestamp);
  let eventStartTime = setDateToTime(referenceDate, timeframeStart);
  let eventEndTime = setDateToTime(referenceDate, timeframeEnd);

  if (!eventStartTime || !eventEndTime) {
    return {
      eventEndTime,
      eventStartTime,
      memberEarlyAccessTime: eventStartTime
        ? new Date(eventStartTime.getTime() - memberCheckInLeadMinutes * 60 * 1000)
        : null,
    };
  }

  if (eventEndTime <= eventStartTime) {
    eventEndTime.setDate(eventEndTime.getDate() + 1);
  }

  if (referenceTimestamp > eventEndTime.getTime()) {
    eventStartTime.setDate(eventStartTime.getDate() + 1);
    eventEndTime.setDate(eventEndTime.getDate() + 1);
  }

  return {
    eventEndTime,
    eventStartTime,
    memberEarlyAccessTime: new Date(
      eventStartTime.getTime() - memberCheckInLeadMinutes * 60 * 1000,
    ),
  };
};
