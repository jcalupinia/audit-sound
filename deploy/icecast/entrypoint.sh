#!/bin/sh
set -eu
: "${ICECAST_SOURCE_PASSWORD:?falta ICECAST_SOURCE_PASSWORD}"
: "${ICECAST_ADMIN_PASSWORD:?falta ICECAST_ADMIN_PASSWORD}"
export ICECAST_HOSTNAME="${ICECAST_HOSTNAME:-localhost}"
export ICECAST_MAX_CLIENTS="${ICECAST_MAX_CLIENTS:-50}"

envsubst < /etc/icecast2/icecast.xml.template > /etc/icecast2/icecast.xml
echo "Icecast arrancando (hostname=${ICECAST_HOSTNAME}, max_clients=${ICECAST_MAX_CLIENTS})"
# icecast se ejecuta como root y baja privilegios a icecast2 vía <changeowner>.
exec icecast2 -c /etc/icecast2/icecast.xml
