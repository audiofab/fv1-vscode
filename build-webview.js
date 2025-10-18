/**
 * Build script for webview React application
 * Uses esbuild to bundle React + TypeScript for the webview
 */

import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/blockDiagram/editor/webview/index.tsx'],
        bundle: true,
        format: 'iife',
        outfile: 'out/webview.js',
        platform: 'browser',
        target: 'es2020',
        sourcemap: !production,
        minify: production,
        loader: {
            '.tsx': 'tsx',
            '.ts': 'ts',
        },
        define: {
            'process.env.NODE_ENV': production ? '"production"' : '"development"',
        },
        jsx: 'automatic',
        jsxDev: !production,
        external: [],
        logLevel: 'info',
    });

    if (watch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        console.log('Build complete!');
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
