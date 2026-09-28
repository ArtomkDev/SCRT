---
name: auth-security
description: Review SCRT Discord OAuth, sessions, server-side permission checks, and secret boundaries.
---
# Authentication and authorization

Keep OAuth tokens and Admin credentials on the server. Validate OAuth state and PKCE, set HTTP-only secure cookies in production, and rotate sessions when refreshing tokens. Derive user ID from the session, never request data. On every guild operation, establish live Discord membership and owner/permission facts before resolving app mappings. Owner access is unconditional. Reject unknown guild IDs and do not treat navigation visibility as authorization.
