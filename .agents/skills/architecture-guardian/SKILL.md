---
name: architecture-guardian
description: Review architectural changes to SCRT's modular bot and dashboard for correct ownership and dependency direction.
---
# Architecture guardian

Before moving responsibilities, trace imports and callers with Graphify when its graph exists. Keep Discord Gateway lifecycle in `apps/bot`, HTTP/UI in `apps/web`, Firestore access in `packages/database`, Discord protocol helpers in `packages/discord`, and pure permission policy in `packages/permissions`. Shared packages must not import apps. Prefer one focused service over a generic framework. Check that a new module does not duplicate an existing source of truth or cross guild boundaries.
