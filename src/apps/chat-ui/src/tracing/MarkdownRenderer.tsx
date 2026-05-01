import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

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
	th({ children }) {
		return <th>{children}</th>;
	},
	td({ children }) {
		return <td>{children}</td>;
	},
};

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
