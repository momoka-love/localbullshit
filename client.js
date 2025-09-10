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

let playerName = "", lobbyName = "", lobbyRef = null, messagesRef = null;
let lobbyUnsub = null, chatUnsub = null;

let playerHand = [], pile = [], currentTurn = "";
let joined = false;
let selectedCards = new Set();

// ---- Utils ----
function randomCard() {
  const r = ranks[Math.floor(Math.random()*ranks.length)];
  const s = suits[Math.floor(Math.random()*suits.length)];
  return r+s;
}
function getNextRank(lastRank){
  if(!lastRank) return ranks[0];
  const idx = ranks.indexOf(lastRank);
  return ranks[(idx+1)%ranks.length];
}

// ---- Site notification ----
function showNotification(message){
  const notif=document.getElementById('site-notification');
  notif.textContent=message;
  notif.style.display='block';
  notif.style.animation='none';
  void notif.offsetWidth;
  notif.style.animation='fadeOut 3s forwards';
}

// ---- Join Lobby ----
async function joinLobby(){
  playerName=document.getElementById('player-name').value.trim();
  lobbyName=document.getElementById('lobby-name').value.trim();
  if(!playerName||!lobbyName){ alert("Enter name and lobby!"); return; }

  lobbyRef=db.ref('lobbies/'+lobbyName);
  messagesRef=lobbyRef.child('messages');

  try{
    await lobbyRef.transaction(game=>{
      if(!game) game={players:{}, pile:[], currentTurn:playerName, winner:null, messages:{}};
      game.players=game.players||{};
      game.pile=game.pile||[];
      if(!game.players[playerName]){
        playerHand=Array.from({length:5},()=>randomCard());
        game.players[playerName]=playerHand.slice();
      }else playerHand=game.players[playerName].slice();
      game.currentTurn=game.currentTurn||playerName;
      return game;
    });

    joined=true;
    document.getElementById('lobby-container').style.display='none';
    document.getElementById('game-container-wrapper').style.display='block';

    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if(chatUnsub) messagesRef.off('child_added', chatUnsub);

    lobbyUnsub=lobbyRef.on('value', snapshot=>{
      const game=snapshot.val()||{};
      pile=game.pile||[];
      currentTurn=game.currentTurn||"";
      if(game.players&&game.players[playerName]) playerHand=game.players[playerName].slice();
      updateUI(game.players||{}, game.winner||null);
      if(game.winner) showNotification(`${game.winner} wins the game!`);
    });

    chatUnsub=messagesRef.on('child_added', snap=>{
      const msg=snap.val(); if(!msg) return;
      const chatMessages=document.getElementById('chat-messages');
      const div=document.createElement('div');
      const time=new Date(msg.timestamp).toLocaleTimeString();
      div.textContent=`[${time}] ${msg.player}: ${msg.text}`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop=chatMessages.scrollHeight;
      if(chatMessages.childNodes.length>100) chatMessages.removeChild(chatMessages.firstChild);

      if(msg.text.toLowerCase().includes("bullshit"))
        showNotification(`${msg.player} called Bullshit!`);
    });

  }catch(err){ console.error(err); alert("Failed to join: "+err.message);}
}

// ---- Card selection ----
function toggleCard(idx){
  if(selectedCards.has(idx)) selectedCards.delete(idx);
  else selectedCards.add(idx);
  updateUI();
}

// ---- Play Selected (safer) ----
async function playSelected(){
  if(!joined) return alert("Not in a lobby!");
  if(currentTurn!==playerName) return alert("Not your turn!");
  if(selectedCards.size===0) return alert("Select cards!");

  // Capture selected indices as a stable array of numbers
  const indices = [...selectedCards].map(i => Number(i)).sort((a,b)=>a-b);

  // Use client copy of playerHand only for the prompt/declared default (UI convenience)
  const cardsPreview = indices.map(i => playerHand[i]).filter(Boolean);
  const lastDeclared = pile.length ? pile[pile.length-1].declared : null;
  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;
  let declaredRank = prompt(
    `Playing ${indices.length} card(s). Declare rank:` +
    (requiredDeclared ? ` (Must declare ${requiredDeclared})` : ''),
    requiredDeclared || (cardsPreview[0] ? cardsPreview[0].slice(0,-1) : ranks[0])
  );
  declaredRank = (declaredRank || requiredDeclared || (cardsPreview[0] ? cardsPreview[0].slice(0,-1) : ranks[0])).trim();
  if(requiredDeclared && declaredRank !== requiredDeclared) return alert(`Must declare ${requiredDeclared}!`);

  // Transaction only uses primitive `indices` (not the Set) and server-side hand
  const result = await lobbyRef.transaction(game => {
    if(!game) return game;               // do not return undefined
    game.players = game.players || {};
    game.pile = game.pile || [];

    // ensure it's still this player's turn
    if(game.currentTurn !== playerName) return game;

    const hand = (game.players[playerName] || []).slice();

    // Validate indices against server-side hand
    if(indices.some(i => i < 0 || i >= hand.length)) {
      // indices mismatch (maybe another client changed hand) -> abort safely
      console.warn("Index mismatch in playSelected transaction; aborting");
      return game;
    }

    // Build playedCards from server-side hand (guarantees correctness)
    const playedCards = indices.map(i => hand[i]);

    // Remove played indices from hand (walk server-side hand)
    const newHand = hand.filter((_, idx) => !indices.includes(idx));

    // Add to pile
    playedCards.forEach(c => {
      game.pile.push({ card: c, declared: declaredRank, player: playerName });
    });

    // Save back hand
    game.players[playerName] = newHand;

    // Check winner
    if(newHand.length === 0) game.winner = playerName;

    // Advance turn safely. Use a deterministic ordering:
    const allPlayers = Object.keys(game.players).sort(); // sorted to be deterministic
    if(allPlayers.length > 0) {
      // find current turn index; if not found fallback to first
      let idx = allPlayers.indexOf(game.currentTurn);
      if(idx === -1) idx = 0;
      game.currentTurn = allPlayers[(idx + 1) % allPlayers.length];
    } else {
      game.currentTurn = null;
    }

    return game;
  });

  // If transaction succeeded (result.committed), clear client selection and UI
  selectedCards.clear();
}

