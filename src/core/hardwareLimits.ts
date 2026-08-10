/**
 * FV-1 hardware limits.
 *
 * These are re-exported from `@audiofab-io/fv1-core`, which is the single source
 * of truth — the assembler enforces them, so a value defined separately here
 * could drift out of agreement with the code that actually checks it.
 *
 * Register count and delay memory size are fixed by the instruction encoding and
 * are no longer settings. They used to be (`fv1.hardware.regCount`,
 * `fv1.hardware.delaySize`); raising either produced programs that cannot run on
 * an FV-1, and the failure was silent. `fv1.hardware.progSize` remains a setting
 * because nothing in the encoding fixes program length.
 */

export {
    /** User registers, REG0..REG31 — every register the 6-bit field can name. */
    FV1_REG_COUNT,
    /** Delay memory in samples; the part has exactly this much RAM. */
    FV1_DELAY_SIZE,
    /** Default instructions per sample. Overridable via `fv1.hardware.progSize`. */
    FV1_PROG_SIZE,
} from '@audiofab-io/fv1-core';
