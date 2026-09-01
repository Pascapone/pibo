---
type: "Historical Record"
title: "Retired Legacy Database Archive Report"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/reports/2026-05-09-retired-legacy-databases-archive-report.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "6280bc9b6eb978f2ef401b37cadfe6ed02770cab"
  source_bytes: 1047
  source_sha256: "6c1cbafa21c9c7b3f03eeb80c87f6b8f0668e721ce141867a2f25face71741e9"
  source_body_sha256: "6c1cbafa21c9c7b3f03eeb80c87f6b8f0668e721ce141867a2f25face71741e9"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Retired Legacy Database Archive Report

Date: 2026-05-09

## Archived Production Files

Archived to:

```text
/root/.pibo/legacy-archives/retired-sqlite-20260509-143308
```

Files moved:

```text
web-chat.sqlite.archived-source
web-chat.sqlite-wal.archived-source
web-chat.sqlite-shm.archived-source
pibo-sessions.sqlite.archived-source
pibo-sessions.sqlite-wal.archived-source
pibo-sessions.sqlite-shm.archived-source
```

`SHA256SUMS.txt` was written in the same archive directory.

## Verification

Before archiving, the production gateway had no open file descriptors for:

```text
web-chat.sqlite
pibo-sessions.sqlite
pibo-chat-v2.sqlite
```

After archiving and a health check, none of the retired SQLite files were recreated in `/root/.pibo`.

The production gateway process continued to use only `pibo.sqlite` for Chat Web and Pibo Session data.

## Code Cleanup

The old Chat Web SQLite runtime implementations and legacy migration importer were removed from source. Remaining Chat Web data access uses Chat Data V2 over `pibo.sqlite`.
