# High Pass and Low Pass Shelving Filters in FV-1

This document mathematical breaks down how the `wrlx` and `wrhx` instructions function as *Shelving Filters* within the Spin Semiconductor FV-1 DSP architecture.

## How does `wrlx` perform a high-pass shelf when it's natively low-pass?

The secret is that the `wrlx` code isn't calculating a high-pass filter directly. It's actually manually constructing the mathematical identity of a high-pass shelf: `Input - (ShelfDepth * LowPass)`.

Because any audio signal can be defined as `Input = HighPass + LowPass`, if we subtract a scaled amount of the Low-Pass from the original Input, we get: 
`HighPass + LowPass - (ShelfDepth * LowPass)` = **`HighPass + (1 - ShelfDepth) * LowPass`**.

This perfectly describes a High-Pass Shelf: the high frequencies are untouched, but the low frequencies are attenuated by the shelf depth!

Here is how the first block of the code computes that manually so that you can inject `mulx` (a CV control):

1. **`wrax temp, -oneMinusShelf`**
   - Saves the clean `Input` into `temp`.
   - Leaves the Accumulator (`ACC`) as `Input * -oneMinusShelf`. 
2. **`rdfx hpf1, freq`**
   - The FV-1 natively saves the `ACC` into `PACC` (Previous Accumulator) before running the filter. So `PACC` becomes `Input * -oneMinusShelf`.
   - The FV-1 calculates the pure **Low-Pass** of that inverted, scaled signal! 
3. **`wrlx hpf1, -1`**
   - The hardware formula for `wrlx reg, C` is: `ACC = (PACC - ACC) * C + PACC`.
   - With `C = -1`, this evaluates to: `-(PACC - ACC) + PACC = ACC`.
   - This effectively just permanently stores the `ACC` into the `hpf1` memory state, and perfectly passes our scaled, inverted Low-Pass signal straight through the remaining code.
4. **`mulx shelfIn`**
   - We scale our inverted Low-Pass signal by our CV control.
5. **`rdax temp, 1`**
   - We add the clean `Input` (saved in `temp`) back into our inverted Low-Pass signal.
   - Result: `Input - (oneMinusShelf * CV * LowPass)`. A perfect, CV-controllable High-Pass Shelf!

## How does `wrhx` work when no pin is connected?

When there is no CV control pin connected, we don't need to manually break the math apart to inject `mulx shelfIn`. We can let the FV-1 hardware natively compute the exact same High-Pass Shelf for us in just **two instructions**!

Here's how `wrhx` calculates it:

1. **`rdfx hpf1, freq`**
   - `PACC` natively saves the clean `Input`.
   - `ACC` calculates the pure **Low-Pass** track of the input.
2. **`wrhx hpf1, -oneMinusShelf`**
   - The hardware formula for `wrhx reg, C` is: `ACC = PACC + (ACC * C)`. 
   - Because `PACC` holds our `Input`, and `ACC` holds our `LowPass`, this instruction literally fires the math: **`Input + (LowPass * -oneMinusShelf)`** in a single hardware cycle!

**To summarize**: `wrhx` was explicitly designed by Spin Semiconductor to compute `Input - (LowPass * Scale)` natively to generate High-Pass offsets without wasting memory registers! You are only using `wrlx` in the first half of the code because `wrhx` doesn't natively accept CV-controlled multiplication for the `C` coefficient, forcing you to manually unroll the `wrhx` math using `wrlx` and a `temp` variable so that you can slip a `mulx` in the middle!
