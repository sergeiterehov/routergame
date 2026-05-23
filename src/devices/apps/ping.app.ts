import { formatIPv4, formatTime, hexdump, parseIPv4, validate_ip } from "../format";
import type { OS } from "../os/os";
import type { TSocket } from "../os/socket";
import { pack_icmp_packet, unpack_icmp_packet, type TIP4Packet } from "../pack";
import { format_net_error } from "./app.lib";
import { get_hostname_ip } from "./dns.lib";

function find_config(args: string[], key: string, initial: string = "") {
  for (let i = 1; i < args.length; i++) {
    if (args[i] === key && args[i + 1]) {
      return args[i + 1];
    }
  }

  return initial;
}

export async function ping(os: OS, args: string[]) {
  if (validate_ip(args[0])) {
    const ip = parseIPv4(args[0]);

    const count = parseInt(find_config(args, "-c", "1"));
    if (Number.isNaN(count) || count < 0) throw new Error("Invalid count");

    const size = parseInt(find_config(args, "-s", "56"));
    if (Number.isNaN(size) || size < 0) throw new Error("Invalid packet size");

    const timeout = parseInt(find_config(args, "-t", "1000"));
    if (Number.isNaN(timeout) || timeout < 0) throw new Error("Invalid timeout");

    const ttl = parseInt(find_config(args, "-m", "64"));
    if (Number.isNaN(ttl) || ttl < 0 || ttl > 255) throw new Error("Invalid TTL");

    const wait = parseInt(find_config(args, "-i", "1000"));
    if (Number.isNaN(wait) || wait < 0) throw new Error("Invalid wait");

    os.print(`PING ${formatIPv4(ip)}: ${size} data bytes\n`);

    const id = Math.floor(Math.random() * 65535);

    for (let i = 0; i < count; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, wait));

      const seq = i;
      const data = new Uint8Array([id >> 8, id & 0xff, seq >> 8, seq & 0xff]);

      const packet: TIP4Packet = {
        header: {
          version: 4,
          dst: ip,
          src: 0,
          protocol: 1,
          ttl,
          flags: 0,
          id: 0,
          ihl: 0,
          length: 0,
          offset: 0,
          options: [],
          tos: 0,
          checksum: 0,
        },
        payload: pack_icmp_packet({
          type: 8,
          code: 0,
          data,
          payload: new Uint8Array(size),
          checksum: 0,
        }),
      };

      const err_send = os.net.ip4.send_raw(ip, packet, undefined);
      if (err_send) throw new Error(`Failed to send packet: ${format_net_error(err_send)}`);

      const start = Date.now();

      const dl = os.deadline(timeout);
      while (dl.left) {
        const [msg, err] = await os.channel_sync(os.net.ip4._channel, dl);
        if (err || !msg) {
          os.print(`timeout for seq=${seq}/${count - 1}\n`);
          break;
        }

        const time = Date.now() - start;

        if (msg.direction !== "in") continue;

        const reply = msg.packet;
        if (reply.header.src !== ip) continue;
        if (reply.header.protocol !== 1) continue;

        const icmp_struct = unpack_icmp_packet(reply.payload);
        if (icmp_struct.type !== 0) continue;

        let rest_eq = true;
        for (let j = 0; j < data.length; j++) {
          if (data[j] !== icmp_struct.data[j]) {
            rest_eq = false;
            break;
          }
        }
        if (!rest_eq) continue;

        os.print(
          `${reply.payload.length} bytes seq=${seq}/${count - 1} ttl=${reply.header.ttl} time=${formatTime(time)}\n`,
        );
        break;
      }
    }

    os.print("done\n");
    return;
  }

  os.print("Usage: <ip> [-c count] [-s packet_size] [-t timeout_ms] [-m TTL] [-i wait_ms]\n");
}

