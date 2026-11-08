# AUDIT SOUND · Agente DJ. Despliegue autorizado por el dueño (2026-11-07): ver deploy/DESPLEGAR_AGENTE_DJ.md.
# Sin secretos en la imagen:
# todo se configura por variables de entorno en tiempo de ejecución (ver .env.example).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/dj-agent

COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade "pip>=26.2" && pip install --no-cache-dir "fastapi==0.162.2" "pydantic==2.10.4" "uvicorn==0.34.0" \
        "httpx==0.28.1" "websockets==14.1"

COPY app ./app

RUN useradd --create-home --uid 10001 agent && mkdir -p /data && chown agent /data
USER agent

ENV DJ_AGENT_DB_PATH=/data/dj_agent.db
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8790/api/v1/dj-agent/health')"
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8790"]
