
/* --- PROCESS --- */

function Process(func = (input, state) => { return { output: input, state } }) {
    const initialKeys = Object.keys(func);

    func.getType = () => 'process';

    // returns {output, state}
    func.compute = (input = {}, state = {}) => {
        const result = func(input, state);

        return {
            output: result.output || {},
            state: result.state || state
        };
    };

    // update the function
    func.update = (newFunc) => {
        return func = Process(newFunc);
    };


    // toJSON process to JSON
    func.toJSON = () => {
        return funcToFJSON(func);
    }

    // fromJSON process from JSON
    func.fromJSON = (data) => {
        return Process(funcFromFJSON(data));
    }

    const finalKeys = Object.keys(func);
    func.remove = () => {
        finalKeys.push("remove");
        finalKeys
            .filter((key) => !initialKeys.includes(key))
            .forEach((key) => (func[key] = null));
        return func;
    };

    return func;
}

function funcToFJSON(func) {
    // Validate input
    if (typeof func !== "function") {
        throw new TypeError("Input must be a function");
    }

    // Convert function to string representation
    const funcString = func.toString().trim();

    // Extract function name
    const functionName = func.name || "anonymous";

    // Extract arguments
    let functionArgs = [];
    const argsRegex = /\(([^)]*)\)/;
    const argsMatch = funcString.match(argsRegex);
    if (argsMatch) {
        // Split and trim arguments, handling default values and destructuring
        functionArgs = argsMatch[1]
            .split(",")
            .map((arg) => arg.trim())
            .filter(Boolean);
    }

    // Extract function body
    let functionBody = null;
    if (funcString.includes("=>")) {
        // Arrow function body
        const arrowBodyMatch = funcString.match(/=>\s*(.+)$/);
        if (arrowBodyMatch) {
            functionBody = arrowBodyMatch[1].trim();
            if (!functionBody.startsWith("{")) {
                // Single-expression arrow function
                functionBody = `return ${functionBody};`;
            }
        }
    } else {
        // Regular function body
        const bodyRegex = /{([\s\S]*)}/;
        const bodyMatch = funcString.match(bodyRegex);
        if (bodyMatch) {
            functionBody = bodyMatch[1].trim();
        }
    }

    // Analyze arguments for advanced cases
    const parsedArgs = functionArgs.map((arg) => {
        const [name, defaultValue] = arg.split("=").map((part) => part.trim());
        const isRest = name.startsWith("...");
        return {
            name: isRest ? name.slice(3) : name,
            isRest,
            defaultValue: defaultValue || null,
            isDestructured: name.includes("{") || name.includes("["),
        };
    });

    // Return parsed details
    return {
        functionName,
        functionArgs: parsedArgs,
        functionBody,
        isArrowFunction: funcString.includes("=>"),
        isAsync: funcString.startsWith("async"),
        isGenerator: funcString.startsWith("function*"),
    };
}

function funcFromFJSON(fjson) {
    const argNames = fjson.functionArgs.map((arg) => arg.name);
    const func = new Function(...argNames, fjson.functionBody);

    // Wrap in async if needed
    return fjson.isAsync ? async (...args) => func(...args) : func;
}

function ProcessFromText(code) {
    const process = Process(new Function("input", "state", `
        let output = {};
        const state = state || {};

        try {
            // Helper functions
            const log = console.log;
            const debug = (...args) => log('DEBUG:', ...args);

            // Developer code
            ${code}

            return { output, state };
        } catch (error) {
            console.error('Error in process execution:', error);
            throw error;
        }
    `));

    process.update = (code) => {
        return process = ProcessFromText(code);
    }

    return process;
}


/* --- NODE --- */

