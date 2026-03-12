#!/bin/bash
echo "Packaging Software City for local development..."
pnpm install
pnpm run build
if [ ! -f .env ]; then
  cp .env.template .env
  echo ""
  echo "Created .env from template. Please fill in your API keys:"
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo "  GROQ_API_KEY=gsk_..."
  echo "  DATABASE_URL=postgresql://..."
fi
echo ""
echo "Setup complete. To run locally:"
echo "  node artifacts/api-server/dist/index.js"
echo "  cd artifacts/software-city && pnpm preview"
