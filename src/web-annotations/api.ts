import { PiboWebHttpError, readJsonBody, responseJson } from "../web/http.js";
import type { PiboWebApp, PiboWebAppContext, PiboWebSession } from "../web/types.js";
import { createWebAnnotationCdpService, type WebAnnotationCdpService, type WebAnnotationBindingContext } from "./cdp.js";
import { serializeWebAnnotationAttachment } from "./attachments.js";
import { createDefaultWebAnnotationStore, type WebAnnotationStore } from "./store.js";
import { isWebAnnotationStatus, isWebAnnotationTargetKind, type WebAnnotationTarget, type WebAnnotationViewport } from "./types.js";

export const WEB_ANNOTATIONS_API_PREFIX = "/api/web-annotations";
export const WEB_ANNOTATIONS_APP_MOUNT = "/apps/web-annotations";

export type WebAnnotationsWebAppOptions = {
	store?: WebAnnotationStore;
	cdpService?: WebAnnotationCdpService;
};

type BindingBody = {
	piboSessionId?: string;
	piboRoomId?: string;
	url?: string;
	targetId?: string;
	cdpUrl?: string;
};

type InjectBody = {
	piboSessionId?: string;
	piboRoomId?: string;
	cdpUrl?: string;
};

type OverlaySubmissionBody = {
	bindingId?: string;
	bindingToken?: string;
	note?: string;
	url?: string;
	title?: string;
	targetKind?: string;
	viewport?: WebAnnotationViewport;
	target?: WebAnnotationTarget;
	screenshotRef?: object;
};

type AnnotationPatchBody = {
	piboSessionId?: string;
	status?: string;
	summary?: string | null;
};

let defaultStore: WebAnnotationStore | undefined;

function getDefaultStore(): WebAnnotationStore {
	defaultStore ??= createDefaultWebAnnotationStore();
	return defaultStore;
}

