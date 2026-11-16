// The path the app is served under ("" at the root), from the BASE_PATH that vite.config.ts passes
// to SvelteKit.
declare const __APP_BASE_PATH__: string;

export const base: string = __APP_BASE_PATH__;
