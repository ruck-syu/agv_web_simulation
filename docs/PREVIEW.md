# Temporary public preview

Replace the placeholder `wss://<your-tunnel-host>/rosbridge` below with the hostname printed by **your own** tunnel run. No live public URL is committed to this repository: a TryCloudflare Quick Tunnel is temporary and its hostname changes whenever the tunnel is recreated.

The static production build is served by the optional Compose `preview` service (Nginx) on port 4174 and published by the `agv-preview-tunnel` Docker container. Nginx proxies `/rosbridge` directly to `simulation:9090`, so remote visitors do not connect to their own localhost. Both preview and tunnel use `restart: unless-stopped`. The tunnel uses HTTP/2 to avoid the QUIC connection timeouts seen on this network.

Keep this Mac awake, Docker and the ROS simulation running. This is a temporary Quick Tunnel; recreating the tunnel produces a new URL. Stop it with `rtk proxy docker stop agv-preview-tunnel`.

The current build was created with:

```bash
cd frontend
rtk proxy env VITE_ROSBRIDGE_URL=wss://<your-tunnel-host>/rosbridge npm run build
cd ..
rtk proxy docker compose --profile preview up -d --no-build preview
```

Restart the existing preview and tunnel from the project root:

```bash
rtk proxy docker compose --profile preview restart preview
rtk proxy docker restart agv-preview-tunnel
rtk proxy docker logs --tail 30 agv-preview-tunnel
```

Read the latest hostname in the logs after a tunnel restart; if it changes, rebuild with that hostname. To recreate a missing tunnel on this project's default Compose network:

```bash
rtk proxy docker run -d --name agv-preview-tunnel --restart unless-stopped \
  --network agv_web_simulation_default cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --protocol http2 --url http://preview:80
```

The network name follows the Compose project name; inspect `docker network ls` if the project directory/name differs. Do not start Vite preview while the Docker preview owns port 4174.

A normal `npm run build` restores the default local ROS endpoint in the generated frontend.
