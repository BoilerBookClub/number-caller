/* Extension included, unlike the rest of the app's imports: the walkthrough
   decks are unit tested under plain node, which does not resolve an
   extensionless specifier the way vite does. */
import { readStoredBoolean } from "./claimSession.js";

/*
 * The two decks of the staff walkthrough.
 *
 * The panel used to explain itself through one long scrolling Staff Guide, which
 * nobody read standing at a table. It's a short deck now, shown automatically
 * once per event, and which deck you get depends on what you're doing here:
 *
 * - organizer: you created this event from this browser, so you're the one
 *   driving the queue and need the whole thing.
 * - helper: you signed into an event somebody else created. You're on the
 *   scanning table, so you get where the scanner is and how to work the line,
 *   and nothing about auto-advance or ending the event.
 *
 * Both decks end on the same page: the QR code of your own you were handed
 * when you opened the event, and where to find it again.
 */
export const STAFF_WALKTHROUGH_ROLE = {
  helper: "helper",
  organizer: "organizer",
};

const FINISH_PAGE = {
  isFinish: true,
  points: [],
  title: "Your QR code",
};

const ORGANIZER_PAGES = [
  {
    intro: "You're running this one! All you need are two tabs.",
    points: [
      "Click Display in the bottom navbar and put that tab up on the projector. Attendees join by scanning the QR code on it.",
      "That code changes every minute, so leave the display tab up.",
      "The pencil icon in the header edits the title, book list, rules, and times any time.",
    ],
    title: "Setup and display",
  },
  {
    intro: "Here's the process you'll repeat all night.",
    ordered: true,
    points: [
      "Attendees scan the display's QR code, log in with Discord, and get a number.",
      "Start Round calls the first group. Next Group calls each batch after that, sized by your People Per Group setting.",
      "They pick something and you scan the QR code on their phone.",
      "Final Call shows up after the last group and sweeps up anyone who hasn't claimed yet. Next Round wraps things up.",
      "The undo arrow steps the queue back one step at a time.",
    ],
    title: "Running the event",
  },
  {
    intro: "Optional, but it runs the queue for you once the room settles.",
    points: [
      "The fast-forward icon switches it on; the gear beside it opens its settings.",
      "It calls the next group once enough of the current one has claimed, or when the group timer runs out.",
      "It always enters final call automatically. Leaving it isn't automatic — press Next Round, or let the final-call timer handle it.",
      "Backlog Limit holds everything until the people already called have caught up.",
      "It only runs while a control panel is open, so leave this tab up.",
    ],
    title: "Auto-advance",
  },
  {
    points: [
      "Scanner's the bottom-left button. Tap it, allow camera access, and point it at the QR code on the attendee's phone.",
      "Green means it counted. Grey means they've already claimed this round. Red means the code's invalid, from another event, or their number isn't up yet.",
      "Everyone gets one claim per round, so there's nothing to check by hand.",
      "Any staff member with this panel open can scan at the same time — more phones, more lanes.",
    ],
    title: "Scanning pickups",
  },
  {
    intro: "A few more panels worth knowing about.",
    points: [
      "The attendee list holds everyone with a number, and you can search and filter it.",
      "Before the start time, people wait in the queue with a projected number. Members get assigned when their early check-in window opens, everyone else when the event starts.",
      "Assign Early hands a queued attendee their number now. Refresh re-checks membership against Discord. Removing a number or a queue entry can log that attendee out, so read the confirmation first.",
      "Groups and Prize Raffle are two views of one panel, so whichever the room's looking at wears the ON DISPLAY badge, and the other tab offers to switch it over.",
      "Switching back from the raffle waits for the spin to finish, so a winner's never pulled off the screen before the room's seen it.",
    ],
    title: "Attendees, the queue, and raffles",
  },
  {
    points: [
      "An attendee's told to scan the in-person QR code: they opened the site directly, so point them at the display.",
      "Staff sign-in is denied: that Discord account doesn't hold the staff role.",
      "Somebody's stuck in the queue: check the start time, the early check-in window, and their membership, then Refresh or Assign Early.",
      "A scan says not eligible: their number hasn't been called yet this round.",
    ],
    title: "If something looks wrong",
  },
  FINISH_PAGE,
];

const HELPER_PAGES = [
  {
    intro:
      "Somebody else is controlling groups from their own panel, which means you're on pickup duty.",
    points: [
      "You don't need to start rounds or call groups. That's already covered.",
      "Your job is scanning pickups: attendees whose numbers have been called come to you.",
      "The scanner's in bottom-left button on this panel. Tap it and allow camera access.",
    ],
    title: "You're helping run this!",
  },
  {
    intro: "It's the same steps for everyone.",
    ordered: true,
    points: [
      "Ask them to show their QR code. It's on their own phone, on their number screen.",
      "Hold the camera about a hand's width from the screen until it reads.",
      "Wait for the result before you look away.",
      "Communicate with them what it said: green means done, grey means they've already claimed this round, red means it didn't count.",
      "On red, check they're showing their own code for this event and that their number's been called, then try again.",
    ],
    title: "Scanning someone",
  },
  {
    points: [
      "Several staff can scan at once, so every phone with this panel open is another lane for checkout.",
      "If the camera stalls, close the scanner and reopen it rather than reloading the page.",
    ],
    title: "Keeping the line moving",
  },
  FINISH_PAGE,
];

export const getStaffWalkthroughPages = (role) =>
  role === STAFF_WALKTHROUGH_ROLE.helper ? HELPER_PAGES : ORGANIZER_PAGES;

/* Which browser started this event. The event document is world-readable, so
   the creator is remembered here rather than written onto it — a Discord user
   id on a public document is exactly what the raffle winner list avoids. The
   cost is that the creator on a second device is treated as a helper, which is
   the right way round to be wrong. */
const buildEventCreatedHereKey = (eventId) => `staffCreatedEvent:${eventId}`;

const buildWalkthroughSeenKey = (eventId, role) =>
  `staffWalkthroughSeen:${role}:${eventId}`;

export const markEventCreatedHere = (eventId) => {
  if (!eventId) {
    return;
  }

  window.localStorage.setItem(buildEventCreatedHereKey(eventId), "true");
};

export const resolveStaffWalkthroughRole = (eventId) =>
  eventId && readStoredBoolean(buildEventCreatedHereKey(eventId))
    ? STAFF_WALKTHROUGH_ROLE.organizer
    : STAFF_WALKTHROUGH_ROLE.helper;

export const hasSeenStaffWalkthrough = (eventId, role) =>
  Boolean(eventId) && readStoredBoolean(buildWalkthroughSeenKey(eventId, role));

export const markStaffWalkthroughSeen = (eventId, role) => {
  if (!eventId) {
    return;
  }

  window.localStorage.setItem(buildWalkthroughSeenKey(eventId, role), "true");
};
