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

envsubst '${ORNN_API_BASE_URL} ${NYXID_API_BASE_URL} ${NYXID_WEB_BASE_URL} ${NYXID_OAUTH_AUTHORIZE_PATH} ${NYXID_OAUTH_TOKEN_PATH} ${NYXID_OAUTH_REDIRECT_PATH} ${NYXID_LOGOUT_PATH} ${NYXID_SETTINGS_PATH} ${NYXID_OAUTH_CLIENT_ID} ${POSTHOG_API_KEY} ${POSTHOG_PROJECT_ID} ${POSTHOG_HOST}' \
    < "$template" > "$output"

# Drop the template so it isn't served publicly.
rm -f "$template"
