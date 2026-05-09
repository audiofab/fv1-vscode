import { useState, useCallback, useEffect, useRef } from 'react'
import {
    PedalFace,
    useSimulator,
    type ChannelMode,
    type ClipInfo,
} from '@audiofab-io/easy-spin-ui'
import { vscodeApi } from './vscode-api'

interface SimulatorRootProps {
    workletUrl: string
    pedalImageUrl: string
}

interface ProgramPayload {
    binaryBase64?: string
    label: string
    error?: string
}

interface BankSlotState {
    slotNumber: number
    path: string
    label: string
    controls?: Array<{
        pot: 0 | 1 | 2
        name: string
        description?: string
        unit?: string
    }>
}

interface BankState {
    /** null for in-memory banks (never saved); the bank-name link is disabled. */
    bankPath: string | null
    bankName: string
    slots: BankSlotState[]
    selectedSlotIndex: number | null
    dirty: boolean
    pedalWriting: boolean
    programmingSlot: number | null
}

interface InitMessage {
    type: 'init'
    clips: ClipInfo[]
    defaultClipId: string | null
    program: ProgramPayload | null
    bank: BankState | null
}

interface ProgramUpdateMessage {
    type: 'programUpdate'
    program: ProgramPayload | null
}

interface BankStateMessage {
    type: 'bankState'
    bank: BankState | null
}

interface ClipBytesMessage {
    type: 'clipBytes'
    id: string
    bytesBase64: string
}

interface ClipErrorMessage {
    type: 'clipError'
    id: string
    error: string
}

type HostMessage =
    | InitMessage
    | ProgramUpdateMessage
    | BankStateMessage
    | ClipBytesMessage
    | ClipErrorMessage

const ZOOM_MIN = 0.5
const ZOOM_MAX = 1.5
const ZOOM_WHEEL_STEP = 0.05

