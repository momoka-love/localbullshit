// client.js
// Firebase config + init (keep your existing config)
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

// ---- Game variables ----
const suits = ['♠','♥','♦','♣'];
const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

let playerName = "", lobbyName = "", lobbyRef = null;
let playerHand = [], pile = [], currentTurn = "", joined = false;
let selectedCards = new Set();
let lobbyUnsub = null;
let chatRef = null;
let chatUnsub = null;

// ---- Utils ----
function randomCard() {
  return ranks[Math.floor(Math.random()*ranks.length)] + suits[Math.floor(Math.random()*suits.length)];
}

function normalizeRank(r) {
  if (!r) return null;
  return r.toString().trim().toUpperCase();
}

// Robust getNextRank: returns null when unknown/no last rank
function getNextRank(lastRank) {
  if (!lastRank) return null; // no previous rank -> no enforced next
  lastRank = normalizeRank(lastRank);
  const idx = ranks.indexOf(lastRank);
  if (idx === -1) return null; // unknown rank -> treat as "no enforced next"
  return ranks[(idx + 1) % ranks.length];
}

// escape text nodes for chat/pile output (simple)
function escapeText(text) {
  return document.createTextNode(text == null ? '' : text);
}

// ---- Visual Bullshit banner ----
function showBullshitBanner(msg){
  const banner = document.getElementById('bs-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
  setTimeout(()=>{ banner.style.display='none'; }, 2000);
}

// ---- Sanitize pile (one-time db transaction to normalize declared ranks) ----
async function sanitizePileOnce() {
  if(!lobbyRef) return;
  try {
    await lobbyRef.child('pile').transaction(pileArr => {
      if (!pileArr) return pileArr;
      return pileArr.map(p => {
        const cardRank = p && p.card ? p.card.slice(0, -1) : null;
        const declaredRaw = p && p.declared ? p.declared : cardRank;
        const declared = normalizeRank(declaredRaw) || cardRank;
        return {
          card: p.card,
          declared: declared,
          player: p.player
        };
      });
    });
  } catch (e) {
    console.warn("sanitizePileOnce failed:", e);
  }
}

// ---- Join Lobby ----
async function joinLobby(){
  playerName = document.getElementById('player-name').value.trim();
  lobbyName = document.getElementById('lobby-name').value.trim();
  if(!playerName || !lobbyName){ alert("Enter name and lobby"); return; }

  lobbyRef = db.ref('lobbies/'+lobbyName);

  try{
    await lobbyRef.transaction(game=>{
      if(!game) game = {players:{}, pile:[], currentTurn:playerName, winner:null};
      game.players = game.players || {};
      if(!game.players[playerName]) game.players[playerName] = Array.from({length:5},()=>randomCard());
      playerHand = game.players[playerName].slice();
      game.currentTurn = game.currentTurn || playerName;
      return game;
    });

    // sanitize existing pile entries (safe to call; if already normalized it's fine)
    await sanitizePileOnce();

    joined = true;
    document.getElementById('lobby-container').style.display = 'none';
    document.getElementById('game-container-wrapper').style.display = 'block';

    // Unsubscribe previous listeners if any
    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    lobbyUnsub = lobbyRef.on('value', snapshot=>{
      const game = snapshot.val() || {};
      pile = game.pile || [];
      currentTurn = game.currentTurn || "";
      if(game.players && game.players[playerName]) playerHand = game.players[playerName].slice();
      updateUI(game.players || {}, game.winner || null);
      if(game.winner) showBullshitBanner(`${game.winner} wins!`);
    });

    // Setup chat ref and listener (child_added for incremental updates)
    chatRef = lobbyRef.child('chat');
    if(chatUnsub) chatRef.off('child_added', chatUnsub);
    chatUnsub = chatRef.on('child_added', snapshot => {
      const msg = snapshot.val();
      appendChatMessage(msg);
    });

    // Load existing chat (initial load) - optional: clear and re-add
    chatRef.once('value', snap => {
      const data = snap.val() || {};
      const msgs = Object.values(data);
      // clear and render all
      const container = document.getElementById('chat-container');
      container.innerHTML = '';
      msgs.forEach(m => appendChatMessage(m));
    });

    // enable/disable chat input
    updateChatControls();

  }catch(err){ console.error(err); alert("Failed to join: "+err.message);}
}

// ---- Toggle Card ----
function toggleCard(idx){ 
  if(selectedCards.has(idx)) selectedCards.delete(idx); 
  else selectedCards.add(idx); 
  updateUI(); 
}

// ---- Play Selected ----
async function playSelected(){
  if(!joined || selectedCards.size === 0 || currentTurn !== playerName) return;

  const indices = [...selectedCards].sort((a,b)=>a-b);
  const cardsPreview = indices.map(i => playerHand[i]);

  // Determine required declared rank (robust)
  const lastPileItem = pile.length ? pile[pile.length - 1] : null;

  let lastDeclaredRaw = null;
  if (lastPileItem) {
    // prefer explicit declared field, but fall back to extracting rank from the card
    lastDeclaredRaw = lastPileItem.declared || (lastPileItem.card && lastPileItem.card.slice(0, -1));
  }

  let lastDeclared = lastDeclaredRaw ? normalizeRank(lastDeclaredRaw) : null;
  if (lastDeclared && !ranks.includes(lastDeclared)) {
    console.warn("Invalid lastDeclared read from pile:", lastDeclaredRaw, "-> treating as none");
    lastDeclared = null;
  }

  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;

  // Prompt player
  let declared = prompt(
    requiredDeclared 
      ? `You must declare the next rank: ${requiredDeclared}` 
      : `Declare any rank to start the sequence`,
    requiredDeclared || cardsPreview[0].slice(0,-1)
  );
  if(!declared) return;
  declared = normalizeRank(declared);

  // Validate input
  if(!ranks.includes(declared)){
    alert("Invalid rank! Use 2-10, J, Q, K, A");
    return;
  }

  // Enforce sequence only if requiredDeclared exists (not first move)
  if(requiredDeclared && declared !== requiredDeclared){
    alert(`You must declare the next rank: ${requiredDeclared}`);
    return;
  }

  // Firebase transaction
  await lobbyRef.transaction(game=>{
    if(!game) return game;
    if(game.currentTurn !== playerName) return game;

    const hand = (game.players && game.players[playerName]) ? game.players[playerName].slice() : [];
    if(indices.some(i=>i<0 || i>=hand.length)) return game;

    const played = indices.map(i => hand[i]);
    game.players[playerName] = hand.filter((_,i)=>!indices.includes(i));

    // ensure pile array exists
    game.pile = game.pile || [];
    played.forEach(c => game.pile.push({card:c, declared, player:playerName}));

    if(game.players[playerName].length === 0) game.winner = playerName;

    const allPlayers = Object.keys(game.players).sort();
    if(allPlayers.length > 0){
      let idx = allPlayers.indexOf(game.currentTurn);
      if(idx === -1) idx = 0;
      game.currentTurn = allPlayers[(idx+1) % allPlayers.length];
    } else game.currentTurn = null;

    return game;
  });

  selectedCards.clear();
}

// ---- Draw Card ----
async function drawCard(){
  if(!joined || currentTurn !== playerName) return;
  const newCard = randomCard();
  await lobbyRef.child('players').child(playerName).transaction(hand => { 
    hand = hand || []; 
    hand.push(newCard); 
    return hand; 
  });
}

// ---- Call Bullshit ----
async function callBS(){
  if(!joined || pile.length === 0) return;
  await lobbyRef.transaction(game=>{
    if(!game || !game.pile) return game;
    const last = game.pile[game.pile.length-1];
    const pileCards = game.pile.map(p => p.card);
    game.players = game.players || {};
    // check truth: compare last.card's rank to last.declared
    const lastCardRank = last.card ? last.card.slice(0,-1).toUpperCase().trim() : null;
    const declaredRank = last.declared ? last.declared.toString().trim().toUpperCase() : null;

    if(lastCardRank === declaredRank) {
      // caller (playerName) is wrong; they take pile
      game.players[playerName] = (game.players[playerName]||[]).concat(pileCards);
    } else {
      // last player lied; they take pile
      game.players[last.player] = (game.players[last.player]||[]).concat(pileCards);
    }

    game.pile = [];
    game.currentTurn = playerName;
    return game;
  });
  showBullshitBanner("bullshit!");
}

// ---- Leave Lobby ----
async function leaveLobby(){
  if(!joined) return;
  // remove player from players list
  await lobbyRef.child('players').child(playerName).remove();
  // remove local listeners
  if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
  if(chatUnsub && chatRef) chatRef.off('child_added', chatUnsub);
  joined = false;
  playerName = ""; lobbyName = ""; playerHand = []; pile = []; currentTurn = "";
  document.getElementById('game-container-wrapper').style.display = 'none';
  document.getElementById('lobby-container').style.display = 'block';
  updateChatControls();
}

// ---- Chat send ----
async function sendChatMessage(){
  if(!joined || !chatRef) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if(!text) return;
  const msg = {
    from: playerName,
    text: text,
    ts: Date.now()
  };
  // push message
  await chatRef.push(msg);
  input.value = '';
const chatRef = () => lobbyRef ? lobbyRef.child('chat') : null;

function addChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${msg.player}:</strong> ${msg.text}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Listen for chat updates
function initChat() {
  if(!lobbyRef) return;
  const ref = chatRef();
  ref.on('child_added', snapshot => {
    const msg = snapshot.val();
    addChatMessage(msg);
  });
}

// Send a message
function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if(!text || !lobbyRef) return;
  const ref = chatRef();
  ref.push({ player: playerName, text });
  input.value = '';
}

document.getElementById('chat-send').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keydown', e => {
  if(e.key === 'Enter') sendMessage();
});

