---
title: Structured Reasoning
tags: [tutorial, area/graph]
---

# Structured Reasoning

Wiki-links sketch how ideas relate. When you want to be **precise** about the
shape of an argument, Minerva gives you a vocabulary — the *thought ontology* —
for claims, the grounds that support them, the warrants that license the
inference, and the rebuttals that push back.

## Model an argument as data

Embed a fenced `turtle` block and you're writing directly into the graph. Here's
Madison's argument from [[Sources and Citations]], modeled formally. The
`thought:`, `this:`, and `sources:` prefixes are all provided for you.

```turtle
this:claim a thought:Claim ;
    thought:label "A large republic controls the mischiefs of faction better than a small one" ;
    thought:cites sources:federalist-10 .

this:grounds a thought:Grounds ;
    thought:label "A larger republic holds a greater variety of interests, so a majority faction is less likely to form" ;
    thought:supports this:claim .

this:warrant a thought:Warrant ;
    thought:label "If assembling an oppressive majority is harder, faction is better controlled" ;
    thought:supports this:claim .

this:rebuttal a thought:Rebuttal ;
    thought:label "Classical theory (Montesquieu) holds republics survive only at small scale" ;
    thought:challenges this:claim .
```

That's the same argument you traced informally in
[[Links That Mean Something]] — but now each part is a typed object the graph
understands, anchored to the source that grounds it.

## Query the reasoning

Because those are real graph nodes, you can ask for them. This finds every claim
in the thoughtbase:

```sparql {id=claims}
SELECT ?label WHERE { ?c a thought:Claim ; thought:label ?label } ORDER BY ?label
```
```output
{"type":"table","columns":["label"],"rows":[["A large republic controls the mischiefs of faction better than a small one"]]}
```

Run it, then add a `thought:Claim` of your own in the block above and Run again —
watch your new claim appear. Your prose and your formal model live in the same
file, and stay in sync.

---

Next: [[Export and Publish]] → · back to [[Start Here]]
