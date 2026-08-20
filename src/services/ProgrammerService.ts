import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import HID from 'node-hid';
import { MCP2221 } from '@johntalton/mcp2221';
import { NodeHIDStreamSource } from '../lib/node-hid-stream.js';
import {
    readMcp2221Configuration,
    describeMcp2221Configuration,
    identifyPedal,
    identifyPedalFromProductName,
    unknownPedalIdentity,
    PedalClient,
    canStorePotLabels,
    STRING_BASE_ADDRESS,
    type PatchLabels,
    type Mcp2221Configuration,
    type PedalIdentity
} from '@audiofab-io/fv1-core/pedal';
import { FV1Assembler, type FV1AssemblerResult, IntelHexParser } from '@audiofab-io/fv1-core';
import { OutputService } from './OutputService.js';
import { AssemblyService } from './AssemblyService.js';
import { FV1_REG_COUNT, FV1_DELAY_SIZE } from '../core/hardwareLimits.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512;

export class ProgrammerService {
    constructor(
        private outputService: OutputService,
        private assemblyService: AssemblyService
    ) { }

    private validateHardwareLimits(): boolean {
        const config = vscode.workspace.getConfiguration('fv1');
        const regCount = FV1_REG_COUNT;
        const progSize = config.get<number>('hardware.progSize') ?? 128;
        const delaySize = FV1_DELAY_SIZE;

        if (regCount !== 32 || progSize !== 128 || delaySize !== 32768) {
            const msg = `Hardware programming is only allowed with standard FV-1 limits (32 REGs, 128 instructions, 32k RAM). Current settings: ${regCount} REGs, ${progSize} instructions, ${delaySize} RAM.`;
            this.outputService.log(`[ERROR] ❌ ${msg}`);
            vscode.window.showErrorMessage(msg);
            return false;
        }
        return true;
    }

    public async selectProgramSlot(): Promise<number | undefined> {
        const items = Array.from({ length: 8 }, (_, i) => i + 1).map(i => ({
            label: `Program ${i}`,
            description: `Program into EEPROM program slot ${i}`,
            index: i - 1
        }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select program to write to EEPROM (1-8)', canPickMany: false });
        return picked?.index;
    }

    public async detectMCP2221(): Promise<HID.Device | undefined> {
        const config = vscode.workspace.getConfiguration('fv1');
        const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '0x04D8', 16);
        const productId = parseInt(config.get<string>('mcp2221ProductId') || '0x00DD', 16);

        try {
            const devices = HID.devices();
            const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);

            if (mcp2221Devices.length === 0) {
                this.outputService.log(`[ERROR] ❌ No MCP2221 programmer detected. Connect the USB programmer and try again.`);
                vscode.window.showWarningMessage('No MCP2221 devices found');
                return undefined;
            }
            if (mcp2221Devices.length === 1) {
                return mcp2221Devices[0];
            }

            const items = mcp2221Devices.map(d => ({
                label: d.product || 'MCP2221',
                description: d.serialNumber ? `SN: ${d.serialNumber}` : undefined,
                detail: d.path,
                device: d
            }));

            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select MCP2221 device to use', canPickMany: false });
            return picked?.device;
        } catch (error) {
            vscode.window.showErrorMessage(`Error detecting MCP2221: ${error}`);
            return undefined;
        }
    }

    /**
     * Which pedal the last connection identified, or undefined if we have not
     * connected yet. Programming paths that need to branch on stereo vs.
     * standard hardware should read this rather than re-detecting.
     */
    private lastIdentity: PedalIdentity | undefined;

    public get pedalIdentity(): PedalIdentity | undefined {
        return this.lastIdentity;
    }

