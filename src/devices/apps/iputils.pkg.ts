import { formatIPv4, formatMAC, formatTime, hexdump, parseIPv4, SEC, validate_ip } from "../format";
import { async_timeout } from "../helpers";
import type { TArpRecord } from "../os/arp";
import type { OS, TApp } from "../os/os";
import type { TSocket } from "../os/socket";
import {
  compare_bytes,
  ICMP_TYPES,
  IP_PROTOCOLS,
  pack_icmp_packet,
  unpack_icmp_packet,
  unpack_ip4_packet,
  type TIcmpPacket,
  type TIP4Packet,
} from "../pack";
import { find_arg, format_net_error, socket_read_raw, test_args } from "./app.lib";
import { DNS_CLASSES, DNS_TYPES, get_hostname_ip, normalize_dns_name, resolve_dns } from "./dns.lib";

const _RESOLVE_NAME_TIMEOUT_MS = 5 * SEC;

const _DNS_TYPE_NAMES = Object.fromEntries(Object.entries(DNS_TYPES).map(([k, v]) => [v, k]));
const _DNS_CLASS_NAMES = Object.fromEntries(Object.entries(DNS_CLASSES).map(([k, v]) => [v, k]));

export const arp: TApp = async (os, args, ctx) => {
  if (!args.length) {
    if (!os.net.arp._table.length) os.print("empty\n");

    for (const rec of os.net.arp._table) {
      const iface = os.net._interfaces[rec.iInterface];
      os.print(`${formatIPv4(rec.ip)} at ${formatMAC(rec.mac)} on ${iface.name} [${rec.state}]\n`);
    }
  } else if (args[0] === "who" && validate_ip(args[1])) {
    const who_ip = parseIPv4(args[1]);

    let iface_index = -1;

    if (args[2] === "on" && args[3]) {
      iface_index = os.net._interfaces.findIndex((i) => i.name === args[3]);
      if (iface_index === -1) throw new Error("Interface not found");
    } else {
      const route = os.net.ip4.route(who_ip);
      if (!route) throw new Error("No route to host");

      iface_index = route.iInterface;
    }

    const iface = os.net._interfaces[iface_index];
    if (!iface.mac) throw new Error("Interface has no MAC");
    if (!iface.ips.length) throw new Error("Interface has no IPs");

    os.print("Request...");

    os.net.arp.send_request(iface_index, who_ip);

    let arp: TArpRecord | undefined;

    const signal = AbortSignal.any([AbortSignal.timeout(5 * SEC), ctx.signal]);

    const listener = os.net.arp.create_listener(who_ip);

    try {
      while (!signal.aborted) {
        arp = os.net.arp.get_record(iface_index, who_ip);
        if (arp && arp.state !== "pending") break;

        await new Promise((resolve) => {
          listener.on_change = resolve;
          signal.addEventListener("abort", resolve, { once: true });
        });
      }
    } finally {
      os.net.arp.remove_listener(listener);
    }

    if (arp) {
      os.print(`${arp.state}\n${formatMAC(arp.mac)}\n`);
    } else {
      os.print(`not found\n`);
    }
  } else {
    os.print("Usage:\n");
    os.print("[who <ip> [on <interface>]]\n");
  }
};

