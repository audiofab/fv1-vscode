# Configuration file for Sphinx documentation builder

project = 'Audiofab FV-1 VS Code Extension'
copyright = '2026, Audiofab Inc.'
author = 'Audiofab Inc.'
release = '1.4.0'

# Sphinx extensions
extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.intersphinx',
    'sphinx_rtd_theme',
    'sphinx_design',
]

# Theme configuration
html_theme = 'sphinx_rtd_theme'
html_theme_options = {
    'logo_only': False,
    'display_version': True,
    'prev_next_buttons_location': 'bottom',
    'style_external_links': False,
    'vcs_pageview_mode': '',
    'style_nav_header_background': '#2c3e50',
}

# HTML output options
html_static_path = ['_static']
html_css_files = ['custom.css']
html_logo = '../../resources/logo_600x493.png'
html_favicon = '../../resources/logo_600x493.png'
html_title = 'Audiofab FV-1 Tutorial'
html_show_copyright = True
html_show_sphinx = False

# Source suffix
source_suffix = '.rst'

# Master document
master_doc = 'index'

# Highlight language
highlight_language = 'default'

# Language configuration
language = 'en'

# Sphinx build options
templates_path = ['_templates']
exclude_patterns = []

# Internationalization
locale_dirs = ['locale/']

# Suppress warnings for missing CSS files
suppress_warnings = ['app.css_not_found']
