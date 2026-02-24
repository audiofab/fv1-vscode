import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FV1Simulator } from './FV1Simulator.js';
import { FV1AssemblerResult } from '../FV1Assembler.js';
import { FV1AudioStreamer } from './FV1AudioStreamer.js';
import { FV1AudioEngine } from './FV1AudioEngine.js';
import { AssemblyService } from '../services/AssemblyService.js';

export class FV1DebugSession implements vscode.DebugAdapter {
    private simulator: FV1Simulator;
    private _sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    public onDidSendMessage = this._sendMessage.event;

    private sourcePath: string = '';
    private addressToLineMap = new Map<number, number>();
    private lineToAddressMap = new Map<number, number>();
    private maxMappedAddr = -1;
    private breakpoints = new Set<number>();
    private rawBreakpoints: any[] = []; // Store raw breakpoint info from client
    private isRunning = false;
    private stopOnEntry = false;
    private oscilloscopeEnabled: boolean = true;
    private oscilloscopeRefreshRate: number = 1;
    private zoomLevel: number = 1;
    private timerHandle: any = null;
    private sampleRate: number = 32768;

    // Audio components
    private audioStreamer: FV1AudioStreamer;
    private audioEngine: FV1AudioEngine | null = null;
    private extensionPath: string = '';
    private context: vscode.ExtensionContext;

    // Source mapping
    private symbols: any[] = [];
    private memories: any[] = [];

    // Real-time control state
    private bypassActive: boolean = false;
    private potValues: number[] = [0.5, 0.5, 0.5];

    // Variables storage
    private nextVarHandle = 1;
    private varHandles = new Map<number, { type: string, getter: () => any[] }>();
    private symbolsChanged: boolean = false;

