// ---- Firebase setup ----
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

// ---- Utils ----
function randomCard() {
  return ranks[Math.floor(Math.random()*ranks.length)] + suits[Math.floor(Math.random()*suits.length)];
}

function getNextRank(lastRank) {
  if(!lastRank) return ranks[0];
  return ranks[(ranks.indexOf(lastRank)+1) % ranks.length];
}

// ---- Visual Bullshit banner ----
function showBullshitBanner(msg){
  const banner = document.getElementById('bs-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
  setTimeout(()=>{ banner.style.display='none'; }, 2000);
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

    joined = true;
    document.getElementById('lobby-container').style.display = 'none';
    document.getElementById('game-container-wrapper').style.display = 'block';

    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    lobbyUnsub = lobbyRef.on('value', snapshot=>{
      const game = snapshot.val() || {};
      pile = game.pile || [];
      currentTurn = game.currentTurn || "";
      if(game.players && game.players[playerName]) playerHand = game.players[playerName].slice();
      updateUI(game.players || {}, game.winner || null);
      if(game.winner) showBullshitBanner(`${game.winner} wins!`);
    });

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

  // Determine required declared rank
  const lastDeclared = pile.length ? pile[pile.length-1].declared : null;
  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;

  // Prompt player
  let declared = prompt(
    requiredDeclared 
      ? `You must declare the next rank: ${requiredDeclared}` 
      : `Declare any rank to start the sequence`,
    requiredDeclared || cardsPreview[0].slice(0,-1)
  );
  if(!declared) return;
  declared = declared.trim().toUpperCase();

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

    const hand = game.players[playerName].slice();
    if(indices.some(i=>i<0 || i>=hand.length)) return game;

    const played = indices.map(i => hand[i]);
    game.players[playerName] = hand.filter((_,i)=>!indices.includes(i));
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
    if(last.card.slice(0,-1) === last.declared) 
      game.players[playerName] = (game.players[playerName]||[]).concat(pileCards);
    else 
      game.players[last.player] = (game.players[last.player]||[]).concat(pileCards);
    game.pile = [];
    game.currentTurn = playerName;
    return game;
  });
  showBullshitBanner("BULLSHIT called!");
}

// ---- Leave Lobby ----
async function leaveLobby(){
  if(!joined) return;
  await lobbyRef.child('players').child(playerName).remove();
  joined = false;
  playerName = ""; lobbyName = ""; playerHand = []; pile = []; currentTurn = "";
  document.getElementById('game-container-wrapper').style.display = 'none';
  document.getElementById('lobby-container').style.display = 'block';
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
    div.textContent = (p.player===playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
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
}

// ---- Event listeners ----
document.getElementById('btn-join').onclick = joinLobby;
document.getElementById('btn-play').onclick = playSelected;
document.getElementById('btn-draw').onclick = drawCard;
document.getElementById('btn-bullshit').onclick = callBS;
document.getElementById('btn-leave').onclick = leaveLobby;
