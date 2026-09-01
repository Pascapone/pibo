import { parse as parseYaml } from "yaml";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNSAFE_SINGLE_LINE_RE = /[\r\n\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0]|\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}|\p{Bidi_Control}|\p{Default_Ignorable_Code_Point}/u;
const NON_VISIBLE_RE = /[\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0\p{White_Space}\p{M}\p{Default_Ignorable_Code_Point}]/gu;

export function isSafeSingleLineString(value) {
	return typeof value === "string"
		&& value === value.trim()
		&& value.length > 0
		&& !UNSAFE_SINGLE_LINE_RE.test(value)
		&& value.normalize("NFC").replace(NON_VISIBLE_RE, "").length > 0;
}

export function parseFrontmatter(content) {
	const opening = content.match(/^---(?:\r\n|\n|\r)/);
	if (!opening) {
		return { data: null, body: content, error: null };
	}
	const yamlStart = opening[0].length;
	let lineStart = yamlStart;
	let yamlEnd = -1;
	let bodyStart = -1;
	const lineEnding = /\r\n|\n|\r/g;
	lineEnding.lastIndex = yamlStart;
	for (let match = lineEnding.exec(content); match; match = lineEnding.exec(content)) {
		if (content.slice(lineStart, match.index) === "---") {
			yamlEnd = lineStart;
			bodyStart = match.index + match[0].length;
			break;
		}
		lineStart = match.index + match[0].length;
	}
	if (yamlEnd < 0 && content.slice(lineStart) === "---") {
		yamlEnd = lineStart;
		bodyStart = content.length;
	}
	if (yamlEnd < 0) return { data: null, body: content, error: "frontmatter has no closing delimiter" };
	const body = content.slice(bodyStart);
	try {
		const yaml = content.slice(yamlStart, yamlEnd).replace(/\r\n|\r/g, "\n");
		const data = parseYaml(yaml);
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			return { data: null, body, error: "frontmatter must be a YAML mapping" };
		}
		return { data, body, error: null };
	} catch (error) {
		return { data: null, body, error: `frontmatter YAML is invalid: ${error.message}` };
	}
}

export function validateCoreConceptContent(content) {
	const issues = [];
	const parsed = parseFrontmatter(content);
	if (parsed.error) {
		issues.push({ code: "OKF_FRONTMATTER_PARSE", message: parsed.error });
		return issues;
	}
	if (!parsed.data) {
		issues.push({ code: "OKF_FRONTMATTER_MISSING", message: "A concept requires YAML frontmatter." });
		return issues;
	}
	if (typeof parsed.data.type !== "string" || !parsed.data.type.trim()) {
		issues.push({ code: "OKF_TYPE", message: "A concept requires a non-empty type." });
	}
	return issues;
}

export function validateIndexContent(content, { root = false } = {}) {
	const issues = [];
	const parsed = parseFrontmatter(content);
	if (parsed.error) issues.push({ code: "OKF_RESERVED_FRONTMATTER", message: parsed.error });
	if (parsed.data) {
		if (!root || Object.keys(parsed.data).some((key) => key !== "okf_version")) {
			issues.push({
				code: "OKF_INDEX_FRONTMATTER",
				message: "Only the bundle-root index may have frontmatter, and it may contain only okf_version.",
			});
		}
		if (root && "okf_version" in parsed.data && (typeof parsed.data.okf_version !== "string" || !parsed.data.okf_version.trim())) {
			issues.push({ code: "OKF_INDEX_VERSION", message: "A present okf_version must be a non-empty string." });
		}
	}
	if (!/^#\s+\S/m.test(parsed.body)) issues.push({ code: "OKF_INDEX_HEADING", message: "An index must contain a Markdown heading." });
	return issues;
}

function scanLogBody(body) {
	const withoutComments = body.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, " "));
	const lines = withoutComments.split(/\r\n|\n|\r/);
	const sections = [];
	let title = false;
	let fence = null;
	for (const line of lines) {
		if (fence) {
			const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
			if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
			continue;
		}
		const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
			fence = { character: opening[1][0], length: opening[1].length };
			continue;
		}
		if (/^#\s+\S/.test(line)) title = true;
		const heading = line.match(/^##\s+(.+)$/);
		if (heading) {
			sections.push({ date: heading[1].trim(), hasEntry: false });
			continue;
		}
		if (sections.length > 0 && /^ {0,3}[-+*][ \t]+\S/.test(line)) sections.at(-1).hasEntry = true;
	}
	return { title, sections };
}

export function validateLogContent(content) {
	const issues = [];
	const parsed = parseFrontmatter(content);
	if (parsed.error) issues.push({ code: "OKF_RESERVED_FRONTMATTER", message: parsed.error });
	if (parsed.data) issues.push({ code: "OKF_LOG_FRONTMATTER", message: "A log must not contain frontmatter." });
	const scan = scanLogBody(parsed.body);
	if (!scan.title) issues.push({ code: "OKF_LOG_HEADING", message: "A log must contain a title heading." });
	const dates = scan.sections.map((section) => section.date);
	if (scan.sections.length === 0) {
		issues.push({ code: "OKF_LOG_SECTION_MISSING", message: "A present log must contain at least one date-grouped entry section." });
	}
	for (const section of scan.sections) {
		const date = section.date;
		const parsedDate = new Date(`${date}T00:00:00Z`);
		if (!ISO_DATE_RE.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
			issues.push({ code: "OKF_LOG_DATE", message: `Log heading is not a valid YYYY-MM-DD date: ${date}` });
			continue;
		}
		if (!section.hasEntry) issues.push({ code: "OKF_LOG_ENTRY_MISSING", message: `Log date section has no list entry: ${date}` });
	}
	if (new Set(dates).size !== dates.length) issues.push({ code: "OKF_LOG_DATE_DUPLICATE", message: "Log date headings must be unique." });
	const sorted = [...dates].sort().reverse();
	if (dates.join("\0") !== sorted.join("\0")) issues.push({ code: "OKF_LOG_ORDER", message: "Log dates must be newest first." });
	return issues;
}
