# Production computer-use desktops

The API and worker use `TRYCUA_PROVIDER=cua` and
`TRYCUA_PROVIDER_TYPE=org_desktop`. Set `TRYCUA_DESKTOP_BROKER_SOCKET` to the
mounted private Unix socket, `TRYCUA_DESKTOP_HOST` to the host's private bridge
address, and `TRYCUA_IMAGE` to the exact image configured in the broker.

Run `broker.py` as a host service with a root-owned JSON configuration containing
`socket`, `group` (the API container's group), `host`, `image` (immutable digest),
and `boot` (the reviewed `DESKTOP_BOOT_COMMAND` array). Mount only the broker
socket directory into the API/worker. Do not mount the Docker socket.

The broker reconstructs desktop creation from fixed settings: one named desktop
and home volume per positive organization ID, 2 GiB RAM, one CPU, and no host
directory mounts. It permits only desktop lifecycle/status/port operations and
the fixed Chromium launch command. It cannot build images or change networks.
Images and the `oddjob-desktops` network must be provisioned by the operator.

The network must disable inter-container communication and firewall desktop
egress to private/link-local networks (including instance metadata) and the host.
Viewer/API/CDP ports bind only to a private bridge address. Restrict access to
those ports to the application network and host; expose the viewer through
Oddjob's existing authentication, organization membership and one-use ticket
proxy. Do not expose desktop ports in the AWS security group.

The broker uses public DNS resolvers so blocking private-network egress does not
break browser name resolution. Set `CUA_TELEMETRY_ENABLED=false` on the API and
worker; desktop containers also disable Cua telemetry. Preserve the broker's
runtime directory across service restarts (`RuntimeDirectoryPreserve=yes`) so
containers keep their mounted socket directory.

The desktop Dockerfile pins its XFCE base and installs computer-server 0.3.46
with FastAPI 0.115.12 in a separate environment. New XFCE bases ship spacesd,
which does not implement Oddjob's installed Computer SDK's legacy API. Keep the
compatibility server and noVNC readiness checks until that SDK is migrated.

Home volumes retain browser sessions and downloads. Treat them as organization
credentials and keep them private. Desktops stop after the existing idle timeout.
Autonomous runs still require the organization's configured Gemini credentials
and the existing approval flow; enabling the viewer does not configure a model.

Run the broker policy tests with
`python -m unittest discover -s docker/desktop-broker -p test_broker.py` and the
desktop/viewer unit tests, then `npm run verify` before reporting a clean gate.
