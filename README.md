# About

بِسْمِ ٱللّٰهِ ٱلرَّحْمٰنِ ٱلرَّحِيمِ

We begin by purifying and resetting the intentions.

# Intro

This project was created for myself to consolidate the Qasidah from various sources into a single resource.
Additionally I wanted to be able to capture transliteration and translation in a way that would be easy for a reader to follow,
eg while reading the Arabic/transliteration being able to quickly glance at the translation, inspired by the many Quran apps.

I also need to apologise in advance for the mistakes and shortcomings.

# Key Project Intentions and Goals

There was a further intention to design the system in a way to help consolidate effort within the community.
Various Qasida websites exist in various states of completion
but often there is no clear way to contribute or update, perhaps the maintainers no longer have the time or otherwise.
The project therefore provides a framework for:

## Easy Community Contribution

1. As a way for the community to contribute back to the collection

## Easy Community Forking

1. To allow people to fork the project should they disagree with aspect or create their own variation

## Provision for API deployment or Data Consumption

The project utilises a json as a way to store the Arabic, transliterations and translations.
The intention of this is to allow this system to be used in an API or otherwise
such that other applications can consume this effort for their own projects, such as an app.

## Possibility for Offline access

The intention of a static website generator is to provide a framework that allows
this effort to be converted into a PWA. Allowing users to access data offline when possible.

# Contributors

Contributions are welcome and encouraged!

## Page Types

### Most Qasidah and Salawaat

Will follow a pattern where the verses are loaded first, followed by some details.

```md
# Verses loaded via json

# About
About to poem itself, context etc.

## Author
About the author of the poem

## Source
For Arabic, translation or transliteration
```


# Useful workflow

## Capturing existing documents/photos

1. The Google Translate app works really well at capturing the arabic with harakaat (especially for non-printed).
2. Verses where the harakaat has not been captured properly can be recovered using: https://rdi-tashkeel.com/en/home
   1. You can use the dev tools to grab the harakaat version.
3. Minor adjustments can be made online if preferred https://www.lexilogos.com/keyboard/arabic.htm.

## Transliterations

AI can provide an excellent starting point for transliterations, consider the following prompt:

```text
Using the Library of Congress Arabic Romanization system, transliterate the snippet below, returning it in the exact same form:
'''

'''
```

## Translations

AI can provide starting point for translations, consider the following prompt:

### Poetic Prompt

```text
Using the perspective of a Cambridge University Academic who has studied Sufi Poetry poetically translate the snippet below, returning it in the exact same form:
'''

'''
```

Using the prompt above there is a tendency for the AI to favour translations that rhyme
and this may mean it choses words that are less literal in translation.

### Literal Prompt

```text
Using the perspective of a Cambridge University Academic who has studied Sufi Poetry poetically translate the snippet below, but prefer literal meaning over rhyme, returning it in the exact same form:
'''

'''
```


### Guidance on Translations

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
