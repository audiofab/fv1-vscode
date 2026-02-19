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
            }
        });

        this.panel.onDidDispose(() => {
            this.panel = null;
            this.isReady = false;
        });
    }

    /**
     * Sends a buffer of samples to the webview for playback.
     * Uses structured cloning for efficiency (no Array.from required).
     */
    public playBuffer(l: Float32Array, r: Float32Array, adcL: number = 0, adcR: number = 0, metadata: any = null) {
        if (metadata) this.pendingMetadata = metadata;

        if (!this.isReady || !this.panel) return;

        // Note: postMessage on webview supports structured cloning of TypedArrays
        this.panel.webview.postMessage({
            type: 'play',
            l, // Float32Array
            r, // Float32Array
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
            <body style="background: #1e1e1e; color: #ccc; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; margin: 0; cursor: default;">
                <div id="overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 100; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: opacity 0.3s;">
                    <div style="text-align: center; pointer-events: none;">
                        <div style="font-size: 40px; margin-bottom: 10px;">🎧</div>
                        <div style="font-size: 18px; color: #fff; font-weight: bold;">Click to Enable Monitor</div>
                        <div style="font-size: 12px; color: #aaa; margin-top: 8px;">Audio starts as soon as data arrives.</div>
                    </div>
                </div>

                <div style="text-align: center; width: 80%; max-width: 500px;">
                    <div style="font-size: 18px; margin-bottom: 12px; font-weight: bold; color: #fff;">🔊 FV-1 Audio Monitor</div>
                    
                    <div id="deviceContainer" style="margin-bottom: 12px; display: none;">
                        <select id="deviceList" title="Output Device" style="background: #252525; color: #eee; border: 1px solid #444; padding: 6px; width: 100%; border-radius: 4px; outline: none; font-size: 11px;"></select>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                        <div style="background: #252525; padding: 10px; border-radius: 6px; border: 1px solid #333;">
                            <div style="color: #666; font-size: 10px; text-transform: uppercase; margin-bottom: 4px;">ADC Input</div>
                            <div style="font-family: monospace; color: #4facfe; font-size: 16px;">
                                L:<span id="adcL">0.000</span> R:<span id="adcR">0.000</span>
                            </div>
                        </div>
                        <div style="background: #252525; padding: 10px; border-radius: 6px; border: 1px solid #333;">
                            <div style="color: #666; font-size: 10px; text-transform: uppercase; margin-bottom: 4px;">DAC Output</div>
                            <div style="font-family: monospace; color: #00ff00; font-size: 16px;">
                                L:<span id="dacL">0.000</span> R:<span id="dacR">0.000</span>
                            </div>
                        </div>
                    </div>
                    
                    <canvas id="scope" width="400" height="80" style="border: 1px solid #333; border-radius: 4px; background: #000; width: 100%; margin-bottom: 12px;"></canvas>

                    <div style="background: #252525; padding: 8px; border-radius: 4px; font-size: 11px; color: #888; margin-bottom: 12px; text-align: left;">
                        <div id="streamerInfo">File: Not Loading...</div>
                    </div>

                    <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                        <button id="testBtn" style="background: #333; color: #ccc; border: 1px solid #444; padding: 5px 10px; font-size: 11px; cursor: pointer; border-radius: 4px;">Test Tone</button>
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
                    const deviceContainer = document.getElementById('deviceContainer');
                    const testBtn = document.getElementById('testBtn');
                    const streamerInfo = document.getElementById('streamerInfo');
                    
                    const adcL = document.getElementById('adcL');
                    const adcR = document.getElementById('adcR');
                    const dacL = document.getElementById('dacL');
                    const dacR = document.getElementById('dacR');
                    
                    let bufferQueue = [];
                    let isBuffering = true;

                    function updateStatus(msg) {
                        document.getElementById('status').innerText = msg;
                    }

                    async function refreshDevices() {
                        try {
                            const devices = await navigator.mediaDevices.enumerateDevices();
                            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                            if (audioOutputs.length > 1) {
                                deviceContainer.style.display = 'block';
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
                        e.stopPropagation();
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

                            // Queue the incoming buffer
                            bufferQueue.push({ l: message.l, r: message.r });

                            // If we aren't running yet OR we are explicitly buffering, check if we have enough
                            // 2 blocks of 100ms = 200ms of jitter buffer
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
                        while (bufferQueue.length > 0) {
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
                            // If we fell significantly behind, reset to start "now" + 100ms
                            if (startTime < now - 0.05) {
                                startTime = now + 0.1;
                            }

                            source.start(startTime);
                            
                            // UI Update (Scope) using first block
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
