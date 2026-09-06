# Same-host ingress (demo only)

Two ways to reach products on one machine. Neither is production TLS.

## Daily — per-product host ports

Leave this directory unused. Each product `docker-compose.dev.yml` publishes its own ports:

| Product | Host |
|---|---|
| VistaCast API | `http://127.0.0.1:13100` |
| SyncroBrain Gateway | `http://127.0.0.1:13200` |
| DoerFlow API | `http://127.0.0.1:13008` |
| VistaRemote server | `http://127.0.0.1:3000` (`/intervention/:token`) |
| Entitlement | `http://127.0.0.1:3040` |

Container-to-container still uses Docker DNS on `luminary-control-edge`, never `host.docker.internal` and never `localhost` inside a container. See `../agent-commerce/peers.env.example`.

## Demo — one Caddy by hostname

After `pnpm --dir ../.. scenario:up -- agent-commerce --with-control-plane` (or smart-site):

```bash
printf '127.0.0.1 vistacast.lw.local syncrobrain.lw.local doerflow.lw.local remote.lw.local\n' | sudo tee -a /etc/hosts
cp env.example env   # gitignored
docker compose --env-file env -f compose.yml up -d
```

Browse `http://vistacast.lw.local:8080` (bind is loopback by default). HTTP only — **not** Let's Encrypt. VistaCast also ships its own per-product Caddy (`deploy/caddy/Caddyfile.example`, compose profile `ingress`); use that when VistaCast is the only public hostname.

Product APIs must have joined `luminary-control-edge` (`CONTROL_PLANE_EDGE_NETWORK_EXTERNAL=true` on the control-plane overlay). This project does not merge their Compose files.
