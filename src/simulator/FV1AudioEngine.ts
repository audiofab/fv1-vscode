import * as vscode from 'vscode';

/**
 * Manages audio playback using a hidden VS Code Webview and the Web Audio API.
 * Uses a jitter buffer to ensure smooth playback across the IPC bridge.
 */
export class FV1AudioEngine {
    private panel: vscode.WebviewPanel | null = null;
    private isReady: boolean = false;
    private sampleRate: number = 32768;
    private pendingMetadata: any = null;

    private _onMessage = new vscode.EventEmitter<any>();
    public readonly onMessage = this._onMessage.event;

    constructor(sampleRate: number = 32768) {
        this.sampleRate = sampleRate;
        this.init();
    }

    private init() {
        this.panel = vscode.window.createWebviewPanel(
            'fv1AudioEngine',
            'FV1 Audio Monitor',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                enableMediaStream: true,
                retainContextWhenHidden: true
            } as any
        );

        this.panel.webview.html = this.getHtml();

        this.panel.webview.onDidReceiveMessage(m => {
            if (m.type === 'ready') {
                this.isReady = true;
                console.log('FV1 Audio Engine Ready');
                if (this.pendingMetadata && this.panel) {
                    this.panel.webview.postMessage({
                        type: 'play',
                        l: new Float32Array(0),
                        r: new Float32Array(0),
                        adcL: 0,
                        adcR: 0,
                        metadata: this.pendingMetadata
                    });
                    this.pendingMetadata = null;
                }
            } else {
                // Relay other messages (bypass, pot change) to listeners
                this._onMessage.fire(m);
            }
        });