export function SimulatorRoot({ workletUrl, pedalImageUrl }: SimulatorRootProps) {
    const simulator = useSimulator({ workletUrl })

    const [pots, setPots] = useState<[number, number, number]>([0.5, 0.5, 0.5])
    const [clips, setClips] = useState<ClipInfo[]>([])
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
    const [program, setProgram] = useState<ProgramPayload | null>(null)
    const [bank, setBank] = useState<BankState | null>(null)
    const [zoom, setZoom] = useState(0.75)

    const simulatorRef = useRef(simulator)
    simulatorRef.current = simulator
    const pendingClipIdRef = useRef<string | null>(null)
    const initialisedRef = useRef(false)

    useEffect(() => {
        const applyProgram = (p: ProgramPayload | null) => {
            setProgram(p)
            if (p?.binaryBase64) {
                const binary = base64ToUint8Array(p.binaryBase64)
                simulatorRef.current.loadProgram(binary).catch(err => {
                    console.error('[PedalSimulator] loadProgram failed:', err)
                })
            } else if (p?.error) {
                console.warn(`[PedalSimulator] compile error for ${p.label}:`, p.error)
            }
        }

        const handler = (e: MessageEvent<HostMessage>) => {
            const sim = simulatorRef.current
            const msg = e.data
            switch (msg.type) {
                case 'init': {
                    if (initialisedRef.current) return
                    initialisedRef.current = true

                    setClips(msg.clips)
                    setBank(msg.bank)
                    applyProgram(msg.program)
                    if (msg.defaultClipId) {
                        setSelectedClipId(msg.defaultClipId)
                        pendingClipIdRef.current = msg.defaultClipId
                        vscodeApi.postMessage({ type: 'requestClip', id: msg.defaultClipId })
                    }
                    return
                }
                case 'programUpdate': {
                    applyProgram(msg.program)
                    return
                }
                case 'bankState': {
                    setBank(msg.bank)
                    return
                }
                case 'clipBytes': {
                    if (pendingClipIdRef.current !== msg.id) return
                    const bytes = base64ToUint8Array(msg.bytesBase64)
                    sim.loadClipBuffer(bytes).catch(err => {
                        console.error(`[PedalSimulator] decode failed for clip ${msg.id}:`, err)
                    })
                    return
                }
                case 'clipError': {
                    if (pendingClipIdRef.current === msg.id) {
                        pendingClipIdRef.current = null
                    }
                    console.error(`[PedalSimulator] failed to load clip ${msg.id}: ${msg.error}`)
                    return
                }
            }
        }
        window.addEventListener('message', handler)
        vscodeApi.postMessage({ type: 'ready' })
        return () => window.removeEventListener('message', handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Ctrl+wheel zoom — preventDefault so it doesn't bubble up to VS Code.
    useEffect(() => {
        const handler = (e: WheelEvent) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            setZoom(z => {
                const dir = e.deltaY < 0 ? 1 : -1
                return clamp(z + dir * ZOOM_WHEEL_STEP, ZOOM_MIN, ZOOM_MAX)
            })
        }
        window.addEventListener('wheel', handler, { passive: false })
        return () => window.removeEventListener('wheel', handler)
    }, [])

    const handlePotChange = useCallback((index: number, value: number) => {
        setPots(prev => {
            const next = [...prev] as [number, number, number]
            next[index] = value
            return next
        })
        simulatorRef.current.setPot(index, value)
    }, [])

    const handleSelectClip = useCallback((clipId: string) => {
        setSelectedClipId(clipId)
        pendingClipIdRef.current = clipId
        vscodeApi.postMessage({ type: 'requestClip', id: clipId })
    }, [])

    const handlePlay = useCallback(() => {
        simulatorRef.current.play()
    }, [])

    const handlePause = useCallback(() => {
        simulatorRef.current.pause()
    }, [])

    const handleToggleBypass = useCallback(() => {
        const sim = simulatorRef.current
        sim.setBypass(!sim.bypassed)
    }, [])

    const handleChannelModeChange = useCallback((mode: ChannelMode) => {
        simulatorRef.current.setChannelMode(mode)
    }, [])

    // ── Slot interactions ────────────────────────────────────────────────

    const handleSelectSlot = useCallback((slotIndex: number) => {
        vscodeApi.postMessage({ type: 'selectSlot', slotIndex })
    }, [])

    const handleAssignSlot = useCallback((slotIndex: number, payload: string) => {
        vscodeApi.postMessage({ type: 'assignSlot', slotIndex, uri: payload })
    }, [])

    const handleAssignTrackedToSlot = useCallback((slotIndex: number) => {
        vscodeApi.postMessage({ type: 'assignTrackedToSlot', slotIndex })
    }, [])

    const handleUnassignSlot = useCallback((slotIndex: number) => {
        vscodeApi.postMessage({ type: 'unassignSlot', slotIndex })
    }, [])

    const handleOpenSlotSource = useCallback((slotIndex: number) => {
        vscodeApi.postMessage({ type: 'requestOpenSlotFile', slotIndex })
    }, [])

    // ── Bank toolbar handlers ────────────────────────────────────────────

    const handleLoadBank = useCallback(() => {
        vscodeApi.postMessage({ type: 'requestLoadBank' })
    }, [])

    const handleSaveBank = useCallback(() => {
        vscodeApi.postMessage({ type: 'requestSaveBank' })
    }, [])

    const handleSaveBankAs = useCallback(() => {
        vscodeApi.postMessage({ type: 'requestSaveAsBank' })
    }, [])

    const handleCloseBank = useCallback(() => {
        vscodeApi.postMessage({ type: 'requestCloseBank' })
    }, [])

    const handleOpenBankFile = useCallback(() => {
        vscodeApi.postMessage({ type: 'requestOpenBankFile' })
    }, [])

    // ── Pedal hardware programming ───────────────────────────────────────

    const handleProgramBank = useCallback(() => {
        vscodeApi.postMessage({ type: 'requestProgramBank' })
    }, [])

    const handleProgramSlot = useCallback((slotIndex: number) => {
        vscodeApi.postMessage({ type: 'requestProgramSlot', slotIndex })
    }, [])

    // ── Derived state ────────────────────────────────────────────────────

    // Slot labels come from the loaded bank when present. PedalFace expects
    // labels indexed by slot 0..7; the bank's slots are 1-based but already
    // ordered by `slotNumber` 1..8, so positional alignment works.
    const slotLabels = bank
        ? bank.slots.map(s => s.label)
        : []

    // Pick pot labels from the active slot's controls when a slot is selected;
    // fall back to defaults otherwise. Future enhancement: also read sibling
    // .json metadata files (the easy-spin-effects convention).
    const potLabels: [string, string, string] = (() => {
        if (bank && bank.selectedSlotIndex !== null) {
            const slot = bank.slots[bank.selectedSlotIndex]
            if (slot.controls && slot.controls.length > 0) {
                const get = (pot: 0 | 1 | 2) =>
                    slot.controls?.find(c => c.pot === pot)?.name ?? `Pot ${pot}`
                return [get(0), get(1), get(2)]
            }
        }
        return ['Pot 0', 'Pot 1', 'Pot 2']
    })()

    // Selected slot for PedalFace — falls back to 0 when nothing is selected
    // so the program-selector knob has somewhere to point. The actual audio
    // routing is driven by the host, not this prop.
    const selectedSlotForPedal = bank?.selectedSlotIndex ?? 0

    return (
        <div className="flex flex-col items-center py-4 px-4 gap-3">
            <BankToolbar
                bank={bank}
                onLoad={handleLoadBank}
                onSave={handleSaveBank}
                onSaveAs={handleSaveBankAs}
                onClose={handleCloseBank}
                onOpenBankFile={handleOpenBankFile}
            />
            <ProgramHeader
                program={program}
                zoom={zoom}
                sampleRate={simulator.sampleRate}
            />
            {/* transform: scale (not CSS zoom) so the Knob's pointer math works. */}
            <div style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
            }}>
                <PedalFace
                    pedalImageUrl={pedalImageUrl}
                    pots={pots}
                    onPotChange={handlePotChange}
                    potLabels={potLabels}
                    selectedSlot={selectedSlotForPedal}
                    onSelectSlot={handleSelectSlot}
                    slotLabels={slotLabels}
                    /* Slot callbacks are always wired — the "+" button works
                       without a bank loaded (auto-creates one), drag-drop
                       likewise creates a new bank, and Ctrl/right-click on
                       an assigned slot opens its source file. */
                    onAssignSlot={handleAssignSlot}
                    onAssignTrackedToSlot={handleAssignTrackedToSlot}
                    onUnassignSlot={handleUnassignSlot}
                    onOpenSlotSource={handleOpenSlotSource}
                    /* Pedal-write button beside the programming jack writes
                       the whole bank. The per-slot "download" icons next to
                       each assigned slot write that one slot. We don't expose
                       a Read button (bank is the source of truth here) and
                       there's no Connect handshake — pedalConnected is
                       always true; if the pedal isn't plugged in, the host's
                       ProgrammerService surfaces the error. */
                    pedalConnected={bank !== null}
                    onWritePedal={bank !== null ? handleProgramBank : undefined}
                    pedalWriting={bank?.pedalWriting ?? false}
                    onProgramSlot={bank !== null ? handleProgramSlot : undefined}
                    programmingSlot={bank?.programmingSlot ?? null}
                    clips={clips}
                    selectedClipId={selectedClipId}
                    onSelectClip={handleSelectClip}
                    playing={simulator.playing}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    bypassed={simulator.bypassed}
                    onToggleBypass={handleToggleBypass}
                    channelMode={simulator.channelMode as ChannelMode}
                    onChannelModeChange={handleChannelModeChange}
                />
            </div>
        </div>
    )
}

