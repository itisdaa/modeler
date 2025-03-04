# Systems' Modeler: Engine

The **Systems' Modeler: Engine** is an open-source library designed for procedural event-driven architectures. It lays the groundwork for building systems with modular processes, nodes, and graphs.

### 🌟 Features

- Process-based computation with flexible state handling.
- Node-based data flow for reactive processing.
- Observable pattern for managing state changes and listeners.
- JSON serialization & deserialization for process persistence.
- Dynamic function execution using `Function` constructors.

### 🚀 Getting Started

```javascript
importScript('./path/to/engine.js');

// Create a process
const process = Process((input, state) => {
    return { output: { result: input.value * 2 }, state };
});

// Create a node
const node = Node(process);
node.compute({ value: 5 }); // Output: { result: 10 }

// Create a graph
const graph = Graph();
graph.addNode(node);

// Compute
const input = { a: 2, b: 3 };
const result = myGraph.compute(input);
console.log(result); // { result: 5 }
```

---

#### **Roadmap**

**31 Dec 2024**: Release of Systems' Modeler Engine (MVP).

**2025**:  
1️⃣ **Pre-built Modules**: Simplified development with reusable components.  
2️⃣ **Systems' Modeler UI**: A drag-and-drop interface for rapid prototyping.
