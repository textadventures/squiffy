// Ambient declaration for imports like `import { story } from "./game.squiffy"`,
// as provided by @textadventures/vite-plugin-squiffy
declare module "*.squiffy" {
    export const story: any;
    export const title: string;
    export default story;
}
