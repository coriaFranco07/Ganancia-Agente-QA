#!/usr/bin/env bash
# =============================================================================
#  AUDITORIA GANANCIAS - Script de inicio completo
#  MongoDB   → localhost:27017  (Docker)
#  Backend   → http://localhost:8001/api  (NestJS)
#  Frontend  → http://localhost:4200      (Angular)
# =============================================================================

set -euo pipefail

# ──────────────────────────────────────────────
# Colores
# ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend-node"
FRONTEND_DIR="$SCRIPT_DIR/frontend-angular"
LOG_DIR="$SCRIPT_DIR/.logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PID_FILE="$LOG_DIR/pids.txt"

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
banner() {
  echo -e "\n${BOLD}${CYAN}"
  echo "╔══════════════════════════════════════════════╗"
  echo "║       AUDITORIA GANANCIAS  ·  Startup        ║"
  echo "╚══════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

check_deps() {
  if ! command -v node &>/dev/null; then
    error "Node.js no está instalado. Instalalo desde https://nodejs.org"
    exit 1
  fi
  success "Node $(node -v) / npm $(npm -v)"

  if ! command -v docker &>/dev/null; then
    error "Docker no está instalado. Instalalo desde https://docs.docker.com/get-docker/"
    exit 1
  fi
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

ensure_env() {
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    warn "No existe $BACKEND_DIR/.env — copiando desde .env.example..."
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    success ".env creado. Revisá las variables en backend-node/.env si es necesario."
  else
    success ".env del backend encontrado."
  fi
}

install_deps() {
  local dir="$1" name="$2"
  if [ ! -d "$dir/node_modules" ]; then
    info "Instalando dependencias de $name..."
    npm install --prefix "$dir" --silent
    success "Dependencias de $name instaladas."
  else
    info "node_modules de $name → OK"
  fi
}

start_mongodb() {
  echo -e "\n${BOLD}▶  MongoDB${RESET} (Docker)"

  # ¿Ya está corriendo el contenedor?
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "auditoria-ganancias-mongodb"; then
    success "MongoDB ya está corriendo."
    return
  fi

  # ¿Existe detenido?
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "auditoria-ganancias-mongodb"; then
    info "Contenedor existe pero está detenido. Iniciando..."
    docker start auditoria-ganancias-mongodb
  else
    info "Levantando MongoDB con docker compose..."
    docker compose -f "$BACKEND_DIR/docker-compose.mongodb.yml" up -d
  fi

  # Esperar que MongoDB responda
  info "Esperando que MongoDB esté listo..."
  local i=0
  until docker exec auditoria-ganancias-mongodb mongosh --eval "db.adminCommand('ping')" &>/dev/null; do
    sleep 2
    i=$((i + 1))
    if [ "$i" -ge 20 ]; then
      error "MongoDB no respondió a tiempo. Revisá Docker."
      exit 1
    fi
  done
  success "MongoDB listo en localhost:27017"
}

kill_port() {
  local port="$1"
  local pid
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    warn "Puerto $port ocupado (PID $pid). Liberando..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
}

wait_for_port() {
  local port="$1" name="$2"
  local i=0
  info "Esperando que $name esté listo en :$port ..."
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 2
    i=$((i + 1))
    if [ "$i" -ge 45 ]; then
      warn "$name tardó demasiado. Revisá: .logs/$(echo "$name" | tr '[:upper:]' '[:lower:]').log"
      return
    fi
  done
  success "$name listo → http://localhost:$port"
}

stop_all() {
  echo -e "\n${YELLOW}Deteniendo servicios...${RESET}"
  if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
      kill "$pid" 2>/dev/null && info "Proceso $pid detenido." || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo -e "${CYAN}MongoDB sigue corriendo en Docker (detenerlo manualmente si es necesario):${RESET}"
  echo "  docker stop auditoria-ganancias-mongodb"
  echo -e "${GREEN}¡Hasta luego!${RESET}"
}

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
main() {
  banner
  trap stop_all SIGINT SIGTERM
  mkdir -p "$LOG_DIR"
  > "$PID_FILE"

  check_deps
  ensure_env
  install_deps "$BACKEND_DIR"  "Backend"
  install_deps "$FRONTEND_DIR" "Frontend"

  start_mongodb

  kill_port 8001
  kill_port 4200

  # ── Backend ──────────────────────────────────
  echo -e "\n${BOLD}▶  Iniciando Backend${RESET} (NestJS · :8001)"
  npm run --prefix "$BACKEND_DIR" start:dev > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" >> "$PID_FILE"
  info "Backend PID: $BACKEND_PID  |  Log: .logs/backend.log"

  # ── Frontend ─────────────────────────────────
  echo -e "\n${BOLD}▶  Iniciando Frontend${RESET} (Angular · :4200)"
  npm start --prefix "$FRONTEND_DIR" > "$FRONTEND_LOG" 2>&1 &
  FRONTEND_PID=$!
  echo "$FRONTEND_PID" >> "$PID_FILE"
  info "Frontend PID: $FRONTEND_PID  |  Log: .logs/frontend.log"

  wait_for_port 8001 "Backend"
  wait_for_port 4200 "Frontend"

  # ── Resumen ───────────────────────────────────
  echo -e "\n${BOLD}${GREEN}"
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │  🚀  Servicios activos                      │"
  echo "  │                                             │"
  echo "  │  🍃 MongoDB   →  localhost:27017 (Docker)   │"
  echo "  │  ⚙️  Backend  →  http://localhost:8001/api  │"
  echo "  │  🅰️  Frontend →  http://localhost:4200      │"
  echo "  │                                             │"
  echo "  │  Logs: .logs/backend.log                    │"
  echo "  │        .logs/frontend.log                   │"
  echo "  │                                             │"
  echo "  │  Presioná Ctrl+C para detener               │"
  echo "  └─────────────────────────────────────────────┘"
  echo -e "${RESET}"

  wait "$BACKEND_PID" "$FRONTEND_PID"
}

main "$@"
