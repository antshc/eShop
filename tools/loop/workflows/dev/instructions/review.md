## Response

End your final message with exactly one JSON object. `outcome` is `completed`, `failed`, or `skipped`
per axis; `kind` is `bug`, `initiative`, `quality`, or `smell`; `posted` lists the URLs or ids of the
comments the skill posted; `head` is the head commit you actually reviewed:

```json
{"status": "completed", "result": {"axes": [{"name": "bugs", "outcome": "completed", "note": ""}], "findings": [{"axis": "bugs", "kind": "bug", "summary": "<finding>"}], "posted": ["<comment url or id>"], "head": "<sha>"}}
```

or, when the review could not run at all:

```json
{"status": "failed", "result": {"reason": "<why>"}}
```
