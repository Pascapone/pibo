import { randomBytes } from "node:crypto";
import type { PiboJsonObject } from "../core/events.js";
import {
	DEFAULT_CDP_TIMEOUT_MS,
	connectCdpTarget,
	findCdpTarget,
	listCdpTargets,
	openCdpTarget,
	type CdpTarget,
} from "../tools/cdp-client.js";
import type { WebAnnotationBinding } from "./types.js";
import { createDefaultWebAnnotationStore, type WebAnnotationStore } from "./store.js";
import { requireWebAnnotationText, sanitizeWebAnnotationText, WEB_ANNOTATION_LIMITS } from "./validation.js";

export type WebAnnotationCdpServiceOptions = {
	store?: WebAnnotationStore;
	cdpUrl?: string;
	apiBaseUrl?: string;
	timeoutMs?: number;
};

export type WebAnnotationBindingContext = {
	ownerScope: string;
	piboSessionId: string;
	piboRoomId?: string;
};

export type WebAnnotationTargetSummary = {
	id: string;
	type: string;
	title: string;
	url: string;
	attachable: boolean;
};

export type CreateUrlBindingInput = WebAnnotationBindingContext & {
	url: string;
};

export type CreateTargetBindingInput = WebAnnotationBindingContext & {
	targetId: string;
};

export type BindingOperationResult = {
	binding: WebAnnotationBinding;
	target?: WebAnnotationTargetSummary;
	injected?: boolean;
	stopped?: boolean;
};

const MAX_TITLE_LENGTH = WEB_ANNOTATION_LIMITS.title;
const MAX_URL_LENGTH = WEB_ANNOTATION_LIMITS.url;

let defaultStore: WebAnnotationStore | undefined;

function getDefaultStore(): WebAnnotationStore {
	defaultStore ??= createDefaultWebAnnotationStore();
	return defaultStore;
}

export class WebAnnotationCdpService {
	private readonly store: WebAnnotationStore;
	private readonly cdpUrl?: string;
	private readonly apiBaseUrl?: string;
	private readonly timeoutMs: number;

	constructor(options: WebAnnotationCdpServiceOptions = {}) {
		this.store = options.store ?? getDefaultStore();
		this.cdpUrl = options.cdpUrl;
		this.apiBaseUrl = options.apiBaseUrl;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS;
	}

	async listTargets(): Promise<WebAnnotationTargetSummary[]> {
		const targets = await listCdpTargets({ cdpUrl: this.cdpUrl, timeoutMs: this.timeoutMs });
		return targets.map(targetSummary);
	}

	listBindings(context: WebAnnotationBindingContext, limit?: number): WebAnnotationBinding[] {
		return this.store.listBindings({ ownerScope: context.ownerScope, piboSessionId: context.piboSessionId, limit });
	}

	async createUrlBinding(input: CreateUrlBindingInput): Promise<BindingOperationResult> {
		const url = normalizeUserUrl(input.url);
		const target = await openCdpTarget(url, { cdpUrl: this.cdpUrl, timeoutMs: this.timeoutMs });
		const binding = this.store.createBinding({
			ownerScope: input.ownerScope,
			piboSessionId: input.piboSessionId,
			piboRoomId: input.piboRoomId,
			url: target.url || url,
			title: trim(target.title, MAX_TITLE_LENGTH),
			targetId: target.id,
			state: "active",
			metadata: bindingMetadata(target, { source: "url", overlaySubmissionToken: createOverlaySubmissionToken() }),
		});
		return { binding, target: targetSummary(target) };
	}

