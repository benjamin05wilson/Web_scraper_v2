#!/bin/bash

echo "🛑 Stopping containers..."
docker compose down

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building project..."
npm run build

echo "🚀 Rebuilding and starting containers..."
docker compose up -d --build

echo "✅ Done! Checking container status..."
docker compose ps
