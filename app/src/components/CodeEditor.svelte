<script lang="ts">
    // From Quest Viva's AppShell (src/components/CodeEditor.svelte). Where Quest picks one of its
    // fixed languages, this takes the extensions to use, so the Squiffy mode and the language
    // service's features plug in from outside. It also reports every change rather than only on
    // blur, since the text here is the whole document and saves continuously.
    import { untrack } from "svelte";
    import { EditorState, Compartment, Prec, Transaction, type Extension } from "@codemirror/state";
    import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
    import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
    import { bracketMatching, indentOnInput, codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
    import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, acceptCompletion } from "@codemirror/autocomplete";
    import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
    import { lintKeymap } from "@codemirror/lint";
    import { editorExtensions } from "#lib/codemirror-theme.js";
    import { foldingChanged } from "#lib/codemirror-folding.js";

    interface Props {
        value: string;
        extensions?: Extension[];
        readonly?: boolean;
        onChange?: (value: string) => void;
        onSave?: () => void;
        onCursor?: (offset: number) => void;
        // Gets the view once it's created, e.g. to move the cursor from the outline
        onView?: (view: EditorView | null) => void;
        class?: string;
    }

    let { value, extensions = [], readonly = false, onChange, onSave, onCursor, onView, class: className = "" }: Props = $props();

    let editorEl = $state<HTMLDivElement | null>(null);
    let view: EditorView | null = null;

    const extensionsCompartment = new Compartment();
    const readonlyCompartment = new Compartment();

    function readonlyExtension(ro: boolean) {
        return [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
    }

    // Mounts once, when the host element appears. Props are read with untrack() so a change
    // doesn't remount the editor, losing the cursor and undo history; the effects below apply
    // later changes in place.
    $effect(() => {
        if (!editorEl) return;

        view = new EditorView({
            doc: untrack(() => value),
            parent: editorEl,
            extensions: [
                lineNumbers(),
                foldGutter({ foldingChanged }),
                codeFolding(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                highlightSelectionMatches(),
                history(),
                bracketMatching(),
                closeBrackets(),
                indentOnInput(),
                // The completion keymap is registered below instead of the default one, so Enter
                // can be left out of it.
                autocompletion({ defaultKeymap: false }),
                EditorView.lineWrapping,
                // Ahead of the main keymap so the arrow keys move through an open completion list.
                // Enter always inserts a newline, as in Quest Viva; Tab accepts.
                Prec.highest(keymap.of(completionKeymap.filter(b => b.key !== "Enter"))),
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                    ...foldKeymap,
                    ...lintKeymap,
                    { key: "Tab", run: acceptCompletion },
                    indentWithTab,
                    {
                        key: "Mod-s",
                        preventDefault: true,
                        run: () => {
                            onSave?.();
                            return true;
                        },
                    },
                ]),
                EditorView.updateListener.of(update => {
                    if (update.docChanged) onChange?.(update.state.doc.toString());
                    if (update.selectionSet || update.docChanged) onCursor?.(update.state.selection.main.head);
                }),
                extensionsCompartment.of(untrack(() => extensions)),
                readonlyCompartment.of(readonlyExtension(untrack(() => readonly))),
                EditorView.theme({
                    "&": { height: "100%" },
                    ".cm-scroller": { overflow: "auto" },
                }),
                ...editorExtensions,
            ],
        });
        untrack(() => onView)?.(view);

        return () => {
            untrack(() => onView)?.(null);
            view?.destroy();
            view = null;
        };
    });

    $effect(() => {
        if (!view) return;
        view.dispatch({
            effects: [
                extensionsCompartment.reconfigure(extensions),
                readonlyCompartment.reconfigure(readonlyExtension(readonly)),
            ],
        });
    });

    // Replaces the text only when the prop differs from what the editor shows (e.g. a file
    // reloaded from disk), so it doesn't fight typing. Not undoable: it's a reload, not an edit.
    $effect(() => {
        if (!view) return;
        if (value !== view.state.doc.toString()) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: value },
                annotations: Transaction.addToHistory.of(false),
            });
        }
    });
</script>

<div bind:this={editorEl} class="code-editor overflow-hidden h-full {className}"></div>
