// ══════════════════════════════════════════════════════════════════════════════
//  FIREBASE SETUP — fill in your credentials here
// ══════════════════════════════════════════════════════════════════════════════
//
//  HOW TO GET YOUR FREE CONFIG (takes ~5 minutes):
//
//  1. Go to https://console.firebase.google.com
//  2. Click "Add project" → name it anything → Continue
//  3. Disable Google Analytics (not needed) → Create project
//  4. On the Project Overview page click the </> Web icon → name the app → Register
//  5. Copy the firebaseConfig values shown and paste them below
//  6. In left sidebar → Build → Firestore Database
//     → Create database → Start in TEST MODE → pick any region → Done
//
//  Free Spark plan limits (more than enough for your game):
//    • 50,000 reads / day
//    • 20,000 writes / day
//    • 1 GB storage
//
// ══════════════════════════════════════════════════════════════════════════════

import { initializeApp }                            from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot }   from "firebase/firestore";

// ▼▼▼  PASTE YOUR VALUES HERE  ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyCxLQD56XoYVoVbhuCQgow6PCdXiGWbFS4",
  authDomain: "poniyin-selvan-game.firebaseapp.com",
  projectId: "poniyin-selvan-game",
  storageBucket: "poniyin-selvan-game.firebasestorage.app",
  messagingSenderId: "614724032948",
  appId: "1:614724032948:web:d0a082869afb06c3d93ae1",
  measurementId: "G-CZ1HY45EXM"
};
// ▲▲▲  PASTE YOUR VALUES HERE  ▲▲▲

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Load a game state from Firestore
export async function storeLoad(key) {
  try {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "games", key));
    return snap.exists() ? snap.data().state : null;
  } catch (e) {
    console.error("storeLoad:", e);
    return null;
  }
}

// Save a game state to Firestore
export async function storeSave(key, value) {
  try {
    await setDoc(doc(db, "games", key), {
      state:     value,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.error("storeSave:", e);
  }
}

// Real-time listener — calls callback whenever the game state changes
export function storeSubscribe(key, callback) {
  return onSnapshot(doc(db, "games", key), (snap) => {
    if (snap.exists()) callback(snap.data().state);
  });
}