// ---- Draw ----
async function drawCard(){
  if(!joined) return;
  const newCard=randomCard();
  await lobbyRef.child('players').child(playerName).transaction(hand=>{
    hand=hand||[];
    hand.push(newCard);
    return hand;
  });
}

// ---- Bullshit ----
async function callBS(){
  if(!joined||pile.length===0) return;
  await lobbyRef.transaction(game=>{
    if(!game||!game.pile) return game;
    const last=game.pile[game.pile.length-1];
    const realRank=last.card.slice(0,-1);
    const pileCards=game.pile.map(p=>p.card);
    game.players=game.players||{};
    if(realRank===last.declared) game.players[playerName]=(game.players[playerName]||[]).concat(pileCards);
    else game.players[last.player]=(game.players[last.player]||[]).concat(pileCards);
    game.pile=[];
    game.currentTurn=playerName;
    return game;
  });
  if(msg.text.toLowerCase().includes("bullshit")) {
  showNotification(`${msg.player} called Bullshit!`);

  const bsBanner = document.getElementById('bs-banner');
  bsBanner.style.display = 'block';
  bsBanner.textContent = `💥 ${msg.player} says BULLSHIT! 💥`;

  setTimeout(() => {
    bsBanner.style.display = 'none';
  }, 2000);
}

}

// ---- Chat ----
function sendMessage(){
  const input=document.getElementById('chat-input');
  const text=input.value.trim();
  if(!text||!joined) return;
  messagesRef.push({player:playerName,text,timestamp:Date.now()});
  input.value='';
}
document.getElementById('chat-send').onclick=sendMessage;
document.getElementById('chat-input').addEventListener('keypress', e=>{if(e.key==='Enter') sendMessage();});

// ---- Update UI ----
function updateUI(playersObj={}, winner=null){
  // Hand
  const container=document.getElementById('game-container');
  container.innerHTML='';
  playerHand.forEach((c,i)=>{
    const div=document.createElement('div');
    div.textContent=c;
    div.className='card';
    if(selectedCards.has(i)) div.classList.add('selected');
    div.onclick=()=>toggleCard(i);
    container.appendChild(div);
  });

  // Pile stacked
  const pileContainer=document.getElementById('pile-container');
  pileContainer.innerHTML='';
  pile.forEach((p,i)=>{
    const div=document.createElement('div');
    div.className='pile-card';
    div.textContent=(p.player===playerName)?`${p.card} (${p.declared})`:`${p.declared} (by ${p.player})`;
    div.style.transform=`translate(${i*2}px, ${i*2}px)`;
    pileContainer.appendChild(div);
  });

  // Players
  const list=document.getElementById('players-list');
  list.innerHTML='';
  Object.entries(playersObj).forEach(([name,hand])=>{
    const li=document.createElement('li');
    li.textContent=`${name} - ${hand.length} card${hand.length!==1?'s':''}`;
    if(name===currentTurn) li.style.fontWeight='bold';
    if(hand.length===0) li.style.textDecoration='underline';
    list.appendChild(li);
  });

  document.getElementById('game-info').textContent=`Current Turn: ${currentTurn}`;

  // Buttons
  document.getElementById('btn-play').disabled=!joined||currentTurn!==playerName||winner;
  document.getElementById('btn-draw').disabled=!joined||currentTurn!==playerName||winner;
  document.getElementById('btn-bullshit').disabled=!joined||pile.length===0||winner;

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
async function playAgain(){
  if(!joined) return;
  await lobbyRef.transaction(game=>{
    if(!game) return;
    const players=game.players||{};
    for(let name in players) players[name]=Array.from({length:5},()=>randomCard());
    game.players=players;
    game.pile=[];
    game.winner=null;
    game.currentTurn=Object.keys(players)[0]||null;
    return game;
  });
}

// ---- Leave Lobby ----
async function leaveLobby(){
  if(!joined) return;
  try{
    if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
    if(chatUnsub) messagesRef.off('child_added', chatUnsub);
    await lobbyRef.child('players').child(playerName).remove();
  }catch(e){ console.warn(e);}
  document.getElementById('game-container-wrapper').style.display='none';
  document.getElementById('lobby-container').style.display='block';
  playerName=''; lobbyName=''; lobbyRef=null; messagesRef=null;
  playerHand=[]; pile=[]; currentTurn=''; selectedCards.clear(); joined=false;
}
