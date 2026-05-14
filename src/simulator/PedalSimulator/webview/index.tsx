import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SimulatorRoot } from './SimulatorRoot'
import { vscodeApi } from './vscode-api'

declare global {
    interface Window {
        __PEDAL_SIM__: {
            workletUrl: string
            pedalImageUrl: string
        }
    }
}

// Bridge VS Code's editor theme to the easy-spin-ui `.dark` class. VS Code
// applies one of `vscode-light`, `vscode-dark`, or `vscode-high-contrast` to
// the body element and updates it live when the theme changes; mirror that
// onto <html> so the pedal's CSS variables (and the pedal-image invert filter)
// flip correctly.
function syncTheme() {
    const cl = document.body.classList
    const isDark = cl.contains('vscode-dark') || cl.contains('vscode-high-contrast')
    document.documentElement.classList.toggle('dark', isDark)
}
syncTheme()
new MutationObserver(syncTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
})

// Track whether Ctrl/Cmd is held — drives the "slot label underlines on
// hover when Ctrl is down" affordance (mirrors how Ctrl+click on a path
// works elsewhere in VS Code).
function setCtrl(active: boolean) {
    document.body.classList.toggle('modifier-ctrl', active)
}
window.addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey) setCtrl(true) })
window.addEventListener('keyup',   e => { if (!e.ctrlKey && !e.metaKey) setCtrl(false) })
window.addEventListener('blur',    () => setCtrl(false))

// Document-wide drag-drop. We handle drops at the document level
// (capture phase) so we don't depend on the easy-spin-ui slot handler
// firing — VS Code's Explorer drag doesn't always populate text/uri-list
// without a modifier key, but it does set its own private MIME types,
// and we read all of them here.
//
// preventDefault on dragenter / dragover makes the webview a drop target.
// We do NOT set dropEffect at the window level — that interferes with
// the slot-level pickDropEffect when both run.
//
// NOTE: VS Code's security overlay (microsoft/vscode#256444) blocks ALL
// drag events from reaching this webview until the user presses Shift.
// We cannot detect or react to a drag-in-progress before that point.
// A static hint in the slot-grid UI tells users about the Shift key.
window.addEventListener('dragenter', e => { e.preventDefault() })
window.addEventListener('dragover',  e => { e.preventDefault() })

// MIME types VS Code uses for resource drags, in priority order. Standard
// types come first; the application/vnd.code.* fallback covers Explorer
// drags without modifier keys, where the source only provides VS Code's
// private format.
const URI_MIME_TYPES = [
    'text/uri-list',
    'application/vnd.code.uri-list',
    'text/plain',
] as const

function readDroppedUri(dataTransfer: DataTransfer): string | null {
    for (const type of URI_MIME_TYPES) {
        const raw = dataTransfer.getData(type)
        if (!raw) continue
        // uri-list is newline-separated and may contain '#'-prefixed comments.
        const first = raw
            .split(/\r?\n/)
            .map(s => s.trim())
            .find(s => s && !s.startsWith('#'))
        if (first) return first
    }
    return null
}

/** Walk up from the drop target to find the enclosing slot tile. The slot
 *  grid uses Tailwind's grid-cols-2 class on the parent and role="button"
 *  on each slot — a stable enough structural anchor. Returns the 0-based
 *  index of the hit slot, or null if the drop wasn't on one. */
function slotIndexFromDropTarget(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null
    const slot = target.closest('[role="button"]')
    if (!slot) return null
    const grid = slot.parentElement
    if (!grid?.classList.contains('grid-cols-2')) return null
    const idx = Array.prototype.indexOf.call(grid.children, slot)
    return idx >= 0 && idx < 8 ? idx : null
}

window.addEventListener('drop', e => {
    e.preventDefault()
    if (!e.dataTransfer) return

    const slotIndex = slotIndexFromDropTarget(e.target)
    if (slotIndex === null) return // drop wasn't on a slot tile

    const uri = readDroppedUri(e.dataTransfer)
    if (!uri) return

    // Bypass the slot-level handler — we already have everything we need.
    // stopImmediatePropagation prevents the slot's React onDrop from also
    // firing and double-assigning.
    e.stopImmediatePropagation()
    vscodeApi.postMessage({ type: 'assignSlot', slotIndex, uri })
}, true /* capture phase */)

const container = document.getElementById('root')
if (!container) {
    throw new Error('PedalSimulator: #root element missing')
}

const { workletUrl, pedalImageUrl } = window.__PEDAL_SIM__

createRoot(container).render(
    <StrictMode>
        <SimulatorRoot workletUrl={workletUrl} pedalImageUrl={pedalImageUrl} />
    </StrictMode>,
)
