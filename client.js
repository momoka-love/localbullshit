// client.js
// Firebase config + init
const firebaseConfig = {
  apiKey: "AIzaSyDuRUwCmQCoSJTMvwqaY4Hj-SPv4WCHWpQ",
  authDomain: "bullshit-f4f8e.firebaseapp.com",
  databaseURL: "https://bullshit-f4f8e-default-rtdb.firebaseio.com",
  projectId: "bullshit-f4f8e",
  storageBucket: "bullshit-f4f8e.appspot.com",
  messagingSenderId: "497908378251",
  appId: "1:497908378251:web:8f93b8a4d1d27539b2c28e"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- Game variables ---
const suits = ['♠','♥','♦','♣'];
const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

let playerName = "", lobbyName = "", lobbyRef = null;
let playerHand = [], pile = [], currentTurn = "", joined = false;
let selectedCards = new Set();
let lobbyUnsub = null;
let chatRef = null;
let chatUnsub = null;

// --- Utils ---
function randomCard() { return ranks[Math.floor(Math.random()*ranks.length)] + suits[Math.floor(Math.random()*suits.length)]; }
function normalizeRank(r) { return r ? r.toString().trim().toUpperCase() : null; }
function getNextRank(lastRank) {
  if(!lastRank) return null;
  lastRank = normalizeRank(lastRank);
  const idx = ranks.indexOf(lastRank);
  if(idx===-1) return null;
  return ranks[(idx+1)%ranks.length];
}
function escapeText(text) { return document.createTextNode(text == null ? '' : text); }
function showBullshitBanner(msg){
  const banner = document.getElementById('bs-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
  setTimeout(()=>{ banner.style.display='none'; }, 2000);
}

// --- Join Lobby ---
async function joinLobby(){
  playerName = document.getElementById('player-name').value.trim();
  lobbyName = document.getElementById('lobby-name').value.trim();
  if(!playerName || !lobbyName){ alert("Enter name and lobby"); return; }

  lobbyRef = db.ref('lobbies/'+lobbyName);

  try{
    await lobbyRef.transaction(game=>{
      if(!game) game={players:{}, pile:[], currentTurn:playerName, winner:null};
      game.players = game.players||{};
      if(!game.players[playerName]) game.players[playerName] = Array.from({length:5},()=>randomCard());
      playerHand = game.players[playerName].slice();
      game.currentTurn = game.currentTurn || playerName;
      return game;
    });

    joined = true;
    document.getElementById('lobby-container').style.display='none';
    document.getElementById('game-container-wrapper').style.display='block';

    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    lobbyUnsub = lobbyRef.on('value', snapshot=>{
      const game = snapshot.val()||{};
      pile = game.pile||[];
      currentTurn = game.currentTurn||"";
      if(game.players && game.players[playerName]) playerHand = game.players[playerName].slice();
      updateUI(game.players||{}, game.winner||null);
      if(game.winner) showBullshitBanner(`${game.winner} wins!`);
    });

    chatRef = lobbyRef.child('chat');
    if(chatUnsub) chatRef.off('child_added', chatUnsub);
    chatUnsub = chatRef.on('child_added', snapshot=>{
      appendChatMessage(snapshot.val());
    });

  }catch(err){ console.error(err); alert("Failed to join: "+err.message);}
}

// --- Toggle card selection ---
function toggleCard(idx){
  if(selectedCards.has(idx)) selectedCards.delete(idx);
  else selectedCards.add(idx);
  updateUI();
}

// --- Play selected cards ---
async function playSelected() {
  if(!joined || selectedCards.size===0 || currentTurn!==playerName) return;

  const lastPileItem = pile.length ? pile[pile.length-1] : null;
  const requiredDeclared = lastPileItem?.declared ? getNextRank(lastPileItem.declared) : null;

  let declared = prompt(
    requiredDeclared ? `Declare next rank: ${requiredDeclared}` : `Declare any rank`,
    requiredDeclared || playerHand[[...selectedCards][0]].slice(0,-1)
  );
  if(!declared) return;
  declared = declared.toUpperCase();
  if(requiredDeclared && declared!==requiredDeclared){
    alert(`You must declare the next rank: ${requiredDeclared}`);
    return;
  }

  const indices = [...selectedCards].sort((a,b)=>b-a); // descending
  const played = [];
  const newHand = [...playerHand];

  for(const i of indices){
    if(i>=0 && i<newHand.length){
      played.push(newHand[i]);
      newHand.splice(i,1);
    }
  }

  // Optimistic update
  playerHand = newHand;
  pile = [...pile, ...played.map(c => ({card:c, declared, player:playerName}))];
  selectedCards.clear();

  updateUI({[playerName]: newHand}, null);

  // Firebase update
  await lobbyRef.transaction(game=>{
    if(!game || !game.players || game.currentTurn!==playerName) return game;

    game.players[playerName] = newHand;
    game.pile = game.pile || [];
    played.forEach(c => game.pile.push({card:c, declared, player:playerName}));

    if(newHand.length === 0) game.winner = playerName;

    const allPlayers = Object.keys(game.players);
    const idx = allPlayers.indexOf(playerName);
    game.currentTurn = allPlayers[(idx+1) % allPlayers.length];

    return game;
  });
}

// --- Draw a card ---
async function drawCard() {
  if(!joined || currentTurn!==playerName) return;
  const newCard = randomCard();
  playerHand.push(newCard); // optimistic
  updateUI({[playerName]: playerHand}, null);

  await lobbyRef.child('players').child(playerName).transaction(hand=>{
    hand = hand||[];
    hand.push(newCard);
    return hand;
  });
}

// --- Call Bullshit ---
async function callBS() {
  if(!joined || pile.length===0) return;
  const pileCards = pile.map(p=>p.card);
  const last = pile[pile.length-1];

  // Determine who takes pile
  const lastCardRank = last.card.slice(0,-1).toUpperCase();
  const declaredRank = last.declared.toUpperCase();
  const liar = lastCardRank !== declaredRank ? last.player : playerName;

  // Optimistic update
  if(!gamePlayers) gamePlayers = {};
  if(!gamePlayers[liar]) gamePlayers[liar] = [];
  gamePlayers[liar] = (gamePlayers[liar]||[]).concat(pileCards);
  pile = [];
  updateUI(gamePlayers, null);
  showBullshitBanner("bullshit!");

  await lobbyRef.transaction(game=>{
    if(!game || !game.pile || !game.players) return game;

    game.players = game.players || {};
    game.players[liar] = (game.players[liar]||[]).concat(pileCards);
    game.pile = [];
    game.currentTurn = playerName;

    return game;
  });
}

// --- Leave lobby ---
async function leaveLobby() {
  if(!joined) return;
  await lobbyRef.child('players').child(playerName).remove();
  if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
  if(chatUnsub && chatRef) chatRef.off('child_added', chatUnsub);

  joined = false;
  playerName = "";
  lobbyName = "";
  playerHand = [];
  pile = [];
  currentTurn = "";
  selectedCards.clear();

  document.getElementById('game-container-wrapper').style.display='none';
  document.getElementById('lobby-container').style.display='block';
  updateUI();
}

// --- Chat ---
async function sendChatMessage(){
  if(!joined || !chatRef) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if(!text) return;
  await chatRef.push({player:playerName, text, ts:Date.now()});
  input.value='';
}
function appendChatMessage(msg){
  const container = document.getElementById('chat-container');
  if(!container) return;
  const line = document.createElement('div');
  line.className='chat-message';
  line.textContent = `${msg.player}: ${msg.text}`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

// --- Update UI ---
function updateUI(players={}, winner=null){
  const container = document.getElementById('game-container');
  container.innerHTML='';
  playerHand.forEach((c,i)=>{
    const div = document.createElement('div');
    div.textContent=c;
    div.className='card';
    if(selectedCards.has(i)) div.classList.add('selected');
    div.onclick = ()=>toggleCard(i);
    container.appendChild(div);
  });

  const pileContainer = document.getElementById('pile-container');
  pileContainer.innerHTML='';
  pile.forEach(p=>{
    const div = document.createElement('div');
    div.textContent = (p.player===playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
    div.className='pile-card';
    pileContainer.appendChild(div);
  });

  const list = document.getElementById('players-list');
  list.innerHTML='';
  Object.entries(players).forEach(([name,hand])=>{
    const li = document.createElement('li');
    li.textContent = `${name} - ${hand.length} card${hand.length!==1?'s':''}`;
    if(name===currentTurn) li.style.fontWeight='bold';
    if(hand.length===0) li.style.textDecoration='underline';
    list.appendChild(li);
  });

  document.getElementById('game-info').textContent = `Current Turn: ${currentTurn}`;
  document.getElementById('btn-play').disabled = !joined || currentTurn!==playerName || winner;
  document.getElementById('btn-draw').disabled = !joined || currentTurn!==playerName || winner;
  document.getElementById('btn-bullshit').disabled = !joined || pile.length===0 || winner;
  const btn = document.getElementById('chat-send');
  const input = document.getElementById('chat-input');
  if(btn && input){ btn.disabled = !joined; input.disabled = !joined; }
}

// --- Event listeners ---
document.getElementById('btn-join').onclick = joinLobby;
document.getElementById('btn-play').onclick = playSelected;
document.getElementById('btn-draw').onclick = drawCard;
document.getElementById('btn-bullshit').onclick = callBS;
document.getElementById('btn-leave').onclick = leaveLobby;
document.getElementById('chat-send').onclick = sendChatMessage;
document.getElementById('chat-input').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatMessage(); });

// --- Initialize UI ---
updateUI();
