FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .
RUN mkdir -p /app/jobs /app/outputs

ENV PULSEREEL_WORKER_JOBS_DIR=/app/jobs
ENV PULSEREEL_WORKER_OUTPUT_DIR=/app/outputs

EXPOSE 8000
CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8000"]
