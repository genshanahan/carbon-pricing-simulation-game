/**
 * Firebase project configuration.
 *
 * SETUP: Create a Firebase project at https://console.firebase.google.com/
 *   1. Create a new project (or use an existing one)
 *   2. Add a Web app (Project Settings > General > Your apps > Add app)
 *   3. Copy your config values into a new file: js/firebase-config.js
 *   4. Enable Realtime Database (Build > Realtime Database > Create Database)
 *      — choose "Start in test mode" for development
 *   5. For production, set database rules (see SETUP.md)
 */
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'your-project.firebaseapp.com',
  databaseURL: 'https://your-project-default-rtdb.region.firebasedatabase.app/',
  projectId: 'your-project',
  storageBucket: 'your-project.firebasestorage.app',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abc123',
};
