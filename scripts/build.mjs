import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';import path from 'node:path';import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const deps=process.env.NOZEOMICS_BUILD_DEPS||'C:/Users/nojae/OneDrive/Desktop/노제/NozeDock v3/frontend/node_modules';
const require=createRequire(path.join(deps,'../package.json'));const esbuild=require('esbuild');
await esbuild.build({entryPoints:[path.join(root,'mcp/adapter.mjs')],outfile:path.join(root,'mcp/adapter.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',nodePaths:[deps],banner:{js:'// NozeOmics standalone MCP adapter; bundled from the official MCP SDK.'}});
// Top-level await requires an async wrapper when the distributable is CJS.
