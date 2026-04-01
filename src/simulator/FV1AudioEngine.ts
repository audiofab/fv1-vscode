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
    private lastMetadata: any = {};
    private currentStimulus: any = { type: 'stimulusChange', value: 'not-midnight' }; // Default to not-midnight
    private potValues: number[] = [0.5, 0.5, 0.5];
    private bypassActive: boolean = false;

    private _onMessage = new vscode.EventEmitter<any>();
    public readonly onMessage = this._onMessage.event;

    constructor(sampleRate: number = 32768) {
        this.sampleRate = sampleRate;
    }

    public getPotValues(): number[] {
        return [...this.potValues];
    }

    public isBypassActive(): boolean {
        return this.bypassActive;
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

                // Restore UI state
                this._view?.webview.postMessage({
                    type: 'config',
                    potValues: this.potValues,
                    bypassActive: this.bypassActive,
                    currentStimulus: this.currentStimulus
                });

                if (this._view && Object.keys(this.lastMetadata).length > 0) {
                    this._view.webview.postMessage({
                        type: 'play',
                        l: new Float32Array(0),
                        r: new Float32Array(0),
                        metadata: this.lastMetadata
                    });
                }
            } else if (m.type === 'selectCustomFile') {
                this.handleSelectCustomFile();
            } else if (m.type === 'potChange') {
                if (m.pot >= 0 && m.pot <= 2) {
                    this.potValues[m.pot] = m.value;
                }
                this._onMessage.fire(m);
            } else if (m.type === 'bypassChange') {
                this.bypassActive = !!m.active;
                this._onMessage.fire(m);
            } else {
                if (m.type === 'stimulusChange') {
                    this.currentStimulus = m;
                }
                // Relay other messages (stimulus change) to listeners
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
        if (metadata) {
            // Config messages must go out as {type:'config'} to match the webview's
            // `else if (message.type === 'config')` handler. Routing them through
            // playBuffer would embed them in {type:'play'} and they'd be silently dropped.
            if (metadata.type === 'config') {
                if (this.isReady && this._view) {
                    this._view.webview.postMessage({ type: 'config', ...metadata });
                }
                return;
            }

            // Merge into lastMetadata, but NEVER persist 'type'.
            // If 'type' (e.g. 'registerSelection') leaked into lastMetadata it would
            // stay there forever, causing every subsequent block to hit the
            // registerSelection early-return and clear the scope history each frame.
            for (const key in metadata) {
                if (key !== 'type' && metadata[key] !== undefined) {
                    this.lastMetadata[key] = metadata[key];
                }
            }
        }

        if (!this.isReady || !this._view) return;

        // Include the current message's type (e.g. 'registerSelection') in THIS
        // message only — it is not carried forward via lastMetadata.
        const msgMetadata = (metadata?.type)
            ? { ...this.lastMetadata, type: metadata.type }
            : this.lastMetadata;

        this._view.webview.postMessage({
            type: 'play',
            l,
            r,
            metadata: msgMetadata
        });
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
                    /* Register Explorer (Collapsible) */
                    .register-explorer {
                        margin-top: 12px;
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                        background: rgba(0, 0, 0, 0.1);
                        overflow: hidden;
                    }
                    .explorer-header {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: center;
                        gap: 8px;
                        padding: 6px 10px;
                        background: var(--vscode-sideBarSectionHeader-background);
                        cursor: pointer;
                        user-select: none;
                        transition: background 0.1s;
                    }
                    .explorer-header:hover { background: var(--vscode-list-hoverBackground); }
                    .explorer-header .chevron { 
                        font-size: 8px; 
                        transition: transform 0.2s; 
                        opacity: 0.7;
                        min-width: 10px;
                    }
                    .register-explorer.expanded .chevron { transform: rotate(90deg); }
                    .explorer-header .title { 
                        font-size: 10px; 
                        font-weight: bold; 
                        text-transform: uppercase; 
                        opacity: 0.8; 
                        white-space: nowrap;
                    }
                    .explorer-header .active-summary { 
                        font-size: 9px; 
                        opacity: 0.9; 
                        font-family: var(--vscode-editor-font-family);
                        display: flex;
                        flex-wrap: wrap;
                        gap: 4px;
                        flex: 1;
                    }
                    
                    .explorer-body {
                        display: none;
                        padding: 12px 10px;
                        flex-direction: column;
                        gap: 12px;
                        max-height: 300px;
                        overflow-y: auto;
                        border-top: 1px solid var(--vscode-widget-border);
                    }
                    .register-explorer.expanded .explorer-body { display: flex; }

                    .reg-section-title {
                        font-size: 9px;
                        text-transform: uppercase;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 6px;
                        font-weight: bold;
                        border-bottom: 1px solid rgba(255,255,255,0.05);
                        padding-bottom: 2px;
                    }
                    .reg-grid { 
                        display: flex; 
                        flex-wrap: wrap; 
                        gap: 6px; 
                    }
                    .reg-pill { 
                        font-size: 9px; 
                        padding: 3px 10px; 
                        cursor: pointer; 
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 12px; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center;
                        background: rgba(255,255,255,0.02);
                        transition: all 0.2s;
                        color: var(--vscode-descriptionForeground);
                        white-space: nowrap;
                        width: auto;
                    }
                    .reg-pill:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.3); }
                    .reg-pill.active { 
                        background: rgba(255,255,255,0.1);
                        border-color: currentColor;
                        font-weight: bold;
                        opacity: 1;
                        box-shadow: 0 0 4px currentColor;
                        color: inherit; /* Set dynamically */
                    }
                    .active-summary span {
                        margin-right: 6px;
                        font-weight: bold;
                    }
                    .active-summary span:last-child { margin-right: 0; }

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


                <div class="container">
                    <div class="controls-box">
                        <div class="section-header">
                            <div class="section-title">Input Stimulus</div>
                        </div>
                        <div class="stimulus-box">
                            <select id="stimulusSelect">
                            <option value="none">Silence (No Input)</option>
                            <option value="white-noise">White Noise</option>
                            <option value="breakdown">Breakdown</option>
                            <option value="breathy">Breathy</option>
                            <option value="minor-chords">Minor Chords</option>
                            <option value="new-minor">New Minor</option>
                            <option value="not-midnight">Not Midnight</option>
                            <option value="picky">Picky</option>
                            <option value="rock-out">Rock Out</option>
                            <option value="you-three">You Three</option>
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
                        
                        <div id="registerExplorer" class="register-explorer">
                            <div id="explorerHeader" class="explorer-header">
                                <span class="chevron">▶</span>
                                <span class="title">Signals & Registers</span>
                                <span id="activeSummary" class="active-summary">DACL, DACR</span>
                            </div>
                            <div id="explorerBody" class="explorer-body">
                                <!-- Populated dynamically -->
                            </div>
                        </div>
                    </div>

                    <div id="specBox" class="viz-box">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <div class="viz-label">Spectrogram (L/R)</div>
                            <button id="toggleSpecBtn" style="padding: 1px 6px; font-size: 8px;">OFF</button>
                        </div>
                        <canvas id="spectrogram" width="400" height="120" class="scope-canvas" style="display: none;"></canvas>
                        <div id="specAxis" style="display: none; justify-content: space-between; font-size: 7px; opacity: 0.5; margin-top: 1px; font-family: monospace;">
                            <span>20 Hz</span>
                            <span>16 kHz</span>
                        </div>
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
                    const specCanvas = document.getElementById('spectrogram');
                    const specCtx = specCanvas.getContext('2d');

                    const overlay = document.getElementById('overlay');
                    const bypassBtn = document.getElementById('bypassBtn');
                    const stimulusSelect = document.getElementById('stimulusSelect');
                    const scopeBox = document.getElementById('scopeBox');
                    const memBox = document.getElementById('memBox');
                    const specBox = document.getElementById('specBox');
                    const specAxis = document.getElementById('specAxis');
                    const toggleSpecBtn = document.getElementById('toggleSpecBtn');
                    const perfStats = document.getElementById('perfStats');
                    const zoomIn = document.getElementById('zoomIn');
                    const zoomOut = document.getElementById('zoomOut');
                    const zoomDisplay = document.getElementById('zoomDisplay');

                    let currentRefreshRate = 1; // Track for display
                    
                    const explorerHeader = document.getElementById('explorerHeader');
                    const registerExplorer = document.getElementById('registerExplorer');
                    const explorerBody = document.getElementById('explorerBody');
                    const activeSummary = document.getElementById('activeSummary');

                    let bypassActive = false;
                    let bufferQueue = [];
                    let isBuffering = true;

                    // Spectrogram state
                    let specActive = false;
                    let splitterNode = null;
                    let analyserL = null;
                    let analyserR = null;
                    let freqDataL = null;
                    let freqDataR = null;
                    let specDrawId = null;

                    // Multi-Trace History
                    let SCOPE_HISTORY_LEN = 200;
                    let registerHistory = {}; // Map of regIdx -> Float32Array
                    let registerPtr = 0;
                    let selectedRegisters = [22, 23]; // Default DACL, DACR
                    let symbols = [];
                    let registerLabels = {}; // Cache of labels
                    let zoomLevel = 1;

                    const TRACE_COLORS = [
                        '#00ff00', '#ff4444', '#4facfe', '#ff00ff', 
                        '#ffaa00', '#ffffff', '#ffff00', '#00ffff',
                        '#ff8888', '#88ff88', '#8888ff', '#ff88ff',
                        '#ffff88', '#88ffff', '#ffaabb', '#aaffbb'
                    ];

                    const DURATION_PRESETS = [0.001, 0.01, 0.1, 1];
                    let durationIndex = 2; // Default to 0.1s

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

                    if (toggleSpecBtn) {
                        toggleSpecBtn.addEventListener('click', () => {
                            specActive = !specActive;
                            toggleSpecBtn.innerText = specActive ? 'ON' : 'OFF';

                            if (specActive) {
                                specCanvas.style.display = 'block';
                                specAxis.style.display = 'flex';
                                drawSpectrogramLoop();
                            } else {
                                specCanvas.style.display = 'none';
                                specAxis.style.display = 'none';
                                if (specDrawId) {
                                    cancelAnimationFrame(specDrawId);
                                    specDrawId = null;
                                }
                            }
                        });
                    }

                    stimulusSelect.addEventListener('change', () => {
                        if (stimulusSelect.value === 'custom') {
                            vscode.postMessage({ type: 'selectCustomFile' });
                        } else {
                            vscode.postMessage({ type: 'stimulusChange', value: stimulusSelect.value });
                        }
                    });

                    function updateZoom(newIndex) {
                        durationIndex = Math.max(0, Math.min(DURATION_PRESETS.length - 1, newIndex));
                        const duration = DURATION_PRESETS[durationIndex];
                        
                        // Recalculate SCOPE_HISTORY_LEN: how many samples to show
                        // We need history for (duration) seconds.
                        // Since traces are sampled at refreshRate:
                        SCOPE_HISTORY_LEN = Math.round((duration * sampleRate) / currentRefreshRate);
                        if (SCOPE_HISTORY_LEN < 10) SCOPE_HISTORY_LEN = 10; // Minimum points
                        
                        updateZoomDisplay();
                        initHistory();
                        vscode.postMessage({ type: 'configChange', zoomLevel: durationIndex });
                    }

                    function updateZoomDisplay() {
                        const duration = DURATION_PRESETS[durationIndex];
                        if (duration < 1) {
                            zoomDisplay.innerText = Math.round(duration * 1000) + 'ms';
                        } else {
                            zoomDisplay.innerText = duration + 's';
                        }
                    }

                    zoomIn.addEventListener('click', () => updateZoom(durationIndex - 1));
                    zoomOut.addEventListener('click', () => updateZoom(durationIndex + 1));

                    // Explorer Toggle
                    explorerHeader.addEventListener('click', () => {
                        registerExplorer.classList.toggle('expanded');
                        if (registerExplorer.classList.contains('expanded')) {
                            renderRegisterExplorer();
                        }
                    });

                    function toggleRegister(idx) {
                        const pos = selectedRegisters.indexOf(idx);
                        if (pos >= 0) {
                            selectedRegisters.splice(pos, 1);
                        } else {
                            if (selectedRegisters.length < TRACE_COLORS.length) {
                                selectedRegisters.push(idx);
                            } else {
                                updateStatus('Max ' + TRACE_COLORS.length + ' traces supported');
                                return;
                            }
                        }
                        
                        initHistory();
                        updateActiveSummary();
                        drawTraces();
                        
                        // Optimized: Directly update the DOM pill if it exists instead of full re-render
                        const pill = document.querySelector('.reg-pill[data-idx="' + idx + '"]');
                        if (pill) {
                            const activeIdx = selectedRegisters.indexOf(idx);
                            const isActive = activeIdx >= 0;
                            pill.className = 'reg-pill' + (isActive ? ' active' : '');
                            pill.style.color = isActive ? TRACE_COLORS[activeIdx % TRACE_COLORS.length] : '';
                        }
                        
                        // Need to update OTHER pills too because their trace colors (indices) might have shifted
                        selectedRegisters.forEach((reg, i) => {
                            const p = document.querySelector('.reg-pill[data-idx="' + reg + '"]');
                            if (p) {
                                p.style.color = TRACE_COLORS[i % TRACE_COLORS.length];
                            }
                        });

                        vscode.postMessage({ type: 'registerSelectionChange', selection: selectedRegisters });
                    }

                    function updateActiveSummary() {
                        if (selectedRegisters.length === 0) {
                            activeSummary.innerHTML = 'No signals selected';
                        } else {
                            activeSummary.innerHTML = selectedRegisters.map((idx, i) => {
                                const color = TRACE_COLORS[i % TRACE_COLORS.length];
                                return '<span style="color: ' + color + '">' + getRegisterLabel(idx) + '</span>';
                            }).join('');
                        }
                    }

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

                    let lastSymbolsJson = '';
                    function renderRegisterExplorer() {
                        if (!registerExplorer.classList.contains('expanded')) return;
                        
                        // Smart Render: Only re-build DOM if content actually changed
                        const currentJson = JSON.stringify({ symbols, registers: 64 });
                        if (currentJson === lastSymbolsJson) return;
                        lastSymbolsJson = currentJson;

                        explorerBody.innerHTML = '';
                        
                        const standardIndices = [20, 21, 22, 23, 24, 16, 17, 18, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
                        const symbolIndices = symbols.map(s => parseInt(s.value));
                        
                        const groups = [
                            { title: 'Standard I/O', indices: [20, 21, 22, 23, 24, 16, 17, 18] },
                            { title: 'Hardware LFOs', indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
                            { title: 'User Registers & Symbols', indices: Array.from({length: 32}, (_, i) => i + 32) }
                        ];

                        groups.forEach(group => {
                            const availableInGroup = group.indices.filter(i => {
                                return standardIndices.includes(i) || symbolIndices.includes(i) || (i >= 32 && i < 64);
                            });

                            if (availableInGroup.length > 0) {
                                const section = document.createElement('div');
                                section.className = 'reg-section';
                                
                                const head = document.createElement('div');
                                head.className = 'reg-section-title';
                                head.innerText = group.title;
                                section.appendChild(head);

                                const grid = document.createElement('div');
                                grid.className = 'reg-grid';

                                availableInGroup.forEach(i => {
                                    const pill = document.createElement('div');
                                    const activeIdx = selectedRegisters.indexOf(i);
                                    const isActive = activeIdx >= 0;
                                    
                                    pill.className = 'reg-pill' + (isActive ? ' active' : '');
                                    pill.dataset.idx = i;
                                    const label = getRegisterLabel(i);
                                    pill.innerText = label;
                                    pill.title = label;

                                    if (isActive) {
                                        pill.style.color = TRACE_COLORS[activeIdx % TRACE_COLORS.length];
                                    } else {
                                        pill.style.color = '';
                                    }

                                    grid.appendChild(pill);
                                });
                                section.appendChild(grid);
                                explorerBody.appendChild(section);
                            }
                        });
                    }

                    // Remove old renderLegend function and associated hiddenRegisters logic 
                    function renderLegend() {
                        // Legacy - renamed/absorbed into explorer
                        renderRegisterExplorer();
                        updateActiveSummary();
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
                            
                            // Setup Analysers
                            splitterNode = audioCtx.createChannelSplitter(2);
                            analyserL = audioCtx.createAnalyser();
                            analyserR = audioCtx.createAnalyser();
                            analyserL.fftSize = 4096;
                            analyserL.smoothingTimeConstant = 0.8;
                            analyserR.fftSize = 4096;
                            analyserR.smoothingTimeConstant = 0.8;
                            splitterNode.connect(analyserL, 0);
                            splitterNode.connect(analyserR, 1);
                            freqDataL = new Float32Array(analyserL.frequencyBinCount);
                            freqDataR = new Float32Array(analyserR.frequencyBinCount);
                            if (specActive) {
                                drawSpectrogramLoop();
                            }

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
                                    const numPoints = m.numTracePoints || 0;
                                    if (numPoints > 0) {
                                        for (let i = 0; i < numPoints; i++) {
                                            selectedRegisters.forEach(reg => {
                                                if (registerHistory[reg] && traces[reg]) {
                                                    registerHistory[reg][registerPtr] = traces[reg][i];
                                                }
                                            });
                                            registerPtr = (registerPtr + 1) % SCOPE_HISTORY_LEN;
                                        }
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
                                specBox.style.display = message.oscilloscopeEnabled ? 'block' : 'none';
                            }
                            if (message.oscilloscopeRefreshRate !== undefined) {
                                currentRefreshRate = message.oscilloscopeRefreshRate;
                                updateZoomDisplay();
                            }
                            if (message.zoomLevel !== undefined) {
                                durationIndex = Math.max(0, Math.min(DURATION_PRESETS.length - 1, message.zoomLevel));
                                const duration = DURATION_PRESETS[durationIndex];
                                SCOPE_HISTORY_LEN = Math.round((duration * sampleRate) / currentRefreshRate);
                                if (SCOPE_HISTORY_LEN < 10) SCOPE_HISTORY_LEN = 10;
                                updateZoomDisplay();
                                initHistory();
                            }
                            if (message.potValues) {
                                message.potValues.forEach((val, i) => {
                                    const slider = document.getElementById('pot' + i);
                                    const display = document.getElementById('p' + i + 'v');
                                    if (slider) slider.value = val;
                                    if (display) display.innerText = val.toFixed(2);
                                });
                            }
                            if (message.bypassActive !== undefined) {
                                bypassActive = message.bypassActive;
                                bypassBtn.className = bypassActive ? 'active' : '';
                            }
                            if (message.currentStimulus !== undefined) {
                                stimulusSelect.value = message.currentStimulus.value;
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
                            if (splitterNode) {
                                source.connect(splitterNode);
                            }

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

                    function drawSpectrogramLoop() {
                        if (!specActive || !analyserL || !analyserR) return;
                        
                        analyserL.getFloatFrequencyData(freqDataL);
                        analyserR.getFloatFrequencyData(freqDataR);

                        const w = specCanvas.width;
                        const h = specCanvas.height;
                        specCtx.clearRect(0, 0, w, h);

                        const minFreq = 20;
                        const maxFreq = sampleRate / 2;
                        const logMin = Math.log10(minFreq);
                        const logMax = Math.log10(maxFreq);

                        // Draw grid lines
                        specCtx.strokeStyle = '#222';
                        specCtx.lineWidth = 1;
                        specCtx.beginPath();
                        // Horizontal amplitude lines (divide into 4 sections)
                        for(let i=1; i<4; i++) {
                            specCtx.moveTo(0, h * (i/4)); specCtx.lineTo(w, h * (i/4));
                        }
                        
                        // Vertical logarithmic frequency grid lines
                        const gridFrequencies = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
                        specCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                        specCtx.font = '8px monospace';
                        specCtx.textAlign = 'center';
                        
                        gridFrequencies.forEach(freq => {
                            if (freq >= minFreq && freq <= maxFreq) {
                                const x = ((Math.log10(freq) - logMin) / (logMax - logMin)) * w;
                                specCtx.moveTo(x, 0); specCtx.lineTo(x, h);
                            }
                        });
                        specCtx.stroke();
                        
                        // Draw frequency labels (below horizontal lines so they don't get crossed out by the grid drawing)
                        gridFrequencies.forEach(freq => {
                            if (freq >= minFreq && freq <= maxFreq) {
                                const x = ((Math.log10(freq) - logMin) / (logMax - logMin)) * w;
                                const label = freq >= 1000 ? (freq/1000) + 'k' : freq.toString();
                                specCtx.fillText(label, x, h - 2);
                            }
                        });

                        const minDb = analyserL.minDecibels;
                        const maxDb = analyserL.maxDecibels;
                        const rangeDb = maxDb - minDb;

                        const drawChannel = (data, color) => {
                            specCtx.beginPath();
                            specCtx.strokeStyle = color;
                            specCtx.lineWidth = 1.2;
                            
                            const minFreq = 20;
                            const maxFreq = sampleRate / 2;
                            let firstPoint = true;
                            
                            for (let i = 0; i < data.length; i++) {
                                const freq = i * (sampleRate / analyserL.fftSize);
                                if (freq < minFreq) continue;
                                
                                const logMin = Math.log10(minFreq);
                                const logMax = Math.log10(maxFreq);
                                const x = ((Math.log10(freq) - logMin) / (logMax - logMin)) * w;
                                
                                let db = data[i];
                                if (!isFinite(db)) db = minDb;
                                let y = h - ((db - minDb) / rangeDb) * h;
                                y = Math.max(0, Math.min(h, y));
                                
                                if (firstPoint) {
                                    specCtx.moveTo(x, y);
                                    firstPoint = false;
                                } else {
                                    specCtx.lineTo(x, y);
                                }
                            }
                            specCtx.stroke();
                        };

                        // Draw channels: green for Left, red for Right
                        drawChannel(freqDataL, 'rgba(0, 255, 0, 0.7)');
                        drawChannel(freqDataR, 'rgba(255, 0, 0, 0.7)');
                        
                        specDrawId = requestAnimationFrame(drawSpectrogramLoop);
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

                        // getX: maps a delay-pointer address (wraps at size) to canvas X.
                        // Right-to-left: address 0 = right edge, address (size-1) = left edge.
                        const getX = (p) => ((size - 1 - (p % size)) / size) * w;

                        // getXAbs: same mapping but for absolute memory-block addresses which
                        // must NOT wrap. When start+size == delaySize the modulo would
                        // incorrectly wrap to 0 and render the block off-screen to the right.
                        const getXAbs = (p) => ((size - p) / size) * w;

                        if (memories) {
                            memCtx.fillStyle = 'rgba(79, 172, 254, 0.4)';
                            memCtx.strokeStyle = '#4facfe';
                            memCtx.lineWidth = 0.5;
                            memories.forEach(m => {
                                const x = getXAbs(m.start + m.size); // left edge of block (right-to-left)
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

                    // Initialization: Permanent Event Delegation on the root explorer container
                    registerExplorer.addEventListener('click', (e) => {
                        const pill = e.target.closest('.reg-pill');
                        if (pill && pill.dataset.idx !== undefined) {
                            e.stopPropagation();
                            toggleRegister(parseInt(pill.dataset.idx));
                        }
                    });

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
