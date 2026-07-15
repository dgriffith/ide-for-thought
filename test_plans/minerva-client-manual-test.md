# Minerva CLI Manual Test Plan
## Testing the Headless Substrate Interface

**Project Path:** `~/Fleetwood Mac`  
**Test Date:** [Fill in when running]  
**Tester:** [Your name]

---

## Pre-Flight Checklist

- [ ] Repo is on `main` branch and up-to-date
- [ ] `pnpm install` has been run recently
- [ ] CLI has been built: `pnpm cli:build`
- [ ] `minerva` is on your PATH (see setup below)
- [ ] Fleetwood Mac thoughtbase exists at `~/Fleetwood Mac`
- [ ] Fleetwood Mac project has been opened in Minerva UI at least once (so `.minerva/` index exists)

## Build & Link the CLI

`vite` isn't on the global PATH — always drive the build through the package
script, which resolves the local `node_modules/.bin/vite`. The `bin` field in
`package.json` maps `minerva` → `.vite/build/cli.js`; `pnpm link --global`
puts that on your PATH.

**One-time setup:**
```bash
cd /Users/davegriffith/minerva
pnpm cli:build        # builds .vite/build/cli.js and marks it executable
pnpm link --global    # exposes `minerva` globally (symlinked into this repo)
```

**Verify:**
```bash
which minerva         # → ~/Library/pnpm/minerva
minerva --help
```

**Expected Output:**
- Build completes without errors → `.vite/build/cli.js`
- `minerva` resolves on PATH and prints help

**Result:** ☐ Pass ☐ Fail  
**Notes:**

> **Note:** `minerva` runs the *last built* `cli.js`. After changing CLI source,
> re-run `pnpm cli:build`. The global link points into this repo, so it resolves
> the repo's `node_modules` for the externalized native deps (DuckDB,
> onnxruntime) — don't delete `node_modules` and expect it to keep working.

---

## Help & Basic Invocation

### Test 1: Show Help
**Command:**
```bash
minerva --help
```

**Expected:**
- Displays the HELP text
- Shows all available commands: query, sql, search, semantic, read, context, propose-note, mcp
- Shows options: --project, --limit, --by
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 2: No Arguments Shows Help
**Command:**
```bash
minerva
```

**Expected:**
- Displays help text
- Exit code: 2 (usage error)

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 3: Unknown Command
**Command:**
```bash
minerva foobar
```

**Expected:**
- Error message: `Unknown command: foobar`
- Help text follows
- Exit code: 2

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Query Tests (Knowledge Graph / SPARQL)

### Test 4: Basic SPARQL Query
**Command:**
```bash
minerva query "SELECT ?s WHERE { ?s a minerva:Note } LIMIT 5" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns JSON with `columns` and `results` arrays
- `columns` array contains: `[ "s" ]`
- `results` array contains up to 5 rows, each with a binding for `s` (an IRI)
- Exit code: 0
- Output is valid JSON

**Result:** ☐ Pass ☐ Fail  
**Sample Output:**

```json
{
  "columns": ["s"],
  "results": [
    {"s": "minerva:note/..."},
    ...
  ]
}
```

**Notes:**

---

### Test 5: Count Notes
**Command:**
```bash
minerva query "SELECT (COUNT(?n) as ?count) WHERE { ?n a minerva:Note }" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns a count of all notes in the graph
- Should be a positive integer (Fleetwood Mac has multiple notes)
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 6: Query with No Results
**Command:**
```bash
minerva query "SELECT ?x WHERE { ?x a nonexistent:Class }" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns JSON with empty `results` array
- `columns` contains `[ "x" ]`
- Exit code: 0 (not an error — just no results)

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 7: Invalid SPARQL
**Command:**
```bash
minerva query "SELECT * WHERE {" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns SPARQL error on stderr
- Contains "SPARQL error:" prefix
- Exit code: 1

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Search Tests (Full-Text)

### Test 8: Full-Text Search
**Command:**
```bash
minerva search "Fleetwood Mac" --project ~/Fleetwood\ Mac --limit 5
```

**Expected:**
- Returns JSON with results array
- Each result has: `path`, `content`, `score` (or similar relevance metric)
- Exit code: 0
- Up to 5 results (respects --limit)

**Result:** ☐ Pass ☐ Fail  
**Sample Output:**

```json
[
  {
    "path": "fleetwood-mac/...",
    "content": "...",
    "score": ...
  },
  ...
]
```

**Notes:**

---

