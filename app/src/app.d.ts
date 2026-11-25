// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
    namespace App {
        interface Error {
            // The stack of an exception the editor didn't catch (hooks.client.ts)
            detail?: string;
        }
        interface PageState {
            // The editor's entries in the browser's history, either side of the one it's on, so
            // the browser's Back and Forward are the editor's (see edit/+page.svelte)
            nav?: "back" | "here" | "forward";
        }
    }
    const __APP_VERSION__: string;
}

export {};
