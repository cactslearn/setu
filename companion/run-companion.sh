#!/bin/sh
DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
cd "$DIR"
if [ ! -f "./config.json" ] && [ -f "./config.example.json" ]; then
    cp "./config.example.json" "./config.json"
fi
if [ -f "./setu-companion" ]; then
    chmod +x ./setu-companion
    exec ./setu-companion "$@"
else
    exec node setu-companion.js "$@"
fi