# Scratch Register Allocation Refactoring

## Summary

Updated the scratch register allocation approach to simplify the API and make temporary register usage more intuitive.

## Key Changes

### 1. New Allocation Strategy

**Previous Approach:**
- Scratch registers were allocated using `allocateRegister()` with a temporary port name
- Required explicit cleanup with `freeRegister()` after use
- Freed registers were tracked in a pool for reuse
- Complex state management across blocks

**New Approach:**
- Scratch registers are allocated from REG31 downward using `getScratchRegister()`
- Permanent registers (for block outputs) are allocated from REG0 upward using `allocateRegister()`
- Scratch registers are automatically available again after each block's code generation
- No need to track or free scratch registers
- Simpler mental model: scratch registers only live within a single block's code generation

### 2. Register Collision Detection

The system now detects when permanent and scratch register allocations collide:
- Permanent: REG0 → REG(n) (allocating upward)
- Scratch: REG31 → REG(m) (allocating downward)
- Error if n > m (collision detected)

### 3. API Changes

**CodeGenContext Interface (Block.ts):**
- ✅ Added: `getScratchRegister(): string`
- ✅ Added: `resetScratchRegisters(): void`
- ❌ Removed: `freeRegister(blockId: string, portId: string): void`

**CodeGenerationContext Implementation (CodeGenContext.ts):**
- ✅ Added: `nextScratchRegister` property (starts at 31)
- ✅ Added: `getScratchRegister()` method
- ✅ Added: `resetScratchRegisters()` method
- ❌ Removed: `freedRegisters` array
- ❌ Removed: `freeRegister()` method
- ✅ Updated: `allocateRegister()` now checks for collision with scratch registers
- ✅ Updated: `reset()` now resets `nextScratchRegister` to 31

### 4. Block Updates

**PotBlock (InputBlocks.ts):**
```typescript
// Old:
const filterReg0 = ctx.allocateRegister(this.type, 'filter0');
// ... use filterReg0 ...
ctx.freeRegister(this.type, 'filter0');

// New:
const filterReg0 = ctx.getScratchRegister();
// ... use filterReg0 ...
// (no cleanup needed)
```

**DelayBlock (DelayBlock.ts):**
```typescript
// Old:
const wetReg = ctx.allocateRegister(this.type, 'wet_temp');
// ... use wetReg ...
ctx.freeRegister(this.type, 'wet_temp');

// New:
const wetReg = ctx.getScratchRegister();
// ... use wetReg ...
// (no cleanup needed)
```

**GraphCompiler (GraphCompiler.ts):**
```typescript
// Added after each block's code generation:
context.resetScratchRegisters();
```

## Benefits

1. **Simpler API:** No need to remember to free scratch registers
2. **Less Error-Prone:** No risk of forgetting to free a register
3. **Clearer Intent:** `getScratchRegister()` clearly indicates temporary usage
4. **Better Resource Tracking:** Clear separation between permanent and scratch registers
5. **Automatic Cleanup:** Compiler automatically resets scratch registers between blocks

## Usage Guidelines

### When to use `allocateRegister()`:
- For block **output ports** that need to persist across blocks
- When the register value will be read by downstream blocks

### When to use `getScratchRegister()`:
- For **temporary/intermediate** calculations within a block
- When the register is only needed during the current block's code generation
- For filter states, temporary storage, intermediate results, etc.

## Example

```typescript
generateCode(ctx: CodeGenContext): string[] {
    const code: string[] = [];
    
    // Permanent register for output (persists across blocks)
    const outputReg = ctx.allocateRegister(this.type, 'out');
    
    // Scratch register for intermediate calculation (only valid in this block)
    const tempReg = ctx.getScratchRegister();
    
    // Generate code...
    code.push(`rdax ${inputReg}, 1.0`);
    code.push(`wrax ${tempReg}, 1.0  ; Save temporarily`);
    // ... more calculations ...
    code.push(`rdax ${tempReg}, 0.5  ; Use temp value`);
    code.push(`wrax ${outputReg}, 0.0  ; Write final output`);
    
    // No need to free tempReg - it's automatically available for the next block
    return code;
}
```

## Migration Notes

If you have custom blocks using the old API:
1. Replace `ctx.allocateRegister(this.type, 'temp_xyz')` with `ctx.getScratchRegister()`
2. Remove all `ctx.freeRegister(this.type, 'temp_xyz')` calls
3. Keep using `ctx.allocateRegister(this.type, 'out')` for output ports
