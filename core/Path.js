/** @module Path */

let knn = require('rbush-knn'),
    Node = require('./Node'),
    Bounds = require('./Bounds'),
    Defaults = require('./Defaults');

/** Manages a set of Nodes in a continuous, ordered data structure (an Array). */
class Path {
  /**
   * Create a new Path object
   * @param {object} p5 Reference to global p5.js instance
   * @param {array} nodes Array of initial Node objects to start with
   * @param {object} [settings] Object containing local override Settings to be merged with Defaults
   * @param {boolean} [isClosed] Whether this Path is closed (true) or open (false)
   * @param {object} [bounds] Bounds object that this Path must stay within
   * @param {object} [fillColor] Fill color object containing properties h, s, b, and a
   * @param {object} [strokeColor] Stroke color object containing properties h, s, b, and a
   * @param {object} [invertedFillColor] Fill color in "invert mode" containing properties h, s, b, and a
   * @param {object} [invertedStrokeColor] Stroke color in "invert mode" containing properties h, s, b, and a
   */
  constructor(
    p5, 
    nodes, 
    settings = Defaults, 
    isClosed = false, 
    bounds = false,
    fillColor = {h:0, s:0, b:0, a:255}, 
    strokeColor = {h:0, s:0, b:0, a:255}, 
    invertedFillColor = {h:0, s:0, b:255, a:255}, 
    invertedStrokeColor = {h:0, s:0, b:255, a:255}
  ) {
    this.p5 = p5;
    this.nodes = nodes;
    this.isClosed = isClosed;
    this.settings = Object.assign({}, Defaults, settings);
    this.bounds = bounds;

    this.injectionMode = "RANDOM";
    this.lastNodeInjectTime = 0;

    this.nodeHistory = [];

    this.drawNodes = this.settings.DrawNodes;
    this.invertedColors = this.settings.InvertedColors;
    this.traceMode = this.settings.TraceMode;
    this.debugMode = this.settings.DebugMode;
    this.fillMode = this.settings.FillMode;
    this.useBrownianMotion = this.settings.UseBrownianMotion;
    this.drawHistory = this.settings.DrawHistory;
    this.showBounds = this.settings.ShowBounds;

    this.fillColor = fillColor;
    this.strokeColor = strokeColor;
    this.invertedFillColor = invertedFillColor;
    this.invertedStrokeColor = invertedStrokeColor;

    this.currentFillColor = this.fillColor;
    this.currentStrokeColor = this.strokeColor;

    if(this.invertedColors) {
      this.currentFillColor = this.invertedFillColor;
      this.currentStrokeColor = this.invertedStrokeColor;
    }
  }

  /**
   * Run one "tick" of the simulation
   * @param {object} tree Reference to the appropriate R-tree index that this Path belongs to (see World)
   */
  iterate(tree) {
    for (let [index, node] of this.nodes.entries()) {
      // Apply Brownian motion to realistically 'jiggle' nodes
      if(this.useBrownianMotion) {
        this.applyBrownianMotion(index);
      }

      // Move towards neighbors (attraction), if there is space to move
      this.applyAttraction(index);

      // Move away from any nodes that are too close (repulsion)
      this.applyRepulsion(index, tree);

      // Align with neighbors
      this.applyAlignment(index);

      // Apply boundaries
      this.applyBounds(index);

      // Move towards next position
      node.iterate();
    }

    // Split any edges that have become too long
    this.splitEdges();

    // Remove any nodes that are too close to other nodes
    this.pruneNodes();

    // Inject a new node to introduce asymmetry every so often
    if (this.p5.millis() - this.lastNodeInjectTime >= this.settings.NodeInjectionInterval) {
      this.injectNode();
      this.lastNodeInjectTime = this.p5.millis();
    }
  }

  /**
   * For the Node wit the provided index, simulate the small random motions that real microscopic particles experience from collisions with fast-moving molecules
   * @param {number} index Index of Node to apply forces to
   */
  applyBrownianMotion(index) {
    this.nodes[index].x += this.p5.random(-this.settings.BrownianMotionRange/2, this.settings.BrownianMotionRange/2);
    this.nodes[index].y += this.p5.random(-this.settings.BrownianMotionRange/2, this.settings.BrownianMotionRange/2);
  }

