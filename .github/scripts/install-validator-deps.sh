#!/usr/bin/env bash
set -euo pipefail

echo "🚀 brikpipe.build.yml validator dependency bootstrap"
echo "📂 Working directory: $(pwd)"

if [[ -f "package.json" ]]; then
  echo "📦 package.json found — running npm ci..."
  npm ci
  exit 0
fi

echo "ℹ️ No package.json found — creating minimal one for AJV validator..."

cat > package.json <<'EOF'
{
  "name": "brikbyte-github-meta",
  "private": true,
  "type": "module",
  "dependencies": {
    "ajv": "^8.17.0",
    "ajv-formats": "^3.0.1",
    "yaml": "^2.6.0"
  }
}
EOF

echo "📦 Installing validator dependencies..."
npm install

echo "✅ Validator dependencies installed."
