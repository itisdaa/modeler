classdef Process < handle
    % Process class for computational operations
    
    properties
        func
        initialKeys
    end
    
    methods
        function obj = Process(func)
            if nargin < 1
                func = @(input, state) struct('output', input, 'state', state);
            end
            obj.func = func;
            obj.initialKeys = fieldnames(obj);
        end
        
        function type = getType(obj)
            type = 'process';
        end
        
        function result = compute(obj, input, state)
            if nargin < 2, input = struct(); end
            if nargin < 3, state = struct(); end
            
            try
                result = obj.func(input, state);
                if ~isfield(result, 'output')
                    result.output = struct();
                end
                if ~isfield(result, 'state')
                    result.state = state;
                end
            catch ME
                result = struct('output', struct(), 'state', state);
                warning('Process computation failed: %s', ME.message);
            end
        end
        
        function obj = update(obj, newFunc)
            obj.func = newFunc;
        end
        
        function data = toJSON(obj)
            data = struct();
            data.functionString = func2str(obj.func);
            data.type = 'process';
        end
        
        function obj = fromJSON(obj, data)
            try
                obj.func = str2func(data.functionString);
            catch
                obj.func = @(input, state) struct('output', input, 'state', state);
            end
        end
        
        function obj = remove(obj)
            obj.func = [];
        end
    end
end

classdef Observable < handle
    % Observable class for reactive data
    
    properties
        listeners
        value
    end
    
    methods
        function obj = Observable(initialValue)
            if nargin < 1, initialValue = struct(); end
            obj.listeners = containers.Map();
            obj.value = initialValue;
        end
        
        function obj = addListener(obj, listener, path, listenerType)
            if nargin < 3, path = '/'; end
            if nargin < 4, listenerType = 'default'; end
            
            path = obj.normalizePath(path);
            
            if ~obj.listeners.isKey(path)
                obj.listeners(path) = containers.Map();
            end
            pathMap = obj.listeners(path);
            
            if ~pathMap.isKey(listenerType)
                pathMap(listenerType) = {};
            end
            
            listeners = pathMap(listenerType);
            listeners{end+1} = listener;
            pathMap(listenerType) = listeners;
        end
        
        function obj = removeListener(obj, listener, path, listenerType)
            if nargin < 3, path = '/'; end
            if nargin < 4, listenerType = 'default'; end
            
            path = obj.normalizePath(path);
            
            if obj.listeners.isKey(path)
                pathMap = obj.listeners(path);
                if pathMap.isKey(listenerType)
                    listeners = pathMap(listenerType);
                    % Remove the listener (simplified)
                    pathMap(listenerType) = {};
                end
            end
        end
        
        function val = getValue(obj, path)
            if nargin < 2, path = '/'; end
            val = obj.getDataByPath(obj.normalizePath(path), obj.value);
        end
        
        function obj = setValue(obj, newValue, path, listenerTypes)
            if nargin < 3, path = '/'; end
            if nargin < 4, listenerTypes = {'default'}; end
            
            path = obj.normalizePath(path);
            oldValue = obj.value;
            
            obj.setDataByPath(path, obj.value, newValue);
            
            % Notify listeners (simplified)
            obj.notifyListeners(path, listenerTypes, oldValue);
        end
        
        function path = normalizePath(~, path)
            parts = strsplit(path, '/');
            parts = parts(~cellfun(@isempty, parts));
            path = strjoin(parts, '/');
        end
        
        function data = getDataByPath(~, path, item)
            if isempty(path)
                data = item;
                return;
            end
            
            parts = strsplit(path, '/');
            data = item;
            for i = 1:length(parts)
                if isstruct(data) && isfield(data, parts{i})
                    data = data.(parts{i});
                else
                    data = [];
                    break;
                end
            end
        end
        
        function obj = setDataByPath(~, path, obj_ref, value)
            if isempty(path)
                obj_ref = value;
                return;
            end
            
            parts = strsplit(path, '/');
            ref = obj_ref;
            
            for i = 1:length(parts)-1
                if ~isfield(ref, parts{i})
                    ref.(parts{i}) = struct();
                end
                ref = ref.(parts{i});
            end
            
            if ~isempty(parts)
                ref.(parts{end}) = value;
            end
        end
        
        function notifyListeners(obj, path, listenerTypes, oldValue)
            % Simplified listener notification
            if obj.listeners.isKey(path)
                pathMap = obj.listeners(path);
                for i = 1:length(listenerTypes)
                    if pathMap.isKey(listenerTypes{i})
                        listeners = pathMap(listenerTypes{i});
                        for j = 1:length(listeners)
                            try
                                listeners{j}(obj.getValue(path), oldValue, path);
                            catch
                                % Ignore listener errors
                            end
                        end
                    end
                end
            end
        end
    end
