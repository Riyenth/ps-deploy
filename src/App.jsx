import { useState, useEffect, useRef } from "react";
import { storeLoad, storeSave, storeSubscribe } from "./firebase.js";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CHARS = {
  pazhuvettarayar: { name:"Periya Pazhuvettarayar", short:"Pazhuvettarayar", role:"Treasurer", emoji:"👑", color:"#B85000", count:3, actionType:"tax", action:"Tax — collect 3 coins from Treasury", counter:"Block Gift — stop any player claiming Treasury's 2-coin Gift" },
  nandini:         { name:"Nandini", short:"Nandini", role:"Pazhuvur Queen", emoji:"🌹", color:"#9B30C0", count:3, actionType:"steal", action:"Steal — take 2 coins from any player", counter:"Block Stealing — protect any player from theft" },
  kundavai:        { name:"Kundavai", short:"Kundavai", role:"Princess", emoji:"🏛️", color:"#1976D2", count:2, actionType:"kundavai_coins", action:"Royal Tithe — take 2 coins from Treasury", counter:"Block Stealing — protect any player from theft" },
  arulmozhivarman: { name:"Arulmozhivarman", short:"Arulmozhi", role:"Prince", emoji:"⚔️", color:"#2E7D32", count:3, actionType:"exchange", action:"Exchange — draw 2 cards, keep any 2, return rest to Deck", counter:"Block Traitor Swap" },
  vanthiyathevan:  { name:"Vanthiyathevan", short:"Vanthiyathevan", role:"Messenger", emoji:"🗺️", color:"#C75000", count:2, actionType:"guess", action:"Gamble — guess a player's card; correct: steal all their coins; wrong: lose all yours", counter:"Block Spy" },
  kandamaran:      { name:"Kandamaran", short:"Kandamaran", role:"Traitor", emoji:"🗡️", color:"#7B4020", count:1, actionType:"traitor_swap", action:"Traitor Swap — exchange one of your cards with a player who has 2 cards", counter:null },
  ravidasan:       { name:"Ravidasan", short:"Ravidasan", role:"Assassin", emoji:"💀", color:"#C62828", count:3, actionType:"assassinate", action:"Assassinate — pay 4 coins to force a player to lose one card", counter:null },
  aazhwarkadiyan:  { name:"Aazhwarkadiyan", short:"Aazhwarkadiyan", role:"Spy", emoji:"🔍", color:"#00838F", count:1, actionType:"spy", action:"Spy — secretly view & force-swap a player's card with the Deck", counter:"Block Assassination" },
  poonkuzhali:     { name:"Poonkuzhali", short:"Poonkuzhali", role:"Saviour", emoji:"⛵", color:"#00796B", count:2, actionType:null, action:null, counter:"Block Assassination" },
};
const CHAR_KEYS = Object.keys(CHARS);
const AI_NAMES = ["Vikram","Aishwarya","Ravi","Meera","Karthik","Priya"];
const NEEDS_TARGET = new Set(["steal","assassinate","spy","traitor_swap","guess"]);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const buildDeck  = () => CHAR_KEYS.flatMap(k => Array(CHARS[k].count).fill(k));
const shuffle    = a  => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };
const genId      = () => Math.random().toString(36).slice(2,9);
const deepCopy   = x  => JSON.parse(JSON.stringify(x));
const alivePls   = gs => gs.players.filter(p=>p.alive!==false);
const activePl   = gs => { const a=alivePls(gs); return a.length?a[gs.turn%a.length]:null; };
const makePlayer = (id,name,deck,isBot=false) => ({id,name,coins:2,cards:[deck.pop(),deck.pop()],lost:[],alive:true,isBot});

// Storage helpers imported from firebase.js

// ─────────────────────────────────────────────────────────────────────────────
// GAME ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function drawCard(gs){ return gs.deck.length?gs.deck.pop():null; }

function playerLoseCard(gs,pid,specific=null){
  const p=gs.players.find(q=>q.id===pid);
  if(!p||!p.cards.length) return null;
  let lost;
  if(specific&&p.cards.includes(specific)){ p.cards.splice(p.cards.indexOf(specific),1); lost=specific; }
  else { lost=p.cards.pop(); }
  p.lost=[...(p.lost||[]),lost];
  if(!p.cards.length) p.alive=false;
  return lost;
}

function advanceTurn(gs){
  gs.pendingAction=null; gs.pendingResponse=[]; gs.responses={};
  gs.spyReveal=null; gs.challengeReveal=null; gs.loseCardPrompt=null;
  const alive=alivePls(gs);
  gs.turn=(gs.turn+1)%alive.length;
}

function checkWinner(gs){ const a=alivePls(gs); if(a.length===1){gs.phase="ended";gs.winner=a[0].id;} }

function resolveAction(gs){
  const pa=gs.pendingAction;
  const actor=gs.players.find(p=>p.id===pa.actorId);
  const target=pa.targetId?gs.players.find(p=>p.id===pa.targetId):null;

  if(pa.type==="gift"){ actor.coins+=2; gs.lastEvent=`${actor.name} received 2 coins.`; }
  else if(pa.type==="tax"){ actor.coins+=3; gs.lastEvent=`${actor.name} collected 3 coins as Tax.`; }
  else if(pa.type==="kundavai_coins"){ actor.coins+=2; gs.lastEvent=`${actor.name} took 2 coins.`; }
  else if(pa.type==="steal"){ const s=Math.min(2,target.coins); target.coins-=s; actor.coins+=s; gs.lastEvent=`${actor.name} stole ${s} coin(s) from ${target.name}.`; }
  else if(pa.type==="assassinate"){ playerLoseCard(gs,pa.targetId); gs.lastEvent=`${actor.name}'s assassination succeeded — ${target?.name} loses a card!`; }
  else if(pa.type==="exchange"){
    const drawn=[drawCard(gs),drawCard(gs)].filter(Boolean);
    const pool=[...actor.cards,...drawn]; actor.cards=pool.slice(0,2);
    gs.deck.push(...pool.slice(2)); gs.deck=shuffle(gs.deck);
    gs.lastEvent=`${actor.name} exchanged cards with the Deck.`;
  }
  else if(pa.type==="spy"){
    if(target&&target.cards.length){
      const old=target.cards[0]; const nc=drawCard(gs);
      if(nc){target.cards[0]=nc; gs.deck.push(old); gs.deck=shuffle(gs.deck);}
      gs.lastEvent=`${actor.name} spied on ${target.name}.`;
      if(!actor.isBot) gs.spyReveal={viewerId:actor.id,targetId:target.id,card:old};
    }
  }
  else if(pa.type==="traitor_swap"){
    if(target&&target.cards.length>=2&&actor.cards.length){
      const mc=actor.cards[0]; actor.cards[0]=target.cards[0]; target.cards[0]=mc;
      gs.lastEvent=`${actor.name} swapped a card with ${target.name}.`;
    }
  }
  else if(pa.type==="guess"){
    if(target&&target.cards.includes(pa.guessedCard)){
      const c=target.coins; actor.coins+=c; target.coins=0;
      target.cards.splice(target.cards.indexOf(pa.guessedCard),1);
      const nc=drawCard(gs); if(nc)target.cards.push(nc);
      gs.deck.push(pa.guessedCard); gs.deck=shuffle(gs.deck);
      gs.lastEvent=`✅ ${actor.name} guessed correctly! Took ${c} coins from ${target.name}.`;
    } else {
      const c=actor.coins; if(target)target.coins+=c; actor.coins=0;
      gs.lastEvent=`❌ ${actor.name} guessed wrong! Lost all coins.`;
    }
  }
  else if(pa.type==="coup"){ playerLoseCard(gs,pa.targetId); gs.lastEvent=`${actor.name} spent 10 coins — ${target?.name} loses a card!`; }

  advanceTurn(gs); checkWinner(gs);
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY FIX: resolveResponses sets challengeReveal WITHOUT applying card loss yet.
// Card loss happens when player dismisses the modal (or immediately for bots).
// ─────────────────────────────────────────────────────────────────────────────
function resolveResponses(gs){
  const s=deepCopy(gs);
  const pa=s.pendingAction;
  if(!pa||s.pendingResponse.length>0) return s;

  const chalEntry = Object.entries(s.responses).find(([,v])=>v==="challenge");
  const blkEntry  = Object.entries(s.responses).find(([,v])=>typeof v==="string"&&v.startsWith("block:"));
  const actor     = s.players.find(p=>p.id===pa.actorId);
  const challenger= chalEntry?s.players.find(p=>p.id===chalEntry[0]):null;
  const blocker   = blkEntry ?s.players.find(p=>p.id===blkEntry[0]):null;

  if(challenger){
    const hasCard = pa.claimedCard && actor.cards.includes(pa.claimedCard);
    if(hasCard){
      // Challenger WRONG — they lose a card, action proceeds
      // Store reveal info; actual card loss + action resolve happens on dismiss
      s.challengeReveal = {
        outcome:"wrong",               // challenger called bluff but was wrong
        challengerId: chalEntry[0],
        challengerName: challenger.name,
        actorId: pa.actorId,
        actorName: actor.name,
        claimedCard: pa.claimedCard,
        loserId: chalEntry[0],         // challenger loses
        loserName: challenger.name,
        afterResolve: true,            // action should resolve after card loss
      };
    } else {
      // Challenger CORRECT — actor was bluffing, actor loses a card
      if(pa.type==="assassinate") actor.coins+=4;
      s.challengeReveal = {
        outcome:"correct",             // challenger called bluff and was right
        challengerId: chalEntry[0],
        challengerName: challenger.name,
        actorId: pa.actorId,
        actorName: actor.name,
        claimedCard: pa.claimedCard,
        loserId: pa.actorId,           // actor (bluffer) loses
        loserName: actor.name,
        afterResolve: false,           // no action resolve, just advance turn
      };
    }
  } else if(blkEntry){
    const blockCard=blkEntry.split(":")[1];
    s.lastEvent=`${blocker?.name} blocked with ${CHARS[blockCard]?.short||blockCard}! Action cancelled.`;
    if(pa.type==="assassinate") actor.coins+=4;
    advanceTurn(s); checkWinner(s);
  } else {
    resolveAction(s);
  }
  return s;
}

// Called after the modal is dismissed — actually applies the card loss
function applyChallengeLoss(gs, chosenCard=null){
  const s=deepCopy(gs);
  const cr=s.challengeReveal;
  if(!cr) return s;

  const loser=s.players.find(p=>p.id===cr.loserId);
  if(cr.outcome==="wrong"){
    // Challenger loses card, then the original action resolves
    playerLoseCard(s, cr.loserId, chosenCard||null);
    checkWinner(s);
    if(s.phase!=="ended"){
      // Actor reshuffles revealed card and draws fresh
      const actor=s.players.find(p=>p.id===cr.actorId);
      const ci=actor.cards.indexOf(cr.claimedCard);
      if(ci>=0){actor.cards.splice(ci,1);s.deck.push(cr.claimedCard);s.deck=shuffle(s.deck);const nc=drawCard(s);if(nc)actor.cards.push(nc);}
      s.challengeReveal=null;
      resolveAction(s);
    }
  } else {
    // Bluffer (actor) loses card, turn advances
    playerLoseCard(s, cr.loserId, chosenCard||null);
    checkWinner(s);
    s.challengeReveal=null;
    if(s.phase!=="ended") advanceTurn(s);
  }
  return s;
}

function applyAction(gs,actorId,action){
  const s=deepCopy(gs);
  const actor=s.players.find(p=>p.id===actorId);
  if(!actor||!actor.alive) return s;

  if(action.type==="income"){ actor.coins+=1; s.lastEvent=`${actor.name} took 1 coin.`; advanceTurn(s); checkWinner(s); return s; }
  if(action.type==="draw_card"){ if(actor.coins<8)return s; actor.coins-=8; const nc=drawCard(s); if(nc)actor.cards.push(nc); s.lastEvent=`${actor.name} drew a new card.`; advanceTurn(s); checkWinner(s); return s; }
  if(action.type==="coup"){ actor.coins-=10; s.pendingAction={type:"coup",actorId,targetId:action.targetId}; s.pendingResponse=[]; s.responses={}; resolveAction(s); return s; }

  s.pendingAction={type:action.type,actorId,targetId:action.targetId||null,claimedCard:action.claimedCard||null,guessedCard:action.guessedCard||null};
  s.pendingResponse=alivePls(s).filter(p=>p.id!==actorId).map(p=>p.id);
  s.responses={};
  const target=action.targetId?s.players.find(p=>p.id===action.targetId):null;
  const msgs={
    gift:`${actor.name} claims Gift — 2 coins from Treasury`,
    tax:`${actor.name} claims Pazhuvettarayar — Tax (3 coins)`,
    kundavai_coins:`${actor.name} claims Kundavai — Royal Tithe (2 coins)`,
    steal:`${actor.name} claims Nandini — stealing from ${target?.name}`,
    assassinate:`${actor.name} claims Ravidasan — targeting ${target?.name}`,
    exchange:`${actor.name} claims Arulmozhivarman — exchanging cards`,
    spy:`${actor.name} claims Aazhwarkadiyan — spying on ${target?.name}`,
    traitor_swap:`${actor.name} claims Kandamaran — swapping with ${target?.name}`,
    guess:`${actor.name} claims Vanthiyathevan — guessing ${CHARS[action.guessedCard]?.short||"?"} on ${target?.name}`,
  };
  s.lastEvent=msgs[action.type]||`${actor.name} acts.`;
  if(action.type==="assassinate") actor.coins-=4;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI — REALISTIC DIFFICULTY
// Plays cards it actually holds. Only bluffs rarely and strategically.
// Challenges based on hard evidence (discard counts), not random guesses.
// ─────────────────────────────────────────────────────────────────────────────

// Total copies of a card lost across all players
function totalLost(gs, cardKey) {
  return gs.players.reduce((a,p) => a + (p.lost||[]).filter(c=>c===cardKey).length, 0);
}

// Track what each player has claimed — stored in gs.aiMemory
function updateAiMemory(gs, actorId, claimedCard) {
  if (!claimedCard) return gs;
  if (!gs.aiMemory) gs.aiMemory = {};
  if (!gs.aiMemory[actorId]) gs.aiMemory[actorId] = { claims: {} };
  gs.aiMemory[actorId].claims[claimedCard] = (gs.aiMemory[actorId].claims[claimedCard] || 0) + 1;
  return gs;
}

function aiResp(gs, ai, pa) {
  const mem = gs.aiMemory || {};
  const actorMem = mem[pa.actorId] || { claims: {} };

  // ── BLOCK with cards the AI actually holds ────────────────────────────────
  if (pa.type === "assassinate" && pa.targetId === ai.id) {
    if (ai.cards.includes("poonkuzhali")) return "block:poonkuzhali";
    if (ai.cards.includes("aazhwarkadiyan")) return "block:aazhwarkadiyan";
    // Very rarely bluff-block when desperate (1 card left)
    if (ai.cards.length === 1 && Math.random() < 0.30) return "block:poonkuzhali";
  }
  if (pa.type === "steal" && pa.targetId === ai.id) {
    if (ai.cards.includes("nandini")) return "block:nandini";
    if (ai.cards.includes("kundavai")) return "block:kundavai";
    // Rarely bluff-block steal if we have lots of coins worth protecting
    if (ai.coins >= 5 && Math.random() < 0.20) return "block:nandini";
  }
  if (pa.type === "gift") {
    if (ai.cards.includes("pazhuvettarayar") && Math.random() < 0.50) return "block:pazhuvettarayar";
  }

  // ── CHALLENGE only with strong evidence ──────────────────────────────────
  if (pa.claimedCard) {
    const cardTotal = CHARS[pa.claimedCard]?.count || 1;
    const lost = totalLost(gs, pa.claimedCard);
    const aiOwns = ai.cards.filter(c => c === pa.claimedCard).length;
    // Copies unaccounted for (not in discard, not in our hand)
    const unaccounted = cardTotal - lost - aiOwns;

    // CERTAIN bluff: all copies are gone from play
    if (unaccounted <= 0) return "challenge";

    // STRONG evidence: we hold all remaining copies ourselves
    if (aiOwns >= unaccounted) return "challenge";

    // SUSPICIOUS: actor has claimed this card many times before
    const claimCount = actorMem.claims[pa.claimedCard] || 0;
    if (claimCount >= 3 && Math.random() < 0.65) return "challenge";
    if (claimCount >= 2 && Math.random() < 0.30) return "challenge";

    // Dangerous action targeting us specifically — willing to risk a challenge
    if (pa.type === "assassinate" && pa.targetId === ai.id && Math.random() < 0.18) return "challenge";
  }

  return "pass";
}

function aiPickAction(gs, ai) {
  const others  = alivePls(gs).filter(p => p.id !== ai.id);
  const alive   = alivePls(gs);
  if (!others.length) return { type: "income" };

  // Target selection: weakest opponent (fewest cards, then fewest coins)
  const weakest     = others.reduce((b,p) => p.cards.length < b.cards.length || (p.cards.length===b.cards.length && p.coins<b.coins) ? p : b, others[0]);
  const richest     = others.reduce((b,p) => p.coins > b.coins ? p : b, others[0]);
  const midGame     = alive.length <= 3;

  // ── Mandatory coup ────────────────────────────────────────────────────────
  if (ai.coins >= 10) return { type: "coup", targetId: weakest.id };

  // ── Draw card when on last card and rich ─────────────────────────────────
  if (ai.cards.length === 1 && ai.coins >= 8) return { type: "draw_card" };

  // ── Build action list from cards AI ACTUALLY HOLDS ───────────────────────
  // Real actions: only what our cards can do
  const realActions = [];

  for (const card of ai.cards) {
    const ch = CHARS[card];
    if (!ch?.actionType) continue;

    if (ch.actionType === "tax") {
      realActions.push({ type:"tax", claimedCard:card, value:3 });
    }
    if (ch.actionType === "steal" && richest?.coins > 0) {
      realActions.push({ type:"steal", targetId:richest.id, claimedCard:card, value:Math.min(2,richest.coins) });
    }
    if (ch.actionType === "kundavai_coins") {
      realActions.push({ type:"kundavai_coins", claimedCard:card, value:2 });
    }
    if (ch.actionType === "assassinate" && ai.coins >= 4) {
      realActions.push({ type:"assassinate", targetId:weakest.id, claimedCard:card, value: midGame?10:6 });
    }
    if (ch.actionType === "exchange") {
      realActions.push({ type:"exchange", claimedCard:card, value:2 });
    }
    if (ch.actionType === "spy" && others.length > 0) {
      realActions.push({ type:"spy", targetId:richest.id, claimedCard:card, value:2 });
    }
    if (ch.actionType === "guess" && others.length > 0) {
      // Only guess if we have a read on someone's card from memory
      realActions.push({ type:"guess", targetId:richest.id,
        guessedCard: ai.cards[0], // guess what we ourselves have as a test
        claimedCard:card, value:richest.coins > 3 ? 4 : 1 });
    }
    if (ch.actionType === "traitor_swap") {
      const swapTarget = others.find(p => p.cards.length >= 2);
      if (swapTarget) realActions.push({ type:"traitor_swap", targetId:swapTarget.id, claimedCard:card, value:1 });
    }
  }

  // Pick best real action by value
  if (realActions.length > 0) {
    // Sort by value descending, pick from top with some randomness
    realActions.sort((a,b) => b.value - a.value);
    // Pick from top 2 to avoid being too predictable
    const pick = realActions[Math.floor(Math.random() * Math.min(2, realActions.length))];
    const { value:_, ...action } = pick; // strip the value field
    return action;
  }

  // ── Safe fallback actions (no character needed) ───────────────────────────
  // Gift is always available (can be blocked, not challenged)
  if (ai.coins < 6) return { type:"gift", claimedCard:null };
  return { type:"income" };
}
function processAiBots(gs){
  if(!gs.pendingAction||!gs.pendingResponse.length) return gs;
  let s=deepCopy(gs);
  if(s.pendingAction?.claimedCard) s=updateAiMemory(s, s.pendingAction.actorId, s.pendingAction.claimedCard);
  s.pendingResponse.filter(id=>s.players.find(p=>p.id===id)?.isBot).forEach(id=>{
    const ai=s.players.find(p=>p.id===id);
    if(ai){s.responses[id]=aiResp(s,ai,s.pendingAction);}
    s.pendingResponse=s.pendingResponse.filter(x=>x!==id);
  });
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS — comfortable warm-dark theme, max readability
// ─────────────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,500;0,600;1,400&family=Cinzel:wght@500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  /* Gold palette — warm, readable */
  --gold:#F0C060;--gold-l:#FFD98A;--gold-d:#B8880A;
  /* Backgrounds — noticeably lighter than before, easier on eyes */
  --bg:#1E1A12;--bg2:#2C2618;--bg3:#362E1C;--bg4:#403620;
  /* Borders */
  --border:#5C4E28;--border-l:#7A6838;
  /* Text — high contrast */
  --text:#F4EDD6;--text-2:#D8C896;--text-3:#B0986A;
  /* Semantic colours */
  --green:#388E3C;--green-l:#81C784;--green-text:#B8E0B8;
  --red:#C62828;--red-l:#EF9A9A;
  --blue-text:#90C8F0;
}
html,body{background:var(--bg);min-height:100vh;}
body{font-family:'Crimson Pro',serif;font-size:18px;color:var(--text);line-height:1.65;}
#root{max-width:1100px;margin:0 auto;padding:12px 12px 60px;}

/* ─── HEADER ─── */
.hdr{text-align:center;padding:28px 0 18px;}
.hdr::after{content:'';display:block;height:1px;background:linear-gradient(90deg,transparent,var(--gold-d) 30%,var(--gold) 50%,var(--gold-d) 70%,transparent);margin-top:14px;}
.hdr-title{font-family:'Cinzel',serif;font-size:clamp(26px,5.5vw,48px);font-weight:700;color:var(--gold);letter-spacing:.06em;text-shadow:0 2px 24px rgba(240,192,96,.35);}
.hdr-sub{font-family:'Cinzel',serif;font-size:15px;font-weight:500;color:var(--text-3);letter-spacing:.22em;text-transform:uppercase;margin-top:8px;}

/* ─── PANEL ─── */
.panel{background:var(--bg2);border:1.5px solid var(--border);border-radius:12px;padding:28px;box-shadow:0 6px 28px rgba(0,0,0,.45);}
.ptitle{font-family:'Cinzel',serif;font-size:17px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:22px;}

/* ─── INPUTS ─── */
.inp{width:100%;padding:14px 18px;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-family:'Crimson Pro',serif;font-size:19px;outline:none;transition:border-color .2s,box-shadow .2s;}
.inp:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(240,192,96,.18);}
.inp::placeholder{color:var(--text-3);}
.lbl{display:block;font-family:'Cinzel',serif;font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2);margin-bottom:9px;}

