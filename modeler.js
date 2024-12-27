/*

- Process: issolated compute function that takes input data and state data (display element and other state) and return the output data and updated state
- Node: compute containers, subscribe to other nodes, publish to subscribers
- graphs: is a container, contains nodes, compute nodes, CURD nodes, CURD edges

- UI: dependency for rendering the gui, ensuring consistency accross languages

*/

function generateIdentifier() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}


class Process {
	constructor(identifier) {
		this.identifier = identifier || `$${generateIdentifier()}`;
		this.codeBody = "";
		this.dependencies = [];
		this.function = null;
		this.lastCompiled = null;
	}

	compile() {
		const functionText = `function ${this.name}(input, state){
      const output = {};
       ${this.codeBody}
       return {output, state};
     }`;
		const sandbox = {};
		const script = new vm.Script(functionText);
		script.runInNewContext(sandbox);
		this.function = sandbox[this.name];
		return this.function;
	}
	compute(input, state) {
		const computeFunction = this.compile();
		const results = computeFunction(input, state);
		return results;
	}

	static save(objectProcess) {
		return JSON.parse(JSON.stringify(objectProcess));
	}
	static load(objectJSON) {
		const process = new Process(objectJSON.name);
		process.codeBody = objectJSON.codeBody;
		process.lastCompiled = objectJSON.lastCompiled;

		return process;
	}
}

// pending work here
class Node {
	
	#state = {};

	constructor(container, identifier, uiElement) {
		this.inputs = [];
		this.output = new PubSub();
		this.output.data = {};

		this.container = container;
		this.identifier = identifier || generateIdentifier();

		// dependency of ui - for consistency in other languages
		// currently it is for javascript
		// todo change it as for other platforms
		this.ui = uiElement;

    if (this.ui) this.ui.setTitle(this.identifier);
	}