export function createWebAnnotationsWebApp(options: WebAnnotationsWebAppOptions = {}): PiboWebApp {
	const store = options.store ?? getDefaultStore();
	const baseService = options.cdpService ?? createWebAnnotationCdpService({ store });

	return {
		name: "web-annotations",
		mountPath: WEB_ANNOTATIONS_APP_MOUNT,
		apiPrefix: WEB_ANNOTATIONS_API_PREFIX,
		async handleRequest(request, context) {
			const url = new URL(request.url);
			if (url.pathname === WEB_ANNOTATIONS_APP_MOUNT && request.method === "GET") {
				return responseJson({ ok: true, apiPrefix: WEB_ANNOTATIONS_API_PREFIX });
			}
			if (!url.pathname.startsWith(WEB_ANNOTATIONS_API_PREFIX)) return undefined;

			try {
				if (url.pathname === `${WEB_ANNOTATIONS_API_PREFIX}/submissions` && request.method === "OPTIONS") {
					return corsResponse(null, { status: 204 });
				}
				if (url.pathname === `${WEB_ANNOTATIONS_API_PREFIX}/submissions` && request.method === "POST") {
					const annotation = await handleOverlaySubmission(store, request);
					return corsJson({ ok: true, annotation }, { status: 201 });
				}

				const webSession = await context.requireSession({ request });

				if (url.pathname === `${WEB_ANNOTATIONS_API_PREFIX}/targets` && request.method === "GET") {
					const service = serviceForRequest(baseService, url.searchParams.get("cdpUrl") ?? undefined, request, store, options);
					const targets = await service.listTargets();
					return responseJson({ ok: true, targets });
				}

				if (url.pathname === `${WEB_ANNOTATIONS_API_PREFIX}/bindings` && request.method === "GET") {
					const piboSessionId = requireQueryParam(url, "piboSessionId");
					const bindingContext = resolveBindingContext(context, webSession, { piboSessionId });
					const bindings = baseService.listBindings(bindingContext, parseLimit(url.searchParams.get("limit")));
					return responseJson({ ok: true, bindings });
				}

				if (url.pathname === `${WEB_ANNOTATIONS_API_PREFIX}/bindings` && request.method === "POST") {
					requireSameOriginJsonRequest(request);
					const body = await readJsonBody<BindingBody>(request);
					const bindingContext = resolveBindingContext(context, webSession, body);
					const service = serviceForRequest(baseService, body.cdpUrl, request, store, options);
					if (body.url) {
						const result = await service.createUrlBinding({ ...bindingContext, url: body.url });
						return responseJson({ ok: true, ...result }, { status: 201 });
					}
					if (body.targetId) {
						const result = await service.createTargetBinding({ ...bindingContext, targetId: body.targetId });
						return responseJson({ ok: true, ...result }, { status: 201 });
					}
					throw new PiboWebHttpError("url or targetId is required", 400);
				}

				if (url.pathname === WEB_ANNOTATIONS_API_PREFIX && request.method === "GET") {
					const piboSessionId = requireQueryParam(url, "piboSessionId", "sessionId");
					const bindingContext = resolveBindingContext(context, webSession, { piboSessionId });
					const status = optionalStatus(url.searchParams.get("status"));
					const annotations = store.listAnnotations({ ...bindingContext, status, limit: parseLimit(url.searchParams.get("limit")) })
						.map(serializeWebAnnotationAttachment);
					return responseJson({ ok: true, annotations });
				}

				const annotationResource = matchAnnotationResource(url.pathname);
				if (annotationResource) {
					if (request.method === "GET") {
						const piboSessionId = requireQueryParam(url, "piboSessionId", "sessionId");
						const bindingContext = resolveBindingContext(context, webSession, { piboSessionId });
						const annotation = store.getAnnotation(bindingContext.ownerScope, bindingContext.piboSessionId, annotationResource.id);
						if (!annotation) throw new PiboWebHttpError("Web Annotation was not found", 404);
						return responseJson({ ok: true, annotation });
					}
					if (request.method === "PATCH") {
						requireSameOriginJsonRequest(request);
						const body = await readJsonBody<AnnotationPatchBody>(request);
						const bindingContext = resolveBindingContext(context, webSession, body);
						const status = optionalStatus(body.status);
						const annotation = store.patchAnnotation(bindingContext.ownerScope, bindingContext.piboSessionId, annotationResource.id, {
							...(status ? { status } : {}),
							...(body.summary !== undefined ? { summary: body.summary } : {}),
						});
						if (!annotation) throw new PiboWebHttpError("Web Annotation was not found", 404);
						return responseJson({ ok: true, annotation: serializeWebAnnotationAttachment(annotation) });
					}
				}

				const bindingResource = matchBindingResource(url.pathname);
				if (bindingResource) {
					if (request.method === "POST" && (bindingResource.action === "inject" || bindingResource.action === "reinject")) {
						requireSameOriginJsonRequest(request);
						const body = await readJsonBody<InjectBody>(request);
						const bindingContext = resolveBindingContext(context, webSession, body);
						const service = serviceForRequest(baseService, body.cdpUrl, request, store, options);
						const result = await service.injectBinding(bindingContext, bindingResource.id);
						return responseJson({ ok: true, ...result });
					}
					if (request.method === "POST" && bindingResource.action === "stop") {
						requireSameOriginJsonRequest(request);
						const body = await readJsonBody<InjectBody>(request);
						const bindingContext = resolveBindingContext(context, webSession, body);
						const service = serviceForRequest(baseService, body.cdpUrl, request, store, options);
						const result = await service.stopBinding(bindingContext, bindingResource.id);
						return responseJson({ ok: true, ...result });
					}
					if (request.method === "DELETE" && !bindingResource.action) {
						requireSameOriginRequest(request);
						const piboSessionId = requireQueryParam(url, "piboSessionId");
						const bindingContext = resolveBindingContext(context, webSession, { piboSessionId });
						return responseJson({ ok: true, removed: baseService.removeBinding(bindingContext, bindingResource.id) });
					}
				}

				return undefined;
			} catch (error) {
				if (error instanceof PiboWebHttpError) throw error;
				throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
			}
		},
	};
}

async function handleOverlaySubmission(store: WebAnnotationStore, request: Request) {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== "application/json") throw new PiboWebHttpError("Content-Type must be application/json", 415);
	const body = await readJsonBody<OverlaySubmissionBody>(request);
	const bindingId = requireBodyString(body.bindingId, "bindingId", 120);
	const bindingToken = requireBodyString(body.bindingToken, "bindingToken", 200);
	const binding = store.getBindingById(bindingId);
	if (!binding) throw new PiboWebHttpError("Web Annotation binding was not found", 404);
	if (binding.state === "removed") throw new PiboWebHttpError("Web Annotation binding was removed", 404);
	if (binding.metadata?.overlaySubmissionToken !== bindingToken) throw new PiboWebHttpError("Invalid Web Annotation binding token", 403);
	const note = requireBodyString(body.note, "note", 2_000);
	const targetKind = requireTargetKind(body.targetKind);
	const viewport = normalizeViewport(body.viewport);
	return store.createAnnotation({
		ownerScope: binding.ownerScope,
		piboSessionId: binding.piboSessionId,
		piboRoomId: binding.piboRoomId,
		bindingId: binding.id,
		note,
		url: optionalBodyString(body.url, 2_000) ?? binding.url,
		title: optionalBodyString(body.title, 200) ?? binding.title,
		targetId: binding.targetId,
		targetKind,
		viewport,
		target: normalizeTarget(body.target, targetKind),
		screenshotRef: normalizeJsonObject(body.screenshotRef),
	});
}

function requireBodyString(value: string | undefined, field: string, max: number): string {
	const text = optionalBodyString(value, max)?.trim() ?? "";
	if (!text) throw new PiboWebHttpError(`${field} is required`, 400);
	return text;
}

