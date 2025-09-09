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
let selectedCards = new Set(); // for multi-card selection

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
  if (!playerName || !lobbyName) return alert("Enter both lobby name and player name!");

  lobbyRef = db.ref('lobbies/' + lobbyName);

  await lobbyRef.child('testConnection').set({ time: Date.now() });

  document.getElementById('lobby-container').style.display = 'none';
  document.getElementById('game-container-wrapper').style.display = 'block';

  if (!joined) {
    joined = true;
    playerHand = Array.from({ length: 5 }, () => randomCard());
    await lobbyRef.child('players').transaction(players => {
      players = players || {};
      players[playerName] = playerHand.slice();
      return players;
    });
    await lobbyRef.child('currentTurn').transaction(ct => ct || playerName);
  }

  if (lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
  if (chatUnsub) lobbyRef.off('child_added', chatUnsub);

  // Listen for game state
  lobbyUnsub = lobbyRef.on('value', snap => {
    const game = snap.val() || {};
    pile = game.pile || [];
    currentTurn = game.currentTurn || "";
    if (game.players && game.players[playerName]) {
      playerHand = game.players[playerName].slice();
    }
    updateUI(game.players || {});
  });

  // Listen for chat
  chatUnsub = lobbyRef.child('messages').on('child_added', snap => {
    const msg = snap.val();
    if (!msg) return;
    const chatMessages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    const time = new Date(msg.timestamp).toLocaleTimeString();
    div.textContent = `[${time}] ${msg.player}: ${msg.text}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// ---- Select Card ----
function toggleCard(index) {
  if (selectedCards.has(index)) {
    selectedCards.delete(index);
  } else {
    selectedCards.add(index);
  }
  updateUI({}); // refresh highlighting
}

// ---- Play Selected Cards ----
async function playSelected() {
  if (currentTurn !== playerName) return alert("Not your turn!");
  if (selectedCards.size === 0) return alert("Select at least one card!");

  const cards = [...selectedCards].map(i => playerHand[i]);
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

  try {
    await lobbyRef.transaction(game => {
      game = game || { players: {}, pile: [], currentTurn: null };
      if (game.currentTurn !== playerName) return;

      const hand = (game.players[playerName] || []).slice();
      const newHand = hand.filter((c, i) => !selectedCards.has(i));

      // push each card into pile
      cards.forEach(card => {
        game.pile.push({ card, declared: declaredRank, player: playerName });
      });

      game.players[playerName] = newHand;

      // winner check
      if (newHand.length === 0) {
        game.winner = playerName;
      }

      // advance turn
      const allPlayers = Object.keys(game.players);
      if (allPlayers.length > 0) {
        const idx = allPlayers.indexOf(game.currentTurn);
        game.currentTurn = allPlayers[(idx + 1) % allPlayers.length];
      }

      return game;
    });

    selectedCards.clear();
  } catch (err) {
    console.error("Play failed:", err);
  }
}

// ---- Call BS ----
async function callBS() {
  if (!pile.length) return alert("No cards to challenge!");
  await lobbyRef.transaction(game => {
    if (!game || !game.pile) return;
    const last = game.pile[game.pile.length - 1];
    const realRank = last.card.slice(0, -1);
    const pileCards = game.pile.map(p => p.card);

    if (realRank === last.declared) {
      game.players[playerName] = (game.players[playerName] || []).concat(pileCards);
    } else {
      game.players[last.player] = (game.players[last.player] || []).concat(pileCards);
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
  if (!text) return;
  lobbyRef.child('messages').push({
    player: playerName,
    text,
    timestamp: Date.now()
  });
  input.value = '';
}
document.getElementById('chat-send').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') sendMessage();
});

// ---- Update UI ----
function updateUI(players) {
  // Winner banner
  const banner = document.getElementById('winner-banner');
  if (players && Object.keys(players).length) {
    const winner = Object.entries(players).find(([_, hand]) => hand.length === 0);
    if (winner) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <h2>${winner[0] === playerName ? "🎉 You Win!" : "🏆 " + winner[0] + " Wins!"}</h2>
        <button onclick="playAgain()">Play Again</button>
        <button onclick="leaveLobby()">Leave Lobby</button>
      `;
      // notify in chat once
      lobbyRef.child('messages').push({
        player: "System",
        text: `${winner[0]} has won the game!`,
        timestamp: Date.now()
      });
    } else {
      banner.style.display = 'none';
    }
  }

  // Hand
  const handDiv = document.getElementById('game-container');
  handDiv.innerHTML = '';
  playerHand.forEach((c, i) => {
    const div = document.createElement('div');
    div.textContent = c;
    div.className = 'card';
    if (selectedCards.has(i)) div.classList.add('selected');
    div.onclick = () => toggleCard(i);
    handDiv.appendChild(div);
  });

  // Pile
  const pileDiv = document.getElementById('pile-container');
  pileDiv.innerHTML = '';
  pile.forEach(p => {
    const div = document.createElement('div');
    div.textContent = (p.player === playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
    div.className = 'card';
    pileDiv.appendChild(div);
  });

  // Leaderboard
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  Object.entries(players).forEach(([name, hand]) => {
    const li = document.createElement('li');
    li.textContent = `${name} - ${hand.length} cards`;
    if (name === currentTurn) li.style.fontWeight = 'bold';
    if (hand.length === 0) li.style.textDecoration = 'underline';
    list.appendChild(li);
  });

  // Info
  document.getElementById('game-info').textContent = `Current Turn: ${currentTurn}`;
}

// ---- Play Again ----
async function playAgain() {
  await lobbyRef.transaction(game => {
    if (!game) return;
    const players = {};
    for (let name in game.players) {
      players[name] = Array.from({ length: 5 }, () => randomCard());
    }
    game.players = players;
    game.pile = [];
    game.winner = null;
    game.currentTurn = Object.keys(players)[0] || null;
    return game;
  });
}

// ---- Leave Lobby ----
function leaveLobby() {
  if (lobbyRef) {
    lobbyRef.child('players').child(playerName).remove();
    if (lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if (chatUnsub) lobbyRef.off('child_added', chatUnsub);
  }
  document.getElementById('game-container-wrapper').style.display = 'none';
  document.getElementById('lobby-container').style.display = 'block';
}
