(function () {
  "use strict";

  var Tetris = window.TetrisCore;
  var boardCanvas = document.getElementById("board");
  var boardContext = boardCanvas.getContext("2d");
  var nextCanvas = document.getElementById("next");
  var nextContext = nextCanvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestScoreEl = document.getElementById("bestScore");
  var statusTextEl = document.getElementById("statusText");
  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlayTitle");
  var overlayButton = document.getElementById("overlayButton");
  var pauseButton = document.getElementById("pauseButton");
  var restartButton = document.getElementById("restartButton");

  var game = Tetris.createGame();
  var dropInterval = 820;
  var softDropInterval = dropInterval / 4;
  var lastTime = 0;
  var dropAccumulator = 0;
  var heldActions = Object.create(null);
  var repeatTimers = Object.create(null);

  function statusLabel(status) {
    if (status === "playing") return "进行中";
    if (status === "paused") return "暂停";
    if (status === "gameover") return "游戏结束";
    return "待开始";
  }

  function drawCell(ctx, x, y, size, color, inset) {
    var gap = inset || 1;
    var left = x * size + gap;
    var top = y * size + gap;
    var width = size - gap * 2;
    ctx.fillStyle = color;
    ctx.fillRect(left, top, width, width);
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.fillRect(left + 2, top + 2, Math.max(2, width - 4), 3);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(left + width - 4, top + 2, 3, Math.max(2, width - 4));
    ctx.fillRect(left + 2, top + width - 4, Math.max(2, width - 4), 3);
  }

  function drawGhostCell(ctx, x, y, size, color) {
    var gap = 3;
    var left = x * size + gap;
    var top = y * size + gap;
    var width = size - gap * 2;

    ctx.save();
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = color;
    ctx.fillRect(left, top, width, width);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = "#f6f0dc";
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, width - 2, width - 2);
    ctx.restore();
  }

  function drawBoard() {
    var cellSize = Math.min(boardCanvas.width / Tetris.COLS, boardCanvas.height / Tetris.ROWS);
    var boardWidth = cellSize * Tetris.COLS;
    var boardHeight = cellSize * Tetris.ROWS;
    boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardContext.fillStyle = "#18222d";
    boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

    for (var column = 0; column < Tetris.COLS; column += 1) {
      boardContext.fillStyle = column % 2 === 0 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.05)";
      boardContext.fillRect(column * cellSize, 0, cellSize, boardHeight);
    }

    boardContext.strokeStyle = "rgba(195, 224, 208, 0.18)";
    boardContext.lineWidth = 1;
    for (var x = 0; x <= Tetris.COLS; x += 1) {
      boardContext.beginPath();
      boardContext.moveTo(x * cellSize + 0.5, 0);
      boardContext.lineTo(x * cellSize + 0.5, boardHeight);
      boardContext.stroke();
    }

    boardContext.strokeStyle = "rgba(222, 241, 226, 0.28)";
    boardContext.strokeRect(0.5, 0.5, boardWidth - 1, boardHeight - 1);

    Tetris.getGhostCells(game).forEach(function (cell) {
      drawGhostCell(boardContext, cell.x, cell.y, cellSize, Tetris.COLORS[cell.type]);
    });

    Tetris.getMergedCells(game).forEach(function (cell) {
      drawCell(boardContext, cell.x, cell.y, cellSize, Tetris.COLORS[cell.type], 1.5);
    });
  }

  function drawNext() {
    var shape = game.next.shape;
    var type = game.next.type;
    nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextContext.fillStyle = "#202b37";
    nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

    var size = 22;
    var offsetX = Math.floor((nextCanvas.width - shape.length * size) / 2);
    var offsetY = Math.floor((nextCanvas.height - shape.length * size) / 2);

    for (var y = 0; y < shape.length; y += 1) {
      for (var x = 0; x < shape[y].length; x += 1) {
        if (shape[y][x]) {
          nextContext.save();
          nextContext.translate(offsetX, offsetY);
          drawCell(nextContext, x, y, size, Tetris.COLORS[type], 1.5);
          nextContext.restore();
        }
      }
    }
  }

  function updateOverlay() {
    overlay.classList.toggle("hidden", game.status === "playing");
    if (game.status === "ready") {
      overlayTitle.textContent = "俄罗斯方块";
      overlayButton.textContent = "开始游戏";
    } else if (game.status === "paused") {
      overlayTitle.textContent = "已暂停";
      overlayButton.textContent = "继续";
    } else if (game.status === "gameover") {
      overlayTitle.textContent = "游戏结束 · " + game.score + " 分";
      overlayButton.textContent = "重新开始";
    }
  }

  function render() {
    drawBoard();
    drawNext();
    scoreEl.textContent = String(game.score);
    bestScoreEl.textContent = String(game.bestScore);
    statusTextEl.textContent = statusLabel(game.status);
    pauseButton.textContent = game.status === "paused" ? "继续" : "暂停";
    updateOverlay();
  }

  function playAction(action) {
    if (action === "up") return;
    if (action === "left") Tetris.move(game, -1);
    if (action === "right") Tetris.move(game, 1);
    if (action === "down") Tetris.softDrop(game);
    if (action === "rotate") Tetris.rotate(game);
    if (action === "hardDrop") {
      Tetris.hardDrop(game);
      dropAccumulator = 0;
    }
    render();
  }

  function beginRepeat(action) {
    if (action === "up") return;
    if (action === "down") {
      heldActions.down = true;
      render();
      return;
    }
    if (action !== "left" && action !== "right") {
      playAction(action);
      return;
    }
    if (repeatTimers[action]) return;
    playAction(action);
    repeatTimers[action] = {
      delay: window.setTimeout(function repeat() {
        playAction(action);
        repeatTimers[action].interval = window.setInterval(function () {
          playAction(action);
        }, 74);
      }, 170)
    };
  }

  function endRepeat(action) {
    if (action === "down") {
      heldActions.down = false;
      return;
    }
    var timer = repeatTimers[action];
    if (!timer) return;
    window.clearTimeout(timer.delay);
    window.clearInterval(timer.interval);
    delete repeatTimers[action];
  }

  function clearAllRepeats() {
    heldActions.down = false;
    Object.keys(repeatTimers).forEach(endRepeat);
  }

  function keyboardAction(event) {
    var key = event.key;
    if (key === "a" || key === "A" || key === "ArrowLeft") return "left";
    if (key === "d" || key === "D" || key === "ArrowRight") return "right";
    if (key === "s" || key === "S" || key === "ArrowDown") return "down";
    if (key === "w" || key === "W" || key === "ArrowUp") return "up";
    if (key === " ") return "hardDrop";
    if (key === "Enter") return "rotate";
    return "";
  }

  function shouldPreventKey(event) {
    return Boolean(keyboardAction(event)) ||
      event.key === "p" || event.key === "P" ||
      event.key === "r" || event.key === "R" ||
      event.key === "Escape";
  }

  function handleKeyDown(event) {
    if (shouldPreventKey(event)) {
      event.preventDefault();
    }

    if (event.key === "p" || event.key === "P" || event.key === "Escape") {
      if (!event.repeat) {
        Tetris.togglePause(game);
        clearAllRepeats();
        render();
      }
      return;
    }
    if (event.key === "r" || event.key === "R") {
      if (!event.repeat) {
        Tetris.restart(game);
        clearAllRepeats();
        dropAccumulator = 0;
        render();
      }
      return;
    }

    var action = keyboardAction(event);
    if (!action) return;
    if (action === "up") return;
    if (game.status === "ready") {
      Tetris.start(game);
    }
    if (!event.repeat) {
      beginRepeat(action);
    }
  }

  function handleKeyUp(event) {
    var action = keyboardAction(event);
    if (action) {
      event.preventDefault();
      endRepeat(action);
    }
  }

  function bindButtons() {
    document.querySelectorAll("[data-action]").forEach(function (button) {
      var action = button.getAttribute("data-action");
      button.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        if (action !== "up" && game.status === "ready") {
          Tetris.start(game);
        }
        beginRepeat(action);
        button.classList.add("pressed");
        render();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (eventName) {
        button.addEventListener(eventName, function (event) {
          event.preventDefault();
          endRepeat(action);
          button.classList.remove("pressed");
          render();
        });
      });
      button.addEventListener("contextmenu", function (event) {
        event.preventDefault();
      });
    });
  }

  function gameLoop(time) {
    if (!lastTime) {
      lastTime = time;
    }
    var delta = time - lastTime;
    lastTime = time;

    if (game.status === "playing") {
      dropAccumulator += delta;
      var interval = heldActions.down ? softDropInterval : dropInterval;
      while (dropAccumulator >= interval && game.status === "playing") {
        if (heldActions.down) {
          Tetris.softDrop(game);
        } else {
          Tetris.tick(game);
        }
        dropAccumulator -= interval;
      }
    } else {
      dropAccumulator = 0;
    }

    render();
    window.requestAnimationFrame(gameLoop);
  }

  overlayButton.addEventListener("click", function () {
    Tetris.start(game);
    dropAccumulator = 0;
    render();
  });

  pauseButton.addEventListener("click", function () {
    if (game.status === "ready") {
      Tetris.start(game);
    } else {
      Tetris.togglePause(game);
    }
    clearAllRepeats();
    render();
  });

  restartButton.addEventListener("click", function () {
    Tetris.restart(game);
    clearAllRepeats();
    dropAccumulator = 0;
    render();
  });

  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp, { passive: false });
  window.addEventListener("blur", function () {
    Tetris.pause(game);
    clearAllRepeats();
    render();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      Tetris.pause(game);
      clearAllRepeats();
      render();
    }
  });

  bindButtons();
  render();
  window.requestAnimationFrame(gameLoop);
})();
