/**
 * CHESS REPERTOIRE ARCHITECT - PRO ENGINE
 * logic: chess.js + chessboard.js
 * AI: gemini-3.1-flash-lite (Ultra-Concise Strategy Edition)
 */

// --- 1. CRITICAL INITIALIZATION SEQUENCE ---
let game = new Chess();
let board = null;
let playerColor = null; // 'white' or 'black'
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
  toggleCreateForm(false);
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
}

function switchMode(mode) {
  isTestMode = (mode === 'test');
  $('.tab-btn').removeClass('active');
  $(`#${mode}-mode-btn`).addClass('active');
  if (isTestMode) {
    $('#screen-workspace').addClass('test-mode-active');
    document.getElementById('test-panel').style.display = 'flex';
    initTest();
  } else {
    $('#screen-workspace').removeClass('test-mode-active');
    document.getElementById('test-panel').style.display = 'none';
    game.reset(); 
    board.start(); 
    board.orientation(playerColor);
    updatePositionData();
  }
}

function toggleCreateForm(show) {
  if (show) {
    $('#show-create-form-btn').addClass('hidden');
    $('#create-rep-form').removeClass('hidden');
    $('#new-rep-name').focus();
  } else {
    $('#show-create-form-btn').removeClass('hidden');
    $('#create-rep-form').addClass('hidden');
  }
}

// --- 3. ANALYSIS CONTROLLER ---

async function updatePositionData() {
  if (isTestMode || !playerColor || !activeRepertoireName) return;
  currentActiveFen = game.fen();
  const requestFen = currentActiveFen;
  $('#eval-score').text('...');
  $('#move-list').html('<div class="status-msg">Analyzing...</div>');
  
  fetchCurrentEval(encodeURIComponent(requestFen), requestFen);
  fetchExplorerData(encodeURIComponent(requestFen), requestFen);
}

// --- 4. AI COACH (ULTRA-CONCISE TURN-BASED LOGIC) ---

async function triggerCoach() {
  if (isTestMode) return;
  const coachElement = document.getElementById('ai-coach-output');
  if (!coachElement) return;
  
  const cleanKey = gKey.trim();
  if (!cleanKey) { 
    coachElement.textContent = "Please enter your API Key in the settings below to activate your coach!"; 
    return; 
  }

  // Detect Context
  const userColor = playerColor ? (playerColor.charAt(0).toUpperCase() + playerColor.slice(1)) : 'White';
  const currentTurn = game.turn() === 'w' ? 'White' : 'Black';
  const moveHistory = game.history();
  const isGameStart = moveHistory.length === 0;
  const isUserTurn = (userColor === currentTurn);
  
  const currentFen = game.fen();
  const lastMove = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : 'None';
  const activeElo = document.getElementById('elo-selector')?.value || '1000';
  const activePersona = document.getElementById('persona-select')?.value || 'club-coach';

  // [INSTRUCTION 2: CONDENSED SCENARIO PROMPTS]
  let promptText = "";

  if (isGameStart) {
    // SCENARIO A: Game Start
    promptText = `You are a chess coach with the ${activePersona} personality. You are coaching the ${userColor} player. The game has not started yet. Do not say hello. Recommend the absolute best first move for ${userColor} and state its main strategic purpose in 1 clear, direct sentence.`;
  } else if (isUserTurn) {
    // SCENARIO B: User Turn
    promptText = `You are a chess coach with the ${activePersona} personality. You are coaching the ${userColor} player. The opponent just played: '${lastMove}'. FEN: '${currentFen}'. Do not say hello or use filler. In 1 or 2 short sentences max, state the immediate threat of '${lastMove}' and the absolute best move/plan for ${userColor} to play right now. Keep it punchy and direct.`;
  } else {
    // SCENARIO C: Opponent Turn
    promptText = `You are a chess coach with the ${activePersona} personality. You are coaching the ${userColor} player, who just played: '${lastMove}'. It is now the opponent's turn. FEN: '${currentFen}'. Do not say hello, validate the user's move with generic praise, or suggest a move for the user. In 1 or 2 short sentences max, state the opponent's most likely response/threat and what candidate moves ${userColor} should prepare to play next.`;
  }

  coachElement.textContent = "Thinking...";

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${cleanKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }]
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const coachText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (coachText && game.fen() === currentFen) {
      // Regex Markdown bolding filter
      const formatted = coachText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      $(coachElement).fadeOut(200, function() { 
          $(this).html(formatted).fadeIn(200); 
      });
    }
  } catch (e) { 
    console.error("Coach API Error:", e);
    if (game.fen() === currentFen) coachElement.textContent = "Coach unavailable.";
  }
}

