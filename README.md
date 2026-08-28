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
- Runs prize raffles: a spinning wheel on the display, and a separate prize QR code for each winner
- Uses Firebase Firestore, Firebase Auth custom tokens, Cloud Functions, Firebase Hosting, and Discord OAuth

## Screens And URLs

| URL | Who uses it | Purpose |
| --- | --- | --- |
| `/` | Attendees | Claim access gate, Discord login, number assignment, claim status, claim QR code, rules, and book descriptions |
| `/display` | Public room display | Project this on a TV/projector. Shows event title, time, round, current group, final call, activity feed, and the rotating attendee QR code |
| `/control` | Staff only | Create/edit/end events, call groups, start rounds, run final call, run prize raffles, scan attendee QR codes, manage attendees, manage pre-event queue, and view graphs |

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

This is the full reference. The control panel also walks staff through a short
version of it, one page at a time, the first time they open a live event —
the whole thing for whoever created the event, and four pages covering the
scanner and the pickup line for anyone else. Both decks end by offering staff a
number of their own. It is reachable again afterwards from the info button in
the header, and the pages themselves live in `src/staffWalkthrough.js`; keep
them in step with this chapter when the controls change.

### Log In

1. Open `/control`
2. Click `Login with Discord`
3. Use a Discord account that has the configured staff role

If your account is missing the staff role, the app shows an access denied message. Staff access is granted by the Firebase custom token created from the Discord roles checked in `functions/index.js`.

### Staff Numbers

Staff get a number of their own, and it sits before `#1` rather than in the
queue: `S1`, `S2`, `S3`, handed out from a separate counter in the order staff
claim them. A staff account can never be given a regular number — the server
decides which counter to draw from, from the role on the signed-in token, so
there is no setting to get wrong and nothing an attendee can send to claim one.

What that means in practice:

- Staff are never called with a group, and never appear in a final call
- Staff are left out of the attendee count, the turnout graph and the figures a closed event is archived with. Items they pick up still count as items handed out
- Staff are off the raffle wheel unless `Staff In Draw` is switched on in the raffle settings
- A staff ticket's QR code is live from the moment a round is announced — while the display still reads `Round X is Starting Soon`, before the first group is called — and stays live for the rest of that round. Staff come up then, or at any point after it, and the code is scanned at the table exactly like an attendee's
- Once a staff member has picked something up, their code is hidden until the next round is announced, the same one-item-per-round rule everybody else is on

Someone who took an attendee number before they had the staff role keeps that
number: it is already on their ticket and the room has already seen it. They
move into the staff list, and everything above applies to them from then on.

### Create An Event

When no event is live, `/control` shows a landing screen offering `Create Event`, `Past Events` and `How It Works`.

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