export async function nc(os: OS, args: string[]) {
  if (!args.length) {
    os.print(
      "Usage: [-l] [-u] [-s source_ip] [-p source_port] [-w data] [ip] [port]\n",
      "\t-l listen\n",
      "\t-u UDP\n",
      "\t-h HEX format\n",
    );
    return;
  }

  const flags = { l: false, u: false, h: false };
  const config = { s: "", p: "", w: "" };
  const params = { ip: "", port: "" };

  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg.startsWith("-")) {
      arg = arg.slice(1);
      if (arg in flags) {
        flags[arg as keyof typeof flags] = true;
      } else if (arg in config) {
        if (i + 1 >= args.length) throw new Error(`Missing value for ${arg}`);
        const value = args[(i += 1)];
        config[arg as keyof typeof config] = value;

        if (arg === "s" && !validate_ip(value)) {
          throw new Error(`Invalid IP: ${value}`);
        } else if (arg === "p" && !(parseInt(value) >= 0 && parseInt(value) <= 65535)) {
          throw new Error(`Invalid port: ${value}`);
        }
      } else {
        throw new Error(`Unknown argument: ${arg}\n`);
      }
    } else if (validate_ip(arg)) {
      params.ip = arg;
    } else if (parseInt(arg) >= 0 && parseInt(arg) <= 65535) {
      params.port = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}\n`);
    }
  }

  const print = (data: Uint8Array) => {
    if (flags.h) {
      os.print(hexdump(data), "\n\n");
    } else {
      os.print(new TextDecoder().decode(data));
    }
  };

  if (flags.l) {
    const ip = params.ip ? parseIPv4(params.ip) : 0;
    let err = 0;

    if (!params.port) {
      const sock = os.net.socket.create("raw");

      try {
        err = os.net.socket.bind(sock, 0, 0);
        if (err) throw new Error(`Bind error ${err}`);

        sock.on_raw_recv = (recv) => print(recv.packet.payload);

        os.print(`Listening RAW on ${formatIPv4(ip)}\n`);

        await new Promise<void>((resolve, reject) => {
          sock.on_close = resolve;
          sock.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
        });
      } finally {
        os.net.socket.close(sock);
      }
    } else {
      const port = parseInt(params.port);

      if (flags.u) {
        const sock = os.net.socket.create("udp");

        try {
          err = os.net.socket.bind(sock, ip, port);
          if (err) throw new Error(`Bind error ${format_net_error(err)}`);

          sock.on_recv = (recv) => print(recv.data);
          os.print(`Listening UDP ${formatIPv4(ip)}:${params.port}\n`);

          await new Promise<void>((resolve, reject) => {
            sock.on_close = resolve;
            sock.on_error = (e) => reject(new Error(`Socket error: ${format_net_error(e)}`));
          });
        } finally {
          os.net.socket.close(sock);
        }
      } else {
        const server_sock = os.net.socket.create("tcp");

        try {
          err = os.net.socket.bind(server_sock, ip, port);
          if (err) throw new Error(`Bind error ${format_net_error(err)}`);

          const sock = await new Promise<TSocket>((resolve, reject) => {
            server_sock!.on_connected = resolve;
            server_sock!.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
          });

          delete server_sock.on_connected;
          delete server_sock.on_error;

          sock.on_recv = (recv) => print(recv.data);
          os.print(`Listening TCP ${formatIPv4(ip)}:${params.port}\n`);

          await new Promise<void>((resolve, reject) => {
            sock.on_close = resolve;
            sock.on_error = (e) => reject(new Error(`Socket error: ${e}`));
          });
        } finally {
          os.net.socket.close(server_sock);
        }
      }
    }
  } else {
    if (!params.ip || !params.port) throw new Error("Missing ip and port");

    const source_ip = config.s ? parseIPv4(config.s) : 0;
    const source_port = config.p ? parseInt(config.p) : 0;

    const ip = params.ip ? parseIPv4(params.ip) : 0;
    const port = parseInt(params.port);

    if (flags.u) {
      const sock = os.net.socket.create("udp");

      try {
        let err = 0;

        err = os.net.socket.bind(sock, source_ip, source_port);
        if (err) throw new Error(`Bind error ${format_net_error(err)}`);

        err = os.net.socket.connect(sock, ip, port);
        if (err) throw new Error(`Connect error ${format_net_error(err)}`);

        if (config.w) {
          err = os.net.socket.send(sock, new TextEncoder().encode(config.w));
          if (err) throw new Error(`Send error: ${format_net_error(err)}`);
        }

        await new Promise<void>((resolve, reject) => {
          sock.on_close = resolve;
          sock.on_error = (e) => reject(new Error(`Socket error ${e}`));
        });
      } finally {
        os.net.socket.close(sock);
      }
    } else {
      const sock = os.net.socket.create("tcp");

      try {
        let err = 0;

        err = os.net.socket.connect(sock, ip, port);
        if (err) throw new Error(`Connect error ${format_net_error(err)}`);

        await new Promise<unknown>((resolve, reject) => {
          sock.on_connected = resolve;
          sock.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
        });

        await new Promise<void>((resolve, reject) => {
          sock.on_close = resolve;
          sock.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));

          if (config.w) {
            err = os.net.socket.send(sock, new TextEncoder().encode(config.w));
            if (err) throw new Error(`Send error: ${format_net_error(err)}`);
          }

          os.net.socket.close(sock);
        });
      } finally {
        os.net.socket.close(sock);
      }
    }
  }
  os.print("\n[closed]\n");
}

export async function dig(os: OS, args: string[]) {
  if (!args.length) return os.print("usage: <hostname>\n");

  const hostname = args.shift()!;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5_000);

  const ip = await get_hostname_ip(os, hostname, undefined, controller.signal);
  if (!ip) throw new Error(`Hostname ${hostname} not found`);

  os.print(formatIPv4(ip));
}

export async function socket(os: OS, args: string[]) {
  if (args.length) throw new Error("Arguments not supported");

  if (!os.net.socket._sockets.length) {
    os.print("[empty]\n");
    return;
  }

  for (let i = 0; i < os.net.socket._sockets.length; i += 1) {
    const s = os.net.socket._sockets[i];
    os.print(
      [
        `${i + 1})`,
        `[${s.state}]`,
        `${formatIPv4(s.dst_ip)}:${s.dst_port} -> ${formatIPv4(s.src_ip)}:${s.src_port}`,
        s.retry_queue.length > 0 && `queue=${s.retry_queue.length}`,
        s.parent && `parent=${os.net.socket._sockets.indexOf(s.parent) + 1}`,
      ]
        .filter(Boolean)
        .join(" "),
      "\n",
    );
  }
}
