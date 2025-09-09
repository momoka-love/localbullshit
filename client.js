// ---- Firebase config ----
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

let playerName = "";
let lobbyName = "";
let lobbyRef = null;
let messagesRef = null;
let lobbyUnsub = null;
let chatUnsub = null;

let playerHand = [];
let pile = [];
let currentTurn = "";
let joined = false;
let selectedCards = new Set();

// ---- Utilities ----
function randomCard() {
  const r = ranks[Math.floor(Math.random() * ranks.length)];
  const s = suits[Math.floor(Math.random() * suits.length)];
  return r + s;
}

function getNextRank(lastRank) {
  if (!lastRank) return ranks[0];
  const idx = ranks.indexOf(lastRank);
  return ranks[(idx + 1) % ranks.length];
}

// ---- Join Lobby ----
async function joinLobby() {
  playerName = document.getElementById('player-name').value.trim();
  lobbyName = document.getElementById('lobby-name').value.trim();

  if (!playerName || !lobbyName) {
    alert("Enter both player name and lobby name!");
    return;
  }

  lobbyRef = db.ref('lobbies/' + lobbyName);
  messagesRef = lobbyRef.child('messages');

  try {
    console.log(`Joining lobby "${lobbyName}" as "${playerName}"`);

    // Transaction to initialize lobby safely and add player
    await lobbyRef.transaction(game => {
      if (!game) {
        game = {
          players: {},
          pile: [],
          currentTurn: playerName,
          winner: null,
          messages: {}
        };
      } else {
        game.players = game.players || {};
        game.pile = game.pile || [];
      }

      // Add player if not exist
      if (!game.players[playerName]) {
        playerHand = Array.from({ length: 5 }, () => randomCard());
        game.players[playerName] = playerHand.slice();
      } else {
        playerHand = game.players[playerName].slice();
      }

      game.currentTurn = game.currentTurn || playerName;
      return game;
    });

    joined = true;

    // Swap UI
    document.getElementById('lobby-container').style.display = 'none';
    document.getElementById('game-container-wrapper').style.display = 'block';

    // Remove old listeners if any
    if (lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if (chatUnsub) messagesRef.off('child_added', chatUnsub);

    // ---- Listen for game updates ----
    lobbyUnsub = lobbyRef.on('value', snapshot => {
      const game = snapshot.val() || {};
      pile = game.pile || [];
      currentTurn = game.currentTurn || "";
      if (game.players && game.players[playerName]) {
        playerHand = game.players[playerName].slice();
      }
      updateUI(game.players || {}, game.winner || null);
    });

    // ---- Listen for chat messages ----
    chatUnsub = messagesRef.on('child_added', snap => {
      const msg = snap.val();
      if (!msg) return;
      const chatMessages = document.getElementById('chat-messages');
      const div = document.createElement('div');
      const time = new Date(msg.timestamp).toLocaleTimeString();
      div.textContent = `[${time}] ${msg.player}: ${msg.text}`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      if (chatMessages.childNodes.length > 100) {
        chatMessages.removeChild(chatMessages.firstChild);
      }
    });

    console.log("Joined lobby successfully!");

  } catch (err) {
    console.error("Error joining lobby:", err);
    alert("Failed to join lobby: " + err.message);
  }
}

// ---- Play Selected Cards ----
async function playSelected() {
  if (!joined) return alert("Not in a lobby!");
  if (currentTurn !== playerName) return alert("Not your turn!");
  if (selectedCards.size === 0) return alert("Select cards first!");

  const cards = [...selectedCards].map(i => playerHand[i]);
  const lastDeclared = pile.length ? pile[pile.length-1].declared : null;
  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;

  let declaredRank = prompt(
    `Playing ${cards.length} card(s). Declare rank:` +
    (requiredDeclared ? ` (Must declare ${requiredDeclared})` : ""),
    requiredDeclared || cards[0].slice(0,-1)
  );

  declaredRank = (declaredRank || requiredDeclared || cards[0].slice(0,-1)).trim();

  if (requiredDeclared && declaredRank !== requiredDeclared) {
    return alert(`You must declare ${requiredDeclared}!`);
  }

  await lobbyRef.transaction(game => {
    if (!game) return; // fail-safe

    game.players = game.players || {};
    game.pile = game.pile || [];
    if (game.currentTurn !== playerName) return game;

    const hand = (game.players[playerName] || []).slice();
    const newHand = hand.filter((c,i)=>!selectedCards.has(i));

    cards.forEach(c => game.pile.push({ card: c, declared: declaredRank, player: playerName }));

    game.players[playerName] = newHand;
    if (newHand.length === 0) game.winner = playerName;

    const allPlayers = Object.keys(game.players);
    if (allPlayers.length > 0) {
      const idx = allPlayers.indexOf(game.currentTurn);
      game.currentTurn = allPlayers[(idx + 1) % allPlayers.length];
    }

    return game;
  });

  selectedCards.clear();
}

// ---- Draw Card ----
async function drawCard() {
  if (!joined) return;
  const newCard = randomCard();
  await lobbyRef.child('players').child(playerName).transaction(hand=>{
    hand = hand || [];
    hand.push(newCard);
    return hand;
  });
}

// ---- Call BS ----
async function callBS() {
  if (!joined || pile.length===0) return;
  await lobbyRef.transaction(game=>{
    if (!game || !game.pile) return game;

    const last = game.pile[game.pile.length-1];
    const realRank = last.card.slice(0,-1);
    const pileCards = game.pile.map(p=>p.card);

    game.players = game.players || {};
    if (realRank === last.declared) {
      game.players[playerName] = (game.players[playerName]||[]).concat(pileCards);
    } else {
      game.players[last.player] = (game.players[last.player]||[]).concat(pileCards);
    }

    game.pile = [];
    game.currentTurn = playerName;
    return game;
  });
}

// ---- Chat ----
function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !joined) return;
  messagesRef.push({ player: playerName, text, timestamp: Date.now() });
  input.value = '';
}
document.getElementById('chat-send').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keypress', e=>{
  if(e.key==='Enter') sendMessage();
});

