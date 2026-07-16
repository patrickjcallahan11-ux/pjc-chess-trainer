/**
 * CHESS REPERTOIRE ARCHITECT - PRO ENGINE
 * logic: chess.js + chessboard.js
 * AI: gemini-3.1-flash-lite
 */

// --- 1. CRITICAL INITIALIZATION SEQUENCE ---
let game = new Chess();
let board = null;
let playerColor = null;
let activeRepertoireName = null;
let repertoires = { white: {}, black: {} };

// Memory Gauntlet State
let isTestMode = false;
let correctMovesCount = 0;
let totalMovesCount = 0;
let testStreak = 0;

// LocalStorage Defensive Loader
try {
  const saved = localStorage.getItem('chess_repertoires_v2');
  if (saved) {
    repertoires = JSON.parse(saved);
    if (!repertoires.white) repertoires.white = {};
    if (!repertoires.black) repertoires.black = {};
  }
} catch (e) {
  console.error("Database parsing failed. Resetting.", e);
  repertoires = { white: {}, black: {} };
}

// Global Tracking
let currentActiveFen = ''; 
let cachedMovesData = []; 
let lToken = localStorage.getItem('lichess_token') || '';
let gKey = localStorage.getItem('gemini_api_key') || '';
let playerElo = localStorage.getItem('player_elo') || '1000';

// FEN Utility Helper
const getRepertoireKey = (customFen) => {
  const target = customFen || game.fen();
  return target.split(' ').slice(0, 4).join(' ');
};

// --- 2. STAGE NAVIGATION & MODES ---

function navToStage1() {
  $('.screen').addClass('hidden');
  $('#screen-color-select').removeClass('hidden');
  $('#board-area').addClass('stage-locked');
  playerColor = null;
  isTestMode = false;
}

function navToStage2(side) {
  playerColor = side;
  $('.screen').addClass('hidden');
  $('#screen-rep-manage').removeClass('hidden');
  $('#board-area').addClass('stage-locked');
  $('#manage-title').text(`${side.toUpperCase()} REPERTOIRES`);
  toggleCreateForm(false); // Ensure form is tucked away
  renderRepertoireList();
}

function navToStage3(name) {
  activeRepertoireName = name;
  $('.screen').addClass('hidden');
  $('#screen-workspace').removeClass('hidden');
  $('#board-area').removeClass('stage-locked');
  
  $('#workspace-title').text(name);
  $('#workspace-sub').text(`${playerColor.toUpperCase()} WORKSPACE`);
  
  switchMode('edit');
  game.reset();
  board.start();
  board.orientation(playerColor);
  updatePositionData();
}

function switchMode(mode) {
  if (mode === 'test') {
    isTestMode = true;
    $('#test-mode-btn').addClass('active');
    $('#edit-mode-btn').removeClass('active');
    $('#screen-workspace').addClass('test-mode-active');
    document.getElementById('test-panel').style.display = 'flex';
    initTest();
  } else {
    isTestMode = false;
    $('#edit-mode-btn').addClass('active');
    $('#test-mode-btn').removeClass('active');
    $('#screen-workspace').removeClass('test-mode-active');
    document.getElementById('test-panel').style.display = 'none';
    game.reset();
    board.start();
    updatePositionData();
  }
}

// --- 3. REPERTOIRE MANAGEMENT UI LOGIC (Instruction 4) ---

function toggleCreateForm(show) {
  if (show) {
    $('#show-create-form-btn').addClass('hidden');
    $('#create-rep-form').removeClass('hidden');
    $('#new-rep-name').focus();
  } else {
    $('#show-create-form-btn').removeClass('hidden');
    $('#create-rep-form').addClass('hidden');
    $('#new-rep-name').val(''); // Clear input
  }
}

// --- 4. MEMORY GAUNTLET LOGIC ---

function initTest() {
  correctMovesCount = 0;
  totalMovesCount = 0;
  testStreak = 0;
  game.reset();
  board.start();
  updateTestUI("🔥 Test Started! Play your opening move.", "neutral");

  if (playerColor === 'black') {
    setTimeout(playOpponentTestMove, 600);
  }
}

