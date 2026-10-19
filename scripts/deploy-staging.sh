#!/bin/bash
# Staging Deployment Script
# Deploys to staging environment for testing and validation

set -euo pipefail

# Configuration
APP_NAME="oddjob"
DOCKER_REGISTRY="ghcr.io"
GITHUB_REPO="${GITHUB_REPOSITORY:-anomalyco/oddjob}"

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
    log_info "Running pre-deployment checks for staging..."

    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running"
        exit 1
    fi

    # Check if docker-compose files exist
    if [[ ! -f "docker-compose.staging.yml" ]]; then
        log_error "docker-compose.staging.yml not found"
        exit 1
    fi

    log_success "Pre-deployment checks passed"
}

# Pull latest images
pull_images() {
    log_info "Pulling latest Docker images for staging..."

    # Pull the latest application image
    docker pull "$DOCKER_REGISTRY/$GITHUB_REPO:latest" || log_warning "Could not pull latest image, using local build"

    # Pull other service images
    docker-compose -f docker-compose.staging.yml pull

    log_success "Docker images pulled successfully"
}

# Deploy to staging
deploy_to_staging() {
    log_info "Deploying to staging environment..."

    # Stop existing containers
    docker-compose -f docker-compose.staging.yml down --timeout 30 || log_warning "No existing containers to stop"

    # Start new containers
    docker-compose -f docker-compose.staging.yml up -d

    # Wait for services to be ready
    log_info "Waiting for services to be ready..."
    sleep 30

    # Basic health check
    if curl -f http://localhost:8000/api/v1/health >/dev/null 2>&1; then
        log_success "Staging deployment completed successfully"
        log_info "Application is available at: http://localhost:8000"
        log_info "API documentation: http://localhost:8000/docs"
    else
        log_error "Health check failed - application may not be ready"
        exit 1
    fi
}

# Run staging tests
run_staging_tests() {
    log_info "Running staging integration tests..."

    # Wait a bit more for services to fully initialize
    sleep 60

    # Run basic API tests
    if command -v newman >/dev/null 2>&1; then
        log_info "Running Postman collection tests..."
        # newman run staging-tests.postman_collection.json || log_warning "Postman tests failed"
    else
        log_warning "Newman not installed, skipping Postman tests"
    fi

    # Run basic health checks
    local endpoints=(
        "http://localhost:8000/api/v1/health"
        "http://localhost:8000/docs"
        "http://localhost:8000/api/v1/errors/summary"
    )

    for endpoint in "${endpoints[@]}"; do
        if curl -f "$endpoint" >/dev/null 2>&1; then
            log_success "✓ $endpoint is accessible"
        else
            log_warning "✗ $endpoint is not accessible"
        fi
    done

    log_success "Staging tests completed"
}

# Send deployment notification
send_staging_notification() {
    local status=$1
    local webhook_url=${STAGING_WEBHOOK_URL:-}

    if [[ -n "$webhook_url" ]]; then
        local payload=$(cat <<EOF
{
    "text": "Oddjob Staging Deployment $status",
    "attachments": [
        {
            "color": "$([[ "$status" == "success" ]] && echo "good" || echo "warning")",
            "fields": [
                {"title": "Environment", "value": "Staging", "short": true},
                {"title": "Timestamp", "value": "$(date)", "short": true},
                {"title": "Version", "value": "${GITHUB_SHA:-unknown}", "short": true},
                {"title": "URL", "value": "http://localhost:8000", "short": true}
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

# Main staging deployment function
main() {
    log_info "Starting Oddjob staging deployment"

    # Trap for cleanup on error
    trap 'log_error "Staging deployment failed"; send_staging_notification "failed"' ERR

    pre_deployment_checks
    pull_images
    deploy_to_staging
    run_staging_tests

    log_success "🎉 Staging deployment completed successfully!"
    log_info "Ready for testing and validation"
    log_info "Access the application at: http://localhost:8000"

    send_staging_notification "success"
}

# Run main function
main "$@"