// ---- Card Selection ----
function toggleCard(idx) {
  if (selectedCards.has(idx)) selectedCards.delete(idx);
  else selectedCards.add(idx);
  updateUI();
}

// ---- Update UI ----
function updateUI(playersObj={}, winner=null) {
  // Hand
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  playerHand.forEach((c,i)=>{
    const div = document.createElement('div');
    div.textContent = c;
    div.className = 'card';
    if(selectedCards.has(i)) div.classList.add('selected');
    div.onclick = ()=>toggleCard(i);
    container.appendChild(div);
  });

  // Pile
  const pileContainer = document.getElementById('pile-container');
  pileContainer.innerHTML = '';
  pile.forEach(p=>{
    const div = document.createElement('div');
    div.textContent = (p.player===playerName)?`${p.card} (${p.declared})`:`${p.declared} (by ${p.player})`;
    div.className='card';
    pileContainer.appendChild(div);
  });

  // Players list
  const list = document.getElementById('players-list');
  list.innerHTML='';
  Object.entries(playersObj).forEach(([name,hand])=>{
    const li=document.createElement('li');
    li.textContent = `${name} - ${hand.length} card${hand.length!==1?'s':''}`;
    if(name===currentTurn) li.style.fontWeight='bold';
    if(hand.length===0) li.style.textDecoration='underline';
    list.appendChild(li);
  });

  document.getElementById('game-info').textContent = `Current Turn: ${currentTurn}`;

  // Buttons
  document.getElementById('btn-play').disabled = !joined || currentTurn!==playerName || winner;
  document.getElementById('btn-draw').disabled = !joined || currentTurn!==playerName || winner;
  document.getElementById('btn-call').disabled = !joined || pile.length===0 || winner;

  // Winner banner
  const banner=document.getElementById('winner-banner');
  if(winner){
    banner.style.display='block';
    banner.innerHTML=`<h2>${winner===playerName?'🎉 You Win!':'🏆 '+winner+' Wins!'}</h2>
      <button onclick="playAgain()">Play Again</button>
      <button onclick="leaveLobby()">Leave Lobby</button>`;
  } else banner.style.display='none';
}

// ---- Play Again ----
async function playAgain() {
  if(!joined) return;
  await lobbyRef.transaction(game=>{
    if(!game) return;
    const players = game.players||{};
    for(let name in players){
      players[name] = Array.from({length:5}, ()=>randomCard());
    }
    game.players = players;
    game.pile=[];
    game.winner=null;
    game.currentTurn = Object.keys(players)[0]||null;
    return game;
  });
}

// ---- Leave Lobby ----
async function leaveLobby() {
  if(!joined) return;
  try {
    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if(chatUnsub) messagesRef.off('child_added', chatUnsub);

    await lobbyRef.child('players').child(playerName).remove();
  } catch(e){ console.warn("Error leaving lobby",e); }

  // reset UI
  document.getElementById('game-container-wrapper').style.display='none';
  document.getElementById('lobby-container').style.display='block';
  playerName='';
  lobbyName='';
  lobbyRef=null;
  messagesRef=null;
  playerHand=[];
  pile=[];
  currentTurn='';
  selectedCards.clear();
  joined=false;
}
