---
weight: 95
---

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

## Working with Shortcodes

The project uses custom shortcodes to render content. The main ones are:

### verse

The `verse` shortcode is used to display a Qasida or Salawaat with Arabic text, transliteration, and translation.

Usage:
```
{{</* verse file="qasida/file-name" lang="en" */>}}
```

Parameters:
- `file` - Path to the JSON file relative to the data directory
- `lang` - Language code (currently only `en` is supported)

### get_title

Use this shortcode to display the title of a Qasida or Salawaat.

Usage:
```
{{%/* get_title file="qasida/file-name" lang="en" */%}}
```

### qasida_meta

Adds metadata for a Qasida page.

Usage:
```
{{</* qasida_meta */>}}
```

## Word by Word

This feature is implemented as part of the `verse` shortcode.
As some translations may involve more poetic translations or otherwise translate multiple words
together, making it harder to read the Arabic verse, I've moved away from using this as the default.

But may be useful for you regardless.

Have a look at this example:

{{< verse file="salawaat/example" lang="en" >}}

## Settings Functionality

User settings are managed through JavaScript and stored in localStorage. The settings include:

- Display options for Arabic, transliteration, and translation
- Font family selection for Arabic text
- Font size adjustments

Settings are defined in `site/layouts/partials/docs/inject/menu-before.html`.

## Offline Support

The site uses a service worker (`site/assets/sw.js`) to enable offline access, which is configured in Hugo to precache all pages.

## Development Workflow

1. Fork the repository
2. Clone your fork locally
3. Create a new branch for your changes
4. Start the Hugo development server: `hugo serve`
5. Make your changes
6. Commit and push your changes
7. Create a pull request

## Common Challenges

### Arabic Text

- Ensure proper Unicode representation for Arabic characters
- Include all diacritical marks for proper pronunciation
- Use the appropriate tools mentioned in the README for capturing text

### Hugo Specifics

- The project uses the hugo-book theme with customisations
- Changes to shortcodes require careful testing as they affect all content
- When adding shortcode examples to documentation, escape the delimiters to prevent execution

### Testing Content

When adding new content:

1. Verify Arabic text displays correctly
2. Test all display settings (Arabic, transliteration, translation toggles)
3. Check mobile display
4. Test offline access
