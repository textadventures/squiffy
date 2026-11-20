<script lang="ts">
    // A right-click menu, at a point on the screen: the code editor's (Go to definition, Find
    // references, Rename, cut, copy and paste). Looks like DropdownMenu's menus, with each item's
    // shortcut beside it. Closes on Escape, a click elsewhere, scrolling or resizing.
    import { tick } from "svelte";

    export interface ContextMenuItem {
        label: string;
        action: () => void;
        shortcut?: string;
        disabled?: boolean;
        divider?: boolean;
    }

    interface Props {
        x: number;
        y: number;
        items: ContextMenuItem[];
        // Opened from the keyboard (the menu key, or Shift+F10), so the first item gets focus
        keyboard?: boolean;
        onclose: () => void;
    }

    let { x, y, items, keyboard = false, onclose }: Props = $props();

    let menuEl = $state<HTMLDivElement | undefined>();
    let itemEls: (HTMLButtonElement | undefined)[] = $state([]);
    // Moved back onto the screen once its size is known
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

    function select(item: ContextMenuItem) {
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
        window.addEventListener("scroll", onOutside, true);
        window.addEventListener("resize", onclose);
        window.addEventListener("blur", onclose);
        return () => {
            document.removeEventListener("mousedown", onOutside, true);
            window.removeEventListener("scroll", onOutside, true);
            window.removeEventListener("resize", onclose);
            window.removeEventListener("blur", onclose);
        };
    });
</script>

<div
    bind:this={menuEl}
    role="menu"
    tabindex="-1"
    style="position: fixed; left: {left}px; top: {top}px;"
    class="z-[999] min-w-56 max-h-[calc(100dvh-1rem)] overflow-y-auto bg-surface-50-950 border border-surface-200-800 rounded shadow-lg py-1 outline-none"
    {onkeydown}
    oncontextmenu={e => e.preventDefault()}
>
    {#each items as item, i (i)}
        {#if item.divider}
            <div class="my-1 border-t border-surface-200-800"></div>
        {/if}
        <button
            bind:this={itemEls[i]}
            type="button"
            role="menuitem"
            tabindex="-1"
            class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-6 hover:bg-surface-200-800 focus:bg-surface-200-800 outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            disabled={item.disabled}
            onclick={() => select(item)}
        >
            <span class="flex-1">{item.label}</span>
            {#if item.shortcut}
                <span class="text-surface-600-400">{item.shortcut}</span>
            {/if}
        </button>
    {/each}
</div>
