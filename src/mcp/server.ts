/**
 * Standalone stdio MCP server for FV-1 block-diagram patch building.
 *
 * Exposes the FV-1 block catalog and the graph compiler to AI agents so they can
 * author `.spndiagram` files reliably: discover blocks, fetch their schemas, and
 * (crucially) validate a candidate diagram against the real compiler in a
 * generate → validate → fix loop instead of reasoning about correctness in prose.
 *
 * This is a pure-Node process with **no `vscode` import**, so the exact same bundle
 * is launchable by any MCP client:
 *   - GitHub Copilot, via VS Code's MCP host (see mcpIntegration.ts, Copilot path)
 *   - Claude Code, via a `.mcp.json` entry (see mcpIntegration.ts, Claude Code path)
 *
 * It rebuilds the block registry from the shipped builtin manifest (plus any custom
 * block directories passed with --custom-block-path) and news up a GraphCompiler,
 * exactly as the extension host does in extension.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    BlockRegistry,
    BUILTIN_BLOCKS,
    GraphCompiler,
    type BlockGraph,
    type BlockMetadata,
} from '@audiofab-io/fv1-core/blockDiagram';
import { loadBlocksFromDirectory } from '@audiofab-io/fv1-core/blockDiagram/node';
import { FV1_REG_COUNT, FV1_DELAY_SIZE, FV1_PROG_SIZE } from '@audiofab-io/fv1-core';

// The stdio transport owns stdout for JSON-RPC framing. Any stray write to stdout
// (from us or a dependency) corrupts the protocol stream, so funnel every diagnostic
// to stderr. VS Code / Claude Code surface stderr in the MCP server's output log.
console.log = (...args: unknown[]) => console.error(...args);

// FV-1 hardware ceilings. Kept in sync with the extension's fv1.hardware.* defaults;
// the whole compiled *graph* shares these budgets.
// Budgets reported to the agent. Register count and delay size come from
// fv1-core, which enforces them — they are fixed by the instruction encoding
// and are not compiler options.
const HARDWARE = {
    regCount: FV1_REG_COUNT,
    progSize: FV1_PROG_SIZE,
    delaySize: FV1_DELAY_SIZE,
} as const;

interface ServerArgs {
    /** Directories to load blocks from (--custom-block-path, repeatable). */
    customPaths: string[];
    /** Single directory the server may write new .atl blocks into (--agent-block-path). */
    writeDir?: string;
}

/** Parse argv: --custom-block-path <dir> (repeatable), --agent-block-path <dir>, + env fallback. */
function parseArgs(argv: string[]): ServerArgs {
    const customPaths: string[] = [];
    let writeDir: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--custom-block-path' && argv[i + 1]) {
            customPaths.push(argv[++i]);
        } else if (argv[i] === '--agent-block-path' && argv[i + 1]) {
            writeDir = argv[++i];
        }
    }
    if (process.env.FV1_CUSTOM_BLOCK_PATHS) {
        customPaths.push(...process.env.FV1_CUSTOM_BLOCK_PATHS.split(path.delimiter).filter(Boolean));
    }
    return { customPaths, writeDir };
}

const ARGS = parseArgs(process.argv.slice(2));

// Every directory the registry loads from: the custom paths + the write dir (deduped), so a block
// the server authors is always loadable even if only --agent-block-path was passed.
const LOAD_DIRS = [...new Set([...ARGS.customPaths, ...(ARGS.writeDir ? [ARGS.writeDir] : [])])];

// ---------------------------------------------------------------------------
// Registry + compiler (mirrors extension.ts reloadBlocks()).
// ---------------------------------------------------------------------------
const registry = new BlockRegistry();

/** Rebuild the registry from the manifest + every load dir. Called after create/delete so the
 *  in-process registry reflects what's on disk (BlockRegistry has no single-block unregister). */
function rebuildRegistry(): void {
    registry.clear();
    registry.loadManifest(BUILTIN_BLOCKS);
    for (const dir of LOAD_DIRS) {
        try {
            loadBlocksFromDirectory(registry, dir);
        } catch (err) {
            console.error(`[fv1-mcp] failed to load custom blocks from ${dir}:`, err);
        }
    }
}
rebuildRegistry();
const compiler = new GraphCompiler(registry);

