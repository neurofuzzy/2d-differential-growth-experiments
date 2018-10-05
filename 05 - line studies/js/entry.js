let Node = require('../../core/Node'),
    Path = require('../../core/Path'),
    World = require('../../core/World'),
    Settings = require('./Settings');

let world;

const HORIZONTAL = 0,
      VERTICAL = 1,
      ANGLED = 2,
      RADIAL = 3,
      OPPOSING_ARCS = 4;
let currentLineType = OPPOSING_ARCS;


/*
=============================================================================
  Main sketch
=============================================================================
*/

const sketch = function (p5) {
  // Setup -------------------------------------------------------------
  p5.setup = function () {
    p5.createCanvas(window.innerWidth, window.innerHeight);
    p5.colorMode(p5.HSB, 255);
    p5.rectMode(p5.CENTER);

    // Set up and start the simulation
    world = new World(p5, Settings);

    // Create random paths
    restartWorld();
  }

  // Draw ---------------------------------------------------------------
  p5.draw = function () {
    world.iterate();
    world.draw();

    // Draw canvas bounds for alignment with video recording software
    p5.noFill();
    p5.stroke(255);
    p5.rect(window.innerWidth/2, window.innerHeight/2, 900 - 100, 900 - 100);
  }

  // Create a grid of lines as Paths consisting of two Nodes each with configurable deltas in position
  function createLines(rows, columns, rowSpacing, columnSpacing, xDelta, yDelta) {
    let totalWidth = columnSpacing * columns;
    let totalHeight = rowSpacing * rows;

    for(let i = 0; i < rows; i++) {       // rows
      for(let j = 0; j < columns; j++) {  // columns
        let nodes = [];

        // Lower left node
        nodes.push(
          new Node(
            p5, 
            (j * columnSpacing) + (window.innerWidth / 2) - (totalWidth / 2), 
            (i * rowSpacing) + (window.innerHeight / 2) - (totalHeight / 2) + rowSpacing/2, 
            Settings
          )
        );

        // Upper right node
        nodes.push(
          new Node(
            p5, 
            (j * columnSpacing) + (window.innerWidth / 2) + xDelta - (totalWidth / 2),
            (i * rowSpacing) + (window.innerHeight / 2) + yDelta - (totalHeight / 2) + rowSpacing/2, 
            Settings
          )
        );

        // Construct path and add to world
        world.addPath(
          new Path(
            p5, 
            nodes, 
            Settings
          )
        );
      }
    }
  }

  // Horizontal lines only have deltas along X axis
  function createHorizontalLines(rows, columns) {
    createLines(rows, columns, 20, 45, 30, 0);
  }

  // Vertical lines only have deltas along Y axis
  function createVerticalLines(rows, columns) {
    createLines(rows, columns, 38, 20, 0, 30);
  }

  // Angled lines have deltas along both X and Y axes
  function createAngledLines(rows, columns) {
    createLines(rows, columns, 38, 20, -30, 30);
  }

  // Create an arc composed of lines
  function createArcLines(centerX, centerY, degreesStart, degreesEnd, innerRadius, linesPerArc, lineLength) {
    let angleDelta = (degreesEnd - degreesStart) / linesPerArc;
    let outerRadius = innerRadius + lineLength;

    for(let i = degreesStart; i < degreesEnd; i += angleDelta) {
      let nodes = [];

      // Innermost Node
      nodes[0] = new Node(
        p5,
        innerRadius * Math.cos(i * (Math.PI / 180)),
        innerRadius * Math.sin(i * (Math.PI / 180)),
        Settings
      );

      // Outermost Node
      nodes[1] = new Node(
        p5,
        outerRadius * Math.cos(i * (Math.PI / 180)),
        outerRadius * Math.sin(i * (Math.PI / 180)),
        Settings
      );

      let path = new Path(p5, nodes, Settings);
      path.moveTo(centerX, centerY);

      world.addPath(path);
    }
  }

  // Create two arcs of lines in opposing corners of the canvas
  function createOpposingArcs() {
    createArcLines(window.innerWidth/2 - 900/2 + 100, window.innerHeight/2 + 900/2 - 75, 270, 360, 375, 66, 100);
    createArcLines(window.innerWidth/2 + 900/2 - 100, window.innerHeight/2 - 900/2 + 75, 90, 180, 375, 60, 100);
  }

  // Create a full ring of lines
  function createLineRing() {
    createArcLines(window.innerWidth/2, window.innerHeight/2, 0, 360, 75, 60, 50);
  }

  // Restart the simulation with the selected path type -------------------
  function restartWorld() {
    world.clearPaths();

    // Create a field of lines
    switch(currentLineType) {
      case HORIZONTAL:
        createHorizontalLines(30, 10);
        break;
      case VERTICAL:
        createVerticalLines(10, 30);
        break;
      case ANGLED:
        createAngledLines(15, 20);
        break;
      case RADIAL:
        createLineRing();
        break;
      case OPPOSING_ARCS:
        createOpposingArcs();
        break;
    }
    
    // Draw the first frame, then pause
    world.drawBackground();
    world.draw();
    world.pause();

    // Restart simulation after 1s
    setTimeout(function() {
      world.unpause();
    }, 1000);
  }


  /*
  =============================================================================
    Key handler
  =============================================================================
  */
  p5.keyReleased = function() {
    switch (p5.key) {
      // Switch to horizontal lines with '1'
      case '1':
        currentLineType = HORIZONTAL;
        restartWorld();
        break;

      // Switch to vertical lines with '2'
      case '2':
        currentLineType = VERTICAL;
        restartWorld();
        break;

      // Switch to angled lines with '3'
      case '3':
        currentLineType = ANGLED;
        restartWorld();
        break;

      case '4':
        currentLineType

      // Switch to radial arrangement of lines with '4'
      case '4':
        currentLineType = RADIAL;
        restartWorld();
        break;

      // Toggle trace mode with 't'
      case 't':
        world.toggleTraceMode()
        break;
  
      // Toggle drawing of nodes with 'n'
      case 'n':
        world.toggleDrawNodes();
        break;
    
      // Reset simulation with current parameters with 'r'
      case 'r':
        restartWorld();
        break;

      // Toggle pause with Space
      case ' ':
        world.paused = !world.paused;
        break;

      // Invert colors with 'i'
      case 'i':
        world.toggleInvertedColors();
        break;

      // Toggle debug mode with 'd'
      case 'd':
        world.toggleDebugMode()
        break;

      // Toggle fill for all shapes with 'f'
      case 'f':
        world.toggleFillMode();
        break;

      // Export SVG with 's'
    }
  }
}

// Launch the sketch using p5js in instantiated mode
new p5(sketch);