export const ping: TApp = async (os, args, ctx) => {
  ctx.signal.addEventListener("abort", () => os.print("Aborted\n"), { once: true });

  if (test_args(args, Boolean)) {
    let ip = 0;

    if (validate_ip(args[0])) {
      ip = parseIPv4(args[0]);
    } else {
      const signal = AbortSignal.any([AbortSignal.timeout(_RESOLVE_NAME_TIMEOUT_MS), ctx.signal]);

      const name = args[0];
      const resolved_ip = await get_hostname_ip(os, name.endsWith(".") ? name : `${name}.`, undefined, signal);
      if (!resolved_ip) throw new Error("Failed to resolve hostname");

      ip = resolved_ip;
    }

    const count = parseInt(find_arg(args, "-c", "1"));
    if (Number.isNaN(count) || count < 0) throw new Error("Invalid count");

    const size = parseInt(find_arg(args, "-s", "56"));
    if (Number.isNaN(size) || size < 0) throw new Error("Invalid packet size");

    const timeout = parseInt(find_arg(args, "-t", "1000"));
    if (Number.isNaN(timeout) || timeout < 0) throw new Error("Invalid timeout");

    const ttl = parseInt(find_arg(args, "-m", "64"));
    if (Number.isNaN(ttl) || ttl < 0 || ttl > 255) throw new Error("Invalid TTL");

    const wait = parseInt(find_arg(args, "-i", "1000"));
    if (Number.isNaN(wait) || wait < 0) throw new Error("Invalid wait");

    os.print(`PING ${formatIPv4(ip)}: ${size} data bytes\n`);

    const id = Math.floor(Math.random() * 65535);

    const socket = os.net.socket.create("raw");

    let err = os.net.socket.connect(socket, ip, 0);
    if (err) throw new Error(`Connection socket error ${format_net_error(err)}`);

    for (let i = 0; i < count; i++) {
      if (i) await async_timeout(wait, ctx.signal);

      const seq = i;
      const data = new Uint8Array([id >> 8, id & 0xff, seq >> 8, seq & 0xff]);

      const packet: TIP4Packet = {
        header: {
          version: 4,
          dst: ip,
          src: 0,
          protocol: IP_PROTOCOLS.ICMP,
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
          type: ICMP_TYPES.ECHO_REQUEST,
          code: 0,
          data,
          payload: new Uint8Array(size),
          checksum: 0,
        }),
      };

      err = os.net.socket.send_raw(socket, packet);
      if (err) throw new Error(`Failed to send packet ${format_net_error(err)}`);

      const start = Date.now();

      const signal = AbortSignal.any([AbortSignal.timeout(timeout), ctx.signal]);

      try {
        while (!signal.aborted) {
          const reply = await socket_read_raw(os, socket, signal);
          const time = Date.now() - start;

          if (reply.header.protocol !== IP_PROTOCOLS.ICMP) continue;

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
      } catch (e) {
        os.print(`${e} for seq=${seq}/${count - 1}\n`);
      }
    }

    os.print("done\n");
    return;
  }

  os.print("Usage: <host> [-c count] [-s packet_size] [-t timeout_ms] [-m TTL] [-i wait_ms]\n");
};