// ── Bank toolbar ───────────────────────────────────────────────────────

interface BankToolbarProps {
    bank: BankState | null
    onLoad: () => void
    onSave: () => void
    onSaveAs: () => void
    onClose: () => void
    onOpenBankFile: () => void
}

function BankToolbar({
    bank, onLoad, onSave, onSaveAs, onClose, onOpenBankFile,
}: BankToolbarProps) {
    const loaded = bank !== null
    const hasFile = bank?.bankPath != null
    // The bank name is a hyperlink that opens the .spnbank as JSON.
    // For in-memory banks (no path yet) we just show a static label.
    const bankNameElement = bank
        ? (bank.bankPath
            ? (
                <button
                    type="button"
                    onClick={onOpenBankFile}
                    title={`Open ${bank.bankPath} as JSON`}
                    className="font-mono text-text-primary hover:text-gold-dim hover:underline cursor-pointer truncate"
                >
                    {bank.bankName}
                </button>
            )
            : <span className="font-mono italic text-text-muted truncate" title="Unsaved bank">{bank.bankName}</span>)
        : null
    return (
        <div className="w-full max-w-[600px] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
                <ToolbarButton onClick={onLoad} title="Open a .spnbank file">
                    <FolderIcon /> Load…
                </ToolbarButton>
                {/*
                  No bank loaded: show only Load. Users build a bank by
                  clicking "+" on a slot or dropping a file — no need for a
                  separate "New Bank…" button.

                  In-memory bank (no file backing yet): Save handles "first
                  save" via fallback to a dialog; Save As is hidden because
                  it would be identical to Save.

                  File-backed bank: full toolbar.
                */}
                {loaded && (
                    <ToolbarButton onClick={onSave} disabled={!bank?.dirty} title="Save changes to the current bank">
                        <SaveIcon /> Save
                    </ToolbarButton>
                )}
                {loaded && hasFile && (
                    <ToolbarButton onClick={onSaveAs} title="Save the current bank to a new file">
                        <SaveAsIcon /> Save As…
                    </ToolbarButton>
                )}
                {loaded && (
                    <ToolbarButton onClick={onClose} title="Close the current bank">
                        <CloseIcon /> Close
                    </ToolbarButton>
                )}
            </div>
            {bank && (
                <div className="text-text-muted text-right truncate min-w-0 flex items-center gap-1">
                    {bankNameElement}
                    {bank.dirty && <span className="text-gold-dim" title="Unsaved changes">●</span>}
                </div>
            )}
        </div>
    )
}

