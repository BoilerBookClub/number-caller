# Event Pass

Event Pass is a real-time event number-calling app for giveaways, raffles, book swaps, and other events where attendees receive a number and are invited up in groups. It gives organizers a live control panel, attendees a personal claim ticket, staff a QR scanner, and the room a public display that updates instantly.

## What This App Does

- Runs one live event at a time
- Lets staff create an event with a title, title font, book list URL, attendee rules, start time, end time, and member early check-in window
- Shows a public display at `/display` with the current round, current called number range, final-call state, live activity feed, and a rotating attendee check-in QR code
- Lets attendees scan the display QR code, log in with Discord, join the queue, receive a number, and see when they are up
- Shows attendees a personal QR code only when their number is eligible to claim in the current round
- Lets staff scan attendee QR codes to mark item claims and prevent duplicate claims in the same round
- Supports multiple rounds, final call, automatic group advancement, backlog limits, and attendee/claim analytics
- Uses Firebase Firestore, Firebase Auth custom tokens, Cloud Functions, Firebase Hosting, and Discord OAuth

## Screens And URLs

| URL | Who uses it | Purpose |
| --- | --- | --- |
| `/` | Attendees | Claim access gate, Discord login, number assignment, claim status, claim QR code, rules, book descriptions, and browser notifications |
| `/display` | Public room display | Project this on a TV/projector. Shows event title, time, round, current group, final call, activity feed, and the rotating attendee QR code |
| `/control` | Staff only | Create/edit/end events, call groups, start rounds, run final call, scan attendee QR codes, manage attendees, manage pre-event queue, and view graphs |

## Event-Day Workflow

1. Staff open `/control` and log in with Discord
2. Staff create the event details and click `Start Event`
3. Staff open `/display` from the control panel and put it on the room screen
4. Attendees scan the display QR code, log in with Discord, and join the event
5. Once they have a claim ticket, attendees read the claim rules and watch for their number
6. Staff start round 1 and call groups manually or with auto-advance
7. When an attendee number is called, the attendee's personal claim QR code appears
8. Staff scan that personal QR code after the attendee picks an item
9. Staff continue groups, use final call if needed, then start the next round or end the event

## Staff Guide

### Log In

1. Open `/control`
2. Click `Login with Discord`
3. Use a Discord account that has the configured staff role

If your account is missing the staff role, the app shows an access denied message. Staff access is granted by the Firebase custom token created from the Discord roles checked in `functions/index.js`.

### Create An Event

When no event is live, `/control` opens the `Create Event` dialog.

Fill in:

- `Event Title`: The title shown on the display, attendee page, and control panel
- `Event Title Font`: Pick one of the built-in display fonts
- `Book List URL`: The link opened by attendees when they click `Open Book Descriptions`
- `Claim Rules`: One rule per line. These are shown in the attendee rules modal once they have a claim ticket
- `Start Time`: The public event start time
- `End Time`: The event end time. If the end time is earlier than the start time, the app treats it as an overnight event
- `Member Early Check-In`: How many minutes before the start time members can receive or reserve a number. The UI allows 0 to 60 minutes

Click `Start Event` to publish the live event. All connected screens update automatically.

### Edit Event Details

During a live event, click the pencil icon in the control header.

You can update the same fields used when creating the event:

- Title
- Title font
- Book list URL
- Claim rules
- Start/end time
- Member early check-in lead time

Click `Save Event Details` to apply changes. The display and attendee pages update in real time.

### Open The Display

From `/control`, click `Open Display`. This opens `/display` in a new tab. Put that tab on the projector or TV.

The display shows:

- Event title and event time
- Current round
- `Starting Soon` before a group is called
- The current eligible number range, such as `1-10`
- `FINAL CALL` when staff start final call
- A rotating attendee QR code for check-in
- A live activity feed for queued attendees, assigned numbers, and item claims

The attendee check-in QR code rotates every 60 seconds. Recently scanned codes remain valid briefly, but attendees should scan the current display QR code when possible.

### Call Groups

The main queue card controls the current round.

- `Start Round 1`: Calls the first group once at least one attendee has a number
- `Next Group`: Advances by the current `People Per Group` setting
- `Final Call`: Appears after the last group. It targets attendees who have not claimed in the current round
- `Start Next Round`: Appears during final call. It resets the call range and moves to the next round

The current group list shows:

- Attendee number
- Attendee name/avatar
- Waiting/claimed state
- Total item count
- Member status