end

classdef Node < handle
    % Node class for graph nodes
    
    properties
        id
        process
        output
        state
        inputs
        initialKeys
    end
    
    methods
        function obj = Node(process, item)
            if nargin < 1
                process = Process();
            end
            if nargin < 2
                item = struct();
            end
            
            obj.initialKeys = fieldnames(obj);
            obj.id = obj.generateId();
            obj.process = process;
            obj.output = Observable(struct());
            obj.state = struct();
            obj.inputs = {};
        end
        
        function obj = connect(obj, node)
            input = struct();
            input.refID = node.id;
            input.data = node.output.getValue();
            input.onUpdate = @(data) obj.handleInputUpdate(data);
            input.removeListener = @() node.output.removeListener(input.onUpdate);
            
            node.output.addListener(input.onUpdate);
            obj.inputs{end+1} = input;
        end
        
        function obj = disconnect(obj, node)
            for i = length(obj.inputs):-1:1
                if strcmp(obj.inputs{i}.refID, node.id)
                    obj.inputs{i}.removeListener();
                    obj.inputs(i) = [];
                    break;
                end
            end
        end
        
        function type = getType(obj)
            hasInputs = length(obj.inputs) > 0;
            hasOutputs = ~isempty(obj.output.getValue());
            
            if ~hasInputs && ~hasOutputs
                type = 2; % isolated
            elseif hasInputs && ~hasOutputs
                type = 1; % sink
            elseif ~hasInputs && hasOutputs
                type = 0; % source
            else
                type = -1; % intermediate
            end
        end
        
        function output = compute(obj, rootInput, rootState)
            if nargin < 2, rootInput = struct(); end
            if nargin < 3, rootState = struct(); end
            
            % Accumulate input data
            input = struct('root', rootInput);
            for i = 1:length(obj.inputs)
                if isfield(obj.inputs{i}, 'data')
                    fields = fieldnames(obj.inputs{i}.data);
                    for j = 1:length(fields)
                        input.(fields{j}) = obj.inputs{i}.data.(fields{j});
                    end
                end
            end
            
            % Compute
            state = obj.state;
            state.root = rootState;
            result = obj.process.compute(input, state);
            
            output = result.output;
            if ~isempty(fieldnames(output))
                obj.output.setValue(output);
            end
            if isfield(result, 'state')
                obj.state = result.state;
            end
        end
        
        function obj = update(obj, process)
            obj.process = process;
        end
        
        function data = toJSON(obj)
            data = struct();
            data.id = obj.id;
            data.process = obj.process.toJSON();
        end
        
        function obj = fromJSON(obj, data)
            obj.id = data.id;
            obj.process = Process();
            obj.process.fromJSON(data.process);
        end
        
        function obj = remove(obj)
            obj.process = [];
            obj.output = [];
            obj.inputs = {};
        end
        
        function handleInputUpdate(obj, data)
            % Find and update the input data
            for i = 1:length(obj.inputs)
                if isa(obj.inputs{i}.onUpdate, 'function_handle')
                    obj.inputs{i}.data = data;
                end
            end
            obj.compute();
        end
        
        function id = generateId(~)
            id = sprintf('%x%x', round(now*1000), randi(1000000));
        end
    end
end

