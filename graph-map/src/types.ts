// The graph the map shows. The host decides what nodes and edges mean; the map only needs their
// ids, sizes and how to draw them.

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface MapNode {
    // Unique, and stable across updates, so a node keeps its place
    id: string;
    // The size of its box, centred on its position
    width: number;
    height: number;
    // Shown in the default drawing
    label: string;
    // Classes for the node's <g>, for the host's styles
    class?: string;
    // Read out by screen readers when the node is selected, e.g. its links in and out
    description?: string;
    // Leave out of keyboard navigation and search, e.g. a marker for a missing node
    decoration?: boolean;
}

export interface MapEdge {
    id: string;
    from: string;
    to: string;
    // Classes for the edge's path, for the host's styles
    class?: string;
    // Shown as a tooltip
    title?: string;
}

export interface MapGraph<N extends MapNode = MapNode, E extends MapEdge = MapEdge> {
    nodes: N[];
    edges: E[];
}