The round progress card shows how many attendees have claimed an item in the current round.

### Final Call

Use final call after the last normal group. Final call includes attendees who have not claimed an item in the current round.

During final call:

- The display shows `FINAL CALL`
- The queue lists the final-call attendees
- Staff can scan attendee QR codes exactly like a normal group
- Staff can click `Start Next Round` when final call is done

### Auto-Advance

The fast-forward icon toggles auto-advance on or off.

The settings icon opens the auto-advance settings panel:

- `Next Group`: Automatically calls the next normal group when the active group reaches the configured claimed percentage
- Threshold slider: Sets the claimed percentage required to move on. The app UI allows 10% to 100%
- `Final Call`: After the last normal group, automatically enters final call when the threshold is met
- `Next Round`: After final call, automatically starts the next round
- `Final Call Timer`: When `Next Round` is on, optionally forces the next round after 1 to 10 minutes of final call
- `People Per Group`: Number of people included in each new group. The app UI allows 1 to 20
- `Backlog Limit`: Pauses auto-advance when too many earlier eligible attendees have not claimed yet. The app UI allows 1 to 20 waiting attendees

Auto-advance respects backlog limits and only runs for staff while the control panel is open.

### Scan Attendee Claim QR Codes

1. Open `/control`
2. Click `Open Scanner`
3. Allow camera access in the browser
4. Point the camera at the attendee's personal QR code

Scanner feedback can be:

- Success: The attendee was marked as claimed for the current round
- Info: The attendee already claimed in this round
- Error: The QR code is invalid, expired for a different event, or the attendee number is not eligible yet

An attendee can only be marked claimed once per round. Their item count increases each time they successfully claim in a new round.

### Manage The Attendee List

The `Attendee List` card shows everyone with an assigned number.

Staff can:

- Search by attendee name or number
- Filter by member status
- Filter by item claim status
- Remove an attendee number
- Before the event starts, move an assigned attendee back to the queue
- View each attendee's total item count and member status

Removing a number or queue entry can log that attendee out or remove their current event access, so use the confirmation dialogs carefully.

### Manage The Pre-Event Queue

Before the event start time, attendees can queue after scanning the display QR code. Members can receive early access based on the event's `Member Early Check-In` setting.

While the event has not started, staff see a `Queue` section in the attendee list.

Staff can:

- See projected numbers for queued attendees
- See whether each queued attendee is a member
- Click `Assign Early` to immediately assign a number
- Click `Refresh` to re-check one attendee's membership
- Click `Refresh All` to re-check membership for the whole queue
- Remove a queued attendee

Queued members are automatically assigned when their early check-in window opens. Other queued attendees are assigned when the event start window opens.

### View Graphs

Click the graph icon in the attendee list to show analytics.

Available graphs:

- `Joined`: Timestamped attendee joins, including assigned numbers and queued attendees when timestamps are available
- `Item Claims`: Timestamped successful item claims

Each graph shows the total count, first event time, and time span. Use the expand icon for a larger view.

### End The Event

Click `End Event` in the control header and confirm.

Ending an event:

- Marks the live event inactive
- Clears live event timing and claim access data
- Resets the display feed
- Sends attendees to the ended/no-event page
- Logs the staff user out of the live control session

## Attendee Guide

### Join The Event

1. Scan the QR code on the public display
2. Log in with Discord
3. Wait for your number assignment or queue status
4. When the rules modal appears, read the event rules and click `Got it!`

Attendee access is intentionally tied to the rotating display QR code. Opening `/` directly without a valid event QR code shows a message asking the attendee to scan the in-person QR code.

### Before The Event Starts

If the event has not started:

- Members may receive or reserve access during the configured early check-in window
- Non-members are queued until the event starts
- The attendee page shows a countdown when applicable

### During The Event

The attendee page shows:

- Event title and time
- Assigned number
- Current round
- Current called number range
- Whether the attendee is in line or currently up
- A link to open book descriptions
- A rules/info button
- A notification button