/** The bundled ATL developer reference, copied next to this bundle at build time (esbuild.cjs). */
function loadAtlReference(): string {
    try {
        return fs.readFileSync(path.join(__dirname, 'atl-reference.md'), 'utf8');
    } catch {
        return '(ATL developer reference not found next to the server bundle.)';
    }
}

/**
 * Strip a block's metadata down to what an agent needs to wire it up — and drop the
 * non-serializable function fields (toDisplay/fromDisplay) that live on parameters.
 */
function serializeMetadata(m: BlockMetadata) {
    return {
        type: m.type,
        category: m.category,
        subcategory: m.subcategory,
        name: m.name,
        description: m.description,
        inputs: m.inputs.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type, // 'audio' | 'control'
            required: p.required ?? false,
            // For control inputs, the parameter this CV backs (drives the @cv default).
            ...(p.parameter ? { parameter: p.parameter } : {}),
        })),
        outputs: m.outputs.map(p => ({ id: p.id, name: p.name, type: p.type })),
        parameters: m.parameters.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            default: p.default,
            ...(p.min !== undefined ? { min: p.min } : {}),
            ...(p.max !== undefined ? { max: p.max } : {}),
            ...(p.step !== undefined ? { step: p.step } : {}),
            ...(p.options ? { options: p.options } : {}),
            ...(p.displayUnit ? { unit: p.displayUnit } : {}),
            ...(p.description ? { description: p.description } : {}),
        })),
    };
}

const DIAGRAM_FORMAT_DOC = `A .spndiagram file is a single JSON object (a "BlockGraph"):

{
  "version": "1.0",                       // optional
  "metadata": { "name": string, "description"?: string, "author"?: string },
  "canvas":   { "zoom": 1, "panX": 0, "panY": 0 },   // cosmetic; safe defaults shown
  "blocks":      Block[],
  "connections": Connection[]
}

Block      = { "id": string, "type": string, "position": {"x":number,"y":number}, "parameters": { [paramId]: value } }
Connection = { "id": string, "from": {"blockId":string,"portId":string}, "to": {"blockId":string,"portId":string} }

Rules:
- "type" MUST be a real block type id from list_blocks. "parameters" keys/values come from that
  block's schema (get_block_schema) — omitted params fall back to their default.
- A connection wires an OUTPUT port ("from") to an INPUT port ("to"). Port types must match:
  audio→audio and control→control. A control input backs a block parameter (CV): connecting to it
  sweeps that parameter; leaving it unconnected uses the parameter's constant value.
- Every "blockId"/"portId" in a connection must exist. Give each block and connection a unique id.
- Position is cosmetic — the editor lays diagrams out left-to-right; reasonable x/y (e.g. x by
  signal-flow depth, y to separate parallel paths) is fine, don't agonize over pixels.

Minimal worked example (ADC 0 straight to DAC 0):

{
  "metadata": { "name": "Passthrough" },
  "canvas": { "zoom": 1, "panX": 0, "panY": 0 },
  "blocks": [
    { "id": "in1",  "type": "input.adc",  "position": {"x":0,"y":0},   "parameters": { "adcNumber": 0 } },
    { "id": "out1", "type": "output.dac", "position": {"x":400,"y":0}, "parameters": { "dacNumber": 0 } }
  ],
  "connections": [
    { "id": "c1", "from": {"blockId":"in1","portId":"out"}, "to": {"blockId":"out1","portId":"in"} }
  ]
}

Workflow: understand the effect → check get_example for a close archetype to adapt → list_blocks /
get_block_schema to pick real blocks and ports → assemble the JSON → validate_diagram → fix any
errors/over-budget warnings → repeat until success. Budgets are shared across the whole graph: ${HARDWARE.progSize} instructions,
${HARDWARE.regCount} registers, ${HARDWARE.delaySize} delay-RAM words.

If no existing block does what's needed, author one: read get_atl_reference, study a similar block via
get_block_source, then create_custom_block — the new block is immediately usable in the steps above.`;

// ---------------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------------
const server = new McpServer({ name: 'audiofab-fv1', version: '1.0.0' });

