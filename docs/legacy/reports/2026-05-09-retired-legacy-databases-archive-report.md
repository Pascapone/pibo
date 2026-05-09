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
