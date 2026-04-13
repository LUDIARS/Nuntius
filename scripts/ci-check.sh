#!/bin/bash
# Nuntius CI チェック (ローカル & GitHub Actions 共通)
set -e

echo "=== [1/2] Build (type check) ==="
npm run build

echo ""
echo "=== [2/2] Tests ==="
npm test

echo ""
echo "=== All CI checks passed ==="
