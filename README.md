# Number Caller

This app now supports:

- A public display screen that updates live for everyone watching
- A control screen that writes the current number range to Firebase
- Firebase Hosting deployment for a public URL

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file from [.env.example](./.env.example):

```bash
cp .env.example .env.local
```

3. In the Firebase console, create a project and enable Firestore Database in production or test mode.

4. Copy your Firebase web app config values into `.env.local`.

5. Start the app:

```bash
npm run dev
```

Use these URLs locally or after deployment:

- Display screen: `/` or `/?mode=display`
- Control screen: `/?mode=control`

## Deploy to Firebase Hosting

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

## Auto Deploy With GitHub Actions

This repo now includes [/.github/workflows/deploy.yml](./.github/workflows/deploy.yml).

It will:

- run on every push to `main`
- lint the project
- build the Vite app with your Firebase env vars
- deploy to the Firebase project in [.firebaserc](./.firebaserc)

### GitHub secrets to add

In your GitHub repo, go to `Settings > Secrets and variables > Actions` and create these repository secrets:

- `FIREBASE_SERVICE_ACCOUNT`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### What goes in FIREBASE_SERVICE_ACCOUNT

1. Open Google Cloud or Firebase for the project `boiler-book-club-number-caller`
2. Create or select a service account with permission to deploy Firebase Hosting and Firestore rules
3. Generate a JSON key
4. Paste the full JSON contents into the `FIREBASE_SERVICE_ACCOUNT` GitHub secret

### What goes in the VITE secrets

Use the same values you put in `.env.local` for local development. They come from your Firebase Web App config.

### How to enable it in the GitHub repo

1. Push these workflow files to the repo
2. Add the secrets listed above in GitHub
3. Push to `main`

After that, every push to `main` will deploy automatically.

## Important note about write access

The current Firestore rules in [firestore.rules](./firestore.rules) allow public reads and writes so the app works immediately from a static hosted site.

That is acceptable for a quick event setup, but it is not secure for long-term public use. If you want, the next step is to lock writes behind Firebase Authentication or a small server-side admin endpoint.