    /**
     * Open the selected MCP2221 over HID, bring its I²C bus up at 400 kHz, and
     * work out which pedal it is. `close` releases the HID handle; callers that
     * hand the device off to a longer-lived EEPROM wrapper leave it open, as
     * they always have.
     */
    private async openDevice(): Promise<{
        device: MCP2221,
        identity: PedalIdentity,
        configuration: Mcp2221Configuration | undefined,
        close: () => Promise<void>
    } | undefined> {
        const selectedDevice = await this.detectMCP2221();
        if (!selectedDevice) return undefined;

        try {
            const hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
            const source = new NodeHIDStreamSource(hidDevice);
            const device = new MCP2221(source);

            await device.common.status({ opaque: 'Speed-Setup-400', i2cClock: 400 });

            // Identify over the wire; fall back to the descriptor node-hid
            // already gave us, and finally to "unknown" — never fatal, because
            // an unidentified pedal is still programmable the standard way.
            // The configuration is kept because the bus lock is derived from it.
            let identity: PedalIdentity;
            let configuration: Mcp2221Configuration | undefined;
            try {
                configuration = await readMcp2221Configuration(device);
                identity = identifyPedal(configuration);
            } catch {
                identity = selectedDevice.product
                    ? identifyPedalFromProductName(selectedDevice.product)
                    : unknownPedalIdentity();
            }
            // Announce the pedal only when it changes. Bank programming opens a
            // connection per slot, so logging every time was eight identical
            // lines per run.
            if (this.lastIdentity?.label !== identity.label
                || this.lastIdentity?.serialNumber !== identity.serialNumber) {
                this.outputService.log(`[INFO] 🔌 Connected to ${identity.label}`);
            }
            this.lastIdentity = identity;

            return {
                device,
                identity,
                configuration,
                close: async () => {
                    try {
                        await hidDevice.close();
                    } catch {
                        // Closing is best-effort; a already-gone handle is not an error.
                    }
                }
            };
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error connecting to pedal: ${error}`);
            vscode.window.showErrorMessage(`Error connecting to pedal: ${error}`);
            return undefined;
        }
    }

    /**
     * Read the attached MCP2221's own configuration — flash (power-up) chip and
     * GP settings, the live SRAM GP settings, and the USB descriptor strings —
     * and report it to the output channel. Read-only: nothing is written to the
     * device.
     */
    public async readDeviceConfiguration(): Promise<Mcp2221Configuration | undefined> {
        const connection = await this.openDevice();
        if (!connection) return undefined;

        try {
            this.outputService.log(`[INFO] 🔎 Reading MCP2221 configuration...`);
            const configuration = await readMcp2221Configuration(connection.device);
            this.outputService.log(describeMcp2221Configuration(configuration));
            this.outputService.log(`[SUCCESS] ✅ MCP2221 configuration read (device unchanged)`);
            return configuration;
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error reading MCP2221 configuration: ${error}`);
            vscode.window.showErrorMessage(`Error reading MCP2221 configuration: ${error}`);
            return undefined;
        } finally {
            await connection.close();
        }
    }


    /**
     * Open a `PedalClient` for the attached pedal.
     *
     * Programming goes through this rather than the raw `EEPROM` wrapper because
     * `PedalClient` drives the I2C writes itself instead of using
     * `i2c-bus-mcp2221`'s `checkWrite`, which polls MCP2221 status the instant a
     * write returns and throws "Not Idle-like" whenever it catches the engine
     * mid-transfer. That race is far more likely on the stereo pedal, where the
     * on-board MCU contends for the bus.
     */
    private async openPedalClient(): Promise<{ client: PedalClient, close: () => Promise<void> } | undefined> {
        const selectedDevice = await this.detectMCP2221();
        if (!selectedDevice) return undefined;

        let hidDevice: HID.HIDAsync | undefined;
        try {
            hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
            const client = await PedalClient.open(new NodeHIDStreamSource(hidDevice));

            const identity = client.identity;
            if (identity && (this.lastIdentity?.label !== identity.label
                || this.lastIdentity?.serialNumber !== identity.serialNumber)) {
                this.outputService.log(`[INFO] 🔌 Connected to ${identity.label}`);
            }
            if (identity) this.lastIdentity = identity;

            const handle = hidDevice;
            return {
                client,
                close: async () => {
                    try {
                        await handle.close();
                    } catch {
                        // Best-effort; an already-gone handle is not an error.
                    }
                },
            };
        } catch (error) {
            try { await hidDevice?.close(); } catch { /* ignore */ }
            this.outputService.log(`[ERROR] ❌ Error connecting to pedal: ${error}`);
            vscode.window.showErrorMessage(`Error connecting to pedal: ${error}`);
            return undefined;
        }
    }

    /**
     * Write a set of program slots in a single session.
     *
     * One connection and **one** bus-lock hold for the whole set. That matters
     * on the stereo pedal: releasing GP0 makes its MCU immediately reload every
     * program from the EEPROM, so cycling the lock per slot gave the MCU eight
     * chances to collide with the next write. Assert once, write everything,
     * release once - and the MCU reloads exactly when the EEPROM is final.
     */
    public async programSlots(
        slots: Array<{ index: number, machineCode: number[], label?: string, labels?: PatchLabels }>,
    ): Promise<boolean> {
        if (!this.validateHardwareLimits()) return false;
        if (slots.length === 0) return true;

        const config = vscode.workspace.getConfiguration('fv1');
        const verifyWrites = config.get<boolean>('verifyWrites') ?? true;

        const connection = await this.openPedalClient();
        if (!connection) return false;

        try {
            return await connection.client.withBusLock(async () => {
                for (const slot of slots) {
                    const writeData = FV1Assembler.toUint8Array(slot.machineCode);
                    if (writeData.length !== FV1_EEPROM_SLOT_SIZE_BYTES) {
                        throw new Error(
                            `Unexpected machine code size for slot ${slot.index + 1} (${writeData.length} bytes)`);
                    }

                    const what = slot.label ? `: ${slot.label}` : '';
                    this.outputService.log(`[INFO] 📡 Programming slot ${slot.index + 1}${what}...`);
                    await connection.client.writeSlot(slot.index, writeData, { verify: verifyWrites });
                    this.outputService.log(
                        `[SUCCESS] ✅ Wrote${verifyWrites ? ' and verified' : ''} program slot ${slot.index + 1}`);
                }

                await this.writeDisplayLabels(connection.client, slots);
                return true;
            });
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error programming EEPROM: ${error}`);
            vscode.window.showErrorMessage(`Error programming EEPROM: ${error}`);
            return false;
        } finally {
            await connection.close();
        }
    }

    /** Write a single program slot, prompting for the slot when none is given. */
    public async programEeprom(machineCode: number[], forcedSlot?: number): Promise<void> {
        let selectedSlot = forcedSlot;
        if (selectedSlot === undefined) selectedSlot = await this.selectProgramSlot();
        if (selectedSlot === undefined) {
            vscode.window.showWarningMessage('No program slot was selected, aborting');
            return;
        }
        await this.programSlots([{ index: selectedSlot, machineCode }]);
    }

    public async backupPedal(): Promise<void> {
        try {
            this.outputService.log(`[INFO] 💾 Starting pedal backup...`);

            const connection = await this.openPedalClient();
            if (!connection) return;

            const totalBytes = 8 * FV1_EEPROM_SLOT_SIZE_BYTES;
            this.outputService.log(`[INFO] 📖 Reading ${totalBytes} bytes from EEPROM...`);

            let dataArray: Uint8Array;
            let labelImage: Uint8Array | undefined;
            try {
                // Programs and labels under a single bus lock, so the pedal's MCU
                // is held off the bus once rather than twice.
                const captured = await connection.client.withBusLock(async () => {
                    const slots = await connection.client.readAllSlots();

                    // Pedals with the larger EEPROM also store the display
                    // strings above the program area. Without these a backup is
                    // incomplete: restoring it onto another pedal would bring
                    // back eight nameless programs.
                    let labels: Uint8Array | undefined;
                    if (canStorePotLabels(connection.client.identity)) {
                        try {
                            labels = await connection.client.readStringImage();
                        } catch (error) {
                            this.outputService.log(
                                `[WARNING] ⚠ Could not read the display labels; backing up programs only: ${error}`);
                        }
                    }
                    return { slots, labels };
                });

                dataArray = new Uint8Array(totalBytes);
                captured.slots.forEach((slot, i) => dataArray.set(slot, i * FV1_EEPROM_SLOT_SIZE_BYTES));
                labelImage = captured.labels;
            } finally {
                await connection.close();
            }

            this.outputService.log(`[SUCCESS] ✅ Successfully read ${dataArray.length} bytes`);

            const segments: Array<{ data: Buffer, address: number }> = [];
            for (let slot = 0; slot < 8; slot++) {
                const startOffset = slot * FV1_EEPROM_SLOT_SIZE_BYTES;
                const slotData = dataArray.slice(startOffset, startOffset + FV1_EEPROM_SLOT_SIZE_BYTES);
                segments.push({ data: Buffer.from(slotData), address: startOffset });
            }

            if (labelImage) {
                segments.push({ data: Buffer.from(labelImage), address: STRING_BASE_ADDRESS });
                this.outputService.log(
                    `[SUCCESS] ✅ Included ${labelImage.length} bytes of display labels at ` +
                    `0x${STRING_BASE_ADDRESS.toString(16).toUpperCase()}`);
            }

            const defaultFileName = `pedal-backup-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.hex`;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(workspaceFolder, defaultFileName)),
                filters: { 'Intel HEX files': ['hex'], 'All files': ['*'] },
                saveLabel: 'Save Backup'
            });

            if (!saveUri) {
                this.outputService.log(`[WARNING] ⚠ Backup cancelled by user`);
                return;
            }

            this.outputService.log(`[INFO] 📄 Generating Intel HEX file...`);
            const hexFileString = IntelHexParser.generateMultiSegment(segments, 16);
            fs.writeFileSync(saveUri.fsPath, hexFileString, 'utf8');

            if (fs.existsSync(saveUri.fsPath)) {
                this.outputService.log(`[SUCCESS] ✅ Pedal backup saved to: ${path.basename(saveUri.fsPath)}`);
                vscode.window.showInformationMessage(`Pedal backup successfully saved to ${path.basename(saveUri.fsPath)}`);

                const openFile = await vscode.window.showInformationMessage('Backup complete! Open file?', 'Open File', 'Close');
                if (openFile === 'Open File') {
                    const doc = await vscode.workspace.openTextDocument(saveUri);
                    await vscode.window.showTextDocument(doc);
                }
            } else {
                throw new Error('Failed to save backup file');
            }
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error backing up pedal: ${error}`);
            vscode.window.showErrorMessage(`Error backing up pedal: ${error}`);
        }
    }

    /**
     * Read all 8 program slots off the pedal.
     *
     * Uses fv1-core's `PedalClient` rather than the `EEPROM` wrapper the write
     * paths use: its `readAllSlots` drives the I²C read directly, which is ~2.5x
     * faster over a full 4 KB sweep and doesn't emit the library's spurious
     * mid-transfer `checkRead` warnings. Identification comes along for free.
     */
    public async readAllSlotsFromPedal(): Promise<{
        slots: Uint8Array[],
        identity: PedalIdentity | undefined,
        labels?: PatchLabels[],
    } | undefined> {
        const connection = await this.openPedalClient();
        if (!connection) return undefined;

        try {
            this.outputService.log(`[INFO] 📖 Reading all 8 program slots from the pedal...`);

            // Programs and labels under a single bus lock. Splitting them would
            // release the programming lockout in between, letting the pedal's
            // MCU take the bus back and start a reload we'd then collide with.
            const { slots, labels } = await connection.client.withBusLock(async () => {
                const programs = await connection.client.readAllSlots();

                let stored: PatchLabels[] | undefined;
                if (canStorePotLabels(connection.client.identity)) {
                    try {
                        stored = await connection.client.readPatchLabels();
                    } catch (error) {
                        this.outputService.log(`[WARNING] ⚠ Could not read display labels: ${error}`);
                    }
                }
                return { slots: programs, labels: stored };
            });

            this.outputService.log(`[SUCCESS] ✅ Read ${slots.length} slots from the pedal`);
            if (canStorePotLabels(connection.client.identity)) {
                this.outputService.log(labels
                    ? `[SUCCESS] ✅ Read display labels for 8 slots`
                    : `[INFO] 📝 The pedal has no display labels stored yet`);
            }

            return { slots, identity: connection.client.identity, labels };
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error reading from pedal: ${error}`);
            vscode.window.showErrorMessage(`Error reading from pedal: ${error}`);
            return undefined;
        } finally {
            await connection.close();
        }
    }

    /**
     * Push program / pot labels to the stereo pedal's display.
     *
     * Runs inside the caller's bus lock, right after the programs, so the whole
     * update is one lockout hold. Never fatal: the programs are already written,
     * so a label failure is a warning, not a failed program operation.
     */
    private async writeDisplayLabels(
        client: PedalClient,
        slots: Array<{ index: number, labels?: PatchLabels }>,
    ): Promise<void> {
        const withLabels = slots.filter(slot => slot.labels !== undefined);
        if (withLabels.length === 0) return;
        if (!canStorePotLabels(client.identity)) return;

        try {
            const sparse: (PatchLabels | undefined)[] = new Array(8);
            for (const slot of withLabels) sparse[slot.index] = slot.labels;

            const warnings = await client.writePatchLabels(sparse);
            this.outputService.log(
                `[SUCCESS] ✅ Updated display labels for ${withLabels.length} slot(s)`);

            for (const warning of warnings) {
                const detail = warning.reason === 'too-long'
                    ? 'will clip on the pedal display'
                    : 'contains characters the pedal display cannot draw';
                this.outputService.log(
                    `[WARNING] ⚠ Slot ${warning.patch + 1} ${warning.field}: "${warning.original}" ${detail}`);
            }
        } catch (error) {
            this.outputService.log(
                `[WARNING] ⚠ Programs were written, but the display labels were not: ${error}`);
        }
    }

    private hex16(value: number): string {
        return value.toString(16).toUpperCase().padStart(4, '0');
    }

    /**
     * Work out which of the 8 program slots a set of HEX segments touches, so
     * we can tell the user which slots on the pedal we're about to leave alone.
     */
    private describeCoveredSlots(segments: Array<{ address: number, data: Uint8Array }>): {
        written: number[], untouched: number[]
    } {
        const written = new Set<number>();
        for (const segment of segments) {
            const first = Math.floor(segment.address / FV1_EEPROM_SLOT_SIZE_BYTES);
            const last = Math.floor((segment.address + segment.data.length - 1) / FV1_EEPROM_SLOT_SIZE_BYTES);
            for (let slot = first; slot <= last; slot++) {
                if (slot >= 0 && slot < 8) written.add(slot + 1);
            }
        }
        const all = Array.from({ length: 8 }, (_, i) => i + 1);
        return {
            written: all.filter(n => written.has(n)),
            untouched: all.filter(n => !written.has(n)),
        };
    }

    public async loadHexToEeprom(): Promise<void> {
        if (!this.validateHardwareLimits()) return;

        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const document = activeEditor.document;
            if (!document.fileName.endsWith('.hex')) {
                vscode.window.showErrorMessage('Active file is not an Intel HEX file (.hex)');
                return;
            }

            const hexFilePath = document.fileName;
            this.outputService.log(`[INFO] 📄 Loading Intel HEX file: ${path.basename(hexFilePath)}...`);

            const hexContent = fs.readFileSync(hexFilePath, 'utf8');

            const validation = IntelHexParser.validateHex(hexContent);
            if (!validation.valid) {
                this.outputService.log(`[ERROR] ❌ Invalid Intel HEX file:`);
                validation.errors.forEach(error => {
                    this.outputService.log(`[ERROR] ❌   ${error}`);
                });
                vscode.window.showErrorMessage('Invalid Intel HEX file. Check Output panel for details.');
                return;
            }

            this.outputService.log(`[INFO] 🔧 Parsing Intel HEX file...`);
            // Segment-aware on purpose: a bank .hex omits unassigned slots, and
            // flattening it (IntelHexParser.parse) would fill those gaps with
            // 0xFF and erase perfectly good programs already on the pedal. We
            // write only the regions the file actually covers.
            const segments = IntelHexParser.parseSegments(hexContent);
            if (segments.length === 0) {
                this.outputService.log(`[WARNING] ⚠ Intel HEX file contains no data records — nothing to program.`);
                vscode.window.showWarningMessage('That .hex file contains no data.');
                return;
            }

            const totalBytes = segments.reduce((sum, s) => sum + s.data.length, 0);
            this.outputService.log(
                `[SUCCESS] ✅ Parsed ${totalBytes} bytes in ${segments.length} segment(s) from Intel HEX file`,
            );

            const covered = this.describeCoveredSlots(segments);
            if (covered.untouched.length > 0) {
                this.outputService.log(
                    `[INFO] 📄 The file covers program slot(s) ${covered.written.join(', ') || 'none'}; ` +
                    `slot(s) ${covered.untouched.join(', ')} are not in the file and will be left untouched on the pedal.`,
                );
            }

            const config = vscode.workspace.getConfiguration('fv1');
            const verifyWrites = config.get<boolean>('verifyWrites') ?? true;

            const connection = await this.openPedalClient();
            if (!connection) return;
            this.outputService.log(`[INFO] 📡 Programming EEPROM with ${totalBytes} bytes...`);

            // One lock for the whole file, and PedalClient's direct-drive writes
            // rather than eeprom.write — the same "Not Idle-like" race applies
            // here as it does to slot programming.
            try {
                await connection.client.withBusLock(async () => {
                    for (const segment of segments) {
                        const end = segment.address + segment.data.length - 1;
                        this.outputService.log(
                            `[INFO] 📡 Writing 0x${this.hex16(segment.address)}–0x${this.hex16(end)} (${segment.data.length} bytes)...`,
                        );
                        await connection.client.writeRange(
                            segment.address, segment.data, { verify: verifyWrites },
                            `loadHex::0x${this.hex16(segment.address)}`,
                        );
                    }
                });
            } finally {
                await connection.close();
            }

            const verifiedSuffix = verifyWrites ? ' and verified' : '';
            this.outputService.log(`[SUCCESS] ✅ Successfully wrote${verifiedSuffix} ${totalBytes} bytes to EEPROM`);
            vscode.window.showInformationMessage(`Successfully programmed ${totalBytes} bytes to EEPROM`);

        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error loading HEX file to EEPROM: ${error}`);
            vscode.window.showErrorMessage(`Error loading HEX file to EEPROM: ${error}`);
        }
    }
}