// Call initChat after joining lobby
// Inside joinLobby(), after your lobbyUnsub setup:
initChat();

}

// ---- Append chat message to UI ----
function appendChatMessage(msg){
  const container = document.getElementById('chat-container');
  if(!container) return;

  const line = document.createElement('div');
  line.className = 'chat-line';

  const who = document.createElement('span');
  who.className = 'chat-from';
  who.appendChild(escapeText((msg.from || '')));

  const body = document.createElement('span');
  body.className = 'chat-body';
  body.appendChild(escapeText(': ' + (msg.text || '')));

  const t = document.createElement('span');
  t.className = 'chat-ts';
  const dt = msg.ts ? new Date(msg.ts) : new Date();
  t.appendChild(escapeText(' (' + dt.toLocaleTimeString() + ')'));

  line.appendChild(who);
  line.appendChild(body);
  line.appendChild(t);

  container.appendChild(line);
  // optional: scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// enable/disable chat controls based on joined state
function updateChatControls(){
  const btn = document.getElementById('btn-send-chat');
  const input = document.getElementById('chat-input');
  if(!btn || !input) return;
  btn.disabled = !joined;
  input.disabled = !joined;
}

// ---- Update UI ----
function updateUI(players={}, winner=null){
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  playerHand.forEach((c,i)=>{
    const div = document.createElement('div');
    div.textContent = c; 
    div.className = 'card';
    if(selectedCards.has(i)) div.classList.add('selected');
    div.onclick = () => toggleCard(i);
    container.appendChild(div);
  });

  const pileContainer = document.getElementById('pile-container');
  pileContainer.innerHTML = '';
  pile.forEach(p=>{
    const div = document.createElement('div');
    // show detailed info for your own plays, otherwise show declared by player
    if(p.player===playerName) {
      div.textContent = `${p.card} (${p.declared})`;
    } else {
      div.textContent = `${p.declared} (by ${p.player})`;
    }
    div.className='pile-card';
    pileContainer.appendChild(div);
  });

  const list = document.getElementById('players-list');
  list.innerHTML = '';
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
  updateChatControls();
}

// ---- Event listeners ----
document.getElementById('btn-join').onclick = joinLobby;
document.getElementById('btn-play').onclick = playSelected;
document.getElementById('btn-draw').onclick = drawCard;
document.getElementById('btn-bullshit').onclick = callBS;
document.getElementById('btn-leave').onclick = leaveLobby;

// Chat listeners
const sendBtn = document.getElementById('btn-send-chat');
if(sendBtn) sendBtn.onclick = sendChatMessage;
const chatInput = document.getElementById('chat-input');
if(chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') sendChatMessage();
  });
}

// Initialize UI state on load
updateUI();
updateChatControls();

