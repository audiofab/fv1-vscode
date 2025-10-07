# FV-1 Assembly Editor for VS Code

A comprehensive Visual Studio Code extension for developing Spin Semiconductor FV-1 DSP assembly programs. This extension provides syntax highlighting, assembly integration, and EEPROM programming capabilities via the MCP2221 USB-to-I2C bridge.

## Features

- **Syntax Highlighting**: Full syntax highlighting for FV-1 assembly language (.spn and .fv1 files)
- **Assembly Integration**: Direct integration with the Spin Semiconductor FV-1 assembler
- **EEPROM Programming**: Program compiled HEX files to EEPROM via MCP2221 USB-to-I2C bridge
- **Device Detection**: Automatic detection of MCP2221 devices
- **Context Menus**: Right-click context menus for assembly and programming operations
- **Keyboard Shortcuts**: Quick access via keyboard shortcuts

## Installation

### Prerequisites

1. **FV-1 Assembler**: Download and install the official Spin Semiconductor FV-1 assembler
2. **MCP2221 Driver**: Install the MCP2221 USB driver from Microchip
3. **Node.js**: Ensure Node.js is installed on your system

### Extension Installation

1. Clone this repository or download the source code
2. Open a terminal in the extension directory
3. Install dependencies:
   ```bash
   npm install
   ```
4. Compile the TypeScript code:
   ```bash
   npm run compile
   ```
5. Package the extension (optional):
   ```bash
   npm install -g vsce
   vsce package
   ```

## Configuration

Configure the extension through VS Code settings:

1. Open VS Code Settings (File > Preferences > Settings)
2. Search for "FV-1"
3. Configure the following settings:

### Required Settings

- **fv1.assemblerPath**: Path to the FV-1 assembler executable
  - Example: `"C:\\Program Files\\SpinSemi\\FV1Assembler\\fv1asm.exe"`

### Optional Settings

- **fv1.eepromSize**: EEPROM size in bytes (default: 512)
- **fv1.i2cAddress**: I2C address of the EEPROM (default: "0x50")
- **fv1.mcp2221VendorId**: MCP2221 USB Vendor ID (default: "04D8")
- **fv1.mcp2221ProductId**: MCP2221 USB Product ID (default: "00DD")

## Usage

### Creating FV-1 Programs

1. Create a new file with `.spn` or `.fv1` extension
2. Write your FV-1 assembly code
3. The extension will automatically provide syntax highlighting and language support

### Assembling Code

#### Method 1: Keyboard Shortcut
- Press `Ctrl+F5` to assemble the current file

#### Method 2: Command Palette
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "FV-1: Assemble FV-1 Code"
3. Press Enter

#### Method 3: Context Menu
1. Right-click in the editor
2. Select "Assemble FV-1 Code"

### Programming EEPROM

#### Assemble and Program (One Step)
- Press `Ctrl+Shift+F5` to assemble and program in one step
- Or use Command Palette: "FV-1: Assemble and Program EEPROM"

#### Program Existing HEX File
1. Right-click on a `.hex` file in the Explorer
2. Select "Program EEPROM from HEX"
3. Or use Command Palette: "FV-1: Program EEPROM from HEX"

### Device Detection

To verify your MCP2221 device is connected:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "FV-1: Detect MCP2221 Device"
3. The extension will show detected devices

## Hardware Setup

### MCP2221 Connection

Connect your MCP2221 to the EEPROM as follows:

```
MCP2221    EEPROM (24LC04/24LC08)
--------   ---------------------
VDD     -> VCC (Pin 8)
VSS     -> GND (Pin 4)
SCL     -> SCL (Pin 6)
SDA     -> SDA (Pin 5)
```

###