import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import prism from "../context/prism-client";
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

const components: Components = {
	a({ href, children }) {
		return (
			<a href={href} target="_blank" rel="noreferrer">
				{children}
			</a>
		);
	},
	code({ className, children, node: _node, ...props }) {
		const language = languageFromClassName(className);
		const code = String(children).replace(/\n$/, "");
		if (!language) {
			return (
				<code className={className} {...props}>
					{children}
				</code>
			);
		}
		const grammar = prism.languages[language];
		if (!grammar) {
			return (
				<code className={className} {...props}>
					{children}
				</code>
			);
		}
		return (
			<code
				className={`language-${language}`}
				dangerouslySetInnerHTML={{ __html: prism.highlight(code, grammar, language) }}
				{...props}
			/>
		);
	},
	th({ children }) {
		return <th>{children}</th>;
	},
	td({ children }) {
		return <td>{children}</td>;
	},
	input({ checked, node: _node, ...props }) {
		return <input type="checkbox" checked={Boolean(checked)} readOnly disabled {...props} />;
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

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
	return (
		<ReactMarkdown
			allowedElements={allowedElements}
			components={components}
			remarkPlugins={[remarkGfm]}
			skipHtml
			urlTransform={safeUrlTransform}
		>
			{children}
		</ReactMarkdown>
	);
}
