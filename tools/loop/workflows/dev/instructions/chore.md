# REVIEW PROCESS

1. **Understand the change**: Read the manifest and every diff, then the changed files and their
   neighbors, until you know what the change does and which behavior must stay intact.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

4. **Apply project standards**: Follow the repository's defined coding and test conventions for
   the files you touch.

5. **Preserve functionality**: Never change what the code does, only how it does it. All
   original features, outputs, public interfaces, and test expectations must remain intact.
   Touch a file outside the change set only when the smallest cleanup a rule requires cannot be
   completed without it.

6. **Stay in scope**: Fix only what the change set introduces or touches. Never fix pre-existing
   problems unrelated to the change (bugs, style, naming, dead code, failing tests, build or
   tooling issues), even if noticed. Mention them in the final message instead.

# EXECUTION

If you find improvements to make:

1. Make the changes directly in the worktree.
2. Run the fastest build and test checks covering every file you changed, and confirm they pass.
   If a check fails and you cannot fix the cause, revert your changes with `git restore` and
   `git clean -fd`, change nothing, and say why.
3. Leave your changes uncommitted. Never run `git add`, `git commit`, `git push`, or open a
   pull request, and never comment, label, or close any Ticket or Spec: Loop commits and
   publishes your changes after this run ends.

If the code is already clean and well-structured, do nothing.

# RESPONSE

End your final message with exactly one JSON object:

```json
{"status": "completed", "result": {"commit_message": "<one-line message for the harness's chore commit, empty when you changed nothing>", "summary": "<refinements made and how they were verified, or why none were needed>", "out_of_scope": ["<pre-existing problem noticed but not fixed>"]}}
```
