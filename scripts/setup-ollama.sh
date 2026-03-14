#!/bin/bash

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Software City — Ollama Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
  echo "Installing Ollama…"
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "✓ Ollama already installed: $(ollama --version)"
fi

echo ""
echo "Checking system resources…"
# (Optional: Add RAM/VRAM check here)

echo ""
echo "Pulling models (this takes a few minutes)…"
echo ""
# Fast model for dialogue (3.8GB — works on 8GB RAM minimum)
echo "► Pulling deepseek-coder:6.7b (fast dialogue)…"
ollama pull deepseek-coder:6.7b

echo ""
echo "► Do you have 16GB+ RAM? Pull the better model? (y/n)"
read -r answer
if [[ "$answer" == "y" ]]; then
  echo "► Pulling deepseek-coder-v2:16b (best quality)…"
  ollama pull deepseek-coder-v2:16b
fi

echo ""
echo "✓ Setup complete. Models available:"
ollama list

echo ""
echo "Start Ollama server: ollama serve"
echo "Then start Software City: pnpm dev"