function Node(process, item = {}) {
    const initialKeys = Object.keys(item);

    item.id = item.id || Date.now().toString(36) + Math.random().toString(36).substring(2);

    item.process = process;

    item.output = Observable({});
    item.state = {};
    item.inputs = [];

    // connect
    item.connect = (node) => {
        const input = {
            refID: node.id,
            data: node.output.getValue(),
            onUpdate: (data) => {
                input.data = data;
                item.compute(); // auto - compute
            },
            removeListener: () => node.output.removeListener(input.onUpdate),
        };

        node.output.addListener(input.onUpdate);
        item.inputs.push(input);

        return item;
    };

    // disconnect
    item.disconnect = (node) => {
        const input = item.inputs.find((i) => i.refID === node.id);

        if (input) {
            input.removeListener();
            item.inputs = item.inputs.filter((i) => i !== input);
        }

        return item;
    };

    // type
    item.getType = () => {
        const hasInputs = item.inputs.length > 0;
        const hasOutputs = item.output.default?.length > 0;
        if (!hasInputs && !hasOutputs) return 2; // isolated
        if (hasInputs && !hasOutputs) return 1; // sink
        if (!hasInputs && hasOutputs) return 0; // source
        return -1;
    };

    // compute
    item.compute = (rootInput = {}, rootState = {}) => {
        // accumulating input data
        const input = item.inputs.reduce(
            (acc, i) => ({ ...acc, ...(i.data || {}) }),
            { root: rootInput }
        );

        // computing
        const { output, state } = item.process.compute(
            input,
            { ...item.state, root: rootState }
        );
        if (output && Object.keys(output).length > 0) {
            item.output.setValue(output);
        }
        if (state) item.state = state;

        return output;
    }

    // update
    item.update = (process) => {
        item.process = process;
        return item;
    }

    // toJSON
    item.toJSON = () => {
        // preserve id, and process
        return {
            id: item.id,
            process: item.process.toJSON(),
        };
    };

    // fromJSON
    item.fromJSON = (data) => {
        item.id = data.id;
        return Node(Process().fromJSON(data.process));
    };

    const finalKeys = Object.keys(item);
    item.remove = () => {
        finalKeys.push("remove");
        finalKeys
            .filter((key) => !initialKeys.includes(key))
            .forEach((key) => (item[key] = null));
        return item;
    };

    return item;
}

function Observable(item = {}) {
    // Initialize value and listeners
    item.listeners = {};
    item.value = {};

    // Helper function to normalize paths
    const normalizePath = (path) => path.split("/").filter(Boolean).join("/");

    // Add a listener for a specific type
    item.addListener = (listener, path = "/", listenerType = "default") => {

        if (typeof listener !== "function") {
            throw new Error("Listener must be a function");
        }

        path = normalizePath(path);

        item.listeners[path] ??= {};
        item.listeners[path][listenerType] ??= [];

        item.listeners[path][listenerType].push(listener);
        return item;
    };

    // Remove a listener for a specific type
    item.removeListener = (listener, path = "/", listenerType = "default") => {
        path = normalizePath(path);

        const listeners = item.listeners?.[path]?.[listenerType];
        if (listeners) {
            item.listeners[path][listenerType] = listeners.filter(l => l !== listener);
            if (!item.listeners[path][listenerType].length) delete item.listeners[path][listenerType];
            if (!Object.keys(item.listeners[path]).length) delete item.listeners[path];
        }

        return item;
    };

    // Get the current value
    item.getValue = (path = "/") => getDataByPath(normalizePath(path), item.value);

    // Set a new value and notify relevant listeners
    item.setValue = (newValue, path = "/", listenerTypes = ["default"]) => {
        path = normalizePath(path);
        const oldValue = Object.create(item.value);

        // Normalize `listenerTypes` to an array
        const typesToNotify = Array.isArray(listenerTypes)
            ? listenerTypes
            : [listenerTypes];

        path.split('/').reverse().forEach((key, index, array) => {

            const dataPath = array.slice(index, array.length).reverse().join('/');

            if (index == 0) {
                setDataByPath(dataPath, item.value, newValue);
            }

            // notify
            const initialData = getDataByPath(dataPath, oldValue);
            const finalData = getDataByPath(dataPath, item.value);
            typesToNotify.forEach((listenerType) => {
                item.listeners?.[dataPath]?.[listenerType]?.forEach(callback => {
                    callback(finalData, initialData, path);
                });
            });

        })

        return item;
    };

    return item;
}

function getDataByPath(path = "/", item = {}) {
    return path.split("/").filter(Boolean).reduce((acc, key) => acc?.[key], item);
}

function setDataByPath(path = "/", obj = {}, value) {
    const keys = path.split("/").filter(Boolean);
    let ref = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        ref = ref[keys[i]] ??= {};
    }
    keys.length ? ref[keys.at(-1)] = value : Object.assign(obj, value);

    return obj;
}


/* --- GRAPH --- */

