#!/bin/sh
set -e

echo "Running Alembic migrations..."
alembic upgrade head
echo "Migrations done. Starting server..."

exec "$@"
