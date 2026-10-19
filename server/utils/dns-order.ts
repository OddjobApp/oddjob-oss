/**
 * Resolve `localhost` to IPv4 before IPv6, process-wide.
 *
 * Node 17+ stopped reordering DNS results and returns them in resolver order,
 * which on this platform puts `::1` first. Docker Desktop publishes each port on
 * both stacks (`0.0.0.0:9092` and `[::]:9092`), and the IPv6 relay accepts the
 * TCP connection and then immediately resets it — so a client that dials
 * `localhost` connects, sends one request, and gets ECONNRESET, while the same
 * client dialling `127.0.0.1` works perfectly.
 *
 * That is what took the Kafka event backbone down: `KAFKA_BROKERS` is
 * `localhost:9092`, so every connect landed on the dead IPv6 relay. Postgres was
 * unaffected only because `DATABASE_URL` happens to spell out `127.0.0.1`.
 *
 * Fixing this at the DNS layer rather than by rewriting the broker list is
 * deliberate: Kafka hands the client its OWN advertised address after the
 * bootstrap connect (`EXTERNAL://localhost:9092`), so a client that bootstraps
 * at `127.0.0.1` is redirected straight back to `localhost` and fails anyway.
 * The redirect target is not ours to rewrite; the resolution of it is.
 *
 * Import this FIRST, before any module that opens a socket.
 */
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");
