---
name: deployment-operations
description: Prepare and maintain SCRT's Railway bot worker and production Next.js runtime.
---
# Deployment and operations

Run the bot as a persistent Railway worker with no HTTP keepalive. Read credentials from environment, never local disk in production. Keep startup failure loud and shutdown signal handling short. Reconcile guild metadata after restart and log individual reconciliation failures. Register global commands for production; consider propagation delay. Treat Firestore as the persistent store and keep processes restart safe.