	async createTargetBinding(input: CreateTargetBindingInput): Promise<BindingOperationResult> {
		const selectedTargetId = requireNonEmpty(input.targetId, "targetId");
		const targets = await listCdpTargets({ cdpUrl: this.cdpUrl, timeoutMs: this.timeoutMs });
		const target = findCdpTarget(targets, selectedTargetId);
		if (!target) throw new Error("Selected CDP target was not found");
		if (!target.webSocketDebuggerUrl) throw new Error("Selected CDP target is not attachable");
		const binding = this.store.createBinding({
			ownerScope: input.ownerScope,
			piboSessionId: input.piboSessionId,
			piboRoomId: input.piboRoomId,
			url: target.url,
			title: trim(target.title, MAX_TITLE_LENGTH),
			targetId: target.id,
			state: "active",
			metadata: bindingMetadata(target, { source: "target", overlaySubmissionToken: createOverlaySubmissionToken() }),
		});
		return { binding, target: targetSummary(target) };
	}

	async injectBinding(context: WebAnnotationBindingContext, bindingId: string): Promise<BindingOperationResult> {
		const binding = this.ensureOverlaySubmissionToken(this.requireBinding(context, bindingId));
		const target = await this.resolveBindingTarget(binding);
		const client = await connectCdpTarget(target, this.timeoutMs);
		try {
			await client.evaluate<boolean>(buildDocumentReadyExpression(), this.timeoutMs);
			const result = await client.evaluate<{ ok?: boolean; url?: string; title?: string }>(buildInjectExpression({
				bindingId: binding.id,
				bindingToken: String(binding.metadata?.overlaySubmissionToken ?? ""),
				apiBaseUrl: this.apiBaseUrl,
			}), this.timeoutMs);
			if (!result?.ok) throw new Error("Overlay injection did not report success");
			const updated = this.store.patchBinding(context.ownerScope, context.piboSessionId, binding.id, {
				state: "injected",
				title: trim(result.title, MAX_TITLE_LENGTH) ?? binding.title,
				targetId: target.id,
				lastInjectedAt: new Date().toISOString(),
				closedAt: null,
				error: null,
				metadata: mergeMetadata(binding.metadata, bindingMetadata(target, { overlay: "injected" })),
			});
			return { binding: updated ?? binding, target: targetSummary(target), injected: true };
		} catch (error) {
			this.store.patchBinding(context.ownerScope, context.piboSessionId, binding.id, {
				state: "error",
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			client.close();
		}
	}

	async stopBinding(context: WebAnnotationBindingContext, bindingId: string): Promise<BindingOperationResult> {
		const binding = this.requireBinding(context, bindingId);
		const target = await this.resolveBindingTarget(binding);
		const client = await connectCdpTarget(target, this.timeoutMs);
		try {
			await client.evaluate<{ ok?: boolean }>(buildStopExpression(), this.timeoutMs);
			const updated = this.store.patchBinding(context.ownerScope, context.piboSessionId, binding.id, {
				state: "active",
				targetId: target.id,
				error: null,
				metadata: mergeMetadata(binding.metadata, bindingMetadata(target, { overlay: "stopped" })),
			});
			return { binding: updated ?? binding, target: targetSummary(target), stopped: true };
		} finally {
			client.close();
		}
	}

	removeBinding(context: WebAnnotationBindingContext, bindingId: string): boolean {
		return this.store.removeBinding(context.ownerScope, context.piboSessionId, bindingId);
	}

	private requireBinding(context: WebAnnotationBindingContext, bindingId: string): WebAnnotationBinding {
		const id = requireNonEmpty(bindingId, "bindingId");
		const binding = this.store.getBinding(context.ownerScope, context.piboSessionId, id);
		if (!binding || binding.state === "removed") throw new Error("Web Annotation binding was not found for this owner/session");
		return binding;
	}

	private ensureOverlaySubmissionToken(binding: WebAnnotationBinding): WebAnnotationBinding {
		if (typeof binding.metadata?.overlaySubmissionToken === "string" && binding.metadata.overlaySubmissionToken) return binding;
		const metadata = mergeMetadata(binding.metadata, { overlaySubmissionToken: createOverlaySubmissionToken() });
		const updated = this.store.patchBinding(binding.ownerScope, binding.piboSessionId, binding.id, { metadata });
		return updated ?? { ...binding, metadata };
	}

	private async resolveBindingTarget(binding: WebAnnotationBinding): Promise<CdpTarget> {
		if (!binding.targetId) throw new Error("Web Annotation binding has no CDP target id");
		const targets = await listCdpTargets({ cdpUrl: this.cdpUrl, timeoutMs: this.timeoutMs });
		const target = findCdpTarget(targets, binding.targetId);
		if (target?.webSocketDebuggerUrl) return target;
		this.store.patchBinding(binding.ownerScope, binding.piboSessionId, binding.id, {
			state: "closed",
			closedAt: new Date().toISOString(),
			error: "Bound CDP target is no longer reachable",
		});
		throw new Error("Bound CDP target is no longer reachable");
	}
}

export function createWebAnnotationCdpService(options: WebAnnotationCdpServiceOptions = {}): WebAnnotationCdpService {
	return new WebAnnotationCdpService(options);
}

function normalizeUserUrl(value: string): string {
	const raw = requireWebAnnotationText(value, { max: WEB_ANNOTATION_LIMITS.url, field: "url", redactSecrets: false });
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error("Invalid URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid URL protocol; expected http or https");
	return parsed.toString();
}

function requireNonEmpty(value: string | undefined, field: string): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) throw new Error(`${field} is required`);
	return trimmed;
}