export const nc: TApp = async (os, args, ctx) => {
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
        if (err) throw new Error(`Bind error ${format_net_error(err)}`);

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
            ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
          });
        } finally {
          os.net.socket.close(sock);
        }
      } else {
        const server_sock = os.net.socket.create("tcp");

        try {
          err = os.net.socket.bind(server_sock, ip, port);
          if (err) throw new Error(`Bind error ${format_net_error(err)}`);

          os.print(`Listening TCP ${formatIPv4(ip)}:${params.port}\n`);

          const sock = await new Promise<TSocket>((resolve, reject) => {
            server_sock.on_connected = resolve;
            server_sock.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
            ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
          });

          delete server_sock.on_connected;
          delete server_sock.on_error;

          sock.on_recv = (recv) => print(recv.data);

          await new Promise<void>((resolve, reject) => {
            sock.on_close = resolve;
            sock.on_error = (e) => reject(new Error(`Socket error: ${format_net_error(e)}`));
            ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
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
          sock.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
          ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
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
          ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        });

        await new Promise<void>((resolve, reject) => {
          sock.on_close = resolve;
          sock.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
          ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });

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
};

export const dig: TApp = async (os, args, ctx) => {
  if (!args.length) os.print("usage:\n\t<hostname>\n\t-x <ip>\n");

  let name = "";
  let type = 0;

  if (test_args(args, "-x", validate_ip)) {
    name = args[1].split(".").reverse().concat(["in-addr", "arpa", ""]).join(".");
    type = DNS_TYPES.PTR;
  } else if (test_args(args, Boolean)) {
    name = normalize_dns_name(args.shift()!);
    type = DNS_TYPES.A;
  }

  const signal = AbortSignal.any([AbortSignal.timeout(5 * SEC), ctx.signal]);

  const records = await resolve_dns(os, name, type, undefined, signal);
  if (!records.length) throw new Error(`No ${_DNS_TYPE_NAMES[type]} records for ${name}`);

  for (const record of records) {
    os.print(
      [
        record.name,
        record.ttl,
        _DNS_CLASS_NAMES[record.class] || record.class,
        _DNS_TYPE_NAMES[record.type] || record.type,
        record.text,
      ].join("\t"),
      "\n",
    );
  }
};

export const socket: TApp = async (os, args) => {
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
};

export const trace: TApp = async (os, args, ctx) => {
  if (test_args(args, validate_ip)) {
    const ip = parseIPv4(args[0]);

    const max_ttl = Number(find_arg(args, "-m", "64"));
    if (Number.isNaN(max_ttl) || max_ttl < 1 || max_ttl > 255) throw new Error("Invalid max ttl");

    const wait_time = Number(find_arg(args, "-w", "1000"));
    if (Number.isNaN(wait_time) || wait_time <= 0) throw new Error("Invalid wait time");

    const socket = os.net.socket.create("raw");
    let err = 0;

    try {
      err = os.net.socket.connect(socket, ip, 0);
      if (err) throw new Error(`Socket connection error ${format_net_error(err)}`);

      // from any IP
      socket.dst_ip = 0;

      const id = 1337;
      const seq = 1;

      const icmp_request: TIcmpPacket = {
        type: ICMP_TYPES.ECHO_REQUEST,
        code: 0,
        checksum: 0,
        data: new Uint8Array([id >> 8, id & 0xff, seq >> 8, seq & 0xff]),
        payload: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      };

      const trace_ips: number[] = [];

      for_ttl: for (let ttl = 1; ttl < max_ttl; ttl += 1) {
        if (ctx.signal.aborted) throw new Error("Aborted");

        os.print(`${ttl}\t`);

        const prob: TIP4Packet = {
          header: {
            version: 4,
            dst: ip,
            ttl,
            protocol: IP_PROTOCOLS.ICMP,
            id: 1,
            checksum: 0,
            src: 0,
            flags: 0,
            ihl: 0,
            length: 0,
            offset: 0,
            options: [],
            tos: 0,
          },
          payload: pack_icmp_packet(icmp_request),
        };

        err = os.net.socket.send_raw_to(socket, prob.header.dst, prob);
        if (err) throw new Error(`Sending error ${format_net_error(err)}`);

        const sent_at = Date.now();
        const signal = AbortSignal.any([AbortSignal.timeout(wait_time), ctx.signal]);

        while_timeout: while (!signal.aborted) {
          const res = await socket_read_raw(os, socket, signal).catch(() => undefined);
          if (!res) continue while_timeout;

          if (trace_ips.includes(res.header.src)) {
            os.print(`LOOP\n`);
            break for_ttl;
          }
          trace_ips.push(res.header.src);

          if (res.header.protocol !== IP_PROTOCOLS.ICMP) continue while_timeout;

          const icmp = unpack_icmp_packet(res.payload);

          if (
            res.header.src === prob.header.dst &&
            icmp.type === ICMP_TYPES.ECHO_REPLY &&
            compare_bytes(icmp.payload, icmp_request.payload)
          ) {
            os.print(`${formatIPv4(res.header.src)}\t${formatTime(Date.now() - sent_at)}\t<- TARGET\n`);
            break for_ttl;
          }

          if (icmp.type !== ICMP_TYPES.DEST_UNREACHABLE && icmp.type !== ICMP_TYPES.TIME_EXCEEDED)
            continue while_timeout;

          const original_ip = unpack_ip4_packet(icmp.payload);
          if (original_ip.header.protocol !== IP_PROTOCOLS.ICMP) continue while_timeout;

          const original_icmp = unpack_icmp_packet(original_ip.payload);

          if (original_icmp.type !== icmp_request.type || !compare_bytes(original_icmp.data, icmp_request.data))
            continue while_timeout;

          os.print(`${formatIPv4(res.header.src)}\t${formatTime(Date.now() - sent_at)}\n`);

          if (icmp.type === ICMP_TYPES.TIME_EXCEEDED) {
            continue for_ttl;
          } else if (icmp.type === ICMP_TYPES.DEST_UNREACHABLE) {
            os.print(`UNREACHABLE\n`);
            break for_ttl;
          }
        }

        os.print("*\n");
      }

      os.print("done\n");
    } finally {
      os.net.socket.close(socket);
    }
  } else {
    os.print("usage: <ip> [-m max_ttl] [-w wait_time_ms]\n");
  }
};
