# Distributed Program Architecture (Oddjob Mach 3)

Oddjob has evolved into a **Distributed Micro-Kernel Ecosystem**. Every major functional domain (Pod) can be run on a dedicated physical server, and the program automatically discovers and communicates across the internal network.

## 1. Global Service Discovery
The system uses a **Redis-backed Pod Registry** to maintain location transparency.
- **Heartbeats**: Every server broadcasts its available pods every 30 seconds.
- **Registry Lookup**: When a service calls `podRegistry.get('knowledge')`, the registry returns either a local reference or a **Remote Pod Proxy**.

## 2. Secure Internal RPC
Cross-server communication is handled via a secure internal RPC gateway.
- **Location Transparency**: Developers use standard TypeScript methods. If the pod is remote, the system automatically serializes arguments and executes the method on the remote host via `POST /api/internal/rpc`.
- **Security**: Authorized via the `INTERNAL_RPC_KEY` environment variable.

## 3. Sharded Vector Storage
To handle massive knowledge data, the system utilizes **Collection-level Sharding**.
- **Tenant Isolation**: Each organization's semantic memory is stored in its own Qdrant collection (e.g., `oddjob_org_42`).
- **Performance**: Queries are routed only to the relevant shard, preventing global index bloat.

## 4. Distributed Worker Program
Servers can be specialized using the `ENABLED_WORKERS` environment variable.
- **Compute Nodes**: Run `ai`, `extraction`, or `browser` workers.
- **Messaging Nodes**: Run `messaging` (Slack/Teams) listeners.
- **Control Nodes**: Run `mission`, `schedules`, and the Web API.
- **Horizontal Scaling**: The **Scaling Governor** monitors queue depths and requests new specialized nodes when backlogs exceed thresholds.

## 5. Deployment Configuration

| Variable | Description | Example |
| :--- | :--- | :--- |
| `SERVER_ID` | Unique identifier for the node. | `compute-node-01` |
| `INTERNAL_RPC_URL` | Public/Internal URL of this node. | `http://10.0.0.5:5000` |
| `INTERNAL_RPC_KEY` | Shared secret for program auth. | `******` |
| `ENABLED_WORKERS` | Comma-separated list of active workers. | `ai,extraction,messaging` |
| `REDIS_URL` | Shared program discovery backbone. | `redis://...` |

---
*Note: This architecture is designed for "Massive Data" and "High-Velocity Agents" across enterprise-scale clusters.*
