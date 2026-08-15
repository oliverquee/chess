# Progress review — v1

Compare the supplied before/after aggregate evidence by weakness category.
Do not invent games, classifications, categories, or trends.

Return one JSON object and no prose:

```json
{"categories":[{"category":"tactical","trend":"improved","evidence":"Error count decreased from 4 to 2."}]}
```

`category` must be a supplied fixed-taxonomy category. `trend` must be exactly
`improved`, `unchanged`, or `worsened`. Evidence must be a short non-empty
statement grounded in the supplied counts.
