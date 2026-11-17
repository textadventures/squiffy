# @textadventures/graph-map

A map of a directed graph, as a Svelte 5 component, with a live force-directed layout. Built for the Squiffy editor's story map (#380), and meant for Quest Viva's map of rooms too.

It has **no Squiffy imports**, so it can become a standalone package later, as `project-fs` can (#215). For now it's a private workspace, versioned with the rest of the repo.

```bash
npm run build   # the TypeScript core, into dist/
npm test
npm run check   # svelte-check, including the component
```

## What's in it

- **`GraphMap.svelte`** (`@textadventures/graph-map/GraphMap.svelte`, shipped as source for the app's Svelte build): draws the graph as SVG. Pan (drag the background, or scroll), zoom (pinch, Ctrl/Cmd+scroll, + and -), fit (0), drag a node (which pins it where it's dropped), drag-to-link from the selected node's handle, double-click to create, and keyboard access: the arrow keys move between nodes, Enter opens one, F2 renames it, and a live region reads out each node's `description`. Its colours are CSS variables (`--gm-node-fill` and friends) that follow the page's `color-scheme`, and the host styles nodes and edges through their `class`, or draws nodes itself with the `node` snippet.
- **`MapModel`**: the live state apart from drawing, so it can be tested without a DOM. It keeps the map stable as the graph changes: nodes the host has pinned never move (unless dragged); when nodes are added, the ones already there are held still, apart from the new nodes' neighbours, until it settles; dragging a node lets everything else move, so its neighbours follow and the map "boings" back into shape. `rename()` keeps a node's place when its id changes.
- **`Simulation`** and the **forces** (`manyBody`, `springs`, `towards`, `collide`): in the style of d3-force. Repulsion uses a Barnes–Hut quadtree, so it's O(n log n), and collision a grid. Everything is seeded, so the same graph gives the same map on every machine.
- **Layouts** are pluggable (`Layout`: where new nodes start, and the forces). **`layeredLayout()`** is a directed force layout: each node is pulled towards a row given by its rank (in Squiffy, the longest way to it from the start, leaving out links back round loops), first placed in rows ordered by the barycentre of their parents to cut down crossings; "satellite" nodes (Squiffy's passages) are held under their parent, three to a line, and each row is as tall as what hangs under it; boxes in rows push each other apart sideways rather than out of their row; and groups (Squiffy's unreachable sections) start side by side. A Quest Viva room map would want a layout that keeps exits in their compass directions instead.
- **Geometry and viewport** helpers: edges clipped to boxes, curved apart when there's more than one between two nodes, arrowheads, fitting and revealing.

## Performance

Positions are written to the DOM directly on each frame (CSS transforms for nodes, `d` for edges), not through Svelte's template, which would revisit every node and edge each frame. Measured on stories from textadventures.co.uk, a simulation tick takes about 0.5 ms at 300 nodes (bigger than 99% of stories), 1.3 ms at 700, 3.6 ms at 1,500 and 8 ms at 3,000, so it runs on the main thread. The first layout runs as many ticks as fit in 12 ms a frame. The editor asks before drawing a story of more than 3,000 sections and passages: only a handful of generated stories are that big. If that's ever needed, the simulation could move to a worker, or the rendering to canvas.