/* ─── BUTTONS ─── */
.btn{font-family:'Cinzel',serif;font-size:15px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border:none;cursor:pointer;padding:14px 26px;border-radius:8px;transition:all .18s;display:inline-flex;align-items:center;justify-content:center;gap:8px;}
.btn-g{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#1A1000;box-shadow:0 3px 14px rgba(240,192,96,.38);}
.btn-g:hover:not(:disabled){background:linear-gradient(135deg,var(--gold),var(--gold-l));transform:translateY(-2px);box-shadow:0 6px 22px rgba(240,192,96,.52);}
.btn-r{background:linear-gradient(135deg,#7A1010,var(--red));color:#FFE0E0;box-shadow:0 3px 12px rgba(198,40,40,.32);}
.btn-r:hover:not(:disabled){background:linear-gradient(135deg,var(--red),#E53935);transform:translateY(-2px);}
.btn-gh{background:transparent;border:2px solid var(--border-l);color:var(--gold);font-size:14px;}
.btn-gh:hover:not(:disabled){background:rgba(240,192,96,.1);border-color:var(--gold);}
.btn-dk{background:var(--bg3);border:1.5px solid var(--border);color:var(--text-2);font-size:14px;}
.btn-dk:hover:not(:disabled){border-color:var(--border-l);color:var(--text);}
.btn:disabled{opacity:.35;cursor:not-allowed;transform:none!important;}
.btn-sm{padding:10px 18px;font-size:13px;}
.btn-full{width:100%;}
.div{height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);margin:20px 0;}

/* ─── MODE SELECT ─── */
.mode-cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0;}
.mode-card{background:var(--bg3);border:2px solid var(--border);border-radius:12px;padding:32px 20px;cursor:pointer;text-align:center;transition:all .2s;}
.mode-card:hover,.mode-card.active{border-color:var(--gold);box-shadow:0 0 26px rgba(240,192,96,.22);transform:translateY(-3px);}
.mode-icon{font-size:44px;margin-bottom:14px;}
.mode-name{font-family:'Cinzel',serif;font-size:19px;font-weight:700;color:var(--gold);margin-bottom:8px;}
.mode-desc{font-size:16px;color:var(--text-2);line-height:1.55;}

/* ─── BOARD ─── */
.board{display:flex;flex-direction:column;gap:14px;}

/* ─── OPPONENTS ─── */
.opp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;}
.opp{background:var(--bg3);border:2px solid var(--border);border-radius:10px;padding:14px 16px;position:relative;transition:all .2s;}
.opp.active-turn{border-color:var(--gold);box-shadow:0 0 18px rgba(240,192,96,.28);}
.opp.eliminated{opacity:.3;filter:grayscale(.85);}
.opp.bot::after{content:'AI';position:absolute;top:8px;right:10px;font-family:'Cinzel',serif;font-size:11px;font-weight:600;color:var(--text-3);}
.opp-name{font-family:'Cinzel',serif;font-size:15px;font-weight:700;color:var(--gold);margin-bottom:7px;display:flex;align-items:center;gap:7px;overflow:hidden;}
.opp-name-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.opp-coins{font-size:16px;color:var(--text);font-weight:600;margin-bottom:10px;}
.opp-cards{display:flex;gap:6px;flex-wrap:wrap;}
.small-card{width:42px;height:58px;border-radius:7px;border:2px solid var(--border);background:var(--bg2);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:19px;color:var(--text-3);flex-shrink:0;}
.small-card.gone{opacity:.22;filter:grayscale(1);}
.small-card-lbl{font-size:7px;line-height:1.2;margin-top:2px;text-align:center;max-width:40px;font-family:'Cinzel',serif;color:var(--text-2);}
.tag{font-family:'Cinzel',serif;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;flex-shrink:0;}
.tag-turn{background:rgba(240,192,96,.24);color:var(--gold);animation:pulse 1.4s infinite;}
.tag-out{background:rgba(220,80,80,.22);color:#FF9898;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}

/* ─── MY HAND ─── */
.my-hand{background:var(--bg2);border:2px solid var(--green);border-radius:12px;overflow:hidden;}
.my-hand-header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;background:rgba(56,142,60,.16);border-bottom:2px solid rgba(129,199,132,.2);}
.my-hand-title{font-family:'Cinzel',serif;font-size:16px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green-text);}
.my-hand-meta{font-size:17px;font-weight:600;color:var(--gold);}
.hand-cards-row{display:flex;}
.hand-card{flex:1;min-width:0;display:flex;flex-direction:column;border-right:1.5px solid var(--border);}
.hand-card:last-child{border-right:none;}
.hand-card.dead{opacity:.28;filter:grayscale(1);}
.hc-header{padding:20px 18px 14px;display:flex;align-items:flex-start;gap:14px;}
.hc-emoji{font-size:40px;flex-shrink:0;line-height:1;}
.hc-meta{flex:1;min-width:0;}
.hc-name{font-family:'Cinzel',serif;font-size:17px;font-weight:700;line-height:1.3;margin-bottom:5px;}
.hc-role{font-size:15px;color:var(--text-2);font-style:italic;}
.hc-count{font-size:14px;color:var(--text-3);margin-top:5px;}
.hc-abilities{padding:4px 18px 18px;flex:1;}
.hc-ability-block{margin-bottom:14px;}
.hc-ability-label{font-family:'Cinzel',serif;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:7px;}
.hc-ability-text{font-size:16px;line-height:1.6;color:var(--text);}
.hc-no-ability{font-size:15px;color:var(--text-3);font-style:italic;padding:4px 0;}
.hc-action-btn{width:100%;padding:14px 18px;font-family:'Cinzel',serif;font-size:14px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border:none;cursor:pointer;transition:all .18s;display:flex;align-items:center;justify-content:center;gap:8px;border-top:1.5px solid rgba(129,199,132,.18);}
.hc-action-btn:hover:not(:disabled){filter:brightness(1.18);}
.hc-action-btn:disabled{opacity:.3;cursor:not-allowed;}

/* ─── STATUS + TICKER ─── */
.status-bar{display:flex;align-items:center;justify-content:space-between;background:var(--bg3);border:1.5px solid var(--border);border-radius:9px;padding:12px 22px;}
.status-l{font-size:15px;color:var(--text-3);}
.status-c{font-family:'Cinzel',serif;font-size:17px;font-weight:700;color:var(--gold);}
.status-r{font-size:15px;color:var(--text-2);}
.ticker{background:var(--bg3);border:2px solid var(--border-l);border-radius:9px;padding:16px 24px;text-align:center;font-size:17px;font-style:italic;color:var(--text-2);min-height:54px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;}
.ticker::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--gold-d),var(--gold),var(--gold-d));}

