# About

بِسْمِ ٱللّٰهِ ٱلرَّحْمٰنِ ٱلرَّحِيمِ

We begin by purifying and resetting the intentions.

# Intro

This project was created for myself to consolidate the Qasidah from various sources into a single resource.
Additionally I wanted to be able to capture transliteration and translation in a way that would be easy for a reader to follow,
eg while reading the Arabic/transliteration being able to quickly glance at the translation, inspired by the many Quran apps.

# Key Project Intentions and Goals

There was a further intention to design the system in a way to help consolidate effort within the community.
Various Qasida websites exist in various states of completion
but often there is no clear way to contribute or update, perhaps the maintainers no longer have the time or otherwise.
The project therefore provides a framework for:

## Easy Community Contribution

1. As a way for the community to contribute back to the collection

## Easy Community Forking

1. To allow people to fork the project should they disagree with aspect or create their own variation

```md
# Verses loaded via json

# About
About to poem itself, context etc.

## Author
About the author of the poem

## Source
For Arabic, translation or transliteration
```

## Provision for API deployment or Data Consumption

The project utilises a json as a way to store the Arabic, transliterations and translations.
The intention of this is to allow this system to be used in an API or otherwise
such that other applications can consume this effort for their own projects, such as an app.

## Possibility for Offline access

The intention of a static website generator is to provide a framework that allows
this effort to be converted into a PWA. Allowing users to access data offline when possible.