function playOpponentTestMove() {
  const legalMoves = game.moves();
  const playableOpponentMoves = [];

  legalMoves.forEach(m => {
    const temp = new Chess(game.fen());
    temp.move(m);
    const nextKey = getRepertoireKey(temp.fen());
    if (repertoires[playerColor] && repertoires[playerColor][activeRepertoireName] && repertoires[playerColor][activeRepertoireName][nextKey]) {
      playableOpponentMoves.push(m);
    }
  });

  if (playableOpponentMoves.length > 0) {
    const chosen = playableOpponentMoves[Math.floor(Math.random() * playableOpponentMoves.length)];
    game.move(chosen);
    board.position(game.fen());
    updateTestUI(`Opponent played ${chosen}. Your response?`, "neutral");
  } else {
    updateTestUI("🎉 End of saved line reached! Reset to test again.", "success");
  }
}

function updateTestUI(msg, status) {
  $('#test-status-msg').text(msg);
  const accuracy = totalMovesCount === 0 ? 100 : Math.round((correctMovesCount / totalMovesCount) * 100);
  $('#accuracy-display').text(`${accuracy}% (${correctMovesCount}/${totalMovesCount})`);
  $('#streak-display').text(`🔥 ${testStreak}`);
}

function handleHint() {
  const key = getRepertoireKey();
  const expected = repertoires[playerColor]?.[activeRepertoireName]?.[key];
  if (expected) {
    $('#test-status-msg').text(`Hint: Your saved move starts with ${expected.charAt(0)}...`);
  }
}

// --- 5. BUILDER ENGINE (EDIT MODE) ---

async function updatePositionData() {
  if (isTestMode || !playerColor || !activeRepertoireName) return;

  currentActiveFen = game.fen();
  const requestFen = currentActiveFen;
  const encodedFen = encodeURIComponent(requestFen);

  $('#eval-score').text('...');
  $('#move-list').html('<div class="status-msg">Analyzing theory...</div>');
  
  const coachOutput = document.getElementById('ai-coach-output');
  if (coachOutput) {
     coachOutput.textContent = localStorage.getItem('gemini_api_key') ? "Coach is thinking..." : "Enter API Key in Settings to activate coach.";
  }

  fetchCurrentEval(encodedFen, requestFen);
  fetchExplorerData(encodedFen, requestFen);
}

function renderMoveTable() {
  const $list = $('#move-list');
  const fenKey = getRepertoireKey();
  const savedMove = repertoires[playerColor]?.[activeRepertoireName]?.[fenKey] || null;
  const isUserTurn = (playerColor === 'white' && game.turn() === 'w') || (playerColor === 'black' && game.turn() === 'b');

  if (cachedMovesData.length === 0) {
    $list.html('<div class="status-msg">End of known theory.</div>');
    analyzeBlindSpots([]);
    return;
  }

  $list.empty();
  cachedMovesData.forEach((m) => {
    const isSaved = (savedMove === m.san);
    const starHtml = isUserTurn ? `<span class="star-btn ${isSaved ? 'star-active' : ''}" onclick="handleStarClick(event, '${m.san}')">${isSaved ? '★' : '☆'}</span>` : '';

    $list.append(`
      <div class="move-row ${isSaved && isUserTurn ? 'repertoire-move' : ''}">
        <div class="badge-container">${starHtml}<button class="move-btn" onclick="handleExplorerMove('${m.san}')">${m.san}</button></div>
        <span class="stat">${m.mPct}%</span><span class="stat">${m.cPct}%</span><span class="eval-cell">${m.eval || '...'}</span>
      </div>
    `);
  });
  analyzeBlindSpots(cachedMovesData);
}

// --- 6. AI COACH ---