classdef Graph < handle
    % Graph class for computational graphs
    
    properties
        nodes
        edges
        initialKeys
    end
    
    methods
        function obj = Graph(item)
            if nargin < 1, item = struct(); end
            obj.initialKeys = fieldnames(obj);
            obj.nodes = containers.Map();
            obj.edges = {};
        end
        
        function type = getType(~)
            type = 'graph';
        end
        
        function obj = addNode(obj, node)
            obj.nodes(node.id) = node;
        end
        
        function obj = removeNode(obj, node)
            % Remove all input listeners
            for i = 1:length(node.inputs)
                if isfield(node.inputs{i}, 'removeListener')
                    node.inputs{i}.removeListener();
                end
            end
            obj.nodes.remove(node.id);
        end
        
        function obj = addEdge(obj, outputNode, inputNode)
            inputNode.connect(outputNode);
            edge = {outputNode.id, inputNode.id};
            obj.edges{end+1} = edge;
        end
        
        function obj = removeEdge(obj, outputNode, inputNode)
            inputNode.disconnect(outputNode);
            % Remove edge from list
            for i = length(obj.edges):-1:1
                if strcmp(obj.edges{i}{1}, outputNode.id) && ...
                   strcmp(obj.edges{i}{2}, inputNode.id)
                    obj.edges(i) = [];
                    break;
                end
            end
        end
        
        function result = compute(obj, rootInput, rootState)
            if nargin < 2, rootInput = struct(); end
            if nargin < 3, rootState = struct(); end
            
            % Get sink nodes
            sinkNodes = {};
            nodeIds = keys(obj.nodes);
            for i = 1:length(nodeIds)
                node = obj.nodes(nodeIds{i});
                nodeType = node.getType();
                if nodeType == 1 || nodeType == 2
                    sinkNodes{end+1} = node;
                end
            end
            
            % Compute output
            output = struct();
            for i = 1:length(sinkNodes)
                obj.traverse(sinkNodes{i}, @(currentNode) ...
                    obj.mergeStructs(output, currentNode.compute(rootInput, rootState)));
            end
            
            result = struct('output', output, 'state', rootState);
        end
        
        function obj = traverse(obj, startSinkNode, callback, onlyToSource)
            if nargin < 4, onlyToSource = true; end
            
            if length(startSinkNode.inputs) > 0
                for i = 1:length(startSinkNode.inputs)
                    if obj.nodes.isKey(startSinkNode.inputs{i}.refID)
                        node = obj.nodes(startSinkNode.inputs{i}.refID);
                        obj.traverse(node, callback, onlyToSource);
                    end
                    if onlyToSource, continue; end
                end
            end
            
            callback(startSinkNode);
        end
        
        function results = querySelectorAll(obj, query)
            nodeIds = keys(obj.nodes);
            results = {};
            
            for i = 1:length(nodeIds)
                results{end+1} = obj.nodes(nodeIds{i});
            end
            
            % Simple query parsing (simplified)
            if contains(query, '#')
                % ID match
                id = extractAfter(query, '#');
                results = {};
                if obj.nodes.isKey(id)
                    results{1} = obj.nodes(id);
                end
            elseif strcmp(query, '*')
                % All nodes already in results
            end
        end
        
        function result = querySelector(obj, query)
            results = obj.querySelectorAll(query);
            if ~isempty(results)
                result = results{1};
            else
                result = [];
            end
        end
        
        function data = toJSON(obj)
            data = struct();
            data.nodes = struct();
            data.edges = obj.edges;
            
            nodeIds = keys(obj.nodes);
            for i = 1:length(nodeIds)
                data.nodes.(nodeIds{i}) = obj.nodes(nodeIds{i}).toJSON();
            end
        end
        
        function obj = fromJSON(obj, data)
            obj = Graph();
            
            nodeIds = fieldnames(data.nodes);
            for i = 1:length(nodeIds)
                node = Node();
                node.fromJSON(data.nodes.(nodeIds{i}));
                obj.addNode(node);
            end
            
            for i = 1:length(data.edges)
                outputNode = obj.nodes(data.edges{i}{1});
                inputNode = obj.nodes(data.edges{i}{2});
                obj.addEdge(outputNode, inputNode);
            end
        end
        
        function obj = remove(obj)
            obj.nodes = containers.Map();
            obj.edges = {};
        end
        
        function result = mergeStructs(~, struct1, struct2)
            result = struct1;
            fields = fieldnames(struct2);
            for i = 1:length(fields)
                result.(fields{i}) = struct2.(fields{i});
            end
        end
    end
end