server.registerTool(
    'get_diagram_format',
    {
        title: 'FV-1 diagram format',
        description:
            'Return the .spndiagram (BlockGraph) JSON schema, the wiring rules, and a minimal worked ' +
            'example. Read this once before authoring a diagram so the structure and port-typing rules ' +
            'are anchored; use list_blocks / get_block_schema for real block type ids and parameters.',
        inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: DIAGRAM_FORMAT_DOC }] }),
);

server.registerTool(
    'list_blocks',
    {
        title: 'List FV-1 blocks',
        description:
            'Terse catalog index of every available FV-1 block type (type id, category, one-line ' +
            'description). Call this first to discover the building blocks, then get_block_schema for ' +
            'the few you intend to use. Optionally filter by category.',
        inputSchema: {
            category: z
                .string()
                .optional()
                .describe('Case-insensitive category filter, e.g. "Filter", "Delay", "Input".'),
        },
    },
    async ({ category }) => {
        const all = registry.getAllMetadata();
        const filtered = category
            ? all.filter(m => m.category.toLowerCase() === category.toLowerCase())
            : all;
        filtered.sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
        const lines = filtered.map(m => {
            const cat = m.subcategory ? `${m.category}/${m.subcategory}` : m.category;
            return `${m.type}\t[${cat}]\t${m.name} — ${m.description}`;
        });
        const categories = [...new Set(all.map(m => m.category))].sort();
        const header =
            `${filtered.length} block(s)` +
            (category ? ` in category "${category}"` : '') +
            `. Columns: <type> <TAB> [category] <TAB> name — description.\n` +
            (category ? '' : `Categories: ${categories.join(', ')}\n`);
        return { content: [{ type: 'text', text: header + '\n' + lines.join('\n') }] };
    },
);

server.registerTool(
    'get_block_schema',
    {
        title: 'Get FV-1 block schema(s)',
        description:
            'Return the full schema (input/output ports with types, and parameters with ' +
            'defaults/ranges/options/units) for one or more block type ids. Fetch only the blocks you ' +
            'plan to use — this is the detailed, per-block reference.',
        inputSchema: {
            types: z
                .array(z.string())
                .min(1)
                .describe('Block type id(s) from list_blocks, e.g. ["effects.delay.simple","output.dac"].'),
        },
    },
    async ({ types }) => {
        const result = types.map(type => {
            const def = registry.getBlock(type);
            if (!def) {
                return { type, error: 'Unknown block type. Use list_blocks to see valid type ids.' };
            }
            return serializeMetadata(def.getMetadata());
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    'validate_diagram',
    {
        title: 'Validate / compile an FV-1 diagram',
        description:
            'Compile a candidate .spndiagram against the real FV-1 graph compiler and report whether it ' +
            'succeeds, any errors and warnings, and resource usage vs. the hardware budgets ' +
            '(instructions / registers / delay memory). This is the ground-truth check — draft a diagram, ' +
            'validate, fix what it reports, and repeat until success. Optionally returns the generated ' +
            'FV-1 assembly.',
        inputSchema: {
            diagram: z
                .string()
                .describe('The full .spndiagram document as a JSON string (a BlockGraph).'),
            includeAssembly: z
                .boolean()
                .optional()
                .describe('If true, include the generated FV-1 assembly text in the result.'),
            optimizationLevel: z
                .number()
                .int()
                .min(0)
                .max(2)
                .optional()
                .describe('Compiler optimization level 0/1/2 (default 2 = aggressive, the shipping default).'),
        },
    },
    async ({ diagram, includeAssembly, optimizationLevel }) => {
        let graph: BlockGraph;
        try {
            graph = JSON.parse(diagram) as BlockGraph;
        } catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { success: false, errors: [`diagram is not valid JSON: ${err}`] },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }

        const result = compiler.compile(graph, {
            progSize: HARDWARE.progSize,
            fv1AsmMemBug: true,
            clampReals: true,
            optimizationLevel: optimizationLevel ?? 2,
        });

        const stats = result.statistics;
        const payload = {
            success: result.success,
            errors: result.errors ?? [],
            warnings: result.warnings ?? [],
            resourceUsage: stats
                ? {
                      instructions: { used: stats.instructionsUsed, limit: HARDWARE.progSize },
                      registers: { used: stats.registersUsed, limit: HARDWARE.regCount },
                      delayMemory: { used: stats.memoryUsed, limit: HARDWARE.delaySize },
                      lfosUsed: stats.lfosUsed,
                      blocksProcessed: stats.blocksProcessed,
                  }
                : undefined,
            ...(includeAssembly && result.assembly ? { assembly: result.assembly } : {}),
        };

        return {
            content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
            isError: !result.success,
        };
    },
);

// ---------------------------------------------------------------------------
// Authoring new blocks on the fly
// ---------------------------------------------------------------------------
server.registerTool(
    'get_atl_reference',
    {
        title: 'ATL block developer reference',
        description:
            'Return the full Audiofab Template Language (ATL) developer reference — the canonical spec ' +
            'for authoring custom `.atl` blocks (frontmatter/metadata schema, template macros like @cv / ' +
            '@mulcv / @if, delay addressing, parameter conversions, register/instruction budgets). Read ' +
            'this before writing a new block with create_custom_block, and study get_block_source of a ' +
            'similar existing block as a worked example.',
        inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: loadAtlReference() }] }),
);

