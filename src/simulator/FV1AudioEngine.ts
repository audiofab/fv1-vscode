import * as vscode from 'vscode';

/**
 * Manages audio playback using a VS Code Webview View and the Web Audio API.
 * Uses a jitter buffer to ensure smooth playback across the IPC bridge.
 */
export class FV1AudioEngine implements vscode.WebviewViewProvider {
    public static readonly viewType = 'fv1Monitor';

    private _view?: vscode.WebviewView;
    private isReady: boolean = false;
    private sampleRate: number = 32768;
    private pendingMetadata: any = null;
    private currentStimulus: any = { type: 'stimulusChange', value: 'built-in' }; // Default to chords

    private _onMessage = new vscode.EventEmitter<any>();
    public readonly onMessage = this._onMessage.event;

    constructor(sampleRate: number = 32768) {
        this.sampleRate = sampleRate;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            enableMediaStream: true,
        } as any;

        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(m => {
            if (m.type === 'ready') {
                this.isReady = true;
                console.log('FV1 Audio Engine Ready (View)');
                if (this.pendingMetadata && this._view) {
                    this._view.webview.postMessage({
                        type: 'play',
                        l: new Float32Array(0),
                        r: new Float32Array(0),
                        metadata: this.pendingMetadata
                    });
                    this.pendingMetadata = null;
                }
            } else if (m.type === 'selectCustomFile') {
                this.handleSelectCustomFile();
            } else {
                if (m.type === 'stimulusChange') {
                    this.currentStimulus = m;
                }
                // Relay other messages (bypass, pot change, stimulus change) to listeners
                this._onMessage.fire(m);
            }
        });

