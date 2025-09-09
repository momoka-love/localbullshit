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

// store refs & callbacks so .off() cancels the exact listener
let lobbyValueCallback = null;
let messagesRef = null;
let messagesCallback = null;

let playerHand = [];
let pile = [];
let currentTurn = "";
let joined = false;
let selectedCards = new Set();

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

// helper: safe init of game object inside transactions
function ensureGameShape(game) {
  if (!game) {
    game = { players: {}, pile: [], currentTurn: null, winner: null };
  } else {
    game.players = game.players || {};
    game.pile = game.pile || [];
  }
  return game;
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
    // quick write to ensure connection (non-destructive)
    await lobbyRef.child('testConnection').set({ time: Date.now() });

    // UI swap
    document.getElementById('lobby-container').style.display = 'none';
    document.getElementById('game-container-wrapper').style.display = 'block';

    if (!joined) {
      joined = true;
      // initial hand locally (will be set on server)
      playerHand = Array.from({length:5}, () => randomCard());

      // Add player to the lobby using a transaction that won't wipe data
      await lobbyRef.child('players').transaction(players => {
        players = players || {};
        if (!players[playerName]) players[playerName] = playerHand.slice();
        return players;
      });

      // Ensure currentTurn exists
      await lobbyRef.child('currentTurn').transaction(ct => ct || playerName);
    }

    // Remove old listeners if any (use stored callbacks/refs)
    if (lobbyRef && lobbyValueCallback) {
      lobbyRef.off('value', lobbyValueCallback);
      lobbyValueCallback = null;
    }
    if (messagesRef && messagesCallback) {
      messagesRef.off('child_added', messagesCallback);
      messagesRef = null;
      messagesCallback = null;
    }

    // Setup onDisconnect to remove this player if they disconnect unexpectedly
    const playerRef = lobbyRef.child('players').child(playerName);
    try {
      await playerRef.onDisconnect().remove();
    } catch (e) {
      // onDisconnect may throw if not connected yet; ignore safely
      console.warn('onDisconnect registration failed (may retry):', e);
    }

    // Game updates (store callback so we can remove it later)
    lobbyValueCallback = snapshot => {
      const game = snapshot.val() || {};
      pile = game.pile || [];
      currentTurn = game.currentTurn || "";
      if (game.players && game.players[playerName]) {
        // keep local hand in-sync with server authoritative hand
        playerHand = game.players[playerName].slice();
      }
      updateUI(game.players || {}, game.winner || null);
    };
    lobbyRef.on('value', lobbyValueCallback);

    // Chat messages
    messagesRef = lobbyRef.child('messages');
    messagesCallback = snap => {
      const msg = snap.val();
      if (!msg) return;
      const chatMessages = document.getElementById('chat-messages');
      const div = document.createElement('div');
      const time = new Date(msg.timestamp).toLocaleTimeString();
      // use textContent to avoid HTML injection
      div.textContent = `[${time}] ${msg.player}: ${msg.text}`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      if (chatMessages.childNodes.length > 100) {
        chatMessages.removeChild(chatMessages.firstChild);
      }
    };
    messagesRef.on('child_added', messagesCallback);

  } catch (err) {
    alert("Firebase write failed: " + (err && err.message ? err.message : err));
    console.error(err);
  }
}

// ---- Card selection ----
function toggleCard(index) {
  if (selectedCards.has(index)) selectedCards.delete(index);
  else selectedCards.add(index);
  updateUI();
}

