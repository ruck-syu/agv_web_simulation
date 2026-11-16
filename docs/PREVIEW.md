# Temporary public preview

https://replies-arguments-because-nova.trycloudflare.com

Verified HTTPS page loading and live `/odom` over the secure `/rosbridge` WebSocket.

The static production build is served by Vite preview on port 4174 and published by the `agv-preview-tunnel` Docker container. The preview proxies `/rosbridge` to the local ROS bridge on port 9090, so remote visitors do not connect to their own localhost.

Keep this Mac, Docker, the ROS simulation, and the preview server running. This is a temporary Quick Tunnel; recreating the tunnel produces a new URL. Stop it with `rtk proxy docker stop agv-preview-tunnel`.

The current build was created with:

```bash
cd frontend
rtk proxy env VITE_ROSBRIDGE_URL=wss://replies-arguments-because-nova.trycloudflare.com/rosbridge npm run build
rtk npm run preview
```

A normal `npm run build` restores the default local ROS endpoint in the generated frontend.
