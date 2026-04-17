/**
 * Firebase Realtime Database sync layer.
 * Uses the Firebase compat SDK (loaded via <script> tag; `firebase` is a global).
 */

import { FIREBASE_CONFIG } from './firebase-config.js';

let db = null;
let appInitialised = false;

function ensureInit() {
  if (appInitialised) return;
  /* global firebase */
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.database();
  appInitialised = true;
}

function roomRef(roomCode) {
  ensureInit();
  return db.ref(`rooms/${roomCode}`);
}

/* ── Room lifecycle ── */

export async function createRoom(roomCode, initialState) {
  ensureInit();
  const ref = roomRef(roomCode);
  /* Use update (not set) on the room root so rules evaluate per child path.
     Rules that only allow `.write` on `state`, `meta`, etc. reject a parent
     `set()` that replaces the whole room object (PERMISSION_DENIED). */
  await ref.update({
    state: initialState,
    submissions: {},
    debrief: {},
    cleantech: {},
    meta: {
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      facilitatorConnected: true,
    },
  });
  ref.child('meta/facilitatorConnected').onDisconnect().set(false);
  return roomCode;
}

export async function roomExists(roomCode) {
  ensureInit();
  const snap = await roomRef(roomCode).child('meta').once('value');
  return snap.exists();
}

export async function joinRoom(roomCode) {
  ensureInit();
  const snap = await roomRef(roomCode).child('state').once('value');
  if (!snap.exists()) throw new Error('Room not found');
  return snap.val();
}

export async function deleteRoom(roomCode) {
  ensureInit();
  await roomRef(roomCode).remove();
}

/* ── State sync (facilitator writes, everyone reads) ── */

export async function pushState(roomCode, state) {
  await roomRef(roomCode).child('state').set(state);
}

export function onStateChange(roomCode, callback) {
  ensureInit();
  const ref = roomRef(roomCode).child('state');
  ref.on('value', snap => {
    /* Always notify: if the room or `state` node is missing, snap.exists() is
       false — the UI must still update (otherwise it stays on "Loading…"). */
    callback(snap.exists() ? snap.val() : null);
  });
  return () => ref.off('value');
}

/* ── Student submissions (students write, facilitator reads) ── */

export async function submitDecision(roomCode, regime, round, firmId, quantity) {
  ensureInit();
  await roomRef(roomCode)
    .child(`submissions/${regime}_${round}/${firmId}`)
    .set({ quantity, timestamp: firebase.database.ServerValue.TIMESTAMP });
}

export function onSubmissions(roomCode, regime, round, callback) {
  ensureInit();
  const ref = roomRef(roomCode).child(`submissions/${regime}_${round}`);
  ref.on('value', snap => {
    callback(snap.exists() ? snap.val() : {});
  });
  return () => ref.off('value');
}

export async function clearSubmissions(roomCode, regime, round) {
  ensureInit();
  await roomRef(roomCode).child(`submissions/${regime}_${round}`).remove();
}

/* ── Debrief proposals (students write, facilitator reads) ── */

export async function submitProposal(roomCode, regime, firmId, text) {
  ensureInit();
  await roomRef(roomCode)
    .child(`debrief/${regime}/${firmId}`)
    .set({ text, timestamp: firebase.database.ServerValue.TIMESTAMP });
}

export function onProposals(roomCode, regime, callback) {
  ensureInit();
  const ref = roomRef(roomCode).child(`debrief/${regime}`);
  ref.on('value', snap => {
    callback(snap.exists() ? snap.val() : {});
  });
  return () => ref.off('value');
}

/* ── Clean-tech claims (first-come slots; facilitator mirrors checkboxes here) ── */

function normalizeCleantechClaims(current) {
  if (!current || typeof current !== 'object') return {};
  const out = {};
  if (Array.isArray(current)) {
    for (let i = 0; i < current.length; i++) {
      if (current[i]) out[String(i)] = true;
    }
    return out;
  }
  for (const k of Object.keys(current)) {
    if (k.startsWith('.')) continue;
    if (current[k]) out[k] = true;
  }
  return out;
}

/** Facilitator: set or remove a firm's clean-tech claim in RTDB (mirrors checkbox). */
export async function mirrorCleanTechClaim(roomCode, regime, firmId, claimed) {
  ensureInit();
  const r = roomRef(roomCode).child(`cleantech/${regime}/${firmId}`);
  if (claimed) await r.set(true);
  else await r.remove();
}

/**
 * Student: atomically claim a clean-tech slot if fewer than maxSlots firms have claimed.
 * @returns {Promise<{ ok: boolean }>}
 */
export async function claimCleanTech(roomCode, regime, firmId, maxSlots) {
  ensureInit();
  /* Coerce so bad/missing RTDB config never makes `>= maxSlots` trivially true (e.g. 0). */
  const cap = Math.max(1, Math.min(100, Number(maxSlots) || 3));
  const ref = roomRef(roomCode).child(`cleantech/${regime}`);
  return new Promise((resolve, reject) => {
    ref.transaction(
      (current) => {
        console.log(`[FB] claimCleanTech transaction update: current=`, JSON.stringify(current));
        const c = normalizeCleantechClaims(current);
        const k = String(firmId);
        if (c[k]) { console.log(`[FB] already claimed`); return c; }
        if (Object.keys(c).length >= cap) { console.log(`[FB] slots full`); return undefined; }
        const next = { ...c, [k]: true };
        console.log(`[FB] claiming, returning`, JSON.stringify(next));
        return next;
      },
      (error, committed, snapshot) => {
        console.log(`[FB] claimCleanTech complete: error=`, error, `committed=`, committed, `snapshot=`, snapshot?.val());
        if (error) reject(error);
        else resolve({ ok: !!committed });
      },
      false,
    );
  });
}

export function onCleanTechClaims(roomCode, regime, callback) {
  ensureInit();
  const ref = roomRef(roomCode).child(`cleantech/${regime}`);
  ref.on('value', snap => {
    callback(snap.exists() ? normalizeCleantechClaims(snap.val()) : {});
  });
  return () => ref.off('value');
}

/** One-shot read of `cleantech/{regime}` (keeps host cache aligned if claims happened while the listener was off). */
export async function fetchCleantechClaims(roomCode, regime) {
  ensureInit();
  const snap = await roomRef(roomCode).child(`cleantech/${regime}`).once('value');
  if (!snap.exists()) return {};
  return normalizeCleantechClaims(snap.val());
}

/* ── Student connection tracking ── */

export async function registerStudent(roomCode, firmId) {
  ensureInit();
  const ref = roomRef(roomCode).child(`meta/students/${firmId}`);
  await ref.set(true);
  ref.onDisconnect().set(false);
}

export function onStudentConnections(roomCode, callback) {
  ensureInit();
  const ref = roomRef(roomCode).child('meta/students');
  ref.on('value', snap => {
    callback(snap.exists() ? snap.val() : {});
  });
  return () => ref.off('value');
}
