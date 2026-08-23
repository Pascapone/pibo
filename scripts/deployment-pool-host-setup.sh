#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
	cat <<'EOF'
Configure a Pibo deployment-pool host.

Required environment:
  PIBO_COMPUTE_POOL_BASE_URL      Base URL whose slot-NN subdomains route here
  PIBO_POOL_RUNTIME_BINARY        Absolute dist/bin/pibo.js used by the host CLI

Optional environment:
  PIBO_COMPUTE_POOL_ROOT          Default: /root/.pibo/compute-pool
  PIBO_COMPUTE_POOL_SLOT_COUNT    Default: 10
  PIBO_COMPUTE_POOL_MAX_ACTIVE    Default: 3
  PIBO_COMPUTE_POOL_PORT_BASE     Default: 5000
  PIBO_COMPUTE_POOL_PORT_STRIDE   Default: 10
  PIBO_COMPUTE_POOL_RUNTIME_IMAGE Default: pibo:latest
  PIBO_COMPUTE_POOL_SEED_SOURCE_HOME     Default: /root/.pibo
  PIBO_COMPUTE_POOL_SEED_SOURCE_PI_HOME  Default: /root/.pi
  PIBO_POOL_TLS_CERTIFICATE       Enables HTTPS slot routing when paired with key
  PIBO_POOL_TLS_CERTIFICATE_KEY

Usage:
  sudo -E scripts/deployment-pool-host-setup.sh --apply [--restart-gateway]

Without --apply, the script prints the files it would manage and changes nothing.
EOF
}

apply=false
restart_gateway=false
for arg in "$@"; do
	case "$arg" in
		--apply) apply=true ;;
		--restart-gateway) restart_gateway=true ;;
		--help|-h) usage; exit 0 ;;
		*) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
	esac
done

