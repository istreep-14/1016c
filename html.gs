/**
 * WORKING LICHESS HTML SCRAPER
 * Based on debug findings - extracts the page-init-data correctly!
 */

// ============================================================================
// MAIN FUNCTION - Fetch game data from HTML
// ============================================================================

function fetchLichessGame(gameId) {
  if (!gameId) {
    Logger.log('Error: No game ID provided');
    return null;
  }
  
  const url = `https://lichess.org/${gameId}`;
  
  try {
    Logger.log(`Fetching game: ${url}`);
    
    const response = UrlFetchApp.fetch(url, {
      'muteHttpExceptions': true,
      'headers': {
        'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)'
      }
    });
    
    const html = response.getContentText();
    const statusCode = response.getResponseCode();
    
    Logger.log(`Status: ${statusCode}`);
    Logger.log(`HTML length: ${html.length}`);
    
    if (statusCode !== 200) {
      Logger.log(`Error: HTTP ${statusCode}`);
      return null;
    }
    
    // Extract page init data using the pattern that WORKS
    const pageInitData = extractPageInitData(html);
    
    if (!pageInitData) {
      Logger.log('⚠️ Could not extract page-init-data');
      return null;
    }
    
    // The data structure is: cfg.data contains the actual game data
    const gameData = pageInitData.cfg?.data || pageInitData.data || pageInitData;
    
    if (!gameData.game) {
      Logger.log('⚠️ No game data found in page-init-data');
      Logger.log('Available keys: ' + Object.keys(gameData).join(', '));
      return null;
    }
    
    // Parse the comprehensive game data
    const parsed = parseGameData(gameId, gameData);
    
    Logger.log('✅ Game data extracted successfully!');
    return parsed;
    
  } catch (error) {
    Logger.log(`❌ Error fetching game: ${error.toString()}`);
    Logger.log('Stack trace: ' + error.stack);
    return null;
  }
}

// ============================================================================
// EXTRACT PAGE INIT DATA
// ============================================================================