// --- 5. UI DATA RENDERING & BLIND SPOT ANALYZER ---

function renderMoveTable() {
  const $list = $('#move-list');
  const fenKey = getRepertoireKey();
  const savedMove = repertoires[playerColor]?.[activeRepertoireName]?.[fenKey] || null;
  const isUserTurn = game.turn() === playerColor[0];

  if (cachedMovesData.length === 0) {
    $list.html('<div class="status-msg">End of theory.</div>');
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

function analyzeBlindSpots(candidateMoves) {
  const $gap = $('#gap-analyzer-container');
  $gap.addClass('hidden').empty().removeClass('gap-warning gap-success');

  const isOpponentTurn = game.turn() !== playerColor[0];
  if (!isOpponentTurn || isTestMode || !playerColor) return;

  const blindSpots = candidateMoves.filter(m => m.cPct >= 15).filter(move => {
    const t = new Chess(game.fen());
    t.move(move.san);
    const nextKey = getRepertoireKey(t.fen());
    return !repertoires[playerColor]?.[activeRepertoireName]?.[nextKey];
  });

  if (blindSpots.length > 0) {
    $gap.removeClass('hidden gap-success').addClass('gap-warning');
    $gap.append('<div class="gap-header">⚠️ Blind Spots</div>');
    blindSpots.forEach(m => {
      $gap.append(`<button class="gap-item" onclick="handleExplorerMove('${m.san}')">${m.cPct}% reply ${m.san}. Need response!</button>`);
    });
  } else if (candidateMoves.length > 0) {
    $gap.removeClass('hidden gap-warning').addClass('gap-success');
    $gap.html('<div class="gap-header">✅ 100% Covered!</div>');
  }
}

// --- 6. CORE HANDLERS & AUTO-SAVE ---

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
        correctMovesCount++; totalMovesCount++; testStreak++; updateTestUI("✨ Correct!", "success");
        setTimeout(playOpponentTestMove, 600);
      } else {
        game.undo(); totalMovesCount++; testStreak = 0;
        updateTestUI(`❌ Incorrect! Expected: ${expected || 'None'}`, "error"); 
        return 'snapback';
      }
    } else {
      const wasUser = currentTurn === playerColor[0];
      if (activeRepertoireName && wasUser) {
        if (!repertoires[playerColor][activeRepertoireName]) repertoires[playerColor][activeRepertoireName] = {};
        repertoires[playerColor][activeRepertoireName][beforeKey] = move.san;
        localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
      }
      window.setTimeout(updatePositionData, 250);
    }
  },
  onSnapEnd: () => board.position(game.fen())
};

function initTest() {
  correctMovesCount = 0; totalMovesCount = 0; testStreak = 0;
  game.reset(); board.start(); board.orientation(playerColor);
  updateTestUI("🔥 Test Started!", "neutral");
  if (playerColor === 'black') setTimeout(playOpponentTestMove, 600);
}

function playOpponentTestMove() {
  const legal = game.moves();
  const playable = legal.filter(m => {
    const t = new Chess(game.fen()); t.move(m);
    return repertoires[playerColor]?.[activeRepertoireName]?.[getRepertoireKey(t.fen())];
  });
  if (playable.length > 0) {
    const chosen = playable[Math.floor(Math.random() * playable.length)];
    game.move(chosen); board.position(game.fen());
    updateTestUI(`Opponent played ${chosen}. Your response?`, "neutral");
  } else {
    updateTestUI("🎉 End of saved lines reached!", "success");
  }
}

function updateTestUI(msg, status) {
  $('#test-status-msg').text(msg);
  const acc = totalMovesCount === 0 ? 100 : Math.round((correctMovesCount / totalMovesCount) * 100);
  $('#accuracy-display').text(`${acc}% (${correctMovesCount}/${totalMovesCount})`);
  $('#streak-display').text(`🔥 ${testStreak}`);
}

function handleHint() {
  const key = getRepertoireKey();
  const expected = repertoires[playerColor]?.[activeRepertoireName]?.[key];
  if (expected) {
    $('#test-status-msg').text(`Hint: Your saved move is ${expected}.`);
  }
}

// --- 7. DATA FETCHING ---

