FROM python:3.13-slim
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get -o Acquire::Retries=5 update && \
    apt-get -o Acquire::Retries=5 install -y --no-install-recommends git ffmpeg openssh-client
COPY --from=ghcr.io/astral-sh/uv:0.9.4 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/src ./src
COPY server/alembic.ini ./alembic.ini
COPY server/migrations ./migrations
COPY deploy/k8s/base ./deploy/k8s/base
COPY scripts/render-kubernetes.py scripts/kubernetes_installation.py ./scripts/
RUN uv sync --frozen --no-dev --no-editable && useradd --uid 10001 --create-home testflow
ENV PATH="/app/.venv/bin:$PATH" TESTFLOW_DATA_DIR=/data
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "testflow.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
