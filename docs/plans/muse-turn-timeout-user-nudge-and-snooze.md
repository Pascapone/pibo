---
type: "Plan"
title: "Muse turn timeout user nudge and snooze"
description: "When a Muse turn exhausts its idle budget, nudge the user in Chat to keep waiting or abort instead of only failing, with a snooze timer for re-decision."
tags: ["muse-native", "timeout", "chat", "user-input"]
status: "draft"
authority: "directive"
generated: { by: "meta/muse-spark", at: "2026-09-19T09:45:00Z" }
---

# Context

Muse turns carry a Pibo-owned idle timeout (`requestTimeoutMs`, hard 30-minute default). Silence is not stuckness: long builds, test suites, and provider retry backoff are healthy but quiet, and today such a turn simply dies with a retryable error that the user only notices after the fact. The Pi runtime has no turn timeout at all and trusts the turn; Muse cannot fully do that because its out-of-process host is opaque and can wedge silently. The interactive question transport already exists: `user_input_requested` / `user_input_resolved` semantic events flow from the runtime through the session router into Chat Web stream envelopes (`RUNTIME_USER_INPUT_REQUESTED` / `RUNTIME_USER_INPUT_RESOLVED`) and the chat output-event policy.

# Goal

When a Muse turn exhausts its idle budget, nudge the user in Chat and let them decide:

- Show what is hanging: silence duration, running tool or command preview, and turn identity.
- Offer keep waiting or abort; abort behaves exactly like today's timeout failure.
- Offer a snooze timer (for example remind again in 10 or 30 minutes); on expiry the user decides again.
- Build on the existing `user_input` runtime-request mechanism and Chat surfacing; no parallel question channel.

# Non-goals

- Changing the 30-minute default budget (separate decision).
- Continuing silently without the user after budget expiry.
- Automatic command inspection beyond showing the pending tool call; no automatic verdict whether a command "should" take long.
- Implementing anything in this plan; this records the target only.

# Work

- On idle-budget expiry with a responsive host, the Muse adapter emits a `user_input_requested` nudge carrying turn id, silence duration, and the pending tool call or command preview instead of failing immediately.
- The kill is suspended while the nudge awaits resolution, within a bounded wait.
- On resolve-continue the idle budget is re-armed and the turn proceeds; on resolve-abort the turn is interrupted and fails exactly like today's timeout.
- On resolve-snooze with an interval the nudge reappears after that interval with refreshed hang details.
- Chat Web renders the nudge from the existing runtime-request envelopes with wait, abort, and snooze actions.

# Acceptance

- GIVEN a Muse turn goes silent past its idle budget with a responsive host, WHEN the budget expires, THEN the user sees a nudge naming the hanging command and the silence duration before the turn is failed.
- GIVEN an open timeout nudge, WHEN the user picks wait, THEN the turn continues with a fresh idle budget.
- GIVEN an open timeout nudge, WHEN the user picks abort, THEN the turn fails with today's timeout error shape.
- GIVEN an open timeout nudge, WHEN the user picks snooze for N minutes, THEN the nudge reappears after N minutes and the turn keeps running meanwhile.
- GIVEN an open timeout nudge, WHEN the user never responds within the bounded wait, THEN the turn fails safely (exact default is an open question below).

# Risks and rollback

- Unattended sessions must not hang forever on an unanswered nudge; the bounded wait and its default outcome need a decision before implementation.
- Nudge fatigue if many long turns expire budgets routinely; snooze defaults and per-session quiet hours may be needed later.
- The nudge must not break headless or API-only consumers that never resolve `user_input` requests; they must observe today's failure behavior.
- Rollback is removal of the nudge emission: the adapter falls back to failing at budget expiry as today.

# Open questions

- What is the default when a nudge goes unanswered: abort after a second bounded wait, or keep waiting indefinitely?
- Should the first nudge appear before full expiry (early warning) or exactly at expiry?
- Which snooze intervals are offered, and is the choice per nudge or sticky per session?

# Completion and successors

This plan is complete when the open questions are answered and an implementation change references it. Successor work implements the adapter emission, the router and Chat surfacing, and tests, then records the shipped behavior in the Muse adapter specification.
