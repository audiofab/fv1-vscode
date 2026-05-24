/**
 * EffectExportService — multi-step wizard for exporting the active
 * .spn / .spndiagram to an easy-spin-effects-shaped JSON file.
 *
 * The output JSON matches the canonical effect descriptor schema used
 * by easy-spin-effects (id, name, version, description, category, tags,
 * author, controls, ...) with one optional extra field:
 *   - `binary`: base64-encoded FV-1 program — present when the user
 *     chose to embed.  When absent, the JSON references a sibling
 *     source file via `file` + `format` (for contribution back to the
 *     effects repo, where the build pipeline compiles it).
 *
 * The Easy Spin LV2 plugin accepts the same JSON for user-uploaded
 * effects (file picker → setState("programFile", path)) when `binary`
 * is present.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { OutputService } from './OutputService.js';
import { AssemblyService } from './AssemblyService.js';
import { FV1Assembler } from '@audiofab-io/fv1-core';
import { getActiveDocumentUri } from '../core/editor-utils.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512;

interface EffectControl {
    pot: number;
    name: string;
    description?: string;
    unit?: string;
    range?: [number, number];
}

interface EffectDescriptor {
    id: string;
    name: string;
    version: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    hasSource: boolean;
    controls: EffectControl[];
    // Embed mode:
    binary?: string;
    // Reference mode:
    file?: string;
    format?: 'spn' | 'spndiagram';
}

// Known easy-spin-effects categories.  "Other…" prompts for a custom
// value; users can pick anything but we steer toward the canonical set
// so existing browsers / filters work.
const KNOWN_CATEGORIES = [
    'Delay',
    'Modulation',
    'Pitch / Chorus',
    'Reverb',
    'Filter',
    'Distortion',
    'Lo-Fi',
    'Utility',
];

export class EffectExportService {
    constructor(
        private outputService: OutputService,
        private assemblyService: AssemblyService,
    ) {}

    /**
     * Entry point — runs the wizard for the active editor document.
     */
    public async exportActiveEffect(): Promise<void> {
        const fileUri = getActiveDocumentUri();
        if (!fileUri) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }
        const sourceFile = fileUri.fsPath;
        const ext = path.extname(sourceFile).toLowerCase();
        if (ext !== '.spn' && ext !== '.spndiagram') {
            vscode.window.showErrorMessage(
                'Active file is not an FV-1 assembly file (.spn) or block diagram (.spndiagram)');
            return;
        }
        const sourceFormat: 'spn' | 'spndiagram' = ext === '.spn' ? 'spn' : 'spndiagram';

        // Compile to a binary up-front — if the source has errors, abort
        // before bothering the user with the wizard.
        this.outputService.log('[INFO] 📄 Preparing effect export…');
        const result = await this.assemblyService.assembleActiveDocument();
        if (!result || result.machineCode.length === 0) {
            vscode.window.showErrorMessage('Cannot export: assembly failed');
            return;
        }
        if (result.problems.some(p => p.isfatal)) {
            vscode.window.showErrorMessage('Cannot export: program has errors');
            return;
        }
        const bytes = FV1Assembler.toUint8Array(result.machineCode);
        const padded = Buffer.alloc(FV1_EEPROM_SLOT_SIZE_BYTES, 0);
        bytes.subarray(0, Math.min(bytes.length, FV1_EEPROM_SLOT_SIZE_BYTES)).forEach((v, i) => {
            padded[i] = v;
        });
        const binaryBase64 = padded.toString('base64');

        // Pre-fill from an existing .json next to the source (round-trip
        // support).  We accept any subset of fields and fall back to
        // sensible defaults for the rest.
        const stem = path.basename(sourceFile, ext);
        const existingJsonPath = path.join(path.dirname(sourceFile), `${stem}.json`);
        const existing = readExistingDescriptor(existingJsonPath);

        // Run the wizard.  Each step returns undefined on cancel (Esc),
        // in which case we abort with no side effects.
        const draft: Partial<EffectDescriptor> = existing ? { ...existing } : {};

        const name = await vscode.window.showInputBox({
            title: 'Export Effect (1/9) — Effect name',
            prompt: 'Human-friendly effect name shown in the plugin UI',
            value: draft.name ?? toTitleCase(stem),
            placeHolder: 'e.g. Plate Reverb',
            validateInput: v => v.trim().length === 0 ? 'Name is required' : undefined,
            ignoreFocusOut: true,
        });
        if (name === undefined) return;

        const id = await vscode.window.showInputBox({
            title: 'Export Effect (2/9) — Effect ID',
            prompt: 'Kebab-case identifier; auto-derived from name. Used as URL slug and filename.',
            value: draft.id ?? toKebabCase(name),
            placeHolder: 'e.g. plate-reverb',
            validateInput: v => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.trim()) ? undefined
                              : 'Lowercase letters, digits, and single hyphens only; no leading/trailing hyphen',
            ignoreFocusOut: true,
        });
        if (id === undefined) return;

        const category = await pickCategory(draft.category);
        if (category === undefined) return;

        const description = await vscode.window.showInputBox({
            title: 'Export Effect (4/9) — Description',
            prompt: 'Brief description of the effect (one or two sentences)',
            value: draft.description ?? '',
            placeHolder: 'e.g. Lush plate reverb with adjustable damping and decay.',
            ignoreFocusOut: true,
        });
        if (description === undefined) return;

        const pots: EffectControl[] = [];
        for (let i = 0; i < 3; i++) {
            const existingPot = draft.controls?.find(c => c.pot === i);
            const label = await vscode.window.showInputBox({
                title: `Export Effect (${5 + i}/9) — Pot ${i} label`,
                prompt: `Label shown next to pot ${i} (e.g. "Decay", "Mix")`,
                value: existingPot?.name ?? `Pot ${i}`,
                placeHolder: `Pot ${i}`,
                validateInput: v => v.trim().length === 0 ? 'Label is required' : undefined,
                ignoreFocusOut: true,
            });
            if (label === undefined) return;
            pots.push({
                pot: i,
                name: label.trim(),
                description: existingPot?.description ?? '',
                unit: existingPot?.unit ?? '',
                range: existingPot?.range ?? [0, 1],
            });
        }

        const author = await vscode.window.showInputBox({
            title: 'Export Effect (8/9) — Author (optional)',
            prompt: 'Effect author / attribution; press Enter to skip',
            value: draft.author ?? (await guessGitAuthor()) ?? '',
            ignoreFocusOut: true,
        });
        if (author === undefined) return;

        const embedMode = await vscode.window.showQuickPick(
            [
                {
                    label: '$(file-zip) Embed binary',
                    description: 'Single self-contained .json file — works as a user upload to the Easy Spin MODDevices plugin',
                    embed: true,
                },
                {
                    label: '$(link) Reference source file',
                    description: 'Smaller .json that points to the .spn / .spndiagram next to it — use for the easy-spin-effects build pipeline',
                    embed: false,
                },
            ],
            {
                title: 'Export Effect (9/9) — Binary embedding',
                placeHolder: 'How should the FV-1 program be carried in the JSON?',
                ignoreFocusOut: true,
            },
        );
        if (!embedMode) return;

        // Build the descriptor.
        const descriptor: EffectDescriptor = {
            id: id.trim(),
            name: name.trim(),
            version: draft.version ?? '1.0.0',
            description: description.trim(),
            category: category,
            tags: draft.tags ?? [],
            author: author.trim(),
            hasSource: !embedMode.embed,
            controls: pots,
        };
        if (embedMode.embed) {
            descriptor.binary = binaryBase64;
        } else {
            descriptor.file = stem;
            descriptor.format = sourceFormat;
        }

        // Choose output location.  Default alongside the source.
        const defaultUri = vscode.Uri.file(
            path.join(path.dirname(sourceFile), `${descriptor.id}.json`)
        );
        const saveUri = await vscode.window.showSaveDialog({
            title: 'Save effect JSON',
            defaultUri,
            filters: { 'Easy Spin Effect': ['json'] },
            saveLabel: 'Export',
        });
        if (!saveUri) return;

        try {
            fs.writeFileSync(saveUri.fsPath, JSON.stringify(descriptor, null, 2) + '\n');
            this.outputService.log(
                `[SUCCESS] ✅ Exported ${embedMode.embed ? 'self-contained' : 'source-referencing'} effect to ${path.basename(saveUri.fsPath)}`);
            // Open the file in an editor so the user can sanity-check.
            const doc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.outputService.log(`[ERROR] ❌ Failed to write effect JSON: ${msg}`);
            vscode.window.showErrorMessage(`Failed to write effect JSON: ${msg}`);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────────────

function readExistingDescriptor(filePath: string): Partial<EffectDescriptor> | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return undefined;
    }
}

