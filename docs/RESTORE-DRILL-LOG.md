# SMBA restore drill log

Never record database credentials, backup passphrases, personal data or authentication material here.

## 20 August 2026 — logical production restore

- Operator: platform owner with Codex assistance
- Source: production `smba-development` Turso database
- Access: newly minted database-scoped read-only token
- Recovery method: provider-independent logical snapshot
- Snapshot controls: consistent read transaction, schema and row copy, SQLite integrity check, foreign-key
  check, source/restored row-count comparison and SHA-256 manifest
- Storage simulation: snapshot and manifest archived, encrypted with GnuPG AES-256, every plaintext source
  removed, encrypted archive decrypted into a separate temporary directory
- Restored verification: checksum, integrity, foreign keys and row counts passed
- Production writes: none
- Temporary data: removed after successful verification
- Result: **PASS**
- Limitation: this drill proved extraction, encryption and local restoration. The next quarterly drill should
  additionally create a disposable Turso database and verify the application health check against it.
- Next drill due: 20 November 2026
