import type { HandleClientError } from "@sveltejs/kit/hooks";
import { describeError } from "#lib/errors.js";

// An exception the editor didn't catch, while loading or rendering a page, replaces the page with
// +error.svelte. SvelteKit's default shows only "500 Internal Error"; this keeps what actually
// went wrong, so the author can report it.
export const handleError: HandleClientError = ({ kind, error }) => {
    if (kind !== "unknown") return;
    console.error(error);
    return describeError(error);
};
