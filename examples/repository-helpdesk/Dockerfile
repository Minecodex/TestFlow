FROM python:3.13-slim-bookworm
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y --no-install-recommends espeak-ng ffmpeg tesseract-ocr tesseract-ocr-eng \
    && rm -f /usr/share/tesseract-ocr/5/tessdata/osd.traineddata
RUN pip install --no-cache-dir fastapi==0.143.0 uvicorn==0.54.0 websockets==16.0 httpx==0.28.1 pocketsphinx==5.1.1
WORKDIR /app
COPY examples/scenarios/tiny-helpdesk/prepare_models.py ./
RUN python prepare_models.py
COPY examples/scenarios/tiny-helpdesk/service.py ./service.py
COPY examples/repository-helpdesk/adapter.py ./processors.py
ARG MODULE
COPY examples/repository-helpdesk/packages/${MODULE}/manifest.json ./manifest.json
COPY examples/repository-helpdesk/packages/${MODULE}/schemas ./schemas
USER 10001:10001
ENTRYPOINT ["python", "service.py"]
