#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
	cat <<'EOF'
Build and operate an isolated deployment slot through a configured SSH host.

Required environment:
  PIBO_POOL_SSH_HOST       SSH target; no host is hard-coded

Optional environment:
  PIBO_POOL_REMOTE_CLI     Default: /usr/local/bin/pibo-pool

Commands:
  acquire <holder> [full|medium|fresh] [ttl-minutes]
  status
  doctor
  renew <lease-id> <holder> [ttl-minutes]
  release <lease-id> <holder>
  reap [--apply]
EOF
}

host="${PIBO_POOL_SSH_HOST:-}"
remote_cli="${PIBO_POOL_REMOTE_CLI:-/usr/local/bin/pibo-pool}"
[[ -n "$host" ]] || { echo "PIBO_POOL_SSH_HOST is required" >&2; usage >&2; exit 2; }
command_name="${1:-}"
[[ -n "$command_name" ]] || { usage >&2; exit 2; }
shift

run_remote() {
	ssh -o BatchMode=yes "$host" "$remote_cli" "$@"
}

case "$command_name" in
	acquire)
		holder="${1:-}"
		seed="${2:-medium}"
		ttl="${3:-60}"
		[[ -n "$holder" ]] || { echo "acquire requires a holder" >&2; exit 2; }
		[[ "$seed" =~ ^(full|medium|fresh)$ ]] || { echo "seed must be full, medium, or fresh" >&2; exit 2; }
		[[ "$ttl" =~ ^[0-9]+$ && "$ttl" -gt 0 ]] || { echo "ttl-minutes must be positive" >&2; exit 2; }
		root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
		tmp_dir="$(mktemp -d)"
		trap 'rm -rf "$tmp_dir"' EXIT
		cd "$root_dir"
		npm pack --pack-destination "$tmp_dir" >/dev/null
		mapfile -t archives < <(find "$tmp_dir" -maxdepth 1 -type f -name '*.tgz' -print)
		[[ "${#archives[@]}" -eq 1 ]] || { echo "npm pack did not produce exactly one archive" >&2; exit 1; }
		archive="${archives[0]}"
		sha256="$(sha256sum "$archive" | cut -d' ' -f1)"
		commit="$(git rev-parse HEAD)"
		remote_archive="/root/.pibo/compute-pool/inbox/${sha256}.tgz"
		ssh -o BatchMode=yes "$host" "install -d -m 0700 /root/.pibo/compute-pool/inbox"
		if ! ssh -o BatchMode=yes "$host" "test -f '$remote_archive' && test \"\$(sha256sum '$remote_archive' | cut -d' ' -f1)\" = '$sha256'"; then
			scp -q -o BatchMode=yes "$archive" "$host:$remote_archive"
		fi
		ssh -o BatchMode=yes "$host" bash -s -- "$remote_cli" "$holder" "$seed" "$ttl" "$commit" "$remote_archive" <<'REMOTE'
set -euo pipefail
cli="$1" holder="$2" seed="$3" ttl="$4" commit="$5" archive="$6"
trap 'rm -f "$archive"' EXIT
"$cli" acquire --holder "$holder" --seed "$seed" --ttl-minutes "$ttl" --commit "$commit" --artifact "$archive" --json
REMOTE
		;;
	status|doctor)
		run_remote "$command_name" --json
		;;
	renew)
		lease_id="${1:-}"; holder="${2:-}"; ttl="${3:-60}"
		[[ -n "$lease_id" && -n "$holder" ]] || { echo "renew requires lease-id and holder" >&2; exit 2; }
		run_remote renew "$lease_id" --holder "$holder" --ttl-minutes "$ttl" --json
		;;
	release)
		lease_id="${1:-}"; holder="${2:-}"
		[[ -n "$lease_id" && -n "$holder" ]] || { echo "release requires lease-id and holder" >&2; exit 2; }
		run_remote release "$lease_id" --holder "$holder" --json
		;;
	reap)
		if [[ "${1:-}" == "--apply" ]]; then run_remote reap --apply --json; else run_remote reap --json; fi
		;;
	--help|-h|help)
		usage
		;;
	*)
		echo "Unknown command: $command_name" >&2
		usage >&2
		exit 2
		;;
esac
