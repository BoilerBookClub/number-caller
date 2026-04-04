# Event Pass

This app now supports:

- A public display screen that updates live for everyone watching
- A control screen that writes the current number range to Firebase
- Firebase Hosting deployment for a public URL

## Local setup

1. Install dependencies:

```bash

# Event Pass

Event Pass is a real-time event management web app designed for events like book giveaways, raffles, or any scenario where participants are called up in a randomized or sequential order. It provides a seamless experience for both organizers and attendees, with live updates and QR code-based claiming.

## Key Features

- **Live Display Screen**: A public-facing screen (e.g., on a projector or TV) that shows the current round, called numbers, and event title. Updates in real time for all viewers.
- **Control Panel**: An organizer-only interface to advance rounds, call numbers, and manage the event flow. Changes are instantly reflected on all connected screens.
- **Attendee Claim Page**: Each participant can view their number, see when they are called, and claim their item by showing a QR code for staff to scan.
- **QR Code Verification**: Staff can scan attendee QR codes to confirm claims and prevent duplicates.
- **Firebase Integration**: Uses Firestore for real-time data sync and Firebase Hosting for easy deployment.
- **Discord OAuth (optional)**: Supports Discord login for attendee authentication.

## How It Works

1. **Organizers** use the Control Panel to start rounds and call numbers.
2. **Attendees** watch the Display Screen or their Claim Page to see when their number is called.
3. When called, an attendee claims their item and presents their QR code to staff.
4. Staff scan the QR code to confirm the claim in the system.

## Screens & URLs

- **Main attendee screen**: `/` — For participants to check their number and claim status.
- **Display screen**: `/display` — For projecting the current round and called numbers to the room.
- **Control screen**: `/control` — For organizers to manage the event.

## Local Setup

1. **Install dependencies:**
	```bash
	npm install
	```
2. **Create your local env file:**
	```bash
	cp .env.example .env.local
	```
3. **Set up Firebase:**
	- Create a Firebase project and enable Firestore Database.
	- Copy your Firebase web app config values into `.env.local`.
4. **Start the app:**
	```bash
	npm run dev
	```

## Deployment

### Deploy to Firebase Hosting

1. Log in to Firebase:
	```bash
	npx firebase-tools login
	```
2. Link this folder to your Firebase project:
	```bash
	npx firebase-tools use --add
	```
3. Deploy Hosting and Firestore rules:
	```bash
	npm run deploy
	```

### Auto Deploy With GitHub Actions

This repo includes a GitHub Actions workflow for automatic deployment on push to `main`. See [/.github/workflows/deploy.yml](./.github/workflows/deploy.yml).

#### Required GitHub Secrets

- `FIREBASE_SERVICE_ACCOUNT`: JSON key for a Firebase service account with deploy permissions.
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, etc.: Your Firebase web app config (same as in `.env.local`).

## Security Note

The default Firestore rules allow public reads and writes for quick event setup. For production or public use, secure your database by requiring authentication or restricting writes.

---
For more details, see the comments in each screen or component file, or contact the project maintainer.
4. Paste the full JSON contents into the `FIREBASE_SERVICE_ACCOUNT` GitHub secret