async function triggerCoach() {
    if (typeof isTestMode !== 'undefined' && isTestMode) return; 

    const coachElement = document.getElementById('ai-coach-output');
    if (!coachElement) return;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        coachElement.textContent = "Please enter your API Key in the settings below to activate your coach!";
        return;
    }

    const currentFen = game.fen();
    const activeElo = document.getElementById('elo-selector')?.value || '1000';
    const history = game.history();
    const lastMove = history.length > 0 ? history[history.length - 1] : 'None';
    const turnColor = game.turn() === 'w' ? 'Black' : 'White'; 

    let savedToPass = "None (Opponent's turn to move)";
    if (game.turn() === (playerColor ? playerColor[0] : 'w')) {
        savedToPass = (repertoires[playerColor] && repertoires[playerColor][activeRepertoireName]) ? (repertoires[playerColor][activeRepertoireName][getRepertoireKey()] || "None saved yet") : "None saved yet";
    }

    const promptText = `Act as an expert chess coach for an Elo ${activeElo} player building a ${playerColor} repertoire. Board: "${currentFen}". History: ${history.join(' ')}. Saved move: ${savedToPass}. 2 bullets. Bold (wrap in **) squares or moves. Under 60 words.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [ { parts: [ { text: promptText } ] } ] })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText && game.fen() === currentFen) {
            const formatted = replyText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
            $(coachElement).fadeOut(200, function() { $(this).html(formatted).fadeIn(200); });
        }
    } catch (error) { console.error("Coach API Error:", error); }
}

// --- 7. CORE HANDLERS & AUTO-SAVE ---

const config = {
  draggable: true,
  position: 'start',
  pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
  onDrop: (source, target) => {
    const beforeKey = getRepertoireKey();
    const currentTurn = game.turn();
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    if (isTestMode) {
      const expected = repertoires[playerColor]?.[activeRepertoireName]?.[beforeKey];
      if (move.san === expected) {
        correctMovesCount++; totalMovesCount++; testStreak++;
        updateTestUI("✨ Correct!", "success");
        setTimeout(playOpponentTestMove, 600);
      } else {
        game.undo(); totalMovesCount++; testStreak = 0;
        updateTestUI(`❌ Incorrect! Expected: ${expected || 'not set'}.`, "error");
        return 'snapback';
      }
    } else {
      const wasUser = (playerColor === 'white' && currentTurn === 'w') || (playerColor === 'black' && currentTurn === 'b');
      if (playerColor && activeRepertoireName && wasUser) {
        if (!repertoires[playerColor][activeRepertoireName]) repertoires[playerColor][activeRepertoireName] = {};
        repertoires[playerColor][activeRepertoireName][beforeKey] = move.san;
        localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
      }
      window.setTimeout(updatePositionData, 250);
    }
  },
  onSnapEnd: () => board.position(game.fen())
};

function analyzeBlindSpots(candidateMoves) {
  const $gap = $('#gap-analyzer-container').addClass('hidden').empty();
  const isOpponentTurn = (playerColor === 'white' && game.turn() === 'b') || (playerColor === 'black' && game.turn() === 'w');
  if (!isOpponentTurn || isTestMode || !playerColor) return;

  const blindSpots = candidateMoves.filter(m => m.cPct >= 15).filter(move => {
    const temp = new Chess(game.fen());
    temp.move(move.san);
    const key = getRepertoireKey(temp.fen());
    return !(repertoires[playerColor] && repertoires[playerColor][activeRepertoireName] && repertoires[playerColor][activeRepertoireName][key]);
  });

  if (blindSpots.length > 0) {
    $gap.removeClass('hidden').addClass('gap-warning').append('<div class="gap-header">⚠️ Position Blind Spots</div>');
    blindSpots.forEach(m => $gap.append(`<button class="gap-item" onclick="handleExplorerMove('${m.san}')">${m.cPct}% reply ${m.san}. Need response!</button>`));
  } else if (candidateMoves.length > 0) {
    $gap.removeClass('hidden').addClass('gap-success').html('<div class="gap-header">✅ 100% Covered!</div>');
  }
}

// --- 8. EXTERNAL API DATA FETCHING ---

async function fetchCurrentEval(encodedFen, requestFen) {
  try {
    const res = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodedFen}`);
    if (game.fen() !== requestFen) return;
    const data = await res.json();
    $('#eval-score').text(data.pvs ? formatEvalValue(data) : 'Book');
  } catch (e) { $('#eval-score').text('N/A'); }
}