- `Start Round N`: Calls the first group of a pending round, once at least one attendee has a number
- `Next Group`: Advances by the current `People Per Group` setting
- `Final Call`: Appears after the last group. It targets attendees who have not claimed in the current round
- `Start Next Round`: Appears during final call. It ends the round and leaves the next one pending
- The undo arrow to the left of those buttons: Steps the queue back one place along the same path. See [Go Back A Step](#go-back-a-step)

The current group list shows:

- Attendee number
- Attendee name/avatar
- Waiting/claimed state
- Total item count
- Member status

The round progress card shows how many attendees have claimed an item in the current round.

### Go Back A Step

The undo arrow to the left of the `Start Round N` / `Next Group` button rewinds the queue. It walks the same path the round came forward on, one step per press, in reverse:

- A group goes back to the group before it
- The first group of a round goes back to that round, not yet started
- Final call goes back to the last group of its round
- A round that has not started yet goes back to the previous round's final call

Round 1 with nothing called has nothing behind it, so the button is disabled there.

A rewind never undoes a pickup:

- Items already handed over stay recorded on the attendee, in their item count and in the graphs
- Anyone who already claimed cannot claim again when their group comes round a second time. The check is "claimed in this round or a later one", so a claim made in a round the queue has since been rewound out of still counts. It is enforced server-side in `functions/index.js`, not only in the UI
- Attendees who did *not* claim when their group was first called get another chance at it
- Every group now ahead of the queue has its QR code hidden again until its number comes up

Going back also switches auto-advance off. Left on, it would look at the group it had just been rewound into, find it already claimed past its threshold, and step straight forward again. Turn it back on when you are ready to carry on.

The button asks for confirmation first, and the dialog carries a `Don't ask again for this event` checkbox. That preference is stored in the browser, per event, so it does not carry over to the next event or to another staff member's device.

### Final Call

Use final call after the last normal group. Final call includes attendees who have not claimed an item in the current round.

During final call:

- The display shows `FINAL CALL`
- The queue lists the final-call attendees
- Staff can scan attendee QR codes exactly like a normal group
- Staff can click `Start Next Round` when final call is done

### Auto-Advance

The fast-forward icon toggles auto-advance on or off.

The settings icon opens the auto-advance settings panel, in the order they appear:

- `People Per Group`: Number of people included in each new group. The app UI allows 1 to 20
- `Next Group`: Automatically calls the next normal group when the active group reaches the claimed percentage on its slider. The app UI allows 10% to 100%
- `Group Timer`: Moves to the next group once the current one has been up this long, whether or not the threshold was met. 1 to 10 minutes. It is an independent trigger, so it still fires when `Next Group` is off
- `Next Round`: Turning it on reveals a 1 to 10 minute slider. Once a round is pending, its first group is called automatically after that long. Off means a pending round waits until staff press `Start Round N`
- `Final Call Timer`: Ends final call after 1 to 10 minutes and leaves the next round pending. Independent of `Next Round`
- `Backlog Limit`: Holds auto-advance until this percentage of everyone already called this round has claimed. The app UI allows 10% to 100%

Entering final call has no toggle. It is the only way a round can end, so auto-advance always enters it once the last group is done.

Leaving final call has exactly two paths: staff press `Start Next Round`, or the `Final Call Timer` runs out. The claimed threshold does not end final call — stragglers are the reason it exists, so clearing the queue early is no reason to stop waiting for them. Either path leaves the next round pending rather than calling a group, which is then the `Next Round` timer's job.

Auto-advance respects the backlog limit and only runs for staff while the control panel is open.

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

### Run A Prize Raffle

The main panel has two modes, switched with the `Groups` / `Prize Raffle` tabs above it. They are tabs rather than two separate screens because the display can only be doing one of these things at a time — calling groups, or running a raffle. Switch back and forth as often as you like; the round is not disturbed.

The `Prize Raffle` tab shows an `ON AIR` badge whenever the wheel is actually up on the display, so you can see what the projector is doing from either tab.

The raffle panel works like the group panel: a settings button in the corner, one primary action, and a list underneath.

- The gear icon opens the raffle settings
- The primary button is `Switch to Raffle Display` until the wheel is up, then `Spin`

Neither panel has a separate button for handing the display over. The panel that is *not* on the display offers the handover as its primary action instead — `Switch to Raffle Display` on the raffle tab, `Switch to Group Display` on the groups tab — and goes back to offering its own next step once it has the screen. The `ON DISPLAY` badge on the tabs says which of the two the room is looking at. `Switch to Group Display` is held disabled while the wheel is mid-spin, so the result cannot be taken off the screen before the room has seen it.

Settings, behind the gear:

- `Staff In Draw`: Off by default, so staff are never drawn. Turn it on to put staff on the wheel alongside the attendees
- `Members Only`: Only attendees with the member role are on the wheel. Off means everyone holding a number is
- `Member Chances`: How many entries a member gets to a guest's one, from 1 to 5. At 1 everybody is equal. Above that, a member's slice on the wheel is that many times wider and their odds go up by exactly the same amount — the wheel shows the real odds rather than an illustration of them. No effect while `Members Only` is on, since everybody on the wheel is already a member
- `Must Join`: Off by default. Turn it on and attendees get a `Join the Raffle` button on their ticket; only those who press it go on the wheel
- `Repeat Winners`: Off by default, so anyone who has already won a raffle this event is left out of every later draw. Turn it on to put previous winners back on the wheel
- `Clear Winner List`: Puts every winner back in the draw and stops their prize codes working

These stack rather than replace each other. With `Members Only` and `Must Join` both on, the wheel holds members who joined.

Running one:

1. Click `Switch to Raffle Display`. The display splits in half: the whole wheel, carrying every eligible attendee's number and name, sits in the left half, and the event title and draw count move into the right half
2. Click `Spin`. The wheel slides off the left edge of the display and grows taller than the screen, so only its right third shows and the names passing the pointer are readable from the back of the room. It then turns for about six seconds, and confetti fires as it lands
3. The winning name grows out of the wheel where the pointer stopped, pulsing, with `WINNER!` above it. The slice labels fade back while it is up, so the announcement is the only thing to read. The right-hand side of the display stays readable throughout
4. Click `Clear Winner` when the room has had its moment. That takes the result off the display and puts the button back to `Spin`, ready for the next prize. It is a separate press on purpose — spinning straight over a winner used to wipe the only thing announcing them
5. Repeat from step 2 for as many prizes as you have
6. Open the `Groups` tab and click `Switch to Group Display` to take the wheel down and hand the display back to the round in progress

`Clear Winner` only clears the result on screen. The winner keeps their prize code and stays out of later draws — that is what makes it different from `Clear Winner List` in the settings, which throws away the whole event's winners.

While the wheel is up, auto-advance stands down and no groups are called. The room is watching a prize draw, so an attendee whose number came up then would never see it. The round resumes exactly where it left off once the wheel comes down — nothing is skipped.

The winner is drawn when you press `Spin` and written to the event straight away, so the display, a second control panel and the winner's own phone all land on the same person. A screen opened part-way through a spin joins it in progress rather than starting its own.

### The Winner List

Every winner this event is listed in the raffle panel, newest first, in the same rows as the attendee list — avatar, number, name and member status — plus:

- A green row once the prize has been collected, the same green the group list uses for someone who has taken their item, so who still owes a trip to the prize table reads off the colour rather than a tag. Item counts are not shown here — they belong to the item queue, not the raffle
- A QR button that opens their ticket as they see it, for a winner whose own phone cannot show it
- A bin button that removes the attendee from the event entirely, exactly as it does in the attendee list

On a narrow screen those buttons fold behind a `...` circle at the end of the row and open in a popover, so the number, name and status stay readable on a phone. The attendee list and the queue do the same.

The winner of a spin in progress is not listed until the wheel stops, so staff find out at the same moment the room does.

### Claim A Raffle Prize

The winner's phone shows a separate prize card above their normal ticket, with its own QR code. Scan it with `Open Scanner`, exactly like an item claim — the scanner tells the two kinds of code apart on its own.

Raffle prizes are deliberately kept out of the numbers:

- They never touch item claim counts, round progress, the attendee list's item totals, the graphs, or the archived event metrics
- The one thing a scan records is that the prize was collected, which is what the winner list shows. Scanning the same code again reports `already collected` rather than counting anything twice
- Winners are remembered only as attendee numbers, so that later draws can leave them out and their prize codes keep working

A winner's prize code stays valid for the rest of the event. Running another raffle does not invalidate it, so somebody who won the first spin can still collect after the third.

### Manage The Attendee List

The `Attendee List` card shows everyone with an assigned number, with staff in
their own list above the attendees.

Staff can:

- Search by attendee name or number, staff numbers included (`S2` finds staff member two)
- Filter by member status
- Filter by item claim status
- Hide or show the staff list with the `Hide` / `Show` button on its header
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

When the called number range reaches the attendee's number, the page changes to `You're up!` and displays the personal claim QR code.

### Claim An Item

1. Wait until your personal QR code appears
2. Pick an item
3. Show the personal QR code to staff
4. Staff scan it to mark your claim

After a successful scan, the QR code hides for the rest of that round. It appears again in a later round when your number is called again.

### Join A Raffle

If staff have turned on `Must Join`, a `Join the Raffle` button appears on your ticket under your QR code. Press it to go on the prize wheel — you are not in the draw until you do. Once you are in, the button becomes a `You're in the raffle` confirmation and stays there.

If staff have not turned it on, you are in the draw automatically and no button appears.

### Win A Raffle

If staff run a raffle and your number comes up, a `You won the raffle!` card appears above your ticket with its own QR code. Show it to staff at the prize table.

It is separate from your item claim: winning a raffle does not use up your item for the round, and it stays on your screen for the rest of the event.

### Being Told It Is Your Turn

There are no browser notifications. The page was built around a service worker
and a bell button once; both are gone, and `src/main.jsx` now unregisters the
old worker on load so it does not sit resident on returning attendees' phones.

What an attendee gets instead, on the page itself, the moment their code goes
live: the ticket turns over to show the QR, the phone buzzes
(`src/haptics.js` — `navigator.vibrate` on Android, and on iOS a hidden native
switch control, which is the only way to reach the Taptic Engine from a web
page), and the display fires confetti and a chime. A phone face-down on a table
is the case the buzz exists for.

## Public Display Guide

Open `/display` on the room screen.

Use it for:

- Showing the current round and eligible group
- Showing `Starting Soon` before calls begin
- Showing `FINAL CALL` when final call is active
- Showing the raffle wheel, and the winner, while staff run a raffle
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

- `DISCORD_BOT_TOKEN`: Lets staff refresh queued attendee membership through the Discord bot API. Stored in Secret Manager, not in a file:

```bash
npx firebase-tools functions:secrets:set DISCORD_BOT_TOKEN
```

  Without it, `Refresh` and `Refresh All` fall back to the roles cached in each user's Firebase token rather than re-checking Discord. The functions log a warning when this happens.

- `DISCORD_GUILD_ID`, `DISCORD_MEMBER_ROLE_ID`, `DISCORD_STAFF_ROLE_IDS`: Optional overrides for the Discord guild and roles, set in `functions/.env`. They default to the Boiler Book Club guild.

The current Discord client ID, guild ID, member role ID, and staff role ID are hard-coded in `src/useDiscordLogin.js` and `functions/index.js`.

### Run Against Local Emulators (recommended)

Everything runs offline — local Firestore, Auth and Functions, no live project,
no real attendees, and no Discord role required.

Add to `.env.local`:

```bash
VITE_USE_FIREBASE_EMULATORS=true
```

Then, in three terminals:

```bash
npm run emulators   # Firestore, Auth and Functions on 8080 / 9099 / 5001
npm run seed        # a live event with 12 attendees; prints working URLs
npm run dev         # the app on 5173
```

`npm run seed` prints an attendee link containing a currently-valid check-in
code. That code rotates every 60 seconds, so re-run `npm run seed` for a fresh
one or scan the QR code off `/display`.

#### Signing in without Discord

The emulator accepts three fake logins, so you can exercise staff and attendee
flows without holding the Discord staff role. In the browser console:

```js
localStorage.setItem("devLogin", "dev:staff");   // or dev:member, dev:guest
location.reload();
```

Remove the key (`localStorage.removeItem("devLogin")`) to go back to a real
Discord login. The server only honours these under the emulator.

| Token | Sees |
| --- | --- |
| `dev:staff` | `/control`, the scanner, and the display QR code |
| `dev:member` | Attendee view with member early check-in |
| `dev:guest` | Attendee view as a non-member |

These exist only when `FUNCTIONS_EMULATOR` is set, which the emulator sets and
nothing else does — the branch cannot run in a deployed function.

Emulator data persists between runs in `.emulator-data/` (gitignored). Delete it
to start clean.

### Run Against The Live Project

```bash
npm run dev
```

Leave `VITE_USE_FIREBASE_EMULATORS` unset. This talks to the real project, so a
real event and real attendees are involved — prefer the emulator loop above.

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
- `state.raffleOpen`, `state.raffleMembersOnly`, `state.raffleRequireOptIn`, `state.raffleMemberChances`, `state.raffleAllowRepeatWinners`: Raffle settings
- `state.raffleSpinCount`, `state.raffleSpinStartedAtMs`, `state.raffleWinnerNumber`: The spin in progress, which every screen animates from
- `state.raffleWinnerNumbers`: Every winning number this event, which is what keeps previous winners out of later draws and keeps their prize codes valid
- `claims/{claimId}.raffleJoinedAtMs`: When an attendee opted into the raffle, if `Must Join` is on
- `claims/{claimId}.raffleClaimedAtMs`: When a winner collected their prize. These two are all a raffle ever writes to a claim, and both sit deliberately nowhere near the item-claim fields

## Cloud Functions

Cloud Functions handle trusted server-side work:

- Exchange Discord OAuth access tokens for Firebase custom tokens
- Assign queued attendees when their window opens
- Let staff assign, remove, refresh, or re-queue attendees
- Redeem attendee QR codes as staff
- Put an attendee into the raffle when they press Join, so who is in the draw is server-recorded
- Confirm raffle prize QR codes as staff, recording only that the prize was collected
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

`.github/workflows/deploy.yml` runs on pushes to `main` and can also be run manually. It has three stages:

1. `test` — lint, unit tests, and Firestore rules tests against the emulator. Everything else depends on this passing.
2. `deploy-staging` — skipped entirely until the `STAGING_FIREBASE_PROJECT_ID` repository variable is set.
3. `deploy-production` — gated by the `production` environment, so you can require a manual review in repo Settings → Environments.

#### Adding a staging project

Functions require the Blaze plan, so billing has to be linked by hand:

```bash
npx firebase-tools projects:create boiler-book-club-number-caller-staging
# Link billing and provision Firestore in the console, then:
npx firebase-tools apps:create WEB "Event Pass Staging" --project boiler-book-club-number-caller-staging
npx firebase-tools apps:sdkconfig WEB --project boiler-book-club-number-caller-staging
```

Then in the repo:

- Add a **variable** `STAGING_FIREBASE_PROJECT_ID` with the new project id. The staging job stays skipped until this exists.
- Add **secrets** `STAGING_FIREBASE_SERVICE_ACCOUNT`, `STAGING_VITE_FIREBASE_API_KEY`, `STAGING_VITE_FIREBASE_AUTH_DOMAIN`, `STAGING_VITE_FIREBASE_STORAGE_BUCKET`, `STAGING_VITE_FIREBASE_MESSAGING_SENDER_ID`, `STAGING_VITE_FIREBASE_APP_ID` from that config.
- Locally, `npx firebase-tools use --add` to register a `staging` alias.

#### Optional production secrets

- `VITE_FIREBASE_APPCHECK_SITE_KEY` — reCAPTCHA v3 site key. Makes the client send App Check tokens.
- `VITE_ERROR_REPORT_URL` — the deployed `reportClientError` URL. Client crashes are written to Cloud Logging.
- `VITE_DISCORD_CLIENT_ID` — override the Discord OAuth application.

Required GitHub secrets:

- `FIREBASE_SERVICE_ACCOUNT`: JSON for a service account with deploy permissions
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

The workflow installs root and Functions dependencies, runs lint, builds the app, authenticates to Google Cloud, and deploys with `firebase-tools`.

## App Check

App Check attests that requests come from this app rather than a script. It rolls out in two steps so a misconfiguration cannot take an event down:

1. Register a reCAPTCHA v3 site key in the Firebase console under App Check, and set `VITE_FIREBASE_APPCHECK_SITE_KEY`. The client now sends attestation tokens; the functions still accept requests without them.
2. Watch the App Check metrics until real traffic shows as verified, then set `ENFORCE_APP_CHECK=true` in `functions/.env` and redeploy. Callables now reject unattested requests.

Doing step 2 first would reject every callable, including attendee check-in.

## Error Reporting

`reportClientError` is an HTTP function that writes client crash reports to Cloud Logging. Deploy it, then set `VITE_ERROR_REPORT_URL` to its URL:

```
https://us-central1-<project-id>.cloudfunctions.net/reportClientError
```

Reports are logged, never stored in Firestore. Set `ERROR_REPORT_ALLOWED_ORIGINS` in `functions/.env` to restrict which origins may post.

## Security Notes

- Staff-only actions require a Firebase custom token with `staff: true`
- Member early access requires a Firebase custom token with `member: true`
- Firestore rules allow attendees to read their own queue/claim data and allow staff broader access
- Attendee check-in requires a rotating claim access code from the display QR code
- Personal claim QR codes include an event ID, claim ID, and token; staff redemption validates all three
- Raffle prize QR codes are validated the same way, plus a check that the attendee's number is on the event's winner list, so a losing attendee cannot mint one by editing their payload
- Raffle winners are stored as attendee numbers rather than claim IDs, because the live event document is world-readable and a claim ID carries the winner's Discord user ID
- Display names are screened server-side, not in the browser. The name comes from the request body — a Discord username is not verified either — so a filter that ran only in the client would be a direct callable request away from being skipped. A name the filter refuses falls back to `Guest` rather than blocking the check-in. Names are run through [obscenity](https://github.com/jo3-l/obscenity) against both the raw and separator-stripped forms, so `f u c k` and `f.u.c.k` are caught alongside `fvck`
- For production use, verify the Discord guild and role IDs in code before deployment
- `DISCORD_STAFF_USER_IDS` grants staff access to specific Discord user IDs regardless of guild roles. It exists to bootstrap the first staff member, since staff access otherwise requires a Discord role somebody else must grant. A listed ID still has to authenticate as that Discord account, so it is no weaker than the role check. Every grant is logged. Set it to an empty string in `functions/.env` to disable once real roles are assigned

## Troubleshooting

- `No event is currently live`: Start an event from `/control`
- `Scan the in-person event QR code`: The attendee opened `/` without a valid rotating claim code. Scan the QR code on `/display`
- Staff login succeeds but `/control` is denied: The Discord account does not have the configured staff role, or the Firebase custom token was created without `staff: true`
- Attendee is queued but not assigned: Check the event start time, member early check-in setting, and membership status. Staff can use `Refresh`, `Refresh All`, or `Assign Early`
- Scanner cannot start: Allow camera permission, use HTTPS or localhost, and make sure no other app is holding the camera
- QR scan says not eligible: The attendee's number has not been reached in the current round
- Raffle wheel is empty: Nobody is eligible. Attendees need a number first; with `Members Only` on the wheel holds members only, and with `Must Join` on it holds only those who pressed Join
- `Spin` is disabled: The raffle is not open yet, the draw pool is empty, or a spin is still running
- Scan says the attendee has not won a raffle prize: Their number is not on the event's winner list — usually the list was cleared, or the code is from an earlier event
- A winner's row is green before they have collected anything: they collected a prize earlier in the same event, and the winner list was cleared in between. Clearing the list revokes codes but does not erase past collections