  /**
   * Move the Node with the provided index closer to it's connected neighbor Nodes
   * @param {number} index Index of Node to apply forces to
   */
  applyAttraction(index) {
    let distance, leastMinDistance;
    let connectedNodes = this.getConnectedNodes(index);

    // Move towards next node, if there is one
    if (
      connectedNodes.nextNode != undefined && connectedNodes.nextNode instanceof Node && 
      !this.nodes[index].isFixed
    ) {
      distance = this.nodes[index].distance(connectedNodes.nextNode);
      leastMinDistance = Math.min(this.nodes[index].minDistance, connectedNodes.nextNode.minDistance);

      if (distance > leastMinDistance) {
        this.nodes[index].nextPosition.x = this.p5.lerp(this.nodes[index].nextPosition.x, connectedNodes.nextNode.x, this.settings.AttractionForce);
        this.nodes[index].nextPosition.y = this.p5.lerp(this.nodes[index].nextPosition.y, connectedNodes.nextNode.y, this.settings.AttractionForce);
      }
    }

    // Move towards previous node, if there is one
    if (
      connectedNodes.previousNode != undefined && connectedNodes.previousNode instanceof Node && 
      !this.nodes[index].isFixed
    ) {
      distance = this.nodes[index].distance(connectedNodes.previousNode);
      leastMinDistance = Math.min(this.nodes[index].minDistance, connectedNodes.previousNode.minDistance);

      if (distance > leastMinDistance) {
        this.nodes[index].nextPosition.x = this.p5.lerp(this.nodes[index].nextPosition.x, connectedNodes.previousNode.x, this.settings.AttractionForce);
        this.nodes[index].nextPosition.y = this.p5.lerp(this.nodes[index].nextPosition.y, connectedNodes.previousNode.y, this.settings.AttractionForce);
      }
    }
  }

  /**
   * Move the referenced Node (by index) away from all other nearby Nodes within the appropriate R-tree index (tree), within a pre-defined radius
   * @param {number} index Index of Node to apply forces to
   * @param {object} tree Reference to the appropriate R-tree index that this Path belongs to (see World)
   */
  applyRepulsion(index, tree) {
    // Perform knn search to find all neighbors within certain radius
    var neighbors = knn(tree, 
                        this.nodes[index].x, 
                        this.nodes[index].y,
                        undefined,
                        undefined,
                        this.nodes[index].repulsionRadius * this.nodes[index].repulsionRadius); // radius must be squared as per https://github.com/mourner/rbush-knn/issues/13

    // Move this node away from all nearby neighbors
    // TODO: Make this proportional to distance?
    for(let node of neighbors) {
      this.nodes[index].nextPosition.x = this.p5.lerp(this.nodes[index].x, node.x, -this.settings.RepulsionForce);
      this.nodes[index].nextPosition.y = this.p5.lerp(this.nodes[index].y, node.y, -this.settings.RepulsionForce);
    }
  }

  /**
   * Move the referenced Node (by index) towards the midpoint of it's connected neighbor Nodes in an effort to minimize curvature
   * @param {number} index Index of Node to apply forces to
   */
  applyAlignment(index) {
    let connectedNodes = this.getConnectedNodes(index);

    if (
      connectedNodes.previousNode != undefined && connectedNodes.previousNode instanceof Node &&
      connectedNodes.nextNode != undefined && connectedNodes.nextNode instanceof Node &&
      !this.nodes[index].isFixed
    ) {
      // Find the midpoint between the neighbors of this node
      let midpoint = this.getMidpointNode(connectedNodes.previousNode, connectedNodes.nextNode);

      // Move this point towards this midpoint
      this.nodes[index].nextPosition.x = this.p5.lerp(this.nodes[index].nextPosition.x, midpoint.x, this.settings.AlignmentForce);
      this.nodes[index].nextPosition.y = this.p5.lerp(this.nodes[index].nextPosition.y, midpoint.y, this.settings.AlignmentForce);
    }
  }

  /** Search for edges that are too long and inject a new Node to split them up */
  splitEdges() {
    for (let [index, node] of this.nodes.entries()) {
      let connectedNodes = this.getConnectedNodes(index);

      if (
        connectedNodes.previousNode != undefined && connectedNodes.previousNode instanceof Node &&
        node.distance(connectedNodes.previousNode) >= this.settings.MaxDistance) 
      {
        let midpointNode = this.getMidpointNode(node, connectedNodes.previousNode);
        
        // Inject the new midpoint node into the global list
        if(index == 0) {
          this.nodes.splice(this.nodes.length, 0, midpointNode);
        } else {
          this.nodes.splice(index, 0, midpointNode);
        }
      }
    }
  }

