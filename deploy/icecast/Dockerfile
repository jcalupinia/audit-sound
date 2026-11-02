# Icecast para AUDIT SOUND. Config desde variables de entorno (envsubst).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      icecast2 gettext-base ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY deploy/icecast/icecast.xml.template /etc/icecast2/icecast.xml.template
COPY deploy/icecast/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /var/log/icecast2 \
 && chown -R icecast2:icecast /var/log/icecast2
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
