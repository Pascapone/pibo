---
type: "Historical Record"
title: "Report: Final Owner Scope Removal Pre-Cutover Backup"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/reports/final-owner-scope-removal-precutover-backup-2026-05-31.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "4a20dbcfcdee3d7c19f5c7f4a30abad3ebf2ce22"
  source_bytes: 1646
  source_sha256: "265214f0cf58377c6541bbce201d4aec96c94f61d184ff4c5cc8d0913b2040b5"
  source_body_sha256: "265214f0cf58377c6541bbce201d4aec96c94f61d184ff4c5cc8d0913b2040b5"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Report: Final Owner Scope Removal Pre-Cutover Backup

**Created:** 2026-05-31  
**Backup directory:** `/root/.pibo/backups/final-owner-scope-removal-precutover-vacuum-20260531T194546Z`  
**Method:** `sqlite VACUUM INTO` per database  
**Source root:** `/root/.pibo`  
**Status:** Complete and verified

## Included databases

| Database | Backup quick_check | Backup tables |
|---|---:|---:|
| `pibo.sqlite` | ok | 27 |
| `chat-agents.sqlite` | ok | 1 |
| `pibo-ralph.sqlite` | ok | 3 |
| `pibo-cron.sqlite` | ok | 2 |
| `web-annotations.sqlite` | ok | 2 |
| `web-projects.sqlite` | ok | 6 |
| `pibo-events.sqlite` | ok | 5 |
| `auth.sqlite` | ok | 4 |
| `context-files/context-files.sqlite` | ok | 2 |

## Not present at source root

These databases were listed in the owner-scope removal plan but did not exist at `/root/.pibo` when the backup ran:

- `pibo-sessions.sqlite`
- `pibo-workflows.sqlite`

## Verification artifacts

Inside the backup directory:

- `README.md`
- `manifest.tsv` with source/backup paths, sizes, and SHA-256 checksums
- `quick-check.tsv` with `PRAGMA quick_check` results for each backup DB

Total backup size: approximately `15G`.

## Safety note

An earlier attempt at `/root/.pibo/backups/final-owner-scope-removal-precutover-20260531T193731Z` timed out during the large `pibo.sqlite` backup and was marked with `INCOMPLETE_DO_NOT_USE`. Use only the verified `final-owner-scope-removal-precutover-vacuum-20260531T194546Z` backup.

## Restore note

Stop the gateway before restoring. Restore by copying selected backup files back to the same relative paths under `/root/.pibo`, then restart through the Pibo CLI.