  /** Remove Nodes that are too close to their neighbors to minimize "pinching" */
  pruneNodes() {
    for(let [index, node] of this.nodes.entries()) {
      let connectedNodes = this.getConnectedNodes(index);

      if(
        connectedNodes.previousNode != undefined && connectedNodes.previousNode instanceof Node &&
        node.distance(connectedNodes.previousNode) < this.settings.MinDistance) 
      {
        if(index == 0) {
          if(!this.nodes[this.nodes.length - 1].isFixed) {
            this.nodes.splice(this.nodes.length - 1, 1);
          }
        } else {
          if(!this.nodes[index - 1].isFixed) {
            this.nodes.splice(index - 1, 1);
          }
        }
      }
    }
  }

  /** Insert a new Node using the current injection method */
  injectNode() {
    switch(this.injectionMode) {
      case "RANDOM":
        this.injectRandomNode();
        break;
      case "CURVATURE":
        this.injectNodeByCurvature();
        break;
    }
  }

    /** Insert a new Node in a random location along the Path, if there is space for it */
    injectRandomNode() {
      // Choose two connected nodes at random
      let index = parseInt(this.p5.random(1, this.nodes.length));
      let connectedNodes = this.getConnectedNodes(index);

      if (
        connectedNodes.previousNode != undefined && connectedNodes.previousNode instanceof Node &&
        connectedNodes.nextNode != undefined && connectedNodes.nextNode instanceof Node &&
        this.nodes[index].distance(connectedNodes.previousNode) > this.settings.MinDistance
      ) {
        // Create a new node in the middle
        let midpointNode = this.getMidpointNode(this.nodes[index], connectedNodes.previousNode);
        
        // Splice new node into array
        this.nodes.splice(index, 0, midpointNode);
      }
    }

    /** Insert a new Node in an area where curvature is high */
    injectNodeByCurvature() {
      for(let [index, node] of this.nodes.entries()) {
        let connectedNodes = this.getConnectedNodes(index);

        if( connectedNodes.previousNode == undefined || connectedNodes.nextNode == undefined ) {
          continue;
        }

        // Find angle between adjacent nodes
        let n = connectedNodes.nextNode.y - connectedNodes.previousNode.y;
        let d = connectedNodes.nextNode.x - connectedNodes.previousNode.x;
        let angle = Math.round(Math.abs(Math.atan(n/d)));
        
        // // If angle is below a certain angle (high curvature), replace the current node with two nodes
        if(angle > 20) {
          let previousMidpointNode = this.getMidpointNode(node, connectedNodes.previousNode);
          let nextMidpointNode = this.getMidpointNode(node, connectedNodes.nextNode);
          
          // // Replace this node with the two new nodes
          if(index == 0) {
            this.nodes.splice(this.nodes.length-1, 0, previousMidpointNode);
            this.nodes.splice(0, 0, nextMidpointNode);
          } else {
            this.nodes.splice(index, 1, previousMidpointNode, nextMidpointNode);
          }
        }
      }
    }

  /**
   * Do not allow the referenced Node (by index) to leave the interior of the assigned Bounds polygon
   * @param {number} index Index of Node to apply force to
   */
  applyBounds(index) {
    if(
      this.bounds != undefined && this.bounds instanceof Bounds &&
      !this.bounds.contains([this.nodes[index].x, this.nodes[index].y])
    ) {
      this.nodes[index].isFixed = true;
    }
  }

  /**
   * For a given Node, find a return it's immediate connected neighbor Nodes
   * @param {number} index Index of Node to retrieve neighbors of
   * @returns {object} References to previous and next nodes, if they exist. Will always return a value for at least one.
   */
  getConnectedNodes(index) {
    let previousNode, nextNode;

    // Find previous node, if there is one
    if(index == 0 && this.isClosed) {
      previousNode = this.nodes[this.nodes.length - 1];
    } else if(index >= 1) {
      previousNode = this.nodes[index - 1];
    }

    // Find next node, if there is one
    if(index == this.nodes.length - 1 && this.isClosed) {
      nextNode = this.nodes[0];
    } else if(index <= this.nodes.length - 1) {
      nextNode = this.nodes[index + 1];
    }

    return {
      previousNode,
      nextNode
    };
  }

