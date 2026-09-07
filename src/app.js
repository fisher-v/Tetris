(function () {
  "use strict";

  var Tetris = window.TetrisCore;
  var boardCanvas = document.getElementById("board");
  var boardContext = boardCanvas.getContext("2d");
  var nextCanvas = document.getElementById("next");
  var nextContext = nextCanvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestScoreEl = document.getElementById("bestScore");
  var multiplierEl = document.getElementById("multiplier");
  var statusTextEl = document.getElementById("statusText");
  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlayTitle");
  var overlayButton = document.getElementById("overlayButton");
  var pauseButton = document.getElementById("pauseButton");
  var restartButton = document.getElementById("restartButton");
  var keySettingsButton = document.getElementById("keySettingsButton");
  var keySettingsEl = document.getElementById("keySettings");
  var closeKeySettingsButton = document.getElementById("closeKeySettingsButton");
  var closeKeySettingsButtonBottom = document.getElementById("closeKeySettingsButtonBottom");
  var resetKeyBindingsButton = document.getElementById("resetKeyBindingsButton");
  var keyBindingStatusEl = document.getElementById("keyBindingStatus");
  var helpTextEl = document.getElementById("helpText");

  var KEY_BINDINGS_STORAGE_KEY = "tetris-pocket-key-bindings";
  var DEFAULT_KEY_BINDINGS = {
    left: ["a", "ArrowLeft"],
    right: ["d", "ArrowRight"],
    down: ["s", "ArrowDown"],
    rotate: ["Enter"],
    hardDrop: [" "],
    pause: ["p", "Escape"],
    restart: ["r"]
  };
  var ACTION_LABELS = {
    left: "左移",
    right: "右移",
    down: "加速下落",
    rotate: "变形",
    hardDrop: "速降",
    pause: "暂停 / 继续",
    restart: "重新开始"
  };
  var KEY_LABELS = {
    " ": "空格",
    Enter: "Enter",
    Escape: "Esc",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowDown: "↓",
    ArrowUp: "↑",
    Backspace: "退格",
    Tab: "Tab"
  };
  var NON_BINDABLE_KEYS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"];

  var game = Tetris.createGame();
  var dropInterval = 820;
  var softDropInterval = dropInterval / 4;
  var lastTime = 0;
  var dropAccumulator = 0;
  var heldActions = Object.create(null);
  var repeatTimers = Object.create(null);
  var keyBindings = loadKeyBindings();
  var editingBinding = "";

  function statusLabel(status) {
    if (status === "playing") return "进行中";
    if (status === "paused") return "暂停";
    if (status === "gameover") return "游戏结束";
    return "待开始";
  }

  function cloneKeyBindings(source) {
    var clone = {};
    Object.keys(DEFAULT_KEY_BINDINGS).forEach(function (action) {
      clone[action] = source[action].slice();
    });
    return clone;
  }

  function normalizeKey(key) {
    return key && key.length === 1 ? key.toLowerCase() : key;
  }

  function loadKeyBindings() {
    var bindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY_BINDINGS_STORAGE_KEY) || "null");
      Object.keys(DEFAULT_KEY_BINDINGS).forEach(function (action) {
        if (saved && Array.isArray(saved[action])) {
          var validKeys = saved[action].map(normalizeKey).filter(Boolean);
          if (validKeys.length) {
            bindings[action] = validKeys;
          }
        }
      });
    } catch (error) {
      // 使用默认按键，兼容禁用 localStorage 的浏览器环境。
    }
    return bindings;
  }

  function saveKeyBindings() {
    try {
      window.localStorage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify(keyBindings));
    } catch (error) {
      // 按键仍可在本次游戏中使用，只是不持久化。
    }
  }

  function keyLabel(key) {
    if (KEY_LABELS[key]) return KEY_LABELS[key];
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function bindingLabel(action) {
    return keyBindings[action].map(keyLabel).join(" / ");
  }

  function isKeyBound(action, key) {
    var normalizedKey = normalizeKey(key);
    return keyBindings[action].some(function (boundKey) {
      return boundKey === normalizedKey;
    });
  }

  function updateHelpText() {
    helpTextEl.textContent = "左移 " + bindingLabel("left") + " · 右移 " + bindingLabel("right") +
      " · 加速 " + bindingLabel("down") + " · 变形 " + bindingLabel("rotate") +
      " · 速降 " + bindingLabel("hardDrop") + " · 暂停 " + bindingLabel("pause") +
      " · 重开 " + bindingLabel("restart") + "；同时消去 1/2/3/4 行，获得 1×/2×/3×/4×倍率";
  }

  function renderKeyBindings() {
    document.querySelectorAll("[data-key-binding]").forEach(function (button) {
      var action = button.getAttribute("data-key-binding");
      var editing = editingBinding === action;
      button.textContent = editing ? "请按键…" : bindingLabel(action);
      button.classList.toggle("listening", editing);
      button.setAttribute("aria-label", ACTION_LABELS[action] + "：" + (editing ? "等待按键" : bindingLabel(action)));
    });
    updateHelpText();
  }

  function beginKeyBinding(action) {
    if (!ACTION_LABELS[action]) return;
    editingBinding = action;
    keyBindingStatusEl.textContent = "正在设置“" + ACTION_LABELS[action] + "”，请按下新按键（Esc 取消）";
    renderKeyBindings();
  }

  function captureKeyBinding(event) {
    event.preventDefault();
    if (event.key === "Escape") {
      editingBinding = "";
      keyBindingStatusEl.textContent = "已取消设置";
      renderKeyBindings();
      return;
    }

    var key = normalizeKey(event.key);
    if (!key || key === "Unidentified" || NON_BINDABLE_KEYS.indexOf(key) !== -1) {
      keyBindingStatusEl.textContent = "这个按键不能单独绑定，请换一个键";
      return;
    }

    var conflict = Object.keys(keyBindings).find(function (action) {
      return action !== editingBinding && isKeyBound(action, key);
    });
    if (conflict) {
      keyBindingStatusEl.textContent = "“" + keyLabel(key) + "”已绑定给“" + ACTION_LABELS[conflict] + "”";
      return;
    }

    var action = editingBinding;
    keyBindings[action] = [key];
    saveKeyBindings();
    editingBinding = "";
    keyBindingStatusEl.textContent = ACTION_LABELS[action] + "已设置为“" + keyLabel(key) + "”";
    renderKeyBindings();
  }

  function openKeySettings() {
    Tetris.pause(game);
    clearAllRepeats();
    keySettingsEl.classList.remove("hidden");
    keyBindingStatusEl.textContent = "";
    renderKeyBindings();
    render();
  }

  function closeKeySettings() {
    editingBinding = "";
    keySettingsEl.classList.add("hidden");
    keyBindingStatusEl.textContent = "";
    renderKeyBindings();
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
    multiplierEl.textContent = "×" + String(game.lastMultiplier);
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
    if (isKeyBound("left", event.key)) return "left";
    if (isKeyBound("right", event.key)) return "right";
    if (isKeyBound("down", event.key)) return "down";
    if (isKeyBound("rotate", event.key)) return "rotate";
    if (isKeyBound("hardDrop", event.key)) return "hardDrop";
    return "";
  }

  function shouldPreventKey(event) {
    return Boolean(keyboardAction(event)) ||
      isKeyBound("pause", event.key) ||
      isKeyBound("restart", event.key);
  }

  function handleKeyDown(event) {
    if (editingBinding) {
      captureKeyBinding(event);
      return;
    }
    if (!keySettingsEl.classList.contains("hidden")) {
      if (event.key === "Escape") {
        closeKeySettings();
      } else {
        event.preventDefault();
      }
      return;
    }
    if (shouldPreventKey(event)) {
      event.preventDefault();
    }

    if (isKeyBound("pause", event.key)) {
      if (!event.repeat) {
        Tetris.togglePause(game);
        clearAllRepeats();
        render();
      }
      return;
    }
    if (isKeyBound("restart", event.key)) {
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
    if (game.status === "ready") {
      Tetris.start(game);
    }
    if (!event.repeat) {
      beginRepeat(action);
    }
  }

  function handleKeyUp(event) {
    if (!keySettingsEl.classList.contains("hidden")) return;
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

  keySettingsButton.addEventListener("click", openKeySettings);
  closeKeySettingsButton.addEventListener("click", closeKeySettings);
  closeKeySettingsButtonBottom.addEventListener("click", closeKeySettings);
  keySettingsEl.addEventListener("click", function (event) {
    if (event.target === keySettingsEl) {
      closeKeySettings();
    }
  });
  resetKeyBindingsButton.addEventListener("click", function () {
    keyBindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
    saveKeyBindings();
    editingBinding = "";
    keyBindingStatusEl.textContent = "已恢复默认按键";
    renderKeyBindings();
  });
  document.querySelectorAll("[data-key-binding]").forEach(function (button) {
    button.addEventListener("click", function () {
      beginKeyBinding(button.getAttribute("data-key-binding"));
    });
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
  renderKeyBindings();
  render();
  window.requestAnimationFrame(gameLoop);
})();
