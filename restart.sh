#!/bin/bash
set -e

echo "Restart started at: $(date)"

echo "Pulling latest changes..."
git pull

echo "Installing dependencies..."
npm install

echo "Building frontend..."
npm run build

echo "Restarting PM2..."
pm2 restart ecosystem.config.cjs || pm2 start ecosystem.config.cjs

echo "Done!"
