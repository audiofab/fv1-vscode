# Audiofab Easy Spin (FV-1) Programming Extension

[![Official Documentation](https://img.shields.io/badge/docs-official-blue.svg)](https://audiofab.github.io/fv1-vscode/)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/audiofab.fv1-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=audiofab.fv1-vscode)

A professional Visual Studio Code extension for developing, simulating, and deploying audio effects code for the **Spin Semiconductor FV-1 DSP**.

This extension provides a unified environment for both traditional assembly programming and modern visual block-based design, specifically tailored for the [Audiofab Easy Spin](https://audiofab.com/products/easy-spin) platform.

---

## 📖 Official Documentation

For complete guides, command references, and tutorials, please visit our documentation site:

### 👉 **[https://audiofab.github.io/fv1-vscode/](https://audiofab.github.io/fv1-vscode/)**

The online documentation includes:
- **User Guide**: Installation and hardware setup.
- **Visual Editor**: Comprehensive guide to building effects with blocks.
- **Block Developer Guide**: Documentation for the ATL (Assembly Template Language).
- **Command Reference**: Keyboard shortcuts and power-user tips.

---

## 🚀 Key Objectives

- **Visual Programming**: Design complex effects (reverbs, delays, pitch-shifters) by connecting functional blocks without writing a single line of assembly.
- **Professional Assembly**: Full syntax highlighting, real-time diagnostics, and hover-docs for the native FV-1 instruction set.
- **Hardware Integration**: One-click deployment to the [Audiofab USB Programmer](https://audiofab.com/store/easy-spin-programmer) and Easy Spin pedal.
- **Performance Optimization**: Advanced compiler that prunes unused registers and folds static math to fit more into the 128-instruction hardware limit.

---

## 🎧 Integrated Simulator & Debugger

Test your DSP logic in real-time without needing hardware connected. The built-in simulator represents a bit-accurate emulation of the FV-1 architecture.

### Features
- **Real-time Audio**: Supply your own WAV files as stimulus and monitor the output live.
- **Multi-trace Oscilloscope**: Inspect internal registers, hardware POTs, and accumulator flags simultaneously.
- **Memory Visualization**: View a live map of the 32k-word delay RAM to see exactly how your delay lines are positioned and moving.
- **Step-through Debugging**: Set breakpoints in your assembly or diagram and step instruction-by-instruction while inspecting the state of all 32 registers.

> [!TIP]
> **Placeholder: Studio-lit screenshot of the Simulator in action**
> *(Suggested: Dark mode, showing the Oscilloscope with multiple sine/ramp traces and the Delay Memory map active)*

---

## 🛠️ Installation

1. Install [Visual Studio Code](https://code.visualstudio.com/).
2. Open the Extensions view (`Ctrl+Shift+X`).
3. Search for **"Audiofab FV-1"**.
4. Click **Install**.

---

## Contributing & Support

- **Bug Reports**: Please use the [GitHub Issue Tracker](https://github.com/audiofab/fv1-vscode/issues).
- **Inspiration**: This project is inspired by the "OG" [SpinCAD Designer](https://github.com/HolyCityAudio/SpinCAD-Designer).
- **License**: MIT License. See [LICENSE](LICENSE) for details.

© 2026 Audiofab Inc.