	compute() {
		const input = this.getInputData();
		this.#state.element = this.ui.displayElement || null;

		const {output, state} = this.container.compute(input, this.#state);

		Object.assign(this.#state, state);
		this.updateOutputData(output);

		return outputData;
	}

	getInputData() {
		let inputData = {};
		this.inputs.forEach((input) => {
			inputData = Object.assign(inputData, input.data);
		});
		return inputData;
	}
	getOutputData() {
		return this.output.data;
	}

	updateOutputData(data) {
		this.output.data = data;
		this.output.publish("update", data);
	}

	addInput(refNode) {
		const input = {
			refNodeIdentifier: refNode.identifier,
			data: refNode.output.data,
			onUpdate: (data) => {
				this.data = data;
			},
			unsubscribe: refNode.output.unsubscribe,
		};
		this.inputs.push(input);
		//subscribe to refrenced port
		const onUpdate = this.inputs[this.inputs.length - 1].onUpdate;
		const identifier = this.identifier;
		refNode.output.subscribe(identifier, "update", onUpdate);
	}
	getInputIndex(refNodeIdentifier) {
		return this.inputs.findIndex(
			(input) => input.refNodeIdentifier == refNodeIdentifier
		);
	}
	deleteInput(index) {
		const input = this.inputs[index];
		const identifier = this.identifier;
		input.unsubscribe(identifier, "update", input.onUpdate);
		this.inputs.splice(index, 1);
	}

	isSink() {
		return this.output.events["update"]
			? this.output.events["update"].length > 0
				? false
				: true
			: false;
	}
	isSource() {
		return this.inputs.length > 0 ? false : true;
	}


	static save(objectNode) {
		return JSON.parse(JSON.stringify(objectNode));
	}
	static load(objectJSON, containerLoaderFunction, graph) {
		const container = containerLoaderFunction(objectJSON.Container);
		const node = new Node(container, objectJSON.identifier);
		node.output.data = objectJSON.output.data;

		// add inputs
		objectJSON.inputs.forEach((input, i) => {
			const refNode = graph.getNode(input.refNodeIdentifier);
			node.addInput(refNode);
		});

		return node;
	}
}


// Graph Object for Nodes
class Graph {
  constructor() {
    this.nodeList = [];
    // add graph in the container
  }

  compute(data) {
    //compute all the nodes in the group with first having no inputs, using input data as parameter

    const results = [{}]
    const computedNodes = [] //index of nodes that are computed
    const ops = (node) => {
        const outputData = node.compute();
        if(node.isSink()) {
          results.push(outputData);
        }
    }

    // traverse to the root(s)
    // compute each node and move to the sink(s)
    const traverseGraphOps = (node, ops, $this) => {
      if(node.inputs.length > 0) {
        node.inputs.forEach((input, i) => {
          const node = $this.getNode(input.refNodeIdentifier);
          traverseGraphOps(node, ops, $this);
        }, $this);
      }
      const nodeIndex = $this.nodeList.indexOf(node);
      if(!computedNodes.includes(nodeIndex)) {
        ops(node);
        computedNodes.push(nodeIndex);
      }
    }
    this.nodeList.forEach((node, i) => {
      if(!computedNodes.includes(i)) {
        traverseGraphOps(node, ops, this);
      }
    },this);


    // combine the result of all the sinks into results
    let result = {};
    results.forEach((data, i) => {
      result = Object.assign(result, data);
    });

    return result;
  }

  addNode(container, identifier) {
    this.nodeList.push(new Node(container, identifier));
  };
  addNodes(nodes) {
    nodes.forEach((node) => {
      this.nodeList.push(new Node(node.container, node.identifier))
    },this);
  };
  removeNode(identifier) {
    // get the node with given identifier
    const node = this.getNode(identifier);
    // remove all the inputs from the node
    node.inputs.forEach((input, i) => {
      node.deleteInput(i);
    });
    // remove all the inputs that point to that node
    const listeningNodeIdentifiers = [];
    node.output.events.forEach((e) => {
      e.forEach((listener) => {
        listeningNodeIdentifiers.push(listener.identifier);
      });

    });
    listeningNodeIdentifiers.forEach((listeningNodeIdentifier) => {
      const listeningNode = this.getNode(listeningNodeIdentifier);
      listeningNode.deleteInput(listeningNode.getInputIndex(identifier));
    }, this);

    // remove the node from graph
    this.nodes = this.nodes.filter((node) => node.identifier !== identifier);
  };

  addSubGraphNode(nodes, identifier) {
    const subGraph = new Graph();
    subGraph.addNodes(nodes);
    const subGraphNode = new Node(subGraph, identifier);
    this.nodeList.push(subGraphNode);
  };
  getNode(identifier) {
    return this.nodeList.find(node=> node.identifier==identifier);
  };

  addEdge(initialNodeIdentifier, finalNodeIdentifier) {
    const nodeI = getNode(initialNodeIdentifier);
    const nodeF = getNode(finalNodeIdentifier);
    nodeI.addInput(nodeF);
  };
  removeEdge(initialNodeIdentifier,finalNodeIdentifier) {
    const nodeI = getNode(initialNodeIdentifier);
    const nodeF = getNode(finalNodeIdentifier);
    const inputIndex = nodeI.getInputIndex(nodeF.identifier);
    if(inputIndex > -1 && inputIndex < nodeI.inputs.length) {
      nodeI.deleteInput(inputIndex)
    }
  };

  static save(objectGraoh) {
    return JSON.parse(JSON.stringify(objectGraoh))
  };
  static load(objectJSON) {
    const graph = new Graph();
    objectJSON.nodeList.forEach((nodeObject, i) => {
      const isSubGraph = nodeObject.container.nodeList ? true : false;
      var node = {};
      if (isSubGraph) {
        // nodes with Graph as container
        node = Node.load(nodeObject, Graph.load, graph);
        graph.push(node);
      } else {
        // nodes with Process as container
        node = Node.load(nodeObject, Process.load, graph);
        graph.push(node);
      }
    });
    return graph;
  };
}
