import * as vscode from 'vscode';
import * as path from 'path';
import { compileEffect, FV1Assembler, FV1Disassembler, formatFromFilename } from '@audiofab-io/fv1-core';
import { isBlankSlot, canStorePotLabels, type PatchLabels } from '@audiofab-io/fv1-core/pedal';
import {
    parseSpnBankJson,
    serializeSpnBankJson,
    createEmptyBank,
    PROGRAM_SLOT_COUNT,
    type SpnBankFile,
    type SpnBankSlot,
} from '@audiofab-io/fv1-core/spnbank';
import { derivePotAssignments, blockRegistry } from '@audiofab-io/fv1-core/blockDiagram';
import type { BlockDiagramDocumentManager } from '../../blockDiagram/BlockDiagramDocumentManager.js';

/**
 * Webview-view host for the pedal-shaped real-time simulator.
 *
 * Tracking model
 * ──────────────
 * The simulator always plays whichever URI is the most recent of:
 *   - the active editor (on a tab change to a .spn / .spndiagram /
 *     fv1-assembly virtual document), OR
 *   - a slot click in the loaded bank (which loads that slot's program).
 *
 * Last update wins. The bank does NOT pin the simulator — switching the
 * active editor away from a bank file will move the simulator with it.
 * Re-clicking a slot reloads it.
 *
 * The "selected slot" shown in the program-selector knob and in the
 * tracking header is computed from `trackedUri` — whichever bank slot
 * (if any) currently resolves to the same file. So the visual selection
 * naturally follows whatever's actually playing.
 *
 * Bank ↔ file
 * ───────────
 * `.spnbank` files are read/written via `fv1-core/spnbank`. Slot paths
 * are stored relative to the bank file's directory. Saving an in-memory
 * (never-saved) bank prompts for a location and re-relativises any
 * absolute paths against the chosen directory.
 */
export class PedalSimulatorView implements vscode.WebviewViewProvider {
    public static readonly viewType = 'fv1.pedalSimulator';

    private view: vscode.WebviewView | undefined;

    private readonly clipDir: string;
    private clipList: ClipInfo[] | null = null;

    /** Most recent FV-1 file that became the active editor — used by the
     *  "+" button on empty slots and as the simulator's default source
     *  before any slot is clicked. Persists across non-FV-1 tab switches. */
    private activeEditorUri: vscode.Uri | undefined;

    /** What the simulator is currently playing. Updated on active-editor
     *  changes AND on slot clicks. */
    private trackedUri: vscode.Uri | undefined;

    /** Bank state. `bankUri` is undefined for in-memory banks (created
     *  by the "+" button before saving, or by clicking New Bank then
     *  cancelling the save dialog). `bankDirty` flips on any slot edit
     *  and clears on save. */
    private bankUri: vscode.Uri | undefined;
    private bank: SpnBankFile | undefined;
    private bankDirty: boolean = false;

    /** Pending recompile timer for .spn doc-change debouncing. */
    private docChangeTimer: NodeJS.Timeout | undefined;

    /** Pedal-writing state — flips during requestProgramBank /
     *  requestProgramSlot so the webview can show a busy spinner on the
     *  appropriate button. */
    private pedalWriting: boolean = false;
    /** True while the pedal is being read back into the bank. */
    private pedalReading: boolean = false;
    private programmingSlot: number | null = null;

