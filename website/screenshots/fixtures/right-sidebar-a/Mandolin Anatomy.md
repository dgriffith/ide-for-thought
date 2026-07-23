---
title: The Anatomy of a Mandolin
aliases: [Mandolin Anatomy, Parts of the Mandolin]
tags: [mandolin, lutherie]
era: modern
status: reference
family: Lute
courses: 4
---

# The Anatomy of a Mandolin

A luthier's tour of the instrument, from the carved #mandolin/soundboard to the
scrolled headstock — the vocabulary every #lutherie/setup sheet assumes.

## The Body

The resonating chamber that turns string vibration into sound.

### Soundboard

The top plate is the mandolin's primary radiator[^loar]. Its #mandolin/anatomy is
tuned by graduation — thinning the wood toward the edges.

### Back and Sides

Bowl-back or carved: the two great traditions of mandolin building.

## The Neck

### Fretboard

Twenty-plus frets across a gently radiused board.

### Headstock

Where the tuning machines live, scrolled or paddle-shaped.

## Strings and Tuning

Four courses of paired strings, tuned G–D–A–E in fifths[^courses].

## In the Catalog

A quick pull from the models dataset shows how the body shapes evolved over
two and a half centuries:

```sql
SELECT year, maker, model, body_shape
FROM mandolin_models
ORDER BY year
```

[^loar]: Lloyd Loar's 1920s Gibson F-5 tuned the soundboard graduation by tap-tone — a method still used by boutique builders.
[^courses]: The same tuning as the violin, but doubled: each course is a pair of strings tuned in unison.
[^gibson]: Orville Gibson's carved-top patent (1898) reset the mandolin's structural template. Kept here as a reference and deliberately never cited in the body above.