server.registerTool(
    'get_block_source',
    {
        title: 'Get a block\'s ATL source',
        description:
            'Return the raw `.atl` source (frontmatter + assembly template) for one or more existing ' +
            'block type ids. Use real, shipped blocks as worked references when authoring a new one — ' +
            'e.g. copy the structure of effects.delay.simple for a delay, or a filter block for a filter.',
        inputSchema: {
            types: z
                .array(z.string())
                .min(1)
                .describe('Block type id(s) from list_blocks whose ATL source you want to study.'),
        },
    },
    async ({ types }) => {
        const parts = types.map(type => {
            const def = registry.getBlock(type);
            if (!def) {
                return `### ${type}\n(unknown block type — use list_blocks for valid type ids)`;
            }
            const raw = def.getRawTemplate?.();
            if (!raw) {
                return `### ${type}\n(no ATL source available — this block is not template-based)`;
            }
            return `### ${type}\n\`\`\`atl\n${raw}\n\`\`\``;
        });
        return { content: [{ type: 'text', text: parts.join('\n\n') }] };
    },
);

/**
 * Build a minimal graph that exercises a block's codegen in isolation: an ADC into every audio
 * input, a DAC out of every audio output, control inputs left at their parameter defaults. Enough
 * to catch template-expansion / assembly errors without the caller hand-wiring a full patch.
 */
function buildProbeGraph(meta: BlockMetadata): BlockGraph {
    const blocks: BlockGraph['blocks'] = [
        { id: '__probe', type: meta.type, position: { x: 200, y: 0 }, parameters: {} },
    ];
    const connections: BlockGraph['connections'] = [];
    meta.inputs
        .filter(p => p.type === 'audio')
        .forEach((p, i) => {
            const id = `__adc${i}`;
            blocks.push({ id, type: 'input.adc', position: { x: 0, y: i * 100 }, parameters: { adcNumber: i % 2 } });
            connections.push({ id: `__ci${i}`, from: { blockId: id, portId: 'out' }, to: { blockId: '__probe', portId: p.id } });
        });
    meta.outputs
        .filter(p => p.type === 'audio')
        .forEach((p, i) => {
            const id = `__dac${i}`;
            blocks.push({ id, type: 'output.dac', position: { x: 400, y: i * 100 }, parameters: { dacNumber: i % 2 } });
            connections.push({ id: `__co${i}`, from: { blockId: '__probe', portId: p.id }, to: { blockId: id, portId: 'in' } });
        });
    return { version: '1.0', metadata: { name: 'probe' }, canvas: { zoom: 1, panX: 0, panY: 0 }, blocks, connections };
}

