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
let lobbyUnsub = null;
let chatUnsub = null;

let playerHand = [];
let pile = [];
let currentTurn = "";
let joined = false;

// ---- Utility ----
function getNextRank(lastRank) {
  if (!lastRank) return ranks[0];
  const idx = ranks.indexOf(lastRank);
  return ranks[(idx + 1) % ranks.length];
}

function randomCard() {
  const r = ranks[Math.floor(Math.random() * ranks.length)];
  const s = suits[Math.floor(Math.random() * suits.length)];
  return r + s;
}

// ---- Join Lobby ----
async function joinLobby() {
  playerName = document.getElementById('player-name').value.trim();
  lobbyName = document.getElementById('lobby-name').value.trim();

  if (!playerName || !lobbyName) {
    alert("Enter both lobby name and player name!");
    return;
  }

  lobbyRef = db.ref('lobbies/' + lobbyName);

  try {
    await lobbyRef.child('testConnection').set({time: Date.now()});

    // show game, hide join UI
    document.getElementById('lobby-container').style.display = 'none';
    document.getElementById('game-container-wrapper').style.display = 'block';

    if (!joined) {
      joined = true;
      playerHand = Array.from({length:5}, () => randomCard());

      // Add player
      await lobbyRef.child('players').transaction(players => {
        players = players || {};
        if (!players[playerName]) players[playerName] = playerHand.slice();
        return players;
      });

      await lobbyRef.child('currentTurn').transaction(ct => ct || playerName);
    }

    // Remove old listeners
    if (lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if (chatUnsub) lobbyRef.off('child_added', chatUnsub);

    // Listen to game updates
    lobbyUnsub = lobbyRef.on('value', snapshot => {
      const game = snapshot.val() || {};
      pile = game.pile || [];
      currentTurn = game.currentTurn || "";
      if (game.players && game.players[playerName]) {
        playerHand = game.players[playerName].slice();
      }
      updateUI(game.players || {});
    });

    // Listen to chat messages
    chatUnsub = lobbyRef.child('messages').on('child_added', snap => {
      const msg = snap.val();
      if (!msg) return;
      const chatMessages = document.getElementById('chat-messages');
      const div = document.createElement('div');
      const time = new Date(msg.timestamp).toLocaleTimeString();
      div.textContent = `[${time}] ${msg.player}: ${msg.text}`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // limit chat to last 100 messages
      if (chatMessages.childNodes.length > 100) {
        chatMessages.removeChild(chatMessages.firstChild);
      }
    });

  } catch (err) {
    alert("Firebase write failed: " + err.message);
  }
}

// ---- Play Card ----
async function playCard(cardIndex) {
  if (!lobbyRef) return alert("Not connected to a lobby.");
  if (currentTurn !== playerName) return alert("Not your turn!");
  const card = playerHand[cardIndex];
  if (!card) return alert("Invalid card selection.");

  const lastDeclared = pile.length ? pile[pile.length - 1].declared : null;
  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;

  let declaredRank = prompt(
    `You are playing ${card}. What rank do you want to declare?` +
    (requiredDeclared ? ` (You must declare: ${requiredDeclared})` : ""),
    requiredDeclared || card.slice(0, -1)
  );
  declaredRank = (declaredRank || requiredDeclared || card.slice(0,-1)).trim();

  if (requiredDeclared && declaredRank !== requiredDeclared) {
    alert(`Invalid declaration. You must declare: ${requiredDeclared}`);
    return;
  }

  try {
    await lobbyRef.transaction(game => {
      game = game || {players:{}, pile:[], currentTurn:null};
      if (game.currentTurn !== playerName) return;

      const serverPlayers = game.players || {};
      const serverHand = (serverPlayers[playerName] || []).slice();
      let serverCard = serverHand[cardIndex];
      if (!serverCard) {
        const idx = serverHand.indexOf(card);
        if (idx === -1) return;
        serverCard = serverHand[idx];
        serverHand.splice(idx,1);
      } else serverHand.splice(cardIndex,1);

      const serverLastDeclared = (game.pile && game.pile.length) ? game.pile[game.pile.length-1].declared : null;
      const serverRequired = serverLastDeclared ? getNextRank(serverLastDeclared) : null;
      if (serverRequired && declaredRank !== serverRequired) return;

      game.players[playerName] = serverHand;
      game.pile = game.pile || [];
      game.pile.push({card:serverCard, declared:declaredRank, player:playerName});

      const allPlayers = Object.keys(game.players);
      if (allPlayers.length > 0) {
        const idx = allPlayers.indexOf(game.currentTurn);
        game.currentTurn = allPlayers[(idx===-1?0:(idx+1)%allPlayers.length)];
      }

      return game;
    });
  } catch (err) {
    console.error("Play card failed:", err);
    alert("Failed to play card. Try again.");
  }
}

// ---- Draw Card ----
async function drawCard() {
  if (!lobbyRef) return alert("Not connected to a lobby.");
  const newCard = randomCard();
  try {
    await lobbyRef.child('players').child(playerName).transaction(hand => {
      hand = hand || [];
      hand.push(newCard);
      return hand;
    });
  } catch (err) {
    console.error("Draw failed:", err);
    alert("Failed to draw a card.");
  }
}

// ---- Call BS ----
async function callBS() {
  if (!lobbyRef) return alert("Not connected.");
  try {
    await lobbyRef.transaction(game => {
      if (!game || !game.pile || game.pile.length===0) return;
      const last = game.pile[game.pile.length-1];
      const realRank = last.card.slice(0,-1);
      const pileCards = game.pile.map(p=>p.card);

      game.players = game.players || {};
      if(realRank===last.declared){
        game.players[playerName] = (game.players[playerName] || []).concat(pileCards);
      } else {
        game.players[last.player] = (game.players[last.player] || []).concat(pileCards);
      }

      game.pile = [];
      game.currentTurn = playerName;
      return game;
    });
  } catch (err) {
    console.error("Call BS failed:", err);
    alert("Failed to call BS. Try again.");
  }
}

// ---- Send Chat ----
function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !lobbyRef || !playerName) return;

  lobbyRef.child('messages').push({
    player: playerName,
    text: text,
    timestamp: Date.now()
  }).then(()=>{input.value='';})
    .catch(err=>console.error("Failed to send message:", err));
}
document.getElementById('chat-send').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keypress', e=>{if(e.key==='Enter') sendMessage();});

