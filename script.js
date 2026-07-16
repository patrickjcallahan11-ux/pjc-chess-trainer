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

// Defensive LocalStorage Loader
try {
  const saved = localStorage.getItem('chess_repertoires_v2');
  if (saved) {
    repertoires = JSON.parse(saved);
    if (!repertoires.white) repertoires.white = {};
    if (!repertoires.black) repertoires.black = {};
  }
} catch (e) {
  console.error("Database parsing failed.", e);
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

// --- 2. STAGE NAVIGATION ---

function navToStage1() {
  $('.screen').addClass('hidden');
  $('#screen-color-select').removeClass('hidden');
  $('#board-area').addClass('stage-locked');
  playerColor = null;
  activeRepertoireName = null;
}

function navToStage2(side) {
  playerColor = side;
  $('.screen').addClass('hidden');
  $('#screen-rep-manage').removeClass('hidden');
  $('#board-area').addClass('stage-locked');
  $('#manage-title').text(`${side.toUpperCase()} REPERTOIRES`);
  renderRepertoireList();
}

function navToStage3(name) {
  activeRepertoireName = name;
  $('.screen').addClass('hidden');
  $('#screen-workspace').removeClass('hidden');
  $('#board-area').removeClass('stage-locked');
  $('#workspace-title').text(name);
  $('#workspace-sub').text(`${playerColor.toUpperCase()} WORKSPACE`);
  game.reset();
  board.start();
  board.orientation(playerColor);
  updatePositionData();
}

function renderRepertoireList() {
  const list = $('#repertoire-list').empty();
  const reps = repertoires[playerColor] || {};
  Object.keys(reps).forEach(name => {
    const item = $(`<div class="rep-item"><span class="rep-name">${name}</span><span class="delete-icon">🗑</span></div>`);
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

$('#btn-create-rep').on('click', () => {
  const name = $('#new-rep-name').val().trim();
  if (!name || repertoires[playerColor][name]) return alert("Invalid or existing name.");
  repertoires[playerColor][name] = {};
  localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
  $('#new-rep-name').val('');
  renderRepertoireList();
});

// --- 3. ANALYSIS CONTROLLER ---

async function updatePositionData() {
  if (!playerColor || !activeRepertoireName) return;
  currentActiveFen = game.fen();
  const requestFen = currentActiveFen;
  $('#eval-score').text('...');
  $('#move-list').html('<div class="status-msg">Analyzing...</div>');
  $('#ai-coach-output').text(gKey.trim() ? "Thinking..." : "Set Gemini Key.");
  
  fetchCurrentEval(encodeURIComponent(requestFen), requestFen);
  fetchExplorerData(encodeURIComponent(requestFen), requestFen);
}

// --- 4. UI DATA GRID & BLIND SPOT ANALYZER ---

function renderMoveTable() {
  const $list = $('#move-list');
  const fenKey = getRepertoireKey();
  const savedMove = repertoires[playerColor]?.[activeRepertoireName]?.[fenKey] || null;
  const isUserTurn = (playerColor === 'white' && game.turn() === 'w') || (playerColor === 'black' && game.turn() === 'b');

  if (cachedMovesData.length === 0) {
    $list.html('<div class="status-msg">End of theory.</div>');
    analyzeBlindSpots([]);
    return;
  }

  $list.empty();
  cachedMovesData.forEach((m) => {
    const isSaved = (savedMove === m.san);
    const shouldHighlight = isSaved && isUserTurn;
    const starHtml = isUserTurn ? `<span class="star-btn ${isSaved ? 'star-active' : ''}" onclick="handleStarClick(event, '${m.san}')">${isSaved ? '★' : '☆'}</span>` : '';

    $list.append(`
      <div class="move-row ${shouldHighlight ? 'repertoire-move' : ''}">
        <div class="badge-container">${starHtml}<button class="move-btn" onclick="handleExplorerMove('${m.san}')">${m.san}</button></div>
        <span class="stat">${m.mPct}%</span><span class="stat">${m.cPct}%</span><span class="eval-cell">${m.eval || '...'}</span>
      </div>
    `);
  });
  analyzeBlindSpots(cachedMovesData);
}

function handleStarClick(e, move) {
  e.stopPropagation();
  const fenKey = getRepertoireKey();
  const activeRep = repertoires[playerColor][activeRepertoireName];
  if (activeRep[fenKey] === move) delete activeRep[fenKey];
  else activeRep[fenKey] = move;
  localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
  renderMoveTable();
}

function analyzeBlindSpots(candidateMoves) {
  const $gap = $('#gap-analyzer-container').addClass('hidden').empty();
  const isOpponentTurn = (playerColor === 'white' && game.turn() === 'b') || (playerColor === 'black' && game.turn() === 'w');
  if (!isOpponentTurn || !playerColor) return;

  const blindSpots = [];
  candidateMoves.forEach(move => {
    if (move.cPct >= 15) {
      const temp = new Chess(game.fen());
      if (temp.move(move.san)) {
        const nextKey = getRepertoireKey(temp.fen());
        if (!repertoires[playerColor]?.[activeRepertoireName]?.[nextKey]) blindSpots.push(move);
      }
    }
  });

  if (blindSpots.length > 0) {
    $gap.removeClass('hidden gap-success').addClass('gap-warning').append('<div class="gap-header">⚠️ Blind Spots</div>');
    blindSpots.forEach(m => {
      $gap.append(`<button class="gap-item" onclick="handleExplorerMove('${m.san}')">${m.cPct}% reply ${m.san}. Need response!</button>`);
    });
  } else if (candidateMoves.length > 0) {
    $gap.removeClass('hidden gap-warning').addClass('gap-success').html('<div class="gap-header">✅ 100% Covered!</div>');
  }
}

// --- 5. AI COACH ---

async function triggerCoachWithContext(requestFen, history, movesWithEvals) {
  if (!gKey.trim()) return;
  let savedMoveToPass = "None (Opponent's turn to move)";
  if (game.turn() === playerColor[0]) {
    savedMoveToPass = repertoires[playerColor][activeRepertoireName][getRepertoireKey()] || "None saved yet";
  }
  const moveDataString = movesWithEvals.map(m => `${m.san} (Club:${m.cPct}%, Eval:${m.eval})`).join(', ');
  const promptBody = { contents: [{ parts: [{ text: `Coach user training ${playerColor} ${activeRepertoireName} at ${playerElo} Elo. FEN: ${requestFen}. Data: ${moveDataString}. Saved: ${savedMoveToPass}. Directives: Support saved choice unless it blunders. Explain piece goals. Rules: No greeting. 2 short bullets. Bold (**) ONLY moves/squares. Under 60 words.` }] }] };

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${gKey.trim()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(promptBody) });
    if (game.fen() !== requestFen) return;
    const data = await res.json();
    const coachText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (coachText) {
      const formatted = coachText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      $('#ai-coach-output').fadeOut(200, function() { $(this).html(formatted).fadeIn(200); });
    }
  } catch (e) { if (game.fen() === requestFen) $('#ai-coach-output').text("AI Offline."); }
}

// --- 6. DATA FETCHING ---

async function fetchCurrentEval(encodedFen, requestFen) {
  try {
    const res = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodedFen}`);
    if (game.fen() !== requestFen) return;
    const data = await res.json();
    $('#eval-score').text(data.pvs ? formatEvalValue(data) : 'Book');
  } catch (e) { if (game.fen() === requestFen) $('#eval-score').text('N/A'); }
}

async function fetchExplorerData(encodedFen, requestFen) {
  if (!lToken.trim()) return $('#move-list').html('<div class="status-msg">Token Missing.</div>');
  const options = { headers: { 'Authorization': 'Bearer ' + lToken.trim() } };
  try {
    const [mRes, cRes] = await Promise.all([fetch(`https://explorer.lichess.ovh/masters?fen=${encodedFen}`, options), fetch(`https://explorer.lichess.ovh/lichess?fen=${encodedFen}`, options)]);
    if (game.fen() !== requestFen) return;
    const mData = mRes.ok ? await mRes.json() : { moves: [] };
    const cData = cRes.ok ? await cRes.json() : { moves: [] };
    $('#opening-name').text(mData?.opening?.name || cData?.opening?.name || "Open Analysis");
    const tM = (mData.white || 0) + (mData.draws || 0) + (mData.black || 0);
    const tC = (cData.white || 0) + (cData.draws || 0) + (cData.black || 0);
    const movesMap = {};
    mData.moves?.forEach(m => { const count = m.white+m.draws+m.black; movesMap[m.san] = { san:m.san, mPct: tM>0?Math.round((count/tM)*100):0, mCount:count, cPct:0, eval:'' }; });
    cData.moves?.forEach(m => { const count = m.white+m.draws+m.black; const pct = tC>0?Math.round((count/tC)*100):0; if(movesMap[m.san]) movesMap[m.san].cPct=pct; else movesMap[m.san]={san:m.san, mPct:0, mCount:0, cPct:pct, eval:''}; });
    cachedMovesData = Object.values(movesMap).sort((a,b) => b.mCount - a.mCount || b.cPct - a.cPct).slice(0, 5);
    renderMoveTable();
    const evalPromises = cachedMovesData.map(async (m) => {
      const temp = new Chess(game.fen());
      if (temp.move(m.san)) {
        try {
          const eRes = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(temp.fen())}`);
          if (game.fen() !== requestFen) return null;
          const eData = await eRes.json();
          m.eval = eData.pvs ? formatEvalValue(eData) : 'Book';
        } catch { m.eval = 'Book'; }
      }
      return m;
    });
    Promise.all(evalPromises).then(() => { if (game.fen() === requestFen) { renderMoveTable(); triggerCoachWithContext(requestFen, game.history(), cachedMovesData); } });
  } catch (e) { if (game.fen() === requestFen) $('#move-list').html('<div class="status-msg">Explorer Offline</div>'); }
}

function formatEvalValue(data) {
  const pv = data.pvs[0];
  if (pv.mate) return '#M' + Math.abs(pv.mate);
  let score = pv.cp / 100;
  return (score > 0 ? '+' : '') + score.toFixed(1);
}

// --- 7. BOARD CONFIG & AUTO-SAVE ---

window.handleExplorerMove = (san) => { if (game.move(san)) { board.position(game.fen()); updatePositionData(); } };

const config = {
  draggable: true, position: 'start', pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
  onDrop: (source, target) => {
    const beforeKey = getRepertoireKey();
    const currentTurn = game.turn();
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';
    const wasUser = (playerColor === 'white' && currentTurn === 'w') || (playerColor === 'black' && currentTurn === 'b');
    if (playerColor && activeRepertoireName && wasUser) {
      repertoires[playerColor][activeRepertoireName][beforeKey] = move.san;
      localStorage.setItem('chess_repertoires_v2', JSON.stringify(repertoires));
    }
    window.setTimeout(updatePositionData, 250);
  },
  onSnapEnd: () => board.position(game.fen())
};

$(document).ready(function() {
  board = Chessboard('board', config);
  $('#btn-build-white').on('click', () => navToStage2('white'));
  $('#btn-build-black').on('click', () => navToStage2('black'));
  $('#back-to-stage1').on('click', navToStage1);
  $('#back-to-stage2').on('click', () => navToStage2(playerColor));
  $('#undo-btn').on('click', () => { game.undo(); board.position(game.fen()); updatePositionData(); });
  $('#reset-btn').on('click', () => { game.reset(); board.start(); updatePositionData(); });
  $('#save-settings').on('click', () => {
    localStorage.setItem('lichess_token', $('#lichess-token').val().trim());
    localStorage.setItem('gemini_api_key', $('#gemini-api-key').val().trim());
    localStorage.setItem('player_elo', $('#elo-selector').val());
    location.reload();
  });
});