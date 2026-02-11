#!/usr/bin/env bash
set -euo pipefail
URL="https://scontent-iad4-1.choicecdn.com/-/rs:fit:1200:1200/f:best/aHR0cHM6Ly9tYWdpYy5kZWNlbnRyYWxpemVkLWNvbnRlbnQuY29tL2lwZnMvYmFmeWJlaWUzcjNoYzRlNDdseDI0ZDJvZm5zYW01NWRnYXhyN2lkbjRmcmQzZmNqbmszdGR1bm5xazQ="

printf "\n# no referer\n"
curl -I -L "$URL" | sed -n '1,20p'

printf "\n# with referer\n"
curl -I -L -H 'Referer: http://localhost:3000/' "$URL" | sed -n '1,20p'
