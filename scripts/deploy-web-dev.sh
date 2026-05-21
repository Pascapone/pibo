#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEPLOY_ENV_FILE="${PIBO_DEPLOY_ENV_FILE:-$ROOT_DIR/.env.developer-host}"
if [[ -f "$DEPLOY_ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$DEPLOY_ENV_FILE"
	set +a
fi

resolve_dev_public_url() {
	if [[ -n "${PIBO_DEV_PUBLIC_URL:-}" ]]; then
		printf '%s\n' "$PIBO_DEV_PUBLIC_URL"
		return
	fi
	if [[ -n "${PIBO_DEV_BASE_URL:-}" ]]; then
		printf '%s/apps/chat\n' "${PIBO_DEV_BASE_URL%/}"
		return
	fi
	cat >&2 <<'EOF'
Dev deploy needs a host-specific public dev URL.
Set PIBO_DEV_PUBLIC_URL, or set PIBO_DEV_BASE_URL and the script will append /apps/chat.
You can export it in the shell, service environment, or a repo-local .env.developer-host file.
EOF
	exit 2
}

DEV_PUBLIC_URL="$(resolve_dev_public_url)"
DEV_BRANCH="${PIBO_DEV_BRANCH:-dev}"
DEV_REMOTE="${PIBO_DEV_REMOTE:-origin}"

cd "$ROOT_DIR"
REPO_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(dirname "$REPO_COMMON_DIR")"
DEV_WORKTREE="${PIBO_DEV_WORKTREE:-$REPO_ROOT/.worktrees/$DEV_BRANCH}"
DEV_WORKTREE="$(mkdir -p "$(dirname "$DEV_WORKTREE")" && cd "$(dirname "$DEV_WORKTREE")" && pwd -P)/$(basename "$DEV_WORKTREE")"

require_clean_worktree() {
	local worktree_path="$1"
	if [[ -n "$(git -C "$worktree_path" status --porcelain --untracked-files=all)" ]]; then
		echo "Dev deploy requires a clean '$DEV_BRANCH' worktree at $worktree_path." >&2
		git -C "$worktree_path" status --short >&2
		exit 1
	fi
}

sync_dev_worktree() {
	local worktree_path="$1"
	local current_branch
	current_branch="$(git -C "$worktree_path" branch --show-current)"
	if [[ "$current_branch" != "$DEV_BRANCH" ]]; then
		echo "Dev deploy must run from branch '$DEV_BRANCH' so the hosted dev server mirrors that branch." >&2
		echo "Worktree: $worktree_path" >&2
		echo "Current branch: ${current_branch:-detached}" >&2
		exit 1
	fi
	require_clean_worktree "$worktree_path"
	echo "==> Syncing $DEV_BRANCH with $DEV_REMOTE/$DEV_BRANCH"
	git -C "$worktree_path" fetch "$DEV_REMOTE" "$DEV_BRANCH"
	git -C "$worktree_path" merge --ff-only "$DEV_REMOTE/$DEV_BRANCH"
	if [[ "$(git -C "$worktree_path" rev-parse HEAD)" != "$(git -C "$worktree_path" rev-parse "$DEV_REMOTE/$DEV_BRANCH")" ]]; then
		echo "Dev deploy refused: local '$DEV_BRANCH' does not exactly match '$DEV_REMOTE/$DEV_BRANCH'." >&2
		exit 1
	fi
}

ensure_dev_worktree() {
	if [[ -e "$DEV_WORKTREE" ]]; then
		if git -C "$DEV_WORKTREE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
			sync_dev_worktree "$DEV_WORKTREE"
			return
		fi
		echo "Dev worktree path exists but is not a Git worktree: $DEV_WORKTREE" >&2
		exit 1
	fi

	local existing_dev_worktree
	existing_dev_worktree="$(git worktree list --porcelain | awk -v branch="refs/heads/${DEV_BRANCH}" '
		$1 == "worktree" { path = $2 }
		$1 == "branch" && $2 == branch { print path; exit }
	')"
	if [[ -n "$existing_dev_worktree" && "$existing_dev_worktree" != "$DEV_WORKTREE" ]]; then
		echo "Branch '$DEV_BRANCH' is already checked out at: $existing_dev_worktree" >&2
		echo "The hosted dev server is pinned to the canonical worktree: $DEV_WORKTREE" >&2
		echo "Move it with: git worktree move '$existing_dev_worktree' '$DEV_WORKTREE'" >&2
		exit 1
	fi

	echo "==> Creating canonical $DEV_BRANCH worktree at $DEV_WORKTREE"
	git fetch "$DEV_REMOTE" "$DEV_BRANCH"
	if git show-ref --verify --quiet "refs/heads/$DEV_BRANCH"; then
		git worktree add "$DEV_WORKTREE" "$DEV_BRANCH"
	else
		git worktree add -b "$DEV_BRANCH" "$DEV_WORKTREE" "$DEV_REMOTE/$DEV_BRANCH"
	fi
	sync_dev_worktree "$DEV_WORKTREE"
}

current_branch="$(git branch --show-current)"
current_root="$(cd "$(git rev-parse --show-toplevel)" && pwd -P)"
if [[ "$current_branch" != "$DEV_BRANCH" || "$current_root" != "$DEV_WORKTREE" ]]; then
	ensure_dev_worktree
	echo "==> Re-running dev deploy from canonical $DEV_BRANCH worktree: $DEV_WORKTREE"
	exec "$DEV_WORKTREE/scripts/deploy-web-dev.sh"
fi

sync_dev_worktree "$ROOT_DIR"

echo "==> Building dev web gateway from $(git rev-parse --short HEAD) on $DEV_BRANCH"
npm run build

echo "==> Verifying dev public web app without restarting"
if curl -fsS "$DEV_PUBLIC_URL" >/tmp/pibo-web-dev-app.html; then
	echo "Existing dev public web app reachable at $DEV_PUBLIC_URL"
else
	echo "Existing dev public web app is not reachable yet at $DEV_PUBLIC_URL"
fi

echo "Dev deploy complete."
echo "Dev gateway was not restarted."
echo "To activate this dev deployment, run:"
echo
echo "  pibo gateway dev restart"
echo
echo "For a first-time dev gateway start, run:"
echo
echo "  pibo gateway dev start"
