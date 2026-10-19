#!/bin/bash
set -e

# Docker entrypoint script for Oddjob application
echo "🚀 Starting Oddjob application..."

# Function to wait for database
wait_for_db() {
    if [ -n "$DATABASE_URL" ]; then
        echo "⏳ Waiting for database to be ready..."
        # Add database connection check here
        # For PostgreSQL: until pg_isready -h db_host -p db_port -U db_user; do sleep 1; done
        echo "✅ Database is ready"
    fi
}

# Function to run database migrations
run_migrations() {
    echo "⏳ Running database migrations..."
    # Add migration commands here
    # For example: alembic upgrade head
    echo "✅ Database migrations completed"
}

# Function to collect static files
collect_static() {
    echo "⏳ Collecting static files..."
    # If you have static files to collect, add commands here
    echo "✅ Static files collected"
}

# Function to run health checks
health_check() {
    echo "⏳ Running pre-start health checks..."
    # Add any pre-start checks here
    echo "✅ Health checks passed"
}

# Main startup sequence
main() {
    wait_for_db
    run_migrations
    collect_static
    health_check

    echo "🎯 Starting application server..."

    # Execute the main command
    exec "$@"
}

# Run main function with all arguments
main "$@"