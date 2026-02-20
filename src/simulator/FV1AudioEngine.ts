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
            this._onMessage.fire({
                type: 'stimulusChange',
                value: 'custom',
                filePath: uris[0].fsPath
            });

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

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { background: transparent; color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 10px; overflow-x: hidden; }
                    .container { display: flex; flex-direction: column; gap: 12px; }
                    
                    .viz-box { background: var(--vscode-sideBar-background); padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-widget-border); }
                    .viz-label { color: var(--vscode-descriptionForeground); font-size: 9px; text-transform: uppercase; margin-bottom: 6px; }
                    .scope-canvas { background: #000; border-radius: 2px; width: 100%; height: 80px; margin-bottom: 4px; }
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
                                <option value="built-in">Built-in: Minor Chords</option>
                                <option value="custom">Select Custom File...</option>
                            </select>
                        </div>
                    </div>

                    <div class="viz-box">
                        <div class="viz-label">Output Oscilloscope (Stereo)</div>
                        <canvas id="scope" width="400" height="80" class="scope-canvas"></canvas>
                    </div>

                    <div class="viz-box">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <div class="viz-label">LFO Oscilloscope</div>
                            <div style="font-size: 8px; display: flex; gap: 4px; opacity: 0.8;">
                                <span style="color: #4facfe;">S0</span>
                                <span style="color: #ff00ff;">S1</span>
                                <span style="color: #ffaa00;">R0</span>
                                <span style="color: #00ff00;">R1</span>
                            </div>
                        </div>
                        <canvas id="lfoScope" width="200" height="60" class="small-canvas"></canvas>
                    </div>

                    <div class="viz-box">
                        <div class="viz-label">Delay Memory Map</div>
                        <canvas id="memMap" width="200" height="60" class="small-canvas"></canvas>
                    </div>

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
                    const lfoCanvas = document.getElementById('lfoScope');
                    const lfoCtx = lfoCanvas.getContext('2d');
                    const memCanvas = document.getElementById('memMap');
                    const memCtx = memCanvas.getContext('2d');

                    const overlay = document.getElementById('overlay');
                    const bypassBtn = document.getElementById('bypassBtn');
                    const stimulusSelect = document.getElementById('stimulusSelect');
                    
                    let bypassActive = false;
                    let bufferQueue = [];
                    let isBuffering = true;

                    // LFO History
                    const LFO_HISTORY_LEN = 200;
                    let lfoHistory = {
                        sin0: new Float32Array(LFO_HISTORY_LEN),
                        sin1: new Float32Array(LFO_HISTORY_LEN),
                        rmp0: new Float32Array(LFO_HISTORY_LEN),
                        rmp1: new Float32Array(LFO_HISTORY_LEN),
                        ptr: 0
                    };

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
                                if (m.lfoSin0) {
                                    for (let i = 0; i < m.lfoSin0.length; i++) {
                                        lfoHistory.sin0[lfoHistory.ptr] = m.lfoSin0[i];
                                        lfoHistory.sin1[lfoHistory.ptr] = m.lfoSin1[i];
                                        lfoHistory.rmp0[lfoHistory.ptr] = m.lfoRmp0[i];
                                        lfoHistory.rmp1[lfoHistory.ptr] = m.lfoRmp1[i];
                                        lfoHistory.ptr = (lfoHistory.ptr + 1) % LFO_HISTORY_LEN;
                                    }
                                    drawLfoScope();
                                }
                                if (m.delayPtr !== undefined) {
                                    drawMemMap(m.delayPtr, m.delaySize, m.memories);
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
                        }
                    });

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
                            
                            if (bufferQueue.length === 0) {
                                drawScope(block.l);
                            }

                            startTime += buffer.duration;
                        }
                    }

                    function drawScope(data) {
                        scopeCtx.clearRect(0, 0, scopeCanvas.width, scopeCanvas.height);
                        scopeCtx.beginPath();
                        scopeCtx.lineWidth = 1.0;
                        scopeCtx.strokeStyle = '#00ff00';
                        const step = data.length / scopeCanvas.width;
                        for(let i = 0; i < scopeCanvas.width; i++) {
                            const val = data[Math.floor(i * step)];
                            const y = (val + 1) * (scopeCanvas.height / 2);
                            if (i === 0) scopeCtx.moveTo(i, y);
                            else scopeCtx.lineTo(i, y);
                        }
                        scopeCtx.stroke();
                    }

                    function drawLfoScope() {
                        const w = lfoCanvas.width;
                        const h = lfoCanvas.height;
                        lfoCtx.clearRect(0, 0, w, h);
                        
                        const drawWave = (data, color) => {
                            lfoCtx.beginPath();
                            lfoCtx.strokeStyle = color;
                            lfoCtx.lineWidth = 1.2;
                            for (let i = 0; i < LFO_HISTORY_LEN; i++) {
                                const idx = (lfoHistory.ptr + i) % LFO_HISTORY_LEN;
                                const val = data[idx];
                                const x = (i / LFO_HISTORY_LEN) * w;
                                const y = (1 - (val + 1) / 2) * h;
                                if (i === 0) lfoCtx.moveTo(x, y);
                                else lfoCtx.lineTo(x, y);
                            }
                            lfoCtx.stroke();
                        };

                        drawWave(lfoHistory.sin0, '#4facfe');
                        drawWave(lfoHistory.sin1, '#ff00ff');
                        drawWave(lfoHistory.rmp0, '#ffaa00');
                        drawWave(lfoHistory.rmp1, '#00ff00');
                    }

                    function drawMemMap(ptr, size, memories) {
                        const w = memCanvas.width;
                        const h = memCanvas.height;
                        memCtx.clearRect(0, 0, w, h);
                        memCtx.fillStyle = '#111';
                        memCtx.fillRect(0, 0, w, h);

                        if (memories) {
                            memCtx.fillStyle = 'rgba(79, 172, 254, 0.4)';
                            memCtx.strokeStyle = '#4facfe';
                            memCtx.lineWidth = 0.5;
                            memories.forEach(m => {
                                const x = (m.start / size) * w;
                                const width = (m.size / size) * w;
                                memCtx.fillRect(x, 2, width, h - 4);
                                memCtx.strokeRect(x, 2, width, h - 4);
                            });
                        }

                        const ptrX = ((size - ptr) / size) * w;
                        memCtx.strokeStyle = '#ff4444';
                        memCtx.lineWidth = 1.5;
                        memCtx.beginPath();
                        memCtx.moveTo(ptrX, 0);
                        memCtx.lineTo(ptrX, h);
                        memCtx.stroke();
                    }

                    vscode.postMessage({ type: 'ready' });
                    updateStatus('Ready');
                </script>
            </body>
            </html>
        `;
    }
}
