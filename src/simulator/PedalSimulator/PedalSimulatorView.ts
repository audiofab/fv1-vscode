import * as vscode from 'vscode';
import * as path from 'path';
import { compileEffect, FV1Assembler, formatFromFilename } from '@audiofab-io/fv1-core';
import {
    parseSpnBankJson,
    serializeSpnBankJson,
    createEmptyBank,
    PROGRAM_SLOT_COUNT,
    type SpnBankFile,
    type SpnBankSlot,
} from '@audiofab-io/fv1-core/spnbank';
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
    ) {
        this.clipDir = path.join(context.extensionPath, 'dist', 'simulator', 'wav');
        this.activeEditorUri = activeFv1TabUri();
        this.trackedUri = this.activeEditorUri;

        // Active-tab tracking — always update activeEditorUri and trackedUri.
        // Bank slot selection is purely visual (computed from trackedUri at
        // serialize-for-webview time).
        const onTabChange = () => {
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

    private async assignSlot(index: number, payload: string): Promise<void> {
        if (index < 0 || index >= PROGRAM_SLOT_COUNT) return;

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

    private async programBankToPedal(): Promise<void> {
        if (this.pedalWriting || this.programmingSlot !== null) return;
        if (!await this.ensureBankSaved()) return;
        if (!this.bankUri) return;

        this.pedalWriting = true;
        await this.sendBankState();
        try {
            // ProgrammerService.programBank reads the .spnbank by URI and
            // assembles + writes every assigned slot. Errors are surfaced
            // through its own showErrorMessage.
            await this.programmerService.programBank({ resourceUri: this.bankUri });
        } finally {
            this.pedalWriting = false;
            await this.sendBankState();
        }
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
            await this.programmerService.programEeprom(machineCode, index);
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
            bank: this.serializeBankForWebview(),
        });
    }

    private async sendBankState(): Promise<void> {
        if (!this.view) return;
        this.view.webview.postMessage({
            type: 'bankState',
            bank: this.serializeBankForWebview(),
        });
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

    private serializeBankForWebview(): WebviewBankState | null {
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
            dirty: this.bankDirty,
            pedalWriting: this.pedalWriting,
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
    dirty: boolean
    /** True while the whole bank is being written to the pedal. */
    pedalWriting: boolean
    /** 0-based index of the slot currently being written, or null. */
    programmingSlot: number | null
}

type WebviewMessage =
    | { type: 'ready' }
    | { type: 'requestClip'; id: string }
    | { type: 'requestLoadBank' }
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
    | { type: 'requestProgramSlot'; slotIndex: number };

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
