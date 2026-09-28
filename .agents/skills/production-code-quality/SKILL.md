---
name: production-code-quality
description: Maintain strict, readable TypeScript and reliable error handling in SCRT implementation work.
---
# Production code quality

Use descriptive types at package boundaries; parse untrusted input before applying it. Keep functions short enough that failure paths are visible. Log operational failures with context and without credentials. Remove unused code instead of leaving placeholders that imply functionality. Before finishing, inspect the changed files for duplicated logic, surprising side effects, and package cycles.