// ---- Play selected cards ----
async function playSelected() {
  if (!lobbyRef) return alert("Not connected to a lobby.");
  if (currentTurn !== playerName) return alert("Not your turn!");
  if (selectedCards.size === 0) return alert("Select at least one card!");

  // capture actual card strings now (client-side snapshot)
  const cards = [...selectedCards].map(i => playerHand[i]);

  // Basic client validation
  if (cards.some(c => typeof c === 'undefined')) {
    return alert("Selection invalid. Please reselect your cards.");
  }

  const lastDeclared = pile.length ? pile[pile.length - 1].declared : null;
  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;

  let declaredRank = prompt(
    `You are playing ${cards.length} card(s). What rank do you want to declare?` +
    (requiredDeclared ? ` (Must declare: ${requiredDeclared})` : ""),
    requiredDeclared || cards[0].slice(0, -1)
  );
  declaredRank = (declaredRank || requiredDeclared || cards[0].slice(0,-1)).trim();

  if (requiredDeclared && declaredRank !== requiredDeclared) {
    return alert(`Invalid. You must declare: ${requiredDeclared}`);
  }
  if (!ranks.includes(declaredRank)) {
    return alert("Invalid rank declared.");
  }

  try {
    const result = await lobbyRef.transaction(game => {
      // safest approach: if there's no snapshot, abort rather than create an empty object
      if (!game) return;

      // ensure minimal shape
      game.players = game.players || {};
      game.pile = game.pile || [];

      // server-side turn check
      if (game.currentTurn !== playerName) return game;

      const serverHand = (game.players[playerName] || []).slice();

      // remove each played card by value from the server hand (one occurrence each)
      const newHand = serverHand.slice();
      for (const card of cards) {
        const idx = newHand.indexOf(card);
        if (idx === -1) {
          // abort the transaction unchanged if the server hand is missing a card
          return game;
        }
        newHand.splice(idx, 1);
      }

      // push pile entries (note: storing actual card here keeps original behavior;
      // consider storing only declared to avoid leaking card values)
      for (const card of cards) {
        game.pile.push({ card, declared: declaredRank, player: playerName });
      }

      game.players[playerName] = newHand;

      if (newHand.length === 0) {
        game.winner = playerName;
      }

      // advance turn safely among present players
      const allPlayers = Object.keys(game.players);
      if (allPlayers.length > 0) {
        const idx = allPlayers.indexOf(game.currentTurn);
        // if currentTurn somehow missing, default to first player
        const nextIdx = (idx === -1) ? 0 : (idx + 1) % allPlayers.length;
        game.currentTurn = allPlayers[nextIdx];
      }

      return game;
    });

    // transaction completed (committed or aborted) — clear selection if successful
    // result.committed === true indicates it was applied
    if (result && result.committed) {
      selectedCards.clear();
    } else {
      // not applied (e.g., abort due to mismatch); client will get latest snapshot via listener
      console.warn("Play not applied (transaction aborted). Game state will be refreshed.");
    }
  } catch (err) {
    console.error("playSelected transaction failed:", err);
    alert("Play failed: " + (err && err.message ? err.message : err));
  }
}

// ---- Draw Card ----
async function drawCard() {
  if (!lobbyRef) return alert("Not connected to a lobby.");
  // add a random card to player's hand atomically
  const newCard = randomCard();
  try {
    await lobbyRef.child('players').child(playerName).transaction(hand => {
      hand = hand || [];
      hand.push(newCard);
      return hand;
    });
  } catch (err) {
    console.error("drawCard transaction failed:", err);
    alert("Draw failed: " + (err && err.message ? err.message : err));
  }
}

// ---- Call BS ----
async function callBS() {
  if (!lobbyRef) return alert("Not connected.");
  try {
    await lobbyRef.transaction(game => {
      if (!game) return;

      game.players = game.players || {};
      game.pile = game.pile || [];

      if (!game.pile || game.pile.length === 0) return game;

      const last = game.pile[game.pile.length - 1];
      const realRank = last.card.slice(0, -1);
      const pileCards = game.pile.map(p => p.card);

      // Ensure both players exist
      game.players[playerName] = game.players[playerName] || [];
      game.players[last.player] = game.players[last.player] || [];

      if (realRank === last.declared) {
        // caller was wrong; caller takes pile
        game.players[playerName] = game.players[playerName].concat(pileCards);
      } else {
        // caller was right; player who lied takes pile
        game.players[last.player] = game.players[last.player].concat(pileCards);
      }

      game.pile = [];
      game.currentTurn = playerName;

      return game;
    });
  } catch (err) {
    console.error("callBS transaction failed:", err);
    alert("Call BS failed: " + (err && err.message ? err.message : err));
  }
}

