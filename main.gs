javascript:(async function(){
  console.log('🎯 Lichess Complete Analyzer (treeParts + DOM)');
  
  // First, try to get data from page-init-data script tag
  let pageInitData = null;
  const initScript = document.getElementById('page-init-data');
  if (initScript) {
    try {
      pageInitData = JSON.parse(initScript.textContent);
      console.log('✅ Found page-init-data');
    } catch(e) {
      console.log('⚠️ Could not parse page-init-data');
    }
  }
  
  // Try to access Lichess's internal data
  let treeParts = null;
  let gameData = null;
  
  // Use pageInitData if available
  if (pageInitData?.cfg?.data) {
    gameData = pageInitData.cfg.data;
    treeParts = gameData.treeParts;
    console.log('✅ Using data from page-init-data');
  }
  
  // Method 1: Check if data is in lichess.analysis
  if (!treeParts && window.lichess?.analysis?.data) {
    gameData = window.lichess.analysis.data;
    treeParts = gameData.treeParts || gameData.tree?.root?.children;
  }
  
  // Method 2: Try to find in site.analysis
  if (!treeParts && window.site?.analysis) {
    const siteAnalysis = window.site.analysis;
    if (typeof siteAnalysis === 'object') {
      treeParts = siteAnalysis.treeParts || siteAnalysis.data?.treeParts;
      gameData = siteAnalysis.data || siteAnalysis;
    }
  }
  
  // Method 3: Search window for treeParts
  if (!treeParts) {
    for (let key in window) {
      try {
        if (window[key] && typeof window[key] === 'object') {
          if (window[key].treeParts) {
            treeParts = window[key].treeParts;
            gameData = window[key];
            console.log(`Found treeParts in window.${key}`);
            break;
          }
          if (window[key].data?.treeParts) {
            treeParts = window[key].data.treeParts;
            gameData = window[key].data;
            console.log(`Found treeParts in window.${key}.data`);
            break;
          }
        }
      } catch(e) {}
    }
  }
  
  if (!treeParts) {
    console.error('❌ Could not find treeParts data');
    console.log('💡 Falling back to DOM extraction only...');
    // Fall back to DOM extraction
    treeParts = [];
  }
  
  console.log(`Found ${treeParts.length} positions in treeParts`);
  
  // Get game ID from URL
  const gameId = window.location.pathname.split('/')[1];
  
  // Get DOM moves for cross-reference
  const moveElements = document.querySelectorAll('move.mainline');
  console.log(`Found ${moveElements.length} moves in DOM`);

  // Try to leverage lichessTools or Lichess API for enriched metadata
  let apiData = null;
  try {
    if (window.lichessTools?.api?.game?.getPgns) {
      const out = await window.lichessTools.api.game.getPgns([gameId], {
        ndjson: true,
        pgnInJson: true,
        division: true,
        clocks: true,
        evals: true,
        opening: true,
        accuracy: true,
        literate: true
      });
      apiData = Array.isArray(out) ? out[0] : null;
    }
  } catch (e) {
    console.log('⚠️ lichessTools.getPgns failed:', e);
  }
  // Fallback to direct API if lichessTools not available
  if (!apiData) {
    try {
      const params = new URLSearchParams({
        ndjson: 'true', pgnInJson: 'true', division: 'true', clocks: 'true', evals: 'true', opening: 'true', accuracy: 'true', literate: 'true'
      });
      const res = await fetch(`/api/games/export/_ids?${params.toString()}` , {
        method: 'POST',
        headers: { 'Accept': 'application/x-ndjson' },
        body: gameId
      });
      const text = await res.text();
      const line = (text || '').split(/\r?\n/).find(l => l.trim());
      apiData = line ? JSON.parse(line) : null;
    } catch (e) {
      console.log('⚠️ Direct API fetch failed:', e);
    }
  }
  
  // Initialize move stats
  const moveStats = {
    white: { brilliant: 0, best: 0, good: 0, neutral: 0, inaccuracies: 0, mistakes: 0, blunders: 0 },
    black: { brilliant: 0, best: 0, good: 0, neutral: 0, inaccuracies: 0, mistakes: 0, blunders: 0 }
  };
  
  // Get player info from DOM
  const getPlayerInfo = () => {
    const players = { white: {}, black: {} };
    const summaries = document.querySelectorAll('.advice-summary__side');
    
    if (summaries.length >= 2) {
      summaries.forEach((summary, idx) => {
        const color = idx === 0 ? 'white' : 'black';
        const playerEl = summary.querySelector('.advice-summary__player');
        const accuracyEl = summary.querySelector('.advice-summary__accuracy');
        const acplEl = summary.querySelector('.advice-summary__acpl strong');
        
        if (playerEl) {
          const text = playerEl.textContent.trim();
          const match = text.match(/(.+?)\s*\((\d+)\)/);
          if (match) {
            players[color].name = match[1].trim();
            players[color].rating = parseInt(match[2]);
          } else {
            players[color].name = text.replace(/[±+\-\d\s()]/g, '').trim();
          }
        }
        
        if (accuracyEl) {
          const accMatch = accuracyEl.textContent.match(/(\d+)%/);
          if (accMatch) players[color].accuracy = parseInt(accMatch[1]);
        }
        
        if (acplEl) players[color].acpl = parseInt(acplEl.textContent);
      });
    }
    
    return players;
  };
  
  const players = getPlayerInfo();
  // Fallback to API player info if DOM summary missing
  try {
    if (apiData?.players) {
      const ap = apiData.players;
      if (!players.white.name && ap.white?.user?.name) players.white.name = ap.white.user.name;
      if (!players.white.rating && ap.white?.rating) players.white.rating = ap.white.rating;
      if (!players.black.name && ap.black?.user?.name) players.black.name = ap.black.user.name;
      if (!players.black.rating && ap.black?.rating) players.black.rating = ap.black.rating;
    }
  } catch (_) {}
  
  // Get game phases
  const division = (apiData?.division) || (gameData?.division) || { middle: null, end: null };
  
  // Helper to format eval
  function formatEval(evalObj) {
    if (!evalObj) return null;
    if (evalObj.mate !== undefined) {
      return evalObj.mate > 0 ? `+M${evalObj.mate}` : `-M${Math.abs(evalObj.mate)}`;
    }
    if (evalObj.cp !== undefined) {
      const pawns = (evalObj.cp / 100).toFixed(2);
      return evalObj.cp >= 0 ? `+${pawns}` : pawns;
    }
    return null;
  }
  
  // Helper to get glyph from DOM
  function getGlyphFromDOM(moveEl) {
    const glyphEl = moveEl?.querySelector('glyph');
    let glyph = '';
    let classification = 'neutral';
    
    if (glyphEl) {
      const glyphText = glyphEl.textContent.trim();
      const glyphTitle = glyphEl.getAttribute('title')?.toLowerCase() || '';
      
      if (glyphTitle === 'brilliant' || glyphText === '!!' || glyphText === '‼') {
        glyph = '!!';
        classification = 'brilliant';
      } else if (glyphTitle === 'best' || glyphText === '★' || glyphText === '☆') {
        glyph = '★';
        classification = 'best';
      } else if (glyphTitle === 'good' || glyphText === '!') {
        glyph = '!';
        classification = 'good';
      } else if (glyphTitle === 'inaccuracy' || glyphTitle === 'dubious move' || glyphText === '?!') {
        glyph = '?!';
        classification = 'inaccuracy';
      } else if (glyphTitle === 'mistake' || glyphText === '?') {
        glyph = '?';
        classification = 'mistake';
      } else if (glyphTitle === 'blunder' || glyphText === '??' || glyphText === '⁇') {
        glyph = '??';
        classification = 'blunder';
      } else if (glyphTitle === 'interesting' || glyphText === '!?') {
        glyph = '!?';
        classification = 'interesting';
      }
    }
    
    return { glyph, classification };
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('GAME INFO');
  console.log('═'.repeat(70));
  console.log(`ID: ${gameId}`);
  if (gameData?.game) {
    const game = gameData.game;
    console.log(`Variant: ${game.variant?.name || 'Standard'}`);
    console.log(`Speed: ${game.speed || 'N/A'}`);
    if (gameData.clock) {
      console.log(`Time Control: ${gameData.clock.initial}+${gameData.clock.increment}`);
    }
    console.log(`Result: ${game.winner ? `${game.winner} wins` : 'Draw'}`);
  }
  if (gameData?.game?.opening) {
    const op = gameData.game.opening;
    console.log(`Opening: ${op.name} (${op.eco}) [ply: ${op.ply}]`);
  }
  if (division.middle || division.end) {
    const phases = [];
    if (division.middle) phases.push(`Middle: ${division.middle}`);
    if (division.end) phases.push(`End: ${division.end}`);
    console.log(`Phases: ${phases.join(' | ')}`);
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('PLAYER STATS');
  console.log('═'.repeat(70));
  
  // Display player stats
  if (players.white.name) {
    console.log(`WHITE: ${players.white.name} (${players.white.rating || 'N/A'})`);
    console.log(`  Acc: ${players.white.accuracy || 'N/A'}% | ACPL: ${players.white.acpl || 'N/A'}`);
  }
  if (players.black.name) {
    console.log(`BLACK: ${players.black.name} (${players.black.rating || 'N/A'})`);
    console.log(`  Acc: ${players.black.accuracy || 'N/A'}% | ACPL: ${players.black.acpl || 'N/A'}`);
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('MOVE ANALYSIS');
  console.log('═'.repeat(70));
  
  const moves = [];
  
  // Track clocks for each side (prefer API clock configuration)
  const initialSec = (apiData?.clock?.initial ?? gameData?.clock?.initial ?? 120);
  const incrementSec = (apiData?.clock?.increment ?? gameData?.clock?.increment ?? 0);
  const clockTracker = {
    white: (initialSec * 100) || 12000, // in centiseconds
    black: (initialSec * 100) || 12000
  };
  const increment = (incrementSec || 0) * 100; // in centiseconds
  const apiClocks = Array.isArray(apiData?.clocks) ? apiData.clocks : [];
  
  // Process moves combining treeParts and DOM
  for (let i = 1; i < Math.max(treeParts.length, moveElements.length + 1); i++) {
    const treePart = treeParts[i];
    const moveEl = moveElements[i - 1];
    
    if (!treePart && !moveEl) break;
    
    const ply = treePart?.ply || i;
    const moveNumber = Math.ceil(ply / 2);
    const isWhite = ply % 2 === 1;
    const color = isWhite ? 'white' : 'black';
    
    // Get data from treePart
    const san = treePart?.san || moveEl?.querySelector('san')?.textContent.trim() || '';
    const uci = treePart?.uci || '';
    const fen = treePart?.fen || '';
    
    // Eval
    const evalAfter = formatEval(treePart?.eval);
    const previousTreePart = treeParts[i - 1];
    const evalBefore = formatEval(previousTreePart?.eval);
    
    // Opening
    const opening = treePart?.opening ? `${treePart.opening.eco} ${treePart.opening.name}` : '';
    const eco = treePart?.opening?.eco || '';
    
    // Clock and time calculation (fallback to API clocks if missing)
    const clockCentis = (treePart?.clock !== undefined && treePart?.clock !== null)
      ? treePart.clock
      : (apiClocks[ply - 1] !== undefined ? apiClocks[ply - 1] : undefined);
    const clockTime = clockCentis ? (clockCentis / 100).toFixed(2) + 's' : '';
    
    let moveTime = '';
    if (clockCentis !== undefined) {
      const previousClock = clockTracker[color];
      const timeSpent = (previousClock - clockCentis + increment) / 100;
      moveTime = timeSpent.toFixed(2) + 's';
      clockTracker[color] = clockCentis; // Update tracker
    }
    
    // Glyph from DOM
    const { glyph, classification } = getGlyphFromDOM(moveEl);
    
    // Check
    const isCheck = treePart?.check || san.includes('+') || san.includes('#');
    
    // Comment and best move
    const commentEl = moveEl?.querySelector('comment');
    const comment = commentEl?.textContent.trim() || '';
    
    // Get best move - extract SAN from comment (e.g., "Bf1 was best")
    let bestMove = '';
    if (comment) {
      const match = comment.match(/([A-Z]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[\+#]?)\s+was best/i);
      if (match) {
        bestMove = match[1];
      }
    }
    // Fallback to UCI if no SAN found
    if (!bestMove && treePart?.eval?.best) {
      bestMove = treePart.eval.best;
    }
    
    // Phase
    let phase = 'opening';
    if (division.end && ply >= division.end) phase = 'endgame';
    else if (division.middle && ply >= division.middle) phase = 'middlegame';
    
    // Store move data first
    const moveData = {
      ply, moveNumber, color, san, uci, fen,
      evalBefore, evalAfter, glyph, classification,
      eco, opening, clockTime, moveTime,
      isCheck, comment, phase, bestMove
    };
    
    moves.push(moveData);
    
    // Update stats
    if (classification === 'brilliant') moveStats[color].brilliant++;
    else if (classification === 'best') moveStats[color].best++;
    else if (classification === 'good') moveStats[color].good++;
    else if (classification === 'neutral') moveStats[color].neutral++;
    else if (classification === 'inaccuracy') moveStats[color].inaccuracies++;
    else if (classification === 'mistake') moveStats[color].mistakes++;
    else if (classification === 'blunder') moveStats[color].blunders++;
  }
  
  // Display moves side-by-side (white and black together)
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    
    if (move.color === 'white') {
      // Start of a new move pair
      const blackMove = moves[i + 1];
      
      // Format white move - bold move number and san, light gray eval, italic gray time
      let output = `%c${move.moveNumber}.%c %c${move.san}%c`;
      let styles = [
        'font-weight: bold',           // move number
        'font-weight: normal',
        'font-weight: bold',           // move san
        'font-weight: normal'
      ];
      
      if (move.glyph) {
        output += ` ${move.glyph}`;
      }
      output += ` %c(${move.evalAfter})%c`;
      styles.push('color: #999; font-weight: normal'); // light gray eval
      styles.push('color: black');
      
      if (move.moveTime) {
        output += ` %c| ${move.moveTime}%c`;
        styles.push('color: #999; font-style: italic'); // italic gray time
        styles.push('color: black; font-style: normal');
      }
      
      // Bold separator before black move
      if (blackMove && blackMove.color === 'black') {
        output += ` %c||%c `;
        styles.push('font-weight: bold'); // bold separator
        styles.push('font-weight: normal');
        
        // Format black move
        output += `%c${blackMove.san}%c`;
        styles.push('font-weight: bold');  // black move san
        styles.push('font-weight: normal');
        
        if (blackMove.glyph) {
          output += ` ${blackMove.glyph}`;
        }
        output += ` %c(${blackMove.evalAfter})%c`;
        styles.push('color: #999; font-weight: normal'); // light gray eval
        styles.push('color: black');
        
        if (blackMove.moveTime) {
          output += ` %c| ${blackMove.moveTime}%c`;
          styles.push('color: #999; font-style: italic'); // italic gray time
          styles.push('color: black; font-style: normal');
        }
      }
      
      console.log(output, ...styles);
      
      // Show opening if present (show for whichever move has it)
      if (move.opening) {
        console.log(`   📖 ${move.opening}`);
      } 
      if (blackMove?.opening) {
        console.log(`   📖 ${blackMove.opening}`);
      }
      
      // Show best move for white
      if (move.bestMove && (move.classification === 'inaccuracy' || move.classification === 'mistake' || move.classification === 'blunder')) {
        console.log(`   → White: Best was ${move.bestMove}`);
      }
      
      // Show best move for black
      if (blackMove?.bestMove && (blackMove.classification === 'inaccuracy' || blackMove.classification === 'mistake' || blackMove.classification === 'blunder')) {
        console.log(`   → Black: Best was ${blackMove.bestMove}`);
      }
      
      // Show comments
      if (move.comment) console.log(`   💬 White: ${move.comment}`);
      if (blackMove?.comment) console.log(`   💬 Black: ${blackMove.comment}`);
      
      // Mark phase transitions
      if (division.middle && move.ply === division.middle) {
        console.log(`   🎯 [MIDDLEGAME BEGINS]`);
      }
      if (division.end && move.ply === division.end) {
        console.log(`   🎯 [ENDGAME BEGINS]`);
      }
      if (blackMove) {
        if (division.middle && blackMove.ply === division.middle) {
          console.log(`   🎯 [MIDDLEGAME BEGINS]`);
        }
        if (division.end && blackMove.ply === division.end) {
          console.log(`   🎯 [ENDGAME BEGINS]`);
        }
      }
    }
  }
  
  // Display final stats
  console.log('\n' + '═'.repeat(70));
  console.log('MOVE CLASSIFICATIONS');
  console.log('═'.repeat(70));
  console.log(`WHITE: Brilliant: ${moveStats.white.brilliant} | Best: ${moveStats.white.best} | Good: ${moveStats.white.good} | Neutral: ${moveStats.white.neutral}`);
  console.log(`       Inaccuracies: ${moveStats.white.inaccuracies} | Mistakes: ${moveStats.white.mistakes} | Blunders: ${moveStats.white.blunders}`);
  console.log(`BLACK: Brilliant: ${moveStats.black.brilliant} | Best: ${moveStats.black.best} | Good: ${moveStats.black.good} | Neutral: ${moveStats.black.neutral}`);
  console.log(`       Inaccuracies: ${moveStats.black.inaccuracies} | Mistakes: ${moveStats.black.mistakes} | Blunders: ${moveStats.black.blunders}`);
  
  // Export
  const exportData = {
    gameId,
    url: window.location.href,
    division,
    finalOpening: gameData?.game?.opening,
    players: {
      white: { ...players.white, ...moveStats.white },
      black: { ...players.black, ...moveStats.black }
    },
    moves,
    totalPlys: moves.length
  };
  
  window.lichessCompleteData = exportData;
  
  console.log('\n✅ Extraction Complete!');
  console.log(`📊 Processed ${moves.length} moves`);
  console.log('📦 Data: window.lichessCompleteData');
  
  // Download
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lichess-${gameId}-complete.json`;
  a.click();
  
  console.log(`💾 Downloaded: lichess-${gameId}-complete.json`);
  
})();
