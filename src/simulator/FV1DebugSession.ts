import * as vscode from 'vscode';
import * as fs from 'fs';
import { FV1Simulator } from './FV1Simulator.js';
import { FV1Assembler } from '../FV1Assembler.js';

export class FV1DebugSession implements vscode.DebugAdapter {
    private simulator: FV1Simulator;
    private assembler: FV1Assembler;
    private _sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    public onDidSendMessage = this._sendMessage.event;

    private sourcePath: string = '';
    private addressToLineMap = new Map<number, number>();
    private lineToAddressMap = new Map<number, number>();
    private maxMappedAddr = -1;
    private breakpoints = new Set<number>();
    private isRunning = false;
    private stopOnEntry = false;
    private timerHandle: any = null;

    // Source mapping
    private symbols: any[] = [];
    private memories: any[] = [];

    // Variables storage
    private nextVarHandle = 1;
    private varHandles = new Map<number, { type: string, getter: () => any[] }>();

    constructor() {
        this.simulator = new FV1Simulator();
        this.assembler = new FV1Assembler();
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
        this.sourcePath = args.program;
        this.stopOnEntry = !!args.stopOnEntry;
        if (!this.sourcePath || !fs.existsSync(this.sourcePath)) {
            throw new Error(`Program path does not exist: ${this.sourcePath}`);
        }

        const source = fs.readFileSync(this.sourcePath, 'utf8');
        const result = this.assembler.assemble(source);

        if (result.problems.some(p => p.isfatal)) {
            throw new Error(`Assembly failed: ${result.problems[0].message}`);
        }

        this.simulator.loadProgram(new Uint32Array(result.machineCode));
        this.addressToLineMap = result.addressToLineMap;
        this.symbols = result.symbols;
        this.memories = result.memories;

        this.lineToAddressMap.clear();
        this.maxMappedAddr = -1;
        for (const [addr, line] of this.addressToLineMap) {
            this.lineToAddressMap.set(line, addr);
            if (addr > this.maxMappedAddr) this.maxMappedAddr = addr;
        }

        this.simulator.reset();
    }

    private setBreakpoints(args: any, response: any) {
        const clientBps = args.breakpoints || [];
        const actualBps: any[] = [];
        this.breakpoints.clear();

        for (const bp of clientBps) {
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
        let pc = this.simulator.getPC();

        // Handle the case where we are at the end of a frame or past it
        if (pc >= 128) {
            pc = 0;
        }

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
            { name: "Registers", variablesReference: this.createVarHandle("registers", () => this.getRegistersVars()), expensive: false },
            { name: "Program Variables", variablesReference: this.createVarHandle("program", () => this.getProgramVars()), expensive: false },
            { name: "Accumulator/Flags", variablesReference: this.createVarHandle("accflags", () => this.getAccFlagsVars()), expensive: false },
            { name: "Delay RAM (Partial)", variablesReference: this.createVarHandle("delayram", () => this.getDelayRamVars()), expensive: true }
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
            const regs = this.simulator.getRegisters();
            const state = this.simulator.getState();
            // Find index by name mapping
            const entry = Object.entries(state.registers).find(([n, _]) => n === name);
            if (entry) {
                // If it's a REGx name, it might be in the 32-63 range
                const regIdxMatch = name.match(/^REG(\d+)$/);
                if (regIdxMatch) {
                    const idx = parseInt(regIdxMatch[1]);
                    regs[32 + idx] = value;
                } else {
                    // Try to find the hardware index for named registers
                    const hwNames = ["SIN0_RATE", "SIN0_RANGE", "SIN1_RATE", "SIN1_RANGE", "RMP0_RATE", "RMP0_RANGE", "RMP1_RATE", "RMP1_RANGE"];
                    const hwIdx = hwNames.indexOf(name);
                    if (hwIdx !== -1) {
                        regs[hwIdx] = value;
                    } else {
                        const otherNames: Record<string, number> = {
                            "POT0": 16, "POT1": 17, "POT2": 18,
                            "ADCL": 20, "ADCR": 21, "DACL": 22, "DACR": 23, "ADDR_PTR": 24
                        };
                        if (otherNames[name] !== undefined) {
                            regs[otherNames[name]] = value;
                        }
                    }
                }
            }
        } else if (info.type === 'accflags') {
            if (name === "ACC") this.simulator.setAcc(value);
            else if (name === "PACC") this.simulator.setPacc(value);
            // Flags are usually read-only in this simple sim
        }

        response.body = { value: this.formatValue(value) };
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

    private getDelayRamVars(): any[] {
        const ram = this.simulator.getDelayRam();
        // Only show non-zero values or a small window to avoid overwhelming
        const vars: any[] = [];
        for (let i = 0; i < 100; i++) { // First 100
            vars.push({ name: `[${i}]`, value: this.formatValue(ram[i]), type: "float", variablesReference: 0 });
        }
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
        this.simulator.stepInstruction();
        const pc = this.simulator.getPC();

        // If we reached the end of 128 instructions OR entered the padding zone, wrap around
        // Padding zone is defined as pc > maxMappedAddr AND pc not in addressToLineMap
        if (pc >= 128 || (pc > this.maxMappedAddr && !this.addressToLineMap.has(pc))) {
            this.simulator.setPC(0);
            this.simulator.endFrame();
            this.simulator.beginFrame();
        }
    }

    private continueExecution(response: any) {
        this.isRunning = true;
        if (this.timerHandle) {
            clearTimeout(this.timerHandle);
        }
        this.runLoop();
        this.sendResponse(response);
    }

    private runLoop() {
        if (!this.isRunning) return;

        this.executeOne();
        const pc = this.simulator.getPC();
        if (this.breakpoints.has(pc)) {
            this.isRunning = false;
            this.sendEvent('stopped', { reason: 'breakpoint', threadId: 1 });
            return;
        }

        this.timerHandle = setTimeout(() => this.runLoop(), 10); // Simulation speed
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
}
