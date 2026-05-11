---
modified_date: 2026-04-18
created_date: 2026-04-17
---
# Setup Guide

## Solo mode — no setup required

Open **[solo.html](https://genshanahan.github.io/carbon-pricing-simulation-game/solo.html)** in any browser. Solo mode runs entirely in the browser with no external services.

## Facilitated mode — using the hosted version (recommended)

The hosted version at **[genshanahan.github.io/carbon-pricing-simulation-game](https://genshanahan.github.io/carbon-pricing-simulation-game/)** is ready to use with no setup. Real-time sync between the facilitator's screen and students' phones is handled by a shared Firebase backend.

### How to run a session

1. Open the [landing page](https://genshanahan.github.io/carbon-pricing-simulation-game/) on the computer you will project in class.
2. Click **Create Game Room**. You will be taken to the facilitator view with a room code and QR code.
3. Students join on their phones by scanning the QR code or entering the room code at the same landing page.
4. Run the game through the five regimes. All decisions and state sync automatically across devices.

That is it — no accounts, no downloads, no Firebase configuration on your part.

---

## Forking the repository (optional, advanced)

If you want to run your own independent instance — for example, to customise the game or to use your own Firebase project — you can fork the repository and set up your own backend. Everything below applies **only** to forked/self-hosted instances.

### 1. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** (any name, e.g. "carbon-pricing-simulation-game")
3. Disable Google Analytics (not needed) and create the project
4. Go to **Project Settings > General > Your apps** and click the web icon (`</>`)
5. Register the app (any nickname) — do **not** enable Firebase Hosting
6. Copy the `firebaseConfig` object that Firebase shows you. You will need its values in step 3 below.

### 2. Enable Realtime Database

1. In the Firebase console, go to **Build > Realtime Database**
2. Click **Create Database**
3. Choose your preferred region, then select **Start in test mode** (for development)
4. In the Firebase console, go to **Build > Authentication > Sign-in method** and enable **Anonymous** sign-in. The app uses this only to identify the browser that created a facilitated room as the facilitator.
5. For production use, replace the default database rules with:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        "state": {
          ".read": true,
          ".write": "auth != null && auth.uid === root.child('rooms').child($roomId).child('meta').child('facilitatorUid').val()"
        },
        "submissions": { ".read": true, ".write": true },
        "debrief": { ".read": true, ".write": true },
        "cleantech": { ".read": true, ".write": true },
        "meta": {
          ".read": true,
          "createdAt": {
            ".write": "!data.exists() && auth != null"
          },
          "facilitatorUid": {
            ".write": "!data.exists() && auth != null && newData.val() === auth.uid"
          },
          "facilitatorConnected": {
            ".write": "auth != null && auth.uid === root.child('rooms').child($roomId).child('meta').child('facilitatorUid').val()"
          },
          "students": {
            "$firmId": { ".write": true }
          }
        }
      }
    }
  }
}
```

**Troubleshooting `PERMISSION_DENIED` when creating a room:** Confirm Anonymous Authentication is enabled and that the rules above are deployed. The app creates `meta/facilitatorUid` first, then writes `state`; subsequent state writes are accepted only from the same anonymous Firebase user. Ensure `cleantech` is present if you added clean-tech claiming after an older rules deploy.

### 3. Add your Firebase config

Copy `js/firebase-config.example.js` to `js/firebase-config.js` and replace the placeholder values with your own project's config:

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

Firebase web API keys are designed to be public (they identify the project, not grant privileged access). Database security is enforced by the Realtime Database rules in step 2. For additional protection, you can restrict your API key to specific referrer domains in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

### 4. Deploy

The app is entirely static files — no build step, no server required. Deploy to any static hosting provider.

#### GitHub Pages

1. Push the repository to GitHub
2. Go to **Settings > Pages** in your repository
3. Set the source to the main branch, folder `/`
4. Your game will be available at `https://<username>.github.io/<repo-name>/`

#### Local testing

Run a local web server from the project root (the folder containing `index.html`):

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. Stop the server with **Ctrl+C**.

---

## Troubleshooting

### Facilitator page stuck on "Loading…"

- Create the room from **Create Game Room** on the landing page each time; opening `host.html?room=...` manually only works if that room already exists in Firebase under `rooms/<code>/state`.
- If you are running a forked instance, open **Realtime Database > Data** in the Firebase console and confirm `rooms > <your code> > state` exists.
- Confirm `js/firebase-config.js` matches your project and that database **rules** allow read/write for `rooms` (see step 2 above).

## File structure

```text
carbon-pricing-simulation-game/
├── index.html              Landing page (create room / join / solo link)
├── host.html               Facilitator view (projected on classroom screen)
├── play.html               Student view (mobile)
├── solo.html               Solo play against AI firms (no Firebase)
├── privacy.html            Privacy & cookie policy
├── css/
│   ├── styles.css          Shared styles
│   └── solo.css            Solo mode layout overrides
├── js/
│   ├── firebase-config.js  Firebase project config (forked instances only)
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