### Test 9: Search with No Matches
**Command:**
```bash
minerva search "xyzabc123notaword" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns empty results array
- Exit code: 0
- Valid JSON

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 10: Search Limit Parameter
**Command:**
```bash
minerva search "the" --project ~/Fleetwood\ Mac --limit 3
```

**Expected:**
- Returns no more than 3 results
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Semantic Search Tests (Embeddings)

### Test 11: Semantic Search
**Command:**
```bash
minerva semantic "band members and history" --project ~/Fleetwood\ Mac --limit 5
```

**Expected:**
- Returns JSON array of results (or error if embeddings not yet computed)
- Each result has: `path`, `content`, `similarity` (or distance score)
- Exit code: 0
- OR: If embeddings not indexed, error message about no embedded content
- Valid JSON either way

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 12: Semantic Search with Limit
**Command:**
```bash
minerva semantic "music" --project ~/Fleetwood\ Mac --limit 2
```

**Expected:**
- No more than 2 results returned
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Read Tests (File Content)

### Test 13: Read a File
**Command:**
```bash
minerva read "fleetwood-mac.md" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns JSON with file content
- Content is the raw markdown (not rendered)
- Includes file path for grounding
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Sample Output:**

```json
{
  "path": "fleetwood-mac.md",
  "content": "# Fleetwood Mac\n..."
}
```

**Notes:**

---

### Test 14: Read a Nested File
**Command:**
```bash
minerva read "fleetwood-mac/Rumours.md" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns the content of the nested file
- Path is relative to project root
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 15: Read Non-Existent File
**Command:**
```bash
minerva read "does-not-exist.md" --project ~/Fleetwood\ Mac
```

**Expected:**
- Error message on stderr
- Exit code: 1

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 16: Read Missing Path Argument
**Command:**
```bash
minerva read --project ~/Fleetwood\ Mac
```

**Expected:**
- Error: "read: a relative note path is required."
- Exit code: 2

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Context Tests (Assembled Slice)

### Test 17: Get Context for a Topic
**Command:**
```bash
minerva context "band formation" --project ~/Fleetwood\ Mac --limit 10
```

**Expected:**
- Returns JSON with relevant notes + their link neighborhood
- Includes full content of each note
- Includes connections between notes
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Sample Output:**

```json
{
  "topic": "band formation",
  "notes": [...],
  "links": [...],
  "neighborhood": [...]
}
```

**Notes:**

---

### Test 18: Context with Limit
**Command:**
```bash
minerva context "history" --project ~/Fleetwood\ Mac --limit 3
```

**Expected:**
- Respects the --limit parameter
- Returns at most 3 top-matching notes
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Propose Note Tests (Writing)

### Test 19: Propose a New Note
**Command:**
```bash
echo "# Test Note

This is a test note created via the CLI.

