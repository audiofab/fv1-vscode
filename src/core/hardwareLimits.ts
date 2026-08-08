/**
 * FV-1 hardware limits that are fixed by the silicon, not by preference.
 *
 * These used to be user settings (`fv1.hardware.regCount`, `fv1.hardware.delaySize`).
 * Raising either produced programs that cannot run on an FV-1, and the failure was
 * silent — the assembler would happily allocate REG40 or a 65000-word delay line and
 * the resulting binary would simply misbehave on hardware.
 *
 * `fv1.hardware.progSize` is deliberately still a setting: nothing in the instruction
 * encoding fixes program length (it is never an operand), so it is the one limit that
 * is a property of the part rather than the instruction set.
 */

/**
 * User registers, REG0..REG31.
 *
 * The register field in RDAX/WRAX/MULX/RDFX/MAXX/WRLX/WRHX is 6 bits = 64 addressable
 * slots. Addresses 0..31 are the system registers (POT0-2, ADCL/R, DACL/R, ADDR_PTR,
 * the LFO rate/range registers, ...) and 32..63 are the user registers. So 32 is not a
 * budget — it is every address the instruction set can express.
 */
export const FV1_REG_COUNT = 32;

/**
 * Delay memory, in samples (words).
 *
 * The FV-1 has 32768 words of delay RAM. The address field in RDA/WRA/WRAP/RMPA is
 * 16 bits, so the encoding could reach 65536 — but no FV-1 provides that much RAM,
 * so anything above 32768 addresses memory that does not exist.
 */
export const FV1_DELAY_SIZE = 32768;

/** Default instructions per sample. Still overridable via `fv1.hardware.progSize`. */
export const FV1_PROG_SIZE_DEFAULT = 128;
