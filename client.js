// client.js (patched)
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

// helpful debug logging for Firebase
firebase.database.enableLogging(true);

// Use RTDB emulator when running locally (change port if your emulator uses different port)
if (location.hostname === "localhost") {
  try {
    db.useEmulator("localhost", 9000);
    console.info("Using RTDB emulator at localhost:9000");
  } catch (e) {
    console.warn("Could not use emulator:", e);
  }
}

// --- Game variables ---
const suits = ['♠','♥','♦','♣'];
const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

let playerName="", lobbyName="", lobbyRef=null;
let playerHand=[], pile=[], currentTurn="", joined=false;
let selectedCards = new Set();
let lobbyUnsub=null;
let chatRef=null;
let chatUnsub=null;

// --- Utils ---
function randomCard(){ return ranks[Math.floor(Math.random()*ranks.length)] + suits[Math.floor(Math.random()*suits.length)]; }
function normalizeRank(r){ return r ? r.toString().trim().toUpperCase() : null; }
function getNextRank(lastRank){ 
  if(!lastRank) return null; 
  lastRank = normalizeRank(lastRank);
  const idx = ranks.indexOf(lastRank);
  if(idx===-1) return null;
  return ranks[(idx+1)%ranks.length];
}
function showBullshitBanner(msg){
  const banner = document.getElementById('bs-banner');
  if(!banner) return;
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

  await lobbyRef.transaction(game=>{
    if(!game) game={players:{}, pile:[], currentTurn:playerName, winner:null};
    game.players = game.players || {};
    if(!game.players[playerName]) game.players[playerName] = Array.from({length:5},()=>randomCard());
    // NOTE: we set the client-side playerHand below from snapshot; don't rely on transaction side-effects here
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
}

// --- Toggle Card ---
function toggleCard(idx){
  if(selectedCards.has(idx)) selectedCards.delete(idx);
  else selectedCards.add(idx);
  updateUI();
}

// --- Play Selected ---
async function playSelected(){
  console.log('playSelected called', {joined, selectedCount: selectedCards.size, currentTurn, playerName});
  if(!joined){ console.warn('Not joined'); return; }
  if(selectedCards.size===0){ console.warn('No cards selected'); return; }
  if(currentTurn!==playerName){ console.warn('Not your turn'); return; }

  const indices = [...selectedCards].sort((a,b)=>b-a); // descending
  const lastDeclared = pile.length ? pile[pile.length-1].declared : null;
  const requiredDeclared = lastDeclared ? getNextRank(lastDeclared) : null;

  let declared = prompt(
    requiredDeclared ? `Declare next rank: ${requiredDeclared}` : `Declare any rank`,
    requiredDeclared || (playerHand[indices[0]] ? playerHand[indices[0]].slice(0,-1) : '')
  );
  if(!declared) return;
  declared = declared.toUpperCase();
  if(requiredDeclared && declared!==requiredDeclared){
    alert(`You must declare: ${requiredDeclared}`);
    return;
  }

  try {
    await lobbyRef.transaction(game=>{
      if(!game || !game.players || game.currentTurn!==playerName) return game;
      const hand = game.players[playerName];

      const played = [];
      for(const i of indices){
        if(i>=0 && i<hand.length){
          played.push(hand[i]);
          hand.splice(i,1); // remove card
        }
      }

      game.pile = game.pile || [];
      played.forEach(c => game.pile.push({card:c, declared, player:playerName}));

      if(hand.length===0) game.winner = playerName;

      // Move turn to next player
      const allPlayers = Object.keys(game.players).filter(p=>game.players[p].length>0);
      if(allPlayers.length>0){
        let idx = allPlayers.indexOf(playerName);
        game.currentTurn = allPlayers[(idx+1)%allPlayers.length];
      } else game.currentTurn = null;

      return game;
    });
  } catch(e){
    console.error('playSelected transaction failed', e);
  }

  selectedCards.clear();
}

// --- Draw ---
async function drawCard(){
  console.log('drawCard called', {joined, currentTurn, playerName});
  if(!joined){ console.warn('Not joined'); return; }
  if(currentTurn!==playerName){ console.warn('Not your turn'); return; }
  const newCard = randomCard();
  try {
    await lobbyRef.child('players').child(playerName).transaction(hand=>{
      hand = hand||[];
      hand.push(newCard);
      return hand;
    });
  } catch(e){
    console.error('drawCard transaction failed', e);
  }
}

// --- Call Bullshit ---
async function callBS(){
  console.log('callBS called', {joined, pileLength: pile.length});
  if(!joined || pile.length===0) { console.warn('Cannot call BS - either not joined or pile empty'); return; }
  try {
    await lobbyRef.transaction(game=>{
      if(!game || !game.pile || !game.players) return game;
      const last = game.pile[game.pile.length-1];
      const pileCards = game.pile.map(p=>p.card);

      const lastRank = last.card.slice(0,-1).toUpperCase();
      const declared = last.declared.toUpperCase();

      if(lastRank===declared){
        // caller is wrong
        game.players[playerName] = (game.players[playerName]||[]).concat(pileCards);
      } else {
        // last player lied
        game.players[last.player] = (game.players[last.player]||[]).concat(pileCards);
      }

      game.pile = [];
      game.currentTurn = playerName;
      return game;
    });
    showBullshitBanner("bullshit!");
  } catch(e){
    console.error('callBS transaction failed', e);
  }
}

// --- Leave Lobby ---
async function leaveLobby(){
  if(!joined) return;
  await lobbyRef.child('players').child(playerName).remove();
  if(lobbyUnsub) lobbyRef.off('value', lobbyUnsub);
  if(chatUnsub && chatRef) chatRef.off('child_added', chatUnsub);
  joined=false;
  playerName=""; lobbyName=""; playerHand=[]; pile=[]; currentTurn="";
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
  const div = document.createElement('div');
  div.className='chat-message';
  div.textContent = `${msg.player}: ${msg.text}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// --- Update UI ---
function updateUI(players={}, winner=null){
  const container = document.getElementById('game-container');
  if(container) {
    container.innerHTML='';
    playerHand.forEach((c,i)=>{
      const div = document.createElement('div');
      div.textContent=c;
      div.className='card';
      if(selectedCards.has(i)) div.classList.add('selected');
      div.onclick = ()=>toggleCard(i);
      container.appendChild(div);
    });
  }

  const pileContainer = document.getElementById('pile-container');
  if(pileContainer){
    pileContainer.innerHTML='';
    pile.forEach(p=>{
      const div = document.createElement('div');
      div.textContent = (p.player===playerName) ? `${p.card} (${p.declared})` : `${p.declared} (by ${p.player})`;
      div.className='pile-card';
      pileContainer.appendChild(div);
    });
  }

  const list = document.getElementById('players-list');
  if(list){
    list.innerHTML='';
    Object.entries(players).forEach(([name,hand])=>{
      const li = document.createElement('li');
      li.textContent = `${name} - ${hand.length} card${hand.length!==1?'s':''}`;
      if(name===currentTurn) li.style.fontWeight='bold';
      if(hand.length===0) li.style.textDecoration='underline';
      list.appendChild(li);
    });
  }

  if(document.getElementById('game-info')) {
    document.getElementById('game-info').textContent = `Current Turn: ${currentTurn}`;
  }
  const btnPlay = document.getElementById('btn-play');
  const btnDraw = document.getElementById('btn-draw');
  const btnBS = document.getElementById('btn-bullshit');
  if(btnPlay) btnPlay.disabled = !joined || currentTurn!==playerName || !!winner;
  if(btnDraw) btnDraw.disabled = !joined || currentTurn!==playerName || !!winner;
  if(btnBS) btnBS.disabled = !joined || pile.length===0 || !!winner;

  // chat controls
  const btn = document.getElementById('chat-send');
  const input = document.getElementById('chat-input');
  if(btn && input){ btn.disabled = !joined; input.disabled = !joined; }
}

// --- Event listeners attached after DOM ready ---
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('btn-join').onclick = joinLobby;
  document.getElementById('btn-play').onclick = playSelected;
  document.getElementById('btn-draw').onclick = drawCard;
  document.getElementById('btn-bullshit').onclick = callBS;
  document.getElementById('btn-leave').onclick = leaveLobby;
  document.getElementById('chat-send').onclick = sendChatMessage;
  const chatInput = document.getElementById('chat-input');
  if(chatInput) chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatMessage(); });

  // initial UI render (safe even if DOM not fully populated earlier)
  updateUI();
});
