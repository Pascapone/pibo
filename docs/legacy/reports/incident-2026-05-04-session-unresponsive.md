# Incident Report: Session Unresponsive — `ps_bb924959-31cf-47df-a0e8-832bf99968e2`

**Date:** 2026-05-04  
**Reporter:** Pibo Agent (diagnostic analysis)  
**Session:** `ps_bb924959-31cf-47df-a0e8-832bf99968e2`  
**Pi Session:** `43dffc33-4953-48dd-a266-d2442201622f`  
**Profile:** `pibo-agent`  
**Status:** Resolved (via kill command)

---

## 1. Symptoms

- User sent new messages in the Chat Web UI.
- Messages appeared to be sent but the session never responded.
- No thinking, no tool calls, no error message shown to the user.
- Chat Web session status remained `idle` indefinitely.

---

## 2. Diagnostic Findings

### 2.1 Session Location
The session was **not** running in the current dev build (`~/code/pibo`) but in the **stable** Pibo installation (`~/.pibo/stable`). The browser tab was connected to the stable gateway (ports `4790/4791`), not the dev gateway (`4788`).

### 2.2 Event Stream Analysis
The `pibo-events.sqlite` database contained two unprocessed `message_queued` events:

| Timestamp | Event | Event ID |
|---|---|---|
| 2026-05-04T04:46:03.555Z | `message_queued` | `82908eee-5043-4997-ba42-bd840d6fd2a2` |
| 2026-05-04T04:47:26.082Z | `message_queued` | `ad5dfb64-8683-4433-be4c-adc2ec64ad69` |

**No subsequent events** were emitted for either message:
- No `thinking_started`
- No `tool_call`
- No `message_started`
- No `error` or `aborted` event in the output stream

The last successful processing cycle ended on **2026-05-03T23:42:55Z** (`tool_call` → `thinking_finished` → `tool_execution_updated`).

### 2.3 Trace State

```
pibo debug trace ps_bb924959-31cf-47df-a0e8-832bf99968e2 --running-only

status: error
nodes: 0
```

The underlying **Pi Session** (`43dffc33-...`) was internally marked as **`error`**, but the trace builder could not reconstruct any nodes. This indicates a non-recoverable failure at the Pi (agent execution) layer.

### 2.4 Job Queue State

One job in the `runs` queue had been stuck in `running` for **>21 hours**:

```
job_7cf77330-89ab-4488-8211-021f09dfe94f | runs | running | 2026-05-03T07:16:50
```

There were **zero yielded runs** associated with the affected Pibo Session.

---

## 3. Root Cause (Confirmed)

The Pi Session entered an **error state** during execution on 2026-05-03 around 23:42Z. After that point:

1. The gateway no longer spawned new agent runs for queued messages.
2. The error state was **not propagated** into the public `pibo.output` event stream.
3. The Chat Web UI continued to show `idle` status, leaving the user with no indication that the session was dead.
4. New messages were accepted and queued (`message_queued`) but never dequeued for processing.

---

## 4. Resolution

A manual **kill command** was issued by the user. After the process was terminated and the session restarted, it began processing queued messages normally again.

---

## 5. Implications & Required Actions

### 5.1 Error Propagation Gap
**Finding:** When a Pi Session is internally marked as `error` (visible via `debug trace`), no corresponding `error` event is published to the `pibo.output` stream.

**Required:** The error state must be **forwarded to the Chat Web UI** so the user sees that the session has crashed and is not merely "thinking slowly."

### 5.2 Missing User-Facing Recovery
**Finding:** The Chat Web offered no recovery mechanism. The user had to discover via CLI debugging that the session was dead and manually kill/restart it.

**Required:** The UI should:
- Display a clear error indicator when the underlying session is in `error` state.
- Offer a **"Restart / Recover Session"** action directly in the chat interface.

### 5.3 Stale Job in Runs Queue
**Finding:** A single `running` job (`job_7cf77330-...`) remained stuck for >21 hours without failure or timeout.

**Required:** Investigate whether long-running jobs without heartbeat/timeout can starve or confuse the worker pool, and whether they prevent new runs from being scheduled for unrelated sessions.

### 5.4 Silent Message Loss
**Finding:** Two user messages were queued but will never be processed because they arrived while the session was dead. The user may assume they were lost.

**Required:** Either:
- Replay queued messages automatically after recovery, **or**
- Explicitly notify the user that messages sent during the outage were dropped and must be resent.

---

## 6. Related Observations

- The browser tab was open on `localhost:4792` (Chat Web Settings page), yet no process was listening on port `4792` at the time of diagnosis. The session was functional because the tab had been loaded previously and the stable gateway (`4790/4791`) was still serving API requests.
- The `stable` and `dev` Pibo instances share the same SQLite databases under `~/.pibo/`, which is why the session was discoverable from the dev CLI but only manipulable via the stable binary.

---

*End of report.*
