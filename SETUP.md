# Setup Guide — Facilitated Mode

The **solo version** (`solo.html`) runs entirely in the browser with no external services. If that is all you need, no setup is required.

The **facilitated version** uses Firebase Realtime Database to sync game state between the facilitator's projected screen and students' phones in real time. This guide walks you through creating a Firebase project, configuring the app, and deploying it.

## 1. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** (any name, e.g. "carbon-pricing-game")
3. Disable Google Analytics (not needed) and create the project
4. Go to **Project Settings > General > Your apps** and click the web icon (`</>`)
5. Register the app (any nickname) — do **not** enable Firebase Hosting
6. Copy the `firebaseConfig` object that Firebase shows you. You will need its values in step 3 below.

## 2. Enable Realtime Database

1. In the Firebase console, go to **Build > Realtime Database**
2. Click **Create Database**
3. Choose your preferred region, then select **Start in test mode** (for development)
4. For production use, replace the default rules with:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        "state": { ".write": true },
        "submissions": { ".write": true },
        "debrief": { ".write": true },
        "cleantech": { ".write": true },
        "meta": { ".write": true }
      }
    }
  }
}
```

**Troubleshooting `PERMISSION_DENIED` when creating a room:** Rules must allow `.write` on each of `state`, `submissions`, `debrief`, `cleantech`, and `meta` (see above). The app uses `update()` so those child rules apply; a parent-only `set()` on the whole room would also require `.write` on `$roomId` itself. Ensure `cleantech` is present if you added clean-tech claiming after an older rules deploy.

## 3. Add your Firebase config

Open `js/firebase-config.js` and replace the placeholder values with the config from your Firebase project:

```javascript
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'your-project.firebaseapp.com',
  databaseURL: 'https://your-project-default-rtdb.region.firebasedatabase.app/',
  projectId: 'your-project',
  storageBucket: 'your-project.firebasestorage.app',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abc123',
};
```

> **Note:** If you fork this repository, do not commit your real Firebase config to a public repo. The config file is listed in `.gitignore`; use `js/firebase-config.example.js` as a template.

## 4. Deploy

The app is entirely static files — no build step, no server required. Deploy to any static hosting provider.

### GitHub Pages

1. Push the repository to GitHub
2. Go to **Settings > Pages** in your repository
3. Set the source to the main branch, folder `/`
4. Your game will be available at `https://<username>.github.io/<repo-name>/`

### Local testing

Run a local web server from the project root (the folder containing `index.html`):

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000** in a browser. Stop the server with **Ctrl+C**.

## Troubleshooting

**Facilitator page stuck on "Loading..."**

- Create the room from **Create Game Room** on the landing page each time you test; opening `host.html?room=...` manually only works if that room already exists in Firebase under `rooms/<code>/state`.
- In the Firebase console, open **Realtime Database > Data** and confirm `rooms > <your code> > state` exists.
- Confirm `js/firebase-config.js` matches your project and that database **rules** allow read/write for `rooms` (see step 2 above).

## File structure

```
carbon-pricing-game/
├── index.html              Landing page (create room / join / solo link)
├── host.html               Facilitator view (projected on classroom screen)
├── play.html               Student view (mobile)
├── solo.html               Solo play against AI firms (no Firebase)
├── css/
│   ├── styles.css          Shared styles
│   └── solo.css            Solo mode layout overrides
├── js/
│   ├── firebase-config.js  Firebase project config (edit this — see step 3)
│   ├── game-engine.js      Pure game logic (no DOM, no Firebase)
│   ├── firebase-sync.js    Firebase read/write helpers
│   ├── ui-helpers.js       Shared formatters & rendering
│   ├── host-app.js         Facilitator UI logic
│   ├── play-app.js         Student UI logic
│   ├── solo-app.js         Solo mode UI and round processing
│   └── ai-strategies.js    AI firm behaviour (solo mode)
├── LICENSE                 CC BY-NC-SA 4.0
├── README.md               Project overview and pedagogical context
└── SETUP.md                This file
```
