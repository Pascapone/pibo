# PRD: Web Annotations Plugin — Security, Validation, and Rollout

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`, `../../../../reports/web-annotation-feedback-tools-agentation-open-design.md`

## 1. Executive Summary

- **Problem Statement**: Web Annotations touches browser injection, page-derived payloads, Chat Web auth, persistent storage, agent tools, and prompt rendering. Without explicit security and validation gates, the feature could leak page content, inject into the wrong target, or ship untested across gateway environments.
- **Proposed Solution**: Add a validation and rollout contract covering owner-scope authorization, binding tokens, payload schema/size limits, redaction, browser checks, Docker worker testing, dev gateway deployment, and production approval gates.
- **Success Criteria**:
  - SC-01: Unauthorized sessions and owner scopes cannot read, attach, update, or resolve another user's annotations.
  - SC-02: Overlay submissions cannot set owner scope, Pibo Session ID, Room ID, or trusted status fields directly.
  - SC-03: Oversized or malformed annotation payloads are rejected with concise errors.
  - SC-04: Default prompt context excludes full page HTML, full text bodies, secrets, and inline screenshot data.
  - SC-05: V1 validation runs in a Docker compute worker and dev gateway deployment happens only after worker checks pass.

## 2. User Experience & Functionality

- **User Personas**:
  - Security reviewer auditing browser injection and prompt data.
  - QA engineer validating store/API/tool/UI/browser behavior.
  - Operator deploying to dev and production gateways.
  - Maintainer writing troubleshooting docs.

- **User Stories**:
  - As a security reviewer, I want owner-scope checks on every API and tool path so that annotations do not cross account boundaries.
  - As a user, I want clear errors when CDP is unavailable or a target closes so that I can recover without losing annotations.
  - As an operator, I want a rollout checklist so that worker validation, dev deployment, and production approval happen in the right order.
  - As a maintainer, I want docs explaining privacy limits and source-hint confidence so that users understand what is captured.

- **Acceptance Criteria**:
  - Add API validation for bindings, annotation submissions, status updates, thread messages, and attachment sends.
  - Enforce maximum sizes for note, selector, DOM path, full DOM path, text, selected text, HTML hint, class summary, accessibility, source raw metadata, thread messages, and attachment counts.
  - Add redaction/truncation utility used before prompt rendering and, where appropriate, before storage of risky excerpts.
  - Add tests for malformed payloads, oversized payloads, invalid binding tokens, unauthorized owner/session access, stale composer attachments, and status transition rules.
  - Add browser validation for local HTML page, local React page, overlay stop/re-inject, target close/reload, and no-source-hint fallback.
  - Update documentation with V1 scope, privacy behavior, troubleshooting, and deployment validation steps.
  - Run `npm run typecheck`, relevant unit tests, Chat Web typecheck/build when impacted, and browser checks in a Docker compute worker.
  - Deploy to dev with `./scripts/deploy-web-dev.sh` only after worker validation; deploy production only after explicit user approval.

- **Ralph Work Package Derivation**:
  - `US-001`: add payload validation, limits, and redaction utilities.
  - `US-002`: add API/tool authorization and malformed payload tests.
  - `US-003`: add browser validation fixtures/checks.
  - `US-004`: update docs and troubleshooting guidance.
  - `US-005`: add rollout checklist and dev/prod deployment gates.

- **Non-Goals**:
  - External security audit automation.
  - Cloud synchronization or public sharing.
  - Chrome Web Store extension permission review.
  - Production deployment without user approval.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Tool outputs and errors should be concise and avoid echoing rejected sensitive payloads.
  - Agent-facing instructions should prefer annotation IDs and store/tool lookups over large prompt blocks.

- **Evaluation Strategy**:
  - Security test matrix covers API, tool, Chat Web attachment, and overlay submission paths.
  - Prompt redaction tests include token-like strings, long HTML, long text, and screenshot references.
  - Browser E2E validates a complete create/attach/send/resolve loop.

## 4. Technical Specifications

- **Architecture Overview**:
  - Validation schemas sit at API/tool boundaries and normalize data before store writes.
  - Binding tokens or authenticated session state identify trusted binding context.
  - Redaction/truncation utilities are shared by prompt rendering, list/detail serializers, and UI previews where appropriate.
  - Rollout docs and checklists live under `docs/` and follow existing Pibo deployment rules.

- **Integration Points**:
  - Auth service and owner-scope/session access checks.
  - Web Annotation API, store, tools, Chat Web attachment send path, and overlay submission endpoint.
  - Browser Use/CDP validation flow.
  - Existing deployment scripts and Docker compute worker workflow.

- **Security & Privacy**:
  - Never trust overlay-provided owner/session fields.
  - Treat all DOM/page-derived fields as untrusted text.
  - Do not persist or render full page HTML by default.
  - Do not inline screenshot data into prompts.
  - Keep injection explicit and target-scoped.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: validation schemas, owner/session checks, and basic malformed payload tests.
  - V1: full security test matrix, browser validation, docs, dev deployment checklist, and production approval gate.
  - v1.1: retention/prune guidance, richer audit events, optional extension threat model.

- **Technical Risks**:
  - Different code paths may implement separate redaction rules; mitigate with a shared utility and tests.
  - Browser checks can be flaky; mitigate with simple deterministic fixture pages first.
  - Production deployment may lag docs; mitigate by keeping rollout checklist in the PRD README and project docs.
  - Payload limits may be too strict or too loose; mitigate by exposing concise errors and adjusting with fixture data.