        this.panel.onDidDispose(() => {
            this.panel = null;
            this.isReady = false;
        });
    }

    /**
     * Sends a buffer of samples to the webview for playback.
     */
    public playBuffer(l: Float32Array, r: Float32Array, adcL: number = 0, adcR: number = 0, metadata: any = null) {
        if (metadata) this.pendingMetadata = metadata;

        if (!this.isReady || !this.panel) return;

        this.panel.webview.postMessage({
            type: 'play',
            l,
            r,
            adcL,
            adcR,
            metadata: this.pendingMetadata
        });
        this.pendingMetadata = null;
    }

    public stop() {
        if (this.panel) {
            this.panel.webview.postMessage({ type: 'stop' });
        }
    }

    public dispose() {
        this.panel?.dispose();
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { background: #1e1e1e; color: #ccc; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; margin: 0; cursor: default; }
                    .container { text-align: center; width: 85%; max-width: 500px; }
                    .header { font-size: 18px; margin-bottom: 12px; font-weight: bold; color: #fff; }
                    .meter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
                    .meter-box { background: #252525; padding: 10px; border-radius: 6px; border: 1px solid #333; }
                    .meter-label { color: #666; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
                    .meter-value { font-family: monospace; font-size: 16px; }
                    .scope-canvas { border: 1px solid #333; border-radius: 4px; background: #000; width: 100%; margin-bottom: 12px; }
                    .info-box { background: #252525; padding: 8px; border-radius: 4px; font-size: 11px; color: #888; margin-bottom: 12px; text-align: left; }
                    .controls-box { background: #2a2a2a; padding: 12px; border-radius: 6px; border: 1px solid #444; margin-bottom: 12px; }
                    .pot-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
                    .pot-label { color: #eee; font-size: 11px; width: 45px; text-align: left; }
                    .pot-slider { flex: 1; accent-color: #4facfe; cursor: pointer; }
                    .pot-value { font-family: monospace; font-size: 11px; width: 35px; color: #aaa; }
                    .footer { display: flex; gap: 10px; justify-content: center; align-items: center; }
                    button { background: #333; color: #ccc; border: 1px solid #444; padding: 5px 10px; font-size: 11px; cursor: pointer; border-radius: 4px; transition: all 0.2s; }
                    button:hover { background: #444; border-color: #555; color: #fff; }
                    button.active { background: #4facfe; color: #000; border-color: #fff; font-weight: bold; }
                    #overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 100; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: opacity 0.3s; }
                </style>
            </head>
            <body>
                <div id="overlay">
                    <div style="text-align: center; pointer-events: none;">
                        <div style="font-size: 40px; margin-bottom: 10px;">🎧</div>
                        <div style="font-size: 18px; color: #fff; font-weight: bold;">Click to Enable Monitor</div>
                        <div style="font-size: 12px; color: #aaa; margin-top: 8px;">Audio starts as soon as data arrives.</div>
                    </div>
                </div>

                <div class="container">
                    <div class="header">🔊 FV-1 Audio Monitor</div>
                    
                    <div class="meter-grid">
                        <div class="meter-box">
                            <div class="meter-label">ADC Input</div>
                            <div class="meter-value" style="color: #4facfe;">
                                L:<span id="adcL">0.000</span> R:<span id="adcR">0.000</span>
                            </div>
                        </div>
                        <div class="meter-box">
                            <div class="meter-label">DAC Output</div>
                            <div class="meter-value" style="color: #00ff00;">
                                L:<span id="dacL">0.000</span> R:<span id="dacR">0.000</span>
                            </div>
                        </div>
                    </div>
                    
                    <canvas id="scope" width="400" height="80" class="scope-canvas"></canvas>

                    <div class="controls-box">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <span style="font-size: 12px; font-weight: bold; color: #4facfe;">Interactive Controls</span>
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

                    <div class="info-box">
                        <div id="streamerInfo">File: Not Loading...</div>
                    </div>

                    <div class="footer">
                        <select id="deviceList" title="Output Device" style="background: #252525; color: #eee; border: 1px solid #444; padding: 4px; border-radius: 4px; font-size: 10px; display: none;"></select>
                        <button id="testBtn">Test Tone</button>
                        <div id="status" style="color: #666; font-size: 10px;">Initializing...</div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let audioCtx = null;
                    let startTime = 0;
                    const sampleRate = ${this.sampleRate};
                    
                    const canvas = document.getElementById('scope');
                    const ctx = canvas.getContext('2d');
                    const overlay = document.getElementById('overlay');
                    const deviceList = document.getElementById('deviceList');
                    const testBtn = document.getElementById('testBtn');
                    const bypassBtn = document.getElementById('bypassBtn');
                    const streamerInfo = document.getElementById('streamerInfo');
                    
                    const adcL = document.getElementById('adcL');
                    const adcR = document.getElementById('adcR');
                    const dacL = document.getElementById('dacL');
                    const dacR = document.getElementById('dacR');
                    
                    let bypassActive = false;
                    let bufferQueue = [];
                    let isBuffering = true;

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

                    async function refreshDevices() {
                        try {
                            const devices = await navigator.mediaDevices.enumerateDevices();
                            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                            if (audioOutputs.length > 1) {
                                deviceList.style.display = 'block';
                            }
                            deviceList.innerHTML = '';
                            audioOutputs.forEach((device, i) => {
                                const option = document.createElement('option');
                                option.value = device.deviceId;
                                option.text = device.label || 'Output ' + (i + 1);
                                deviceList.appendChild(option);
                            });
                        } catch (e) {}
                    }

                    async function initAudio() {
                        if (audioCtx) {
                            if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch(e) {} }
                            if (audioCtx.state === 'running') { hideOverlay(); return true; }
                        }
                        try {
                            const AudioContext = window.AudioContext || window.webkitAudioContext;
                            audioCtx = new AudioContext({ sampleRate });
                            if (deviceList.value && deviceList.value !== 'default' && audioCtx.setSinkId) {
                                await audioCtx.setSinkId(deviceList.value);
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
                    testBtn.addEventListener('click', async (e) => {
                        if (!audioCtx || audioCtx.state !== 'running') await initAudio();
                        if (audioCtx && audioCtx.state === 'running') {
                            const osc = audioCtx.createOscillator();
                            osc.frequency.setValueAtTime(440, audioCtx.currentTime);
                            const gain = audioCtx.createGain();
                            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                            osc.connect(gain);
                            gain.connect(audioCtx.destination);
                            osc.start();
                            osc.stop(audioCtx.currentTime + 0.2);
                        }
                    });

                    window.addEventListener('message', async event => {
                        const message = event.data;
                        if (message.type === 'play') {
                            if (message.adcL !== undefined) adcL.innerText = message.adcL.toFixed(3);
                            if (message.adcR !== undefined) adcR.innerText = message.adcR.toFixed(3);
                            
                            if (message.metadata) {
                                const m = message.metadata;
                                streamerInfo.innerText = 'WAV: ' + (m.loaded ? 'Loaded (' + m.numSamples + ' smp)' : 'No File');
                                streamerInfo.style.color = m.loaded ? '#aaa' : '#f44';
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
                            const lData = block.l;
                            const rData = block.r;

                            const buffer = audioCtx.createBuffer(2, lData.length, sampleRate);
                            buffer.getChannelData(0).set(lData);
                            buffer.getChannelData(1).set(rData);

                            const source = audioCtx.createBufferSource();
                            source.buffer = buffer;
                            source.connect(audioCtx.destination);

                            const now = audioCtx.currentTime;
                            if (startTime < now - 0.05) {
                                startTime = now + 0.1;
                            }

                            source.start(startTime);
                            
                            if (bufferQueue.length === 0) {
                                dacL.innerText = lData[0].toFixed(3);
                                dacR.innerText = rData[0].toFixed(3);
                                drawScope(lData);
                            }

                            startTime += buffer.duration;
                        }
                    }

                    function drawScope(data) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.beginPath();
                        ctx.lineWidth = 1.2;
                        ctx.strokeStyle = '#00ff00';
                        const step = data.length / canvas.width;
                        for(let i = 0; i < canvas.width; i++) {
                            const val = data[Math.floor(i * step)];
                            const y = (val + 1) * (canvas.height / 2);
                            if (i === 0) ctx.moveTo(i, y);
                            else ctx.lineTo(i, y);
                        }
                        ctx.stroke();
                    }

                    refreshDevices();
                    vscode.postMessage({ type: 'ready' });
                    updateStatus('Ready');
                </script>
            </body>
            </html>
        `;
    }
}
