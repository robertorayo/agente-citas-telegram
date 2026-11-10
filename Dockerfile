# 1) Compila el panel de React.
FROM node:22-alpine AS panel
WORKDIR /panel
COPY panel/package.json panel/package-lock.json ./
RUN npm ci
COPY panel/ ./
RUN npm run build

# 2) Backend de Python con uv.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir uv==0.13.7
WORKDIR /app/backend
# Primero solo las dependencias, para que Docker las reutilice si no cambian.
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=panel /panel/dist /app/panel/dist

# El hosting indica el puerto en PORT.
ENV HOST=0.0.0.0
RUN useradd --create-home app && chown -R app /app
USER app
CMD [".venv/bin/agente-citas"]
