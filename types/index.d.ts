// ambient declaration for imports like `import { story } from './game.squiffy'`
declare module '*.squiffy' {
    export const story: any;
    const _default: unknown;
    export default _default;
}
export {}; // ensure module, avoids TS trimming