server.registerTool(
    'create_custom_block',
    {
        title: 'Create a custom ATL block',
        description:
            'Author a new custom `.atl` block on the fly: writes it into the user\'s custom-block ' +
            'directory, registers it so it is immediately usable in list_blocks / get_block_schema / ' +
            'validate_diagram, and runs a probe compile to catch obvious errors. Use this when no ' +
            'existing block does what the user needs. Author against get_atl_reference and mimic a similar ' +
            'block from get_block_source. After creating, wire it into a diagram and validate_diagram to ' +
            'confirm real behavior. Overwrites an existing block of the same file/type (iterate freely).',
        inputSchema: {
            atl: z
                .string()
                .describe('The complete `.atl` file contents: `---` JSON frontmatter `---` then the assembly template.'),
            filename: z
                .string()
                .optional()
                .describe('Base filename (with or without .atl). Defaults to the block type id. Path components are stripped.'),
        },
    },
    async ({ atl, filename }) => {
        const fail = (msg: string) => ({
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: msg }, null, 2) }],
            isError: true,
        });

        if (!ARGS.writeDir) {
            return fail(
                'No writable block directory. Open a folder in VS Code, or set fv1.customBlockPaths, so ' +
                    'authored blocks have somewhere to live.',
            );
        }

        // Parse first so a malformed block never touches disk.
        let def;
        try {
            def = BlockRegistry.parseAtl(atl);
        } catch (err) {
            return fail(`ATL parse error (check the --- frontmatter JSON and delimiters): ${err}`);
        }
        if (!def.type) {
            return fail('ATL frontmatter is missing a "type" field.');
        }

        const base = path.basename(filename || def.type).replace(/[^A-Za-z0-9._-]/g, '_');
        const name = base.endsWith('.atl') ? base : `${base}.atl`;
        const target = path.join(ARGS.writeDir, name);

        try {
            fs.mkdirSync(ARGS.writeDir, { recursive: true });
            fs.writeFileSync(target, atl, 'utf8');
        } catch (err) {
            return fail(`Failed to write ${target}: ${err}`);
        }

        // Reload from disk so the registry reflects the new file (and any it replaced).
        rebuildRegistry();
        const regDef = registry.getBlock(def.type);
        if (!regDef) {
            return fail(`Wrote ${target} but the block failed to register — check the ATL.`);
        }
        const meta = regDef.getMetadata();

        // Probe compile — best effort; the real check is validate_diagram on an actual patch.
        const probe = compiler.compile(buildProbeGraph(meta), {
            progSize: HARDWARE.progSize,
            fv1AsmMemBug: true,
            clampReals: true,
            optimizationLevel: 2,
        });

        const payload = {
            success: true,
            written: target,
            type: def.type,
            registered: true,
            probeCompile: {
                success: probe.success,
                errors: probe.errors ?? [],
                warnings: probe.warnings ?? [],
            },
            metadata: serializeMetadata(meta),
            note:
                'Block written and registered. The probe compile wired an ADC/DAC to each audio port; for ' +
                'a real check, build a diagram using this block and call validate_diagram. If probeCompile ' +
                'failed, fix the ATL and call create_custom_block again (it overwrites).',
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    },
);

// ---------------------------------------------------------------------------
// Managing authored blocks (list / delete)
// ---------------------------------------------------------------------------
interface CustomBlockFile {
    filename: string;
    path: string;
    type?: string;
    name?: string;
    error?: string;
}

/** Scan the write dir for `.atl` files the agent may manage (list / delete). */
function scanCustomBlocks(): CustomBlockFile[] {
    if (!ARGS.writeDir || !fs.existsSync(ARGS.writeDir)) {
        return [];
    }
    const out: CustomBlockFile[] = [];
    for (const entry of fs.readdirSync(ARGS.writeDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.atl')) {
            continue;
        }
        const full = path.join(ARGS.writeDir, entry.name);
        try {
            const def = BlockRegistry.parseAtl(fs.readFileSync(full, 'utf8'));
            out.push({ filename: entry.name, path: full, type: def.type, name: def.name });
        } catch (err) {
            out.push({ filename: entry.name, path: full, error: String(err) });
        }
    }
    return out;
}