    /** Watches the loaded bank's file on disk so external edits (e.g. the
     *  user opening it as JSON, adding control labels, saving) trigger a
     *  reload of the bank state in the UI. */
    private bankFileWatcher: vscode.FileSystemWatcher | undefined;
    /** Set briefly during our own writes to the bank file so the watcher
     *  doesn't trigger a redundant reload echo. */
    private suppressNextWatcherEvent: boolean = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly blockDiagramDocMgr: BlockDiagramDocumentManager,
        private readonly programmerService: import('../../services/ProgrammerService.js').ProgrammerService,
        private readonly intelHexService: import('../../services/IntelHexService.js').IntelHexService,
        private readonly outputService: import('../../services/OutputService.js').OutputService,
    ) {
        this.clipDir = path.join(context.extensionPath, 'dist', 'simulator', 'wav');
        this.activeEditorUri = activeFv1TabUri();
        this.trackedUri = this.activeEditorUri;

        // Active-tab tracking — always update activeEditorUri and trackedUri.
        // Bank slot selection is purely visual (computed from trackedUri at
        // serialize-for-webview time).
        const onTabChange = () => {
            // Opening a .spnbank in any editor also loads it here, so the user
            // never has to Load… and browse for a file they just opened.
            const bankUri = activeBankTabUri();
            if (bankUri) void this.openBank(bankUri);

            const uri = activeFv1TabUri();
            if (!uri) return;
            if (this.activeEditorUri?.toString() === uri.toString()) return;
            this.activeEditorUri = uri;
            this.trackedUri = uri;
            void this.sendBankState();      // selected-slot indicator may change
            void this.sendProgramUpdate();
        };
        context.subscriptions.push(
            vscode.window.tabGroups.onDidChangeTabs(onTabChange),
            vscode.window.tabGroups.onDidChangeTabGroups(onTabChange),
        );

        // .spn doc changes (debounced 150 ms). .spndiagram changes flow
        // through BlockDiagramDocumentManager.onCompilationChange instead.
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (!this.trackedUri) return;
                if (e.document.uri.toString() !== this.trackedUri.toString()) return;
                if (path.extname(e.document.uri.fsPath).toLowerCase() === '.spndiagram') return;
                if (this.docChangeTimer) clearTimeout(this.docChangeTimer);
                this.docChangeTimer = setTimeout(() => {
                    void this.sendProgramUpdate();
                }, 150);
            }),
        );

        context.subscriptions.push(
            blockDiagramDocMgr.onCompilationChange(uri => {
                if (this.trackedUri?.toString() !== uri.toString()) return;
                void this.sendProgramUpdate();
                // Re-wiring a POT changes its label, so refresh the graphic too.
                void this.sendBankState();
            }),
        );
    }

    public resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
            ],
        };
        view.webview.html = this.renderHtml(view.webview);
        view.webview.onDidReceiveMessage(msg => { void this.handleMessage(msg); });

        view.onDidDispose(() => {
            if (this.view === view) this.view = undefined;
        });
    }

    // ── URI helpers ─────────────────────────────────────────────────────

    private resolveSlotUri(slot: SpnBankSlot): vscode.Uri | undefined {
        if (!slot.path) return undefined;
        if (path.isAbsolute(slot.path)) return vscode.Uri.file(slot.path);
        if (!this.bankUri) {
            // In-memory bank with a relative path is impossible in practice
            // (we always store absolute when bankUri is undefined), but be
            // defensive.
            return undefined;
        }
        const bankDir = path.dirname(this.bankUri.fsPath);
        return vscode.Uri.file(path.resolve(bankDir, slot.path));
    }

    /** Convert a file URI into the form we want stored in the bank. When
     *  the bank has no on-disk location yet we keep absolute paths; they're
     *  re-relativised on Save As. */
    private storableSlotPath(fileUri: vscode.Uri): string {
        if (!this.bankUri) return fileUri.fsPath;
        const bankDir = path.dirname(this.bankUri.fsPath);
        const rel = path.relative(bankDir, fileUri.fsPath);
        return rel.split(path.sep).join('/');
    }

    /** 0-based index of the slot whose path resolves to the same URI we're
     *  currently tracking, or null if there's no match (or no bank). */
    private matchingSlotIndex(): number | null {
        if (!this.bank || !this.trackedUri) return null;
        const tracked = this.trackedUri.toString();
        for (let i = 0; i < this.bank.slots.length; i++) {
            const slot = this.bank.slots[i];
            const uri = this.resolveSlotUri(slot);
            if (uri && uri.toString() === tracked) return i;
        }
        return null;
    }

    // ── Webview message dispatch ────────────────────────────────────────

    private async handleMessage(msg: WebviewMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':                 await this.sendInit(); return;
            case 'requestClip':           await this.sendClipBytes(msg.id); return;
            case 'requestLoadBank':       await this.loadBankFromDialog(); return;
            case 'requestOpenBank':       await this.openDroppedBank(msg.uri); return;
            case 'requestSaveBank':       await this.saveBank(); return;
            case 'requestSaveAsBank':     await this.saveBankAs(); return;
            case 'requestCloseBank':      await this.closeBank(); return;
            case 'requestOpenBankFile':   await this.openBankFile(); return;
            case 'requestOpenSlotFile':   await this.openSlotFile(msg.slotIndex); return;
            case 'selectSlot':            await this.selectSlot(msg.slotIndex); return;
            case 'assignSlot':            await this.assignSlot(msg.slotIndex, msg.uri); return;
            case 'assignTrackedToSlot':   await this.assignTrackedToSlot(msg.slotIndex); return;
            case 'unassignSlot':          await this.unassignSlot(msg.slotIndex); return;
            case 'requestProgramBank':    await this.programBankToPedal(); return;
            case 'requestExportBankHex':  await this.exportBankHex(); return;
            case 'requestReadPedal':      await this.readPedalIntoBank(); return;
            case 'requestProgramSlot':    await this.programSlotToPedal(msg.slotIndex); return;
        }
    }

    // ── Bank operations ─────────────────────────────────────────────────

    private async confirmDiscardIfDirty(): Promise<boolean> {
        if (!this.bankDirty) return true;
        const choice = await vscode.window.showWarningMessage(
            'The current bank has unsaved changes. Discard them?',
            { modal: true },
            'Discard',
        );
        return choice === 'Discard';
    }

    /**
     * Open a .spnbank without going through the Load dialog — used by the
     * explorer command, by opening the file in an editor, and by dropping one
     * onto the simulator. Guards unsaved changes exactly as Load… does.
     */
    public async openBank(uri: vscode.Uri): Promise<void> {
        if (this.bankUri?.toString() === uri.toString()) return;   // already open
        if (!await this.confirmDiscardIfDirty()) return;
        await this.loadBank(uri);
    }

    private async loadBankFromDialog(): Promise<void> {
        if (!await this.confirmDiscardIfDirty()) return;
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: { 'Easy Spin Bank': ['spnbank'] },
        });
        if (!uris || uris.length === 0) return;
        await this.loadBank(uris[0]);
    }

    private async loadBank(uri: vscode.Uri): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf-8');
            const fallbackName = path.basename(uri.fsPath, '.spnbank');
            this.bank = parseSpnBankJson(text, fallbackName);
            this.bankUri = uri;
            this.bankDirty = false;
            this.attachBankFileWatcher(uri);
            // If the bank has any non-empty slot, switch the simulator to
            // its first one so the user immediately hears something.
            const firstNonEmpty = this.bank.slots.findIndex(s => s.path);
            if (firstNonEmpty >= 0) {
                const slotUri = this.resolveSlotUri(this.bank.slots[firstNonEmpty]);
                if (slotUri) this.trackedUri = slotUri;
            }
            await this.sendBankState();
            await this.sendProgramUpdate();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Failed to load bank: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Reload the loaded bank's state from disk without changing the
     * tracked URI or simulator state. Triggered by the file-system watcher
     * when the user (or another tool) saves the .spnbank externally.
     */
    private async reloadBankFromDisk(): Promise<void> {
        if (!this.bankUri) return;
        try {
            const bytes = await vscode.workspace.fs.readFile(this.bankUri);
            const text = Buffer.from(bytes).toString('utf-8');
            const fallbackName = path.basename(this.bankUri.fsPath, '.spnbank');
            this.bank = parseSpnBankJson(text, fallbackName);
            this.bankDirty = false;
            await this.sendBankState();
            // Pot labels may have changed (the user might have just added
            // controls) so re-emit the program too — the label payload
            // includes Slot N: prefix derived from bank state.
            await this.sendProgramUpdate();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Bank file changed but could not be reloaded: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Replace the active bank-file watcher with one that targets `uri`.
     * Disposes any previous watcher.
     */
    private attachBankFileWatcher(uri: vscode.Uri): void {
        this.bankFileWatcher?.dispose();
        const pattern = new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(uri.fsPath)),
            path.basename(uri.fsPath),
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const onChange = () => {
            // Skip the immediate echo from our own saves.
            if (this.suppressNextWatcherEvent) {
                this.suppressNextWatcherEvent = false;
                return;
            }
            void this.reloadBankFromDisk();
        };
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        // We don't auto-handle delete — leave the bank in memory so the
        // user can decide what to do (Save As to recreate, or Close).
        this.bankFileWatcher = watcher;
        this.context.subscriptions.push(watcher);
    }

    private detachBankFileWatcher(): void {
        this.bankFileWatcher?.dispose();
        this.bankFileWatcher = undefined;
    }

    private async saveBank(): Promise<void> {
        if (!this.bank) return;
        if (!this.bankUri) {
            await this.saveBankAs();
            return;
        }
        try {
            const text = serializeSpnBankJson(this.bank);
            this.suppressNextWatcherEvent = true;
            await vscode.workspace.fs.writeFile(this.bankUri, Buffer.from(text, 'utf8'));
            this.bankDirty = false;
            await this.sendBankState();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Failed to save bank: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private async saveBankAs(): Promise<void> {
        if (!this.bank) {
            this.bank = createEmptyBank();
        }
        const defaultUri = this.bankUri
            ?? (vscode.workspace.workspaceFolders?.[0]
                ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'new.spnbank')
                : undefined);
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'Easy Spin Bank': ['spnbank'] },
        });
        if (!saveUri) return;
        try {
            // Re-relativise slot paths against the new bank directory.
            // For in-memory banks (bankUri undefined) this converts absolute
            // paths to relative; for previously-saved banks moved to a new
            // dir, this keeps the slot references correct.
            const newDir = path.dirname(saveUri.fsPath);
            const oldDir = this.bankUri ? path.dirname(this.bankUri.fsPath) : undefined;
            for (const slot of this.bank.slots) {
                if (!slot.path) continue;
                let abs: string;
                if (path.isAbsolute(slot.path)) {
                    abs = slot.path;
                } else if (oldDir) {
                    abs = path.resolve(oldDir, slot.path);
                } else {
                    continue;
                }
                slot.path = path.relative(newDir, abs).split(path.sep).join('/');
            }
            const text = serializeSpnBankJson(this.bank);
            this.suppressNextWatcherEvent = true;
            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(text, 'utf8'));
            this.bankUri = saveUri;
            this.bankDirty = false;
            this.attachBankFileWatcher(saveUri);
            await this.sendBankState();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Failed to save bank: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private async closeBank(): Promise<void> {
        if (!await this.confirmDiscardIfDirty()) return;
        this.detachBankFileWatcher();
        this.bank = undefined;
        this.bankUri = undefined;
        this.bankDirty = false;
        // Fall back to active-editor tracking now that the bank is gone.
        this.trackedUri = this.activeEditorUri;
        await this.sendBankState();
        await this.sendProgramUpdate();
    }

    private async openBankFile(): Promise<void> {
        if (!this.bankUri) return;
        await vscode.commands.executeCommand('vscode.open', this.bankUri);
    }

    private async openSlotFile(index: number): Promise<void> {
        if (!this.bank) return;
        if (index < 0 || index >= PROGRAM_SLOT_COUNT) return;
        const slot = this.bank.slots[index];
        const uri = this.resolveSlotUri(slot);
        if (!uri) return;
        const ext = path.extname(uri.fsPath).toLowerCase();
        try {
            if (ext === '.spndiagram') {
                // Use the dedicated diagram editor so the user sees the
                // visual graph rather than raw JSON.
                await vscode.commands.executeCommand(
                    'vscode.openWith', uri, 'fv1.blockDiagramEditor',
                );
            } else {
                await vscode.commands.executeCommand('vscode.open', uri);
            }
        } catch (err) {
            vscode.window.showErrorMessage(
                `Failed to open ${path.basename(uri.fsPath)}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    // ── Slot operations ─────────────────────────────────────────────────

    private async selectSlot(index: number): Promise<void> {
        if (!this.bank) return;
        if (index < 0 || index >= PROGRAM_SLOT_COUNT) return;
        const slot = this.bank.slots[index];
        if (!slot.path) return; // empty slot — no-op
        const slotUri = this.resolveSlotUri(slot);
        if (!slotUri) return;
        this.trackedUri = slotUri;
        await this.sendBankState();
        await this.sendProgramUpdate();
    }

    /** Resolve a dropped URI/path and open it as a bank. */
    private async openDroppedBank(payload: string): Promise<void> {
        const uri = resolveDroppedUri(payload);
        if (!uri) return;
        await this.openBank(uri);
    }

    private async assignSlot(index: number, payload: string): Promise<void> {
        if (index < 0 || index >= PROGRAM_SLOT_COUNT) return;

        // A .spnbank dropped onto a slot means "open this bank", not "assign a
        // bank file as a program" — which would produce a slot that cannot
        // compile.
        const dropped = resolveDroppedUri(payload);
        if (dropped && path.extname(dropped.fsPath).toLowerCase() === '.spnbank') {
            await this.openBank(dropped);
            return;
        }

        // Auto-create an in-memory bank if there isn't one yet so the user
        // can build a bank by dropping files / clicking + on slots without
        // first having to click "New Bank".
        if (!this.bank) {
            this.bank = createEmptyBank();
            this.bankUri = undefined;
        }

        let fileUri: vscode.Uri;
        try {
            fileUri = payload.includes('://')
                ? vscode.Uri.parse(payload)
                : vscode.Uri.file(payload);
        } catch {
            return;
        }
        const ext = path.extname(fileUri.fsPath).toLowerCase();
        if (ext !== '.spn' && ext !== '.spndiagram') {
            vscode.window.showWarningMessage(
                `Slots accept .spn or .spndiagram files only. Got: ${path.basename(fileUri.fsPath)}`,
            );
            return;
        }

        const slot = this.bank.slots[index];
        slot.path = this.storableSlotPath(fileUri);
        delete slot.name;
        delete slot.description;
        delete slot.controls;
        this.bankDirty = true;
        // Switch the simulator to the freshly-assigned slot.
        this.trackedUri = fileUri;
        await this.sendBankState();
        await this.sendProgramUpdate();
    }

    private async assignTrackedToSlot(index: number): Promise<void> {
        if (!this.activeEditorUri) {
            vscode.window.showInformationMessage(
                'No FV-1 file open to assign — switch to a .spn / .spndiagram tab first.',
            );
            return;
        }
        await this.assignSlot(index, this.activeEditorUri.toString());
    }

    // ── Hardware programming ────────────────────────────────────────────

    /**
     * Ensure the bank is saved to a real file (callers like
     * `programBankToPedal` need a `.spnbank` URI on disk because the
     * existing ProgrammerService routines read the bank from there).
     * Returns true if the bank is ready to program, false otherwise.
     */
    private async ensureBankSaved(): Promise<boolean> {
        if (!this.bank) {
            vscode.window.showWarningMessage('No bank loaded.');
            return false;
        }
        if (!this.bankUri) {
            const choice = await vscode.window.showInformationMessage(
                'Save the bank to disk before programming the pedal.',
                'Save As…',
            );
            if (choice !== 'Save As…') return false;
            await this.saveBankAs();
            if (!this.bankUri) return false; // user cancelled the save dialog
        } else if (this.bankDirty) {
            await this.saveBank();
            if (this.bankDirty) return false; // save failed
        }
        return true;
    }

    /**
     * Assemble every assigned slot of the *in-memory* bank.
     *
     * Shared by "program bank to pedal" and "export bank to .hex" so the two
     * can never disagree about what the bank contains. Unassigned slots are
     * simply absent from `slots` — callers treat that as sparse. Anything that
     * should have produced code but didn't (missing file, failed compile) is
     * reported separately, because that is an error rather than an empty slot.
     */
    private async assembleBank(): Promise<{
        slots: Array<{ index: number; uri: vscode.Uri; machineCode: number[] }>;
        broken: Array<{ index: number; reason: string }>;
    } | undefined> {
        if (!this.bank) {
            vscode.window.showWarningMessage('No bank loaded.');
            return undefined;
        }

        // Assemble from what's on disk, so save any dirty sources first.
        const dirtyDocs = vscode.workspace.textDocuments.filter(doc =>
            doc.isDirty && (doc.fileName.endsWith('.spn') || doc.fileName.endsWith('.spndiagram'))
        );
        for (const doc of dirtyDocs) {
            if (!await doc.save()) {
                vscode.window.showErrorMessage(`Failed to save ${path.basename(doc.fileName)}. Aborted.`);
                return undefined;
            }
        }

        const slots: Array<{ index: number; uri: vscode.Uri; machineCode: number[] }> = [];
        const broken: Array<{ index: number; reason: string }> = [];

        for (let index = 0; index < PROGRAM_SLOT_COUNT; index++) {
            const slot = this.bank.slots[index];
            if (!slot?.path) continue; // unassigned — sparse, not an error

            const uri = this.resolveSlotUri(slot);
            if (!uri) {
                broken.push({ index, reason: `path could not be resolved (${slot.path})` });
                continue;
            }

            const machineCode = await this.assembleForProgramming(uri);
            if (!machineCode || machineCode.length === 0) {
                broken.push({ index, reason: `${path.basename(uri.fsPath)} failed to compile` });
                continue;
            }

            slots.push({ index, uri, machineCode });
        }

        return { slots, broken };
    }

    /**
     * Work out the program / pot labels for a slot, for the stereo pedal's
     * display. Precedence, best source first:
     *
     *  1. The bank's own `controls` for that slot — the only place that carries
     *     real pot names, and editable by hand in the .spnbank JSON.
     *  2. A `.spndiagram`'s graph, which tells us *which* pots the program uses
     *     but not what to call them: unused pots become blank, used ones
     *     "Unknown". The diagram's metadata name is used for the program name.
     *  3. Anything else (.spn) — name only; the pots are unknowable.
     *
     * Returns the labels plus whether any pot name had to be guessed, so the
     * caller can point the user at the bank JSON once rather than per slot.
     */
    private async labelsForSlot(
        index: number,
        uri: vscode.Uri,
    ): Promise<{ labels: PatchLabels, potsUnknown: boolean }> {
        const slot = this.bank?.slots[index];
        const isDiagram = path.extname(uri.fsPath).toLowerCase() === '.spndiagram';

        // Layer 1 (weakest): the file itself. A diagram's graph names what each
        // pot drives — the same derivation behind the "Potentiometer
        // Assignments" header in generated assembly — and a pot it never wires
        // is known unused (null). A .spn tells us nothing (undefined).
        let pots: (string | null | undefined)[] = [undefined, undefined, undefined];

        if (isDiagram) {
            try {
                // Prefer the open editor's text: a diagram being edited is
                // usually dirty, and the point is to track it live.
                const open = vscode.workspace.textDocuments.find(
                    d => d.uri.toString() === uri.toString());
                const text = open
                    ? open.getText()
                    : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
                const diagram = JSON.parse(text);
                const assignments = derivePotAssignments(diagram, blockRegistry);
                pots = [0, 1, 2].map(pot => assignments.find(a => a.pot === pot)?.label ?? null);
            } catch {
                // Unreadable or malformed — fall back to knowing nothing.
            }
        }

        // Layer 2 (strongest): explicit bank controls. Only *named* ones count.
        // Saved banks now carry a full three-pot skeleton with empty names, and
        // treating those as real would override the diagram with blanks.
        for (const pot of [0, 1, 2] as const) {
            const name = slot?.controls?.find(c => c.pot === pot)?.name?.trim();
            if (name) pots[pot] = name;
        }

        // The filename beats the diagram's own `metadata.name`, deliberately.
        // That field is stamped once when the diagram is created and never
        // updated afterwards, so copying a diagram to start a new effect — the
        // normal way people work — leaves it naming the file it came from. Seen
        // in the wild: midiverb_flanger.spndiagram carrying "multi_tap", which
        // is what the pedal then displayed. The filename is the name the user
        // actually sees and controls, so it wins; an explicit bank slot name
        // still overrides both.
        const name = slot?.name?.trim()
            || path.basename(uri.fsPath, path.extname(uri.fsPath));

        return { labels: { name, pots }, potsUnknown: pots.some(p => p === undefined) };
    }

    /**
     * Report slots that failed to assemble. Both the program and export paths
     * abort on these rather than quietly emitting a partial bank.
     */
    private reportBrokenSlots(broken: Array<{ index: number; reason: string }>, action: string): void {
        for (const { index, reason } of broken) {
            this.outputService.log(`[ERROR] ❌ Slot ${index + 1}: ${reason}`);
        }
        const list = broken.map(b => b.index + 1).join(', ');
        vscode.window.showErrorMessage(
            `${action} aborted: slot${broken.length > 1 ? 's' : ''} ${list} failed to assemble. See Output for details.`,
        );
    }

    private async programBankToPedal(): Promise<void> {
        if (this.pedalWriting || this.programmingSlot !== null) return;
        if (!await this.ensureBankSaved()) return;

        const assembled = await this.assembleBank();
        if (!assembled) return;
        if (assembled.broken.length > 0) {
            this.reportBrokenSlots(assembled.broken, 'Programming');
            return;
        }
        if (assembled.slots.length === 0) {
            vscode.window.showWarningMessage('No programs to write: the bank has no assigned slots.');
            return;
        }

        this.pedalWriting = true;
        await this.sendBankState();
        try {
            // One call, so the whole bank is written under a single connection
            // and a single bus-lock hold. Programming slot-by-slot released the
            // stereo pedal's lockout between slots, which made its MCU reload
            // from EEPROM and contend with the very next write.
            const stereo = canStorePotLabels(this.programmerService.pedalIdentity);
            const unlabelled: number[] = [];
            const payload = [];
            for (const slot of assembled.slots) {
                const { labels, potsUnknown } = await this.labelsForSlot(slot.index, slot.uri);
                if (potsUnknown) unlabelled.push(slot.index + 1);
                payload.push({
                    index: slot.index,
                    machineCode: slot.machineCode,
                    label: path.basename(slot.uri.fsPath),
                    labels,
                });
            }

            const ok = await this.programmerService.programSlots(payload);
            if (ok) this.outputService.log(`[SUCCESS] ✅ Programming phase completed.`);

            // Only nag when the pedal can actually show labels, and only once
            // per run rather than per slot.
            if (ok && stereo && unlabelled.length > 0) {
                this.outputService.log(
                    `[INFO] 📝 Pot labels are unknown for slot(s) ${unlabelled.join(', ')} and were written as ` +
                    `"Unknown". Add a "controls" array to those slots in the .spnbank file to set them.`);
            }
        } finally {
            this.pedalWriting = false;
            await this.sendBankState();
        }
    }

    /**
     * Read the pedal's EEPROM and rebuild the bank from what's on it.
     *
     * Each non-blank slot is disassembled to a `.spn` beside the bank and
     * assigned to that slot, so everything downstream — simulate, edit,
     * re-assemble, re-program — works exactly as it does for hand-written
     * programs. Blank slots (all 0xFF) are left unassigned rather than filled
     * with a stub, matching the sparse treatment used for HEX export.
     *
     * What comes back is functional, not the original source: comments, symbol
     * names and block-diagram structure are not in the machine code and cannot
     * be recovered.
     */
    private async readPedalIntoBank(): Promise<void> {
        if (this.pedalWriting || this.programmingSlot !== null || this.pedalReading) return;

        if (this.bank && this.bankDirty) {
            const choice = await vscode.window.showWarningMessage(
                'Replace the current bank with what is on the pedal?',
                {
                    modal: true,
                    detail: 'The bank has unsaved changes. Reading the pedal reassigns every slot, '
                        + 'and those changes will be lost.'
                },
                'Read Pedal',
            );
            if (choice !== 'Read Pedal') {
                this.outputService.log(`[WARNING] ⚠ Pedal read cancelled by user`);
                return;
            }
        }

        // Work out where the generated .spn files go before touching hardware,
        // so we don't read the pedal and then discover we have nowhere to put it.
        const targetDir = await this.resolveReadTargetDir();
        if (!targetDir) return;

        this.pedalReading = true;
        await this.sendBankState();
        try {
            const result = await this.programmerService.readAllSlotsFromPedal();
            if (!result) return;

            if (!this.bank) this.bank = createEmptyBank();

            const written: number[] = [];
            const blank: number[] = [];
            const undecodable: number[] = [];
            const usedFileNames = new Set<string>();

            for (let index = 0; index < PROGRAM_SLOT_COUNT; index++) {
                const binary = result.slots[index];
                const slot = this.bank.slots[index];
                const labels = result.labels?.[index];

                if (!binary || isBlankSlot(binary)) {
                    blank.push(index + 1);
                    slot.path = '';
                    delete slot.name;
                    delete slot.description;
                    delete slot.controls;
                    continue;
                }

                const disassembly = FV1Disassembler.fromBinary(binary);
                if (!disassembly.complete) undecodable.push(index + 1);

                // The pedal's own program name becomes the filename, so a read
                // produces `lush-chorus.spn` rather than an anonymous slot-3.
                const programName = meaningfulLabel(labels?.name);
                const stem = uniqueFileName(
                    toFileStem(programName) || `slot-${index + 1}`, usedFileNames);
                const fileUri = vscode.Uri.file(path.join(targetDir, `${stem}.spn`));

                const potNames = ([0, 1, 2] as const).map(pot => meaningfulLabel(labels?.pots?.[pot]));
                const potComment = labels
                    ? `; Pots: ${potNames.map((n, i) => `${i}=${n ?? '(unused)'}`).join('  ')}\n`
                    : '';

                const header =
                    `; ${programName ?? `Slot ${index + 1}`}\n` +
                    `; Read from ${result.identity?.label ?? 'pedal'} slot ${index + 1} on ${new Date().toISOString().split('T')[0]}.\n` +
                    potComment +
                    `; Disassembled from EEPROM — comments, symbol names and block-diagram\n` +
                    `; structure are not stored on the pedal and cannot be recovered.\n` +
                    (disassembly.complete ? '' : `; WARNING: some words did not decode to known instructions.\n`) +
                    `\n`;

                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(header + disassembly.source, 'utf8'));

                slot.path = this.storableSlotPath(fileUri);
                slot.name = programName ?? `Slot ${index + 1} (from pedal)`;
                delete slot.description;

                // Pot labels go straight into the bank's own `controls` — where
                // the graphic, the hand-editable JSON and the write-back all
                // already look. No separate store, no dummy file.
                slot.controls = ([0, 1, 2] as const).map(pot => ({ pot, name: potNames[pot] ?? '' }));
                written.push(index + 1);
            }

            this.bankDirty = true;
            await this.sendBankState();

            // Select the first slot we read. Pot labels are shown for the
            // *selected* slot, and a fresh read leaves nothing selected — so
            // without this the graphic sits on "Pot 0/1/2" until the user
            // happens to click a slot. Selecting also starts the simulator on
            // it, which is the natural place to be after pulling a pedal in.
            if (written.length > 0) {
                await this.selectSlot(written[0] - 1);
            }

            this.outputService.log(
                `[SUCCESS] ✅ Rebuilt the bank from the pedal: ` +
                `${written.length} program(s) written to ${targetDir}` +
                (blank.length > 0 ? `, slot(s) ${blank.join(', ')} were blank and left unassigned` : ''),
            );
            if (undecodable.length > 0) {
                this.outputService.log(
                    `[WARNING] ⚠ Slot(s) ${undecodable.join(', ')} contain words that are not valid FV-1 ` +
                    `instructions; those lines are commented out in the generated .spn.`,
                );
            }
            vscode.window.showInformationMessage(
                `Read ${written.length} program(s) from the pedal.` +
                (blank.length > 0 ? ` ${blank.length} slot(s) were blank.` : ''),
            );
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error reading the pedal into the bank: ${error}`);
            vscode.window.showErrorMessage(`Error reading the pedal: ${error}`);
        } finally {
            this.pedalReading = false;
            await this.sendBankState();
        }
    }

    /**
     * Where disassembled programs get written. Beside a saved bank, otherwise
     * ask — a read has to put eight files somewhere, and silently choosing a
     * directory for the user is worse than one dialog.
     */
    private async resolveReadTargetDir(): Promise<string | undefined> {
        if (this.bankUri) {
            const dir = path.join(path.dirname(this.bankUri.fsPath), `${path.basename(this.bankUri.fsPath, '.spnbank')}-from-pedal`);
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
            return dir;
        }

        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            openLabel: 'Save programs here',
            title: 'Where should the programs read from the pedal be saved?',
        });
        return picked?.[0]?.fsPath;
    }

    /**
     * Export the bank being edited as a multi-segment Intel HEX file. Works on
     * an unsaved, in-memory bank — unlike programming, nothing here needs the
     * .spnbank to exist on disk.
     */
    private async exportBankHex(): Promise<void> {
        const assembled = await this.assembleBank();
        if (!assembled) return;
        if (assembled.broken.length > 0) {
            this.reportBrokenSlots(assembled.broken, 'Export');
            return;
        }

        const assigned = assembled.slots.map(s => s.index + 1);
        const skipped = Array.from({ length: PROGRAM_SLOT_COUNT }, (_, i) => i + 1)
            .filter(n => !assigned.includes(n));
        if (skipped.length > 0) {
            this.outputService.log(
                `[INFO] 📄 Slots ${skipped.join(', ')} are unassigned and will be left out of the .hex ` +
                `(flashing it will leave those slots on the pedal untouched).`,
            );
        }

        const bankName = this.bankUri
            ? path.basename(this.bankUri.fsPath, '.spnbank')
            : (this.bank?.name || 'bank');
        const directory = this.bankUri ? path.dirname(this.bankUri.fsPath) : undefined;

        await this.intelHexService.exportSlotsToHex(assembled.slots, `${bankName}.hex`, directory);
    }

    private async programSlotToPedal(index: number): Promise<void> {
        if (this.pedalWriting || this.programmingSlot !== null) return;
        if (!this.bank) return;
        if (index < 0 || index >= PROGRAM_SLOT_COUNT) return;
        const slot = this.bank.slots[index];
        if (!slot.path) return;
        const slotUri = this.resolveSlotUri(slot);
        if (!slotUri) {
            vscode.window.showErrorMessage(`Slot ${index + 1} path could not be resolved.`);
            return;
        }

        this.programmingSlot = index;
        await this.sendBankState();
        try {
            // Single-slot programming bypasses the bank-on-disk requirement
            // entirely — we just need the slot's source file to exist. We
            // assemble it ourselves and hand the machine code straight to
            // ProgrammerService.programEeprom with a forced slot index.
            const machineCode = await this.assembleForProgramming(slotUri);
            if (!machineCode) {
                vscode.window.showErrorMessage(
                    `Failed to compile slot ${index + 1} (${path.basename(slotUri.fsPath)}). See Output for details.`,
                );
                return;
            }
            const { labels } = await this.labelsForSlot(index, slotUri);
            await this.programmerService.programSlots([{
                index,
                machineCode,
                label: path.basename(slotUri.fsPath),
                labels,
            }]);
        } finally {
            this.programmingSlot = null;
            await this.sendBankState();
        }
    }

    /**
     * Assemble a .spn or .spndiagram into FV-1 machine code (number[] of
     * 32-bit instruction words) using the user's spinAsmMemBug / clampReals
     * config. Returns null if compilation produces fatal errors. For
     * .spndiagram we go through BlockDiagramDocumentManager so the binary
     * exactly matches what "View Assembly" produces.
     */
    private async assembleForProgramming(uri: vscode.Uri): Promise<number[] | null> {
        const config = vscode.workspace.getConfiguration('fv1');
        const opts = {
            fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
            clampReals: config.get<boolean>('clampReals') ?? true,
        };

        const ext = path.extname(uri.fsPath).toLowerCase();
        let assemblySource: string;

        if (ext === '.spndiagram') {
            const document = await vscode.workspace.openTextDocument(uri);
            const result = this.blockDiagramDocMgr.getCompilationResult(document);
            if (!result.success || !result.assembly) return null;
            assemblySource = result.assembly;
        } else {
            const doc = await vscode.workspace.openTextDocument(uri);
            assemblySource = doc.getText();
        }

        const assembler = new FV1Assembler(opts);
        const asmResult = assembler.assemble(assemblySource);
        if (asmResult.problems.some(p => p.isfatal)) return null;
        return asmResult.machineCode;
    }

    private async unassignSlot(index: number): Promise<void> {
        if (!this.bank) return;
        if (index < 0 || index >= PROGRAM_SLOT_COUNT) return;
        const slot = this.bank.slots[index];
        if (!slot.path && !slot.name && !slot.description && !slot.controls) return;
        slot.path = '';
        delete slot.name;
        delete slot.description;
        delete slot.controls;
        this.bankDirty = true;
        // If we just unassigned the slot the simulator was playing, jump
        // back to active-editor tracking.
        if (this.matchingSlotIndex() === null) {
            // We unassigned the matching slot — now resolveSlotUri returns
            // undefined for it, and matchingSlotIndex returns null. trackedUri
            // is now stale; fall back to whichever slot has a path, or the
            // active editor.
            const next = this.bank.slots.findIndex(s => s.path);
            if (next >= 0) {
                const u = this.resolveSlotUri(this.bank.slots[next]);
                if (u) this.trackedUri = u;
            } else if (this.activeEditorUri) {
                this.trackedUri = this.activeEditorUri;
            }
        }
        await this.sendBankState();
        await this.sendProgramUpdate();
    }

    // ── Outbound state pushes ───────────────────────────────────────────

    private async sendInit(): Promise<void> {
        if (!this.view) return;
        const clips = await this.getClipList();
        const program = await this.compileTrackedDocument();
        this.view.webview.postMessage({
            type: 'init',
            clips,
            defaultClipId: clips[0]?.id ?? null,
            program,
            bank: await this.serializeBankForWebview(),
        });
    }

    private async sendBankState(): Promise<void> {
        if (!this.view) return;
        this.view.webview.postMessage({
            type: 'bankState',
            bank: await this.serializeBankForWebview(),
        });
    }

    /**
     * Pot labels for the slot the pedal graphic is currently showing, resolved
     * the same way the ones written to hardware are — bank `controls` over the
     * diagram's own wiring. Only the selected slot is resolved because that is
     * all the graphic displays, which keeps this off the hot path when a bank
     * has eight diagram slots.
     */
    private async selectedSlotPotLabels(): Promise<[string, string, string] | undefined> {
        const index = this.matchingSlotIndex();
        if (index === null || !this.bank) return undefined;
        const slot = this.bank.slots[index];
        if (!slot?.path) return undefined;
        const uri = this.resolveSlotUri(slot);
        if (!uri) return undefined;

        try {
            const { labels } = await this.labelsForSlot(index, uri);
            // undefined = we don't know, so keep the generic placeholder;
            // null = the pot is genuinely unused, so show nothing.
            return ([0, 1, 2] as const).map(pot => {
                const label = labels.pots?.[pot];
                if (label === null) return '';
                return label ?? `Pot ${pot}`;
            }) as [string, string, string];
        } catch {
            return undefined;
        }
    }

    private async sendProgramUpdate(): Promise<void> {
        if (!this.view) return;
        const program = await this.compileTrackedDocument();
        this.view.webview.postMessage({ type: 'programUpdate', program });
    }

    private async sendClipBytes(id: string): Promise<void> {
        if (!this.view) return;
        const filename = `${id}-32kHz.wav`;
        const filePath = path.join(this.clipDir, filename);
        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            this.view.webview.postMessage({
                type: 'clipBytes',
                id,
                bytesBase64: Buffer.from(bytes).toString('base64'),
            });
        } catch (err) {
            this.view.webview.postMessage({
                type: 'clipError',
                id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async serializeBankForWebview(): Promise<WebviewBankState | null> {
        if (!this.bank) return null;
        // Show the full filename including the .spnbank extension when
        // we have one. For in-memory banks we synthesise a placeholder
        // so the user gets a recognisable affordance ("Untitled.spnbank").
        const bankName = this.bankUri
            ? path.basename(this.bankUri.fsPath)
            : (this.bank.name ? `${this.bank.name}.spnbank` : 'Untitled.spnbank');
        return {
            bankPath: this.bankUri?.fsPath ?? null,
            bankName,
            slots: this.bank.slots.map(s => ({
                slotNumber: s.slot,
                path: s.path,
                label: s.name ?? (s.path ? path.basename(s.path) : ''),
                controls: s.controls,
            })),
            selectedSlotIndex: this.matchingSlotIndex(),
            selectedSlotPotLabels: await this.selectedSlotPotLabels(),
            dirty: this.bankDirty,
            pedalWriting: this.pedalWriting,
            pedalReading: this.pedalReading,
            programmingSlot: this.programmingSlot,
        };
    }

    // ── Compilation ─────────────────────────────────────────────────────

    private async compileTrackedDocument(): Promise<ProgramPayload | null> {
        const uri = this.trackedUri;
        if (!uri) return null;

        const ext = path.extname(uri.fsPath).toLowerCase();
        if (ext !== '.spn' && ext !== '.spndiagram') return null;

        const filename = path.basename(uri.fsPath);
        const slotIndex = this.matchingSlotIndex();
        const label = slotIndex !== null
            ? `Slot ${slotIndex + 1}: ${filename}`
            : filename;

        try {
            if (ext === '.spndiagram') {
                return await this.compileDiagram(uri, label);
            }
            return await this.compileSpn(uri, label);
        } catch (err) {
            return {
                label,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    private async compileDiagram(uri: vscode.Uri, label: string): Promise<ProgramPayload> {
        const document = await vscode.workspace.openTextDocument(uri);
        const result = this.blockDiagramDocMgr.getCompilationResult(document);

        if (!result.success || !result.assembly) {
            const msg = (result.errors ?? ['unknown graph compile error']).join('\n');
            return { label, error: msg };
        }

        const config = vscode.workspace.getConfiguration('fv1');
        const assembler = new FV1Assembler({
            fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
            clampReals: config.get<boolean>('clampReals') ?? true,
        });
        const asmResult = assembler.assemble(result.assembly);
        const fatal = asmResult.problems.filter(p => p.isfatal);
        if (fatal.length > 0) {
            const msg = fatal.map(p => `line ${p.line}: ${p.message}`).join('\n');
            return { label, error: `Assembly of generated diagram source failed:\n${msg}` };
        }

        const binary = FV1Assembler.toUint8Array(asmResult.machineCode);
        return {
            label,
            binaryBase64: Buffer.from(binary).toString('base64'),
        };
    }

    private async compileSpn(uri: vscode.Uri, label: string): Promise<ProgramPayload> {
        const doc = await vscode.workspace.openTextDocument(uri);
        const source = doc.getText();

        const config = vscode.workspace.getConfiguration('fv1');
        const result = compileEffect(
            { format: formatFromFilename(uri.fsPath), source } as Parameters<typeof compileEffect>[0],
            {
                fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
                clampReals: config.get<boolean>('clampReals') ?? true,
            },
        );
        return {
            label,
            binaryBase64: Buffer.from(result.binary).toString('base64'),
        };
    }

    // ── Clip catalogue ──────────────────────────────────────────────────

    private async getClipList(): Promise<ClipInfo[]> {
        if (this.clipList) return this.clipList;
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.clipDir));
            this.clipList = entries
                .filter(([f]) => /-32kHz\.wav$/i.test(f))
                .map(([f]) => f)
                .sort()
                .map(filename => {
                    const id = filename.replace(/-32kHz\.wav$/i, '');
                    const name = id
                        .split('-')
                        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                        .join(' ');
                    return { id, name };
                });
        } catch {
            this.clipList = [];
        }
        return this.clipList;
    }

    // ── HTML scaffold ───────────────────────────────────────────────────

    private renderHtml(webview: vscode.Webview): string {
        const distRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'dist'));

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distRoot, 'PedalSimulator.js'),
        );
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distRoot, 'easy-spin-ui', 'styles.css'),
        );
        const workletUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distRoot, 'easy-spin-ui', 'worklet', 'fv1-processor.js'),
        );
        const pedalImageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distRoot, 'easy-spin-ui', 'assets', 'pedal.png'),
        );

        const nonce = randomNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        img-src ${webview.cspSource} data:;
        media-src ${webview.cspSource};
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}' ${webview.cspSource};
        connect-src ${webview.cspSource};
    ">
    <title>FV-1 Simulator</title>
    <link rel="stylesheet" href="${stylesUri}">
    <style>
        html, body, #root {
            width: 100%;
            min-height: 100vh;
            margin: 0;
            padding: 0;
        }
        body {
            background: var(--color-surface);
            color: var(--color-text-primary);
            font-family: var(--vscode-font-family);
        }
        button.bg-surface-card.text-sm.font-semibold {
            min-width: 4.5rem;
            text-align: center;
        }
        /* Ctrl/Cmd-hover affordance on assigned slots: matches the
           Ctrl+click-to-open behaviour wired through onOpenSlotSource. The
           selector targets the slot label span (font-medium ⇒ assigned, vs.
           italic ⇒ empty) within a hovered slot div role="button", scoped to
           the slot grid (grid-cols-2). */
        body.modifier-ctrl .grid-cols-2 [role="button"]:hover .font-medium {
            text-decoration: underline;
            text-decoration-color: var(--color-gold-dim);
            cursor: pointer;
        }
        /* Static hint below the slot grid about the Shift-to-drop
           requirement (VS Code platform limitation, #256444). */
        .shift-drop-hint {
            text-align: center;
            font-size: 11px;
            color: var(--color-text-muted, #888);
            padding: 4px 0 0;
        }
        .shift-drop-hint kbd {
            display: inline-block;
            padding: 0 4px;
            margin: 0 1px;
            border-radius: 3px;
            border: 1px solid var(--color-border, #555);
            background: rgba(255, 255, 255, 0.06);
            font-family: inherit;
            font-size: 10px;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.__PEDAL_SIM__ = {
            workletUrl: ${JSON.stringify(workletUri.toString())},
            pedalImageUrl: ${JSON.stringify(pedalImageUri.toString())},
        };
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

// ── Types & helpers ─────────────────────────────────────────────────────

interface ClipInfo {
    id: string
    name: string
}

interface ProgramPayload {
    binaryBase64?: string
    label: string
    error?: string
}

interface WebviewBankState {
    /** null for in-memory banks (never saved). */
    bankPath: string | null
    bankName: string
    slots: Array<{
        slotNumber: number
        path: string
        label: string
        controls?: SpnBankSlot['controls']
    }>
    /** Index of the slot currently playing (matches trackedUri), or null. */
    selectedSlotIndex: number | null
    /**
     * Pot labels for that slot, already resolved from the bank's `controls`
     * and the diagram's own pot wiring. `''` means the pot is known to be
     * unused; absent means no slot is selected.
     */
    selectedSlotPotLabels?: [string, string, string]
    dirty: boolean
    /** True while the whole bank is being written to the pedal. */
    pedalWriting: boolean
    /** True while the pedal is being read back into the bank. */
    pedalReading: boolean
    /** 0-based index of the slot currently being written, or null. */
    programmingSlot: number | null
}

type WebviewMessage =
    | { type: 'ready' }
    | { type: 'requestClip'; id: string }
    | { type: 'requestLoadBank' }
    | { type: 'requestOpenBank'; uri: string }
    | { type: 'requestSaveBank' }
    | { type: 'requestSaveAsBank' }
    | { type: 'requestCloseBank' }
    | { type: 'requestOpenBankFile' }
    | { type: 'requestOpenSlotFile'; slotIndex: number }
    | { type: 'selectSlot'; slotIndex: number }
    | { type: 'assignSlot'; slotIndex: number; uri: string }
    | { type: 'assignTrackedToSlot'; slotIndex: number }
    | { type: 'unassignSlot'; slotIndex: number }
    | { type: 'requestProgramBank' }
    | { type: 'requestExportBankHex' }
    | { type: 'requestReadPedal' }
    | { type: 'requestProgramSlot'; slotIndex: number };

/** The active tab's URI when it is a .spnbank, else undefined. */
function activeBankTabUri(): vscode.Uri | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input;
    let uri: vscode.Uri | undefined;
    if (input instanceof vscode.TabInputText) uri = input.uri;
    else if (input instanceof vscode.TabInputCustom) uri = input.uri;
    if (!uri) return undefined;
    return path.extname(uri.fsPath).toLowerCase() === '.spnbank' ? uri : undefined;
}

/**
 * Turn a drag payload into a URI. VS Code drags supply `text/uri-list`
 * (file:// URIs); some sources supply a bare path.
 */
function resolveDroppedUri(payload: string): vscode.Uri | undefined {
    const text = payload.trim();
    if (!text) return undefined;
    try {
        return text.startsWith('file:') || text.includes('://')
            ? vscode.Uri.parse(text)
            : vscode.Uri.file(text);
    } catch {
        return undefined;
    }
}

function activeFv1TabUri(): vscode.Uri | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) return undefined;
    const input = tab.input;
    let uri: vscode.Uri | undefined;
    if (input instanceof vscode.TabInputText) uri = input.uri;
    else if (input instanceof vscode.TabInputCustom) uri = input.uri;
    if (!uri) return undefined;
    const ext = path.extname(uri.fsPath).toLowerCase();
    return (ext === '.spn' || ext === '.spndiagram') ? uri : undefined;
}

function randomNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}

/**
 * A label the pedal actually knows, or undefined.
 *
 * The EEPROM stores "Unknown" for anything that was never set, and blank for a
 * pot that is deliberately unused — neither is a name we want to propagate into
 * a filename or a bank entry.
 */
function meaningfulLabel(text: string | null | undefined): string | undefined {
    if (text === null || text === undefined) return undefined;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'UNKNOWN') return undefined;
    return trimmed;
}

/**
 * Turn a program name into a filename stem. Pedal labels are stored uppercase
 * ("LUSH CHORUS"), which makes for shouty filenames, so this lowercases and
 * hyphenates. Returns '' when nothing usable survives, letting the caller fall
 * back to a slot number.
 */
function toFileStem(name: string | undefined): string {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

/** Disambiguate repeated names — two slots may legitimately share one. */
function uniqueFileName(stem: string, used: Set<string>): string {
    let candidate = stem;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${stem}-${suffix++}`;
    used.add(candidate);
    return candidate;
}
