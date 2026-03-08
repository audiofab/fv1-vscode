# Sphinx Documentation
The following Python packages are required to build the documentation:

- sphinx >= 7.0.0: Core documentation generator
- sphinx-rtd-theme >= 1.3.0: ReadTheDocs theme for better UI
- sphinx-design >= 0.5.0: Design components for reStructuredText

## Setup

### On Windows:
```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r docs/requirements.txt
```

### On macOS/Linux:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r docs/requirements.txt
```

## Building Documentation Locally

After installing requirements:

```bash
npm run docs:build
```

To view the built documentation:

```bash
npm run docs:serve
```

Then open http://localhost:8000 in your browser.

## Deployment

Documentation is automatically built and deployed to GitHub Pages on each commit to the main branch via GitHub Actions.
