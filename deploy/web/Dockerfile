# Frontend web de AUDIT SOUND (nginx sirviendo la página estática).
# Contexto de build = raíz del repo.
FROM nginx:1.27-alpine
COPY web/ /usr/share/nginx/html/
COPY deploy/web/entrypoint.sh /docker-entrypoint.d/40-audit-sound-config.sh
RUN chmod +x /docker-entrypoint.d/40-audit-sound-config.sh
EXPOSE 80
# nginx:alpine ya trae un ENTRYPOINT que ejecuta los scripts de /docker-entrypoint.d
