#!/bin/bash

set -o xtrace

# Dockerfile.dev is a SINGLE-STAGE Dockerfile: it builds the whole
# monorepo and runs everything in one container. The previous version of
# this script passed `--target dist` / `--target devcontainer` — stages
# that do not exist in Dockerfile.dev — and failed as written
# (deployment gap D3, fixed in the deployment-prep pass).
docker rmi localhost/postiz || true
docker build -t localhost/postiz -f Dockerfile.dev .
