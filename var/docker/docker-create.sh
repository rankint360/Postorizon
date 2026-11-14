#!/usr/bin/env bash

# The app container's only published port is nginx's 5000 — the backend
# (:3000) and frontend (:4200) are internal and reached through nginx.
# The previous version published 3000/4200 and never exposed the app
# (deployment gap D4, fixed in the deployment-prep pass). Host port 4007
# matches what docker-compose.yaml publishes.
docker kill postiz || true
docker rm postiz || true
docker create --name postiz -p 4007:5000 localhost/postiz