/* ─── PENDING ACTION ─── */
.pb{background:#221212;border:2px solid #6E2424;border-radius:12px;padding:20px 24px;}
.pb-title{font-family:'Cinzel',serif;font-size:17px;font-weight:700;color:#FFB8B8;letter-spacing:.06em;margin-bottom:11px;}
.pb-claim{font-size:17px;color:var(--text);margin-bottom:18px;padding:14px 18px;background:rgba(0,0,0,.28);border-radius:8px;border-left:4px solid var(--gold);line-height:1.65;}
.pb-q{font-family:'Cinzel',serif;font-size:14px;font-weight:600;letter-spacing:.1em;color:var(--text-2);margin-bottom:13px;text-align:center;text-transform:uppercase;}
.resp-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}

/* ─── ACTION AREA ─── */
.aa{background:var(--bg2);border:1.5px solid var(--border);border-radius:12px;padding:24px;}
.tabs{display:flex;gap:8px;margin-bottom:20px;}
.tab{flex:1;padding:12px 8px;text-align:center;font-family:'Cinzel',serif;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border:2px solid var(--border);border-radius:8px;color:var(--text-2);transition:all .18s;line-height:1.3;}
.tab.on{border-color:var(--gold);color:var(--gold);background:rgba(240,192,96,.1);}
.tab:hover{border-color:var(--border-l);color:var(--text);}
.sec-lbl{font-family:'Cinzel',serif;font-size:13px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin:18px 0 13px;display:flex;align-items:center;gap:12px;}
.sec-lbl::before,.sec-lbl::after{content:'';flex:1;height:1px;background:var(--border);}

/* ─── ACTION BUTTONS ─── */
.ag{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;}
.ab{background:var(--bg3);border:2px solid var(--border);border-radius:10px;padding:18px;cursor:pointer;text-align:left;transition:all .18s;display:flex;flex-direction:column;gap:7px;}
.ab:hover:not(:disabled){border-color:var(--gold);background:var(--bg4);transform:translateY(-2px);box-shadow:0 5px 20px rgba(240,192,96,.2);}
.ab:disabled{opacity:.3;cursor:not-allowed;transform:none!important;}
.ab.real-action{border-color:rgba(129,199,132,.55);background:#0D1E0F;}
.ab.real-action:hover:not(:disabled){border-color:var(--green-l);background:#102814;}
.ab.bluff-action{border-color:rgba(220,100,100,.65);background:rgba(80,10,10,.25);}
.ab.safe-action{border-color:var(--border-l);}
.ab.danger-action{border-color:rgba(230,150,0,.58);background:#1A1200;}
.ab-head{display:flex;align-items:center;gap:11px;}
.ab-icon{font-size:26px;flex-shrink:0;}
.ab-name{font-family:'Cinzel',serif;font-size:16px;font-weight:700;color:var(--gold);}
.ab-desc{font-size:16px;color:var(--text-2);line-height:1.55;}
.ab-cost{font-size:15px;color:var(--text-3);font-style:italic;}
.badge{display:inline-block;font-size:13px;font-weight:600;padding:5px 12px;border-radius:20px;margin-top:4px;align-self:flex-start;line-height:1.3;}
.b-green{background:rgba(129,199,132,.2);color:#B8E8B8;border:1px solid rgba(129,199,132,.38);}
.b-blue{background:rgba(100,185,245,.18);color:#A8D8F8;border:1px solid rgba(100,185,245,.32);}
.b-red{background:rgba(200,30,30,.28);color:#FFD0D0;border:1.5px solid rgba(220,80,80,.6);font-weight:700;letter-spacing:.04em;}
.b-orange{background:rgba(230,150,0,.2);color:#FFD080;border:1px solid rgba(230,150,0,.35);}
.b-real{background:rgba(129,199,132,.18);color:#B0E0B0;border:1px solid rgba(129,199,132,.48);font-size:12px;}

/* ─── TARGET GRID ─── */
.tsec{margin-top:16px;}
.tsec-title{font-family:'Cinzel',serif;font-size:17px;font-weight:700;color:var(--gold);text-align:center;margin-bottom:16px;}
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(164px,1fr));gap:10px;}
.tb{background:var(--bg3);border:2px solid var(--border);border-radius:10px;padding:16px 18px;cursor:pointer;transition:all .18s;text-align:left;}
.tb:hover{border-color:var(--gold);background:var(--bg4);box-shadow:0 4px 18px rgba(240,192,96,.2);}
.tb-name{font-family:'Cinzel',serif;font-size:16px;font-weight:700;color:var(--gold);margin-bottom:5px;}
.tb-info{font-size:15px;color:var(--text-2);}

/* ─── CHALLENGE REVEAL OVERLAY ─── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:400;padding:16px;animation:fadeIn .22s ease;}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
.cr-box{background:var(--bg2);border-radius:14px;padding:36px 32px;max-width:520px;width:100%;text-align:center;animation:slideUp .28s cubic-bezier(.16,1,.3,1);max-height:92vh;overflow-y:auto;}
@keyframes slideUp{from{transform:translateY(20px);opacity:0;}to{transform:translateY(0);opacity:1;}}
.cr-box.win{border:2px solid var(--green-l);box-shadow:0 24px 70px rgba(0,0,0,.85),0 0 50px rgba(129,199,132,.24);}
.cr-box.lose{border:2px solid #EF5350;box-shadow:0 24px 70px rgba(0,0,0,.85),0 0 50px rgba(239,83,80,.24);}
.cr-box.neutral{border:2px solid var(--border-l);box-shadow:0 24px 70px rgba(0,0,0,.85);}
.cr-big-icon{font-size:68px;margin-bottom:14px;animation:popIn .3s cubic-bezier(.16,1,.3,1) .06s both;}
@keyframes popIn{from{transform:scale(.3);opacity:0;}to{transform:scale(1);opacity:1;}}
.cr-headline{font-family:'Cinzel',serif;font-size:clamp(22px,4.2vw,30px);font-weight:700;margin-bottom:14px;line-height:1.2;animation:fadeUp .3s ease .14s both;}
@keyframes fadeUp{from{transform:translateY(6px);opacity:0;}to{transform:translateY(0);opacity:1;}}
.cr-headline.win{color:#90EE90;}
.cr-headline.lose{color:#FF8A80;}
.cr-headline.neutral{color:var(--gold);}
.cr-split{display:grid;grid-template-columns:1fr auto 1fr;margin:18px 0;border-radius:10px;overflow:hidden;border:1.5px solid var(--border);animation:fadeUp .3s ease .22s both;}
.cr-half{padding:20px 16px;text-align:center;}
.cr-half.left{background:#2A2010;}
.cr-half.right-bad{background:#201010;}
.cr-half.right-good{background:#102018;}
.cr-split-divider{width:1px;background:var(--border);}
.cr-half-label{font-family:'Cinzel',serif;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px;}
.cr-card-emoji{font-size:50px;margin-bottom:8px;}
.cr-card-name{font-family:'Cinzel',serif;font-size:15px;font-weight:700;color:var(--gold);}
.cr-verdict{font-size:16px;margin-top:8px;font-weight:700;line-height:1.4;}
.cr-verdict.v-bad{color:#FF8A80;}
.cr-verdict.v-good{color:#90EE90;}
.cr-narrative{font-size:17px;color:var(--text-2);line-height:1.75;margin-bottom:18px;padding:18px 20px;background:var(--bg);border-radius:9px;border-left:4px solid var(--gold-d);text-align:left;animation:fadeUp .3s ease .32s both;}
.cr-narrative b{color:var(--text);}
.cr-narrative .w{color:#90EE90;font-weight:700;}
.cr-narrative .l{color:#FF9898;font-weight:700;}
.cr-result-box{font-family:'Cinzel',serif;font-size:16px;font-weight:600;letter-spacing:.04em;padding:14px 22px;border-radius:9px;margin-bottom:24px;animation:fadeUp .3s ease .4s both;}
.cr-result-box.bad{background:rgba(220,80,80,.2);color:#FFBBBB;border:1.5px solid rgba(220,80,80,.38);}
.cr-result-box.good{background:rgba(129,199,132,.18);color:#B0E8B0;border:1.5px solid rgba(129,199,132,.35);}
.lose-prompt{text-align:center;padding:8px 0 6px;}
.lose-prompt-title{font-family:'Cinzel',serif;font-size:16px;font-weight:700;color:#FFBBBB;margin-bottom:18px;}
.lose-cards-row{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;}
.lose-card-btn{background:var(--bg3);border:2px solid var(--border);border-radius:11px;padding:20px 24px;cursor:pointer;transition:all .2s;text-align:center;min-width:148px;}
.lose-card-btn:hover{border-color:#EF5350;box-shadow:0 0 20px rgba(239,83,80,.3);transform:translateY(-2px);}
.lose-card-emoji{font-size:44px;margin-bottom:10px;}
.lose-card-name{font-family:'Cinzel',serif;font-size:15px;font-weight:700;color:var(--gold);}
.lose-card-role{font-size:14px;color:var(--text-2);margin-top:5px;}

/* ─── SPY MODAL ─── */
.spy-box{background:var(--bg2);border:2px solid var(--gold);border-radius:14px;padding:34px;max-width:400px;width:100%;text-align:center;}

/* ─── BOT SELECTOR ─── */
.bot-sel{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px;}
.bot-opt{background:var(--bg3);border:2px solid var(--border);border-radius:8px;padding:12px 22px;cursor:pointer;font-family:'Cinzel',serif;font-size:16px;font-weight:600;color:var(--text-2);transition:all .18s;}
.bot-opt.sel{border-color:var(--gold);background:rgba(240,192,96,.14);color:var(--gold);}
.bot-opt:hover{border-color:var(--border-l);color:var(--text);}

/* ─── CHAR REF ─── */
.ref-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:10px;}
.ref-card{background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;padding:18px;}
.ref-head{display:flex;align-items:center;gap:11px;margin-bottom:11px;}
.ref-cname{font-family:'Cinzel',serif;font-size:15px;font-weight:700;color:var(--gold);}
.ref-crole{font-size:14px;color:var(--text-3);}
.ref-body{font-size:15px;color:var(--text-2);line-height:1.65;}
.ref-al{color:var(--text);margin-bottom:6px;}
.ref-cl{color:var(--blue-text);}

/* ─── WINNER ─── */
.winner{text-align:center;padding:54px 28px;}
.winner-crown{font-size:76px;animation:float 3s ease-in-out infinite;}
@keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
.winner-title{font-family:'Cinzel',serif;font-size:clamp(22px,4.5vw,36px);font-weight:700;color:var(--gold);margin:18px 0 8px;}
.winner-name{font-family:'Cinzel',serif;font-size:clamp(20px,4vw,32px);font-weight:600;color:var(--text);}
.winner-sub{font-size:18px;color:var(--text-2);font-style:italic;margin-top:9px;}

/* ─── FALLEN ─── */
.fallen-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;}
.fallen-item{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1.5px solid var(--border);border-radius:7px;padding:7px 14px;}
.fallen-name{font-family:'Cinzel',serif;font-size:13px;font-weight:600;color:var(--text-2);}
.fallen-cnt{font-size:14px;font-weight:700;color:#EF9A9A;}

/* ─── LOBBY ─── */
.lobby-row{display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1.5px solid var(--border);}
.lobby-row:last-child{border-bottom:none;}
.lobby-dot{width:10px;height:10px;border-radius:50%;background:var(--green-l);flex-shrink:0;}
.room-code{font-family:'Cinzel',serif;font-size:30px;font-weight:700;letter-spacing:.28em;color:var(--gold);text-align:center;background:var(--bg);border:2px solid var(--border);padding:17px 26px;border-radius:10px;cursor:pointer;user-select:all;transition:border-color .2s;}
.room-code:hover{border-color:var(--gold);}

/* ─── SPIN ─── */
.spin{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spn 1s linear infinite;margin:24px auto;}
@keyframes spn{to{transform:rotate(360deg);}}

/* ─── UTILS ─── */
.tc{text-align:center;}.ti{font-style:italic;}
.mt8{margin-top:8px;}.mt12{margin-top:12px;}.mt16{margin-top:16px;}
.mb8{margin-bottom:8px;}.mb12{margin-bottom:12px;}.mb16{margin-bottom:16px;}
.err{color:#FF9898;font-size:16px;margin-top:10px;text-align:center;}
.ok{color:#90EE90;font-size:16px;margin-top:10px;text-align:center;}
.wait-msg{font-family:'Cinzel',serif;font-size:16px;font-weight:600;color:var(--text-2);letter-spacing:.07em;text-align:center;}

/* ─── GAME LAYOUT: side-by-side ─── */
.game-main{display:grid;grid-template-columns:240px 1fr;gap:12px;align-items:start;}
.game-left{display:flex;flex-direction:column;gap:10px;position:sticky;top:10px;max-height:calc(100vh - 60px);overflow-y:auto;}
.game-right{display:flex;flex-direction:column;gap:10px;min-width:0;}
/* MyHand compact in sidebar */
.my-hand .hand-cards-row{flex-direction:column;}
.my-hand .hand-card{border-right:none;border-bottom:1.5px solid var(--border);}
.my-hand .hand-card:last-child{border-bottom:none;}
.my-hand .hc-emoji{font-size:42px;}
.my-hand .hc-name{font-size:18px;}
.my-hand .hc-role{font-size:15px;}
.my-hand .hc-count{font-size:14px;}
.my-hand .hc-header{padding:16px 16px 12px;}
.my-hand .hc-abilities{padding:4px 16px 14px;}
.my-hand .hc-ability-text{font-size:15px;}
.my-hand .hc-ability-label{font-size:13px;}
.my-hand .hc-action-btn{font-size:14px;padding:13px 16px;font-weight:700;}
.my-hand .my-hand-title{font-size:15px;}
.my-hand .my-hand-meta{font-size:16px;}
/* Pending banner */
.resp-banner{background:#1C1010;border:2px solid #7A2828;border-radius:10px;padding:16px 20px;}
.resp-banner-title{font-family:"Cinzel",serif;font-size:15px;font-weight:700;color:#FFBBBB;margin-bottom:10px;}
.resp-claim{font-size:16px;color:var(--text);margin-bottom:14px;padding:12px 16px;background:rgba(0,0,0,.28);border-radius:8px;border-left:4px solid var(--gold);line-height:1.6;}
/* Compact status bar */
.status-bar{padding:10px 16px;}
/* Turn timer */
.turn-timer{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;background:var(--bg3);border:1.5px solid var(--border);}
.timer-ring{position:relative;width:38px;height:38px;flex-shrink:0;}
.timer-ring svg{transform:rotate(-90deg);}
.timer-ring-bg{fill:none;stroke:var(--border);stroke-width:3.5;}
.timer-ring-fill{fill:none;stroke-width:3.5;stroke-linecap:round;transition:stroke-dashoffset .9s linear,stroke .4s;}
.timer-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:"Cinzel",serif;font-size:13px;font-weight:700;}
.timer-label{font-size:14px;color:var(--text-2);flex:1;}
.timer-label b{color:var(--gold);}
.timer-label.urgent{color:#FF9898;}
.timer-label.urgent b{color:#FF9898;}
.status-l{font-size:13px;}
.status-c{font-size:15px;}
.status-r{font-size:13px;}
/* Fallen panel compact */
.fallen-compact{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;}
/* Coin pip display on opponents */
.coin-row{display:flex;align-items:center;gap:5px;margin-bottom:6px;}
.coin-pips{display:flex;flex-wrap:wrap;gap:2px;flex:1;}
.coin-pip{width:7px;height:7px;border-radius:50%;background:var(--gold);opacity:.8;flex-shrink:0;}
/* Threat highlight */
.opp.is-threat{border-color:#EF5350;box-shadow:0 0 12px rgba(239,83,80,.22);}

@media(max-width:480px){
  .game-main{grid-template-columns:1fr;}
  .game-left{position:static;max-height:none;overflow-y:visible;}
  .my-hand .hand-cards-row{flex-direction:row;}
  .my-hand .hand-card{border-bottom:none;border-right:1.5px solid var(--border);}
  .my-hand .hand-card:last-child{border-right:none;}
}

/* ─── INTERACTIVE TUTORIAL ─── */
.itut{max-width:760px;margin:16px auto;display:flex;flex-direction:column;gap:0;}
.itut-header{background:var(--bg2);border:2px solid var(--border);border-radius:14px 14px 0 0;padding:18px 24px;display:flex;align-items:center;gap:14px;border-bottom:none;}
.itut-chapter{font-family:"Cinzel",serif;font-size:12px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--text-3);}
.itut-title{font-family:"Cinzel",serif;font-size:18px;font-weight:700;color:var(--gold);}
.itut-steps{display:flex;gap:5px;margin-left:auto;flex-shrink:0;}
.itut-dot{width:9px;height:9px;border-radius:50%;background:var(--border);cursor:pointer;transition:all .2s;}
.itut-dot.on{background:var(--gold);transform:scale(1.25);}
.itut-dot.done{background:var(--green-l);}
/* Scenario stage */
.itut-stage{background:var(--bg3);border-left:2px solid var(--border);border-right:2px solid var(--border);padding:20px 24px;display:flex;flex-direction:column;gap:14px;}
/* Narrator coach bubble */
.coach{display:flex;gap:12px;align-items:flex-start;}
.coach-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--gold-d),var(--gold));display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;box-shadow:0 2px 10px rgba(240,192,96,.35);}
.coach-bubble{background:var(--bg2);border:1.5px solid var(--border-l);border-radius:0 12px 12px 12px;padding:13px 16px;flex:1;font-size:15px;color:var(--text-2);line-height:1.65;animation:fadeUp .3s ease both;}
.coach-bubble b{color:var(--gold);}
.coach-bubble em{color:var(--green-text);font-style:normal;}
.coach-bubble .warn{color:#FFB8B8;}
/* Simulated game table */
.sim-table{background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;}
.sim-table-title{font-family:"Cinzel",serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);text-align:center;}
.sim-players{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
.sim-player{background:var(--bg2);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;text-align:center;min-width:90px;transition:all .2s;}
.sim-player.active{border-color:var(--gold);box-shadow:0 0 12px rgba(240,192,96,.25);}
.sim-player.you{border-color:var(--green-l);background:rgba(56,142,60,.1);}
.sim-player.eliminated{opacity:.3;filter:grayscale(1);}
.sim-player-name{font-family:"Cinzel",serif;font-size:12px;font-weight:700;color:var(--gold);margin-bottom:4px;}
.sim-player-coins{font-size:13px;color:var(--text-2);margin-bottom:5px;}
.sim-player-cards{display:flex;gap:4px;justify-content:center;}
.sim-mini-card{width:24px;height:32px;border-radius:4px;border:1.5px solid var(--border);background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:11px;}
.sim-mini-card.lost{opacity:.2;filter:grayscale(1);}
/* Your hand sim */
.sim-hand{background:rgba(56,142,60,.08);border:1.5px solid rgba(129,199,132,.3);border-radius:10px;padding:14px;}
.sim-hand-title{font-family:"Cinzel",serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green-text);margin-bottom:10px;}
.sim-hand-cards{display:flex;gap:10px;flex-wrap:wrap;}
.sim-hand-card{background:var(--bg2);border:2px solid var(--border);border-radius:9px;padding:12px 14px;display:flex;align-items:center;gap:10px;flex:1;min-width:160px;}
.sim-hand-card.highlight{border-color:var(--gold);box-shadow:0 0 14px rgba(240,192,96,.25);animation:pulse 1.2s infinite;}
.sim-hand-card-emoji{font-size:26px;}
.sim-hand-card-info{flex:1;}
.sim-hand-card-name{font-family:"Cinzel",serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px;}
.sim-hand-card-role{font-size:12px;color:var(--text-3);}
/* Choices */
.choices{display:flex;flex-direction:column;gap:8px;}
.choice-btn{background:var(--bg2);border:2px solid var(--border);border-radius:10px;padding:14px 18px;cursor:pointer;text-align:left;transition:all .2s;display:flex;align-items:flex-start;gap:12px;}
.choice-btn:hover{border-color:var(--gold);background:var(--bg3);transform:translateX(3px);}
.choice-btn.correct{border-color:var(--green-l);background:rgba(56,142,60,.12);cursor:default;transform:none;}
.choice-btn.wrong{border-color:#EF5350;background:rgba(239,83,80,.1);cursor:default;transform:none;}
.choice-btn.neutral{border-color:var(--border-l);cursor:default;transform:none;opacity:.6;}
.choice-icon{font-size:22px;flex-shrink:0;}
.choice-text{flex:1;}
.choice-label{font-family:"Cinzel",serif;font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px;}
.choice-desc{font-size:13px;color:var(--text-2);line-height:1.5;}
.choice-result{font-size:13px;margin-top:5px;font-weight:600;}
.choice-result.good{color:var(--green-text);}
.choice-result.bad{color:#FF9898;}
/* Outcome banner */
.outcome{border-radius:10px;padding:14px 18px;display:flex;gap:12px;align-items:flex-start;animation:fadeUp .3s ease both;}
.outcome.win{background:rgba(56,142,60,.15);border:1.5px solid rgba(129,199,132,.4);}
.outcome.lose{background:rgba(239,83,80,.12);border:1.5px solid rgba(239,83,80,.35);}
.outcome.info{background:rgba(240,192,96,.1);border:1.5px solid rgba(240,192,96,.3);}
.outcome-icon{font-size:26px;flex-shrink:0;}
.outcome-text{flex:1;font-size:15px;line-height:1.6;color:var(--text-2);}
.outcome-text b{color:var(--text);}
/* Footer nav */
.itut-footer{background:var(--bg2);border:2px solid var(--border);border-radius:0 0 14px 14px;padding:14px 24px;display:flex;align-items:center;gap:12px;border-top:1.5px solid var(--border);}
.itut-progress-bar{flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden;}
.itut-progress-fill{height:100%;background:linear-gradient(90deg,var(--gold-d),var(--gold));border-radius:3px;transition:width .5s ease;}
/* Help button in-game */
.help-btn{position:fixed;bottom:20px;right:20px;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,var(--gold-d),var(--gold));border:none;cursor:pointer;font-size:20px;color:#1A1000;font-weight:700;box-shadow:0 4px 16px rgba(240,192,96,.45);z-index:100;display:flex;align-items:center;justify-content:center;transition:all .18s;}
.help-btn:hover{transform:scale(1.1);box-shadow:0 6px 22px rgba(240,192,96,.6);}
@media(max-width:560px){
  .itut-stage{padding:14px;}
  .sim-hand-cards{flex-direction:column;}
  .sim-players{gap:6px;}
}

@media(max-width:580px){
  .opp-grid{grid-template-columns:repeat(2,1fr);}
  .ag{grid-template-columns:1fr;}
  .ref-grid{grid-template-columns:1fr;}
  .mode-cards{grid-template-columns:1fr 1fr;}
  .tabs{flex-wrap:wrap;}
  .btn-sm{font-size:12px;padding:9px 14px;}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE REVEAL MODAL — now properly handles who loses what
// ─────────────────────────────────────────────────────────────────────────────
function ChallengeRevealModal({ reveal, iCalledBluff, loserCards, onConfirm }) {
  const [chosenCard, setChosenCard] = useState(null);
  if (!reveal) return null;

  const ch = CHARS[reveal.claimedCard] || {};
  const wasBluff = reveal.outcome === "correct"; // actor was bluffing
  const iLose   = reveal.loserId !== reveal.actorId ? iCalledBluff && !wasBluff
                                                     : !iCalledBluff || wasBluff;
  // Simplified: do I lose a card?
  const iAmLoser = reveal.loserName === "YOU" || (iCalledBluff && !wasBluff) || (!iCalledBluff && false);

  // Determine perspective
  let boxClass, bigIcon, headline, headClass, narrative, resultText, resultClass;

  if (iCalledBluff) {
    if (wasBluff) {
      // ✅ I challenged and I was RIGHT
      boxClass = "win"; bigIcon = "🎯";
      headline = "Bluff Exposed!"; headClass = "win";
      narrative = <><b>{reveal.actorName}</b> claimed <b>{ch.name}</b> — but did <span className="l">NOT</span> hold it! Your challenge was <span className="w">correct</span>. <span className="l">{reveal.loserName}</span> loses a card.</>;
      resultText = `✅ Your bluff call was RIGHT — ${reveal.loserName} loses a card!`;
      resultClass = "good";
    } else {
      // ❌ I challenged and I was WRONG — I lose a card
      boxClass = "lose"; bigIcon = "😰";
      headline = "Wrong Call — You Lose a Card!"; headClass = "lose";
      narrative = <><b>{reveal.actorName}</b> actually <em>did</em> hold <b>{ch.name}</b>. Your challenge failed. <span className="l">You</span> must now lose one of your cards as penalty.</>;
      resultText = `❌ Your bluff call was WRONG — you lose a card!`;
      resultClass = "bad";
    }
  } else {
    if (wasBluff) {
      boxClass = "neutral"; bigIcon = "🔍";
      headline = "Bluff Caught!"; headClass = "neutral";
      narrative = <><span className="w">{reveal.challengerName}</span> challenged and was correct — <b>{reveal.actorName}</b> was bluffing <b>{ch.name}</b>! <span className="l">{reveal.loserName}</span> loses a card.</>;
      resultText = `${reveal.loserName} loses a card for bluffing.`;
      resultClass = "bad";
    } else {
      boxClass = "neutral"; bigIcon = "⚔️";
      headline = "Challenge Failed"; headClass = "neutral";
      narrative = <><b>{reveal.challengerName}</b> challenged but <b>{reveal.actorName}</b> really held <b>{ch.name}</b>! <span className="l">{reveal.loserName}</span> loses a card for the failed challenge.</>;
      resultText = `${reveal.loserName} loses a card for a wrong challenge.`;
      resultClass = "bad";
    }
  }

  // If the loser is the human player and they have 2 cards, they choose which to lose
  const mustChoose = loserCards && loserCards.length >= 2;
  const canProceed = !mustChoose || chosenCard !== null;

  return (
    <div className="overlay">
      <div className={`cr-box ${boxClass}`}>
        <div className="cr-big-icon">{bigIcon}</div>
        <div className={`cr-headline ${headClass}`}>{headline}</div>

        {/* Card reveal split */}
        <div className="cr-split">
          <div className="cr-half left">
            <div className="cr-half-label">{reveal.actorName} claimed</div>
            <div className="cr-card-emoji">{ch.emoji || "❓"}</div>
            <div className="cr-card-name">{ch.name || reveal.claimedCard}</div>
          </div>
          <div className="cr-split-divider"/>
          <div className={`cr-half ${wasBluff ? "right-good" : "right-bad"}`}>
            <div className="cr-half-label">Was it real?</div>
            <div style={{fontSize:44,marginBottom:5}}>{wasBluff ? "🎭" : "✅"}</div>
            <div className={`cr-verdict ${wasBluff ? "v-bad" : "v-good"}`}>
              {wasBluff ? "BLUFF!\nNot held" : "REAL!\nWas held"}
            </div>
          </div>
        </div>

        <div className="cr-narrative">{narrative}</div>
        <div className={`cr-result-box ${resultClass}`}>{resultText}</div>

        {/* If human is the loser and has 2 cards, prompt which to discard */}
        {mustChoose && (
          <div className="lose-prompt">
            <div className="lose-prompt-title">Choose which card you lose:</div>
            <div className="lose-cards-row">
              {loserCards.map((ck, i) => {
                const lch = CHARS[ck] || {};
                return (
                  <div key={i} className="lose-card-btn"
                    style={chosenCard===ck ? {borderColor:"#C0392B",boxShadow:"0 0 20px rgba(192,57,43,.5)"} : {}}
                    onClick={() => setChosenCard(ck)}>
                    <div className="lose-card-emoji">{lch.emoji}</div>
                    <div className="lose-card-name">{lch.short}</div>
                    <div className="lose-card-role">{lch.role}</div>
                    {chosenCard === ck && <div style={{fontSize:11,color:"#FF7070",marginTop:5,fontFamily:"Cinzel,serif"}}>Selected ✗</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button className="btn btn-g" disabled={!canProceed} onClick={() => onConfirm(chosenCard)} style={{minWidth:170}}>
          {mustChoose && !canProceed ? "Choose a card to lose first" : "Continue ⚔️"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MY HAND COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function MyHand({ player, canAct, onUseCard }) {
  const allCards = [
    ...player.cards.map(k => ({ k, alive: true })),
    ...(player.lost || []).map(k => ({ k, alive: false })),
  ];

  return (
    <div className="my-hand">
      <div className="my-hand-header">
        <span className="my-hand-title">🃏 Your Hand</span>
        <span className="my-hand-meta">🪙 {player.coins} coins · {player.cards.length} card{player.cards.length !== 1 ? "s" : ""} alive</span>
      </div>
      <div className="hand-cards-row">
        {allCards.map(({ k, alive }, i) => {
          const ch = CHARS[k];
          if (!ch) return null;
          const canUseThis = canAct && alive && !!ch.actionType;
          return (
            <div key={i} className={`hand-card${alive ? "" : " dead"}`}
              style={{ borderRight: i < allCards.length - 1 ? `1px solid ${alive ? ch.color + "30" : "#2A1A0A"}` : "none" }}>

              <div className="hc-header" style={{ background: alive ? `linear-gradient(135deg,${ch.color}28,${ch.color}10)` : "rgba(20,12,4,.5)" }}>
                <span className="hc-emoji" style={{ opacity: alive ? 1 : .3 }}>{ch.emoji}</span>
                <div className="hc-meta">
                  <div className="hc-name" style={{ color: alive ? ch.color : "#3A2810" }}>{ch.name}</div>
                  <div className="hc-role">{ch.role}</div>
                  <div className="hc-count" style={{ color: alive ? ch.color + "AA" : "#3A2810" }}>
                    {alive ? `×${ch.count} in deck` : "LOST"}
                  </div>
                </div>
              </div>

              {alive && (
                <div className="hc-abilities">
                  {ch.action && (
                    <div className="hc-ability-block">
                      <div className="hc-ability-label" style={{ color: "#9FD49F" }}>
                        ⚡ Your Action
                      </div>
                      <div className="hc-ability-text" style={{ color: "#D8F0D8" }}>{ch.action}</div>
                    </div>
                  )}
                  {ch.counter && (
                    <div className="hc-ability-block">
                      <div className="hc-ability-label" style={{ color: "#90CAFF" }}>
                        🛡 Block Ability
                      </div>
                      <div className="hc-ability-text" style={{ color: "#C8E8FF" }}>{ch.counter}</div>
                    </div>
                  )}
                  {!ch.action && !ch.counter && (
                    <div className="hc-no-ability">No active ability</div>
                  )}
                </div>
              )}

              {alive && (
                <button
                  className="hc-action-btn"
                  disabled={!canUseThis}
                  style={{
                    background: canUseThis ? `linear-gradient(135deg,${ch.color}45,${ch.color}28)` : "rgba(20,12,4,.5)",
                    color: canUseThis ? "#D8FFD8" : "#3A2810",
                  }}
                  onClick={() => canUseThis && onUseCard && onUseCard(k)}
                >
                  {canUseThis ? `⚡ Use ${ch.short}` : ch.actionType ? "Not your turn" : "Block only"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]     = useState("home");
  const [mode, setMode]         = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [botCount, setBotCount] = useState(3);
  const [roomInput, setRoomInput] = useState("");
  const [roomId, setRoomId]     = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [gs, setGs]             = useState(null);
  const [err, setErr]           = useState("");
  const [loading, setLoading]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const [tab, setTab]           = useState("bluff");
  const [actionStep, setActionStep]   = useState(null);
  const [bluffClaim, setBluffClaim]   = useState(null);
  const [guessTarget, setGuessTarget] = useState(null);
  const [displayedEvent, setDisplayedEvent] = useState("The fate of the Chola throne awaits…");
  const [tutStep, setTutStep] = useState(0);
  const [tutChosen, setTutChosen] = useState(null);
  const [prevScreen, setPrevScreen] = useState(null);
  // pendingReveal: { reveal, postState, iCalledBluff }
  const [pendingReveal, setPendingReveal] = useState(null);
  const [turnTimer, setTurnTimer] = useState(30);

  const pollRef   = useRef(null);
  const aiRef     = useRef(null);
  const prevEv    = useRef(null);
  const timerRef  = useRef(null);
  const timerTurn = useRef(null); // tracks which turn the timer is counting for

  const me           = gs?.players?.find(p => p.id === playerId);
  const ap           = gs ? activePl(gs) : null;
  const isMyTurn     = ap?.id === playerId;
  const aliveOthers  = gs ? alivePls(gs).filter(p => p.id !== playerId) : [];
  const pa           = gs?.pendingAction || null;
  const myPending    = pa && (gs?.pendingResponse || []).includes(playerId);
  const compulsory   = (me?.coins || 0) >= 10;

  useEffect(() => {
    if (gs?.lastEvent && gs.lastEvent !== prevEv.current) {
      prevEv.current = gs.lastEvent;
      setDisplayedEvent(gs.lastEvent);
    }
  }, [gs?.lastEvent]);

  // ── 30-second turn timer ────────────────────────────────────────────────
  useEffect(() => {
    if (!gs || gs.phase !== "playing" || pendingReveal || screen !== "game") {
      clearInterval(timerRef.current);
      return;
    }
    // Identify the current "turn key" — unique per turn/pending state
    const turnKey = ap?.id + "|" + (pa ? "resp" : "act") + "|" + gs.turn;
    if (timerTurn.current !== turnKey) {
      // New turn started — reset timer
      timerTurn.current = turnKey;
      setTurnTimer(30);
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTurnTimer(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            // Time's up — auto-action
            if (isMyTurn && !pa) {
              // Human's turn — auto Income
              doAction({ type: "income" });
            } else if (myPending) {
              // Human needs to respond — auto Pass
              doResponse("pass");
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {};
  }, [gs?.turn, ap?.id, pa, isMyTurn, myPending, pendingReveal, screen]);

  // MP real-time listener (Firebase onSnapshot)
  useEffect(() => {
    if (!roomId || mode !== "mp") return;
    const unsub = storeSubscribe(`ps_${roomId}`, (s) => {
      if (!s) return;
      if (s.challengeReveal && !gs?.challengeReveal) {
        const iCalled = s.challengeReveal.challengerId === playerId;
        setPendingReveal({ reveal: s.challengeReveal, postState: s, iCalledBluff: iCalled });
      } else setGs(s);
      if (s.phase === "playing" && screen === "mp_lobby") setScreen("game");
    });
    return () => unsub();
  }, [roomId, mode]);

  // AI engine
  useEffect(() => {
    if (mode !== "sp" || !gs || gs.phase !== "playing" || pendingReveal) return;
    clearTimeout(aiRef.current);

    // Bots respond to pending action
    if (pa && (gs.pendingResponse || []).some(id => gs.players.find(p => p.id === id)?.isBot)) {
      aiRef.current = setTimeout(() => {
        let s = processAiBots(gs);
        s = resolveResponses(s);
        if (s.challengeReveal) {
          const iCalled = s.challengeReveal.challengerId === playerId;
          setPendingReveal({ reveal: s.challengeReveal, postState: s, iCalledBluff: iCalled });
          return;
        }
        const nap = activePl(s);
        if (nap?.isBot && s.phase === "playing" && !s.pendingAction) {
          setTimeout(() => {
            let s2 = applyAction(s, nap.id, aiPickAction(s, nap));
            s2 = processAiBots(s2); s2 = resolveResponses(s2);
            if (s2.challengeReveal) setPendingReveal({ reveal: s2.challengeReveal, postState: s2, iCalledBluff: false });
            else setGs(s2);
          }, 1800);
        } else setGs(s);
      }, 1500);
      return;
    }

    // Bot's own turn
    if (ap?.isBot && !pa) {
      aiRef.current = setTimeout(() => {
        let s = applyAction(gs, ap.id, aiPickAction(gs, ap));
        s = processAiBots(s); s = resolveResponses(s);
        if (s.challengeReveal) setPendingReveal({ reveal: s.challengeReveal, postState: s, iCalledBluff: false });
        else setGs(s);
      }, 2200);
    }
  }, [gs, mode, pendingReveal]);

  // Modal confirmed — apply the card loss
  function onRevealConfirm(chosenCard) {
    if (!pendingReveal) return;
    const s = applyChallengeLoss(pendingReveal.postState, chosenCard);
    setPendingReveal(null);
    setGs(s);
  }

  const resetAction = () => { setActionStep(null); setBluffClaim(null); setGuessTarget(null); };

  async function doAction(action) {
    if (!isMyTurn || pa) return;
    let s = mode === "mp" ? await storeLoad(`ps_${roomId}`) : deepCopy(gs);
    if (!s) return;
    s = applyAction(s, playerId, action);
    if (mode === "sp" && s.pendingAction) {
      s = processAiBots(s); s = resolveResponses(s);
      if (s.challengeReveal) {
        setPendingReveal({ reveal: s.challengeReveal, postState: s, iCalledBluff: false });
        resetAction(); return;
      }
    }
    if (mode === "mp") await storeSave(`ps_${roomId}`, s);
    setGs(s); resetAction();
  }

  async function doResponse(resp) {
    const iCalledBluff = resp === "challenge";
    let s = mode === "mp" ? await storeLoad(`ps_${roomId}`) : deepCopy(gs);
    if (!s || !s.pendingAction) return;
    s = deepCopy(s);
    s.responses[playerId] = resp;
    s.pendingResponse = s.pendingResponse.filter(id => id !== playerId);
    if (mode === "sp") {
      s = processAiBots(s); s = resolveResponses(s);
      if (s.challengeReveal) {
        const iCalled = s.challengeReveal.challengerId === playerId;
        setPendingReveal({ reveal: s.challengeReveal, postState: s, iCalledBluff: iCalled });
        return;
      }
    } else {
      s = resolveResponses(s);
      await storeSave(`ps_${roomId}`, s);
      if (s.challengeReveal) {
        const iCalled = s.challengeReveal.challengerId === playerId;
        setPendingReveal({ reveal: s.challengeReveal, postState: s, iCalledBluff: iCalled });
        return;
      }
    }
    setGs(s);
  }

  // When player clicks "Use X" on their hand card
  function handleCardUse(cardKey) {
    const ch = CHARS[cardKey];
    if (!ch?.actionType) return;
    if (!NEEDS_TARGET.has(ch.actionType)) {
      doAction({ type: ch.actionType, claimedCard: cardKey });
    } else if (ch.actionType === "guess") {
      setBluffClaim(cardKey); setActionStep("guess");
    } else if (ch.actionType === "traitor_swap") {
      setBluffClaim(cardKey); setActionStep("traitor_swap");
    } else {
      setBluffClaim(cardKey); setActionStep(ch.actionType);
    }
  }

  // Setup
  async function startSP() {
    if (!playerName.trim()) { setErr("Enter your name"); return; }
    const deck = shuffle(buildDeck()); const pid = genId();
    const human = makePlayer(pid, playerName.trim(), deck, false);
    const bots = shuffle([...AI_NAMES]).slice(0, botCount).map(n => makePlayer(genId(), n, deck, true));
    const players = shuffle([human, ...bots]);
    const state = { roomId:null, phase:"playing", players, deck, turn:0, pendingAction:null, pendingResponse:[], responses:{}, winner:null, spyReveal:null, challengeReveal:null, lastEvent:"⚔️ The battle for the Chola throne begins!" };
    setPlayerId(pid); setGs(state); setMode("sp"); setScreen("game");
  }
  async function createRoom() {
    if (!playerName.trim()) { setErr("Enter your name"); return; }
    setLoading(true);
    const deck = shuffle(buildDeck()); const pid = genId(); const rid = genId();
    const human = makePlayer(pid, playerName.trim(), deck, false);
    const state = { roomId:rid, phase:"lobby", players:[human], deck, turn:0, pendingAction:null, pendingResponse:[], responses:{}, winner:null, spyReveal:null, challengeReveal:null, lastEvent:"Room created." };
    await storeSave(`ps_${rid}`, state);
    setRoomId(rid); setPlayerId(pid); setGs(state); setMode("mp"); setScreen("mp_lobby");
    setLoading(false);
  }
  async function joinRoom() {
    if (!playerName.trim()) { setErr("Enter your name"); return; }
    if (!roomInput.trim()) { setErr("Enter room code"); return; }
    setLoading(true);
    const s = await storeLoad(`ps_${roomInput.trim().toLowerCase()}`);
    if (!s) { setErr("Room not found"); setLoading(false); return; }
    if (s.phase !== "lobby") { setErr("Game already started"); setLoading(false); return; }
    if (s.players.length >= 6) { setErr("Room is full"); setLoading(false); return; }
    const ns = deepCopy(s); const pid = genId();
    ns.players.push(makePlayer(pid, playerName.trim(), ns.deck, false));
    ns.lastEvent = `${playerName.trim()} joined.`;
    await storeSave(`ps_${s.roomId}`, ns);
    setRoomId(s.roomId); setPlayerId(pid); setGs(ns); setMode("mp"); setScreen("mp_lobby");
    setLoading(false);
  }
  async function startMPGame() {
    if (gs.players.length < 2) { setErr("Need 2+ players"); return; }
    const ns = { ...gs, phase:"playing", lastEvent:"⚔️ The battle begins!" };
    await storeSave(`ps_${roomId}`, ns); setGs(ns); setScreen("game");
  }

  // ─── TARGET SELECTION RENDER ──────────────────────────────────────────────
  function renderTargets(step, claim) {
    const titles = { steal:"🌹 Steal from whom?", assassinate:"💀 Assassinate whom?", spy:"🔍 Spy on whom?", traitor_swap:"🗡️ Swap with whom? (must have 2 cards)", coup:"⚡ Who loses a card?" };
    const filtered = step === "traitor_swap" ? aliveOthers.filter(p => p.cards.length >= 2) : aliveOthers;
    return (
      <div className="tsec">
        <div className="tsec-title">{titles[step]}</div>
        <div className="tgrid">
          {filtered.map(p => (
            <button key={p.id} className="tb" onClick={() => doAction({ type: step === "traitor_swap" ? "traitor_swap" : step, targetId: p.id, claimedCard: claim || null })}>
              <div className="tb-name">{p.name}</div>
              <div className="tb-info">🪙{p.coins} · {p.cards.length} card(s)</div>
            </button>
          ))}
        </div>
        <div className="mt12"><button className="btn btn-gh btn-sm" onClick={resetAction}>← Cancel</button></div>
      </div>
    );
  }

  // ─── SCREENS ─────────────────────────────────────────────────────────────

  // ─── INTERACTIVE TUTORIAL ────────────────────────────────────────────────
  function renderTutorial() {
    // Each scene has: coach text, optional sim state, optional choices, optional outcome
    const scenes = [
      // 0 — Welcome
      { chapter:"Introduction", title:"Welcome to the Chola Court",
        coach: <><b>Welcome, strategist!</b> I am your guide through the court of the Chola Dynasty. This tutorial will teach you through <em>real decisions</em> — not just reading. Let us begin.</>,
        sim: null, choices: null,
        nextLabel:"Let's Begin →"
      },
      // 1 — Your hand revealed
      { chapter:"Your Identity", title:"You Have Been Dealt Two Cards",
        coach: <><b>These are your secret identity cards.</b> You hold <em>Ravidasan</em> (Assassin) and <em>Nandini</em> (Pazhuvur Queen). Only you know this. Opponents have no idea what you hold!</>,
        sim: {
          players:[
            {name:"You",coins:2,cards:2,lost:0,you:true},
            {name:"Vikram",coins:2,cards:2,lost:0},
            {name:"Meera",coins:2,cards:2,lost:0},
          ],
          hand:[
            {key:"ravidasan",highlight:true},
            {key:"nandini",highlight:true},
          ]
        },
        choices: null,
        nextLabel:"I see my cards →"
      },
      // 2 — Your turn, take income
      { chapter:"Your First Turn", title:"Taking Income — The Safe Play",
        coach: <>It is <b>your turn</b>. You need coins to use powerful actions. <em>Income</em> gives you 1 coin safely — no one can block or challenge it. <b>Click Income to collect your coin.</b></>,
        sim: {
          players:[
            {name:"You",coins:2,cards:2,lost:0,you:true,active:true},
            {name:"Vikram",coins:3,cards:2,lost:0},
            {name:"Meera",coins:2,cards:2,lost:0},
          ],
          hand:[{key:"ravidasan"},{key:"nandini"}]
        },
        choices:[
          {icon:"🪙", label:"Take Income", desc:"Take 1 coin from the Treasury. Completely safe.", correct:true,
           result:"✅ You now have 3 coins. Safe and simple — no one can stop this!"},
          {icon:"💀", label:"Use Ravidasan — Assassinate", desc:"Pay 4 coins to force a player to lose a card... but you only have 2 coins.", correct:false,
           result:"❌ You can't afford this yet! You need at least 4 coins to assassinate."},
          {icon:"🎭", label:"Bluff Tax (claim Pazhuvettarayar)", desc:"Claim to be the Treasurer and collect 3 coins.", correct:false,
           result:"⚠ This works but is risky early. You could be challenged and lose a card!"},
        ]
      },
      // 3 — Opponent acts, bluff scenario
      { chapter:"Responding to Actions", title:"Vikram Claims to Be an Assassin",
        coach: <><b>Vikram declares:</b> <span className="warn">"I claim Ravidasan — I pay 4 coins to assassinate you!"</span><br/><br/>You actually hold Ravidasan yourself — so you know <em>at least one copy is in your hand</em>. Vikram might be bluffing. What do you do?</>,
        sim: {
          players:[
            {name:"You",coins:3,cards:2,lost:0,you:true},
            {name:"Vikram",coins:5,cards:2,lost:0,active:true},
            {name:"Meera",coins:2,cards:2,lost:0},
          ],
          hand:[{key:"ravidasan",highlight:true},{key:"nandini"}],
          event:"Vikram claims Ravidasan — Assassinate targeting YOU!"
        },
        choices:[
          {icon:"🎯", label:"Challenge — Call the Bluff!", desc:"You hold Ravidasan. He might not have it.", correct:true,
           result:"✅ Brilliant! You hold Ravidasan, so Vikram is more likely bluffing. If caught, he loses a card and the assassination is cancelled!"},
          {icon:"🛡", label:"Block with Aazhwarkadiyan", desc:"Claim the Spy can block assassination.", correct:false,
           result:"⚠ This works but Vikram could challenge YOUR block — and you don't hold Aazhwarkadiyan either, so you'd be bluffing too!"},
          {icon:"✋", label:"Pass — Accept the hit", desc:"Take the assassination and lose a card.", correct:false,
           result:"❌ Don't give up so easily! You had strong reason to challenge here."},
        ]
      },
      // 4 — Bluff outcome
      { chapter:"Challenge Result", title:"You Called the Bluff — Here's What Happened",
        coach: <>Vikram was revealed: he held <b>Kundavai</b>, not Ravidasan! <em>Your challenge was correct.</em><br/><br/>Vikram must now lose a card as penalty — the assassination is cancelled. <b>This is the power of bluff-calling!</b> One card costs you nothing and saves your life.</>,
        sim: {
          players:[
            {name:"You",coins:3,cards:2,lost:0,you:true},
            {name:"Vikram",coins:5,cards:1,lost:1,active:true},
            {name:"Meera",coins:2,cards:2,lost:0},
          ],
          hand:[{key:"ravidasan"},{key:"nandini"}],
          event:"✅ Challenge SUCCESS — Vikram loses a card! Assassination cancelled."
        },
        choices: null,
        nextLabel:"Understood! →"
      },
      // 5 — Bluffing yourself
      { chapter:"Bluffing", title:"Now You Bluff — Claim the Tax!",
        coach: <>You hold Ravidasan and Nandini — but <b>neither gives you Tax ability</b>. However, you can <em>claim to be Pazhuvettarayar</em> anyway to collect 3 coins. Opponents don't know what you hold! <b>Try claiming Tax.</b></>,
        sim: {
          players:[
            {name:"You",coins:3,cards:2,lost:0,you:true,active:true},
            {name:"Vikram",coins:4,cards:1,lost:1},
            {name:"Meera",coins:2,cards:2,lost:0},
          ],
          hand:[{key:"ravidasan"},{key:"nandini"}],
        },
        choices:[
          {icon:"👑", label:"Claim Tax (bluff Pazhuvettarayar)", desc:"Announce 'I claim Pazhuvettarayar — Tax, 3 coins!' You don't actually hold this card.", correct:true,
           result:"✅ Bold move! Opponents must now decide — do they challenge you or let it slide?"},
          {icon:"🪙", label:"Take Income instead (safe)", desc:"Just take 1 coin, no risk.", correct:false,
           result:"⚠ Safe, but slow. You're leaving money on the table. Sometimes the bluff is worth it!"},
        ]
      },
      // 6 — Meera challenges your bluff
      { chapter:"Getting Caught", title:"Meera Challenges Your Bluff!",
        coach: <><b>Meera says: "I challenge! Show me Pazhuvettarayar!"</b><br/><br/>You don't hold it — you were bluffing. <em>You must now reveal your hand</em> and lose a card as penalty. The tax is cancelled.<br/><br/><span className="warn">This is the risk of bluffing. But don't be discouraged — even skilled players bluff and get caught sometimes!</span></>,
        sim: {
          players:[
            {name:"You",coins:3,cards:1,lost:1,you:true},
            {name:"Vikram",coins:4,cards:1,lost:1},
            {name:"Meera",coins:2,cards:2,lost:0,active:true},
          ],
          hand:[{key:"nandini"}],
          lostCards:["ravidasan"],
          event:"❌ Bluff caught! You lose a card. Nandini remains."
        },
        choices: null,
        nextLabel:"I understand the risk →"
      },
      // 7 — Character sheet
      { chapter:"The Characters", title:"Meet the Chola Court",
        coach: <><b>9 characters shape every game.</b> Each has a unique action and/or counter-ability. <em>Knowing all 9 is the key</em> to bluffing convincingly and catching others. Study them — you can scroll!</>,
        sim: null,
        charSheet: true,
        choices: null,
        nextLabel:"Got it! →"
      },
      // 8 — Strategy tips
      { chapter:"Strategy", title:"Tactics of the Throne",
        coach: <><b>You are nearly ready for battle.</b> Here are the most important strategic principles:</>,
        sim: null,
        tips: [
          {icon:"📊", tip:<><b>Count the discard pile.</b> If all 3 Ravidasan cards are gone, <em>any assassination claim is a guaranteed bluff</em> — always challenge!</>},
          {icon:"🪙", tip:<><b>Watch coin counts.</b> Anyone with 7+ coins can Coup next turn. They are a priority target.</>},
          {icon:"🎭", tip:<><b>Vary your bluffs.</b> The AI remembers your past claims. Claiming the same character repeatedly raises suspicion.</>},
          {icon:"🛡", tip:<><b>Bluff-block freely.</b> Claiming a counter-character costs nothing if unchallenged. Make opponents second-guess.</>},
          {icon:"⚔️", tip:<><b>With 1 card left</b>, play only cards you actually hold. You cannot afford another loss.</>},
          {icon:"🎯", tip:<><b>Challenge aggressively early.</b> Losing a challenge costs 1 card but catches bluffers who lose theirs too.</>},
        ],
        choices: null,
        nextLabel:"I'm ready to play! ⚔️",
        isLast: true
      },
    ];

    const sc = scenes[tutStep];
    const pct = Math.round(((tutStep+1)/scenes.length)*100);
    const chosen = tutChosen;
    const setChosen = setTutChosen;

    function handleChoice(idx) {
      if (chosen !== null) return;
      setChosen(idx);
    }
    const canAdvance = !sc.choices || chosen !== null;

    function advance() {
      setTutChosen(null);
      if (sc.isLast) { setTutStep(0); setScreen(prevScreen||"home"); setPrevScreen(null); setTutChosen(null); }
      else setTutStep(s => s+1);
    }

    return (
      <div className="itut">
        {/* Header */}
        <div className="itut-header">
          <div>
            <div className="itut-chapter">{sc.chapter}</div>
            <div className="itut-title">{sc.title}</div>
          </div>
          <div className="itut-steps">
            {scenes.map((_,i)=>(
              <div key={i} className={`itut-dot${i===tutStep?" on":i<tutStep?" done":""}`}
                onClick={()=>{setTutChosen(null);setTutStep(i);}}/>
            ))}
          </div>
        </div>

        {/* Stage */}
        <div className="itut-stage">

          {/* Coach */}
          <div className="coach">
            <div className="coach-avatar">⚜</div>
            <div className="coach-bubble">{sc.coach}</div>
          </div>

          {/* Simulated table */}
          {sc.sim && (
            <div className="sim-table">
              <div className="sim-table-title">⚔️ Game Table</div>
              {sc.sim.event && (
                <div style={{background:"rgba(240,192,96,.1)",border:"1px solid rgba(240,192,96,.25)",borderRadius:8,padding:"9px 14px",fontSize:14,color:"var(--text-2)",fontStyle:"italic",textAlign:"center"}}>{sc.sim.event}</div>
              )}
              <div className="sim-players">
                {sc.sim.players.map((p,i)=>(
                  <div key={i} className={`sim-player${p.you?" you":""}${p.active?" active":""}${p.cards===0?" eliminated":""}`}>
                    <div className="sim-player-name">{p.you?"You 👤":p.name}</div>
                    <div className="sim-player-coins">🪙 {p.coins}</div>
                    <div className="sim-player-cards">
                      {Array.from({length:p.cards}).map((_,j)=><div key={j} className="sim-mini-card">🀫</div>)}
                      {Array.from({length:p.lost||0}).map((_,j)=><div key={"l"+j} className="sim-mini-card lost">💀</div>)}
                    </div>
                  </div>
                ))}
              </div>
              {sc.sim.hand && (
                <div className="sim-hand">
                  <div className="sim-hand-title">🃏 Your Secret Hand</div>
                  <div className="sim-hand-cards">
                    {sc.sim.hand.map((hc,i)=>{
                      const ch=CHARS[hc.key];
                      return(
                        <div key={i} className={`sim-hand-card${hc.highlight?" highlight":""}`}>
                          <span className="sim-hand-card-emoji">{ch?.emoji}</span>
                          <div className="sim-hand-card-info">
                            <div className="sim-hand-card-name" style={{color:ch?.color}}>{ch?.short}</div>
                            <div className="sim-hand-card-role">{ch?.role}</div>
                          </div>
                        </div>
                      );
                    })}
                    {(sc.sim.lostCards||[]).map((k,i)=>{
                      const ch=CHARS[k];
                      return(
                        <div key={"l"+i} className="sim-hand-card" style={{opacity:.3,filter:"grayscale(1)"}}>
                          <span className="sim-hand-card-emoji">{ch?.emoji}</span>
                          <div className="sim-hand-card-info">
                            <div className="sim-hand-card-name">{ch?.short}</div>
                            <div className="sim-hand-card-role">LOST</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Character sheet */}
          {sc.charSheet && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:9,maxHeight:360,overflowY:"auto",padding:"4px 2px"}}>
              {CHAR_KEYS.map(k=>{
                const ch=CHARS[k];
                return(
                  <div key={k} style={{background:"var(--bg2)",border:`1.5px solid ${ch.color}55`,borderRadius:9,padding:"12px 13px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:7}}>
                      <span style={{fontSize:24}}>{ch.emoji}</span>
                      <div>
                        <div style={{fontFamily:"Cinzel,serif",fontSize:13,fontWeight:700,color:ch.color}}>{ch.short}</div>
                        <div style={{fontSize:11,color:"var(--text-3)"}}>{ch.role} · ×{ch.count}</div>
                      </div>
                    </div>
                    {ch.action&&<div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.5,marginBottom:4}}>⚡ {ch.action}</div>}
                    {ch.counter&&<div style={{fontSize:12,color:"var(--blue-text)",lineHeight:1.5}}>🛡 {ch.counter}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tips */}
          {sc.tips && (
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {sc.tips.map((t,i)=>(
                <div key={i} style={{display:"flex",gap:12,background:"var(--bg2)",border:"1.5px solid var(--border)",borderRadius:9,padding:"12px 14px",alignItems:"flex-start"}}>
                  <span style={{fontSize:22,flexShrink:0}}>{t.icon}</span>
                  <div style={{fontSize:14,color:"var(--text-2)",lineHeight:1.6}}>{t.tip}</div>
                </div>
              ))}
            </div>
          )}

          {/* Choices */}
          {sc.choices && (
            <div className="choices">
              {sc.choices.map((c,i)=>{
                let cls = "choice-btn";
                if (chosen !== null) {
                  if (i === chosen) cls += c.correct ? " correct" : " wrong";
                  else cls += " neutral";
                }
                return(
                  <div key={i} className={cls} onClick={()=>handleChoice(i)}>
                    <span className="choice-icon">{c.icon}</span>
                    <div className="choice-text">
                      <div className="choice-label">{c.label}</div>
                      <div className="choice-desc">{c.desc}</div>
                      {chosen===i && <div className={`choice-result ${c.correct?"good":"bad"}`}>{c.result}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Post-choice outcome */}
          {chosen !== null && sc.choices && (
            <div className={`outcome ${sc.choices[chosen].correct?"win":"lose"}`}>
              <span className="outcome-icon">{sc.choices[chosen].correct?"🎯":"💡"}</span>
              <div className="outcome-text">
                {sc.choices[chosen].correct
                  ? <><b>Good decision!</b> {sc.choices[chosen].result}</>
                  : <><b>Not quite —</b> {sc.choices[chosen].result}</>}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="itut-footer">
          <button className="btn btn-gh btn-sm" onClick={()=>{setTutChosen(null);setTutStep(0);setScreen(prevScreen||"home");setPrevScreen(null);}}>{prevScreen==="game"?"▶ Resume Game":"← Home"}</button>
          {tutStep > 0 && <button className="btn btn-dk btn-sm" onClick={()=>{setTutChosen(null);setTutStep(s=>s-1);}}>← Back</button>}
          <div className="itut-progress-bar"><div className="itut-progress-fill" style={{width:`${pct}%`}}/></div>
          <button className="btn btn-g btn-sm" disabled={!canAdvance} onClick={advance}>
            {!canAdvance ? "Choose an option ↑" : (sc.nextLabel || "Continue →")}
          </button>
        </div>
      </div>
    );
  }

  function renderHome() {
    return (
      <div className="panel" style={{maxWidth:460,margin:"32px auto"}}>
        <div className="ptitle">Choose Your Path</div>
        <div className="mode-cards">
          <div className={`mode-card${mode==="sp"?" active":""}`} onClick={()=>{setMode("sp");setScreen("sp_setup");}}>
            <div className="mode-icon">🤖</div><div className="mode-name">Single Player</div>
            <div className="mode-desc">Play against AI warriors of the Chola court</div>
          </div>
          <div className={`mode-card${mode==="mp"?" active":""}`} onClick={()=>{setMode("mp");setScreen("mp_setup");}}>
            <div className="mode-icon">🌐</div><div className="mode-name">Multiplayer</div>
            <div className="mode-desc">Battle real players via shared room code</div>
          </div>
        </div>
        <div className="div"/>
        <button className="btn btn-gh btn-full" onClick={()=>setScreen("tutorial")}>📖 How to Play — Tutorial</button>
        <div className="div"/>
        <div className="tc ti" style={{fontSize:13,color:"var(--gold-d)"}}>3–6 players · Strategy · Bluffing · Chola Dynasty ⚜</div>
      </div>
    );
  }

  function renderSPSetup() {
    return (
      <div className="panel" style={{maxWidth:440,margin:"32px auto"}}>
        <div className="ptitle">⚔️ Single Player</div>
        <label className="lbl">Your Name</label>
        <input className="inp mb12" placeholder="Enter your name…" value={playerName} onChange={e=>setPlayerName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&startSP()}/>
        <label className="lbl">AI Opponents</label>
        <div className="bot-sel">
          {[1,2,3,4,5].map(n=>(
            <div key={n} className={`bot-opt${botCount===n?" sel":""}`} onClick={()=>setBotCount(n)}>{n}</div>
          ))}
        </div>
        <div className="div"/>
        <button className="btn btn-g btn-full" onClick={startSP}>Begin the Battle ⚔️</button>
        <button className="btn btn-gh btn-full mt8" onClick={()=>{setErr("");setScreen("home");}}>← Back</button>
        {err&&<div className="err">{err}</div>}
      </div>
    );
  }

  function renderMPSetup() {
    return (
      <div className="panel" style={{maxWidth:440,margin:"32px auto"}}>
        <div className="ptitle">🌐 Multiplayer</div>
        <label className="lbl">Your Name</label>
        <input className="inp" placeholder="Enter your name…" value={playerName} onChange={e=>setPlayerName(e.target.value)}/>
        <div className="div"/>
        <button className="btn btn-g btn-full" onClick={createRoom} disabled={loading}>{loading?"Creating…":"Create New Room"}</button>
        <div className="div"/>
        <label className="lbl">Join existing room</label>
        <input className="inp mt8" placeholder="Enter room code…" value={roomInput} onChange={e=>setRoomInput(e.target.value.toLowerCase())} onKeyDown={e=>e.key==="Enter"&&joinRoom()}/>
        <button className="btn btn-gh btn-full mt8" onClick={joinRoom} disabled={loading}>{loading?"Joining…":"Join Room"}</button>
        <div className="div"/>
        <button className="btn btn-dk btn-full" onClick={()=>{setErr("");setScreen("home");}}>← Back</button>
        {err&&<div className="err">{err}</div>}
      </div>
    );
  }

  function renderMPLobby() {
    const isHost = gs?.players[0]?.id===playerId;
    return (
      <div className="panel" style={{maxWidth:480,margin:"32px auto"}}>
        <div className="ptitle">⚜ War Room ⚜</div>
        <div className="tc mb12" style={{fontSize:14,color:"var(--ivory-d)"}}>Share this code:</div>
        <div className="room-code mb12" onClick={()=>{navigator.clipboard?.writeText(gs.roomId.toUpperCase());setCopied(true);setTimeout(()=>setCopied(false),2200);}}>{gs?.roomId?.toUpperCase()}</div>
        {copied&&<div className="ok mb8">✓ Copied!</div>}
        <div className="div"/>
        <div className="ptitle" style={{fontSize:11,marginBottom:8}}>Players ({gs?.players?.length}/6)</div>
        {gs?.players?.map(p=>(
          <div key={p.id} className="lobby-row">
            <div className="lobby-dot"/>
            <span style={{fontFamily:"Cinzel,serif",fontSize:13,flex:1}}>{p.name}</span>
            {p.id===playerId&&<span className="tag" style={{background:"#1B3A1B",color:"#7FBF7F"}}>YOU</span>}
            {p.id===gs.players[0].id&&<span style={{fontSize:9,color:"var(--gold-d)",fontFamily:"Cinzel,serif"}}>HOST</span>}
          </div>
        ))}
        <div className="div"/>
        {isHost?(
          <>
            {gs.players.length<2&&<div className="err mb12">Need 2+ players…</div>}
            <button className="btn btn-g btn-full" onClick={startMPGame} disabled={gs.players.length<2}>Begin the Battle ⚔️</button>
          </>
        ):(
          <div className="tc ti" style={{fontSize:14,color:"var(--ivory-d)"}}>Waiting for host…<div className="spin"/></div>
        )}
        {err&&<div className="err">{err}</div>}
      </div>
    );
  }

  function renderGame() {
    if (!gs || !me) return <div className="spin"/>;

    if (gs.phase === "ended") {
      const winner = gs.players.find(p=>p.id===gs.winner);
      const iWon = gs.winner === playerId;
      return (
        <div className="panel winner">
          <div className="winner-crown">{iWon?"👑":"⚔️"}</div>
          <div className="winner-title">{iWon?"You are the King Maker!":"King Maker Revealed"}</div>
          <div className="winner-name">{winner?.name}</div>
          <div className="winner-sub">has shaped the destiny of the Chola Dynasty</div>
          <div className="div" style={{margin:"20px 0"}}/>
          <button className="btn btn-g" onClick={()=>{setGs(null);setPendingReveal(null);setScreen("home");resetAction();}}>Play Again</button>
        </div>
      );
    }

    const lostCards = gs.players.reduce((acc,p)=>{ (p.lost||[]).forEach(c=>{acc[c]=(acc[c]||0)+1;}); return acc; },{});

    // For the challenge modal — if human is the loser, pass their current cards so they can choose
    const revealLoserCards = pendingReveal
      ? (pendingReveal.postState.players.find(p=>p.id===pendingReveal.reveal.loserId)?.cards || null)
      : null;
    // Only prompt to choose if the human is the loser
    const humanIsLoser = pendingReveal?.reveal?.loserId === playerId;

    // Render action panel (right column)
    function renderActionPanel() {
      if (pendingReveal) return null;

      if (pa) return (
        <div className="resp-banner">
          <div className="resp-banner-title">⚔️ Action Declared</div>
          <div className="resp-claim">{gs.lastEvent}</div>
          {myPending && (
            <>
              <div className="pb-q">How do you respond?</div>
              <div className="resp-row">
                <button className="btn btn-gh btn-sm" onClick={()=>doResponse("pass")}>✋ Pass — allow it</button>
                {pa.claimedCard && (
                  <button className="btn btn-r btn-sm" onClick={()=>doResponse("challenge")} title="If they don't hold the claimed card, they lose a card. If they DO hold it, YOU lose a card.">
                    🎯 Challenge — Call the Bluff
                  </button>
                )}
                {pa.type==="gift"&&<><div style={{width:"100%",fontSize:12,color:"var(--text-3)",fontFamily:"Cinzel,serif",letterSpacing:".1em",textTransform:"uppercase",marginTop:4,marginBottom:2}}>— Counter Actions —</div>{(()=>{const h=me.cards.includes("pazhuvettarayar");return(<button className="btn btn-dk btn-sm" onClick={()=>doResponse("block:pazhuvettarayar")} style={h?{borderColor:"var(--green-l)"}:{borderColor:"#EF5350",opacity:.85}}>{h?"🛡 COUNTER: Block — Pazhuvettarayar (you hold it ✅)":"🛡 COUNTER BLUFF: Block — Pazhuvettarayar (you don't hold it ⚠️)"}</button>);})()}</>}
                {pa.type==="steal"&&pa.targetId===playerId&&<>
                  <div style={{width:"100%",fontSize:12,color:"var(--text-3)",fontFamily:"Cinzel,serif",letterSpacing:".1em",textTransform:"uppercase",marginTop:4,marginBottom:2}}>— Counter Actions (you are being stolen from) —</div>
                  {(()=>{const h=me.cards.includes("nandini");return(<button className="btn btn-dk btn-sm" onClick={()=>doResponse("block:nandini")} style={h?{borderColor:"var(--green-l)"}:{borderColor:"#EF5350",opacity:.85}}>{h?"🛡 COUNTER: Block — Nandini (you hold it ✅)":"🛡 COUNTER BLUFF: Block — Nandini (you don't hold it ⚠️)"}</button>);})()}
                  {(()=>{const h=me.cards.includes("kundavai");return(<button className="btn btn-dk btn-sm" onClick={()=>doResponse("block:kundavai")} style={h?{borderColor:"var(--green-l)"}:{borderColor:"#EF5350",opacity:.85}}>{h?"🛡 COUNTER: Block — Kundavai (you hold it ✅)":"🛡 COUNTER BLUFF: Block — Kundavai (you don't hold it ⚠️)"}</button>);})()}
                </>}
                {pa.type==="assassinate"&&pa.targetId===playerId&&<>
                  <div style={{width:"100%",fontSize:12,color:"#FF9898",fontFamily:"Cinzel,serif",letterSpacing:".1em",textTransform:"uppercase",marginTop:4,marginBottom:2}}>— ⚠️ You are being assassinated! Counter Actions: —</div>
                  {(()=>{const h=me.cards.includes("aazhwarkadiyan");return(<button className="btn btn-dk btn-sm" onClick={()=>doResponse("block:aazhwarkadiyan")} style={h?{borderColor:"var(--green-l)"}:{borderColor:"#EF5350",opacity:.85}}>{h?"🛡 COUNTER: Block — Aazhwarkadiyan (you hold it ✅)":"🛡 COUNTER BLUFF: Block — Aazhwarkadiyan (you don't hold it ⚠️)"}</button>);})()}
                  {(()=>{const h=me.cards.includes("poonkuzhali");return(<button className="btn btn-dk btn-sm" onClick={()=>doResponse("block:poonkuzhali")} style={h?{borderColor:"var(--green-l)"}:{borderColor:"#EF5350",opacity:.85}}>{h?"🛡 COUNTER: Block — Poonkuzhali (you hold it ✅)":"🛡 COUNTER BLUFF: Block — Poonkuzhali (you don't hold it ⚠️)"}</button>);})()}
                </>}
              </div>
            </>
          )}
          {!myPending&&pa.actorId===playerId&&<div className="tc ti mt8" style={{fontSize:14,color:"var(--gold)"}}>Pending — {(gs.pendingResponse||[]).length} player(s) yet to respond</div>}
          {!myPending&&pa.actorId!==playerId&&<div className="tc ti mt8" style={{fontSize:14,color:"var(--text-2)"}}>Waiting… {(gs.pendingResponse||[]).length} remaining</div>}
        </div>
      );

      if (!isMyTurn) return (
        <div className="aa tc">
          <div className="wait-msg">Waiting for <span style={{color:"var(--gold)"}}>{ap?.name}</span> to take their turn…</div>
          <div className="spin" style={{width:24,height:24,margin:"14px auto 0"}}/>
        </div>
      );

      // My turn — action panel
      return (
        <div className="aa">
          {compulsory && (
            <div className="mb16" style={{background:"rgba(140,72,0,.22)",border:"1.5px solid rgba(200,120,0,.45)",borderRadius:8,padding:"13px 16px",fontSize:15,color:"#FFD080"}}>
              ⚠ You have {me.coins} coins — you <b>MUST</b> Coup!
            </div>
          )}
          {!compulsory && (
            <div className="tabs">
              <div className={`tab${tab==="bluff"?" on":""}`} onClick={()=>{setTab("bluff");resetAction();}}>🎭 Bluff Actions</div>
              <div className={`tab${tab==="common"?" on":""}`} onClick={()=>{setTab("common");resetAction();}}>🪙 Common</div>
              <div className={`tab${tab==="ref"?" on":""}`} onClick={()=>{setTab("ref");resetAction();}}>📜 Guide</div>
            </div>
          )}

          {/* Target step */}
          {actionStep && actionStep !== "guess" && renderTargets(actionStep, bluffClaim)}
          {actionStep === "guess" && !guessTarget && (
            <div className="tsec">
              <div className="tsec-title">🗺️ Who do you want to gamble on?</div>
              <div className="tgrid">
                {aliveOthers.map(p=><button key={p.id} className="tb" onClick={()=>setGuessTarget(p.id)}><div className="tb-name">{p.name}</div><div className="tb-info">🪙{p.coins} · {p.cards.length} card(s)</div></button>)}
              </div>
              <div className="mt12"><button className="btn btn-gh btn-sm" onClick={resetAction}>← Cancel</button></div>
            </div>
          )}
          {actionStep === "guess" && guessTarget && (
            <div className="tsec">
              <div className="tsec-title">🗺️ Which card do you think they hold?</div>
              <div className="tgrid">
                {CHAR_KEYS.map(k=>(
                  <button key={k} className="tb" onClick={()=>{doAction({type:"guess",targetId:guessTarget,guessedCard:k,claimedCard:bluffClaim||"vanthiyathevan"});setGuessTarget(null);}}>
                    <div className="tb-name">{CHARS[k].emoji} {CHARS[k].short}</div>
                    <div className="tb-info">{CHARS[k].role}</div>
                  </button>
                ))}
              </div>
              <div className="mt12"><button className="btn btn-gh btn-sm" onClick={resetAction}>← Cancel</button></div>
            </div>
          )}

          {!actionStep && (
            <>
              {compulsory && (
                <div className="ag">
                  <button className="ab danger-action" onClick={()=>setActionStep("coup")}>
                    <div className="ab-head"><span className="ab-icon">⚡</span><span className="ab-name">Compulsory Action</span></div>
                    <div className="ab-desc">Pay 10 coins. Force any player to lose one card. Unstoppable.</div>
                    <span className="badge b-orange">MANDATORY</span>
                  </button>
                </div>
              )}

              {!compulsory && tab === "bluff" && (
                <>
                  <div style={{background:"rgba(80,20,20,.18)",border:"1px solid rgba(139,26,26,.28)",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#FFAAAA",marginBottom:14,lineHeight:1.55}}>
                    ⚠ <b>Bluff actions</b> claim a character you may not hold. ✅ = you actually hold it — safe. 🎭 = bluff risk!
                  </div>
                  <div className="ag">
                    {CHAR_KEYS.filter(k => CHARS[k].actionType).map(k => {
                      const ch = CHARS[k];
                      const iHave = me.cards.includes(k);
                      const cost = ch.actionType === "assassinate" ? 4 : 0;
                      const cantAfford = cost > 0 && me.coins < cost;
                      const needsTgt = NEEDS_TARGET.has(ch.actionType);
                      const noTgt = needsTgt && (ch.actionType==="traitor_swap" ? aliveOthers.filter(p=>p.cards.length>=2).length===0 : aliveOthers.length===0);
                      return (
                        <button key={k} className={`ab ${iHave?"real-action":"bluff-action"}`} disabled={cantAfford||noTgt}
                          onClick={()=>{
                            setBluffClaim(k);
                            if(!needsTgt) doAction({type:ch.actionType,claimedCard:k});
                            else if(ch.actionType==="guess"){setActionStep("guess");}
                            else{setActionStep(ch.actionType==="traitor_swap"?"traitor_swap":ch.actionType);}
                          }}>
                          <div className="ab-head"><span className="ab-icon">{ch.emoji}</span><span className="ab-name">{ch.short}</span></div>
                          <div className="ab-desc">{ch.action}</div>
                          {cost>0&&<div className="ab-cost">Costs {cost} coins{cantAfford?` (need ${cost-me.coins} more)`:""}</div>}
                          {iHave
                            ? <span className="badge b-real">✅ SAFE — you hold {CHARS[k].short}</span>
                            : <span className="badge b-red">⚠️ BLUFF — you do NOT hold {CHARS[k].short}. If challenged, you LOSE a card!</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {!compulsory && tab === "common" && (
                <>
                  <div className="sec-lbl">Common Actions — no character required</div>
                  <div className="ag">
                    <button className="ab safe-action" onClick={()=>doAction({type:"income"})}>
                      <div className="ab-head"><span className="ab-icon">🪙</span><span className="ab-name">Income</span></div>
                      <div className="ab-desc">Take 1 coin from the Treasury.</div>
                      <span className="badge b-green">Safe — cannot be blocked or challenged</span>
                    </button>
                    <button className="ab safe-action" onClick={()=>doAction({type:"gift",claimedCard:null})}>
                      <div className="ab-head"><span className="ab-icon">🎁</span><span className="ab-name">Gift</span></div>
                      <div className="ab-desc">Take 2 coins from the Treasury.</div>
                      <span className="badge b-blue">Blockable by Pazhuvettarayar</span>
                    </button>
                    {me.cards.length===1&&(
                      <button className="ab safe-action" disabled={me.coins<8} onClick={()=>doAction({type:"draw_card"})}>
                        <div className="ab-head"><span className="ab-icon">📜</span><span className="ab-name">Draw Card</span></div>
                        <div className="ab-desc">Pay 8 coins and draw a replacement card.</div>
                        <div className="ab-cost">Costs 8 coins{me.coins<8?` (need ${8-me.coins} more)`:""}</div>
                      </button>
                    )}
                  </div>
                </>
              )}

              {!compulsory && tab === "ref" && (
                <div className="ref-grid">
                  {CHAR_KEYS.map(k=>{
                    const ch=CHARS[k];
                    return(
                      <div key={k} className="ref-card">
                        <div className="ref-head">
                          <span style={{fontSize:20}}>{ch.emoji}</span>
                          <div><div className="ref-cname">{ch.short}</div><div className="ref-crole">{ch.role} · ×{ch.count}</div></div>
                        </div>
                        <div className="ref-body">
                          {ch.action&&<div className="ref-al">⚡ {ch.action}</div>}
                          {ch.counter&&<div className="ref-cl">🛡 {ch.counter}</div>}
                          {!ch.action&&!ch.counter&&<div style={{color:"var(--text-3)",fontStyle:"italic"}}>Block only</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    return (
      <div className="board">

        {/* Modals */}
        {pendingReveal && (
          <ChallengeRevealModal
            reveal={pendingReveal.reveal}
            iCalledBluff={pendingReveal.iCalledBluff}
            loserCards={humanIsLoser ? revealLoserCards : null}
            onConfirm={onRevealConfirm}
          />
        )}
        {gs.spyReveal && gs.spyReveal.viewerId===playerId && !pendingReveal && (
          <div className="overlay">
            <div className="spy-box">
              <div style={{fontFamily:"Cinzel,serif",fontSize:16,color:"var(--gold)",marginBottom:12}}>🔍 Spy Report</div>
              <div style={{fontSize:15,color:"var(--text-2)"}}>You viewed <b style={{color:"var(--gold)"}}>{gs.players.find(p=>p.id===gs.spyReveal.targetId)?.name}</b>'s card:</div>
              <div style={{fontSize:58,margin:"16px 0"}}>{CHARS[gs.spyReveal.card]?.emoji}</div>
              <div style={{fontFamily:"Cinzel,serif",fontSize:18,color:"var(--text)"}}>{CHARS[gs.spyReveal.card]?.name}</div>
              <div style={{fontSize:14,color:"var(--text-2)",fontStyle:"italic",marginTop:4}}>{CHARS[gs.spyReveal.card]?.role}</div>
              <div style={{fontSize:13,color:"var(--text-3)",fontStyle:"italic",marginTop:12}}>Their card has been replaced from the deck.</div>
              <button className="btn btn-g mt16" onClick={()=>setGs({...gs,spyReveal:null})}>Continue ⚔️</button>
            </div>
          </div>
        )}

        {/* TOP — Opponents + Status */}
        <div>
          <div className="opp-grid" style={{marginBottom:12}}>
            {gs.players.filter(p=>p.id!==playerId).map(p=>{
              const alive=p.alive!==false;
              const isThreat = alive && p.coins >= 8;
              let cls="opp";
              if(!alive) cls+=" eliminated";
              else if(ap?.id===p.id) cls+=" active-turn";
              if(p.isBot) cls+=" bot";
              if(isThreat&&alive) cls+=" is-threat";
              return(
                <div key={p.id} className={cls}>
                  <div className="opp-name">
                    <span className="opp-name-txt">{p.name}</span>
                    {ap?.id===p.id&&alive&&<span className="tag tag-turn">TURN</span>}
                    {!alive&&<span className="tag tag-out">OUT</span>}
                    {isThreat&&<span className="tag" style={{background:"rgba(239,83,80,.22)",color:"#FF9898",fontSize:9}}>DANGER</span>}
                  </div>
                  <div className="coin-row">
                    <span style={{fontSize:14,color:"var(--gold)"}}>🪙 {p.coins}</span>
                    <div className="coin-pips">{Array.from({length:Math.min(p.coins,10)}).map((_,i)=><div key={i} className="coin-pip"/>)}</div>
                  </div>
                  <div className="opp-cards">
                    {p.cards.map((_,i)=><div key={i} className="small-card">🀫<div className="small-card-lbl">?</div></div>)}
                    {(p.lost||[]).map((ck,i)=>{
                      const lch=CHARS[ck];
                      return(
                        <div key={"l"+i} className="small-card gone" style={{borderColor:lch?.color+"44",background:`${lch?.color}20`,flexDirection:"column",fontSize:13}}>
                          <span>{lch?.emoji}</span>
                          <span className="small-card-lbl" style={{color:lch?.color||"var(--text-2)"}}>{lch?.short}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="status-bar" style={{marginBottom:10}}>
            <span className="status-l">🏛️ Chola Court</span>
            <span className="status-c">⚔️ {ap?.name}'s Turn</span>
            <span className="status-r">📜 Deck: {gs.deck.length}</span>
          </div>
          <div className="ticker">{displayedEvent}</div>
          {/* Turn Timer */}
          {gs.phase==="playing" && !pendingReveal && (()=>{
            const urgent = turnTimer <= 10;
            const radius = 15;
            const circ = 2 * Math.PI * radius;
            const offset = circ * (1 - turnTimer/30);
            const strokeColor = turnTimer > 15 ? "var(--green-l)" : turnTimer > 8 ? "var(--gold)" : "#EF5350";
            const isHumanAct = isMyTurn && !pa;
            const isHumanResp = myPending;
            const needsAction = isHumanAct || isHumanResp;
            return(
              <div className={`turn-timer${urgent?" border-urgent":""}`} style={{marginBottom:10,borderColor:urgent?"#EF5350":undefined}}>
                <div className="timer-ring">
                  <svg width="38" height="38" viewBox="0 0 38 38">
                    <circle className="timer-ring-bg" cx="19" cy="19" r={radius}/>
                    <circle className="timer-ring-fill" cx="19" cy="19" r={radius}
                      stroke={strokeColor}
                      strokeDasharray={circ}
                      strokeDashoffset={offset}/>
                  </svg>
                  <div className="timer-num" style={{color:strokeColor}}>{turnTimer}</div>
                </div>
                <div className={`timer-label${urgent?" urgent":""}`}>
                  {needsAction
                    ? <><b>{isHumanAct?"Your turn":"Respond now"}</b> — {turnTimer}s left{urgent?" ⚠️ Auto-Income soon!":""}</>
                    : <><b>{ap?.name}</b> has {turnTimer}s to act</>
                  }
                </div>
              </div>
            );
          })()}
        </div>

        {/* MAIN — 2-column: Left=MyHand, Right=Actions */}
        <div className="game-main">
          <div className="game-left">
            <MyHand
              player={me}
              canAct={isMyTurn && !pa && !pendingReveal && !compulsory}
              onUseCard={handleCardUse}
            />
            {/* Fallen cards in left sidebar */}
            {Object.keys(lostCards).length>0&&(
              <div className="panel" style={{padding:"10px 14px"}}>
                <div style={{fontFamily:"Cinzel,serif",fontSize:11,letterSpacing:".18em",color:"var(--gold-d)",textTransform:"uppercase",textAlign:"center",marginBottom:8}}>⚰ Fallen Cards</div>
                <div className="fallen-row">
                  {Object.entries(lostCards).map(([k,n])=>(
                    <div key={k} className="fallen-item">
                      <span style={{fontSize:14}}>{CHARS[k]?.emoji}</span>
                      <span className="fallen-name">{CHARS[k]?.short}</span>
                      <span className="fallen-cnt">×{n}/{CHARS[k]?.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="game-right">
            {renderActionPanel()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div id="root">
        <div className="hdr">
          <div className="hdr-title">Ponniyin Selvan</div>
          <div className="hdr-sub">⚜ The Card Game of the Chola Dynasty ⚜</div>
        </div>
        {screen==="home"     && renderHome()}
        {screen==="sp_setup" && renderSPSetup()}
        {screen==="mp_setup" && renderMPSetup()}
        {screen==="mp_lobby" && renderMPLobby()}
        {screen==="tutorial" && renderTutorial()}
        {screen==="game"     && renderGame()}
        {screen==="game" && <button className="help-btn" onClick={()=>{setPrevScreen("game");setTutStep(0);setScreen("tutorial");}} title="Help & Tutorial">?</button>}
      </div>
    </>
  );
}
