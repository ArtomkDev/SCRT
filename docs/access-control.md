# Access control

| Level | View dashboard | Configure modules | Manage access |
| --- | --- | --- | --- |
| VIEWER — Лише перегляд | Yes | No | No |
| ADMIN — Налаштування бота | Yes | Yes | No |
| SUPER_ADMIN — Повний доступ | Yes | Yes | Yes, subject to grant protection |
| Current Discord owner | Yes | Yes | All grants |

Ownership and Discord roles are checked live by the server. The user's ID comes from the encrypted session. A full-access administrator may create new role or personal grants and edit lower levels. An existing SUPER_ADMIN grant may be changed or removed only by the current owner or its original issuer, who must still have settings.manage. This applies to role mappings as well as personal mappings. Grant protection concerns SCRT assignments; managing actual Discord roles and their membership remains governed by Discord.

The owner needs no personal assignment. New installations seed every Discord Administrator role with SUPER_ADMIN and @everyone with VIEWER. The verified installation callback grants SUPER_ADMIN to a nonowner installer. These automatic assignments record the installation-time owner as issuer; other administrators cannot revoke them. Installation by the owner does not add a personal row and cleans any legacy owner row. The page also excludes legacy personal entries for the current owner.

Installation state is signed with a domain-separated HMAC using the server session secret and expires after ten minutes. The callback verifies the signed guild/user/PKCE state, OAuth identity, current session, live member identity and current Discord Manage Guild/Administrator or ownership before granting access. Unsigned cookies from older app versions are rejected; pending installations should be restarted after upgrading.

The existing guild-scoped document `guilds/{guildId}/access/roles` still contains `mappings` and `members`. Each entry may now include `grantedBy`, the Discord ID of its issuer. The backend derives this value; submitted grantor IDs and owner flags are ignored. Changing a grant to a different level records the acting user. Saving the same level preserves its issuer. A legacy SUPER_ADMIN grant without an issuer is editable only by the current owner.

Every access mutation requires a live session and settings.manage, then rechecks the actor's permission against current mappings and checks the target grant inside the Firestore transaction. Concurrent revocation or promotion of the target therefore cannot bypass protection using a stale page. The transaction also verifies that the actor context belongs to the target guild. UI controls use the same pure grant-protection policy, but server authorization is authoritative.

Existing ADMIN and VIEWER grants retain their level on upgrades/reconnects. Old data does not reliably distinguish manually assigned administrators from installation defaults, so it is not bulk-promoted. The owner can explicitly promote intended roles or members using the third level. Existing grants and configurations are preserved when the bot reconnects.

Access forms save through their own Grant/Change/Remove buttons and do not register drafts with the global unsaved-changes banner. Other dashboard forms retain that banner. Member search highlights matching text in nickname, global name, username and ID, including normalized Unicode matches. Existing access is labelled with the highest effective level (owner, personal or role grant, including @everyone) and sorted after matching users without access. Owners and existing personal assignments remain visible as read-only search results; personal assignments are edited in the list above.
