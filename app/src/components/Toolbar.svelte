<script lang="ts">
    // The editor's toolbar, laid out like Quest Viva's: home, the story's name and save state on
    // the left; on the right, in groups, as a menu bar would be: File, adding to the story (Add,
    // images), Undo and Redo, problems, what's shown (the script, the map or both), then Run and
    // the overflow menu.
    // Menus open from their button's left edge, as a menu bar's do, unless that's off the screen.
    import { AppBar } from "@skeletonlabs/skeleton-svelte";
    import { goto } from "$app/navigation";
    import { base } from "#lib/base-path.js";
    import { project, closeProject, downloadFile } from "#lib/project.svelte.js";
    import { settings } from "#lib/settings.svelte.js";
    import { shortcutsDialog } from "#lib/shortcuts-dialog.svelte.js";
    import { isMac } from "#lib/shortcuts.js";
    import { builtInSnippets, type Snippet } from "#lib/snippets.js";
    import type { EditorCommand } from "#lib/editor-commands.js";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { DISCORD_URL, DOCS_URL, GAMES_URL, GITHUB_URL, ISSUES_URL } from "#lib/links.js";
    import FolderDown from "@lucide/svelte/icons/folder-down";
    import FolderOpen from "@lucide/svelte/icons/folder-open";
    import { folderReveal } from "#lib/desktop.js";
    import DropdownMenu from "#components/DropdownMenu.svelte";
    import type { DropdownMenuItem } from "#components/DropdownMenu.svelte";
    import Home from "@lucide/svelte/icons/home";
    import Save from "@lucide/svelte/icons/save";
    import Download from "@lucide/svelte/icons/download";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Check from "@lucide/svelte/icons/check";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
    import Circle from "@lucide/svelte/icons/circle";
    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import ListTree from "@lucide/svelte/icons/list-tree";
    import MapIcon from "@lucide/svelte/icons/map";
    import CodeIcon from "@lucide/svelte/icons/code";
    import Columns2 from "@lucide/svelte/icons/columns-2";
    import SettingsIcon from "@lucide/svelte/icons/settings";
    import BookOpen from "@lucide/svelte/icons/book-open";
    import Play from "@lucide/svelte/icons/play";
    import ImageIcon from "@lucide/svelte/icons/image";
    import TypeIcon from "@lucide/svelte/icons/type";
    import StepForward from "@lucide/svelte/icons/step-forward";
    import GithubIcon from "#components/GithubIcon.svelte";
    import Plus from "@lucide/svelte/icons/plus";
    import Undo2 from "@lucide/svelte/icons/undo-2";
    import Redo2 from "@lucide/svelte/icons/redo-2";
    import Search from "@lucide/svelte/icons/search";
    import FileSearch from "@lucide/svelte/icons/file-search";
    import FoldVertical from "@lucide/svelte/icons/fold-vertical";
    import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
    import Info from "@lucide/svelte/icons/info";
    import Keyboard from "@lucide/svelte/icons/keyboard";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import Library from "@lucide/svelte/icons/library";
    import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
    import Bug from "@lucide/svelte/icons/bug";
    import DiscordIcon from "#components/DiscordIcon.svelte";
    import CircleX from "@lucide/svelte/icons/circle-x";
    import CloudUpload from "@lucide/svelte/icons/cloud-upload";
    import CircleCheck from "@lucide/svelte/icons/circle-check";
    import type { ProblemCounts } from "#lib/problems.js";

    export type ViewMode = "code" | "split" | "map";

    interface Props {
        // On a narrow screen, whether the outline is showing instead of the editor
        outlineOpen?: boolean;
        ontoggleoutline?: () => void;
        // On a narrow screen, whether the story map is showing instead of the editor
        mapOpen?: boolean;
        ontogglemap?: () => void;
        // Otherwise, whether the script, the map or both are showing
        view?: ViewMode;
        onview?: (view: ViewMode) => void;
        // How many problems the story has, and whether the Problems panel is showing
        problemCounts?: ProblemCounts;
        problemsOpen?: boolean;
        ontoggleproblems?: () => void;
        // Runs the story in the preview, from the start or from the section the cursor is in
        onrun?: (fromCursor: boolean) => void;
        // Opens the Assets dialog
        onassets?: () => void;
        // Opens the Fonts dialog
        onfonts?: () => void;
        // Downloads the whole project as a zip, which Open file can read back
        ondownloadproject?: () => void;
        // Opens the Publish dialog
        onpublish?: () => void;
        // Undo, redo, find, fold all and unfold all, in the editor
        oncommand?: (command: EditorCommand) => void;
        // Opens Find in Files
        onfindinfiles?: () => void;
        // Adds a section or passage
        onadd?: (kind: "section" | "passage") => void;
        // Inserts a snippet at the cursor
        onsnippet?: (content: string) => void;
        // The author's own snippets, from [snippet:...] blocks
        snippets?: Snippet[];
        onabout?: () => void;
        // Plays the published story in a new tab, as players will see it
        onplaytab?: () => void;
    }

    let { outlineOpen = false, ontoggleoutline, mapOpen = false, ontogglemap, view = "code", onview, problemCounts = { error: 0, warning: 0, hint: 0 }, problemsOpen = false, ontoggleproblems, onfindinfiles, onrun, onassets, onfonts, ondownloadproject, onpublish, oncommand, onadd, onsnippet, snippets = [], onabout, onplaytab }: Props = $props();

    const mod = isMac ? "⌘" : "Ctrl+";

    const views = [
        { view: "code", label: "Code", title: "Just the script", icon: CodeIcon },
        { view: "split", label: "Code + Map", title: "The script and the map side by side", icon: Columns2 },
        { view: "map", label: "Map", title: "Just the map", icon: MapIcon },
    ] as const;

    let runMenuItems = $derived<DropdownMenuItem[]>([
        { label: `Run from the start (${mod}Enter)`, action: () => onrun?.(false), icon: Play },
        { label: `Run from this section (${mod}Shift+Enter)`, action: () => onrun?.(true), icon: StepForward },
        { label: "Play in a new tab", action: () => onplaytab?.(), icon: ExternalLink, divider: true },
    ]);

    const p = $derived(project.current);

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    let problemsLabel = $derived.by(() => {
        const { error, warning, hint } = problemCounts;
        if (!error && !warning && !hint) return "Problems: none";
        return `Problems: ${[error && plural(error, "error"), warning && plural(warning, "warning"), hint && plural(hint, "hint")].filter(Boolean).join(", ")}`;
    });

    function openLink(url: string) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    async function handleHome() {
        await closeProject();
        void goto(`${base}/`);
    }

    // In the desktop app, the story's folder in Finder, Explorer or the file manager
    const reveal = $derived(p ? folderReveal(p.fs) : null);

    let fileMenuItems = $derived<DropdownMenuItem[]>([
        { label: "Save", action: () => void p?.save(), icon: Save },
        ...(reveal ? [{ label: reveal.label, action: () => reveal.show(""), icon: FolderOpen }] : []),
        { label: "Download project (.zip)", action: () => ondownloadproject?.(), icon: FolderDown },
        { label: `Download ${p?.activePath ?? ""}`, action: () => { if (p?.activePath) void downloadFile(p.activePath); }, icon: Download, disabled: !p?.activePath },
        { label: "Publish…", action: () => onpublish?.(), icon: CloudUpload, divider: true },
    ]);

    // Add: a section or passage, or a snippet, as the 6.x editor's Add and Snippets menus
    let insertMenuItems = $derived<DropdownMenuItem[]>([
        { label: "Section", action: () => onadd?.("section"), icon: Plus },
        { label: "Passage", action: () => onadd?.("passage"), icon: Plus },
        ...builtInSnippets.map((s, i): DropdownMenuItem => ({
            label: s.name,
            action: () => onsnippet?.(s.content),
            ...(i === 0 ? { divider: true, heading: "Snippets" } : {}),
        })),
        ...snippets.map((s, i): DropdownMenuItem => ({
            label: s.name,
            action: () => onsnippet?.(s.content),
            ...(i === 0 ? { divider: true, heading: "My snippets" } : {}),
        })),
    ]);

    let overflowItems = $derived.by((): DropdownMenuItem[] => {
        const edit: DropdownMenuItem[] = [
            { label: "Undo", action: () => oncommand?.("undo"), icon: Undo2 },
            { label: "Redo", action: () => oncommand?.("redo"), icon: Redo2 },
        ];
        const view: DropdownMenuItem[] = [
            { label: "Find and replace", action: () => oncommand?.("find"), icon: Search },
            { label: "Find in files", action: () => onfindinfiles?.(), icon: FileSearch },
            { label: "Collapse all", action: () => oncommand?.("foldAll"), icon: FoldVertical },
            { label: "Expand all", action: () => oncommand?.("unfoldAll"), icon: UnfoldVertical },
        ];
        const help: DropdownMenuItem[] = [
            { label: "Documentation", action: () => openLink(`${DOCS_URL}/getting-started/`), icon: BookOpen, divider: true, heading: "Help" },
            { label: "Keyboard shortcuts", action: () => { shortcutsDialog.open = true; }, icon: Keyboard },
            { label: "Examples", action: () => openLink(`${DOCS_URL}/featured-examples/`), icon: Library },
            { label: "Squiffy games", action: () => openLink(GAMES_URL), icon: Gamepad2 },
            { label: "Report an issue", action: () => openLink(ISSUES_URL), icon: Bug },
            { label: "GitHub", action: () => openLink(GITHUB_URL), icon: GithubIcon },
            { label: "Discord", action: () => openLink(DISCORD_URL), icon: DiscordIcon },
            { label: "About Squiffy", action: () => onabout?.(), icon: Info },
            { label: "Settings", action: () => { settings.open = true; }, icon: SettingsIcon, divider: true },
        ];
        if (!isNarrow.current) return [...view, ...help];
        // On a phone the toolbar's buttons fold into this menu
        return [
            ...edit,
            ...view,
            { ...fileMenuItems[0], divider: true },
            ...fileMenuItems.slice(1),
            { label: "Images and other files", action: () => onassets?.(), icon: ImageIcon, divider: true },
            { label: "Fonts", action: () => onfonts?.(), icon: TypeIcon },
            ...help,
        ];
    });