function trim(value: string | undefined, max: number): string | undefined {
	return sanitizeWebAnnotationText(value, { max, field: "web annotation cdp", redactSecrets: false });
}

function targetSummary(target: CdpTarget): WebAnnotationTargetSummary {
	return {
		id: target.id,
		type: target.type,
		title: trim(target.title, MAX_TITLE_LENGTH) ?? "",
		url: trim(target.url, MAX_URL_LENGTH) ?? "",
		attachable: Boolean(target.webSocketDebuggerUrl),
	};
}

function bindingMetadata(target: CdpTarget, extra: Record<string, string>): PiboJsonObject {
	return {
		...extra,
		cdpTarget: targetSummary(target),
	};
}

function mergeMetadata(existing: PiboJsonObject | undefined, next: PiboJsonObject): PiboJsonObject {
	return { ...(existing ?? {}), ...next };
}

function createOverlaySubmissionToken(): string {
	return randomBytes(24).toString("base64url");
}

function buildDocumentReadyExpression(): string {
	return String.raw`new Promise((resolve) => {
  if (document.documentElement) {
    resolve(true);
    return;
  }
  const done = () => resolve(Boolean(document.documentElement));
  document.addEventListener("DOMContentLoaded", done, { once: true });
  setTimeout(done, 2000);
})`;
}

function buildInjectExpression(config: { bindingId: string; bindingToken: string; apiBaseUrl?: string }): string {
	return buildWebAnnotationOverlayScript(JSON.stringify(config));
}

