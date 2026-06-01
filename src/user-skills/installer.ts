import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UserSkill } from "./types.js";
import { createUserSkill, defaultUserSkillDir, parseSkillMd } from "./store.js";

type ParsedSource = {
  account: string;
  repo: string;
  path?: string; // e.g. "skills/frontend-design"
  skillName?: string;
};

export function parseSkillUrl(url: string): ParsedSource | undefined {
  const trimmed = url.trim();

  // skills.sh: https://skills.sh/{account}/skills/{skill-name}
  // skills.sh: https://skills.sh/{account}/{repo}/{skill-name}
  if (trimmed.startsWith("https://skills.sh/")) {
    const rest = trimmed.slice("https://skills.sh/".length);
    const parts = rest.split("/").filter(Boolean);
    if (parts.length >= 3) {
      // Format: {account}/{repo}/{skill-name} (e.g. softaworks/agent-toolkit/writing-clearly)
      const account = parts[0];
      const repo = parts[1];
      const skillName = parts[2];
      return { account, repo, path: `skills/${skillName}`, skillName };
    }
    if (parts.length >= 2 && parts[1] === "skills") {
      const account = parts[0];
      const skillName = parts[2] ?? parts[0];
      return { account, repo: "skills", path: `skills/${skillName}`, skillName };
    }
    if (parts.length === 2) {
      // Format: {account}/skills or {account}/{repo}
      if (parts[1] === "skills") {
        return { account: parts[0], repo: "skills" };
      }
      return { account: parts[0], repo: parts[1] };
    }
    if (parts.length === 1) {
      return { account: parts[0], repo: "skills" };
    }
  }

  // GitHub tree URL: https://github.com/{account}/{repo}/tree/{branch}/{path}
  const githubTreeMatch = trimmed.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/[^\/]+\/(.+)$/);
  if (githubTreeMatch) {
    const account = githubTreeMatch[1];
    const repo = githubTreeMatch[2];
    const path = githubTreeMatch[3];
    const skillName = path.split("/").pop() ?? repo;
    return { account, repo, path, skillName };
  }

  // GitHub shorthand or repo URL: https://github.com/{account}/{repo}
  const githubRepoMatch = trimmed.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)$/);
  if (githubRepoMatch) {
    return { account: githubRepoMatch[1], repo: githubRepoMatch[2] };
  }

  // Bare shorthand: {account}/{repo} or {account}/{repo}/{skill-path}
  const shorthandMatch = trimmed.match(/^([^\/\s]+)\/([^\/\s]+)(?:\/(.+))?$/);
  if (shorthandMatch && !trimmed.startsWith("http")) {
    const account = shorthandMatch[1];
    const repo = shorthandMatch[2];
    const path = shorthandMatch[3];
    const skillName = path?.split("/").pop() ?? repo;
    return { account, repo, path, skillName };
  }

  return undefined;
}

type GitHubContentItem = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  url: string;
};

async function fetchGitHubContents(account: string, repo: string, path: string): Promise<GitHubContentItem[]> {
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(account)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "pibo-skills-installer" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub API error (${response.status}): ${text || response.statusText}`);
  }
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`Expected directory listing from GitHub API, got: ${typeof data}`);
  }
  return data as GitHubContentItem[];
}

async function fetchGitHubFile(downloadUrl: string): Promise<Uint8Array> {
  const response = await fetch(downloadUrl, { headers: { "User-Agent": "pibo-skills-installer" } });
  if (!response.ok) {
    throw new Error(`Failed to download file (${response.status}): ${downloadUrl}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function downloadDirectory(
  account: string,
  repo: string,
  path: string,
  targetDir: string,
): Promise<void> {
  const items = await fetchGitHubContents(account, repo, path);
  for (const item of items) {
    const targetPath = join(targetDir, item.name);
    if (item.type === "file") {
      if (!item.download_url) continue;
      const content = await fetchGitHubFile(item.download_url);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, content);
    } else if (item.type === "dir") {
      mkdirSync(targetPath, { recursive: true });
      await downloadDirectory(account, repo, item.path, targetPath);
    }
  }
}

async function findSkillMdPath(items: GitHubContentItem[]): Promise<GitHubContentItem | undefined> {
  return items.find((item) => item.type === "file" && item.name.toLowerCase() === "skill.md");
}

