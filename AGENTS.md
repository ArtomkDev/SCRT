# Engineering workflow

Inspect existing code and repository guidance before changing it. Use Graphify for repository-wide dependency discovery when a graph exists. Find the source of truth and consumers before editing; keep changes small and coherent. Apply relevant skills in `.agents/skills/` for the area being changed. Preserve package boundaries: bot runtime, web, database, Discord integration, authorization, validation, and shared types.

Keep secrets server-side, validate external input, and enforce authorization in backend operations. After changes, run relevant typecheck, lint, tests, and build. Review the diff for security, guild isolation, dead code, and accidental duplication before finishing.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