export function buildWebAnnotationOverlayScript(configExpression = "window.__piboWebAnnotationConfig"): string {
	return String.raw`(() => {
  const config = (${configExpression});
  if (!config || !config.bindingId || !config.bindingToken) throw new Error("Pibo Web Annotation overlay config is missing bindingId or bindingToken");
  const rootId = "pibo-web-annotation-overlay";
  const outlineId = "pibo-web-annotation-outline";
  const previous = window.__piboWebAnnotations;
  if (previous && typeof previous.remove === "function") previous.remove();

  const caps = {
    note: 2000,
    text: 500,
    htmlHint: 400,
    classSummary: 240,
    accessibility: 240,
    selector: 500,
    domPath: 700,
    sourceRaw: 800,
  };
  const state = {
    active: true,
    mode: "element",
    hovered: null,
    popup: null,
    lastHoverAt: 0,
    pendingFrame: 0,
    submissions: [],
    lastError: null,
  };

  const host = document.createElement("div");
  host.id = rootId;
  host.setAttribute("data-pibo-web-annotation-binding", config.bindingId);
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:auto;color-scheme:light dark";
  const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  const style = document.createElement("style");
  style.textContent = [
    ":host{all:initial;font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    ".pibo-wa-panel{min-width:224px;background:#111827;color:#fff;border:1px solid #374151;border-radius:12px;padding:10px;box-shadow:0 12px 32px rgba(0,0,0,.32);font:13px system-ui,sans-serif}",
    ".pibo-wa-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}",
    ".pibo-wa-title{font-weight:700;margin-bottom:3px}",
    ".pibo-wa-status{font-size:12px;color:#d1d5db;max-width:260px;white-space:normal}",
    ".pibo-wa-button{border:1px solid #4b5563;background:#1f2937;color:#fff;border-radius:8px;padding:5px 8px;font:12px system-ui,sans-serif;cursor:pointer}",
    ".pibo-wa-button[aria-pressed='true']{background:#2563eb;border-color:#60a5fa}",
    ".pibo-wa-button-danger{background:#7f1d1d;border-color:#ef4444}",
    ".pibo-wa-popup{position:fixed;z-index:2147483647;width:min(320px,calc(100vw - 24px));background:#fff;color:#111827;border:1px solid #9ca3af;border-radius:12px;padding:10px;box-shadow:0 14px 36px rgba(0,0,0,.35);font:13px system-ui,sans-serif}",
    ".pibo-wa-popup textarea{box-sizing:border-box;width:100%;min-height:76px;margin:8px 0;border:1px solid #9ca3af;border-radius:8px;padding:8px;font:13px system-ui,sans-serif;color:#111827;background:#fff}",
    ".pibo-wa-popup-label{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ].join("");
  const panel = document.createElement("div");
  panel.className = "pibo-wa-panel";
  const title = document.createElement("div");
  title.className = "pibo-wa-title";
  title.textContent = "Pibo annotations";
  const status = document.createElement("div");
  status.className = "pibo-wa-status";
  const row = document.createElement("div");
  row.className = "pibo-wa-row";
  const toggle = button("Annotate", "Toggle element annotation mode");
  const pin = button("Pin", "Mark a point instead of an element");
  const stop = button("Stop", "Remove the Pibo annotation overlay");
  stop.className += " pibo-wa-button-danger";
  row.append(toggle, pin, stop);
  panel.append(title, status, row);
  shadow.append(style, panel);
  document.documentElement.appendChild(host);

  const outline = document.createElement("div");
  outline.id = outlineId;
  outline.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.10);box-shadow:0 0 0 9999px rgba(37,99,235,.04);display:none;border-radius:3px";
  document.documentElement.appendChild(outline);

  toggle.addEventListener("click", () => {
    state.active = !state.active;
    state.mode = "element";
    closePopup();
    updateUi();
  });
  pin.addEventListener("click", () => {
    state.active = true;
    state.mode = state.mode === "pin" ? "element" : "pin";
    closePopup();
    updateUi();
  });
  stop.addEventListener("click", () => api.remove());

  function button(label, aria) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "pibo-wa-button";
    el.textContent = label;
    el.setAttribute("aria-label", aria);
    return el;
  }

  function updateUi(message) {
    toggle.setAttribute("aria-pressed", state.active && state.mode === "element" ? "true" : "false");
    pin.setAttribute("aria-pressed", state.active && state.mode === "pin" ? "true" : "false");
    outline.style.display = state.active && state.mode === "element" && state.hovered ? "block" : "none";
    status.textContent = message || (state.active ? (state.mode === "pin" ? "Pin mode: click anywhere to mark a point." : "Element mode: hover and click a visible target.") : "Inactive: page clicks and typing pass through normally.");
  }

  function onMouseMove(event) {
    if (!state.active || state.mode !== "element" || isOverlayEvent(event)) return;
    const now = Date.now();
    if (now - state.lastHoverAt < 80) return;
    state.lastHoverAt = now;
    if (state.pendingFrame) cancelAnimationFrame(state.pendingFrame);
    state.pendingFrame = requestAnimationFrame(() => {
      state.pendingFrame = 0;
      const target = eventTargetElement(event);
      if (!target) {
        clearHover();
        return;
      }
      const rect = target.getBoundingClientRect();
      if (!isUsableRect(rect)) {
        clearHover();
        return;
      }
      state.hovered = target;
      outline.style.left = rect.left + "px";
      outline.style.top = rect.top + "px";
      outline.style.width = rect.width + "px";
      outline.style.height = rect.height + "px";
      outline.style.display = "block";
    });
  }

  function onClick(event) {
    if (!state.active || isOverlayEvent(event)) return;
    if (state.mode === "pin") {
      event.preventDefault();
      event.stopPropagation();
      openNote("pin", buildPinTarget(event), { x: event.clientX, y: event.clientY });
      return;
    }
    const target = eventTargetElement(event);
    if (!target || !isUsableRect(target.getBoundingClientRect())) return;
    event.preventDefault();
    event.stopPropagation();
    state.hovered = target;
    openNote("element", buildElementTarget(target), rectAnchor(target.getBoundingClientRect()));
  }

  function isOverlayEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.includes(host) || path.includes(panel) || (state.popup && path.includes(state.popup));
  }

  function eventTargetElement(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (item && item.nodeType === 1 && item !== host && item !== outline && item !== document.documentElement && item !== document.body) return item;
    }
    const target = event.target;
    return target && target.nodeType === 1 ? target : null;
  }

  function clearHover() {
    state.hovered = null;
    outline.style.display = "none";
  }

  function rectAnchor(rect) {
    return { x: Math.min(window.innerWidth - 340, Math.max(12, rect.left)), y: Math.min(window.innerHeight - 160, Math.max(12, rect.bottom + 8)) };
  }

  function isUsableRect(rect) {
    return rect && rect.width > 1 && rect.height > 1 && rect.bottom >= 0 && rect.right >= 0 && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
  }

  function openNote(kind, target, anchor) {
    closePopup();
    clearHover();
    const popup = document.createElement("div");
    popup.className = "pibo-wa-popup";
    popup.style.left = Math.max(12, Math.min(window.innerWidth - 340, anchor.x)) + "px";
    popup.style.top = Math.max(12, Math.min(window.innerHeight - 160, anchor.y)) + "px";
    const label = document.createElement("div");
    label.className = "pibo-wa-popup-label";
    label.textContent = kind === "pin" ? "Pin annotation" : (target.label || target.selector || "Element annotation");
    const textarea = document.createElement("textarea");
    textarea.placeholder = "What should the agent know about this target?";
    textarea.maxLength = caps.note;
    const actions = document.createElement("div");
    actions.className = "pibo-wa-row";
    const submit = button("Submit", "Submit annotation");
    const cancel = button("Cancel", "Cancel annotation");
    actions.append(submit, cancel);
    popup.append(label, textarea, actions);
    shadow.append(popup);
    state.popup = popup;
    state.active = false;
    updateUi("Add a note, submit, or cancel.");
    textarea.focus();
    cancel.addEventListener("click", () => {
      closePopup();
      state.active = true;
      updateUi("Cancelled. Annotation mode is active.");
    });
    submit.addEventListener("click", async () => {
      const note = cap(textarea.value.trim(), caps.note);
      if (!note) {
        updateUi("Note is required before submitting.");
        textarea.focus();
        return;
      }
      submit.disabled = true;
      const payload = buildPayload(kind, target, note);
      state.submissions.push(payload);
      try {
        const response = await fetch(apiUrl() + "/submissions", {
          method: "POST",
          mode: "cors",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json().catch(() => ({}));
        state.lastError = null;
        closePopup();
        state.active = true;
        updateUi(data && data.annotation && data.annotation.id ? "Saved " + data.annotation.id + "." : "Saved annotation.");
      } catch (error) {
        state.lastError = error && error.message ? error.message : String(error);
        submit.disabled = false;
        updateUi("Submission failed: " + cap(state.lastError, 120));
      }
    });
  }

  function closePopup() {
    if (state.popup) state.popup.remove();
    state.popup = null;
  }

  function apiUrl() {
    const base = config.apiBaseUrl || window.location.origin;
    return base.replace(/\/$/, "") + "/api/web-annotations";
  }

  function buildPayload(kind, target, note) {
    return {
      bindingId: config.bindingId,
      bindingToken: config.bindingToken,
      note,
      url: cap(window.location.href, 2000),
      title: cap(document.title || "", 200),
      targetKind: kind,
      viewport: {
        width: Math.max(0, Math.round(window.innerWidth || document.documentElement.clientWidth || 0)),
        height: Math.max(0, Math.round(window.innerHeight || document.documentElement.clientHeight || 0)),
        devicePixelRatio: Number(window.devicePixelRatio || 1),
      },
      target,
    };
  }

  function buildPinTarget(event) {
    return boundedTarget({
      kind: "pin",
      label: "pin " + Math.round(event.clientX) + "," + Math.round(event.clientY),
      position: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
      sourceHints: [{ kind: "dom-fallback", confidence: "low", id: "pin", raw: { url: cap(location.pathname, 200) } }],
    });
  }

  function buildElementTarget(element) {
    const rect = element.getBoundingClientRect();
    const selector = bestSelector(element);
    const selectedText = getSelectedText();
    const tagName = (element.tagName || "").toLowerCase();
    const target = {
      kind: "element",
      label: cap(labelFor(element), caps.text),
      selector,
      domPath: cap(domPath(element, false), caps.domPath),
      fullDomPath: cap(domPath(element, true), caps.domPath),
      tagName,
      stableId: stableId(element),
      classSummary: cap(classSummary(element), caps.classSummary),
      text: cap((element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(), caps.text),
      selectedText: selectedText || undefined,
      htmlHint: cap(openingTagHint(element), caps.htmlHint),
      accessibility: accessibilityHint(element),
      boundingBox: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      sourceHints: sourceHints(element, selector),
    };
    if (tagName === "iframe") {
      target.accessibility = { ...(target.accessibility || {}), description: "Iframe contents are unavailable to the top-level annotation overlay when cross-origin." };
    }
    return boundedTarget(target);
  }

  function boundedTarget(target) {
    if (target.selector) target.selector = cap(target.selector, caps.selector);
    if (target.domPath) target.domPath = cap(target.domPath, caps.domPath);
    if (target.fullDomPath) target.fullDomPath = cap(target.fullDomPath, caps.domPath);
    if (target.text) target.text = cap(target.text, caps.text);
    if (target.selectedText) target.selectedText = cap(target.selectedText, caps.text);
    if (target.htmlHint) target.htmlHint = cap(target.htmlHint, caps.htmlHint);
    if (target.classSummary) target.classSummary = cap(target.classSummary, caps.classSummary);
    if (target.accessibility && target.accessibility.description) target.accessibility.description = cap(target.accessibility.description, caps.accessibility);
    if (Array.isArray(target.sourceHints)) target.sourceHints = target.sourceHints.slice(0, 8).map(boundSourceHint);
    return target;
  }

  function boundSourceHint(hint) {
    const next = { ...hint };
    if (next.id) next.id = cap(String(next.id), 160);
    if (next.file) next.file = cap(String(next.file), 300);
    if (next.component) next.component = cap(String(next.component), 160);
    if (Array.isArray(next.componentPath)) next.componentPath = next.componentPath.slice(0, 12).map((item) => cap(String(item), 120));
    if (next.raw) next.raw = truncateRaw(next.raw);
    return next;
  }

  function truncateRaw(raw) {
    try {
      return JSON.parse(cap(JSON.stringify(raw), caps.sourceRaw));
    } catch {
      return { truncated: true };
    }
  }

  function cap(value, max) {
    if (value === undefined || value === null) return undefined;
    const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    return text.length > max ? text.slice(0, max) : text;
  }

  function getSelectedText() {
    const selection = window.getSelection && window.getSelection();
    const text = selection ? selection.toString().replace(/\s+/g, " ").trim() : "";
    return text ? cap(text, caps.text) : undefined;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => "\\" + char);
  }

  function stableId(element) {
    const attrs = ["data-pibo-id", "data-testid", "data-test-id", "data-cy", "data-qa", "data-locatorjs-id", "id", "aria-label"];
    for (const attr of attrs) {
      const value = element.getAttribute && element.getAttribute(attr);
      if (value && value.trim()) return attr + ":" + cap(value.trim(), 160);
    }
    return undefined;
  }

  function bestSelector(element) {
    const direct = stableSelectorPart(element);
    if (direct && direct.unique) return direct.selector;
    const chain = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const part = stableSelectorPart(current);
      chain.unshift(part.selector);
      const combined = chain.join(" > ");
      if (safeQueryCount(combined) === 1) return combined;
      current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
    }
    return chain.length ? chain.join(" > ") : undefined;
  }

  function stableSelectorPart(element) {
    const tag = (element.tagName || "*").toLowerCase();
    const id = element.getAttribute && element.getAttribute("id");
    if (id) {
      const selector = "#" + cssEscape(id);
      return { selector, unique: safeQueryCount(selector) === 1 };
    }
    for (const attr of ["data-pibo-id", "data-testid", "data-test-id", "data-cy", "data-qa", "data-locatorjs-id", "aria-label"]) {
      const value = element.getAttribute && element.getAttribute(attr);
      if (value) {
        const selector = tag + "[" + attr + "=\"" + String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"]";
        return { selector, unique: safeQueryCount(selector) === 1 };
      }
    }
    return { selector: tag + ":nth-of-type(" + nthOfType(element) + ")", unique: false };
  }

  function safeQueryCount(selector) {
    try { return document.querySelectorAll(selector).length; } catch { return 0; }
  }

  function nthOfType(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function domPath(element, full) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1) {
      const tag = (current.tagName || "").toLowerCase();
      if (!tag) break;
      const id = current.getAttribute && current.getAttribute("id");
      const testId = current.getAttribute && (current.getAttribute("data-pibo-id") || current.getAttribute("data-testid") || current.getAttribute("data-test-id"));
      let part = tag;
      if (id) part += "#" + id;
      else if (testId) part += "[" + testId + "]";
      else part += ":nth-of-type(" + nthOfType(current) + ")";
      parts.unshift(part);
      if (!full && (id || testId || parts.length >= 5)) break;
      current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
    }
    return parts.join(" > ");
  }

  function classSummary(element) {
    const classes = Array.from(element.classList || []).filter((name) => !/[a-f0-9]{7,}/i.test(name)).slice(0, 12);
    return classes.join(" ") || undefined;
  }

  function openingTagHint(element) {
    const clone = element.cloneNode(false);
    const html = clone.outerHTML || "";
    return html.replace(/><\/[\s\S]*$/, ">");
  }

  function labelFor(element) {
    const aria = element.getAttribute && (element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("alt"));
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    const tag = (element.tagName || "element").toLowerCase();
    return aria ? tag + " \"" + aria + "\"" : (text ? tag + " \"" + text.slice(0, 80) + "\"" : tag);
  }

  function accessibilityHint(element) {
    const focusable = Boolean(element.matches && element.matches("a[href],button,input,textarea,select,[tabindex]"));
    const role = element.getAttribute && element.getAttribute("role") || undefined;
    const ariaLabel = element.getAttribute && element.getAttribute("aria-label") || undefined;
    return { role, name: cap(ariaLabel || element.getAttribute && element.getAttribute("title") || undefined, 160), ariaLabel: cap(ariaLabel, 160), focusable };
  }

  function sourceHints(element, selector) {
    const hints = [];
    const explicit = explicitSourceHints(element);
    hints.push(...explicit);
    const locator = locatorHint(element);
    if (locator) hints.push(locator);
    const react = reactHint(element);
    if (react) hints.push(react);
    if (!hints.length) hints.push({ kind: "dom-fallback", confidence: "low", id: selector || domPath(element, false), raw: { tagName: (element.tagName || "").toLowerCase() } });
    return hints;
  }

  function explicitSourceHints(element) {
    const hints = [];
    let current = element;
    while (current && current.nodeType === 1 && hints.length < 6) {
      const piboId = current.getAttribute && current.getAttribute("data-pibo-id");
      if (piboId) hints.push({ kind: "pibo-id", confidence: "high", id: piboId, raw: { tagName: (current.tagName || "").toLowerCase() } });
      const testId = current.getAttribute && (current.getAttribute("data-testid") || current.getAttribute("data-test-id") || current.getAttribute("data-cy") || current.getAttribute("data-qa"));
      if (testId) hints.push({ kind: "test-id", confidence: "high", id: testId, raw: { tagName: (current.tagName || "").toLowerCase() } });
      const locatorId = current.getAttribute && current.getAttribute("data-locatorjs-id");
      if (locatorId) hints.push({ kind: "locatorjs", confidence: "high", id: locatorId, raw: collectLocatorRaw(current) });
      current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
    }
    return hints;
  }

  function locatorHint(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      const raw = collectLocatorRaw(current);
      const file = raw.file || raw.sourceFile || raw.source;
      const component = raw.component || raw.componentName;
      if (file || component || raw.line || raw.column) {
        return { kind: "locatorjs", confidence: "high", id: raw.id, file, line: numberOrUndefined(raw.line), column: numberOrUndefined(raw.column), component, raw };
      }
      current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
    }
    return undefined;
  }

  function collectLocatorRaw(element) {
    const names = ["data-locatorjs-id", "data-locatorjs-source", "data-locatorjs-file", "data-locatorjs-line", "data-locatorjs-column", "data-locatorjs-component", "data-source", "data-source-file", "data-source-line", "data-source-column", "data-component", "data-component-path"];
    const raw = {};
    for (const name of names) {
      const value = element.getAttribute && element.getAttribute(name);
      if (value) raw[name.replace(/^data-/, "").replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = cap(value, 300);
    }
    return raw;
  }

  function reactHint(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      const key = Object.keys(current).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
      let fiber = key ? current[key] : undefined;
      const names = [];
      let source;
      let guard = 0;
      while (fiber && guard < 20) {
        const type = fiber.elementType || fiber.type;
        const name = typeof type === "function" ? (type.displayName || type.name) : (typeof type === "string" ? type : undefined);
        if (name) names.push(name);
        if (!source && fiber._debugSource) source = fiber._debugSource;
        fiber = fiber.return;
        guard += 1;
      }
      if (names.length || source) {
        return {
          kind: source ? "jsx-source" : "react-fiber",
          confidence: "medium",
          file: source && source.fileName,
          line: source && source.lineNumber,
          column: source && source.columnNumber,
          component: names[0],
          componentPath: names.slice(0, 12),
          raw: source ? { source } : { components: names.slice(0, 12) },
        };
      }
      current = current.parentElement || null;
    }
    return undefined;
  }

  function numberOrUndefined(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  updateUi();

  const api = {
    bindingId: config.bindingId,
    injectedAt: new Date().toISOString(),
    setActive(value) { state.active = Boolean(value); updateUi(); },
    setMode(value) { state.mode = value === "pin" ? "pin" : "element"; state.active = true; updateUi(); },
    getState() { return { active: state.active, mode: state.mode, submissions: state.submissions.slice(), lastError: state.lastError }; },
    remove() {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      if (state.pendingFrame) cancelAnimationFrame(state.pendingFrame);
      closePopup();
      outline.remove();
      host.remove();
      if (window.__piboWebAnnotations && window.__piboWebAnnotations.bindingId === config.bindingId) delete window.__piboWebAnnotations;
    },
  };
  window.__piboWebAnnotations = api;
  return { ok: true, url: location.href, title: document.title || "" };
})()`;
}

function buildStopExpression(): string {
	return `(() => {
  const previous = window.__piboWebAnnotations;
  if (previous && typeof previous.remove === "function") previous.remove();
  const root = document.getElementById("pibo-web-annotation-overlay");
  if (root) root.remove();
  return { ok: true };
})()`;
}
