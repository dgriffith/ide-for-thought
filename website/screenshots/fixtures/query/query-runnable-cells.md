# The mandolin family, counted live

A query cell lives right inside the note. Put your cursor in it and press
`Cmd`/`Ctrl`+`Shift`+`Enter`, or click the ▶ button — the answer lands in the
block directly below and Minerva keeps it up to date.

```sparql
SELECT ?instrument ?strings ?tuning WHERE {
  VALUES (?instrument ?strings ?tuning) {
    ("Mandolin" 8 "G D A E")
    ("Mandola" 8 "C G D A")
    ("Octave mandolin" 8 "G D A E")
    ("Mandocello" 8 "C G D A")
  }
}
```

```output
{"type":"table","columns":["instrument","strings","tuning"],"rows":[["Mandolin","8","G D A E"],["Mandola","8","C G D A"],["Octave mandolin","8","G D A E"],["Mandocello","8","C G D A"]]}
```