async function findSkillDirectory(account: string, repo: string, path?: string): Promise<{ path: string; skillName: string }> {
  if (path) {
    const items = await fetchGitHubContents(account, repo, path);
    const skillMd = await findSkillMdPath(items);
    if (skillMd) {
      return { path, skillName: path.split("/").pop() ?? repo };
    }
    // If no SKILL.md at this path, search subdirectories one level deep
    for (const item of items) {
      if (item.type === "dir") {
        const subItems = await fetchGitHubContents(account, repo, item.path).catch(() => []);
        const subSkillMd = await findSkillMdPath(subItems);
        if (subSkillMd) {
          return { path: item.path, skillName: item.name };
        }
      }
    }
  }

  // Try common skill directories
  const candidates = ["skills", "skill", "src/skills", "agents/skills"];
  for (const candidate of candidates) {
    const items = await fetchGitHubContents(account, repo, candidate).catch(() => []);
    const skillMd = await findSkillMdPath(items);
    if (skillMd) {
      return { path: candidate, skillName: candidate };
    }
    // Search one level deep
    for (const item of items) {
      if (item.type === "dir") {
        const subItems = await fetchGitHubContents(account, repo, item.path).catch(() => []);
        const subSkillMd = await findSkillMdPath(subItems);
        if (subSkillMd) {
          return { path: item.path, skillName: item.name };
        }
      }
    }
  }

  // Search repository root for SKILL.md
  const rootItems = await fetchGitHubContents(account, repo, "").catch(() => []);
  const rootSkillMd = await findSkillMdPath(rootItems);
  if (rootSkillMd) {
    return { path: "", skillName: repo };
  }

  throw new Error(`Could not find a SKILL.md in ${account}/${repo}${path ? `/${path}` : ""}`);
}

export async function installSkillFromUrl(url: string, cwd = process.cwd()): Promise<UserSkill> {
  const source = parseSkillUrl(url);
  if (!source) {
    throw new Error(`Unsupported skill URL format: ${url}`);
  }

  const { account, repo, path, skillName } = source;
  const resolved = path
    ? { path, skillName: skillName ?? path.split("/").pop() ?? repo }
    : await findSkillDirectory(account, repo);

  const targetName = resolved.skillName;
  const targetDir = join(defaultUserSkillDir(cwd), targetName);

  if (existsSync(targetDir)) {
    throw new Error(`A skill named "${targetName}" already exists. Delete it first or choose a different name.`);
  }

  mkdirSync(targetDir, { recursive: true });

  try {
    await downloadDirectory(account, repo, resolved.path, targetDir);
  } catch (error) {
    // Clean up on failure
    try {
      const { rmSync } = await import("node:fs");
      rmSync(targetDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }

  // Read SKILL.md to extract name and description
  const skillMdPath = join(targetDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    throw new Error(`Download completed but no SKILL.md found in ${targetName}`);
  }

  const { readFileSync } = await import("node:fs");
  const content = readFileSync(skillMdPath, "utf-8");
  const parsed = parseSkillMd(content);

  const name = parsed.name || targetName;
  const description = parsed.description || "";

  // Store the skill metadata (description lives in SKILL.md only, not JSON)
  const { randomUUID } = await import("node:crypto");
  const now = new Date().toISOString();
  const skill: UserSkill = {
    id: randomUUID(),
    name,
    description,
    path: skillMdPath,
    enabled: true,
    source: url.includes("skills.sh") ? "skills.sh" : "github",
    sourceUrl: url,
    createdAt: now,
    updatedAt: now,
  };

  const { loadUserSkillStore, saveUserSkillStore } = await import("./store.js");
  const store = loadUserSkillStore(cwd);
  const existing = store.skills.find((s) => s.name === name);
  if (existing) {
    const { rmSync } = await import("node:fs");
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`A skill named "${name}" already exists. Delete it first or choose a different name.`);
  }
  // Strip description before persisting to JSON store.
  const storedSkill = { ...skill };
  delete (storedSkill as Partial<UserSkill>).description;
  store.skills.push(storedSkill as UserSkill);
  store.skills.sort((a, b) => a.name.localeCompare(b.name));
  saveUserSkillStore(store, cwd);

  return skill;
}