        webviewView.onDidDispose(() => {
            this._view = undefined;
            this.isReady = false;
        });
    }

    private async handleSelectCustomFile() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Select WAV File',
            filters: {
                'Audio': ['wav']
            }
        });

        if (uris && uris[0]) {
            this.currentStimulus = {
                type: 'stimulusChange',
                value: 'custom',
                filePath: uris[0].fsPath
            };
            this._onMessage.fire(this.currentStimulus);

            // Note: We could update the UI here, but we rely on the simulator to load it.
        }
    }

    /**
     * Sends a buffer of samples to the webview for playback.
     */
    public playBuffer(l: Float32Array, r: Float32Array, _adcL: number = 0, _adcR: number = 0, metadata: any = null) {
        if (metadata) this.pendingMetadata = metadata;

        if (!this.isReady || !this._view) return;

        this._view.webview.postMessage({
            type: 'play',
            l,
            r,
            metadata: this.pendingMetadata
        });
        this.pendingMetadata = null;
    }

    public stop() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'stop' });
        }
    }

    public getStimulus() {
        return this.currentStimulus;
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { background: transparent; color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 10px; overflow-x: hidden; }
                    .container { display: flex; flex-direction: column; gap: 12px; }
                    
                    .viz-box { background: var(--vscode-sideBar-background); padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-widget-border); position: relative; }
                    .viz-label { color: var(--vscode-descriptionForeground); font-size: 9px; text-transform: uppercase; margin-bottom: 6px; }
                    .scope-canvas { background: #000; border-radius: 2px; width: 100%; height: 120px; margin-bottom: 4px; }
                    .small-canvas { background: #000; border-radius: 2px; width: 100%; height: 60px; }
                    
                    .controls-box { background: var(--vscode-sideBar-background); padding: 10px; border-radius: 4px; border: 1px solid var(--vscode-widget-border); }
                    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
                    .section-title { font-size: 11px; font-weight: bold; color: var(--vscode-settings-headerForeground); }

                    .pot-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
                    .pot-label { color: var(--vscode-foreground); font-size: 10px; width: 35px; }
                    .pot-slider { flex: 1; height: 2px; cursor: pointer; accent-color: var(--vscode-button-background); }
                    .pot-value { font-family: var(--vscode-editor-font-family); font-size: 10px; width: 30px; color: var(--vscode-descriptionForeground); text-align: right; }

                    .stimulus-box { margin-top: 4px; }
                    select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); width: 100%; font-size: 11px; padding: 2px; outline: none; }
                    
                    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; font-size: 10px; cursor: pointer; border-radius: 2px; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    button.active { background: #e81123; color: white; font-weight: bold; }

                    #overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; cursor: pointer; text-align: center; }

                    /* Legend and Register Selector */
                    .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
                    .legend-item { font-size: 8px; padding: 1px 4px; border-radius: 2px; cursor: pointer; border: 1px solid transparent; opacity: 0.6; transition: opacity 0.2s; }
                    .legend-item.active { opacity: 1; border-color: currentColor; font-weight: bold; }
                    .legend-item:hover { opacity: 0.9; background: rgba(255,255,255,0.1); }

                    .selector-trigger { font-size: 8px; color: var(--vscode-button-background); cursor: pointer; text-decoration: underline; margin-top: 4px; display: inline-block; }
                    
                    #regSelectorModal {
                        display: none;
                        position: fixed;
                        top: 20px;
                        left: 20px;
                        right: 20px;
                        bottom: 20px;
                        background: var(--vscode-sideBar-background);
                        border: 1px solid var(--vscode-widget-border);
                        z-index: 200;
                        padding: 10px;
                        flex-direction: column;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    }
                    .modal-header { font-size: 11px; font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between; }
                    .reg-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 4px; }
                    .reg-option { font-size: 9px; padding: 2px 4px; cursor: pointer; border: 1px solid transparent; border-radius: 2px; display: flex; align-items: center; gap: 4px; }
                    .reg-option:hover { background: rgba(255,255,255,0.1); }
                    .reg-option.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
                    .reg-check { width: 8px; height: 8px; border: 1px solid var(--vscode-foreground); flex-shrink: 0; }
                    .selected .reg-check { background: var(--vscode-foreground); }

                    /* Tooltip Style */
                    #memTooltip {
                        position: fixed;
                        display: none;
                        background: rgba(0, 0, 0, 0.9);
                        color: #4facfe;
                        padding: 4px 8px;
                        border: 1px solid #4facfe;
                        border-radius: 4px;
                        font-size: 10px;
                        pointer-events: none;
                        z-index: 1000;
                        white-space: nowrap;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                    }

                    .perf-stats {
                        font-family: var(--vscode-editor-font-family);
                        font-size: 8px;
                        color: var(--vscode-descriptionForeground);
                        opacity: 0.6;
                        text-align: right;
                        margin-top: 8px;
                    }
                </style>
            </head>
            <body>
                <div id="overlay">
                    <div style="padding: 20px;">
                        <div style="font-size: 24px; margin-bottom: 10px;">🎧</div>
                        <div style="font-size: 12px; color: #fff; font-weight: bold;">Click to Enable Audio Monitor</div>
                    </div>
                </div>

                <div id="regSelectorModal">
                    <div class="modal-header">
                        <span>Select Registers to Plot</span>
                        <span id="closeSelector" style="cursor: pointer;">✕</span>
                    </div>
                    <div id="regGrid" class="reg-grid"></div>
                    <div style="margin-top: 10px; text-align: right;">
                        <button id="applySelector">Apply</button>
                    </div>
                </div>

                <div class="container">
                    <div class="controls-box">
                        <div class="section-header">
                            <div class="section-title">Input Stimulus</div>
                        </div>
                        <div class="stimulus-box">
                            <select id="stimulusSelect">
                            <option value="none">Silence (No Input)</option>
                            <option value="tone">Built-in: 440Hz Test Tone</option>
                            <option value="built-in" selected>Built-in: Minor Chords</option>
                            <option value="custom">Select Custom File...</option>
                        </select>
                        </div>
                    </div>

                    <div id="scopeBox" class="viz-box">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <div class="viz-label">Oscilloscope</div>
                            <div style="display: flex; gap: 4px;">
                                <button id="zoomOut" title="Zoom Out" style="padding: 1px 6px;">-</button>
                                <span id="zoomDisplay" style="font-size: 8px; min-width: 20px; text-align: center; line-height: 1.8;">1x</span>
                                <button id="zoomIn" title="Zoom In" style="padding: 1px 6px;">+</button>
                            </div>
                        </div>
                        <canvas id="scope" width="400" height="120" class="scope-canvas"></canvas>
                        <div id="scopeLegend" class="legend"></div>
                        <div id="openSelector" class="selector-trigger">Manage Registers...</div>
                    </div>

                    <div id="memBox" class="viz-box">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <div class="viz-label">Delay Memory Map</div>
                            <div style="font-size: 8px; display: flex; gap: 4px; opacity: 0.8;">
                                <span style="color: rgba(255, 255, 255, 0.8);">WRITE</span>
                                <span style="color: #ff4444;">READ</span>
                            </div>
                        </div>
                        <canvas id="memMap" width="200" height="60" class="small-canvas"></canvas>
                        <div style="display: flex; justify-content: space-between; font-size: 7px; opacity: 0.5; margin-top: 1px; font-family: monospace;">
                            <span>$7FFF</span>
                            <span>$0000</span>
                        </div>
                    </div>

                    <div id="perfStats" class="perf-stats">Sim Execution: -- ms/sample</div>

                    <div id="memTooltip"></div>

                    <div class="controls-box">
                        <div class="section-header">
                            <div class="section-title">DSP Controls</div>
                            <button id="bypassBtn">BYPASS</button>
                        </div>
                        <div class="pot-row">
                            <span class="pot-label">POT0</span>
                            <input type="range" id="pot0" class="pot-slider" min="0" max="1" step="0.001" value="0.5">
                            <span id="p0v" class="pot-value">0.50</span>
                        </div>
                        <div class="pot-row">
                            <span class="pot-label">POT1</span>
                            <input type="range" id="pot1" class="pot-slider" min="0" max="1" step="0.001" value="0.5">
                            <span id="p1v" class="pot-value">0.50</span>
                        </div>
                        <div class="pot-row">
                            <span class="pot-label">POT2</span>
                            <input type="range" id="pot2" class="pot-slider" min="0" max="1" step="0.001" value="0.5">
                            <span id="p2v" class="pot-value">0.50</span>
                        </div>
                    </div>

                    <div id="status" style="color: var(--vscode-descriptionForeground); font-size: 9px; text-align: center;">Initializing...</div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let audioCtx = null;
                    let startTime = 0;
                    const sampleRate = ${this.sampleRate};
                    
                    const scopeCanvas = document.getElementById('scope');
                    const scopeCtx = scopeCanvas.getContext('2d');
                    const memCanvas = document.getElementById('memMap');
                    const memCtx = memCanvas.getContext('2d');

                    const overlay = document.getElementById('overlay');
                    const bypassBtn = document.getElementById('bypassBtn');
                    const stimulusSelect = document.getElementById('stimulusSelect');
                    const scopeBox = document.getElementById('scopeBox');
                    const memBox = document.getElementById('memBox');
                    const perfStats = document.getElementById('perfStats');
                    const zoomIn = document.getElementById('zoomIn');
                    const zoomOut = document.getElementById('zoomOut');
                    const zoomDisplay = document.getElementById('zoomDisplay');

                    let currentRefreshRate = 1; // Track for display
                    
                    const openSelector = document.getElementById('openSelector');
                    const closeSelector = document.getElementById('closeSelector');
                    const applySelector = document.getElementById('applySelector');
                    const regSelectorModal = document.getElementById('regSelectorModal');
                    const regGrid = document.getElementById('regGrid');
                    const scopeLegend = document.getElementById('scopeLegend');

                    let bypassActive = false;
                    let bufferQueue = [];
                    let isBuffering = true;

                    // Multi-Trace History
                    let SCOPE_HISTORY_LEN = 200;
                    let registerHistory = {}; // Map of regIdx -> Float32Array
                    let registerPtr = 0;
                    let selectedRegisters = [22, 23]; // Default DACL, DACR
                    let symbols = [];
                    let registerLabels = {}; // Cache of labels
                    let hiddenRegisters = new Set(); // Track hidden indices
                    let zoomLevel = 1;

                    const TRACE_COLORS = [
                        '#00ff00', '#ff4444', '#4facfe', '#ff00ff', 
                        '#ffaa00', '#ffffff', '#ffff00', '#00ffff'
                    ];

                    function updateStatus(msg) {
                        document.getElementById('status').innerText = msg;
                    }

                    ['pot0', 'pot1', 'pot2'].forEach((id, index) => {
                        const slider = document.getElementById(id);
                        const valDisplay = document.getElementById('p' + index + 'v');
                        slider.addEventListener('input', () => {
                            const val = parseFloat(slider.value);
                            valDisplay.innerText = val.toFixed(2);
                            vscode.postMessage({ type: 'potChange', pot: index, value: val });
                        });
                    });

                    bypassBtn.addEventListener('click', () => {
                        bypassActive = !bypassActive;
                        bypassBtn.className = bypassActive ? 'active' : '';
                        vscode.postMessage({ type: 'bypassChange', active: bypassActive });
                    });

                    stimulusSelect.addEventListener('change', () => {
                        if (stimulusSelect.value === 'custom') {
                            vscode.postMessage({ type: 'selectCustomFile' });
                        } else {
                            vscode.postMessage({ type: 'stimulusChange', value: stimulusSelect.value });
                        }
                    });

                    function updateZoom(newZoom) {
                        zoomLevel = Math.max(1, Math.min(10, newZoom));
                        SCOPE_HISTORY_LEN = 200 * zoomLevel;
                        updateZoomDisplay();
                        initHistory();
                        vscode.postMessage({ type: 'configChange', zoomLevel: zoomLevel });
                    }

                    function updateZoomDisplay() {
                        const duration = (SCOPE_HISTORY_LEN * currentRefreshRate) / sampleRate;
                        zoomDisplay.innerText = duration.toFixed(3) + 's';
                    }

                    zoomIn.addEventListener('click', () => updateZoom(zoomLevel + 1));
                    zoomOut.addEventListener('click', () => updateZoom(zoomLevel - 1));

                    // Selector Logic
                    openSelector.addEventListener('click', () => {
                        renderSelectorGrid();
                        regSelectorModal.style.display = 'flex';
                    });
                    closeSelector.addEventListener('click', () => regSelectorModal.style.display = 'none');
                    applySelector.addEventListener('click', () => {
                        const items = regGrid.querySelectorAll('.reg-option.selected');
                        selectedRegisters = Array.from(items).map(i => parseInt(i.dataset.reg));
                        regSelectorModal.style.display = 'none';
                        initHistory();
                        renderLegend();
                        vscode.postMessage({ type: 'registerSelectionChange', selection: selectedRegisters });
                    });

                    function getRegisterLabel(idx) {
                        if (registerLabels[idx]) return registerLabels[idx];
                        
                        // Check standard aliases
                        const standard = {
                            0: 'SIN0_RT', 1: 'SIN0_RG', 2: 'SIN1_RT', 3: 'SIN1_RG',
                            4: 'RMP0_RT', 5: 'RMP0_RG', 6: 'RMP1_RT', 7: 'RMP1_RG',
                            8: 'SIN0', 9: 'COS0', 10: 'SIN1', 11: 'COS1', 12: 'RMP0', 13: 'RMP1',
                            16: 'POT0', 17: 'POT1', 18: 'POT2',
                            20: 'ADCL', 21: 'ADCR', 22: 'DACL', 23: 'DACR', 24: 'ADDR_PTR'
                        };
                        if (standard[idx] !== undefined) {
                            registerLabels[idx] = standard[idx];
                            return standard[idx];
                        }
                        
                        // Prioritize General Purpose registers (32-63) fallback logic 
                        // if symbols are suspicious or just generally.
                        // But let's check for symbols first, then fallback.
                        // The user reported index 32 showing as "NA". 
                        // Let's check symbols but ignore "NA" if found.
                        const sym = symbols.find(s => parseInt(s.value) === idx && s.name !== 'NA');
                        if (sym) {
                            registerLabels[idx] = sym.name;
                            return sym.name;
                        }
                        
                        if (idx >= 32 && idx < 64) {
                            const label = 'REG' + (idx - 32);
                            registerLabels[idx] = label;
                            return label;
                        }
                        
                        return 'R' + idx;
                    }

                    function renderSelectorGrid() {
                        regGrid.innerHTML = '';
                        
                        // Filter registers: We only want standard registers, user symbols, or General Purpose (32-63)
                        const standardIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 20, 21, 22, 23, 24];
                        const symbolIndices = symbols.map(s => parseInt(s.value));
                        
                        for (let i = 0; i < 64; i++) {
                            const isStandard = standardIndices.includes(i);
                            const isSymbol = symbolIndices.includes(i);
                            const isGP = (i >= 32 && i < 64);
                            
                            if (isStandard || isSymbol || isGP) {
                                const opt = document.createElement('div');
                                opt.className = 'reg-option' + (selectedRegisters.includes(i) ? ' selected' : '');
                                opt.dataset.reg = i;
                                opt.innerHTML = '<div class="reg-check"></div>' + getRegisterLabel(i);
                                opt.onclick = () => opt.classList.toggle('selected');
                                regGrid.appendChild(opt);
                            }
                        }
                    }

                    function renderLegend() {
                        scopeLegend.innerHTML = '';
                        selectedRegisters.forEach((reg, i) => {
                            const item = document.createElement('div');
                            const isActive = !hiddenRegisters.has(reg);
                            item.className = 'legend-item' + (isActive ? ' active' : '');
                            item.style.color = TRACE_COLORS[i % TRACE_COLORS.length];
                            item.innerText = getRegisterLabel(reg);
                            item.onclick = () => {
                                if (hiddenRegisters.has(reg)) {
                                    hiddenRegisters.delete(reg);
                                } else {
                                    hiddenRegisters.add(reg);
                                }
                                renderLegend(); // Immediate feedback
                                drawTraces();
                            };
                            scopeLegend.appendChild(item);
                        });
                    }

                    function initHistory() {
                        registerHistory = {};
                        selectedRegisters.forEach(reg => {
                            registerHistory[reg] = new Float32Array(SCOPE_HISTORY_LEN);
                        });
                        registerPtr = 0;
                    }

                    async function initAudio() {
                        if (audioCtx) {
                            if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch(e) {} }
                            if (audioCtx.state === 'running') { hideOverlay(); return true; }
                        }
                        try {
                            const AudioContext = window.AudioContext || window.webkitAudioContext;
                            audioCtx = new AudioContext({ sampleRate });
                            updateStatus('Live | ' + audioCtx.sampleRate + 'Hz');
                            if (audioCtx.state === 'running') hideOverlay();
                            return true;
                        } catch (e) {
                            updateStatus('Error: ' + e.message);
                            return false;
                        }
                    }

                    function hideOverlay() {
                        overlay.style.opacity = '0';
                        setTimeout(() => overlay.style.display = 'none', 300);
                    }

                    overlay.addEventListener('click', async () => { await initAudio(); });

                    window.addEventListener('message', async event => {
                        const message = event.data;
                        if (message.type === 'play') {
                            if (message.metadata) {
                                const m = message.metadata;
                                
                                if (m.type === 'registerSelection') {
                                    selectedRegisters = m.selection;
                                    initHistory();
                                    renderLegend();
                                    return;
                                }

                                if (m.symbols) {
                                    symbols = m.symbols;
                                    registerLabels = {}; // Reset cache
                                    renderLegend();
                                }

                                if (m.registerTraces) {
                                    const traces = m.registerTraces;
                                    const numPoints = traces[0].length;
                                    
                                    for (let i = 0; i < numPoints; i++) {
                                        selectedRegisters.forEach(reg => {
                                            if (registerHistory[reg]) {
                                                registerHistory[reg][registerPtr] = traces[reg][i];
                                            }
                                        });
                                        registerPtr = (registerPtr + 1) % SCOPE_HISTORY_LEN;
                                    }
                                    drawTraces();
                                }

                                if (m.delayPtr !== undefined) {
                                    drawMemMap(m.delayPtr, m.delaySize, m.addrPtr, m.memories);
                                }

                                if (m.msPerSample !== undefined) {
                                    perfStats.innerText = 'Sim Execution: ' + m.msPerSample.toFixed(4) + ' ms/sample';
                                } else {
                                    perfStats.innerText = 'Sim Execution: -- ms/sample';
                                }
                            }

                            if (!message.l || message.l.length === 0) return;

                            bufferQueue.push({ l: message.l, r: message.r });

                            if (isBuffering && bufferQueue.length >= 2) {
                                isBuffering = false;
                                if (!audioCtx || audioCtx.state !== 'running') await initAudio();
                            }

                            if (!isBuffering && audioCtx && audioCtx.state === 'running') {
                                processQueue();
                            }
                        } else if (message.type === 'stop') {
                            isBuffering = true;
                            bufferQueue = [];
                            startTime = 0;
                            updateStatus('Ready');
                        } else if (message.type === 'config') {
                            // Restore state
                            if (message.oscilloscopeEnabled !== undefined) {
                                scopeBox.style.display = message.oscilloscopeEnabled ? 'block' : 'none';
                                memBox.style.display = message.oscilloscopeEnabled ? 'block' : 'none';
                            }
                            if (message.oscilloscopeRefreshRate !== undefined) {
                                currentRefreshRate = message.oscilloscopeRefreshRate;
                                updateZoomDisplay();
                            }
                            if (message.zoomLevel !== undefined) {
                                zoomLevel = message.zoomLevel;
                                SCOPE_HISTORY_LEN = 200 * zoomLevel;
                                updateZoomDisplay();
                                initHistory();
                            }
                        }
                    });

                    // Request initial config
                    vscode.postMessage({ type: 'requestConfig' });
                    updateZoomDisplay(); // Initial display

                    function processQueue() {
                        while (audioCtx && audioCtx.state === 'running' && bufferQueue.length > 0) {
                            const block = bufferQueue.shift();
                            const buffer = audioCtx.createBuffer(2, block.l.length, sampleRate);
                            buffer.getChannelData(0).set(block.l);
                            buffer.getChannelData(1).set(block.r);

                            const source = audioCtx.createBufferSource();
                            source.buffer = buffer;
                            source.connect(audioCtx.destination);

                            const now = audioCtx.currentTime;
                            if (startTime < now - 0.05) {
                                startTime = now + 0.1;
                            }

                            source.start(startTime);
                            startTime += buffer.duration;
                        }
                    }

                    function drawTraces() {
                        const w = scopeCanvas.width;
                        const h = scopeCanvas.height;
                        scopeCtx.clearRect(0, 0, w, h);
                        
                        // Draw grid lines
                        scopeCtx.strokeStyle = '#222';
                        scopeCtx.lineWidth = 1;
                        scopeCtx.beginPath();
                        scopeCtx.moveTo(0, h/2); scopeCtx.lineTo(w, h/2);
                        scopeCtx.stroke();

                        selectedRegisters.forEach((reg, traceIdx) => {
                            const data = registerHistory[reg];
                            if (!data) return;

                            // Use the hiddenRegisters set
                            if (hiddenRegisters.has(reg)) return;

                            scopeCtx.beginPath();
                            scopeCtx.strokeStyle = TRACE_COLORS[traceIdx % TRACE_COLORS.length];
                            scopeCtx.lineWidth = 1.2;
                            
                            for (let i = 0; i < SCOPE_HISTORY_LEN; i++) {
                                const idx = (registerPtr + i) % SCOPE_HISTORY_LEN;
                                const val = data[idx];
                                const x = (i / SCOPE_HISTORY_LEN) * w;
                                const y = (1 - (val + 1) / 2) * h;
                                if (i === 0) scopeCtx.moveTo(x, y);
                                else scopeCtx.lineTo(x, y);
                            }
                            scopeCtx.stroke();
                        });
                    }

                    let lastMemories = [];
                    const memTooltip = document.getElementById('memTooltip');

                    memCanvas.addEventListener('mousemove', (e) => {
                        if (!lastMemories || lastMemories.length === 0) return;
                        const rect = memCanvas.getBoundingClientRect();
                        const scaleX = memCanvas.width / rect.width;
                        const x = (e.clientX - rect.left) * scaleX;
                        
                        const w = memCanvas.width;
                        const size = 32768;
                        const getX = (p) => ((size - 1 - (p % size)) / size) * w;

                        let found = null;
                        lastMemories.forEach(m => {
                            const blockX = getX(m.start + m.size);
                            const blockWidth = (m.size / size) * w;
                            if (x >= blockX && x <= blockX + blockWidth) {
                                found = m;
                            }
                        });

                        if (found) {
                            memTooltip.style.display = 'block';
                            memTooltip.innerText = found.name;
                            const threshold = window.innerWidth * 0.6;
                            if (e.clientX > threshold) {
                                memTooltip.style.left = 'auto';
                                memTooltip.style.right = (window.innerWidth - e.clientX + 10) + 'px';
                            } else {
                                memTooltip.style.right = 'auto';
                                memTooltip.style.left = (e.clientX + 10) + 'px';
                            }
                            memTooltip.style.top = (e.clientY - 25) + 'px';
                        } else {
                            memTooltip.style.display = 'none';
                        }
                    });

                    memCanvas.addEventListener('mouseout', () => {
                        memTooltip.style.display = 'none';
                    });

                    function drawMemMap(ptr, size, addrPtr, memories) {
                        lastMemories = memories || [];
                        const w = memCanvas.width;
                        const h = memCanvas.height;
                        memCtx.clearRect(0, 0, w, h);
                        memCtx.fillStyle = '#111';
                        memCtx.fillRect(0, 0, w, h);

                        const getX = (p) => ((size - 1 - (p % size)) / size) * w;

                        if (memories) {
                            memCtx.fillStyle = 'rgba(79, 172, 254, 0.4)';
                            memCtx.strokeStyle = '#4facfe';
                            memCtx.lineWidth = 0.5;
                            memories.forEach(m => {
                                const x = getX(m.start + m.size);
                                const width = (m.size / size) * w;
                                memCtx.fillRect(x, 2, width, h - 4);
                                memCtx.strokeRect(x, 2, width, h - 4);
                            });
                        }

                        const writeX = getX(ptr);
                        memCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                        memCtx.lineWidth = 1;
                        memCtx.beginPath();
                        memCtx.moveTo(writeX, 0);
                        memCtx.lineTo(writeX, h);
                        memCtx.stroke();

                        if (addrPtr !== undefined) {
                            const readIdx = (ptr + Math.floor(addrPtr * size)) % size;
                            const readX = getX(readIdx);
                            memCtx.strokeStyle = '#ff4444';
                            memCtx.lineWidth = 1.5;
                            memCtx.beginPath();
                            memCtx.moveTo(readX, 0);
                            memCtx.lineTo(readX, h);
                            memCtx.stroke();
                        }
                    }

                    // Initialization
                    initHistory();
                    renderLegend();
                    vscode.postMessage({ type: 'ready' });
                    vscode.postMessage({ type: 'requestRegisterSelection' });
                    updateStatus('Ready');
                </script>
            </body>
            </html>
        `;
    }
}
