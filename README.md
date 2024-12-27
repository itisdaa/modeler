# Systems' Modeler: Engine

The **Systems' Modeler: Engine** is an open-source library designed for procedural event-driven architectures. It lays the groundwork for building systems with modular processes, nodes, and graphs.

### 🌟 Features

- **Processes**: Isolated compute functions that transform input and state into output and updated state.
- **Nodes**: Modular containers for computation, subscription, and publication.
- **Graphs**: Scalable structures for orchestrating complex workflows.

### 🚀 Getting Started

```javascript
const { Graph, Node, Process } = require('./path/to/engine.js');

// Create a process
const myProcess = new Process();
myProcess.codeBody = `
  output.result = input.a + input.b;
`;

// Create a node
const myNode = new Node(myProcess);

// Create a graph
const myGraph = new Graph();
myGraph.addNode(myNode);

// Compute
const input = { a: 2, b: 3 };
const result = myGraph.compute(input);
console.log(result); // { result: 5 }
```

---

#### **Roadmap**

**31 Dec 2024**: Release of Systems' Modeler Engine (MVP).

**2025**:  
1️⃣ **Python Library**: Expanding support to Python developers.  
2️⃣ **Pre-built Modules**: Simplified development with reusable components.  
3️⃣ **Systems' Modeler UI**: A drag-and-drop interface for rapid prototyping.
