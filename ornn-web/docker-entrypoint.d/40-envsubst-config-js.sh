#!/bin/sh
# Generate /usr/share/nginx/html/config.js from its template at container
# startup, substituting ornn-web's runtime config env vars. Sister script
# to the image's own 20-envsubst-on-templates.sh (which only handles
# /etc/nginx/templates/*.template for nginx config).
set -eu

ME=$(basename "$0")
entrypoint_log() {
    if [ -z "${NGINX_ENTRYPOINT_QUIET_LOGS:-}" ]; then
        echo "$ME: $*"
    fi
}

template="/usr/share/nginx/html/config.js.template"
output="/usr/share/nginx/html/config.js"

if [ ! -f "$template" ]; then
    entrypoint_log "info: $template not found, skipping"
    exit 0
fi

entrypoint_log "info: rendering $output from $template"

envsubst '${API_BASE_URL} ${NYXID_AUTHORIZE_URL} ${NYXID_TOKEN_URL} ${NYXID_CLIENT_ID} ${NYXID_REDIRECT_URI} ${NYXID_LOGOUT_URL} ${NYXID_SETTINGS_URL}' \
    < "$template" > "$output"

# Drop the template so it isn't served publicly.
rm -f "$template"
