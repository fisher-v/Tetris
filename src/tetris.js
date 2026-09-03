(function () {
  "use strict";

  var COLS = 12;
  var ROWS = 20;
  var EMPTY = null;
  var STORAGE_KEY = "tetris-pocket-best-score";

  var COLORS = {
    I: "#32c7d9",
    O: "#f1cc3f",
    T: "#a46de8",
    S: "#70c65a",
    Z: "#ea5f61",
    J: "#4d7ee8",
    L: "#f3a13b"
  };

  var SHAPES = {
    I: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ],
    O: [
      [1, 1],
      [1, 1]
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0]
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0]
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0]
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0]
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0]
    ]
  };

  var SCORE_BY_LINES = [0, 100, 300, 500, 800];
  var BAG_TYPES = Object.keys(SHAPES);

  function createBoard() {
    return Array.from({ length: ROWS }, function () {
      return Array.from({ length: COLS }, function () {
        return EMPTY;
      });
    });
  }

  function cloneMatrix(matrix) {
    return matrix.map(function (row) {
      return row.slice();
    });
  }

  function shuffleBag(items) {
    var bag = items.slice();
    for (var i = bag.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = bag[i];
      bag[i] = bag[j];
      bag[j] = temp;
    }
    return bag;
  }

  function rotateMatrix(matrix) {
    var size = matrix.length;
    var rotated = Array.from({ length: size }, function () {
      return Array.from({ length: size }, function () {
        return 0;
      });
    });

    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        rotated[x][size - 1 - y] = matrix[y][x];
      }
    }

    return rotated;
  }

  function makePiece(type) {
    var shape = cloneMatrix(SHAPES[type]);
    return {
      type: type,
      shape: shape,
      x: Math.floor((COLS - shape.length) / 2),
      y: type === "I" ? -1 : 0
    };
  }

  function drawType(game) {
    if (!game.bag.length) {
      game.bag = shuffleBag(BAG_TYPES);
    }
    return game.bag.pop();
  }

  function cellsFor(piece) {
    var cells = [];
    for (var y = 0; y < piece.shape.length; y += 1) {
      for (var x = 0; x < piece.shape[y].length; x += 1) {
        if (piece.shape[y][x]) {
          cells.push({ x: piece.x + x, y: piece.y + y, type: piece.type });
        }
      }
    }
    return cells;
  }

  function collides(board, piece) {
    var cells = cellsFor(piece);
    for (var i = 0; i < cells.length; i += 1) {
      var cell = cells[i];
      if (cell.x < 0 || cell.x >= COLS || cell.y >= ROWS) {
        return true;
      }
      if (cell.y >= 0 && board[cell.y][cell.x]) {
        return true;
      }
    }
    return false;
  }

  function mergePiece(board, piece) {
    var cells = cellsFor(piece);
    for (var i = 0; i < cells.length; i += 1) {
      var cell = cells[i];
      if (cell.y >= 0 && cell.y < ROWS) {
        board[cell.y][cell.x] = cell.type;
      }
    }
  }

  function clearLines(board) {
    var cleared = 0;
    for (var y = ROWS - 1; y >= 0; y -= 1) {
      if (board[y].every(Boolean)) {
        board.splice(y, 1);
        board.unshift(Array.from({ length: COLS }, function () { return EMPTY; }));
        cleared += 1;
        y += 1;
      }
    }
    return cleared;
  }

  function loadBestScore() {
    var saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) ? saved : 0;
  }

  function saveBestScore(score) {
    window.localStorage.setItem(STORAGE_KEY, String(score));
  }

  function createGame() {
    var game = {
      board: createBoard(),
      bag: shuffleBag(BAG_TYPES),
      current: null,
      next: null,
      score: 0,
      bestScore: loadBestScore(),
      status: "ready",
      lastCleared: 0
    };

    game.current = makePiece(drawType(game));
    game.next = makePiece(drawType(game));

    if (collides(game.board, game.current)) {
      game.status = "gameover";
    }

    return game;
  }

  function restart(game) {
    var bestScore = Math.max(game.bestScore || 0, game.score || 0);
    if (bestScore !== game.bestScore) {
      saveBestScore(bestScore);
    }

    game.board = createBoard();
    game.bag = shuffleBag(BAG_TYPES);
    game.current = makePiece(drawType(game));
    game.next = makePiece(drawType(game));
    game.score = 0;
    game.bestScore = bestScore;
    game.status = "playing";
    game.lastCleared = 0;
  }

  function start(game) {
    if (game.status === "ready" || game.status === "gameover") {
      restart(game);
    } else if (game.status === "paused") {
      game.status = "playing";
    }
  }

  function pause(game) {
    if (game.status === "playing") {
      game.status = "paused";
    }
  }

  function togglePause(game) {
    if (game.status === "playing") {
      game.status = "paused";
    } else if (game.status === "paused") {
      game.status = "playing";
    }
  }

  function updateBest(game) {
    if (game.score > game.bestScore) {
      game.bestScore = game.score;
      saveBestScore(game.bestScore);
    }
  }

  function spawnNext(game) {
    game.current = game.next;
    game.current.x = Math.floor((COLS - game.current.shape.length) / 2);
    game.current.y = game.current.type === "I" ? -1 : 0;
    game.next = makePiece(drawType(game));
    if (collides(game.board, game.current)) {
      game.status = "gameover";
      updateBest(game);
    }
  }

  function lockCurrent(game) {
    mergePiece(game.board, game.current);
    var cleared = clearLines(game.board);
    game.lastCleared = cleared;
    if (cleared > 0) {
      game.score += SCORE_BY_LINES[cleared] || 0;
      updateBest(game);
    }
    spawnNext(game);
  }

  function move(game, dx) {
    if (game.status !== "playing") {
      return false;
    }
    var moved = Object.assign({}, game.current, { x: game.current.x + dx });
    if (!collides(game.board, moved)) {
      game.current = moved;
      return true;
    }
    return false;
  }

  function softDrop(game) {
    if (game.status !== "playing") {
      return false;
    }
    var moved = Object.assign({}, game.current, { y: game.current.y + 1 });
    if (!collides(game.board, moved)) {
      game.current = moved;
      game.score += 1;
      updateBest(game);
      return true;
    }
    lockCurrent(game);
    return false;
  }

  function tick(game) {
    if (game.status !== "playing") {
      return false;
    }
    var moved = Object.assign({}, game.current, { y: game.current.y + 1 });
    if (!collides(game.board, moved)) {
      game.current = moved;
      return true;
    }
    lockCurrent(game);
    return false;
  }

  function rotate(game) {
    if (game.status !== "playing" || game.current.type === "O") {
      return false;
    }

    var rotated = Object.assign({}, game.current, {
      shape: rotateMatrix(game.current.shape)
    });
    var kicks = [0, -1, 1, -2, 2];

    for (var i = 0; i < kicks.length; i += 1) {
      var candidate = Object.assign({}, rotated, { x: rotated.x + kicks[i] });
      if (!collides(game.board, candidate)) {
        game.current = candidate;
        return true;
      }
    }
    return false;
  }

  function hardDrop(game) {
    if (game.status !== "playing") {
      return 0;
    }

    var distance = 0;
    while (!collides(game.board, Object.assign({}, game.current, { y: game.current.y + 1 }))) {
      game.current = Object.assign({}, game.current, { y: game.current.y + 1 });
      distance += 1;
    }

    game.score += distance * 2;
    updateBest(game);
    lockCurrent(game);
    return distance;
  }

  function getGhostCells(game) {
    if (game.status === "gameover") {
      return [];
    }

    var ghost = Object.assign({}, game.current, {
      shape: cloneMatrix(game.current.shape)
    });

    while (!collides(game.board, Object.assign({}, ghost, { y: ghost.y + 1 }))) {
      ghost.y += 1;
    }

    return cellsFor(ghost).filter(function (cell) {
      return cell.y >= 0;
    });
  }

  function getMergedCells(game) {
    var boardCells = [];
    for (var y = 0; y < ROWS; y += 1) {
      for (var x = 0; x < COLS; x += 1) {
        if (game.board[y][x]) {
          boardCells.push({ x: x, y: y, type: game.board[y][x], locked: true });
        }
      }
    }
    return boardCells.concat(cellsFor(game.current).filter(function (cell) {
      return cell.y >= 0;
    }));
  }

  window.TetrisCore = {
    COLS: COLS,
    ROWS: ROWS,
    COLORS: COLORS,
    SHAPES: SHAPES,
    createGame: createGame,
    start: start,
    pause: pause,
    togglePause: togglePause,
    restart: restart,
    move: move,
    rotate: rotate,
    tick: tick,
    softDrop: softDrop,
    hardDrop: hardDrop,
    getGhostCells: getGhostCells,
    getMergedCells: getMergedCells
  };
})();
