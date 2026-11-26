// A Twine story pasted into the script, as Twee (#711): instead of pasting it, `handle` is given
// the text, and a function that pastes it after all.
import { EditorView } from "@codemirror/view";
import { looksLikeTwee } from "./twine-import.js";

export function twinePaste(handle: (text: string, paste: () => void) => void) {
    return EditorView.domEventHandlers({
        paste(event, view) {
            const text = event.clipboardData?.getData("text/plain");
            if (!text || !looksLikeTwee(text)) return false;
            event.preventDefault();
            handle(text, () => {
                view.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.paste", scrollIntoView: true });
                view.focus();
            });
            return true;
        },
    });
}
