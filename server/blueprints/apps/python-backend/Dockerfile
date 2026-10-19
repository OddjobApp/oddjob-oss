FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["python", "main.py"]
