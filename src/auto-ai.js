(function () {
  "use strict";

  /*
   * The normal game intentionally keeps the AI separate from the renderer and
   * the input layer.  This makes the search deterministic for a given board
   * and also lets us test it without driving a browser.
   */
  window.TetrisAutoAI = {
    create: function (Tetris) {
      var COLS = Tetris.COLS;
      var ROWS = Tetris.ROWS;
      var SHAPES = Tetris.SHAPES;
      var WELL_COLUMN = COLS - 1;
      var SAFE_HEIGHT = 12;
      var RECOVERY_HEIGHT = 9;
      var BEAM_WIDTH = 10;
      var DISCOUNT = 0.72;
      var EXPECTED_DISCOUNT = 0.48;
      var SCORE_BY_LINES = [0, 100, 300, 500, 800];
      var LINE_MULTIPLIERS = [0, 1, 2, 3, 4];
      var TYPES = Object.keys(SHAPES);

      /*
       * These are the deployed weights.  They are kept together so an
       * offline CEM trainer can replace this vector later without changing
       * the search implementation.  Runtime CEM training would pause the
       * game and is therefore deliberately not run in the browser.
       */
      var WEIGHTS = {
        Build: {
          /* A four-line clear is the primary objective in Build mode. */
          tetris: 2000000,
          waste: -30000,
          lineScore: 0,
          holes: -24000,
          aggregateHeight: -40,
          maxHeight: -120,
          bumpiness: -55,
          rowTransitions: -40,
          colTransitions: -28,
          landingHeight: -9,
          wellDepth: 190,
          wellFillPotential: 1800,
          tetrisPotential: 9000,
          nearCompleteRows: 500,
          wellViolation: -38000
        },
        Dig: {
          tetris: 1800000,
          waste: 0,
          /* In Dig mode a line is both score and emergency headroom. */
          lineScore: 600,
          holes: -50000,
          aggregateHeight: -60,
          maxHeight: -330,
          bumpiness: -58,
          rowTransitions: -50,
          colTransitions: -38,
          landingHeight: -22,
          wellDepth: 65,
          wellFillPotential: 500,
          tetrisPotential: 3200,
          nearCompleteRows: 260,
          wellViolation: -2400
        }
      };

      function cloneBoard(board) {
        return board.map(function (row) {
          return row.slice();
        });
      }

      function cloneShape(shape) {
        return shape.map(function (row) {
          return row.slice();
        });
      }

      function rotateShape(shape) {
        var size = shape.length;
        var rotated = Array.from({ length: size }, function () {
          return Array.from({ length: size }, function () { return 0; });
        });

        for (var y = 0; y < size; y += 1) {
          for (var x = 0; x < size; x += 1) {
            rotated[x][size - 1 - y] = shape[y][x];
          }
        }
        return rotated;
      }

      function shapeKey(shape) {
        return JSON.stringify(shape);
      }

      function getUniqueRotations(shape) {
        var rotations = [];
        var rotated = cloneShape(shape);

        for (var i = 0; i < 4; i += 1) {
          if (!rotations.some(function (candidate) {
            return shapeKey(candidate) === shapeKey(rotated);
          })) {
            rotations.push(cloneShape(rotated));
          }
          rotated = rotateShape(rotated);
        }
        return rotations;
      }

      function shapeCells(shape, x, y, type) {
        var cells = [];
        for (var row = 0; row < shape.length; row += 1) {
          for (var column = 0; column < shape[row].length; column += 1) {
            if (shape[row][column]) {
              cells.push({ x: x + column, y: y + row, type: type });
            }
          }
        }
        return cells;
      }

      function getHorizontalBounds(shape) {
        var minColumn = shape.length;
        var maxColumn = -1;
        for (var row = 0; row < shape.length; row += 1) {
          for (var column = 0; column < shape[row].length; column += 1) {
            if (shape[row][column]) {
              minColumn = Math.min(minColumn, column);
              maxColumn = Math.max(maxColumn, column);
            }
          }
        }
        return { min: minColumn, max: maxColumn };
      }

      function collides(board, shape, x, y) {
        var cells = shapeCells(shape, x, y);
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

      function findDropY(board, shape, x, startY) {
        if (collides(board, shape, x, startY)) {
          return null;
        }

        var y = startY;
        while (!collides(board, shape, x, y + 1)) {
          y += 1;
        }
        return y;
      }

      function placeAndClear(board, shape, x, y, type) {
        var result = cloneBoard(board);
        var cells = shapeCells(shape, x, y, type);
        cells.forEach(function (cell) {
          if (cell.y >= 0 && cell.y < ROWS) {
            result[cell.y][cell.x] = type;
          }
        });

        var lines = 0;
        for (var row = ROWS - 1; row >= 0; row -= 1) {
          if (result[row].every(Boolean)) {
            result.splice(row, 1);
            result.unshift(Array.from({ length: COLS }, function () { return null; }));
            lines += 1;
            row += 1;
          }
        }
        return { board: result, lines: lines, cells: cells };
      }

      function getBoardFeatures(board) {
        var heights = Array.from({ length: COLS }, function () { return 0; });
        var holes = 0;
        var rowTransitions = 0;
        var colTransitions = 0;
        var nearCompleteRows = 0;

        for (var x = 0; x < COLS; x += 1) {
          var foundBlock = false;
          for (var y = 0; y < ROWS; y += 1) {
            if (board[y][x]) {
              if (!foundBlock) {
                heights[x] = ROWS - y;
                foundBlock = true;
              }
            } else if (foundBlock) {
              holes += 1;
            }
          }
        }

        for (var row = 0; row < ROWS; row += 1) {
          var previous = true;
          var filled = 0;
          for (var column = 0; column < COLS; column += 1) {
            var occupied = Boolean(board[row][column]);
            if (occupied) filled += 1;
            if (occupied !== previous) rowTransitions += 1;
            previous = occupied;
          }
          if (!previous) rowTransitions += 1;
          if (filled >= COLS - 2) {
            nearCompleteRows += filled - (COLS - 3);
          }
        }

        for (var columnIndex = 0; columnIndex < COLS; columnIndex += 1) {
          var previousCell = true;
          for (var rowIndex = 0; rowIndex < ROWS; rowIndex += 1) {
            var occupiedCell = Boolean(board[rowIndex][columnIndex]);
            if (occupiedCell !== previousCell) colTransitions += 1;
            previousCell = occupiedCell;
          }
          if (!previousCell) colTransitions += 1;
        }

        var aggregateHeight = heights.reduce(function (total, height) {
          return total + height;
        }, 0);
        var maxHeight = Math.max.apply(null, heights);
        var bumpiness = 0;
        for (var heightIndex = 0; heightIndex < COLS - 1; heightIndex += 1) {
          bumpiness += Math.abs(heights[heightIndex] - heights[heightIndex + 1]);
        }

        var wellDepth = 0;
        for (var wellRow = ROWS - 1; wellRow >= 0 && !board[wellRow][WELL_COLUMN]; wellRow -= 1) {
          wellDepth += 1;
        }

        var wellFillPotential = 0;
        var rowsToScore = Math.min(wellDepth, 8);
        for (var scoreRow = ROWS - 1; scoreRow >= ROWS - rowsToScore; scoreRow -= 1) {
          var filledOutsideWell = 0;
          for (var scoreColumn = 0; scoreColumn < COLS; scoreColumn += 1) {
            if (scoreColumn !== WELL_COLUMN && board[scoreRow][scoreColumn]) {
              filledOutsideWell += 1;
            }
          }
          /* Cubic shaping rewards nearly-complete rows more than scattered blocks. */
          wellFillPotential += Math.pow(filledOutsideWell, 3) / Math.pow(COLS - 1, 2);
        }

        var tetrisPotential = 0;
        for (var potentialRow = ROWS - 1; potentialRow >= 0; potentialRow -= 1) {
          if (board[potentialRow][WELL_COLUMN]) break;
          var nonWellFilled = 0;
          for (var nonWellColumn = 0; nonWellColumn < COLS; nonWellColumn += 1) {
            if (nonWellColumn !== WELL_COLUMN && board[potentialRow][nonWellColumn]) {
              nonWellFilled += 1;
            }
          }
          if (nonWellFilled < COLS - 1) break;
          tetrisPotential += 1;
        }

        return {
          heights: heights,
          aggregateHeight: aggregateHeight,
          maxHeight: maxHeight,
          holes: holes,
          bumpiness: bumpiness,
          rowTransitions: rowTransitions,
          colTransitions: colTransitions,
          nearCompleteRows: nearCompleteRows,
          wellDepth: wellDepth,
          wellFillPotential: wellFillPotential,
          tetrisPotential: tetrisPotential
        };
      }

      function scoreForLines(lines) {
        return (SCORE_BY_LINES[lines] || 0) * (LINE_MULTIPLIERS[lines] || 1);
      }

      function modeFor(features, previousMode) {
        if (previousMode === "Dig") {
          return features.maxHeight <= RECOVERY_HEIGHT && features.holes === 0 ? "Build" : "Dig";
        }
        /*
         * With no Hold slot, waiting until the nominal height 12 can be too
         * late: the next I may still be several pieces away.  The extra
         * pressure rule starts spending singles around height 10 so the
         * browser version can survive without a Hold slot.
         */
        return features.maxHeight > SAFE_HEIGHT || features.holes >= 2 ||
          features.maxHeight > 10 ? "Dig" : "Build";
      }

      function isVerticalI(shape, x) {
        var occupiedColumns = {};
        for (var row = 0; row < shape.length; row += 1) {
          for (var column = 0; column < shape[row].length; column += 1) {
            if (shape[row][column]) occupiedColumns[x + column] = true;
          }
        }
        var columns = Object.keys(occupiedColumns);
        return columns.length === 1 && Number(columns[0]) === WELL_COLUMN;
      }

      function getPlacementMetrics(shape, x, y, type) {
        var cells = shapeCells(shape, x, y, type);
        var wellUsage = 0;
        var lowest = ROWS;
        var highest = -1;
        cells.forEach(function (cell) {
          if (cell.y >= 0) {
            lowest = Math.min(lowest, cell.y);
            highest = Math.max(highest, cell.y);
            if (cell.x === WELL_COLUMN) wellUsage += 1;
          }
        });

        return {
          landingHeight: highest < 0 ? ROWS : ROWS - ((lowest + highest) / 2),
          wellViolation: type === "I" && isVerticalI(shape, x) ? 0 : wellUsage,
          overflow: cells.some(function (cell) { return cell.y < 0; })
        };
      }

      function boardValue(features, mode) {
        var weights = WEIGHTS[mode];
        var value = 0;
        value += features.holes * weights.holes;
        value += features.aggregateHeight * weights.aggregateHeight;
        value += features.maxHeight * weights.maxHeight;
        value += features.bumpiness * weights.bumpiness;
        value += features.rowTransitions * weights.rowTransitions;
        value += features.colTransitions * weights.colTransitions;
        value += features.wellDepth * weights.wellDepth;
        value += features.wellFillPotential * weights.wellFillPotential;
        value += features.tetrisPotential * weights.tetrisPotential;
        value += features.nearCompleteRows * weights.nearCompleteRows;

        if (features.wellDepth >= 4) value += 18000;
        if (features.wellDepth >= 8) value += 42000;
        if (features.tetrisPotential >= 4) value += 60000;
        if (features.tetrisPotential >= 8) value += 100000;
        return value;
      }

      function transitionValue(lines, mode, metrics, type, shape, x) {
        var weights = WEIGHTS[mode];
        var value = 0;
        var lineScore = scoreForLines(lines);

        if (lines === 4) {
          value += weights.tetris + lineScore * 100;
        } else if (lines > 0) {
          value += weights.waste - lineScore * (mode === "Build" ? 20 : 0);
          value += lineScore * weights.lineScore;
        }

        value += metrics.landingHeight * weights.landingHeight;
        value += metrics.wellViolation * weights.wellViolation;

        if (mode === "Build" && type !== "I" && metrics.wellViolation > 0) {
          value -= 18000;
        }
        if (mode === "Build" && type === "I" && isVerticalI(shape, x) && metrics.wellViolation === 0) {
          value += 12000;
        }
        return value;
      }

      function evaluatePlacement(board, mode, type, shape, x, y) {
        var metrics = getPlacementMetrics(shape, x, y, type);
        if (metrics.overflow) return null;

        var result = placeAndClear(board, shape, x, y, type);
        var features = getBoardFeatures(result.board);
        var nextMode = modeFor(features, mode);
        var value = transitionValue(result.lines, mode, metrics, type, shape, x);
        value += boardValue(features, nextMode);

        return {
          board: result.board,
          lines: result.lines,
          features: features,
          mode: nextMode,
          shape: cloneShape(shape),
          x: x,
          y: y,
          value: value
        };
      }

      function enumeratePlacements(board, type, sourceShape, mode) {
        var rotations = getUniqueRotations(sourceShape || SHAPES[type]);
        var placements = [];
        rotations.forEach(function (shape) {
          var startY = type === "I" ? -1 : 0;
          var bounds = getHorizontalBounds(shape);
          var firstX = -bounds.min;
          var lastX = COLS - 1 - bounds.max;
          for (var x = firstX; x <= lastX; x += 1) {
            var y = findDropY(board, shape, x, startY);
            if (y === null) continue;
            var placement = evaluatePlacement(board, mode, type, shape, x, y);
            if (placement) placements.push(placement);
          }
        });

        placements.sort(function (left, right) {
          return right.value - left.value;
        });
        return placements;
      }

      function weightedBagTypes(game) {
        var pool = game.bag && game.bag.length ? game.bag.slice() : TYPES.slice();
        var counts = {};
        pool.forEach(function (type) {
          counts[type] = (counts[type] || 0) + 1;
        });
        return Object.keys(counts).map(function (type) {
          return { type: type, probability: counts[type] / pool.length };
        });
      }

      function getRotationSteps(shape, targetShape) {
        var rotated = cloneShape(shape);
        for (var steps = 0; steps < 4; steps += 1) {
          if (shapeKey(rotated) === shapeKey(targetShape)) return steps;
          rotated = rotateShape(rotated);
        }
        return 0;
      }

      function choose(game) {
        var initialFeatures = getBoardFeatures(game.board);
        var initialMode = modeFor(initialFeatures, "Build");
        var currentType = game.current.type;
        var currentShape = game.current.shape;
        var firstCandidates = enumeratePlacements(game.board, currentType, currentShape, initialMode);
        if (!firstCandidates.length) return null;

        var firstBeam = firstCandidates.slice(0, BEAM_WIDTH);
        var nextType = game.next && game.next.type;
        var nextStates = [];

        if (nextType) {
          firstBeam.forEach(function (first) {
            var secondCandidates = enumeratePlacements(first.board, nextType, SHAPES[nextType], first.mode);
            secondCandidates.slice(0, BEAM_WIDTH).forEach(function (second) {
              nextStates.push({
                first: first,
                value: first.value + DISCOUNT * second.value,
                board: second.board,
                mode: second.mode
              });
            });
          });
        }

        if (!nextStates.length) {
          return {
            targetX: firstCandidates[0].x,
            targetShape: firstCandidates[0].shape,
            rotationSteps: getRotationSteps(currentShape, firstCandidates[0].shape),
            mode: firstCandidates[0].mode,
            value: firstCandidates[0].value
          };
        }

        nextStates.sort(function (left, right) {
          return right.value - left.value;
        });
        var secondBeam = nextStates.slice(0, BEAM_WIDTH);
        var expectedTypes = weightedBagTypes(game);
        var bestState = null;

        secondBeam.forEach(function (state) {
          var expectedValue = 0;
          expectedTypes.forEach(function (entry) {
            var candidates = enumeratePlacements(state.board, entry.type, SHAPES[entry.type], state.mode);
            if (candidates.length) {
              expectedValue += entry.probability * candidates[0].value;
            }
          });
          var totalValue = state.value + EXPECTED_DISCOUNT * expectedValue;
          if (!bestState || totalValue > bestState.value) {
            bestState = { state: state, value: totalValue };
          }
        });

        var best = bestState ? bestState.state.first : firstCandidates[0];
        return {
          targetX: best.x,
          targetShape: best.shape,
          rotationSteps: getRotationSteps(currentShape, best.shape),
          mode: best.mode,
          value: bestState ? bestState.value : best.value
        };
      }

      return {
        choose: choose,
        weights: WEIGHTS,
        safeHeight: SAFE_HEIGHT
      };
    }
  };
})();