function optionalBodyString(value: string | undefined, max: number): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Invalid string field", 400);
	const sanitized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
	return sanitized.length > max ? sanitized.slice(0, max) : sanitized;
}

function requireTargetKind(value: string | undefined) {
	if (!value || !isWebAnnotationTargetKind(value)) throw new PiboWebHttpError("Invalid annotation target kind", 400);
	return value;
}

function normalizeViewport(value: WebAnnotationViewport | undefined): WebAnnotationViewport {
	if (!value || typeof value.width !== "number" || typeof value.height !== "number") throw new PiboWebHttpError("viewport width and height are required", 400);
	return {
		width: boundedNumber(value.width, 0, 20_000),
		height: boundedNumber(value.height, 0, 20_000),
		devicePixelRatio: value.devicePixelRatio === undefined ? undefined : boundedNumber(value.devicePixelRatio, 0.1, 10),
	};
}

function normalizeTarget(value: WebAnnotationTarget | undefined, targetKind: ReturnType<typeof requireTargetKind>): WebAnnotationTarget | undefined {
	if (value === undefined) return { kind: targetKind };
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PiboWebHttpError("target must be an object", 400);
	return normalizeJsonObject({ ...value, kind: targetKind }) as WebAnnotationTarget;
}

function normalizeJsonObject<T extends object>(value: T | undefined): T | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PiboWebHttpError("Invalid object field", 400);
	return value;
}

function boundedNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) throw new PiboWebHttpError("Invalid numeric field", 400);
	return Math.max(min, Math.min(max, value));
}

function corsJson(payload: unknown, init: ResponseInit = {}): Response {
	return responseJson(payload, { ...init, headers: corsHeaders(init.headers) });
}

function corsResponse(body: string | null, init: ResponseInit = {}): Response {
	return new Response(body, { ...init, headers: corsHeaders(init.headers) });
}

function corsHeaders(existing: ResponseInit["headers"]): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers": "content-type",
		...Object.fromEntries(new Headers(existing).entries()),
	};
}

function requireSameOriginJsonRequest(request: Request): void {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== "application/json") throw new PiboWebHttpError("Content-Type must be application/json", 415);
	requireSameOriginRequest(request);
}

function requireSameOriginRequest(request: Request): void {
	const origin = request.headers.get("origin");
	if (!origin) throw new PiboWebHttpError("Origin header is required", 403);
	if (origin !== new URL(request.url).origin) throw new PiboWebHttpError("Origin is not allowed", 403);
}

function serviceForRequest(baseService: WebAnnotationCdpService, cdpUrl: string | undefined, request: Request, store: WebAnnotationStore, options: WebAnnotationsWebAppOptions): WebAnnotationCdpService {
	if (options.cdpService) return baseService;
	return createWebAnnotationCdpService({ store, cdpUrl, apiBaseUrl: new URL(request.url).origin });
}

function resolveBindingContext(context: PiboWebAppContext, webSession: PiboWebSession, input: { piboSessionId?: string; piboRoomId?: string }): WebAnnotationBindingContext {
	const piboSessionId = input.piboSessionId?.trim();
	if (!piboSessionId) throw new PiboWebHttpError("piboSessionId is required", 400);
	const session = context.channelContext.getSession(piboSessionId);
	if (!session) throw new PiboWebHttpError("Pibo session not found", 404);
	if (session.ownerScope && session.ownerScope !== webSession.ownerScope) throw new PiboWebHttpError("Pibo session is not authorized for this user", 403);
	return {
		ownerScope: webSession.ownerScope,
		piboSessionId,
		piboRoomId: input.piboRoomId?.trim() || undefined,
	};
}

function requireQueryParam(url: URL, name: string, fallbackName?: string): string {
	const value = (url.searchParams.get(name) ?? (fallbackName ? url.searchParams.get(fallbackName) : undefined))?.trim();
	if (!value) throw new PiboWebHttpError(`${name} is required`, 400);
	return value;
}

function optionalStatus(value: string | null | undefined) {
	if (!value) return undefined;
	if (!isWebAnnotationStatus(value)) throw new PiboWebHttpError("Invalid annotation status", 400);
	return value;
}

function parseLimit(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function matchBindingResource(pathname: string): { id: string; action?: string } | undefined {
	const prefix = `${WEB_ANNOTATIONS_API_PREFIX}/bindings/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
	if (parts.length === 0 || parts.length > 2) return undefined;
	return { id: parts[0], action: parts[1] };
}

function matchAnnotationResource(pathname: string): { id: string } | undefined {
	const prefix = `${WEB_ANNOTATIONS_API_PREFIX}/`;
	if (!pathname.startsWith(prefix) || pathname.startsWith(`${WEB_ANNOTATIONS_API_PREFIX}/bindings/`)) return undefined;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
	if (parts.length !== 1 || parts[0] === "targets" || parts[0] === "submissions" || parts[0] === "bindings") return undefined;
	return { id: parts[0] };
}
