import { memo, type ReactElement } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import prism from "../context/prism-client";
import { isStreamingDebugEnabled, recordStreamingDebugMarkdownRender } from "../streamingDebug";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

type MarkdownRendererProps = {
	children: string;
};

const allowedElements = [
	"p",
	"br",
	"strong",
	"em",
	"a",
	"ul",
	"ol",
	"li",
	"blockquote",
	"code",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"hr",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"input",
	"del",
];

const gfmRemarkPlugins = [remarkGfm];
const commonMarkRemarkPlugins: typeof gfmRemarkPlugins = [];

const markdownStructuralPattern = /[\n\r\\`*_\[\]<>]|~~/;
const markdownLinePrefixPattern = /^\s*(?:#{1,6}\s|[-+>]|(?:\d+[.)]))\s/;
const markdownThematicBreakPattern = /^\s*-{3,}\s*$/;
const markdownAutolinkPattern = /\b(?:https?:\/\/|www\.)|\S+@\S+\.\S+/i;
const markdownTaskListPattern = /^\s*[-+*]\s+\[[ xX]\]\s/m;
const markdownTablePattern = /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*(?:\n|$)/;

export function isPlainMarkdownText(markdown: string): boolean {
	return markdown.length > 0
		&& !markdownStructuralPattern.test(markdown)
		&& !markdownLinePrefixPattern.test(markdown)
		&& !markdownThematicBreakPattern.test(markdown)
		&& !(hasAutolinkCandidate(markdown) && markdownAutolinkPattern.test(markdown));
}

function hasAutolinkCandidate(markdown: string): boolean {
	return markdown.includes("://") || markdown.includes("www.") || markdown.includes("@");
}

export function requiresGfmMarkdown(markdown: string): boolean {
	return markdown.includes("~~")
		|| (markdown.includes("[") && markdownTaskListPattern.test(markdown))
		|| (markdown.includes("|") && markdownTablePattern.test(markdown))
		|| (hasAutolinkCandidate(markdown) && markdownAutolinkPattern.test(markdown));
}

const simpleGfmStrikethroughForbiddenPattern = /[\n\r\\`*_\[\]<>]/;
const simpleGfmTaskListPattern = /^\s*[-+*]\s+\[([ xX])\]\s+(.+?)\s*$/;
const simpleGfmTaskListTextForbiddenPattern = /[\n\r\\<>|~]/;
const simpleGfmTaskListLinkLabelForbiddenPattern = /[\n\r\\\[\]<>|~]/;
const simpleGfmTaskListLinkHrefForbiddenPattern = /[\s\[\]()`<>]/;

function renderSimpleGfmStrikethrough(markdown: string): ReactElement | undefined {
	if (!markdown.includes("~~")) return undefined;
	if (simpleGfmStrikethroughForbiddenPattern.test(markdown)) return undefined;
	if (markdownLinePrefixPattern.test(markdown)
		|| markdownThematicBreakPattern.test(markdown)
		|| (hasAutolinkCandidate(markdown) && markdownAutolinkPattern.test(markdown))
		|| (markdown.includes("[") && markdownTaskListPattern.test(markdown))
		|| (markdown.includes("|") && markdownTablePattern.test(markdown))) return undefined;

	const parts: Array<string | ReactElement> = [];
	let cursor = 0;
	let delCount = 0;
	while (cursor < markdown.length) {
		const start = markdown.indexOf("~~", cursor);
		if (start === -1) {
			parts.push(markdown.slice(cursor));
			break;
		}
		const end = markdown.indexOf("~~", start + 2);
		if (end === -1 || end === start + 2) return undefined;
		const plainPrefix = markdown.slice(cursor, start);
		if (plainPrefix) parts.push(plainPrefix);
		const deletedText = markdown.slice(start + 2, end);
		if (deletedText.includes("~")) return undefined;
		parts.push(<del key={`del-${delCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="del">{deletedText}</del>);
		delCount += 1;
		cursor = end + 2;
	}
	return delCount > 0 ? <p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p">{parts}</p> : undefined;
}

function normalizeSimpleMarkdownLinkHref(href: string): string | undefined {
	if (!href || simpleGfmTaskListLinkHrefForbiddenPattern.test(href)) return undefined;
	const transformed = defaultUrlTransform(href);
	if (!transformed) return undefined;
	if (transformed.startsWith("/") || transformed.startsWith("#")) return transformed;
	try {
		const parsed = new URL(transformed);
		return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" ? transformed : undefined;
	} catch {
		return undefined;
	}
}