base_url="${PIBO_COMPUTE_POOL_BASE_URL:-}"
runtime_binary="${PIBO_POOL_RUNTIME_BINARY:-}"
[[ "$base_url" =~ ^https://[A-Za-z0-9.-]+/?$ ]] || { echo "PIBO_COMPUTE_POOL_BASE_URL must be an HTTPS origin" >&2; exit 2; }
[[ "$runtime_binary" = /* && -f "$runtime_binary" ]] || { echo "PIBO_POOL_RUNTIME_BINARY must name an installed Pibo binary" >&2; exit 2; }
base_url="${base_url%/}"
base_host="${base_url#https://}"
[[ "$base_host" != *:* ]] || { echo "A port in PIBO_COMPUTE_POOL_BASE_URL is not supported by host setup" >&2; exit 2; }

pool_root="${PIBO_COMPUTE_POOL_ROOT:-/root/.pibo/compute-pool}"
slot_count="${PIBO_COMPUTE_POOL_SLOT_COUNT:-10}"
max_active="${PIBO_COMPUTE_POOL_MAX_ACTIVE:-3}"
port_base="${PIBO_COMPUTE_POOL_PORT_BASE:-5000}"
port_stride="${PIBO_COMPUTE_POOL_PORT_STRIDE:-10}"
runtime_image="${PIBO_COMPUTE_POOL_RUNTIME_IMAGE:-pibo:latest}"
seed_home="${PIBO_COMPUTE_POOL_SEED_SOURCE_HOME:-/root/.pibo}"
seed_pi_home="${PIBO_COMPUTE_POOL_SEED_SOURCE_PI_HOME:-/root/.pi}"
env_path="/etc/pibo-deployment-pool.env"
slot_env_path="/etc/pibo-deployment-pool-slot.env"
wrapper_path="/usr/local/bin/pibo-pool"
dropin_path="/etc/systemd/system/pibo-web.service.d/deployment-pool.conf"
nginx_available="/etc/nginx/sites-available/pibo-deployment-pool.conf"
nginx_enabled="/etc/nginx/sites-enabled/pibo-deployment-pool.conf"
acme_webroot="/var/lib/pibo-deployment-pool-acme"

for value in "$slot_count" "$max_active" "$port_base" "$port_stride"; do
	[[ "$value" =~ ^[0-9]+$ && "$value" -gt 0 ]] || { echo "Slot counts and ports must be positive integers" >&2; exit 2; }
done
(( max_active <= slot_count )) || { echo "PIBO_COMPUTE_POOL_MAX_ACTIVE cannot exceed slot count" >&2; exit 2; }
(( port_base + (slot_count - 1) * port_stride + 1 <= 65535 )) || { echo "Configured slot ports exceed 65535" >&2; exit 2; }

if ! $apply; then
	cat <<EOF
Dry-run only. Files that would be managed:
  $env_path
  $slot_env_path
  $wrapper_path
  $dropin_path
  $nginx_available
  $acme_webroot

Pool: $base_url
Slots: $slot_count configured, $max_active active maximum
Ports: $port_base with stride $port_stride
Runtime: $runtime_image
CLI binary: $runtime_binary

Apply with: sudo -E $0 --apply --restart-gateway
EOF
	exit 0
fi

[[ "$(id -u)" -eq 0 ]] || { echo "Host setup must run as root" >&2; exit 1; }
install -d -m 0700 "$pool_root" "$pool_root/inbox" "$pool_root/artifacts" "$pool_root/slots" "$pool_root/failures"
install -d -m 0755 "$acme_webroot/.well-known/acme-challenge"
cat > "$env_path" <<EOF
PIBO_COMPUTE_POOL_BASE_URL=$base_url
PIBO_COMPUTE_POOL_ROOT=$pool_root
PIBO_COMPUTE_POOL_SLOT_COUNT=$slot_count
PIBO_COMPUTE_POOL_MAX_ACTIVE=$max_active
PIBO_COMPUTE_POOL_PORT_BASE=$port_base
PIBO_COMPUTE_POOL_PORT_STRIDE=$port_stride
PIBO_COMPUTE_POOL_TTL_MINUTES=60
PIBO_COMPUTE_POOL_FAILED_RETENTION_MINUTES=120
PIBO_COMPUTE_POOL_MAX_FAILED_SNAPSHOTS=3
PIBO_COMPUTE_POOL_ARTIFACT_RETENTION_HOURS=24
PIBO_COMPUTE_POOL_MAX_ARTIFACTS=10
PIBO_COMPUTE_POOL_MIN_MEMORY_AVAILABLE_MB=1536
PIBO_COMPUTE_POOL_MIN_DISK_AVAILABLE_GB=10
PIBO_COMPUTE_POOL_RUNTIME_IMAGE=$runtime_image
PIBO_COMPUTE_POOL_ENV_FILE=$slot_env_path
PIBO_COMPUTE_POOL_SEED_SOURCE_HOME=$seed_home
PIBO_COMPUTE_POOL_SEED_SOURCE_PI_HOME=$seed_pi_home
PIBO_POOL_RUNTIME_BINARY=$runtime_binary
EOF
chmod 0600 "$env_path"
: > "$slot_env_path"
chmod 0600 "$slot_env_path"

cat > "$wrapper_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/pibo-deployment-pool.env
set +a
exec node "$PIBO_POOL_RUNTIME_BINARY" compute pool "$@"
EOF
chmod 0755 "$wrapper_path"

install -d -m 0755 "$(dirname "$dropin_path")"
cat > "$dropin_path" <<EOF
[Service]
EnvironmentFile=-$env_path
EOF
chmod 0644 "$dropin_path"
systemctl daemon-reload

cert="${PIBO_POOL_TLS_CERTIFICATE:-}"
key="${PIBO_POOL_TLS_CERTIFICATE_KEY:-}"
if [[ -n "$cert" || -n "$key" ]]; then
	[[ -f "$cert" && -f "$key" ]] || { echo "Both PIBO_POOL_TLS_CERTIFICATE and PIBO_POOL_TLS_CERTIFICATE_KEY must exist" >&2; exit 2; }
fi
server_names=()
map_entries=()
for ((index=1; index<=slot_count; index++)); do
	slot=$(printf 'slot-%02d' "$index")
	port=$((port_base + (index - 1) * port_stride))
	server_names+=("${slot}.${base_host}")
	map_entries+=("    ${slot}.${base_host} ${port};")
done
{
	echo 'map $host $pibo_deployment_pool_port {'
	echo '    default 0;'
	printf '%s\n' "${map_entries[@]}"
	echo '}'
	echo
	echo 'server {'
	echo '    listen 80;'
	echo '    listen [::]:80;'
	echo "    server_name ${server_names[*]};"
	echo '    location ^~ /.well-known/acme-challenge/ {'
	echo "        root $acme_webroot;"
	echo '        default_type text/plain;'
	echo '        try_files $uri =404;'
	echo '    }'
	echo '    location / {'
	if [[ -n "$cert" ]]; then
		echo '        return 301 https://$host$request_uri;'
	else
		echo '        return 503;'
	fi
	echo '    }'
	echo '}'
	if [[ -n "$cert" ]]; then
		echo
		echo 'server {'
		echo '    listen 443 ssl http2;'
		echo '    listen [::]:443 ssl http2;'
		echo "    server_name ${server_names[*]};"
		echo "    ssl_certificate $cert;"
		echo "    ssl_certificate_key $key;"
		echo '    client_max_body_size 100m;'
		echo '    proxy_buffering off;'
		echo '    proxy_read_timeout 3600s;'
		echo '    proxy_send_timeout 3600s;'
		echo '    location / {'
		echo '        if ($pibo_deployment_pool_port = 0) { return 404; }'
		echo '        proxy_http_version 1.1;'
		echo '        proxy_set_header Host $host;'
		echo '        proxy_set_header X-Forwarded-Host $host;'
		echo '        proxy_set_header X-Forwarded-Proto https;'
		echo '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'
		echo '        proxy_set_header Upgrade $http_upgrade;'
		echo '        proxy_set_header Connection "upgrade";'
		echo '        proxy_pass http://127.0.0.1:$pibo_deployment_pool_port;'
		echo '    }'
		echo '}'
	fi
} > "$nginx_available"
ln -sfn "$nginx_available" "$nginx_enabled"
nginx -t
systemctl reload nginx
if [[ -n "$cert" ]]; then
	echo "HTTPS slot routing enabled."
else
	echo "HTTP ACME challenge routing enabled; HTTPS slot routing remains disabled until a certificate is supplied."
fi

if $restart_gateway; then
	pibo gateway web restart
fi

"$wrapper_path" doctor
printf 'Deployment pool host configured: %s\n' "$base_url"
