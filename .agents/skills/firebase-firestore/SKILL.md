---
name: firebase-firestore
description: Design or modify SCRT Firestore documents, queries, and Admin initialization with multi-guild isolation.
---
# Firebase and Firestore

Initialize Admin once through `packages/database`. Scope every document path by validated guild ID. Preserve existing guild configuration on rejoin and mark removal instead of deleting data. Use server timestamps for persisted events and transactions for state dependent on previous values. For future activity tracking, write session starts and aggregate on exit or recovery; never write a heartbeat each second. Document schema changes and consider read/write cost before adding listeners or scans.
