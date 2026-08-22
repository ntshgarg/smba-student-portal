# SMBA restore drill log

Never record database credentials, backup passphrases, personal data or authentication material here.

Automated monthly stored-artifact results remain in GitHub Actions summaries. Record the quarterly
disposable-Turso drill here because it validates the provider restore boundary that automation does not
receive credentials to create or delete.

## 23 August 2026 — first stored-artifact restore verification

- Operator: platform owner with Codex assistance
- Backup workflow run: `32595676733`
- Encrypted artifact: `smba-production-backup-32595676733-1` (`9481476609`)
- Storage check: one unexpired artifact containing exactly one `.tar.gz.gpg` ciphertext file; no plaintext
  database, manifest or tar file was stored
- Restore workflow run: `32595758603`
- Verification: trusted-run selection, immutable artifact digest, decryption, archive path/type checks,
  manifest checksum and row counts, SQLite integrity, foreign keys, migrations, separate clean build,
  restored-application health and login smoke all passed
- Cleanup: restored plaintext and the application process were removed by the workflow's unconditional
  cleanup step
- Freshness monitor run: `32595832650`; backup age, restore age, artifact availability and production
  security-signal checks passed
- Production writes: none
- Result: **PASS**
- Remaining boundary: the quarterly disposable-Turso restore drill is still due by 20 November 2026

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