// ---- Update UI ----
function updateUI(playersObj) {
  // Player hand
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  playerHand.forEach((c,i)=>{
    const div=document.createElement('div');
    div.textContent = c;
    div.className='card';
    div.onclick=()=>playCard(i);
    container.appendChild(div);
  });
function updateUI(playersObj) {
  // --- Winner check ---
  const winner = Object.entries(playersObj).find(([name, hand]) => hand.length === 0);
  const winnerBanner = document.getElementById('winner-banner');
  if (winner) {
    winnerBanner.style.display = 'block';
    winnerBanner.innerHTML = `
      <h2>${winner[0] === playerName ? "You Win!" : winner[0] + " Wins!"}</h2>
      <button onclick="playAgain()">Play Again</button>
      <button onclick="leaveLobby()">Leave Lobby</button>
    `;
  } else {
    winnerBanner.style.display = 'none';
  }

  // --- Player hand ---
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  playerHand.forEach((c, i) => {
    const div = document.createElement('div');
    div.textContent = c;
    div.className = 'card';
    // color suits
    if (c.includes('♥') || c.includes('♦')) div.style.color = 'red';
    else div.style.color = 'black';
    div.onclick = () => playCard(i);
    container.appendChild(div);
  });

  // --- Pile ---
  const pileContainer = document.getElementById('pile-container');
  if (pileContainer) {
    pileContainer.innerHTML = '';
    pile.forEach(p => {
      const div = document.createElement('div');
      div.textContent = (p.player === playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
      div.className = 'card';
      if (p.card.includes('♥') || p.card.includes('♦')) div.style.color = 'red';
      else div.style.color = 'black';
      pileContainer.appendChild(div);
    });
  }

  // --- Game info ---
  const info = document.getElementById('game-info');
  if (info) info.textContent = `Current Turn: ${currentTurn}`;

  // --- Leaderboard ---
  const lobbyDisplay = document.getElementById('lobby-name-display');
  if (lobbyDisplay) lobbyDisplay.textContent = lobbyName || "Unknown";
  const playersList = document.getElementById('players-list');
  if (playersList) {
    playersList.innerHTML = '';
    const sorted = Object.entries(playersObj).sort((a, b) => b[1].length - a[1].length);
    sorted.forEach(([name, hand]) => {
      const li = document.createElement('li');
      li.textContent = `${name} - ${hand.length} card${hand.length !== 1 ? 's' : ''}`;
      if (name === currentTurn) li.style.fontWeight = 'bold';
      if (hand.length === 0) li.style.textDecoration = 'underline';
      playersList.appendChild(li);
    });
  }

  // --- Enable/disable buttons ---
  const drawBtn = document.getElementById('btn-draw');
  if (drawBtn) drawBtn.disabled = (currentTurn !== playerName || winner);
  const callBtn = document.getElementById('btn-call');
  if (callBtn) callBtn.disabled = (pile.length === 0 || winner);
}


  // Pile
  const pileContainer = document.getElementById('pile-container');
  if(pileContainer){
    pileContainer.innerHTML='';
    pile.forEach(p=>{
      const div=document.createElement('div');
      div.textContent=(p.player===playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
      div.className='card';
      pileContainer.appendChild(div);
    });
  }

  // Game info
  const info = document.getElementById('game-info');
  if(info) info.textContent=`Current Turn: ${currentTurn}`;

  // Leaderboard
  const lobbyDisplay = document.getElementById('lobby-name-display');
  if(lobbyDisplay) lobbyDisplay.textContent = lobbyName || "Unknown";
  const playersList = document.getElementById('players-list');
  if(playersList){
    playersList.innerHTML='';
    const sorted = Object.entries(playersObj).sort((a,b)=>b[1].length-a[1].length);
    sorted.forEach(([name, hand])=>{
      const li=document.createElement('li');
      li.textContent=`${name} - ${hand.length} card${hand.length!==1?'s':''}` + (name===currentTurn ? " ⬅ Current Turn" : "");
      playersList.appendChild(li);
    });
  }

  // Enable/disable buttons
  const drawBtn = document.getElementById('btn-draw');
  if(drawBtn) drawBtn.disabled = (currentTurn!==playerName);
  const callBtn = document.getElementById('btn-call');
  if(callBtn) callBtn.disabled = (pile.length===0);
}

async function playAgain() {
  if (!lobbyRef) return;

  try {
    await lobbyRef.transaction(game => {
      if (!game) return;
      // Reset game state
      const players = game.players || {};
      for (let name in players) {
        // Deal 5 new random cards
        players[name] = Array.from({ length: 5 }, () => randomCard());
      }
      game.players = players;
      game.pile = [];
      game.currentTurn = Object.keys(players)[0] || null;
      return game;
    });
  } catch (err) {
    console.error("Play again failed:", err);
    alert("Failed to restart game.");
  }
}


// ---- Leave Lobby ----
function leaveLobby() {
  if(lobbyRef){
    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if(chatUnsub) lobbyRef.off('child_added', chatUnsub);
    lobbyRef.child('players').child(playerName).remove();
  }

  const chatMessages = document.getElementById('chat-messages');
  if(chatMessages) chatMessages.innerHTML='';

  document.getElementById('game-container-wrapper').style.display='none';
  document.getElementById('lobby-container').style.display='block';

  playerName = "";
  lobbyName = "";
  lobbyRef = null;
  playerHand = [];
  pile = [];
  currentTurn = "";
  joined = false;
  lobbyUnsub = null;
  chatUnsub = null;
}