function extractPageInitData(html) {
  // Pattern that we know works from debug output
  const pattern = /<script[^>]*id=["']page-init-data["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = html.match(pattern);
  
  if (match && match[1]) {
    try {
      const jsonText = match[1].trim().replace(/;?\s*$/, '');
      return JSON.parse(jsonText);
    } catch (e) {
      Logger.log(`Parse failed: ${e.toString()}`);
      Logger.log('First 500 chars of matched text:');
      Logger.log(match[1].substring(0, 500));
      return null;
    }
  }
  
  Logger.log('Pattern did not match');
  return null;
}

// ============================================================================
// PARSE GAME DATA
// ============================================================================

function parseGameData(gameId, data) {
  const game = data.game;
  const treeParts = data.treeParts || [];
  
  // Calculate moves and plys
  const totalPlys = game.turns || 0;
  const totalMoves = Math.ceil(totalPlys / 2);
  
  // Parse all moves with detailed info from treeParts
  const movesData = parseMovesFromTreeParts(treeParts);
  
  // Get opening progression
  const openingProgression = extractOpeningProgression(treeParts);
  
  // Get final opening
  const finalOpening = game.opening || openingProgression[openingProgression.length - 1] || null;
  
  // Parse players
  const players = {
    white: parsePlayer(data.player?.color === 'white' ? data.player : data.opponent, 'white'),
    black: parsePlayer(data.player?.color === 'black' ? data.player : data.opponent, 'black')
  };
  
  // Parse result
  const result = {
    status: game.status?.name || 'unknown',
    winner: game.winner || 'draw'
  };
  
  // Parse timing
  const timing = {
    speed: game.speed,
    rated: game.rated,
    timeControl: game.clock ? `${game.clock.initial}+${game.clock.increment}` : null,
    clockInitial: game.clock?.initial,
    clockIncrement: game.clock?.increment,
    createdAt: game.createdAt ? new Date(game.createdAt) : null
  };
  
  return {
    gameId: gameId,
    url: `https://lichess.org/${gameId}`,
    
    // Game info
    totalPlys: totalPlys,
    totalMoves: totalMoves,
    players: players,
    result: result,
    timing: timing,
    
    // Opening info
    finalOpening: finalOpening,
    openingProgression: openingProgression,
    
    // Detailed moves
    moves: movesData,
    
    // Raw data for advanced use
    rawData: data,
    
    fetchedAt: new Date()
  };
}

// ============================================================================
// PARSE MOVES FROM TREEPARTS
// ============================================================================

function parseMovesFromTreeParts(treeParts) {
  if (!treeParts || treeParts.length === 0) {
    return [];
  }
  
  const moves = [];
  let currentOpening = null;
  
  for (let i = 0; i < treeParts.length; i++) {
    const part = treeParts[i];
    const ply = part.ply;
    
    // Skip ply 0 (starting position)
    if (ply === 0) {
      continue;
    }
    
    // Update current opening if this move has opening info
    if (part.opening) {
      currentOpening = part.opening;
    }
    
    // Calculate move number
    const moveNumber = Math.ceil(ply / 2);
    const color = ply % 2 === 1 ? 'white' : 'black';
    
    // Parse FEN
    const fenData = parseFEN(part.fen);
    
    // Parse evaluation
    const evaluation = parseEvaluation(part.eval);
    
    // Create move object
    const moveData = {
      ply: ply,
      moveNumber: moveNumber,
      color: color,
      
      // Move notation
      san: part.san || null,
      uci: part.uci || null,
      
      // Board position
      fen: part.fen,
      board: fenData.board,
      activeColor: fenData.activeColor,
      castling: fenData.castling,
      enPassant: fenData.enPassant,
      halfmove: fenData.halfmove,
      fullmove: fenData.fullmove,
      
      // Evaluation
      evaluation: evaluation,
      
      // Opening at this ply
      opening: currentOpening,
      
      // Clock time (centiseconds)
      clock: part.clock || null,
      clockSeconds: part.clock ? part.clock / 100 : null,
      
      // Move ID
      id: part.id || null
    };
    
    moves.push(moveData);
  }
  
  return moves;
}

// ============================================================================
// FEN PARSING
// ============================================================================

function parseFEN(fen) {
  if (!fen) {
    return {
      board: null,
      activeColor: null,
      castling: null,
      enPassant: null,
      halfmove: null,
      fullmove: null
    };
  }
  
  const parts = fen.split(' ');
  
  return {
    board: parts[0] || null,
    activeColor: parts[1] === 'w' ? 'white' : 'black',
    castling: parts[2] !== '-' ? parts[2] : null,
    enPassant: parts[3] !== '-' ? parts[3] : null,
    halfmove: parts[4] ? parseInt(parts[4]) : null,
    fullmove: parts[5] ? parseInt(parts[5]) : null
  };
}

// ============================================================================
// EVALUATION PARSING
// ============================================================================

function parseEvaluation(evalData) {
  if (!evalData) {
    return {
      type: null,
      value: null,
      displayValue: null
    };
  }
  
  // Centipawn evaluation
  if (evalData.cp !== undefined) {
    const cp = evalData.cp;
    return {
      type: 'centipawns',
      value: cp,
      displayValue: (cp / 100).toFixed(2),
      advantage: cp > 0 ? 'white' : cp < 0 ? 'black' : 'equal'
    };
  }
  
  // Mate evaluation
  if (evalData.mate !== undefined) {
    const mate = evalData.mate;
    return {
      type: 'mate',
      value: mate,
      displayValue: `M${Math.abs(mate)}`,
      advantage: mate > 0 ? 'white' : 'black',
      matingIn: Math.abs(mate)
    };
  }
  
  return {
    type: null,
    value: null,
    displayValue: null
  };
}

// ============================================================================
// OPENING PROGRESSION
// ============================================================================

function extractOpeningProgression(treeParts) {
  const openings = [];
  const seen = new Set();
  
  for (const part of treeParts) {
    if (part.opening) {
      const key = `${part.opening.eco}-${part.opening.name}`;
      
      if (!seen.has(key)) {
        openings.push({
          eco: part.opening.eco,
          name: part.opening.name,
          ply: part.ply
        });
        seen.add(key);
      }
    }
  }
  
  return openings;
}

// ============================================================================
// PLAYER PARSING
// ============================================================================

function parsePlayer(playerData, color) {
  if (!playerData) {
    return {
      name: 'Anonymous',
      rating: null,
      color: color
    };
  }
  
  return {
    name: playerData.name || 'Anonymous',
    userId: playerData.userId || playerData.id || null,
    rating: playerData.rating || null,
    color: color,
    title: playerData.title || null
  };
}

// ============================================================================
// ANALYSIS
// ============================================================================

function analyzeMoves(moves) {
  const analysis = {
    blunders: [],
    mistakes: [],
    inaccuracies: [],
    brilliant: [],
    book: []
  };
  
  for (let i = 1; i < moves.length; i++) {
    const prevMove = moves[i - 1];
    const currentMove = moves[i];
    
    if (!prevMove.evaluation || !currentMove.evaluation) continue;
    if (prevMove.evaluation.type !== 'centipawns' || currentMove.evaluation.type !== 'centipawns') continue;
    
    const prevEval = prevMove.evaluation.value;
    const currentEval = currentMove.evaluation.value;
    
    const effectiveEvalChange = currentMove.color === 'white' 
      ? currentEval - prevEval 
      : prevEval - currentEval;
    
    if (effectiveEvalChange < -300) {
      analysis.blunders.push(currentMove);
    } else if (effectiveEvalChange < -150) {
      analysis.mistakes.push(currentMove);
    } else if (effectiveEvalChange < -50) {
      analysis.inaccuracies.push(currentMove);
    } else if (effectiveEvalChange > 100) {
      analysis.brilliant.push(currentMove);
    }
    
    if (currentMove.opening) {
      analysis.book.push(currentMove);
    }
  }
  
  return analysis;
}

// ============================================================================
// SHEET FUNCTIONS
// ============================================================================

function writeGameToSheet(gameId) {
  const gameData = fetchLichessGame(gameId);
  
  if (!gameData) {
    Logger.log('Failed to fetch game data');
    return;
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const row = sheet.getLastRow() + 1;
  
  sheet.getRange(row, 1).setValue(gameId);
  sheet.getRange(row, 2).setValue(gameData.players.white.name);
  sheet.getRange(row, 3).setValue(gameData.players.white.rating);
  sheet.getRange(row, 4).setValue(gameData.players.black.name);
  sheet.getRange(row, 5).setValue(gameData.players.black.rating);
  sheet.getRange(row, 6).setValue(gameData.result.winner);
  sheet.getRange(row, 7).setValue(gameData.finalOpening?.name || '');
  sheet.getRange(row, 8).setValue(gameData.finalOpening?.eco || '');
  sheet.getRange(row, 9).setValue(gameData.timing.speed);
  sheet.getRange(row, 10).setValue(gameData.totalMoves);
  sheet.getRange(row, 11).setValue(gameData.totalPlys);
  sheet.getRange(row, 12).setValue(gameData.timing.timeControl);
  
  Logger.log(`✅ Data written to row ${row}`);
}

function writeMovesToSheet(gameId) {
  const gameData = fetchLichessGame(gameId);
  
  if (!gameData || !gameData.moves) {
    Logger.log('Failed to fetch game data');
    return;
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Moves Detail');
  
  if (!sheet) {
    sheet = ss.insertSheet('Moves Detail');
    
    const headers = [
      'Game ID', 'Ply', 'Move #', 'Color', 'SAN', 'UCI',
      'Eval Type', 'Eval Value', 'Opening Name', 'ECO',
      'Clock (sec)', 'FEN', 'Board', 'Active Color', 'Castling', 'En Passant'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  
  const startRow = sheet.getLastRow() + 1;
  
  gameData.moves.forEach((move, index) => {
    const row = startRow + index;
    
    sheet.getRange(row, 1).setValue(gameId);
    sheet.getRange(row, 2).setValue(move.ply);
    sheet.getRange(row, 3).setValue(move.moveNumber);
    sheet.getRange(row, 4).setValue(move.color);
    sheet.getRange(row, 5).setValue(move.san);
    sheet.getRange(row, 6).setValue(move.uci);
    sheet.getRange(row, 7).setValue(move.evaluation?.type || '');
    sheet.getRange(row, 8).setValue(move.evaluation?.displayValue || '');
    sheet.getRange(row, 9).setValue(move.opening?.name || '');
    sheet.getRange(row, 10).setValue(move.opening?.eco || '');
    sheet.getRange(row, 11).setValue(move.clockSeconds || '');
    sheet.getRange(row, 12).setValue(move.fen);
    sheet.getRange(row, 13).setValue(move.board);
    sheet.getRange(row, 14).setValue(move.activeColor);
    sheet.getRange(row, 15).setValue(move.castling || '');
    sheet.getRange(row, 16).setValue(move.enPassant || '');
  });
  
  Logger.log(`✅ ${gameData.moves.length} moves written to sheet`);
}

function createGameSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Lichess Games');
  
  if (!sheet) {
    sheet = ss.insertSheet('Lichess Games');
  }
  
  const headers = [
    'Game ID', 'White', 'W Rating', 'Black', 'B Rating', 'Winner',
    'Opening', 'ECO', 'Speed', 'Moves', 'Plys', 'Time Control'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  
  return sheet;
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

function testFunction() {
  const gameId = 'Bm5DQUPZ';
  Logger.log('🧪 Testing HTML scraping...\n');
  
  const data = fetchLichessGame(gameId);
  
  if (data) {
    Logger.log('✅ SUCCESS!\n');
    Logger.log('=== GAME INFO ===');
    Logger.log(`Game ID: ${data.gameId}`);
    Logger.log(`White: ${data.players.white.name} (${data.players.white.rating})`);
    Logger.log(`Black: ${data.players.black.name} (${data.players.black.rating})`);
    Logger.log(`Result: ${data.result.winner} by ${data.result.status}`);
    Logger.log(`Total Moves: ${data.totalMoves} (${data.totalPlys} plys)`);
    Logger.log(`Speed: ${data.timing.speed}`);
    Logger.log(`Time Control: ${data.timing.timeControl}`);
    
    Logger.log('\n=== OPENING ===');
    Logger.log(`Final Opening: ${data.finalOpening?.name} (${data.finalOpening?.eco})`);
    Logger.log(`Reached at ply: ${data.finalOpening?.ply}`);
    
    Logger.log('\n=== OPENING PROGRESSION ===');
    data.openingProgression.forEach(op => {
      Logger.log(`Ply ${op.ply}: ${op.name} (${op.eco})`);
    });
    
    Logger.log('\n=== FIRST 5 MOVES ===');
    data.moves.slice(0, 5).forEach(move => {
      Logger.log(`${move.moveNumber}. ${move.color}: ${move.san} - Eval: ${move.evaluation?.displayValue || 'N/A'} - Opening: ${move.opening?.name || 'Out of book'}`);
    });
    
    const analysis = analyzeMoves(data.moves);
    Logger.log('\n=== MOVE ANALYSIS ===');
    Logger.log(`Blunders: ${analysis.blunders.length}`);
    Logger.log(`Mistakes: ${analysis.mistakes.length}`);
    Logger.log(`Inaccuracies: ${analysis.inaccuracies.length}`);
    Logger.log(`Brilliant: ${analysis.brilliant.length}`);
    Logger.log(`Book moves: ${analysis.book.length}`);
  } else {
    Logger.log('❌ FAILED');
  }
}

function testGameExport() {
  createGameSheet();
  writeGameToSheet('Bm5DQUPZ');
}

function testMovesExport() {
  writeMovesToSheet('Bm5DQUPZ');
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Lichess Tools')
    .addItem('📝 Create Game Sheet', 'createGameSheet')
    .addItem('🎮 Import Game Summary', 'testGameExport')
    .addItem('📊 Import Detailed Moves', 'testMovesExport')
    .addItem('🧪 Test Function', 'testFunction')
    .addToUi();
}
