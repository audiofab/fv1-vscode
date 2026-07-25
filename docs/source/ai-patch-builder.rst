AI Patch Builder
================

The extension bundles an **AI Patch Builder** — a Model Context Protocol (MCP) server that
gives AI coding agents full knowledge of the FV-1 block library and the block-diagram
compiler. With it, an agent such as **GitHub Copilot** (agent mode) or **Claude Code** can
build and validate ``.spndiagram`` block-diagram programs for you from a plain-language
description or a screenshot of an existing patch.

Because the agent can compile every draft against the *real* FV-1 compiler as it works, the
patches it produces are checked for correct wiring and for fitting within the FV-1's limits
(128 instructions, 32 registers, 32768 words of delay memory) — not just guessed at.

How it works
------------

The server is launched automatically by your AI agent and exposes a small set of tools the
agent calls on demand:

**Discover blocks**
   Browse the full catalog of built-in blocks and read the exact ports and parameters of any
   block, so the agent wires things up correctly.

**Learn from examples**
   Fetch curated, ready-made example diagrams (echo, hall reverb, chorus, LFO-swept filter,
   parallel dry/wet mix) to adapt rather than starting from a blank canvas.

**Validate**
   Compile a candidate diagram and report any errors, warnings, and resource usage. This is
   the heart of the loop: the agent drafts, validates, fixes what the compiler reports, and
   repeats until the patch is correct.

**Author new blocks**
   When no existing block does the job, the agent can read the Audiofab Template Language
   (ATL) reference, study a similar block's source, and write a brand-new custom ``.atl``
   block on the fly — then use it immediately in your diagram.

Requirements
------------

- **VS Code 1.101 or newer** (required for the Copilot MCP integration).
- An AI agent:

  - **GitHub Copilot** with agent mode, or
  - **Claude Code** (the VS Code integrated extension, or the CLI).

Set up with GitHub Copilot
--------------------------

The server is contributed to VS Code's built-in MCP host, so Copilot discovers it
automatically once the extension is installed.

1. Open the **Copilot Chat** view and switch the mode selector to **Agent**.
2. Confirm the server is available: run **MCP: List Servers** from the Command Palette
   (``Ctrl+Shift+P``) and look for **Audiofab FV-1 Patch Builder**. Start it if it is not
   already running.
3. Ask Copilot to build something (see `Example prompts`_ below).

.. note::

   Copilot may ask you to trust or enable the server the first time. This is a one-time
   confirmation.

Set up with Claude Code
-----------------------

Claude Code uses its own configuration file, so the extension writes one for you.

1. Run **FV-1: Enable AI Patch Builder for Claude Code** from the Command Palette. This
   creates (or updates) a ``.mcp.json`` file at the root of your workspace folder.
2. **Restart VS Code** (or reload the window).
3. When Claude Code starts, approve the project's MCP server when prompted, then verify with
   the ``/mcp`` command that **audiofab-fv1** is connected.

.. important::

   Claude Code reads ``.mcp.json`` only **at startup**. A freshly generated file will not be
   picked up until you restart VS Code (or reload the window). If ``/mcp`` shows the server as
   *not connected* right after enabling it, a restart is almost always the fix.

Where custom blocks are saved
-----------------------------

Any block the agent authors is written to your custom-block directory so it survives future
sessions and appears in the block palette:

- the **first** path in your ``fv1.customBlockPaths`` setting, if that setting is set; or
- a managed ``.fv1/blocks`` folder inside your workspace, if it is not.

Newly written blocks are loaded live — you do not need to run **Refresh Custom Blocks**
manually. See :doc:`block-developer-guide` for the ATL block format the agent uses.

Example prompts
---------------

.. code-block:: text

   Create a new .spndiagram for a stereo hall reverb with a short pre-delay.
   Validate it, then save it as reverb.spndiagram.

.. code-block:: text

   Here's a screenshot of a SpinCAD patch — recreate it as a block diagram.

.. code-block:: text

   Build a lo-fi vibrato. If no block does what you need, author a custom one.
   Validate before saving.

After the agent saves a ``.spndiagram`` file, open it to see it in the
:doc:`visual-editor`, tweak parameters, and audition it in the :doc:`simulator`.

Troubleshooting
---------------

**Claude Code sees the server but it is "not running."**
   Restart VS Code so ``.mcp.json`` is re-read (see the note above). If it still fails, open a
   terminal and run ``claude mcp list`` to see the actual startup error.

**The server path looks wrong after a VS Code update.**
   The extension rewrites the launch path in ``.mcp.json`` automatically each time it
   activates, so reloading the window once after an update corrects a stale path.

**Copilot doesn't show the server.**
   Make sure you are on VS Code 1.101+ and that Copilot agent mode is enabled for your
   account, then re-check **MCP: List Servers**.
