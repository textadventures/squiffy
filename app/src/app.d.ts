// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
    namespace App {
        interface Error {
            // The stack of an exception the editor didn't catch (hooks.client.ts)
            detail?: string;
        }
    }
    const __APP_VERSION__: string;
}

export {};