classdef Library < handle
    % Library class for managing processes and graphs
    
    properties
        list
        initialKeys
    end
    
    methods
        function obj = Library(item)
            if nargin < 1, item = struct(); end
            obj.initialKeys = fieldnames(obj);
            obj.list = containers.Map();
        end
        
        function obj = addArticle(obj, content, name, description, id)
            if nargin < 3, name = obj.generateName(); end
            if nargin < 4, description = ''; end
            if nargin < 5, id = obj.generateId(); end
            
            article = struct();
            article.id = id;
            article.name = name;
            article.description = description;
            article.content = content;
            
            obj.list(article.id) = article;
        end
        
        function obj = removeArticle(obj, article)
            if obj.list.isKey(article.id)
                obj.list.remove(article.id);
            end
        end
        
        function results = querySelectorAll(obj, query)
            articleIds = keys(obj.list);
            results = {};
            
            for i = 1:length(articleIds)
                results{end+1} = obj.list(articleIds{i});
            end
            
            % Simple query parsing (simplified)
            if contains(query, '#')
                % ID match
                id = extractAfter(query, '#');
                results = {};
                if obj.list.isKey(id)
                    results{1} = obj.list(id);
                end
            elseif strcmp(query, '*')
                % All articles already in results
            end
        end
        
        function result = querySelector(obj, query)
            results = obj.querySelectorAll(query);
            if ~isempty(results)
                result = results{1};
            else
                result = [];
            end
        end
        
        function graph = addGraphFromEdges(obj, edges, name, description)
            if nargin < 3, name = ['graph' obj.generateName()]; end
            if nargin < 4, description = ''; end
            
            graph = Graph();
            
            % Get unique node IDs
            allIds = unique([edges{:}]);
            
            % Add nodes to graph
            for i = 1:length(allIds)
                article = obj.querySelector(['#' allIds{i}]);
                if ~isempty(article)
                    graph.addNode(article.content);
                end
            end
            
            % Add edges
            for i = 1:length(edges)
                outputArticle = obj.querySelector(['#' edges{i}{1}]);
                inputArticle = obj.querySelector(['#' edges{i}{2}]);
                if ~isempty(outputArticle) && ~isempty(inputArticle)
                    graph.addEdge(outputArticle.content, inputArticle.content);
                end
            end
            
            obj.addArticle(graph, name, description);
        end
        
        function process = addProcessFromFunction(obj, func, name, description)
            if nargin < 3, name = ['process' obj.generateName()]; end
            if nargin < 4, description = ''; end
            
            process = Process(func);
            obj.addArticle(process, name, description);
        end
        
        function data = toJSON(obj)
            data = struct();
            articleIds = keys(obj.list);
            
            for i = 1:length(articleIds)
                article = obj.list(articleIds{i});
                article.content = article.content.toJSON();
                data.(articleIds{i}) = article;
            end
        end
        
        function obj = fromJSON(obj, data)
            obj = Library();
            
            articleIds = fieldnames(data);
            for i = 1:length(articleIds)
                article = data.(articleIds{i});
                if strcmp(article.content.type, 'process')
                    content = Process();
                    content.fromJSON(article.content);
                else
                    content = Graph();
                    content.fromJSON(article.content);
                end
                article.content = content;
                obj.addArticle(article.content, article.name, article.description, article.id);
            end
        end
        
        function obj = remove(obj)
            obj.list = containers.Map();
        end
        
        function name = generateName(~)
            syllables = {'ka', 'lu', 've', 'zo', 'mi', 'ra', 'te', 'xi', 'do', 'sa'};
            name = '';
            for i = 1:3
                name = [name syllables{randi(length(syllables))}];
            end
            name(1) = upper(name(1));
        end
        
        function id = generateId(~)
            id = sprintf('%x%x', round(now*1000), randi(1000000));
        end
    end
end

% Factory function for creating library from function list
function library = LibraryFromFunctionList(functionsList)
    library = Library();
    for i = 1:length(functionsList)
        library.addProcessFromFunction(functionsList{i});
    end
end

% Helper function for creating process from text (simplified)
function process = ProcessFromText(code)
    % This is a simplified version - MATLAB doesn't have eval() equivalent
    % for dynamic function creation like JavaScript
    warning('ProcessFromText is simplified in MATLAB - dynamic code execution limited');
    
    func = @(input, state) struct('output', struct(), 'state', state);
    process = Process(func);
end
