# @codeoracle/api

**Status:** Stub — no NestJS business logic yet.

Real implementation (repo registration, GitHub webhook HMAC verification + diff resolution, admin endpoints, API token issuance) is not built yet. Depends only on `core-domain`, `db`, `queue`, `config`, `contracts` — never imports `gateway`, `chunker`, or `extraction` directly (those are worker-side concerns).
