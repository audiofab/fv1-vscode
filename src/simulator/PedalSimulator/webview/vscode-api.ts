/**
 * Thin wrapper around `acquireVsCodeApi()` so that React's StrictMode (which
 * mounts effects twice in dev) and HMR don't try to acquire the API twice —
 * VS Code throws on the second call.
 */

interface VsCodeApi {
    postMessage: (msg: unknown) => void
    getState: () => unknown
    setState: (state: unknown) => void
}

declare const acquireVsCodeApi: () => VsCodeApi

let cached: VsCodeApi | undefined
function get(): VsCodeApi {
    if (!cached) cached = acquireVsCodeApi()
    return cached
}

export const vscodeApi = {
    postMessage: (msg: unknown) => get().postMessage(msg),
    getState: () => get().getState(),
    setState: (state: unknown) => get().setState(state),
}
