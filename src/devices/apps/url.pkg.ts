import { SEC, validate_ip, parseIPv4, formatIPv4, validate_port } from "../format";
import type { OS, TApp, TAppContext } from "../os/os";
import { run_command_of, format_net_error, socket_connected, to_utf8, from_utf8, socket_read } from "./app.lib";
import { get_hostname_ip } from "./dns.lib";

const _url = async (os: OS, ctx: TAppContext, args: { url: string; verbose: boolean }) => {
  const { url, verbose } = args;

  const log_verbose = (...args: string[]) => verbose && os.print(...args);

  const { protocol, hostname, port: _port, pathname, search } = new URL(url.startsWith("http") ? url : `http://${url}`);

  if (protocol !== "http:") throw new Error(`Unsupported protocol ${protocol}`);

  const signal = AbortSignal.any([AbortSignal.timeout(30 * SEC), ctx.signal]);

  const ip = validate_ip(hostname)
    ? parseIPv4(hostname)
    : await get_hostname_ip(os, `${hostname}.`, undefined, signal).then((_ip) => {
        if (!_ip) throw new Error(`Could not resolve ${hostname}`);
        log_verbose(`* Resolved ${hostname} to ${formatIPv4(_ip)}\n`);
        return _ip;
      });

  const port = validate_port(_port) ? parseInt(_port) : 80;

  const socket = os.net.socket.create("tcp");

  log_verbose(`* Trying to connect to ${formatIPv4(ip)}:${port}\n`);

  try {
    let err = 0;

    err = os.net.socket.connect(socket, ip, port);
    if (err) throw new Error(`Connect error ${format_net_error(err)}`);

    await socket_connected(os, socket, signal);

    const request = `GET ${pathname}${search} HTTP/1.1\r\nHost: ${hostname}\r\n\r\n`;
    log_verbose(
      request
        .split("\r\n")
        .map((l) => `< ${l}\n`)
        .join(""),
    );

    err = os.net.socket.send(socket, to_utf8(request));
    if (err) throw new Error(`Send error: ${format_net_error(err)}`);

    let response = "";

    try {
      for (;;) {
        const chunk = from_utf8(await socket_read(os, socket, signal));
        response += chunk;
        if (response.includes("\r\n\r\n")) break;
      }
      const end_index = response.indexOf("\r\n\r\n") + 4;
      const header = response.slice(0, end_index);

      log_verbose(
        header
          .split("\r\n")
          .map((l) => `> ${l}\n`)
          .join(""),
      );

      const body_start = response.slice(end_index);
      os.print(body_start);
      for (;;) {
        const chunk = from_utf8(await socket_read(os, socket, signal));
        response += chunk;
        os.print(chunk);
      }
    } catch (e) {
      os.print("\n");
      log_verbose(`* Reading stopped: ${e}\n`);
    }
  } finally {
    os.net.socket.close(socket);
    log_verbose(`* Connection closed\n`);
  }
};

export const url: TApp = async (os, args, ctx) => {
  await run_command_of(
    os,
    {
      "": {
        desc: "Open URL",
        args: [
          { type: "string", required: true, alias: "url", desc: "HTTP URL" },
          { name: "--verbose", alias: "-v", type: "flag", desc: "Verbose output" },
        ],
        fn: (_, parsed) => _url(os, ctx, { url: parsed.url![0], verbose: Boolean(parsed.verbose) }),
      },
    },
    args,
  );
};