  /**
   * Create and return a Node exactly halfway between the two provided Nodes
   * @param {object} node1 First node
   * @param {object} node2 Second node
   * @param {boolean} [fixed] Whether this new Node should be fixed or not
   * @returns {object} New Node object
   */
  getMidpointNode(node1, node2, fixed = false) {
    return new Node(
      this.p5,
      (node1.x + node2.x) / 2,
      (node1.y + node2.y) / 2,
      this.settings,
      fixed
    );
  }

  /** Draw this Path to the canvas using current object visibility settings */
  draw() {
    // Draw all the previous paths saved to the history array
    if(this.drawHistory) {
      this.drawPreviousEdges();
    }

    // Draw bounds
    if(this.showBounds && this.bounds != undefined && this.bounds instanceof Bounds) {
      this.drawBounds();
    }

    // Set shape fill 
    if(this.fillMode && this.isClosed) {
      this.p5.fill(this.currentFillColor.h, this.currentFillColor.s, this.currentFillColor.b, this.currentFillColor.a);
    } else {
      this.p5.noFill();
    }

    // Set stroke color
    this.p5.stroke(this.currentStrokeColor.h, this.currentStrokeColor.s, this.currentStrokeColor.b, this.currentStrokeColor.a);

    // Draw current edges
    this.drawCurrentEdges();

    // Draw all nodes
    if(this.drawNodes) {
      this.drawCurrentNodes();
    }
  }

  /** Draw the current edges (leading edge) of the path */
  drawCurrentEdges() {
    this.drawEdges(this.nodes);
  }

  /** Draw all previous edges of the path saved to history array */
  drawPreviousEdges() {
    for(let [index, nodes] of this.nodeHistory.entries()) {
      this.p5.stroke(
        this.currentStrokeColor.h, 
        this.currentStrokeColor.s, 
        this.currentStrokeColor.b,
        index * 30
      );

      this.drawEdges(nodes);
    }
  }

  /**
   * Draw edges for a given set of nodes - can be either the current or previous nodes
   * @param {array} nodes Array of Node objects
   */
  drawEdges(nodes) {
    // Begin capturing vertices
    if(!this.debugMode) {
      this.p5.beginShape();
    }

    // Create vertices or lines (if debug mode)
    for (let i = 0; i < nodes.length; i++) {
      if(!this.debugMode) {
        this.p5.vertex(nodes[i].x, nodes[i].y);
      } else {

        // In debug mode each line has a unique stroke color, which isn't possible with begin/endShape(). Instead we'll use line()
        if(i > 0) {
          if(!this.traceMode) {
            this.p5.stroke( this.p5.map(i, 0, nodes.length-1, 0, 255, true), 255, 255, 255 );
          } else {
            this.p5.stroke( this.p5.map(i, 0, nodes.length-1, 0, 255, true), 255, 255, 2 );
          }

          this.p5.line(nodes[i-1].x, nodes[i-1].y, nodes[i].x, nodes[i].y);
        }
      }
    }

    // For closed paths, connect the last and first nodes
    if(this.isClosed) {
      if(!this.debugMode) {
        this.p5.vertex(nodes[0].x, nodes[0].y);
      } else {
        this.p5.line(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y, nodes[0].x, nodes[0].y);
      }
    }

    // Stop capturing vertices
    if(!this.debugMode) {
      this.p5.endShape();
    }
  }

  /** Draw circles for every node */
  drawCurrentNodes() {
    this.p5.noStroke();

    if(!this.invertedColors) {
      this.p5.fill(0);
    } else {
      this.p5.fill(255);
    }

    for (let [index, node] of this.nodes.entries()) {
      if(this.debugMode) {
        this.p5.fill( this.p5.map(index, 0, this.nodes.length-1, 0, 255, true), 255, 255, 255 );
      }

      node.draw();
    }
  }

  /** Draw boundary shape(s) */
  drawBounds() {
    if(!this.invertedColors) {
      this.p5.stroke(200);
    } else {
      this.p5.stroke(100);
    }

    this.p5.noFill();

    this.bounds.draw();
  }

