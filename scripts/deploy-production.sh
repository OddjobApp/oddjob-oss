#!/bin/bash
# Production Deployment Script
# Updates the Compose application while keeping data services running.

set -euo pipefail

# Configuration
APP_NAME="oddjob"
DOCKER_REGISTRY="ghcr.io"
GITHUB_REPO="${GITHUB_REPOSITORY:-oddjobapp/oddjob}"
BACKUP_DIR="./backups"
LOG_DIR="./logs"
ROLLBACK_TAG=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Pre-deployment checks
pre_deployment_checks() {
    log_info "Running pre-deployment checks..."

    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running"
        exit 1
    fi

    # Check if docker-compose files exist
    if [[ ! -f "docker-compose.prod.yml" ]]; then
        log_error "docker-compose.prod.yml not found"
        exit 1
    fi

    # Compose validates required variables from both the environment and .env.
    docker compose -f docker-compose.prod.yml config --quiet

    # Create necessary directories
    mkdir -p "$BACKUP_DIR" "$LOG_DIR"

    log_success "Pre-deployment checks passed"
}

# Database backup
backup_database() {
    log_info "Creating database backup..."

    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/oddjob_prod_$timestamp.sql"

    # Use the existing database container; Compose prefixes network names.
    docker compose -f docker-compose.prod.yml exec -T db \
        sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_file"

    if [[ $? -eq 0 ]]; then
        log_success "Database backup created: $backup_file"
        echo "$backup_file" > "$BACKUP_DIR/latest_backup.txt"
    else
        log_error "Database backup failed"
        exit 1
    fi
}

# Pull latest images
pull_images() {
    log_info "Pulling latest Docker images..."

    # Save the running image before pulling a mutable tag such as latest.
    local container_id
    container_id=$(docker compose -f docker-compose.prod.yml ps -q oddjob)
    if [[ -n "$container_id" ]]; then
        local previous_image
        previous_image=$(docker inspect --format '{{.Image}}' "$container_id")
        ROLLBACK_TAG="rollback-$(date +%Y%m%d%H%M%S)"
        docker tag "$previous_image" "$DOCKER_REGISTRY/$GITHUB_REPO:$ROLLBACK_TAG"
    fi

    # Pull other service images
    docker compose -f docker-compose.prod.yml pull

    log_success "Docker images pulled successfully"
}

# Health check function
check_service_health() {
    local service=$1
    local max_attempts=30
    local attempt=1

    log_info "Checking health of $service..."

    while [[ $attempt -le $max_attempts ]]; do
        if docker compose -f docker-compose.prod.yml exec -T "$service" \
            curl -fsS http://localhost:5000/api/health >/dev/null 2>&1; then
            log_success "$service is healthy"
            return 0
        fi

        log_info "Waiting for $service to be healthy (attempt $attempt/$max_attempts)..."
        sleep 10
        ((attempt++))
    done

    log_error "$service failed health check after $max_attempts attempts"
    return 1
}

# Deploy application
deploy_application() {
    log_info "Starting deployment..."

    # Keep the database and queues available during migration and rollback.
    docker compose -f docker-compose.prod.yml up -d --wait db redis qdrant prometheus grafana
    docker compose -f docker-compose.prod.yml run --rm migrate

    log_info "Starting new containers..."
    # Roll back both a recreation failure and an unhealthy new application.
    if ! docker compose -f docker-compose.prod.yml up -d --no-deps oddjob worker || \
       ! check_service_health "oddjob"; then
        log_error "Deployment failed - service not healthy"
        rollback_deployment
        exit 1
    fi

    docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate nginx

    log_success "Deployment completed successfully"
}

# Rollback deployment
rollback_deployment() {
    log_warning "Rolling back deployment..."

    if [[ -z "$ROLLBACK_TAG" ]]; then
        log_error "No previous application image is available for rollback"
        return 1
    fi

    # Schema changes must be backward-compatible. Do not overwrite live data
    # with the pre-deploy backup as part of an application rollback.
    GITHUB_REPOSITORY="$GITHUB_REPO" IMAGE_TAG="$ROLLBACK_TAG" \
        docker compose -f docker-compose.prod.yml up -d --no-deps oddjob worker
    check_service_health "oddjob"
    docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate nginx

    log_warning "Rollback completed"
}

# Post-deployment tasks
post_deployment_tasks() {
    log_info "Running post-deployment tasks..."

    # Redis holds durable queues and sessions as well as caches; preserve it.

    log_success "Post-deployment tasks completed"
}

# Send deployment notification
send_deployment_notification() {
    local status=$1
    local webhook_url=${DEPLOYMENT_WEBHOOK_URL:-}

    if [[ -n "$webhook_url" ]]; then
        local payload=$(cat <<EOF
{
    "text": "Oddjob Production Deployment $status",
    "attachments": [
        {
            "color": "$([[ "$status" == "success" ]] && echo "good" || echo "danger")",
            "fields": [
                {"title": "Environment", "value": "Production", "short": true},
                {"title": "Timestamp", "value": "$(date)", "short": true},
                {"title": "Version", "value": "${GITHUB_SHA:-unknown}", "short": true}
            ]
        }
    ]
}
EOF
        )

        curl -X POST -H 'Content-type: application/json' \
             --data "$payload" "$webhook_url" || true
    fi
}

# Cleanup old resources
cleanup_old_resources() {
    log_info "Cleaning up old Docker resources..."

    # Remove unused images
    docker image prune -f

    # Remove old backups (keep last 10)
    ls -t "$BACKUP_DIR"/*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f

    log_success "Cleanup completed"
}

# Main deployment function
main() {
    log_info "Starting Oddjob production deployment"

    # Trap for cleanup on error
    trap 'log_error "Deployment failed"; send_deployment_notification "failed"' ERR

    pre_deployment_checks
    backup_database
    pull_images
    deploy_application
    post_deployment_tasks
    cleanup_old_resources

    log_success "🎉 Production deployment completed successfully!"
    send_deployment_notification "success"
}

# Run main function
main "$@"