function Graph(item = {}) {
    const initialKeys = Object.keys(item);

    item.getType = () => 'graph';
    item.nodes ??= {}; // nodes are unique
    item.edges ??= []; // edges are observable

    // add a node to the graph
    // add process, and wrap it to the node
    // process would be from library
    item.addNode = (node) => {
        item.nodes[node.id] = node;
        return item;
    };

    // remove a node from the graph
    item.removeNode = (node) => {
        node.inputs.forEach((input) => input.removeListener());
        delete item.nodes[node.id];
        return item;
    };

    // select edge based id, name, from the library
    item.addEdge = (outputNode, inputNode) => {

        inputNode.connect(outputNode);

        const edge = [outputNode.id, inputNode.id];

        edge.disconnect = () => {
            inputNode.disconnect(outputNode);
            item.edges = item.edges.filter(array => array != edge);
        };

        item.edges.push(edge);

        return item;
    }

    item.removeEdge = (outputNode, inputNode) => {
        const edgeIndex = item.edges.findIndex(
            (edge) => edge[0] === outputNode.id && edge[1] === inputNode.id
        );


        item.edges[edgeIndex].disconnect();
    };

    // compute
    item.compute = (rootInput = {}, rootState = {}) => {
        // get sink nodes
        const sinkNodes = [];
        for (const nodeID in item.nodes) {
            let node = item.nodes[nodeID];
            let nodeType = node.getType();
            if (nodeType == 1 || nodeType == 2) {
                sinkNodes.push(node);
                // computation is in seperate loop to avoid nested loops due traversing
            }
        };

        // compute output
        const output = {};
        sinkNodes.forEach((sinkNode) => {
            item.traverse(sinkNode, (currentNode) => {
                Object.assign(output, currentNode.compute(rootInput, rootState));
            });
        });

        return {
            output,
            state: rootState
        };

    };

    // traverse
    item.traverse = (startSinkNode, callback, onlyToSource = true) => {
        if (startSinkNode.inputs.length > 0) {

            startSinkNode.inputs.forEach(input => {
                // get input node
                const node = item.nodes[input.refID];
                item.traverse(node, callback);

                if (onlyToSource) return;
            })

        }

        callback(startSinkNode);

        return item;
    }

    // select
    item.querySelectorAll = (query) => {
        const results = Object.values(item.nodes);

        // Split query by space or other delimiters for concatenated queries
        const conditions = query.split(/\s+/).filter(Boolean);

        return conditions.reduce((filteredResults, condition) => {
            // Process each condition on the filtered results
            return filteredResults.filter((node) => {
                let match = true;

                // ID match (#id)
                const idMatch = condition.match(/#(\w+)/);
                if (idMatch && node.id !== idMatch[1]) {
                    match = false;
                }

                // Type match ($type)
                const typeMatch = condition.match(/\$(\w+)/);
                if (typeMatch && node.getType() != typeMatch[1]) {
                    // Loose equality for type
                    match = false;
                }

                // Property match ([key=value])
                const propertyMatch = condition.match(/\[(\w+)=([\w\s]+)\]/);
                if (propertyMatch) {
                    const [_, key, value] = propertyMatch;
                    if (node[key] != value) {
                        // Loose equality for comparison
                        match = false;
                    }
                }

                // Connection match (->id)
                const connectionMatch = condition.match(/->(\w+)/);
                if (connectionMatch) {
                    const targetId = connectionMatch[1];
                    const connected = item.edges.some(
                        (edge) => edge[0] === node.id && edge[1] === targetId
                    );
                    if (!connected) {
                        match = false;
                    }
                }

                // Match all (*)
                const allMatch = condition === "*";
                if (allMatch) {
                    match = true;
                }

                return match;
            });
        }, results); // Start with all nodes
    };


    item.querySelector = (query) => {
        const results = item.querySelectorAll(query);
        return results.length > 0 ? results[0] : null;
    }

    // toJSON
    item.toJSON = () => {

        const toJSONd = {
            nodes: {},
            edges: []
        }

        for (const node of Object.values(item.nodes)) {
            toJSONd.nodes[node.id] = node.toJSON();
        }


        for (const edge of item.edges) {
            toJSONd.edges.push(edge);
        }

        return toJSONd;
    }

    // fromJSON
    item.fromJSON = (data) => {
        const graph = Graph();

        for (const nodeID in data.nodes) {
            graph.addNode(Node().fromJSON(data.nodes[nodeID]));
        }

        for (const edge of data.edges) {
            graph.addEdge(graph.nodes[edge[0]], graph.nodes[edge[1]]);
        }

        return graph;
    }

    // remove
    const finalKeys = Object.keys(item);
    item.remove = () => {
        finalKeys.push("remove");
        finalKeys
            .filter((key) => !initialKeys.includes(key))
            .forEach((key) => (item[key] = null));
        return item;
    };

    return item;
}


/* --- Library --- */

function Library(item = {}) {
    const initialKeys = Object.keys(item);

    // an object for unique object
    item.list ??= {};

    item.addArticle = ({ content, name, description = '', id }) => {
        const article = {
            id: id || Date.now().toString(36) + Math.random().toString(36).substring(2),
            name: name || generateName().toLocaleLowerCase() + generateName(),
            description,
            content
        };

        article.update = (newArticle) => {
            article.content = newArticle.content || article.content;
            article.name = newArticle.name || article.name;
            article.description = newArticle.description || article.description;
            return article;
        };

        article.remove = () => {
            delete item.list[article.id];
            return item;
        };

        item.list[article.id] = article;
        return item;
    };

    item.removeArticle = (article) => {
        delete item.list[article.id];
        return item;
    };

    item.querySelectorAll = (query) => {
        const results = Object.values(item.list);

        // Split query by space or other delimiters for concatenated queries
        const conditions = query.split(/\s+/).filter(Boolean);

        return conditions.reduce((filteredResults, condition) => {
            // Process each condition on the filtered results
            return filteredResults.filter((article) => {
                let match = true;

                // ID match (#id)
                const idMatch = condition.match(/#(\w+)/);
                if (idMatch && article.id !== idMatch[1]) {
                    match = false;
                }

                // Type match ($type)
                const typeMatch = condition.match(/\$(\w+)/);
                if (typeMatch && article.getType() != typeMatch[1]) {
                    // Loose equality for type
                    match = false;
                }

                // Property match ([key=value])
                const propertyMatch = condition.match(/\[(\w+)=([\w\s]+)\]/);
                if (propertyMatch) {
                    const [_, key, value] = propertyMatch;
                    if (article[key] != value) {
                        // Loose equality for comparison
                        match = false;
                    }
                }

                // Match all (*)
                const allMatch = condition === "*";
                if (allMatch) {
                    match = true;
                }

                return match;
            });
        }, results);
    }

    item.querySelector = (query) => {
        return item.querySelectorAll(query)[0];
    }



    item.addGraphFromEdges = (edges = [], name = 'graph' + generateName(), description = '') => {
        const graph = Graph();

        [...new Set(edges.flat())]
            .map((query) => item.querySelector(`#${query} [name=${query}]`))
            .forEach((node) => {
                graph.addNode(node);
            });

        edges.forEach((edge) => {
            graph.addEdge(
                item.querySelector(`#${edge[0]} [name=${edge[0]}]`),
                item.querySelector(`#${edge[1]} [name=${edge[1]}]`)
            );
        });

        item.addArticle({
            name: name.includes('graph') ? name : generateName(),
            description: description,
            content: graph
        });

        return graph;
    }

    item.addProcessFromFunction = (func, name = 'process' + generateName(), description = '') => {
        const process = Process(func);
        item.addArticle({
            name: name.includes('process') ? func.name || name : name,
            description: func.description || description,
            content: Process(func)
        });
        return process;
    }



    item.toJSON = () => {
        const toJSONd = {};
        
        for (const article of Object.values(item.list)) {
            toJSONd[article.id] = {
                ...article,
                content: article.content.toJSON()
            };
        }

        return toJSONd;
    }

    item.fromJSON = (data) => {
        const library = Library();

        for (const articleID in data) {

            data[articleID].content.isProcess ?
                data[articleID].content = Process().fromJSON(data[articleID].content) :
                data[articleID].content = Graph().fromJSON(data[articleID].content);

            library.addArticle(data[articleID]);
        }

        return library;
    }

    const finalKeys = Object.keys(func);
    item.remove = () => {
        finalKeys.push("remove");
        finalKeys
            .filter((key) => !initialKeys.includes(key))
            .forEach((key) => (item[key] = null));
        return item;
    };

    return item;
}

function LibraryFromFunctionList(functionsList = []) {

    const library = Library();

    functionsList.forEach(func => library.addProcessFromFunction(func));

    return library;
}

function generateName(
    syllables = ["ka", "lu", "ve", "zo", "mi", "ra", "te", "xi", "do", "sa"],
    length = 3
) {
    let name = "";

    for (let i = 0; i < length; i++) {
        name += syllables[Math.floor(Math.random() * syllables.length)];
    }

    return name.charAt(0).toUpperCase() + name.slice(1); // Capitalize first letter
}
