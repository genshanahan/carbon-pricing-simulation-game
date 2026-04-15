---
created_date: 2026-04-14
modified_date: 2026-04-15
---

## The Carbon Pricing Simulation Game (V2)

An interactive classroom simulation of five carbon regulation regimes - from free markets to cap & trade - designed for sustainability education.

Adapted from *The Thingamabob Game* (Bigelow 2009), *The Carbon Emissions Game* (Sethi 2017), and *The Pollution Game* (Corrigan 2011). Extended by Dr Genevieve Shanahan, Cardiff Business School.

### Licence

This project is released under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)). See the [`LICENSE`](LICENSE) file in this folder.

GitHub’s “Choose a licence” dropdown does not list CC BY-NC-SA; choose **No licence** when creating the repository, then add the `LICENSE` file from this folder (or paste the [full legal code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode) if you prefer).

### How it works

A **facilitator** creates a game room (projected on-screen). **Students** join on their phones by scanning a QR code or entering a room code. The facilitator drives the game through five regulatory regimes; students see regime rules, use calculators to plan strategy, and submit production decisions digitally.

Real-time sync between devices is handled by Firebase Realtime Database (free tier).

### Setup

#### 1. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** (any name, e.g. "carbon-pricing-game")
3. Disable Google Analytics (not needed) and create
4. Go to **Project Settings > General > Your apps** and click the web icon (`</>`)
5. Register the app (any nickname) - do **not** enable Firebase Hosting
6. Copy the `firebaseConfig` object

```
<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyC8aLy5pMNi4dIuHQf-tlhkiLV2kRWLnK0",
    authDomain: "carbon-pricing-game.firebaseapp.com",
    projectId: "carbon-pricing-game",
    storageBucket: "carbon-pricing-game.firebasestorage.app",
    messagingSenderId: "955303771390",
    appId: "1:955303771390:web:49093d49e79b33e756f9af",
    measurementId: "G-NJJES76EWQ"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
```

#### 2. Enable Realtime Database

1. In the Firebase console, go to **Build > Realtime Database**
2. Click **Create Database**
3. Choose your region, then **Start in test mode** (for development)
4. ==For production, replace the default rules with:

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

#### 3. Add your Firebase config

Open `js/firebase-config.js` and replace the placeholder values with your project's config:

```javascript
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSy...',
  authDomain: 'your-project.firebaseapp.com',
  databaseURL: 'https://your-project-default-rtdb.firebaseio.com',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abc123',
};
```

#### 4. Deploy

The app is entirely static files - no build step, no server. Deploy to any static hosting:

**GitHub Pages:**
1. Push the `v2/` folder to a GitHub repository
2. Enable Pages in repo Settings > Pages (source: main branch, folder: `/`)

~~**Netlify:**~~
~~1. Drag the `v2/` folder onto [Netlify Drop](https://app.netlify.com/drop)~~
~~https://enchanting-vacherin-22d1de.netlify.app/ ~~

**Local testing:** run these **in your Mac Terminal or the Cursor terminal**, on your machine (not on GitHub).

You must `cd` into **this** folder — the one that contains `index.html` (named `v2` inside *Extended Thingamabob Game*). If your terminal starts in the AIS workspace root, use:

```bash
cd "2-Live/8-Teaching/Lesson plans/BST462 2026/Extended Thingamabob Game/v2"
python3 -m http.server 8000
```

Then open **http://localhost:8000** in a browser. Stop the server with **Ctrl+C** in that terminal.

If you are already inside the `v2` folder (e.g. you opened the terminal from that folder in Cursor), you only need:

```bash
python3 -m http.server 8000
```

(ES modules require a local server; opening `index.html` directly from the file system will not work.)

### Troubleshooting

**Facilitator page stuck on "Loading…"**

- Create the room from **Create Game Room** on the landing page each time you test; opening `host.html?room=...` manually only works if that room already exists in Firebase Realtime Database under `rooms/<code>/state`.
- In the Firebase console, open **Realtime Database → Data** and confirm `rooms → <your code> → state` exists.
- Confirm `js/firebase-config.js` matches your project and that database **rules** allow read/write for `rooms` (see setup steps above).

### File structure

```
v2/
├── index.html           Landing page (create/join room)
├── host.html            Facilitator view (projected)
├── play.html            Student view (mobile)
├── css/
│   └── styles.css       Shared styles
├── js/
│   ├── firebase-config.js   Firebase project config (edit this)
│   ├── game-engine.js       Pure game logic (no DOM, no Firebase)
│   ├── firebase-sync.js     Firebase read/write abstraction
│   ├── ui-helpers.js        Shared formatters & rendering
│   ├── host-app.js          Facilitator UI logic
│   └── play-app.js          Student UI logic
└── README.md
```

### Game flow

1. Facilitator opens the landing page and clicks **Create Game Room**
2. Room code and QR code appear - students scan to join
3. Facilitator names firms and begins Round 1 (Free Market)
4. Each round: students submit production decisions on their phones → facilitator processes the round → results update on all screens
5. After each regime, facilitator advances to the next
6. Final Results screen shows cross-regime comparison for class discussion
