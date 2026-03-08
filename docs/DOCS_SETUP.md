# Documentation Setup Guide

This project uses **Sphinx** to generate professional user and developer documentation that is automatically deployed to GitHub Pages.

## Quick Start

### Building Documentation Locally

#### Prerequisites
- Python 3.8 or higher
- pip (Python package manager)

#### Setup (One-time)

On **Windows**:
```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r docs/requirements.txt
```

On **macOS/Linux**:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r docs/requirements.txt
```

#### Building

From the root of the repository (with virtual environment activated):

```bash
npm run docs:build
```

Or directly with Sphinx:
```bash
sphinx-build -b html docs/source docs/build/html
```

#### Viewing Locally

To serve the documentation locally at http://localhost:8000:

```bash
npm run docs:serve
```

This opens your browser automatically to the documentation.

Alternatively, open `docs/build/html/index.html` directly in your browser.

### Clearing Build Artifacts

To clean up built documentation:

```bash
npm run docs:clean
```

## Documentation Structure

```
docs/
├── source/                    # Documentation source files (reStructuredText)
│   ├── conf.py               # Sphinx configuration
│   ├── index.rst             # Main documentation index
│   ├── installation.rst      # Installation instructions
│   ├── getting-started.rst   # Getting started guide
│   ├── features.rst          # Feature documentation
│   ├── commands.rst          # Command reference
│   ├── visual-editor.rst     # Block diagram editor guide
│   ├── block-developer-guide.rst  # ATL block development guide
│   ├── faq.rst              # Frequently asked questions
│   └── _static/             # Static files (CSS, JS, images)
├── build/                    # Generated HTML documentation (git-ignored)
│   └── html/
├── requirements.txt          # Python package dependencies
├── README.md                 # Documentation build instructions
```

## Editing Documentation

Documentation is written in **reStructuredText** (`.rst`) format. This is a markup language similar to Markdown but more powerful.

### Key reStructuredText Syntax

```rst
# Main Heading
=============

## Section Heading
------------------

### Subsection
^^^^^^^^^^^^^^

**Bold text**

*Italic text*

``Inline code``

.. code-block:: python
   :linenos:

   # Code block with syntax highlighting
   print("Hello")

- Bullet list
- Item 2

1. Numbered list
2. Item 2

.. image:: path/to/image.png
   :alt: Alternative text
   :align: center

`Link text <https://example.com>`_

.. note::
   This is a note admonition.

.. warning::
   This is a warning admonition.
```

### Adding New Pages

1. Create a new `.rst` file in `docs/source/`
2. Add it to the `.. toctree::` in `docs/source/index.rst`
3. Build and review

### Linking Between Pages

```rst
See the :doc:`installation` guide for setup instructions.
```

## Deployment to GitHub Pages

Documentation is automatically built and deployed on each push to the `main` branch using GitHub Actions.

### GitHub Actions Workflow

The workflow file `.github/workflows/docs.yml` does the following:

1. Triggers on pushes to `main` that modify `docs/` files
2. Sets up Python 3.11
3. Installs Sphinx and dependencies from `docs/requirements.txt`
4. Builds documentation with `sphinx-build`
5. Uploads to GitHub Pages artifact
6. Deploys to your repository's GitHub Pages site

### Enabling GitHub Pages

Your documentation should automatically be published at:
```
https://<username>.github.io/fv1-vscode/
```

To verify/configure:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Pages**
3. Under "Source", select **Deploy from a branch** (if not already)
4. Choose `gh-pages` branch and `/ (root)` folder
5. GitHub Pages should now be enabled

The `gh-pages` branch is automatically created and updated by the GitHub Actions workflow.

## Sphinx Theme Configuration

The documentation uses the **Read the Docs** theme which provides:

- Mobile-responsive design
- Dark mode support
- Excellent navigation
- Search functionality

Theme settings are configured in `docs/source/conf.py`:

```python
html_theme = 'sphinx_rtd_theme'
html_theme_options = {
    'logo_only': False,
    'display_version': True,
    'style_nav_header_background': '#2c3e50',
}
```

## Adding Images

1. Place images in `docs/source/_static/images/` (or organize as needed)
2. Reference in `.rst`:

```rst
.. image:: _static/images/my-image.png
   :alt: Descriptive alt text
   :align: center
   :width: 600px
```

## Useful Sphinx Commands

```bash
# Build HTML documentation
sphinx-build -b html docs/source docs/build/html

# Build with warnings treated as errors (for CI/CD)
sphinx-build -W -b html docs/source docs/build/html

# Clean and rebuild
sphinx-build -a -b html docs/source docs/build/html

# Build other formats (PDF, ePub, etc.)
sphinx-build -b pdf docs/source docs/build/pdf
sphinx-build -b epub docs/source docs/build/epub
```

## Troubleshooting

### "sphinx-build: command not found"

Ensure your Python virtual environment is activated:

```bash
# Windows
.\.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

Then reinstall requirements:
```bash
pip install -r docs/requirements.txt
```

### Build fails with reStructuredText errors

Check the error output for line numbers and filenames. Common issues:

- Incorrect indentation
- Missing blank lines between sections
- Unmatched underline lengths (e.g., `====` must match heading length)

### GitHub Pages not updating

1. Check that the GitHub Actions workflow completed successfully (green checkmark)
2. Verify the `gh-pages` branch exists in your repository
3. Check repository Settings → Pages is configured correctly
4. Wait a few minutes for GitHub Pages to rebuild (typically < 1 minute)
5. Clear your browser cache or use Ctrl+Shift+Del (or Cmd+Shift+Del on macOS)

### Images not showing in documentation

1. Ensure images are in `docs/source/_static/` or referenced with correct relative paths
2. Use `_static/` prefix in image paths in `.rst` files
3. Rebuild documentation: `npm run docs:build`

## Contributing Documentation

1. Create a feature branch: `git checkout -b docs/my-feature`
2. Edit `.rst` files in `docs/source/`
3. Build locally: `npm run docs:build`
4. Review in browser
5. Commit and push your changes
6. Create a pull request
7. Once merged to `main`, GitHub Actions will rebuild and deploy automatically

## Resources

- **Sphinx Documentation**: https://www.sphinx-doc.org/
- **reStructuredText Guide**: https://docutils.sourceforge.io/rst.html
- **Read the Docs Theme**: https://sphinx-rtd-theme.readthedocs.io/
- **Sphinx Extensions**: https://www.sphinx-doc.org/en/master/usage/extensions/

## Support

For issues with the documentation:

1. Check troubleshooting section above
2. Review existing GitHub issues
3. Create a new GitHub issue with:
   - Description of the problem
   - Steps to reproduce
   - Expected vs. actual behavior
   - Any error messages

---

**Next Steps**: Build the documentation locally and review it before committing to the repository!
