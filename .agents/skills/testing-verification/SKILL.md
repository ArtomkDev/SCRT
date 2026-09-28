---
name: testing-verification
description: Verify SCRT changes with targeted permission, configuration, integration, and build checks.
---
# Testing and verification

Test pure policy and schema failures where regression would open access or prevent startup. For backend changes run typecheck, lint, and tests; for deployment changes run the production build. Record command failures and distinguish missing credentials from code failures. Do not claim a runtime login, Firebase write, or Railway deployment succeeded without performing it.
