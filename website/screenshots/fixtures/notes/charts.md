# Mandolin orchestras founded, by decade

```vega-lite
{
  "height": 260,
  "data": {"values": [
    {"decade": "1880s", "orchestras": 12},
    {"decade": "1890s", "orchestras": 41},
    {"decade": "1900s", "orchestras": 78},
    {"decade": "1910s", "orchestras": 64},
    {"decade": "1920s", "orchestras": 33}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "decade", "type": "ordinal", "title": "Decade"},
    "y": {"field": "orchestras", "type": "quantitative", "title": "Orchestras founded"}
  }
}
```
