import { load } from "js-yaml";
import type { TApp } from "../os/os";
import z from "zod";
import { format_net_error, from_utf8, socket_read, test_args, to_utf8 } from "./app.lib";
import type { TSocket } from "../os/socket";
import { formatIPv4, SEC } from "../format";

const _CONF_PATH = "/etc/nginx.yaml";

const _TIMEOUTS = {
  READ_HEADER: 10 * SEC,
};

const HTTP_STATUS_CODES: Record<number, string> = {
  100: "Continue",
  200: "OK",
  301: "Moved Permanently",
  302: "Found",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error",
} as const;

const z_conf = z.object({
  server: z.array(
    z.object({
      listen: z.number(),
      hostname: z.hostname(),
      location: z
        .record(
          z.string(),
          z.array(
            z.union([
              z.object({ add_header: z.string() }),
              z.object({ status: z.number() }),
              z.object({ body: z.string() }),
            ]),
          ),
        )
        .optional(),
    }),
  ),
});

let _started = false;
let _on_reload: () => void = () => null;
let _on_stop: () => void = () => null;

export const nginx: TApp = async (os, args, ctx) => {
  if (test_args(args, "-s", "reload")) return _on_reload();

  if (test_args(args, "-s", "stop")) return _on_stop();

  if (args.length) throw new Error("Usage: nginx [-s reload|stop]");

  if (_started) throw new Error("Already started");
  _started = true;

  const load_config = () => {
    if (!os.fs.exists(_CONF_PATH)) throw new Error(`No ${_CONF_PATH} found`);
    return z_conf.parse(load(os.fs.read(_CONF_PATH)));
  };

  let conf = load_config();

  const handle_connection = async (socket: TSocket) => {
    os.print(`[NGINX] Connection ${formatIPv4(socket.dst_ip)}:${socket.dst_port}\n`);

    try {
      const signal = AbortSignal.any([AbortSignal.timeout(_TIMEOUTS.READ_HEADER), ctx.signal]);

      let header = "";
      for (;;) {
        const chunk = from_utf8(await socket_read(os, socket, signal));
        header += chunk;
        if (header.includes("\r\n\r\n")) break;
      }
      // TODO: body not supported

      const [head, ..._headers] = header.split("\r\n");
      const [method, path] = head.split(" ");
      const headers = _headers
        .map((h) => h.trim().split(/\s*:\s*/))
        .reduce<Record<string, string[]>>((r, h) => {
          if (h.length < 2) return r;
          if (!r[h[0]]) r[h[0]] = [];
          r[h[0]].push(h[1]);
          return r;
        }, {});

      const host = headers.Host?.[0] || formatIPv4(socket.src_ip);
      const port = socket.src_port;

      os.print(`[NGINX] [${method}] [${host}:${port}] ${path}\n`);

      if (method !== "GET") throw new Error(`Unsupported method ${method}`);

      const res = {
        status: 200,
        status_text: "OK",
        headers: {} as Record<string, string[]>,
        body: "",
      };

      for (const server of conf.server) {
        if (server.listen !== port) continue;
        if (server.hostname !== host) continue;

        const locations = server.location;
        if (!locations) break;

        for (const [_path, location] of Object.entries(locations)) {
          const path_regex = new RegExp(`^${_path.replace(/\*/g, ".*")}$`);
          if (!path_regex.test(path)) continue;

          for (const rule of location) {
            if ("add_header" in rule) {
              const [name, value] = rule.add_header.split(/\s+/);
              if (!res.headers[name]) res.headers[name] = [];
              res.headers[name].push(value);
            } else if ("status" in rule) {
              res.status = rule.status;
              res.status_text = HTTP_STATUS_CODES[rule.status] || "Unknown";
            } else if ("body" in rule) {
              res.body = rule.body;
            }
          }

          const res_data = to_utf8(
            `HTTP/1.1 ${res.status} ${res.status_text}\r\n${Object.entries(res.headers)
              .flatMap(([name, values]) => values.map((v) => [name, v]))
              .map(([name, value]) => `${name}: ${value}`)
              .join("\r\n")}\r\n\r\n${res.body}`,
          );
          os.net.socket.send(socket, res_data);

          return;
        }

        break;
      }

      os.net.socket.send(socket, to_utf8("HTTP/1.1 404 Not Found\r\n\r\n"));
    } catch (e) {
      if (socket.state === "established") {
        os.net.socket.send(socket, to_utf8(`HTTP/1.1 500 Internal Server Error\r\n\r\n${e}`));
      }
    } finally {
      os.net.socket.close(socket);
    }
  };

  const ports = [...new Set(conf.server.map((s) => s.listen))];

  const sockets: TSocket[] = [];

  await new Promise<void>((resolve, reject) => {
    ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });

    for (const port of ports) {
      const socket = os.net.socket.create("tcp");
      sockets.push(socket);

      const err = os.net.socket.bind(socket, 0, port);
      if (err) throw new Error(`Bind port ${port} error ${format_net_error(err)}`);

      socket.on_error = (e) => reject(new Error(`Socket port ${port} error ${format_net_error(e)}`));
      socket.on_close = () => reject(new Error(`Socket port ${port} closed`));
      socket.on_connected = handle_connection;
    }

    os.print("NGINX EMULATOR STARTED\n");

    _on_stop = resolve;
    _on_reload = () => {
      const new_conf = load_config();
      const new_ports = [...new Set(new_conf.server.map((s) => s.listen))];

      const ports_changed = new_ports.length !== ports.length || new_ports.some((p) => !ports.includes(p));
      if (ports_changed) os.print("[WARNING] Ports changed, restarting need\n");

      conf = new_conf;
      os.print("[NGINX] Reloaded\n");
    };
  }).finally(() => {
    for (const socket of sockets) {
      os.net.socket.close(socket);
    }

    _on_reload = () => null;
    _on_stop = () => null;
    _started = false;
  });

  os.print("[NGINX] stopped\n");
};
