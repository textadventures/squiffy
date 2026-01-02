export type __squiffy_types_ref = typeof import('@textadventures/squiffy-types');
import { type Plugin } from 'vite';
import { compileFile } from '@textadventures/squiffy-packager';

export interface SquiffyPluginOptions {
    /** Log transformed file paths (defaults to false). */
    verbose?: boolean;
}

export default function squiffyPlugin(options: SquiffyPluginOptions = {}): Plugin {
    const { verbose = false } = options;

    return {
        name: 'vite-plugin-squiffy',
        enforce: 'pre', // run before other transforms that might depend on output

        async transform(code, id) {
            if (!id.endsWith('.squiffy')) return null;

            if (verbose) {
                this.warn(`vite-plugin-squiffy: transforming ${id}`);
            }

            const result = await compileFile(id);
            if (result == null) return null;

            return {
                code: result,
                map: null,
            };
        },

        // Optional: so users can import *.squiffy without adding `assetsInclude` themselves
        config() {
            return {
                assetsInclude: ['**/*.squiffy'],
            };
        },
    };
}