function toKebabCase(s: string): string {
    return s
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function toTitleCase(s: string): string {
    return s
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

async function pickCategory(existing?: string): Promise<string | undefined> {
    const CUSTOM_LABEL = 'Other…';
    const items: vscode.QuickPickItem[] = KNOWN_CATEGORIES.map(c => ({
        label: c,
        picked: c === existing,
    }));
    items.push({ label: CUSTOM_LABEL, description: 'Enter a custom category' });

    const picked = await vscode.window.showQuickPick(items, {
        title: 'Export Effect (3/9) — Category',
        placeHolder: 'Pick a category (or "Other…" to type one)',
        ignoreFocusOut: true,
    });
    if (!picked) return undefined;
    if (picked.label !== CUSTOM_LABEL) return picked.label;

    return vscode.window.showInputBox({
        title: 'Export Effect (3/9) — Custom category',
        prompt: 'Enter a category name',
        value: existing && !KNOWN_CATEGORIES.includes(existing) ? existing : '',
        validateInput: v => v.trim().length === 0 ? 'Category cannot be empty' : undefined,
        ignoreFocusOut: true,
    });
}

async function guessGitAuthor(): Promise<string | undefined> {
    return new Promise(resolve => {
        cp.execFile('git', ['config', '--get', 'user.name'], (err, stdout) => {
            if (err || !stdout) { resolve(undefined); return; }
            const name = stdout.trim();
            resolve(name.length > 0 ? name : undefined);
        });
    });
}