function renderSimpleMarkdownLinkLabel(label: string, linkIndex: number): Array<string | ReactElement> | undefined {
	if (!label || simpleGfmTaskListLinkLabelForbiddenPattern.test(label)) return undefined;
	const parts: Array<string | ReactElement> = [];
	let cursor = 0;
	let strongCount = 0;
	let emphasisCount = 0;
	let codeCount = 0;
	while (cursor < label.length) {
		const strongStart = label.indexOf("**", cursor);
		const emphasisStart = label.indexOf("_", cursor);
		const codeStart = label.indexOf("`", cursor);
		const nextStrong = strongStart === -1 ? Number.POSITIVE_INFINITY : strongStart;
		const nextEmphasis = emphasisStart === -1 ? Number.POSITIVE_INFINITY : emphasisStart;
		const nextCode = codeStart === -1 ? Number.POSITIVE_INFINITY : codeStart;
		const start = Math.min(nextStrong, nextEmphasis, nextCode);
		if (start === Number.POSITIVE_INFINITY) {
			const suffix = label.slice(cursor);
			if (suffix.includes("*") || suffix.includes("_") || suffix.includes("`") || (hasAutolinkCandidate(suffix) && markdownAutolinkPattern.test(suffix))) return undefined;
			if (suffix) parts.push(suffix);
			break;
		}
		const plainPrefix = label.slice(cursor, start);
		if (plainPrefix.includes("*") || plainPrefix.includes("_") || plainPrefix.includes("`") || (hasAutolinkCandidate(plainPrefix) && markdownAutolinkPattern.test(plainPrefix))) return undefined;
		if (plainPrefix) parts.push(plainPrefix);
		if (start === nextStrong) {
			const end = label.indexOf("**", start + 2);
			if (end === -1 || end === start + 2) return undefined;
			const strongText = label.slice(start + 2, end);
			if (strongText.includes("*") || strongText.includes("`") || strongText.includes("[") || strongText.includes("]")) return undefined;
			if (strongText.includes("_")) {
				if (!strongText.startsWith("_") || !strongText.endsWith("_") || strongText.length <= 2) return undefined;
				const emphasisText = strongText.slice(1, -1);
				if (emphasisText.includes("*") || emphasisText.includes("_") || emphasisText.includes("`") || emphasisText.includes("[") || emphasisText.includes("]")) return undefined;
				parts.push(
					<strong key={`link-${linkIndex}-strong-${strongCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="strong">
						<em data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="em">{emphasisText}</em>
					</strong>,
				);
			} else {
				parts.push(<strong key={`link-${linkIndex}-strong-${strongCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="strong">{strongText}</strong>);
			}
			strongCount += 1;
			cursor = end + 2;
		} else if (start === nextEmphasis) {
			if (label[start + 1] === "_") return undefined;
			const end = label.indexOf("_", start + 1);
			if (end === -1 || end === start + 1) return undefined;
			const emphasisText = label.slice(start + 1, end);
			if (emphasisText.includes("**")) {
				if (!emphasisText.startsWith("**") || !emphasisText.endsWith("**") || emphasisText.length <= 4) return undefined;
				const strongText = emphasisText.slice(2, -2);
				if (strongText.includes("*") || strongText.includes("_") || strongText.includes("`") || strongText.includes("[") || strongText.includes("]")) return undefined;
				parts.push(
					<em key={`link-${linkIndex}-em-${emphasisCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="em">
						<strong data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="strong">{strongText}</strong>
					</em>,
				);
			} else {
				if (emphasisText.includes("*") || emphasisText.includes("_") || emphasisText.includes("`") || emphasisText.includes("[") || emphasisText.includes("]")) return undefined;
				parts.push(<em key={`link-${linkIndex}-em-${emphasisCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="em">{emphasisText}</em>);
			}
			emphasisCount += 1;
			cursor = end + 1;
		} else {
			if (label[start + 1] === "`") return undefined;
			const end = label.indexOf("`", start + 1);
			if (end === -1 || end === start + 1) return undefined;
			const codeText = label.slice(start + 1, end);
			if (codeText.includes("`") || codeText.includes("[") || codeText.includes("]") || codeText.startsWith(" ") || codeText.endsWith(" ")) return undefined;
			parts.push(<code key={`link-${linkIndex}-code-${codeCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="code">{codeText}</code>);
			codeCount += 1;
			cursor = end + 1;
		}
	}
	return parts.length > 0 ? parts : undefined;
}

function renderSimpleTaskListText(text: string): Array<string | ReactElement> | undefined {
	const parts: Array<string | ReactElement> = [];
	let cursor = 0;
	let strongCount = 0;
	let codeCount = 0;
	let linkCount = 0;
	while (cursor < text.length) {
		const strongStart = text.indexOf("**", cursor);
		const codeStart = text.indexOf("`", cursor);
		const linkStart = text.indexOf("[", cursor);
		const nextStrong = strongStart === -1 ? Number.POSITIVE_INFINITY : strongStart;
		const nextCode = codeStart === -1 ? Number.POSITIVE_INFINITY : codeStart;
		const nextLink = linkStart === -1 ? Number.POSITIVE_INFINITY : linkStart;
		const start = Math.min(nextStrong, nextCode, nextLink);
		if (start === Number.POSITIVE_INFINITY) {
			const suffix = text.slice(cursor);
			if (suffix.includes("*") || suffix.includes("_") || suffix.includes("`") || suffix.includes("[") || suffix.includes("]") || (hasAutolinkCandidate(suffix) && markdownAutolinkPattern.test(suffix))) return undefined;
			if (suffix) parts.push(suffix);
			break;
		}
		const plainPrefix = text.slice(cursor, start);
		if (plainPrefix.includes("*") || plainPrefix.includes("_") || plainPrefix.includes("`") || plainPrefix.includes("[") || plainPrefix.includes("]") || (hasAutolinkCandidate(plainPrefix) && markdownAutolinkPattern.test(plainPrefix))) return undefined;
		if (plainPrefix) parts.push(plainPrefix);
		if (start === nextStrong) {
			const end = text.indexOf("**", start + 2);
			if (end === -1 || end === start + 2) return undefined;
			const strongText = text.slice(start + 2, end);
			if (strongText.includes("*") || strongText.includes("_") || strongText.includes("`") || strongText.includes("[") || strongText.includes("]")) return undefined;
			parts.push(<strong key={`strong-${strongCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="strong">{strongText}</strong>);
			strongCount += 1;
			cursor = end + 2;
		} else if (start === nextCode) {
			if (text[start + 1] === "`") return undefined;
			const end = text.indexOf("`", start + 1);
			if (end === -1 || end === start + 1) return undefined;
			const codeText = text.slice(start + 1, end);
			if (codeText.includes("_") || codeText.includes("`") || codeText.includes("[") || codeText.includes("]") || codeText.startsWith(" ") || codeText.endsWith(" ")) return undefined;
			parts.push(<code key={`code-${codeCount}`} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="code">{codeText}</code>);
			codeCount += 1;
			cursor = end + 1;
		} else {
			const labelEnd = text.indexOf("](", start + 1);
			if (labelEnd === -1 || labelEnd === start + 1) return undefined;
			const hrefEnd = text.indexOf(")", labelEnd + 2);
			if (hrefEnd === -1 || hrefEnd === labelEnd + 2) return undefined;
			const labelChildren = renderSimpleMarkdownLinkLabel(text.slice(start + 1, labelEnd), linkCount);
			const href = normalizeSimpleMarkdownLinkHref(text.slice(labelEnd + 2, hrefEnd));
			if (!href || !labelChildren) return undefined;
			parts.push(<a key={`link-${linkCount}`} href={href} target="_blank" rel="noreferrer" data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="a">{labelChildren}</a>);
			linkCount += 1;
			cursor = hrefEnd + 1;
		}
	}
	return parts.length > 0 ? parts : undefined;
}

function renderSimpleGfmTaskList(markdown: string): ReactElement | undefined {
	const match = simpleGfmTaskListPattern.exec(markdown);
	if (!match) return undefined;
	const text = match[2];
	if (!text || simpleGfmTaskListTextForbiddenPattern.test(text)) return undefined;
	const renderedText = renderSimpleTaskListText(text);
	if (!renderedText) return undefined;
	const checked = match[1].toLowerCase() === "x";
	return (
		<ul className="contains-task-list" data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="ul">
			<li className="task-list-item" data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="li">
				<input type="checkbox" checked={checked} readOnly disabled data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="input" />
				{renderedText}
			</li>
		</ul>
	);
}

const components: Components = {
	p({ children, node: _node, ...props }) {
		return <p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p" {...props}>{children}</p>;
	},
	ul({ children, node: _node, ...props }) {
		return <ul data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="ul" {...props}>{children}</ul>;
	},
	ol({ children, node: _node, ...props }) {
		return <ol data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="ol" {...props}>{children}</ol>;
	},
	li({ children, node: _node, ...props }) {
		return <li data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="li" {...props}>{children}</li>;
	},
	blockquote({ children, node: _node, ...props }) {
		return <blockquote data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="blockquote" {...props}>{children}</blockquote>;
	},
	pre({ children, node: _node, ...props }) {
		return <pre data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="pre" {...props}>{children}</pre>;
	},
	a({ href, children }) {
		return (
			<a href={href} target="_blank" rel="noreferrer" data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="a">
				{children}
			</a>
		);
	},
	code({ className, children, node: _node, ...props }) {
		const language = languageFromClassName(className);
		const code = String(children).replace(/\n$/, "");
		if (!language) {
			return (
				<code className={className} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="code" {...props}>
					{children}
				</code>
			);
		}
		const grammar = prism.languages[language];
		if (!grammar) {
			return (
				<code className={className} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="code" {...props}>
					{children}
				</code>
			);
		}
		return (
			<code
				className={`language-${language}`}
				data-pibo-component="MarkdownRenderer"
				data-pibo-markdown-node="code"
				dangerouslySetInnerHTML={{ __html: prism.highlight(code, grammar, language) }}
				{...props}
			/>
		);
	},
	th({ children, node: _node, ...props }) {
		return <th data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="th" {...props}>{children}</th>;
	},
	td({ children, node: _node, ...props }) {
		return <td data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="td" {...props}>{children}</td>;
	},
	input({ checked, node: _node, ...props }) {
		return <input type="checkbox" checked={Boolean(checked)} readOnly disabled data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="input" {...props} />;
	},
};

function languageFromClassName(className?: string): string | undefined {
	const match = /language-(\S+)/.exec(className ?? "");
	if (!match) return undefined;
	const language = match[1].toLowerCase();
	if (language === "sh" || language === "shell") return "bash";
	if (language === "js") return "javascript";
	if (language === "ts") return "typescript";
	if (language === "md") return "markdown";
	if (language === "yml") return "yaml";
	return language;
}

function recordMarkdownRenderIfEnabled(mode: "plain" | "commonmark" | "gfm" | "gfm-fast", startedAt: number | undefined): void {
	if (startedAt === undefined) return;
	const endedAt = typeof performance === "undefined" ? Date.now() : performance.now();
	recordStreamingDebugMarkdownRender(mode, endedAt - startedAt);
}

const safeUrlTransform: UrlTransform = (url, key, node) => {
	if (node.tagName !== "a" || key !== "href") return "";
	const transformed = defaultUrlTransform(url);
	if (!transformed) return "";
	if (transformed.startsWith("/") || transformed.startsWith("#")) return transformed;
	try {
		const parsed = new URL(transformed);
		return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" ? transformed : "";
	} catch {
		return "";
	}
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ children }: MarkdownRendererProps) {
	const startedAt = isStreamingDebugEnabled()
		? (typeof performance === "undefined" ? Date.now() : performance.now())
		: undefined;
	let mode: "plain" | "commonmark" | "gfm" | "gfm-fast" = "commonmark";
	let element: ReactElement;
	if (isPlainMarkdownText(children)) {
		mode = "plain";
		element = <p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p">{children}</p>;
	} else {
		const useGfm = requiresGfmMarkdown(children);
		const simpleGfmElement = useGfm ? renderSimpleGfmStrikethrough(children) ?? renderSimpleGfmTaskList(children) : undefined;
		if (simpleGfmElement) {
			mode = "gfm-fast";
			element = simpleGfmElement;
		} else {
			mode = useGfm ? "gfm" : "commonmark";
			// ReactMarkdown is a synchronous parser/render function; call it directly so debug timings include its parse/tree-build work.
			element = ReactMarkdown({
				allowedElements,
				children,
				components,
				remarkPlugins: useGfm ? gfmRemarkPlugins : commonMarkRemarkPlugins,
				skipHtml: true,
				urlTransform: safeUrlTransform,
			});
		}
	}
	recordMarkdownRenderIfEnabled(mode, startedAt);
	return element;
});
