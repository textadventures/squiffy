<script lang="ts">
    // The story map's right-click menu, at a point in the page, in VS Code's menu colours: the
    // editor's ContextMenu (app/src/components/ContextMenu.svelte), without its Tailwind classes.
    // Closes on Escape, a click elsewhere, or the page losing the focus.
    import { tick } from "svelte";

    export interface MenuItem {
        label: string;
        action: () => void;
        shortcut?: string;
        disabled?: boolean;
        divider?: boolean;
    }

    interface Props {
        x: number;
        y: number;
        items: MenuItem[];
        // Opened from the keyboard (the menu key, or Shift+F10), so the first item gets focus
        keyboard?: boolean;
        onclose: () => void;
    }

    let { x, y, items, keyboard = false, onclose }: Props = $props();

    let menuEl = $state<HTMLDivElement | undefined>();
    let itemEls: (HTMLButtonElement | undefined)[] = $state([]);
    // Moved back into the page once its size is known
    let left = $state(0);
    let top = $state(0);

    $effect(() => {
        if (!menuEl) return;
        const { width, height } = menuEl.getBoundingClientRect();
        left = Math.max(4, Math.min(x, window.innerWidth - width - 4));
        top = y + height + 4 > window.innerHeight ? Math.max(4, y - height) : y;
        if (keyboard) void tick().then(() => moveFocus(-1, 1));
        else menuEl.focus({ preventScroll: true });
    });

    function select(item: MenuItem) {
        if (item.disabled) return;
        onclose();
        item.action();
    }

    // Roving focus between enabled items, wrapping past either end
    function moveFocus(fromIndex: number, delta: number) {
        const n = items.length;
        let i = fromIndex;
        for (let step = 0; step < n; step++) {
            i = (i + delta + n) % n;
            if (!items[i].disabled) {
                itemEls[i]?.focus({ preventScroll: true });
                return;
            }
        }
    }

    function onkeydown(e: KeyboardEvent) {
        const current = itemEls.indexOf(document.activeElement as HTMLButtonElement);
        const moves: Record<string, () => void> = {
            ArrowDown: () => moveFocus(current, 1),
            ArrowUp: () => moveFocus(current === -1 ? 0 : current, -1),
            Home: () => moveFocus(-1, 1),
            End: () => moveFocus(0, -1),
            Escape: onclose,
            Tab: onclose,
        };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        e.stopPropagation();
        move();
    }

    $effect(() => {
        function onOutside(e: Event) {
            if (!menuEl?.contains(e.target as Node)) onclose();
        }
        document.addEventListener("mousedown", onOutside, true);
        window.addEventListener("wheel", onOutside, true);
        window.addEventListener("resize", onclose);
        window.addEventListener("blur", onclose);
        return () => {
            document.removeEventListener("mousedown", onOutside, true);
            window.removeEventListener("wheel", onOutside, true);
            window.removeEventListener("resize", onclose);
            window.removeEventListener("blur", onclose);
        };
    });
</script>

<div
    bind:this={menuEl}
    class="menu"
    role="menu"
    tabindex="-1"
    style="left: {left}px; top: {top}px;"
    {onkeydown}
    oncontextmenu={e => e.preventDefault()}
>
    {#each items as item, i (i)}
        {#if item.divider}
            <div class="divider" role="separator"></div>
        {/if}
        <button
            bind:this={itemEls[i]}
            type="button"
            role="menuitem"
            tabindex="-1"
            disabled={item.disabled}
            onclick={() => select(item)}
        >
            <span class="label">{item.label}</span>
            {#if item.shortcut}
                <span class="shortcut">{item.shortcut}</span>
            {/if}
        </button>
    {/each}
</div>

<style>
    .menu {
        position: fixed;
        z-index: 10;
        min-width: 13rem;
        max-height: calc(100vh - 8px);
        overflow-y: auto;
        padding: 4px 0;
        color: var(--vscode-menu-foreground, var(--vscode-foreground));
        background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
        border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
        border-radius: 5px;
        box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3));
        outline: none;
    }
    button {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 2rem;
        padding: 4px 12px;
        border: none;
        border-radius: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        outline: none;
    }
    button:hover:not(:disabled),
    button:focus:not(:disabled) {
        color: var(--vscode-menu-selectionForeground, inherit);
        background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
    }
    button:focus-visible {
        outline: none;
    }
    button:disabled {
        background: none;
        opacity: 0.4;
        cursor: default;
    }
    .label {
        flex: 1;
    }
    .shortcut {
        opacity: 0.7;
    }
    .divider {
        margin: 4px 0;
        border-top: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-widget-border));
    }
</style>
