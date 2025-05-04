# How to contribute

اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلَى إِبْرَاهِيمَ وَعَلَى آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ

We welcome and encourage contributions to the Dhikr-Hub project. There are multiple ways to contribute, depending on your skills and interests.

## Types of Contributions

### 1. Adding New Qasidas or Salawaat

One of the most valuable contributions is adding new content to the collection. This involves:

- Adding Arabic text with proper diacritical marks (tashkeel)
- Creating transliterations following the Library of Congress Arabic Romanization system
- Providing English translations
- Organising the content with proper verse and chorus structure

### 2. Improving Existing Content

- Correcting Arabic text and diacritical marks
- Enhancing transliterations for accuracy
- Refining translations to better convey meaning
- Adding missing contextual information (author details, historical context)

### 3. Technical Contributions

- Improving the website's functionality
- Enhancing the user interface
- Fixing bugs or addressing issues
- Adding new features

## How to Add a New Qasida

### Step 1: Prepare the Content

#### Arabic

Prepare the Arabic text with proper diacritical marks
- Consider using Google Translate app for capturing Arabic text from printed sources
- For verses where harakaat (diacritical marks) are missing, you can use [RDI Tashkeel](https://rdi-tashkeel.com/en/home)
- Make minor adjustments using an [Arabic keyboard](https://www.lexilogos.com/keyboard/arabic.htm)

#### Transliteration

Follow the Library of Congress Arabic Romanization system

AI can provide an excellent starting point for transliterations, consider the following prompt:

```text
Using the Library of Congress Arabic Romanization system, transliterate the snippet below, returning it in the exact same form:
'''

'''
```

#### Translation

AI can provide starting point for translations, consider the following prompt:

##### Poetic Prompt

```text
Using the perspective of a Cambridge University Academic who has studied Sufi Poetry poetically translate the snippet below, returning it in the exact same form:
'''

'''
```

Using the prompt above there is a tendency for the AI to favour translations that rhyme
and this may mean it choses words that are less literal in translation.

##### Literal Prompt

```text
Using the perspective of a Cambridge University Academic who has studied Sufi Poetry poetically translate the snippet below, but prefer literal meaning over rhyme, returning it in the exact same form:
'''

'''
```

##### Guidance on Translations

If using prompts it may be helpful to review the output of both and combine them together.

At this stage we will favour translations that are more literal, unless a translation
has been explicitly approved by a scholar that may deviate from this.

Some guidance during reviews of translation include:

1. Linguistic devices should be translated into their equivalent.
   1. Due to us favouring the literal translation.
   In the case where metaphors or other idioms are used, the literal translation should be given footnotes or commentary added to  the 'About' section to reflect.
1. Translations should be clear and accessible, not using exessively academic language.
1. Translations should respect the poet's intent (when known).
1. Maintenance of the cultural context of the Arabic traditions referenced instead of trying to translate them to another's cultural specific context.
   1. Use the 'About' section of the poem to add detail of this context for readers to gain an understanding and appreciation.


### Step 2: Create the JSON File

Create a new JSON file in the `site/data/qasida/` directory. The filename should be a simplified version of the Qasida title, using kebab-case (hyphen-separated words).

Each Qasida file must follow this structure:

```json
{
    "name": {
        "ara": "Arabic title with diacritical marks",
        "en": "English title - with transliteration"
    },
    "verses": {
        "ara": [
            ["First line in Arabic"],
            ["Second line in Arabic"],
            ["Third line with", "multiple", "segments"]
        ],
        "en": [
            ["First line transliteration"],
            ["Second line transliteration"],
            ["Third line", "with multiple", "segments"]
        ]
    },
    "translation": {
        "en": [
            ["English translation of first line"],
            ["English translation of second line"],
            ["English translation", "of third line", "with multiple segments"]
        ]
    },
    "order": {
        "chorus": [
            [
                {"repeat": 1, "index": 0},
            ]
        ],
        "verses": [
            [
                {"repeat": 1, "index": 1},
                {"repeat": 1, "index": 2}
            ]
        ]
    }
}
```

### Step 3: Create the Markdown Template

Create a new Markdown file in the `site/content/Qasidas/` directory. The filename should match the JSON file name but with title case and spaces instead of hyphens.

The Markdown file for a Qasida follows a simple structure:

- Start with the title (H1 heading) of the Qasida in English
- Use the qasida_meta shortcode to include metadata
- Add a "Verses" section with H2 heading
- Use the get_title shortcode to display the title
- Use the verse shortcode to render the Qasida content
- Include "About" section with information about the Qasida
- Add "Author" subsection if known
- List sources for Arabic text, transliteration, and translation

(Note: For detailed syntax of the shortcodes, please refer to existing Qasida files in the repository as examples.)

## Submission Process

### For Technical Contributors (Git/GitHub Workflow)

1. Fork the repository on GitHub
2. Clone your fork to your local machine
3. Create a new branch for your contribution
4. Make your changes
5. Test your changes locally (see the [Developer Guide](/Contributing/developer/))
6. Commit your changes with a clear commit message
7. Push your changes to your fork
8. Create a pull request to the main repository

### For Non-Technical Contributors

If you're not familiar with Git/GitHub, you can still contribute:

1. Prepare your content as described above
2. Reach out to the maintainers by:
   - Creating an issue on GitHub describing what you'd like to contribute
   - Sharing your prepared files with the maintainers

## Quality Guidelines

### Arabic Text

- Include all diacritical marks (tashkeel) for proper pronunciation
- Ensure proper spelling and grammar
- Use Unicode representation for Arabic characters (not Arabic presentation forms)

### Transliteration

- Follow the Library of Congress Arabic Romanization system consistently
- Include diacritical marks in the transliteration where appropriate
- Preserve the pronunciation as accurately as possible

### Translation

- Aim for accuracy in conveying the meaning
- Maintain readability and flow in English
- Balance literal translation with poetic expression where appropriate

## Getting Help

If you have questions or need assistance with your contribution:

1. Check the [Issues](https://github.com/adehad/dhikr-hub/issues) section on GitHub
2. Create a new issue with your question
3. Reach out to the project maintainers

Jazākum Allāhu khayran for contributing to this collection of spiritual treasures.