// ---- Send Chat ----
function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = (input.value || '').trim();
  if (!text || !lobbyRef || !playerName) return;

  lobbyRef.child('messages').push({
    player: playerName,
    text: text,
    timestamp: Date.now()
  }).then(()=>{ input.value = ''; }).catch(err=>{
    console.error('sendMessage failed', err);
  });
}
document.getElementById('chat-send').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

// ---- Update UI ----
function updateUI(playersObj = {}, winner = null) {
  // Normalize players to arrays
  for (let name in playersObj) {
    if (!Array.isArray(playersObj[name])) playersObj[name] = [];
  }

  // --- Winner banner ---
  const banner = document.getElementById('winner-banner');
  if (winner) {
    banner.style.display = 'block';
    banner.innerHTML = `
      <h2>${winner === playerName ? "🎉 You Win!" : "🏆 " + winner + " Wins!"}</h2>
      <button onclick="playAgain()">Play Again</button>
      <button onclick="leaveLobby()">Leave Lobby</button>
    `;
  } else {
    banner.style.display = 'none';
  }

  // --- Hand ---
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  playerHand.forEach((c, i) => {
    const div = document.createElement('div');
    div.textContent = c;
    div.className = 'card';
    if (selectedCards.has(i)) div.classList.add('selected');
    div.onclick = () => toggleCard(i);
    container.appendChild(div);
  });

  // --- Pile ---
  const pileContainer = document.getElementById('pile-container');
  pileContainer.innerHTML = '';
  pile.forEach(p => {
    const div = document.createElement('div');
    div.textContent = (p.player === playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
    div.className = 'card';
    pileContainer.appendChild(div);
  });

  // --- Leaderboard ---
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = '';
  Object.entries(playersObj).forEach(([name, hand]) => {
    const li = document.createElement('li');
    li.textContent = `${name} - ${hand.length} card${hand.length !== 1 ? 's' : ''}`;
    if (name === currentTurn) li.style.fontWeight = 'bold';
    if (hand.length === 0) li.style.textDecoration = 'underline';
    playersList.appendChild(li);
  });

  // --- Info ---
  document.getElementById('game-info').textContent = `Current Turn: ${currentTurn}`;

  // --- Buttons ---
  document.getElementById('btn-draw').disabled = (currentTurn !== playerName || winner);
  document.getElementById('btn-call').disabled = (pile.length === 0 || winner);
  document.getElementById('btn-play').disabled = (currentTurn !== playerName || winner);
}

// ---- Play Again ----
async function playAgain() {
  if (!lobbyRef) return;
  try {
    await lobbyRef.transaction(game => {
      // if game is missing, initialize safely instead of returning {}
      game = ensureGameShape(game);
      const players = game.players || {};
      for (let name in players) {
        players[name] = Array.from({ length: 5 }, () => randomCard());
      }
      game.players = players;
      game.pile = [];
      game.winner = null;
      game.currentTurn = Object.keys(players)[0] || null;
      return game;
    });
  } catch (err) {
    console.error("playAgain failed:", err);
    alert("Play again failed: " + (err && err.message ? err.message : err));
  }
}

// ---- Leave Lobby ----
async function leaveLobby() {
  if (lobbyRef) {
    // remove listeners (use stored callbacks/refs)
    if (lobbyValueCallback) {
      lobbyRef.off('value', lobbyValueCallback);
      lobbyValueCallback = null;
    }
    if (messagesRef && messagesCallback) {
      messagesRef.off('child_added', messagesCallback);
      messagesRef = null;
      messagesCallback = null;
    }

    // cancel onDisconnect and remove the player node
    const pRef = lobbyRef.child('players').child(playerName);
    try { await pRef.onDisconnect().cancel(); } catch(e){ /* ignore */ }
    try { await pRef.remove(); } catch(e){ /* ignore */ }
  }

  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) chatMessages.innerHTML = '';

  document.getElementById('game-container-wrapper').style.display = 'none';
  document.getElementById('lobby-container').style.display = 'block';

  // reset local state
  playerName = "";
  lobbyName = "";
  lobbyRef = null;
  playerHand = [];
  pile = [];
  currentTurn = "";
  joined = false;
  selectedCards.clear();
}
