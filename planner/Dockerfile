# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY planner/frontend/package.json planner/frontend/package-lock.json ./
RUN npm ci
COPY planner/frontend/ ./
RUN npm run build

# Stage 2: Python backend + serve built frontend
FROM python:3.12-slim
WORKDIR /app

# Build tools needed for lupa (LuaJIT compilation)
RUN apt-get update && apt-get install -y --no-install-recommends gcc make libc6-dev && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY planner/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY planner/backend/ ./

# Copy built frontend into static directory
COPY --from=frontend-build /app/frontend/dist ./static

# Copy entrypoint (handles SRTM prefetch on first run only)
COPY planner/entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