async function fetchCurrentEval(encodedFen, requestFen) {
  try {
    const res = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodedFen}`);
    const data = await res.json();
    if (game.fen() === requestFen) $('#eval-score').text(data.pvs ? formatEvalValue(data) : 'Book');
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

    const $openingHeader = $('#opening-name-display');
    if (game.history().length === 0) {
      $openingHeader.text("Starting Position");
    } else {
      $openingHeader.text(mData?.opening?.name || cData?.opening?.name || "Open Analysis");
    }

    const tM = (mData.white || 0) + (mData.draws || 0) + (mData.black || 0);
    const tC = (cData.white || 0) + (cData.draws || 0) + (cData.black || 0);
    const movesMap = {};
    mData.moves?.forEach(m => { const count = m.white+(m.draws||0)+m.black; movesMap[m.san] = { san:m.san, mPct: tM>0?Math.round((count/tM)*100):0, mCount:count, cPct:0, eval:'' }; });
    cData.moves?.forEach(m => { const count = m.white+(m.draws||0)+m.black; const pct = tC>0?Math.round((count/tC)*100):0; if(movesMap[m.san]) movesMap[m.san].cPct=pct; else movesMap[m.san]={san:m.san, mPct:0, mCount:0, cPct:pct, eval:''}; });
    
    cachedMovesData = Object.values(movesMap).sort((a,b) => b.mCount - a.mCount || b.cPct - a.cPct).slice(0, 5);
    renderMoveTable();

    const evalPromises = cachedMovesData.map(async (m) => {
      const t = new Chess(game.fen()); t.move(m.san);
      try {
        const eRes = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(t.fen())}`);
        const eData = await eRes.json(); m.eval = eData.pvs ? formatEvalValue(eData) : 'Book';
      } catch { m.eval = 'Book'; }
      return m;
    });
    
    Promise.all(evalPromises).then(() => { 
      if (game.fen() === requestFen) { 
        renderMoveTable(); 
        triggerCoach(); 
      } 
    });
  } catch (e) { console.error(e); }
}

function formatEvalValue(data) {
  const pv = data.pvs[0];
  if (pv.mate) return '#M' + Math.abs(pv.mate);
  return (pv.cp / 100 > 0 ? '+' : '') + (pv.cp / 100).toFixed(1);
}

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

// --- 8. BINDINGS & EVENT LISTENERS ---

window.handleStarClick = (e, m) => {
  e.stopPropagation(); 
  const key = getRepertoireKey();
  if (!repertoires[playerColor][activeRepertoireName]) repertoires[playerColor][activeRepertoireName] = {};
  const rep = repertoires[playerColor][activeRepertoireName];
  if (rep[key] === m) delete rep[key]; else rep[key] = m;
  localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires)); 
  renderMoveTable();
};

window.handleExplorerMove = (san) => { 
  if (game.move(san)) { 
    board.position(game.fen()); 
    updatePositionData(); 
  } 
};

$(document).ready(function() {
  board = Chessboard('board', config);

  // Stage Navigation
  $('#btn-build-white').on('click', () => navToStage2('white'));
  $('#btn-build-black').on('click', () => navToStage2('black'));
  $('#back-to-stage1').on('click', navToStage1);
  $('#back-to-stage2').on('click', () => navToStage2(playerColor));
  $('#show-create-form-btn').on('click', () => toggleCreateForm(true));
  $('#btn-cancel-rep').on('click', () => toggleCreateForm(false));

  // Workspace Mode Toggles
  $('#edit-mode-btn').on('click', () => switchMode('edit'));
  $('#test-mode-btn').on('click', () => switchMode('test'));
  $('#reset-test-btn').on('click', initTest);
  $('#hint-btn').on('click', handleHint);

  // Undo and Reset
  $('#undo-btn').on('click', () => { 
    game.undo(); 
    board.position(game.fen()); 
    updatePositionData(); 
  });

  $('#reset-btn').on('click', () => { 
    game.reset(); 
    board.start(); 
    updatePositionData(); 
  });

  // Repertoire Creation
  $('#btn-create-rep').on('click', () => {
    const name = $('#new-rep-name').val().trim();
    if (!name || (repertoires[playerColor] && repertoires[playerColor][name])) return alert("Invalid Name");
    if (!repertoires[playerColor]) repertoires[playerColor] = {};
    repertoires[playerColor][name] = {};
    localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
    toggleCreateForm(false); 
    renderRepertoireList();
  });

  // Settings
  $('#save-settings').on('click', () => {
    localStorage.setItem('lichess_token', $('#lichess-token').val().trim());
    localStorage.setItem('gemini_api_key', $('#gemini-api-key').val().trim());
    localStorage.setItem('player_elo', $('#elo-selector').val());
    alert("Saved!"); 
    location.reload();
  });

  // Select Triggers
  $('#elo-selector, #persona-select').on('change', function() {
    triggerCoach();
  });

  navToStage1();
});