#!/bin/bash
# Nuntius CI チェック (ローカル & GitHub Actions 共通)
set -e

echo "=== [1/4] Backend Build (type check) ==="
npm run build

echo ""
echo "=== [2/4] Backend Tests ==="
npm test

if [ -d "frontend" ]; then
  # CI 環境では root の npm ci しか走らないため、frontend の依存もここで入れる
  if [ ! -d "frontend/node_modules" ]; then
    echo ""
    echo "=== Installing frontend deps (npm ci) ==="
    (cd frontend && npm ci)
  fi

  echo ""
  echo "=== [3/4] Frontend Lint ==="
  (cd frontend && npm run lint)

  echo ""
  echo "=== [4/4] Frontend Build ==="
  (cd frontend && npm run build)
fi

echo ""
echo "=== All CI checks passed ==="