</script>

<AppBar>
    <AppBar.Toolbar class="grid-cols-[auto_1fr_auto]">
        <AppBar.Lead class="flex-1 min-w-0">
            <div class="flex items-center min-w-0">
                <button
                    type="button"
                    class="toolbar-icon-btn mr-2 shrink-0"
                    onclick={handleHome}
                    title="Back to home"
                    aria-label="Back to home"
                ><Home size={16} /></button>
                {#if p}
                    <span class="text-sm font-medium truncate min-w-0" title={p.source.kind === "folder" ? p.fs.name : p.mainFile}>{p.displayName}</span>
                    <span role="status" aria-live="polite" class="contents">
                        {#if p.saveError}
                            <button
                                type="button"
                                class="save-chip save-chip-error shrink-0"
                                onclick={() => p.save()}
                                title={p.saveError}
                            ><TriangleAlert size={13} /> <span class="hidden md:inline">Save failed. Retry</span></button>
                        {:else if p.saving}
                            <span class="save-chip save-chip-saving shrink-0"><LoaderCircle size={13} class="animate-spin" /> <span class="hidden md:inline">Saving</span></span>
                        {:else if p.dirty}
                            <button
                                type="button"
                                class="save-chip save-chip-unsaved shrink-0"
                                onclick={() => p.save()}
                                title="Save now"
                            ><Circle size={8} fill="currentColor" /> <span class="hidden md:inline">Unsaved</span></button>
                        {:else}
                            <span class="save-chip save-chip-saved shrink-0"><Check size={13} /> <span class="hidden md:inline">Saved</span></span>
                        {/if}
                    </span>
                {/if}
            </div>
        </AppBar.Lead>
        <AppBar.Trail>
            <div class="flex gap-1 md:gap-1.5 items-center">
                {#if !isNarrow.current}
                    <DropdownMenu items={fileMenuItems} align="left">
                        {#snippet trigger(toggle, open)}
                            <button
                                type="button"
                                class="btn btn-xs preset-outlined-primary-500"
                                onclick={toggle}
                                title="File"
                                aria-haspopup="menu"
                                aria-expanded={open}
                            >File <ChevronDown size={12} /></button>
                        {/snippet}
                    </DropdownMenu>
                    <div class="toolbar-divider"></div>
                {/if}
                <DropdownMenu items={insertMenuItems} align="left">
                    {#snippet trigger(toggle, open)}
                        <button
                            type="button"
                            class="btn btn-xs preset-outlined-primary-500"
                            onclick={toggle}
                            title="Add a section, passage or snippet"
                            aria-haspopup="menu"
                            aria-expanded={open}
                        ><Plus size={14} /> <span class="hidden md:inline">Add</span> <ChevronDown size={12} class="hidden md:inline" /></button>
                    {/snippet}
                </DropdownMenu>
                {#if isNarrow.current}
                    <button
                        type="button"
                        class="toolbar-icon-btn"
                        onclick={ontoggleoutline}
                        title="Outline"
                        aria-label="Outline"
                        aria-pressed={outlineOpen}
                    ><ListTree size={16} /></button>
                {:else}
                    <button type="button" class="toolbar-icon-btn" onclick={onassets} title="Images and other files" aria-label="Images and other files"><ImageIcon size={16} /></button>
                    <button type="button" class="toolbar-icon-btn" onclick={onfonts} title="Fonts" aria-label="Fonts"><TypeIcon size={16} /></button>
                    <div class="toolbar-divider"></div>
                    <button type="button" class="toolbar-icon-btn" onclick={() => oncommand?.("undo")} title="Undo ({mod}Z)" aria-label="Undo"><Undo2 size={16} /></button>
                    <button type="button" class="toolbar-icon-btn" onclick={() => oncommand?.("redo")} title="Redo ({mod}Shift+Z)" aria-label="Redo"><Redo2 size={16} /></button>
                    <div class="toolbar-divider"></div>
                {/if}
                <button
                    type="button"
                    class="problems-btn"
                    onclick={ontoggleproblems}
                    title="{problemsLabel} ({mod}Shift+M)"
                    aria-label={problemsLabel}
                    aria-pressed={problemsOpen}
                >
                    {#if isNarrow.current && problemCounts.error && problemCounts.warning}
                        <!-- One count on a phone, where there's less room -->
                        <span class="problems-count problems-error"><CircleX size={14} />{problemCounts.error + problemCounts.warning}</span>
                    {:else if problemCounts.error || problemCounts.warning}
                        {#if problemCounts.error}
                            <span class="problems-count problems-error"><CircleX size={14} />{problemCounts.error}</span>
                        {/if}
                        {#if problemCounts.warning}
                            <span class="problems-count problems-warning"><TriangleAlert size={14} />{problemCounts.warning}</span>
                        {/if}
                    {:else if problemCounts.hint}
                        <span class="problems-count problems-hint"><Info size={14} />{problemCounts.hint}</span>
                    {:else}
                        <span class="problems-count"><CircleCheck size={14} /></span>
                    {/if}
                </button>
                {#if isNarrow.current}
                    <button
                        type="button"
                        class="toolbar-icon-btn"
                        onclick={ontogglemap}
                        title="Story map"
                        aria-label="Story map"
                        aria-pressed={mapOpen}
                    ><MapIcon size={16} /></button>
                {:else}
                    <div class="toolbar-divider"></div>
                    <!-- Labelled where there's room, so the map-only view is easy to find -->
                    <div class="view-switch" role="group" aria-label="View">
                        {#each views as v (v.view)}
                            {@const Icon = v.icon}
                            <button
                                type="button"
                                onclick={() => onview?.(v.view)}
                                title={v.title}
                                aria-label={v.label}
                                aria-pressed={view === v.view}
                            ><Icon size={14} /><span class="hidden xl:inline">{v.label}</span></button>
                        {/each}
                    </div>
                    <div class="toolbar-divider"></div>
                {/if}
                <!-- Run and its options as one split button, with the menu lined up with the whole of it.
                     Stretch both halves to the same height. -->
                <DropdownMenu items={runMenuItems} align="left">
                    {#snippet trigger(toggle, open)}
                        <div class="flex items-stretch">
                            <button
                                type="button"
                                class="btn btn-xs preset-filled-primary-500 rounded-r-none"
                                onclick={() => onrun?.(false)}
                                title="Run the story ({mod}Enter)"
                            ><Play size={14} /> <span class="hidden md:inline">Run</span></button>
                            <button
                                type="button"
                                class="btn btn-xs preset-filled-primary-500 rounded-l-none border-l border-white/30 px-1.5"
                                onclick={toggle}
                                title="Run options"
                                aria-label="Run options"
                                aria-haspopup="menu"
                                aria-expanded={open}
                            ><ChevronDown size={12} /></button>
                        </div>
                    {/snippet}
                </DropdownMenu>
                <DropdownMenu items={overflowItems} align="left">
                    {#snippet trigger(toggle, open)}
                        <button type="button" class="toolbar-icon-btn" onclick={toggle} title="More" aria-label="More" aria-haspopup="menu" aria-expanded={open}><Ellipsis size={16} /></button>
                    {/snippet}
                </DropdownMenu>
            </div>
        </AppBar.Trail>
    </AppBar.Toolbar>
</AppBar>

<style>
    .toolbar-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: var(--radius-container);
        color: var(--color-surface-600-400);
    }
    .toolbar-icon-btn:hover:not(:disabled),
    .toolbar-icon-btn[aria-pressed="true"] {
        background-color: var(--color-surface-200-800);
        color: var(--color-primary-500);
    }
    .toolbar-icon-btn:disabled {
        opacity: 0.4;
    }
    .view-switch {
        display: inline-flex;
        padding: 2px;
        gap: 2px;
        border-radius: var(--radius-container);
        background-color: var(--color-surface-100-900);
    }
    .view-switch button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        height: 1.75rem;
        min-width: 1.75rem;
        justify-content: center;
        padding: 0 0.45rem;
        border-radius: calc(var(--radius-container) - 2px);
        color: var(--color-surface-600-400);
        font-size: 0.75rem;
        font-weight: 600;
        white-space: nowrap;
    }
    .view-switch button:hover {
        color: var(--color-primary-500);
    }
    .view-switch button[aria-pressed="true"] {
        background-color: var(--color-surface-50-950);
        color: var(--color-primary-500);
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
    }
    .problems-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        height: 2rem;
        min-width: 2rem;
        justify-content: center;
        padding: 0 0.3rem;
        border-radius: var(--radius-container);
        color: var(--color-surface-600-400);
        font-size: 0.75rem;
        font-weight: 600;
    }
    .problems-btn:hover,
    .problems-btn[aria-pressed="true"] {
        background-color: var(--color-surface-200-800);
    }
    .problems-count {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        font-variant-numeric: tabular-nums;
    }
    .problems-error {
        color: var(--color-error-600-400);
    }
    .problems-warning {
        color: var(--color-warning-700-300);
    }
    .problems-hint {
        color: var(--color-primary-600-400);
    }
    .toolbar-divider {
        width: 1px;
        height: 1.25rem;
        background-color: var(--color-surface-200-800);
        margin: 0 0.25rem;
    }
    .save-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        margin-left: 0.75rem;
        padding: 0.15rem 0.55rem 0.15rem 0.45rem;
        border: none;
        border-radius: 999px;
        font: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.4;
        white-space: nowrap;
    }
    .save-chip-saved,
    .save-chip-saving,
    .save-chip-unsaved {
        min-width: 6.25rem;
        justify-content: center;
    }
    @media (max-width: 767px) {
        .save-chip {
            margin-left: 0.25rem;
        }
        .save-chip-saved,
        .save-chip-saving,
        .save-chip-unsaved {
            min-width: 0;
        }
    }
    .save-chip-saved {
        color: var(--color-success-600-400);
        background-color: color-mix(in srgb, var(--color-success-500) 12%, transparent);
    }
    .save-chip-saving {
        color: var(--color-surface-600-400);
    }
    .save-chip-unsaved {
        color: var(--color-warning-600-400);
        background-color: color-mix(in srgb, var(--color-warning-500) 12%, transparent);
        cursor: pointer;
    }
    .save-chip-unsaved:hover {
        text-decoration: underline;
    }
    .save-chip-error {
        color: var(--color-error-500);
        background-color: color-mix(in srgb, var(--color-error-500) 12%, transparent);
        cursor: pointer;
    }
    .save-chip-error:hover {
        text-decoration: underline;
    }
</style>
