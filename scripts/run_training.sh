#!/bin/bash
#
# This script provides a simple way to run the world model training process.
# It is intended to be run periodically by a cron job or a CI/CD pipeline.

# Navigate to the script's directory
cd "$(dirname "$0")"

# Navigate to the project root
cd ..

# Run the training script
echo "Starting world model training..."
python scripts/train_world_model.py
echo "Training complete."
