"""Private Unix-socket Docker broker. Never forwards arbitrary Docker arguments.

Run on the host. Only the API/worker receive its socket; desktop containers do not.
Image, network, resource limits and boot command come from a root-owned config.
"""
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading

NAME = re.compile(r"oddjob-desktop-org-[1-9][0-9]*")
FORMATS = {"{{.State.Status}}", "{{.State.StartedAt}}", "{{json .HostConfig.PortBindings}}"}
NETWORK = "oddjob-desktops"
LIFECYCLE_LOCK = threading.Lock()


def run(args):
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=120)


def owned(name):
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError("Invalid desktop name")
    result = run(["inspect", "--format", '{{index .Config.Labels "oddjob.role"}}', name])
    if result.returncode == 0 and result.stdout.strip() != "computer-use-desktop":
        raise ValueError("Container is not an Oddjob desktop")
    return name


def command(args, config):
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise ValueError("Expected string arguments")
    if len(args) == 4 and args[:2] == ["inspect", "--format"] and args[2] in FORMATS:
        return [*args[:3], owned(args[3])]
    if len(args) == 3 and args[0] == "port" and args[2] in {"8000/tcp", "6901/tcp", "9223/tcp"}:
        return ["port", owned(args[1]), args[2]]
    if len(args) == 2 and args[0] == "start":
        return ["start", owned(args[1])]
    if len(args) == 3 and args[:2] == ["rm", "-f"]:
        return ["rm", "-f", owned(args[2])]
    if len(args) == 4 and args[:3] == ["stop", "--time", "10"]:
        return ["stop", "--time", "10", owned(args[3])]
    if args == ["ps", "--filter", "label=oddjob.role=computer-use-desktop", "--format", "{{.Names}}"]:
        return args
    if args == ["image", "inspect", config["image"]]:
        return args
    if args == ["network", "inspect", NETWORK]:
        return args
    if args == ["network", "create", "--label", "oddjob.role=computer-use-desktops", "-o", "com.docker.network.bridge.enable_icc=false", NETWORK]:
        # Provisioned by the operator with egress firewall rules, never by the API.
        raise ValueError("Desktop network must be provisioned by the operator")
    if args and args[0] == "run" and "--name" in args:
        name = args[args.index("--name") + 1]
        if not NAME.fullmatch(name):
            raise ValueError("Invalid desktop name")
        org_id = name.removeprefix("oddjob-desktop-org-")
        # Ignore supplied mounts, image, command, privileges, limits and network.
        return ["run", "-d", "--name", name,
                "--label", "oddjob.role=computer-use-desktop",
                "--label", f"oddjob.organization-id={org_id}",
                "--network", NETWORK, "--restart", "no",
                "--memory", "2048m", "--cpus", "1", "--shm-size", "512m",
                "--pids-limit", "1024", "--security-opt", "no-new-privileges:true",
                "-e", "VNC_RESOLUTION=1280x800",
                "-v", f"{name}-home:/home/cua",
                *sum((["-p", f'{config["host"]}::{port}'] for port in [8000, 6901, 9223]), []),
                config["image"], *config["boot"]]
    if len(args) == 11 and args[:8] == ["exec", "-d", "-u", "cua", "-e", "DISPLAY=:1", "-e", "HOME=/home/cua"] and args[9:] == ["/usr/local/bin/oddjob-browser", "about:blank"]:
        return [*args[:8], owned(args[8]), *args[9:]]
    raise ValueError("Docker operation denied")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if self.path != "/docker" or not 0 < size <= 16384:
                raise ValueError("Invalid request")
            args = json.loads(self.rfile.read(size))["args"]
            with LIFECYCLE_LOCK:
                safe_args = command(args, self.server.config)
                if safe_args[0] in {"run", "start"}:
                    running = run(["ps", "--filter", "label=oddjob.role=computer-use-desktop", "--format", "{{.Names}}"])
                    if running.returncode or len(running.stdout.splitlines()) >= self.server.config.get("max_running", 2):
                        raise ValueError("Desktop host capacity reached; stop an idle desktop and retry")
                result = run(safe_args)
            payload = {"stdout": result.stdout, "stderr": result.stderr, "code": result.returncode}
            status = 200
        except (ValueError, KeyError, IndexError, subprocess.TimeoutExpired) as error:
            payload = {"stdout": "", "stderr": str(error), "code": 1}
            status = 400
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    config = json.load(open(sys.argv[1]))
    path = config["socket"]
    if os.path.exists(path):
        os.unlink(path)
    server = Server(path, Handler)
    server.config = config
    os.chown(path, 0, config["group"])
    os.chmod(path, 0o660)
    server.serve_forever()