async function fetchExplorerData(encodedFen, requestFen) {
  if (!lToken.trim()) return $('#move-list').html('<div class="status-msg">Token Missing</div>');
  const options = { headers: { 'Authorization': 'Bearer ' + lToken.trim() } };
  try {
    const [mRes, cRes] = await Promise.all([
      fetch(`https://explorer.lichess.ovh/masters?fen=${encodedFen}`, options),
      fetch(`https://explorer.lichess.ovh/lichess?fen=${encodedFen}`, options)
    ]);
    if (game.fen() !== requestFen) return;
    const mData = mRes.ok ? await mRes.json() : { moves: [] };
    const cData = cRes.ok ? await cRes.json() : { moves: [] };
    const tM = (mData.white || 0) + (mData.draws || 0) + (mData.black || 0);
    const tC = (cData.white || 0) + (cData.draws || 0) + (cData.black || 0);
    const movesMap = {};
    mData.moves?.forEach(m => { const count = m.white+(m.draws||0)+m.black; movesMap[m.san] = { san:m.san, mPct: tM>0?Math.round((count/tM)*100):0, mCount:count, cPct:0, eval:'' }; });
    cData.moves?.forEach(m => { const count = m.white+(m.draws||0)+m.black; const pct = tC>0?Math.round((count/tC)*100):0; if(movesMap[m.san]) movesMap[m.san].cPct=pct; else movesMap[m.san]={san:m.san, mPct:0, mCount:0, cPct:pct, eval:''}; });
    cachedMovesData = Object.values(movesMap).sort((a,b) => b.mCount-a.mCount || b.cPct-a.cPct).slice(0, 5);
    renderMoveTable();
    const evalPromises = cachedMovesData.map(async (m) => {
      const temp = new Chess(game.fen());
      if (temp.move(m.san)) {
        try {
          const eRes = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(temp.fen())}`);
          const eData = await eRes.json();
          m.eval = eData.pvs ? formatEvalValue(eData) : 'Book';
        } catch { m.eval = 'Book'; }
      }
      return m;
    });
    Promise.all(evalPromises).then(() => { if (game.fen() === requestFen) { renderMoveTable(); triggerCoach(); } });
  } catch (e) { console.error(e); }
}

function formatEvalValue(data) {
  const pv = data.pvs[0];
  if (pv.mate) return '#M' + Math.abs(pv.mate);
  let score = pv.cp / 100;
  return (score > 0 ? '+' : '') + score.toFixed(1);
}

// --- 9. UI BINDING & EVENTS ---

function renderRepertoireList() {
  const list = $('#repertoire-list').empty();
  const reps = repertoires[playerColor] || {};
  Object.keys(reps).forEach(name => {
    const item = $(`<div class="rep-item"><span>${name}</span><span class="delete-icon">🗑</span></div>`);
    item.on('click', () => navToStage3(name));
    item.find('.delete-icon').on('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${name}"?`)) {
        delete repertoires[playerColor][name];
        localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
        renderRepertoireList();
      }
    });
    list.append(item);
  });
}

window.handleStarClick = (e, m) => { 
  e.stopPropagation(); 
  const key = getRepertoireKey(); 
  if (!repertoires[playerColor][activeRepertoireName]) repertoires[playerColor][activeRepertoireName] = {};
  const rep = repertoires[playerColor][activeRepertoireName]; 
  if (rep[key] === m) delete rep[key]; else rep[key] = m; 
  localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires)); 
  renderMoveTable(); 
};

window.handleExplorerMove = (san) => { if (game.move(san)) { board.position(game.fen()); updatePositionData(); } };

$(document).ready(function() {
  board = Chessboard('board', config);
  
  // Navigation
  $('#btn-build-white').on('click', () => navToStage2('white'));
  $('#btn-build-black').on('click', () => navToStage2('black'));
  $('#back-to-stage1').on('click', navToStage1);
  $('#back-to-stage2').on('click', () => navToStage2(playerColor));
  
  // Create Form Toggle Logic
  $('#show-create-form-btn').on('click', () => toggleCreateForm(true));
  $('#btn-cancel-rep').on('click', () => toggleCreateForm(false));

  // Workspace Modes
  $('#edit-mode-btn').on('click', () => switchMode('edit'));
  $('#test-mode-btn').on('click', () => switchMode('test'));
  $('#reset-test-btn').on('click', initTest);
  $('#hint-btn').on('click', handleHint);

  // Controls
  $('#undo-btn').on('click', () => { game.undo(); board.position(game.fen()); updatePositionData(); });
  $('#reset-btn').on('click', () => { game.reset(); board.start(); updatePositionData(); });
  
  $('#btn-create-rep').on('click', () => {
    const name = $('#new-rep-name').val().trim();
    if (!name || (repertoires[playerColor] && repertoires[playerColor][name])) return alert("Invalid or duplicate Name");
    if (!repertoires[playerColor]) repertoires[playerColor] = {};
    repertoires[playerColor][name] = {};
    localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
    toggleCreateForm(false); // Tuck form away
    renderRepertoireList();
  });

  $('#save-settings').on('click', () => {
    localStorage.setItem('lichess_token', $('#lichess-token').val().trim());
    localStorage.setItem('gemini_api_key', $('#gemini-api-key').val().trim());
    localStorage.setItem('player_elo', $('#elo-selector').val());
    alert("Keys saved! App reloading.");
    location.reload();
  });

  navToStage1();
});