interface ToolbarButtonProps {
    onClick: () => void
    disabled?: boolean
    title?: string
    children: React.ReactNode
}

function ToolbarButton({ onClick, disabled, title, children }: ToolbarButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="px-2 py-1 rounded border border-border bg-surface-card text-text-primary
                       hover:border-gold-dim hover:text-gold-dim
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors flex items-center gap-1 text-[11px]"
        >
            {children}
        </button>
    )
}

// ── Program header ─────────────────────────────────────────────────────

interface ProgramHeaderProps {
    program: ProgramPayload | null
    zoom: number
    sampleRate: number | null
}

/** Shows the currently-playing program's name (with slot prefix when the
 *  host derived one), the AudioContext sample rate, and the zoom level.
 *  No "Tracking" lead-in — the label speaks for itself. */
function ProgramHeader({ program, zoom, sampleRate }: ProgramHeaderProps) {
    const rateMismatch = sampleRate != null && sampleRate !== 32768
    return (
        <div className="w-full max-w-[600px] flex flex-col items-center gap-1 text-xs">
            <div className="flex items-center justify-between w-full gap-2">
                <span className="text-text-muted truncate">
                    {program == null
                        ? <em>No FV-1 file open</em>
                        : program.error
                            ? <span className="text-red-400">Compile error in {program.label}</span>
                            : <span className="font-mono text-text-primary">{program.label}</span>}
                </span>
                <span className="text-text-muted whitespace-nowrap flex items-center gap-2">
                    {sampleRate != null && (
                        <span
                            className={rateMismatch ? 'text-red-400 font-mono' : 'font-mono opacity-70'}
                            title={rateMismatch
                                ? 'AudioContext is not running at 32768 Hz — time-based effects will sound off-pitch.'
                                : 'AudioContext sample rate (matches FV-1).'}
                        >
                            {sampleRate} Hz
                        </span>
                    )}
                    <span>{Math.round(zoom * 100)}% &middot; <span className="opacity-70">Ctrl+scroll</span></span>
                </span>
            </div>
            {program?.error && (
                <div className="w-full px-2 py-1 rounded border border-red-400/40 bg-red-400/10 text-red-400 text-[11px] font-mono whitespace-pre-wrap break-words">
                    {program.error}
                </div>
            )}
        </div>
    )
}

// ── Icons ──────────────────────────────────────────────────────────────

function FolderIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function SaveIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
        </svg>
    )
}

function SaveAsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <line x1="12" y1="3" x2="12" y2="8" />
            <line x1="9.5" y1="5.5" x2="14.5" y2="5.5" />
        </svg>
    )
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

// ── Helpers ────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v))
}

function base64ToUint8Array(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}
