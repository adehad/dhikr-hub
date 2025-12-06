# Developer Notes

This page is for those who wish to contribute to the technical aspects of the Dhikr-Hub project.

## Project Structure

The project follows a standard Hugo structure:

- `site/content/` - Contains Markdown files for individual pages
- `site/data/` - Contains JSON files with Qasida and Salawaat content
- `site/layouts/` - Contains HTML templates and shortcodes
- `site/static/` - Contains static assets like fonts and images
- `site/assets/` - Contains Sass files and JavaScript

## Data Structure

Content is stored in JSON files following a defined schema. Each Qasida has:

- Arabic text with diacritical marks
- Transliteration using the Library of Congress Arabic Romanization system
- English translation
- Order information for displaying chorus and verses

See `qasida.schema.json` in the project root for the complete schema.

## Qasida Page Front Matter

Each Qasida markdown file should include front matter parameters:

```toml
+++
json_file = 'file-name'
maqam = ['Bayat']
+++
```

### json_file (required)

Links the page to its JSON data file in `site/data/qasida/`. This parameter:
- Enables the "Edit in Editor" link on the page footer
- Allows shortcodes to auto-detect the data file (no need to specify `file` param)

### maqam (optional)

Specifies the musical mode(s) for the Qasida. This is a Hugo taxonomy that:
- Creates a tag link displayed by the `qasida_meta` shortcode
- Generates a taxonomy page listing all Qasidas in that maqam (e.g., `/maqam/bayat/`)

Common maqam values include: `Bayat`, `Sika`, `Hijaz`, `Nahawand`, `Rast`, `Jaharkah`, etc.

## Working with Shortcodes

The project uses custom shortcodes to render content. The main ones are:

### verse

The `verse` shortcode is used to display a Qasida or Salawaat with Arabic text, transliteration, and translation.

Usage:
```
{{</* verse file="qasida/file-name" lang="en" */>}}
```

Or, if `json_file` is set in front matter, the `file` parameter can be omitted:
```
{{</* verse lang="en" */>}}
```

Parameters:
- `file` - Path to the JSON file relative to the data directory (optional if `json_file` is in front matter)
- `lang` - Language code (currently only `en` is supported)

### get_title

Use this shortcode to display the title of a Qasida or Salawaat.

Usage:
```
{{%/* get_title file="qasida/file-name" lang="en" */%}}
```

Or with `json_file` in front matter:
```
{{%/* get_title lang="en" */%}}
```

### qasida_meta

Displays metadata for a Qasida page, including maqam tags. Should be placed near the top of the page.

Usage:
```
{{</* qasida_meta */>}}
```

### qasida_editor

Embeds the WYSIWYG Qasida editor. Used on the [Submit page](/Contributing/Submit/).

Usage:
```
{{</* qasida_editor */>}}
```

## Phrase by Phrase (not so much Word by Word)

This feature is implemented as part of the `verse` shortcode.
The intention was to help those link the source Arabic with the translation.

However, a pure 'word by word' translation loses the poetic beauty
that can typically only be captured by translating words in their ensemble.
Hence a 'phrase by phrase' is more appropriate.

Have a look at this example of the implementation:

{{< verse file="salawaat/example" lang="en" >}}

## Qasida Editor

The site includes a WYSIWYG editor for creating and editing Qasidas at [/Contributing/Submit/](/Contributing/Submit/).

Features:
- Edit existing Qasidas by clicking "Edit in Editor" on any Qasida page
- Create new Qasidas from scratch
- Add/remove chorus sections and verse sections
- Add/remove individual lines within sections
- Live preview using the same styling as the published site
- Auto-save to localStorage (preserves work across page refreshes)
- Export to JSON format compatible with the data schema

The editor can load existing Qasidas via the `?file=` query parameter (e.g., `/Contributing/Submit/?file=sifhu-li`).

### JSON API

Qasida JSON files are exposed at `/api/qasida/*.json` via Hugo module mounts. This allows the editor to fetch existing content at runtime. The mount is configured in `hugo.toml`:

```toml
[module]
  [[module.mounts]]
    source = "data/qasida"
    target = "static/api/qasida"
```

## Settings Functionality

User settings are managed through JavaScript and stored in `localStorage`. The settings include:

- Display options for Arabic, transliteration, and translation
- Font family selection for Arabic text
- Font size adjustments

Settings are defined in `site/layouts/partials/docs/inject/menu-before.html`.

## Offline Support

The site uses a service worker (`site/assets/sw.js`) to allow the site to be 'installed'
as a PWA, enabling offline access.
By default it will precache all content pages.

## Development Workflow

1. Fork the repository
2. Clone your fork locally
3. Create a new branch for your changes
4. Start the Hugo development server: `hugo serve`
5. Make your changes and review the output.
6. Commit and push your changes
7. Create a pull request

> The respoistory is configured with a VS Code devcontainer which can be used even in the
> browser for a complete developer environment.

## Common Challenges

### Arabic Text

- Ensure proper Unicode representation for Arabic characters (we have a lint step to raise any issues)
- Include all diacritical marks for proper pronunciation
- Use the appropriate tools mentioned in the README for capturing text

### Hugo Specifics

- The project uses the `hugo-book` theme with customisations
- Changes to existing shortcodes require careful testing as they affect all content
- When adding shortcode examples to documentation, escape the delimiters to prevent execution

### Testing Content

When adding new content:

1. Verify Arabic text displays correctly
2. Test all display settings (Arabic, transliteration, translation toggles)
