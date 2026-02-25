# ⚜ Ponniyin Selvan — The Card Game

Strategic bluffing card game set in the Chola Dynasty. Single player vs AI + real-time multiplayer.

---

## 🚀 Deploy in 15 Minutes (100% Free)

### STEP 1 — Add your Firebase credentials

1. Go to https://console.firebase.google.com
2. Click **Add project** → give it any name → Continue → Disable Analytics → **Create project**
3. On the overview page click the **</>** (Web) icon → name the app → **Register app**
4. Copy the `firebaseConfig` block shown on screen
5. Open **`src/firebase.js`** in this project and paste your values replacing the `PASTE_YOUR_...` placeholders
6. Back in Firebase console → left sidebar → **Build → Firestore Database**
   → **Create database** → **Start in test mode** → choose nearest region → **Done**

---

### STEP 2 — Push to GitHub

1. Go to https://github.com → create a free account if needed
2. Click **New repository** → name it `ponniyin-selvan-game` → Public → **Create**
3. Upload all the files from this zip into the repo (drag & drop in the GitHub interface)
4. Click **Commit changes**

---

### STEP 3 — Deploy on Vercel (free hosting)

1. Go to https://vercel.com → **Sign up with GitHub**
2. Click **Add New Project** → import your `ponniyin-selvan-game` repo
3. Framework preset will auto-detect as **Vite** → click **Deploy**
4. ✅ Done! You'll get a live URL like `ponniyin-selvan-game.vercel.app`
5. Share that URL — anyone in the world can play instantly in their browser

---

## 💰 Cost: ₹0 forever

| Service | Free Tier |
|---------|-----------|
| Vercel  | Unlimited deploys, 100 GB bandwidth/month |
| Firebase Firestore | 50,000 reads/day · 20,000 writes/day · 1 GB storage |
| GitHub  | Unlimited public repos |

---

## 📁 Project Structure

```
ponniyin-selvan-game/
├── index.html
├── vite.config.js
├── package.json
├── .gitignore
└── src/
    ├── main.jsx          ← React entry point (don't edit)
    ├── firebase.js       ← ⚠️  EDIT THIS — paste your Firebase config here
    └── App.jsx           ← Full game logic + UI
```

---

## 🎮 How Multiplayer Works

1. Host clicks **Create Room** → shares the room code with friends
2. Friends click **Join Room** → enter the code
3. Host starts the game
4. All players see real-time updates instantly via Firebase (no refresh needed)

---

## 🔧 Run Locally (optional)

Requires Node.js (https://nodejs.org)

```bash
npm install
npm run dev
# Opens at http://localhost:5173
```