  /** Take a snapshot of the current nodes by saving a dereferenced clone of them to the history array */
  addToHistory() {
    if(this.nodeHistory.length == this.settings.MaxHistorySize) {
      this.nodeHistory.shift();
    }

    this.nodeHistory.push(Object.assign([], JSON.parse(JSON.stringify(this.nodes))));
  }

  /**
   * Move this entire Path by a certain amount by moving all of it's Nodes
   * @param {number} xOffset Distance on X axis to move Path
   * @param {number} yOffset Distance on Y axis to move Path
   */
  moveTo(xOffset, yOffset) {
    for(let node of this.nodes) {
      node.x += xOffset;
      node.y += yOffset;
    }
  }

  /**
   * Scale (multiply) all Nodes by the provided factor
   * @param {number} factor Factor to multiple all Nodes' coordinates by
   */
  scale(factor) {
    for(let node of this.nodes) {
      node.x *= factor;
      node.y *= factor;
    }
  }

  /**
   * Insert a new Node object from outside of this class
   * @param {object} node Node object to insert
   */
  addNode(node) {
    this.nodes.push(node);
  }

  /**
   * Return a raw 2D array of all Node coordinates. Useful for creating Bounds objects.
   * @returns {array} Array of all Node coordinates in the format of [polygon_n][x1][y1], ...
   */
  toArray() {
    let polygon = [];

    for(let node of this.nodes) {
      polygon.push([node.x, node.y]);
    }

    return polygon;
  }

  /**
   * Get the current state of "trace mode" flag
   * @returns {boolean} Current state of "trace mode" flag
   */
  getTraceMode() {
    return this.traceMode;
  }

  /**
   * Get the current state of the "invert mode" flag
   * @returns {boolean} Current state of the "invert mode" flag
   */
  getInvertedColors() {
    return this.invertedColors;
  }

  /**
   * Sets the minimum distance that each Node wants to be from it's neighboring Nodes
   * @param {number} minDistance 
   */
  setMinDistance(minDistance) {
    this.settings.MinDistance = minDistance;

    for(let node of this.nodes) {
      node.minDistance = minDistance;
    }
  }

  /**
   * Sets the maximum distance an edge can be before it is split
   * @param {number} maxDistance 
   */
  setMaxDistance(maxDistance) {
    this.settings.MaxDistance = maxDistance;

    for(let node of this.nodes) {
      node.maxDistance = maxDistance;
    }
  }

  /**
   * Sets the radius around each Node that it can affect other Nodes
   * @param {number} repulsionRadius 
   */
  setRepulsionRadius(repulsionRadius) {
    this.settings.RepulsionRadius = repulsionRadius;

    for(let node of this.nodes) {
      node.repulsionRadius = repulsionRadius;
    }
  }

  /**
   * Sets the state of the "trace mode" flag
   * @param {boolean} state New state for "trace mode" flag
   */
  setTraceMode(state) {
    this.traceMode = state;

    if(!this.traceMode) {
      this.currentFillColor.a = 255;
      this.currentStrokeColor.a = 255;
    } else {
      this.currentFillColor.a = 255;
      this.currentStrokeColor.a = 255;
    }
  }

  /**
   * Sets the state of the "invert mode" flag
   * @param {boolean} state New state for "invert mode" flag
   */
  setInvertedColors(state) {
    this.invertedColors = state;

    if(!this.invertedColors) {
      this.currentFillColor = this.fillColor;
      this.currentStrokeColor = this.strokeColor;
    } else {
      this.currentFillColor = this.invertedFillColor;
      this.currentStrokeColor = this.invertedStrokeColor;
    }

    // Reapply the current trace mode state to make sure opacity is adjusted when colors are inverted
    this.setTraceMode(this.traceMode);
  }

  /**
   * Set the Bounds object that this Path must stay within
   * @param {object} bounds Bounds object that this Path must stay within
   */
  setBounds(bounds) {
    this.bounds = bounds;
  }

  /** Toggle the current state of the "trace mode" flag */
  toggleTraceMode() {
    this.setTraceMode(!this.getTraceMode());
  }

  /** Toggle the current state of the "invert mode" flag */
  toggleInvertedColors() {
    this.setInvertedColors(!this.getInvertedColors());
  }
}

module.exports = Path;