## Section One
Some content here." | minerva propose-note "test-note.md" --project ~/Fleetwood\ Mac
```

**Expected:**
- Returns JSON with proposal info
- Note is filed as a pending proposal (not directly written)
- `proposedBy` is "cli" (default)
- Exit code: 0
- Returns a proposal ID or reference

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 20: Propose Note with Custom Provenance
**Command:**
```bash
echo "Another test." | minerva propose-note "another-test.md" --by "test-agent-1" --project ~/Fleetwood\ Mac
```

**Expected:**
- `proposedBy` is "test-agent-1"
- Returns a proposal with that provenance
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 21: Propose Note Without stdin
**Command:**
```bash
minerva propose-note "empty.md" --project ~/Fleetwood\ Mac
```

**Expected:**
- Error: "propose-note: pipe the note content on stdin"
- Exit code: 2 (usage error)

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 22: Propose Note Without Path
**Command:**
```bash
echo "content" | minerva propose-note --project ~/Fleetwood\ Mac
```

**Expected:**
- Error: "propose-note: a relative note path is required."
- Exit code: 2

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Project Path Tests

### Test 23: Default Project (Current Directory)
**Command (run from Fleetwood Mac dir):**
```bash
cd ~/Fleetwood\ Mac && minerva search "test"
```

**Expected:**
- Uses current directory as project root (no --project needed)
- Searches in Fleetwood Mac
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 24: Explicit Project Path
**Command:**
```bash
minerva search "music" --project ~/Fleetwood\ Mac
```

**Expected:**
- Uses specified project path
- Search works correctly
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 25: Project Path with Equals Syntax
**Command:**
```bash
minerva search "band" --project=~/Fleetwood\ Mac
```

**Expected:**
- Parses `--project=path` syntax correctly
- Search works as normal
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 26: Invalid Project Path
**Command:**
```bash
minerva search "test" --project ~/nonexistent
```

**Expected:**
- Error: "Not a directory: ..."
- Exit code: 2

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## JSON Output & Piping

### Test 27: Pipe Query Results to jq
**Command:**
```bash
minerva query "SELECT ?n WHERE { ?n a minerva:Note } LIMIT 3" --project ~/Fleetwood\ Mac | jq '.results | length'
```

**Expected:**
- jq successfully parses the JSON
- Outputs the count of results (≤ 3)
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 28: Pipe Search Results to jq
**Command:**
```bash
minerva search "history" --project ~/Fleetwood\ Mac --limit 2 | jq '.[0].path'
```

**Expected:**
- Extracts the path of the first result
- Valid jq output
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## MCP Server Test

### Test 29: Start MCP Server (Interactive)
**Command:**
```bash
timeout 3 minerva mcp --project ~/Fleetwood\ Mac || true
```

**Expected:**
- MCP server starts and listens on stdio
- With timeout=3, it runs for 3 seconds then exits (or is killed)
- Exit code: 0 or 124 (timeout is normal)
- No startup errors in stderr

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Error Handling & Edge Cases

### Test 30: Missing Required Argument (query)
**Command:**
```bash
minerva query --project ~/Fleetwood\ Mac
```

**Expected:**
- Error: "query: a SPARQL string is required."
- Exit code: 2

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 31: Empty Query String
**Command:**
```bash
minerva query "   " --project ~/Fleetwood\ Mac
```

**Expected:**
- Error: "query: a SPARQL string is required."
- Exit code: 2

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 32: Special Characters in Search
**Command:**
```bash
minerva search "Fleetwood & Mac's \"iconic\" 1977 album" --project ~/Fleetwood\ Mac
```

**Expected:**
- Search handles special characters gracefully
- Returns results or empty (no crash)
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 33: Very Long SPARQL Query
**Command:**
```bash
minerva query "SELECT ?n WHERE { ?n a minerva:Note . ?n rdfs:label ?label . FILTER(STRLEN(?label) > 0) . ?n minerva:inPath ?path . FILTER(STRLEN(?path) > 0) } LIMIT 100" --project ~/Fleetwood\ Mac
```

**Expected:**
- Long query is handled (no length limit enforced)
- Returns valid results
- Exit code: 0

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Performance & Indexing

### Test 34: First Run (Cold Start)
**Command (on a fresh project or after clearing .minerva):**
```bash
time minerva query "SELECT (COUNT(?n) AS ?count) WHERE { ?n a minerva:Note }" --project ~/Fleetwood\ Mac
```

**Expected:**
- First run indexes the project (may take several seconds)
- Returns correct count
- Note the startup time

**Result:** ☐ Pass ☐ Fail  
**Time (ms):** ___  
**Notes:**

---

### Test 35: Warm Start (Cached Indexes)
**Command (immediately after Test 34):**
```bash
time minerva query "SELECT (COUNT(?n) AS ?count) WHERE { ?n a minerva:Note }" --project ~/Fleetwood\ Mac
```

**Expected:**
- Indexes are already cached/on disk
- Second run should be faster than first
- Same result returned

**Result:** ☐ Pass ☐ Fail  
**Time (ms):** ___  
**Notes:**

---

## SQL Tests (DuckDB)

### Test 36: SQL Query on CSV
**Command:**
```bash
minerva sql "SELECT COUNT(*) as count FROM read_csv('~/Fleetwood Mac/**/*.csv') WHERE length(columns) > 0" --project ~/Fleetwood\ Mac 2>&1 || echo "Note: CSV test may not apply if no CSV files exist"
```

**Expected:**
- If CSV files exist in project: Returns count of rows
- If no CSV files: Error message (not a failure)
- Exit code: 0 (for valid query) or 1 (for query error)

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Cleanup

### Test 37: Verify Proposals Were Filed
**Steps:**
1. Open Minerva UI
2. Check if any pending proposals exist from `propose-note` tests
3. Verify they can be reviewed/approved

**Expected:**
- Proposals from tests 19-20 appear in the approval queue
- Can be reviewed and approved/rejected in the UI

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

### Test 38: Delete Test Proposals
**Steps:**
1. In Minerva UI, delete any test proposals from this test session
2. Clean up any temporary test files created

**Expected:**
- Test artifacts are cleaned up
- Project is in a clean state

**Result:** ☐ Pass ☐ Fail  
**Notes:**

---

## Summary

**Total Tests:** 38  
**Passed:** ___  
**Failed:** ___  
**Skipped:** ___  
**Blockers/Severity Issues:** 

---

## Issues Found

| # | Test | Severity | Description | Action |
|---|------|----------|-------------|--------|
| 1 |  | ☐ Critical ☐ High ☐ Medium ☐ Low |  |  |
| 2 |  | ☐ Critical ☐ High ☐ Medium ☐ Low |  |  |
| 3 |  | ☐ Critical ☐ High ☐ Medium ☐ Low |  |  |

---

## Performance Notes

| Test | Command | Time (ms) | Notes |
|------|---------|-----------|-------|
| Test 34 (Cold) |  |  |  |
| Test 35 (Warm) |  |  |  |

---

## Additional Observations

(Overall stability, unexpected behaviors, feature requests, etc.)

