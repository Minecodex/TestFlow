FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.4 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/src ./src
RUN uv sync --frozen --no-dev --no-editable && useradd --uid 10001 --create-home testflow
ENV PATH="/app/.venv/bin:$PATH" TESTFLOW_DATA_DIR=/data
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "testflow.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