server.registerTool(
    'list_custom_blocks',
    {
        title: 'List authored custom blocks',
        description:
            'List the `.atl` blocks living in the writable custom-block directory — the ones ' +
            'create_custom_block writes and delete_custom_block can remove. Built-in blocks are not ' +
            'included (use list_blocks for the full catalog).',
        inputSchema: {},
    },
    async () => {
        const blocks = scanCustomBlocks();
        const payload = {
            writeDir: ARGS.writeDir ?? null,
            count: blocks.length,
            blocks,
            ...(ARGS.writeDir ? {} : { note: 'No writable block directory configured.' }),
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    },
);

server.registerTool(
    'delete_custom_block',
    {
        title: 'Delete an authored custom block',
        description:
            'Remove a custom `.atl` block from the writable directory and unregister it. Identify it by ' +
            'block type id or by filename. Only blocks in the writable dir can be deleted (never ' +
            'built-ins or blocks from other configured paths).',
        inputSchema: {
            type: z.string().optional().describe('Block type id to delete (e.g. "custom.myfuzz").'),
            filename: z.string().optional().describe('Filename to delete (alternative to type).'),
        },
    },
    async ({ type, filename }) => {
        const fail = (msg: string) => ({
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: msg }, null, 2) }],
            isError: true,
        });
        if (!ARGS.writeDir) {
            return fail('No writable block directory configured.');
        }
        if (!type && !filename) {
            return fail('Provide either "type" or "filename".');
        }

        const blocks = scanCustomBlocks();
        const wanted = filename ? path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_') : undefined;
        const match = blocks.find(b =>
            (type && b.type === type) ||
            (wanted && (b.filename === wanted || b.filename === `${wanted}.atl`)),
        );
        if (!match) {
            return fail(
                `No custom block matching ${type ? `type "${type}"` : `filename "${filename}"`}. ` +
                    `Available: ${blocks.map(b => b.type ?? b.filename).join(', ') || '(none)'}.`,
            );
        }

        try {
            fs.rmSync(match.path);
        } catch (err) {
            return fail(`Failed to delete ${match.path}: ${err}`);
        }
        rebuildRegistry();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        { success: true, deleted: match.filename, type: match.type, remaining: scanCustomBlocks() },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

// ---------------------------------------------------------------------------
// Curated example diagrams
// ---------------------------------------------------------------------------
interface Example {
    id: string;
    name: string;
    description: string;
    json: string;
}

/** Load the bundled example `.spndiagram` files (copied to dist/mcp-examples at build time). */
function loadExamples(): Map<string, Example> {
    const dir = path.join(__dirname, 'mcp-examples');
    const map = new Map<string, Example>();
    let files: string[] = [];
    try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.spndiagram'));
    } catch {
        return map;
    }
    for (const f of files.sort()) {
        try {
            const json = fs.readFileSync(path.join(dir, f), 'utf8');
            const g = JSON.parse(json);
            const id = f.replace(/\.spndiagram$/, '');
            map.set(id, { id, name: g.metadata?.name ?? id, description: g.metadata?.description ?? '', json });
        } catch (err) {
            console.error(`[fv1-mcp] failed to load example ${f}:`, err);
        }
    }
    return map;
}
const EXAMPLES = loadExamples();

server.registerTool(
    'get_example',
    {
        title: 'Get a curated example diagram',
        description:
            'Return a complete, compiler-validated `.spndiagram` for a common effect archetype — the ' +
            'fastest way to learn the format and idioms (real block types, port wiring, control/LFO ' +
            'connections, parallel routing). Call with no argument to list the available examples, then ' +
            'again with a name to fetch one. Adapt the returned JSON rather than starting from scratch.',
        inputSchema: {
            name: z.string().optional().describe('Example id to fetch. Omit to list all available examples.'),
        },
    },
    async ({ name }) => {
        const index = [...EXAMPLES.values()].map(e => ({ id: e.id, name: e.name, description: e.description }));
        if (!name) {
            return { content: [{ type: 'text', text: JSON.stringify({ examples: index }, null, 2) }] };
        }
        const ex = EXAMPLES.get(name);
        if (!ex) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ error: `Unknown example "${name}".`, examples: index }, null, 2),
                    },
                ],
                isError: true,
            };
        }
        return { content: [{ type: 'text', text: ex.json }] };
    },
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(
        `[fv1-mcp] ready — ${registry.getAllTypes().length} blocks, ${EXAMPLES.size} examples, ` +
            `budgets ${HARDWARE.progSize} instr / ${HARDWARE.regCount} reg / ${HARDWARE.delaySize} words` +
            (ARGS.writeDir ? `, writing new blocks to ${ARGS.writeDir}` : ', no writable block dir'),
    );
}

main().catch(err => {
    console.error('[fv1-mcp] fatal:', err);
    process.exit(1);
});
