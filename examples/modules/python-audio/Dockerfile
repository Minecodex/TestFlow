FROM python:3.13-slim
RUN pip install --no-cache-dir fastapi==0.143.0 uvicorn==0.54.0 websockets==16.0 httpx==0.28.1
WORKDIR /app
COPY module.py manifest.json ./
COPY schemas ./schemas
USER 10001:10001
ENTRYPOINT ["python", "module.py"]