When the called number range reaches the attendee's number, the page changes to `You're up!` and displays the personal claim QR code.

### Claim An Item

1. Wait until your personal QR code appears
2. Pick an item
3. Show the personal QR code to staff
4. Staff scan it to mark your claim

After a successful scan, the QR code hides for the rest of that round. It appears again in a later round when your number is called again.

### Browser Notifications

Attendees can click the bell button to turn notifications on or off.

Notifications require:

- A secure browser context, such as HTTPS or localhost
- Browser notification permission
- The attendee page to remain available to the browser

When enabled, the app sends a notification when the attendee's number becomes eligible in a round.

## Public Display Guide

Open `/display` on the room screen.

Use it for:

- Showing the current round and eligible group
- Showing `Starting Soon` before calls begin
- Showing `FINAL CALL` when final call is active
- Letting attendees scan the rotating check-in QR code
- Showing recent live activity in the room

If no event is live, the display shows `No event is currently live.`

## Local Development

### Requirements

- Node.js 22 is recommended because Cloud Functions are configured for Node 22
- npm
- A Firebase project with Firestore, Firebase Auth, Cloud Functions, and Hosting
- A Discord OAuth app and the Discord guild/role IDs configured in `functions/index.js`

### Install

```bash
npm install
npm ci --prefix functions
```

### Configure Environment Variables

Create a local env file:

```bash
cp .env.example .env.local
```

Fill in the Firebase web app values:

```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

Optional Cloud Functions environment variables:

- `DISCORD_BOT_TOKEN` or `BBC_DISCORD_BOT_TOKEN`: Lets staff refresh queued attendee membership through the Discord bot API

The current Discord client ID, guild ID, member role ID, and staff role ID are hard-coded in `src/useDiscordLogin.js` and `functions/index.js`.

### Run The App

```bash
npm run dev
```

Vite prints a local URL, usually `http://localhost:5173`.

Useful local URLs:

- `http://localhost:5173/`
- `http://localhost:5173/display`
- `http://localhost:5173/control`

### Build And Lint

```bash
npm run lint
npm run build
```

### Preview A Production Build

```bash
npm run preview
```

## Firebase Data Model

The app stores live state under:

- `events/live-number-caller`
- `events/live-number-caller/claims/{claimId}`
- `events/live-number-caller/preclaims/{preclaimId}`
- `events/live-number-caller/public/display-feed`

Important concepts:

- `claims`: Attendees who have assigned numbers
- `preclaims`: Attendees queued before their claim window opens
- `display-feed`: Recent activity shown on `/display`
- `state.current` and `state.last`: Define the currently eligible number range
- `state.round`: Current round number
- `state.finalCall`: Whether the event is in final call

## Cloud Functions

Cloud Functions handle trusted server-side work:

- Exchange Discord OAuth access tokens for Firebase custom tokens
- Assign queued attendees when their window opens
- Let staff assign, remove, refresh, or re-queue attendees
- Redeem attendee QR codes as staff
- Maintain the display activity feed
- Process member preclaims on a schedule

## Deployment

### Deploy Manually

Log in to Firebase:

```bash
npx firebase-tools login
```

Select or add your Firebase project:

```bash
npx firebase-tools use --add
```

Deploy Hosting, Firestore rules/indexes, and Functions:

```bash
npm run deploy
```

### Deploy With GitHub Actions

This repo includes `.github/workflows/deploy.yml`, which deploys on pushes to `main` and can also be run manually.

Required GitHub secrets:

- `FIREBASE_SERVICE_ACCOUNT`: JSON for a service account with deploy permissions
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

The workflow installs root and Functions dependencies, runs lint, builds the app, authenticates to Google Cloud, and deploys with `firebase-tools`.

## Security Notes

- Staff-only actions require a Firebase custom token with `staff: true`
- Member early access requires a Firebase custom token with `member: true`
- Firestore rules allow attendees to read their own queue/claim data and allow staff broader access
- Attendee check-in requires a rotating claim access code from the display QR code
- Personal claim QR codes include an event ID, claim ID, and token; staff redemption validates all three
- For production use, verify the Discord guild and role IDs in code before deployment

## Troubleshooting

- `No event is currently live`: Start an event from `/control`
- `Scan the in-person event QR code`: The attendee opened `/` without a valid rotating claim code. Scan the QR code on `/display`
- Staff login succeeds but `/control` is denied: The Discord account does not have the configured staff role, or the Firebase custom token was created without `staff: true`
- Attendee is queued but not assigned: Check the event start time, member early check-in setting, and membership status. Staff can use `Refresh`, `Refresh All`, or `Assign Early`
- Scanner cannot start: Allow camera permission, use HTTPS or localhost, and make sure no other app is holding the camera
- QR scan says not eligible: The attendee's number has not been reached in the current round
- Notifications unavailable: Use HTTPS or localhost and confirm the browser supports notifications