    constructor(context: vscode.ExtensionContext, private assemblyService: AssemblyService, audioEngine?: FV1AudioEngine) {
        this.context = context;
        this.simulator = new FV1Simulator();
        this.audioStreamer = new FV1AudioStreamer();
        this.extensionPath = context.extensionPath;
        this.audioEngine = audioEngine || null;

        // Initialize visualization settings from global configuration
        const simConfig = vscode.workspace.getConfiguration('fv1.simulation');
        this.oscilloscopeEnabled = simConfig.get<boolean>('visualizationsEnabled') ?? true;
        this.oscilloscopeRefreshRate = simConfig.get<number>('oscilloscopeRefreshRate') ?? 1;

        // Initialize session-specific state
        this.zoomLevel = this.context.workspaceState.get<number>('fv1.zoomLevel') ?? 1;

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('fv1.simulation')) {
                const updatedConfig = vscode.workspace.getConfiguration('fv1.simulation');
                this.oscilloscopeEnabled = updatedConfig.get<boolean>('visualizationsEnabled') ?? true;
                this.oscilloscopeRefreshRate = updatedConfig.get<number>('oscilloscopeRefreshRate') ?? 1;
                this.pushConfig();
            }
        });
    }

    private pushConfig() {
        if (this.audioEngine) {
            this.audioEngine.playBuffer(new Float32Array(0), new Float32Array(0), 0, 0, {
                type: 'config',
                oscilloscopeEnabled: this.oscilloscopeEnabled,
                oscilloscopeRefreshRate: this.oscilloscopeRefreshRate,
                zoomLevel: this.zoomLevel
            });
        }
    }

    public handleMessage(message: vscode.DebugProtocolMessage): void {
        const request = message as any;
        if (request.type === 'request') {
            this.dispatchRequest(request);
        }
    }

    private async dispatchRequest(request: any) {
        const response: any = {
            type: 'response',
            request_seq: request.seq,
            command: request.command,
            success: true
        };

        try {
            switch (request.command) {
                case 'initialize':
                    response.body = {
                        supportsConfigurationDoneRequest: true,
                        supportsEvaluateForHovers: false,
                        supportsStepBack: false,
                        supportsSetVariable: true,
                        supportsRestartRequest: true,
                        supportsSupportTerminateDebuggee: true,
                        supportsTerminateRequest: true,
                        supportsSetBreakpoints: true,
                    };
                    break;

                case 'launch':
                    await this.launch(request.arguments, response);
                    break;

                case 'setBreakpoints':
                    this.setBreakpoints(request.arguments, response);
                    break;

                case 'configurationDone':
                    if (this.stopOnEntry) {
                        this.sendEvent('stopped', { reason: 'entry', threadId: 1 });
                    }
                    break;

                case 'threads':
                    response.body = { threads: [{ id: 1, name: "Main Thread" }] };
                    break;

                case 'disconnect':
                case 'terminate':
                    console.log(`Debugger received stop request: ${request.command}`);
                    this.isRunning = false;
                    if (this.timerHandle) {
                        clearTimeout(this.timerHandle);
                        this.timerHandle = null;
                    }
                    this.sendEvent('terminated');
                    break;

                case 'stackTrace':
                    this.stackTrace(request.arguments, response);
                    break;

                case 'scopes':
                    this.scopes(request.arguments, response);
                    break;

                case 'variables':
                    this.variables(request.arguments, response);
                    break;

                case 'setVariable':
                    this.setVariable(request.arguments, response);
                    break;

                case 'continue':
                    this.continueExecution(response);
                    break;

                case 'next':
                case 'stepIn':
                    this.step(response);
                    break;

                case 'pause':
                    this.isRunning = false;
                    if (this.timerHandle) {
                        clearTimeout(this.timerHandle);
                        this.timerHandle = null;
                    }
                    this.sendEvent('stopped', { reason: 'pause', threadId: 1 });
                    break;

                case 'restart':
                    this.simulator.reset();
                    if (this.stopOnEntry) {
                        this.sendEvent('stopped', { reason: 'entry', threadId: 1 });
                    } else {
                        this.continueExecution(response);
                    }
                    break;

                case 'evaluate':
                    this.evaluate(request.arguments, response);
                    break;

                default:
                    response.success = false;
                    response.message = `Unsupported request: ${request.command}`;
                    break;
            }
        } catch (e: any) {
            response.success = false;
            response.message = e.message;
        }

        this._sendMessage.fire(response);

        if (request.command === 'initialize') {
            this.sendEvent('initialized');
        }
    }

    private async launch(args: any, response: any) {
        this.sendEvent('output', { category: 'console', output: `Starting FV-1 Debug Session...\n` });

        this.sourcePath = args.program;
        this.stopOnEntry = !!args.stopOnEntry;
        this.sampleRate = args.sampleRate || 32768;

        if (!this.sourcePath) {
            response.success = false;
            response.message = "No program specified.";
            return;
        }

        // Check if sourcePath is a URI string or a local path
        const isUri = this.sourcePath.includes(':') && !path.isAbsolute(this.sourcePath);
        if (!isUri && !fs.existsSync(this.sourcePath)) {
            response.success = false;
            response.message = `File does not exist: ${this.sourcePath}`;
            return;
        }

        // Initialize Audio Engine listener (engine is provided by provider now)
        if (this.audioEngine) {
            // Apply current stimulus from engine immediately on launch
            const currentStimulus = this.audioEngine.getStimulus();
            if (currentStimulus) {
                this.handleStimulusChange(currentStimulus);
            }

            this.audioEngine.onMessage(m => {
                switch (m.type) {
                    case 'bypassChange':
                        this.bypassActive = !!m.active;
                        this.sendEvent('output', { category: 'console', output: `Bypass ${this.bypassActive ? 'ON' : 'OFF'}\n` });
                        break;
                    case 'potChange':
                        if (m.pot >= 0 && m.pot <= 2) {
                            this.potValues[m.pot] = m.value;
                            this.simulator.setRegister(0x10 + m.pot, m.value);
                        }
                        break;
                    case 'stimulusChange':
                        this.handleStimulusChange(m);
                        break;
                    case 'registerSelectionChange':
                        if (m.selection) {
                            this.context.workspaceState.update('fv1.registerSelection', m.selection);
                        }
                        break;
                    case 'requestRegisterSelection':
                        const saved = this.context.workspaceState.get<number[]>('fv1.registerSelection') || [22, 23];
                        if (this.audioEngine) {
                            this.audioEngine.playBuffer(new Float32Array(0), new Float32Array(0), 0, 0, {
                                type: 'registerSelection',
                                selection: saved
                            });
                        }
                        break;
                    case 'configChange':
                        // Only zoomLevel is sent from webview now
                        if (m.zoomLevel !== undefined) {
                            this.zoomLevel = m.zoomLevel;
                            this.context.workspaceState.update('fv1.zoomLevel', this.zoomLevel);
                        }
                        break;
                    case 'requestConfig':
                        this.pushConfig();
                        break;
                }
            });

            // Immediately push current config on launch
            this.pushConfig();
        }

        // Apply hardware limits to simulator
        const config = vscode.workspace.getConfiguration('fv1');
        const regCount = config.get<number>('hardware.regCount') ?? 32;
        const progSize = config.get<number>('hardware.progSize') ?? 128;
        const delaySize = config.get<number>('hardware.delaySize') ?? 32768;
        this.simulator.setCapabilities(delaySize, regCount, progSize);

        // Load Input WAV if specified
        let wavToLoad = args.inputWavFile;
        // No longer using hardcoded default to ensure sync with UI (Silence)

        const resolvedPath = wavToLoad ? this.resolveWavPath(wavToLoad, args.cwd) : null;
        if (resolvedPath) {
            try {
                await this.audioStreamer.loadWav(resolvedPath);
                const msg = `WAV file loaded: ${resolvedPath} (${this.audioStreamer.getNumSamples()} samples)`;
                console.log(msg);
                this.sendEvent('output', { category: 'console', output: msg + '\n' });
            } catch (e: any) {
                const msg = `Failed to load WAV: ${e.message}`;
                console.error(msg);
                this.sendEvent('output', { category: 'stderr', output: msg + '\n' });
            }
        } else {
            const msg = `Notice: Could not find input WAV file. Standard file resolution failed.`;
            console.warn(msg);
            this.sendEvent('output', { category: 'console', output: msg + '\n' });
            // Don't show error box for internal default if it's missing, only if user explicitly asked
            if (args.inputWavFile) {
                vscode.window.showErrorMessage(`Missing WAV file: ${args.inputWavFile}`);
            }
        }

        // Send initial heartbeat to Monitor UI
        if (this.audioEngine) {
            const lastSample = this.audioStreamer.getLastSample();
            const metadata = {
                loaded: this.audioStreamer.isLoaded(),
                numSamples: this.audioStreamer.getNumSamples(),
                currentField: this.audioStreamer.getCurrentSample()
            };
            this.audioEngine.playBuffer(new Float32Array(0), new Float32Array(0), lastSample.l, lastSample.r, metadata);
        }

        const result = await this.assemblyService.assembleFile(this.sourcePath);

        if (!result || result.problems.some(p => p.isfatal)) {
            const errorMsg = result && result.problems.length > 0 ? result.problems.find(p => p.isfatal)?.message : "Unknown assembly error";
            throw new Error(`Assembly failed: ${errorMsg}`);
        }

        this.simulator.loadProgram(new Uint32Array(result.machineCode));
        this.addressToLineMap = result.addressToLineMap;
        this.symbols = result.symbols;
        this.memories = result.memories;
        this.symbolsChanged = true;

        // Pass symbols and options to simulator
        const fv1AsmMemBug = vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true;
        this.simulator.setSymbols(this.symbols, this.memories, fv1AsmMemBug);

        this.lineToAddressMap.clear();
        this.maxMappedAddr = -1;
        for (const [addr, line] of this.addressToLineMap) {
            this.lineToAddressMap.set(line, addr);
            if (addr > this.maxMappedAddr) this.maxMappedAddr = addr;
        }

        this.simulator.reset();

        // Re-verify breakpoints now that we have the line map
        this.verifyBreakpoints();

        // Push initial metadata to visualization immediately
        if (this.audioEngine) {
            this.audioEngine.playBuffer(new Float32Array(0), new Float32Array(0), 0, 0, {
                memories: this.memories,
                symbols: this.symbols,
                delaySize: this.simulator.getDelaySize(),
                delayPtr: this.simulator.getDelayPointer(),
                addrPtr: this.simulator.getRegisters()[24]
            });
            this.symbolsChanged = false;
        }
    }

    private resolveWavPath(wavPath: string, cwd?: string): string | null {
        if (path.isAbsolute(wavPath) && fs.existsSync(wavPath)) {
            return wavPath;
        }

        const searchPaths: string[] = [];

        // 1. Try relative to provided CWD (usually workspace root)
        if (cwd) { searchPaths.push(path.resolve(cwd, wavPath)); }

        // 2. Try relative to the .spin program
        if (this.sourcePath) {
            let baseDir: string;
            if (this.sourcePath.startsWith('file:///')) {
                baseDir = path.dirname(vscode.Uri.parse(this.sourcePath).fsPath);
            } else if (this.sourcePath.includes(':') && !path.isAbsolute(this.sourcePath)) {
                // Try parsing as URI if it looks like one
                try {
                    baseDir = path.dirname(vscode.Uri.parse(this.sourcePath).fsPath);
                } catch {
                    baseDir = path.dirname(this.sourcePath);
                }
            } else {
                baseDir = path.dirname(this.sourcePath);
            }
            searchPaths.push(path.resolve(baseDir, wavPath));
        }

        // 3. Try relative to extension (critical for internal assets)
        if (this.extensionPath) {
            // Try raw path relative to extension root
            searchPaths.push(path.resolve(this.extensionPath, wavPath));

            // If path starts with src/, also try relative to dist/ (because of bundling)
            if (wavPath.startsWith('src/')) {
                const relativeToSrc = wavPath.substring(4); // strip 'src/'
                searchPaths.push(path.resolve(this.extensionPath, 'dist', relativeToSrc));
                searchPaths.push(path.resolve(this.extensionPath, 'out', relativeToSrc));
            }

            // Also try looking inside dist/simulator/wav regardless of prefix
            const basename = path.basename(wavPath);
            searchPaths.push(path.resolve(this.extensionPath, 'dist/simulator/wav', basename));
        }

        // 4. Try relative to workspace folders
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) { searchPaths.push(path.join(workspaceFolder.uri.fsPath, wavPath)); }

        for (const p of searchPaths) {
            const exists = fs.existsSync(p);
            const msg = `Searching for WAV at: ${p} (${exists ? 'Found!' : 'Not found'})`;
            console.log(msg);
            this.sendEvent('output', { category: 'console', output: msg + '\n' });
            if (exists) return p;
        }

        return null;
    }

    private verifyBreakpoints() {
        this.breakpoints.clear();
        const actualBps: any[] = [];

        for (const bp of this.rawBreakpoints) {
            const line = bp.line;
            const addr = this.lineToAddressMap.get(line);
            if (addr !== undefined) {
                this.breakpoints.add(addr);
                actualBps.push({ verified: true, line: line });
            } else {
                actualBps.push({ verified: false, line: line });
            }
        }

        this.simulator.setBreakpoints(this.breakpoints);

        // Send breakpoint events to update the UI
        for (const bp of actualBps) {
            this.sendEvent('breakpoint', {
                reason: 'changed',
                breakpoint: bp
            });
        }
    }

    private setBreakpoints(args: any, response: any) {
        this.rawBreakpoints = args.breakpoints || [];
        const actualBps: any[] = [];
        this.breakpoints.clear();

        for (const bp of this.rawBreakpoints) {
            const line = bp.line;
            const addr = this.lineToAddressMap.get(line);
            if (addr !== undefined) {
                this.breakpoints.add(addr);
                actualBps.push({ verified: true, line: line });
            } else {
                actualBps.push({ verified: false, line: line });
            }
        }

        this.simulator.setBreakpoints(this.breakpoints);
        response.body = { breakpoints: actualBps };
    }

    private stackTrace(_args: any, response: any) {
        const pc = this.simulator.getPC();
        const line = this.addressToLineMap.get(pc) || 1;

        response.body = {
            stackFrames: [{
                id: 1,
                name: `PC: ${pc}`,
                source: { path: this.sourcePath },
                line: line,
                column: 0
            }],
            totalFrames: 1
        };
    }

    private scopes(args: any, response: any) {
        this.varHandles.clear();
        this.nextVarHandle = 1;

        const scopes = [
            { name: "Accumulator/Flags", variablesReference: this.createVarHandle("accflags", () => this.getAccFlagsVars()), expensive: false },
            { name: "Program Variables", variablesReference: this.createVarHandle("program", () => this.getProgramVars()), expensive: false },
            { name: "Registers", variablesReference: this.createVarHandle("registers", () => this.getRegistersVars()), expensive: false },
            { name: "Delay RAM", variablesReference: this.createVarHandle("delayram_root", () => this.getDelayRamRootVars()), expensive: true }
        ];

        response.body = { scopes };
    }

    private createVarHandle(type: string, getter: () => any[]): number {
        const handle = this.nextVarHandle++;
        this.varHandles.set(handle, { type, getter });
        return handle;
    }

    private variables(args: any, response: any) {
        const handle = args.variablesReference;
        const info = this.varHandles.get(handle);
        if (info) {
            response.body = { variables: info.getter() };
        } else {
            response.body = { variables: [] };
        }
    }

    private setVariable(args: any, response: any) {
        const handle = args.variablesReference;
        const name = args.name;
        const valStr = args.value;

        let value: number;
        if (valStr.startsWith('$')) {
            value = parseInt(valStr.substring(1), 16) / 8388608.0; // Assume 24-bit fixed point input
        } else {
            value = parseFloat(valStr);
        }

        if (isNaN(value)) {
            response.success = false;
            response.message = "Invalid value format. Use float (0.5) or hex ($400000).";
            return;
        }

        const info = this.varHandles.get(handle);
        if (!info) {
            response.success = false;
            return;
        }

        if (info.type === 'registers') {
            const state = this.simulator.getState();
            // Find index by name mapping
            const entry = Object.entries(state.registers).find(([n, _]) => n === name);
            if (entry) {
                // Determine register index from name
                const regIdxMatch = name.match(/^REG(\d+)$/);
                if (regIdxMatch) {
                    this.simulator.setRegister(32 + parseInt(regIdxMatch[1]), value);
                } else if (name.match(/^\[(\d+)\]$/)) {
                    this.simulator.setRegister(parseInt(name.match(/\[(\d+)\]/)![1]), value);
                } else {
                    const hwMapping: Record<string, number> = {
                        "SIN0_RATE": 0, "SIN0_RANGE": 1, "SIN1_RATE": 2, "SIN1_RANGE": 3,
                        "RMP0_RATE": 4, "RMP0_RANGE": 5, "RMP1_RATE": 6, "RMP1_RANGE": 7,
                        "POT0": 16, "POT1": 17, "POT2": 18, "ADCL": 20, "ADCR": 21,
                        "DACL": 22, "DACR": 23, "ADDR_PTR": 24
                    };
                    if (hwMapping[name] !== undefined) {
                        this.simulator.setRegister(hwMapping[name], value);
                    }
                }
            }
        } else if (info.type === 'accflags') {
            if (name === "ACC") this.simulator.setAcc(value);
            else if (name === "PACC") this.simulator.setPacc(value);
        }

        response.body = { value: this.formatValue(this.simulator.evaluateExpression(name)?.value ?? value) };
    }

    private getProgramVars(): any[] {
        const regs = this.simulator.getRegisters();
        const vars: any[] = [];

        // Add memories
        for (const mem of this.memories) {
            if (mem.start !== undefined) {
                const val = this.simulator.getDelayRam()[mem.start];
                vars.push({
                    name: `MEM: ${mem.name}`,
                    value: `${this.formatValue(val)} (Start: ${mem.start}, Size: ${mem.size})`,
                    type: "memory",
                    variablesReference: 0
                });
            }
        }

        // Add EQU symbols that look like registers
        for (const sym of this.symbols) {
            const addr = parseInt(sym.value);
            if (!isNaN(addr) && addr >= 0 && addr <= 63) {
                // It's likely a register alias
                const regVal = regs[addr];
                vars.push({
                    name: `EQU: ${sym.name}`,
                    value: `${this.formatValue(regVal)} (REG index ${addr})`,
                    type: "register",
                    variablesReference: 0
                });
            }
        }

        return vars;
    }

    private getRegNameFromAddr(addr: number): string {
        if (addr < 8) return `SIN${addr >> 1}_${addr & 1 ? 'RANGE' : 'RATE'}`; // Simplification
        if (addr >= 16 && addr <= 18) return `POT${addr - 16}`;
        if (addr === 20) return 'ADCL';
        if (addr === 21) return 'ADCR';
        if (addr === 22) return 'DACL';
        if (addr === 23) return 'DACR';
        if (addr === 24) return 'ADDR_PTR';
        if (addr >= 32 && addr <= 63) return `REG${addr - 32}`;
        return `R${addr}`;
    }

    private evaluate(args: any, response: any) {
        const expression = args.expression.trim();
        const result = this.simulator.evaluateExpression(expression);

        if (result) {
            response.body = {
                result: `${result.label}: ${this.formatValue(result.value)}`,
                variablesReference: 0
            };
        } else {
            response.success = false;
            response.message = "Unknown variable or register";
        }
    }

    private getDelayRamRootVars(): any[] {
        const vars: any[] = [];
        // Divide 32768 into 32 groups of 1024
        for (let i = 0; i < 32; i++) {
            const start = i * 1024;
            const end = start + 1023;
            vars.push({
                name: `Samples ${start}-${end}`,
                value: "Group",
                variablesReference: this.createVarHandle(`delayram_group_${i}`, () => this.getDelayRamGroupVars(i))
            });
        }
        return vars;
    }

    private getDelayRamGroupVars(groupIdx: number): any[] {
        const ram = this.simulator.getDelayRam();
        const start = groupIdx * 1024;
        const vars: any[] = [];
        // Further divide into 16 sub-groups of 64 or just show 1024?
        // Let's do 10 sub-groups of ~100 to avoid overwhelming the UI
        for (let i = 0; i < 10; i++) {
            const subStart = start + i * 100;
            const subEnd = Math.min(subStart + 99, start + 1023);
            if (subStart >= 32768) break;
            vars.push({
                name: `[${subStart}-${subEnd}]`,
                value: "...",
                variablesReference: this.createVarHandle(`delayram_sub_${groupIdx}_${i}`, () => this.getDelayRamSubGroupVars(subStart, subEnd))
            });
        }
        return vars;
    }

    private getDelayRamSubGroupVars(start: number, end: number): any[] {
        const ram = this.simulator.getDelayRam();
        const vars: any[] = [];
        for (let i = start; i <= end; i++) {
            if (i >= 32768) break;
            vars.push({ name: `[${i}]`, value: this.formatValue(ram[i]), type: "float", variablesReference: 0 });
        }
        return vars;
    }

    private getRegistersVars(): any[] {
        const state = this.simulator.getState();
        return Object.entries(state.registers).map(([name, val]) => ({
            name,
            value: this.formatValue(val),
            type: "float",
            variablesReference: 0
        }));
    }

    private getAccFlagsVars(): any[] {
        const state = this.simulator.getState();
        const vars = [
            { name: "ACC", value: this.formatValue(state.acc), type: "float", variablesReference: 0 },
            { name: "PACC", value: this.formatValue(state.pacc), type: "float", variablesReference: 0 },
            { name: "LR", value: this.formatValue(state.lr), type: "float", variablesReference: 0 },
        ];
        Object.entries(state.flags).forEach(([name, val]) => {
            vars.push({ name: name, value: val.toString(), type: "boolean", variablesReference: 0 });
        });
        return vars;
    }

    private formatValue(val: number): string {
        // Show as float and potentially hex if it were converted to 24-bit fixed point
        const fStr = val.toFixed(6);
        const iVal = Math.floor(val * 8388608.0) & 0xFFFFFF;
        return `${fStr} ($${iVal.toString(16).toUpperCase().padStart(6, '0')})`;
    }

    private step(response: any) {
        this.executeOne();
        this.sendEvent('stopped', { reason: 'step', threadId: 1 });
    }

    private executeOne() {
        if (this.simulator.getPC() >= this.simulator.getProgSize()) {
            this.simulator.endFrame();
            const sample = this.audioStreamer.isLoaded() ? this.audioStreamer.getNextSample() : { l: 0, r: 0 };
            const regs = this.simulator.getRegisters();
            this.simulator.beginFrame(sample.l, sample.r, regs[16], regs[17], regs[18]);
        }
        this.simulator.stepInstruction();
    }

    private continueExecution(response: any) {
        this.isRunning = true;
        if (this.timerHandle) {
            clearTimeout(this.timerHandle);
        }
        this.runLoop(true); // Signal that we are starting from (potentially) a breakpoint
        this.sendResponse(response);
    }

    private lastFrameTime: number = 0;

    private runLoop(isFirstStep: boolean = false) {
        if (!this.isRunning) return;

        const startTime = Date.now();
        const blockDurationMs = 40; // 40ms blocks (25fps) for smoother visualization
        const samplesToProcess = Math.floor(this.sampleRate * (blockDurationMs / 1000));

        const outL = new Float32Array(samplesToProcess);
        const outR = new Float32Array(samplesToProcess);

        // Snapshot state BEFORE processing the block for more accurate visualization
        const regs = this.simulator.getRegisters();
        const pot0 = regs[16];
        const pot1 = regs[17];
        const pot2 = regs[18];
        const snapshotDelayPtr = this.simulator.getDelayPointer();
        const snapshotAddrPtr = regs[24];

        const lfoSin0 = new Float32Array(Math.ceil(samplesToProcess / this.oscilloscopeRefreshRate));
        const numSamplesPerTrace = lfoSin0.length;

        // Trace data for all 64 registers
        const registerTraces: Float32Array[] = this.oscilloscopeEnabled
            ? Array.from({ length: 64 }, () => new Float32Array(numSamplesPerTrace))
            : [];
        let traceIdx = 0;

        for (let i = 0; i < samplesToProcess; i++) {
            const inSample = this.audioStreamer.getNextSample();
            const skip = isFirstStep && i === 0;
            const [oL, oR, breakpointHit] = this.simulator.step(inSample.l, inSample.r, pot0, pot1, pot2, skip);

            // Sample all registers based on refresh rate
            if (this.oscilloscopeEnabled && i % this.oscilloscopeRefreshRate === 0 && traceIdx < numSamplesPerTrace) {
                const currentRegs = this.simulator.getRegisters();
                for (let r = 0; r < 64; r++) {
                    registerTraces[r][traceIdx] = currentRegs[r];
                }
                traceIdx++;
            }

            if (this.bypassActive) {
                outL[i] = inSample.l;
                outR[i] = inSample.r;
            } else {
                outL[i] = oL;
                outR[i] = oR;
            }

            if (breakpointHit) {
                this.isRunning = false;
                this.sendEvent('stopped', { reason: 'breakpoint', threadId: 1 });
                if (i > 0 && this.audioEngine) {
                    this.audioEngine.playBuffer(outL.slice(0, i), outR.slice(0, i), inSample.l, inSample.r);
                }
                return;
            }
        }

        if (this.audioEngine) {
            const lastSample = this.audioStreamer.getLastSample();
            const elapsed = Date.now() - startTime;
            const msPerSample = elapsed / samplesToProcess;

            const metadata: any = {
                loaded: this.audioStreamer.isLoaded(),
                numSamples: this.audioStreamer.getNumSamples(),
                currentField: this.audioStreamer.getCurrentSample(),
                msPerSample: msPerSample
            };

            // Only send expensive metadata if visualizations are enabled
            if (this.oscilloscopeEnabled) {
                metadata.registerTraces = registerTraces;
                metadata.delayPtr = snapshotDelayPtr;
                metadata.delaySize = this.simulator.getDelaySize();
                metadata.addrPtr = snapshotAddrPtr;
                metadata.memories = this.symbolsChanged ? this.memories : undefined;
                metadata.symbols = this.symbolsChanged ? this.symbols : undefined;
            }

            this.audioEngine.playBuffer(outL, outR, lastSample.l, lastSample.r, metadata);
            this.symbolsChanged = false;
        }

        const elapsed = Date.now() - startTime;

        // Drift-free scheduling: 
        // We track the 'ideal' next time we should start.
        const now = Date.now();
        if (isFirstStep || this.lastFrameTime === 0 || now > this.lastFrameTime + blockDurationMs * 2) {
            this.lastFrameTime = now;
        }

        this.lastFrameTime += blockDurationMs;
        const delay = Math.max(1, this.lastFrameTime - Date.now());

        if (elapsed > 40) {
            console.log(`[FV1 PERF] Simulation heavy: ${elapsed}ms for ${blockDurationMs}ms block`);
        }

        this.timerHandle = setTimeout(() => this.runLoop(false), delay);
    }

    private sendResponse(response: any) {
        this._sendMessage.fire(response);
    }

    private sendEvent(event: string, body?: any) {
        this._sendMessage.fire({
            type: 'event',
            event,
            body
        } as vscode.DebugProtocolMessage);
    }

    public dispose() {
        this.isRunning = false;
        if (this.timerHandle) {
            clearTimeout(this.timerHandle);
            this.timerHandle = null;
        }
    }

    private async handleStimulusChange(m: any) {
        if (m.value === 'none') {
            this.audioStreamer.unload();
            this.sendEvent('output', { category: 'console', output: `Input stimulus: None (Silence)\n` });
        } else if (m.value === 'tone') {
            this.audioStreamer.unload();
            this.audioStreamer.setToneEnabled(true);
            this.sendEvent('output', { category: 'console', output: `Input stimulus: 440Hz Test Tone\n` });
        } else if (m.value === 'built-in') {
            this.audioStreamer.unload();
            const defaultWav = 'src/simulator/wav/minor-chords-32k.wav';
            const resolved = this.resolveWavPath(defaultWav, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
            if (resolved) {
                await this.audioStreamer.loadWav(resolved);
                this.sendEvent('output', { category: 'console', output: `Input stimulus: Built-in loop\n` });
            }
        } else if (m.value === 'custom' && m.filePath) {
            this.audioStreamer.unload();
            try {
                await this.audioStreamer.loadWav(m.filePath);
                this.sendEvent('output', { category: 'console', output: `Input stimulus: ${path.basename(m.filePath)}\n` });
            } catch (e: any) {
                this.sendEvent('output', { category: 'stderr', output: `Failed to load ${m.filePath}: ${e.message}\n` });
            }
        }
    }
}
