import {
  IP_PROTOCOLS,
  TCP_FLAGS,
  unpack_icmp_packet,
  unpack_tcp_packet,
  unpack_udp_packet,
  type TIP4Packet,
} from "../pack";
import type { IP4 } from "./ip4";

const TIMEOUT_DEFAULT_MS = 30 * 1_000;

export type TConnection = {
  protocol: number;

  src: number;
  dst: number;
  src_port: number;
  dst_port: number;

  reply_src: number;
  reply_dst: number;
  reply_src_port: number;
  reply_dst_port: number;

  expires_at: number;
  has_reply: boolean;

  icmp?: { type: number; code: number; id: number };
  tcp?: {
    state:
      | "syn-sent"
      | "syn-recv"
      | "established"
      | "fin-wait"
      | "close-wait"
      | "last-ack"
      | "time-wait"
      | "close"
      | "listen";
  };
};

export class Tracker {
  _table: TConnection[] = [];

  constructor(public readonly ip4: IP4) {}

  handle_packet(packet: TIP4Packet) {
    const { protocol, src, dst } = packet.header;

    if (protocol !== IP_PROTOCOLS.ICMP && protocol !== IP_PROTOCOLS.UDP && protocol !== IP_PROTOCOLS.TCP) return;

    let src_port = 0;
    let dst_port = 0;
    if (protocol === IP_PROTOCOLS.UDP) {
      const udp_struct = unpack_udp_packet(packet.payload);
      src_port = udp_struct.header.src;
      dst_port = udp_struct.header.dst;
    } else if (protocol === IP_PROTOCOLS.ICMP) {
      src_port = 1;
      dst_port = 1;
    } else if (protocol === IP_PROTOCOLS.TCP) {
      const tcp_struct = unpack_tcp_packet(packet.payload);
      src_port = tcp_struct.header.src;
      dst_port = tcp_struct.header.dst;
    } else {
      return;
    }

    let reply = false;
    let exists: TConnection | undefined;
    for (const c of this._table) {
      if (c.protocol !== protocol) continue;

      if (c.src === src && c.dst === dst && c.src_port == src_port && c.dst_port === dst_port) {
        // Same direction
        reply = false;
      } else if (
        c.reply_src === src &&
        c.reply_dst === dst &&
        c.reply_src_port == src_port &&
        c.reply_dst_port === dst_port
      ) {
        // Reverse direction, reply
        reply = true;
      } else {
        continue;
      }

      exists = c;
      break;
    }

    if (!exists) {
      exists = {
        protocol,
        src,
        dst,
        src_port,
        dst_port,
        reply_src: dst,
        reply_dst: src,
        reply_src_port: dst_port,
        reply_dst_port: src_port,
        expires_at: Date.now() + TIMEOUT_DEFAULT_MS,
        has_reply: false,
      };

      if (protocol === IP_PROTOCOLS.ICMP) {
        const icmp_struct = unpack_icmp_packet(packet.payload);
        exists.icmp = {
          type: icmp_struct.type,
          code: icmp_struct.code,
          id: (icmp_struct.data[0] << 8) | icmp_struct.data[1],
        };
      } else if (protocol === IP_PROTOCOLS.TCP) {
        exists.tcp = {
          state: "syn-sent",
        };
      }
      reply = false;
      this._table.push(exists);
    }

    exists.has_reply ||= reply;

    if (protocol === IP_PROTOCOLS.ICMP) {
      this._update_tcp(exists, reply, packet);
    }

    return exists;
  }

  _update_tcp(c: TConnection, reply: boolean, packet: TIP4Packet) {
    const { tcp } = c;
    if (!tcp) return;

    const tcp_struct = unpack_tcp_packet(packet.payload);
    const flags = tcp_struct.header.flags;

    const { state } = tcp;

    if (state === "syn-sent") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if (!reply && flags & TCP_FLAGS.SYN) {
        tcp.state = "syn-recv";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      } else if (reply && flags & TCP_FLAGS.SYN && flags & TCP_FLAGS.ACK) {
        tcp.state = "syn-recv";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      }
    } else if (state === "syn-recv") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      } else if (!reply && flags & TCP_FLAGS.SYN) {
        tcp.state = "syn-recv";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      } else if (reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "close-wait";
      }
    } else if (state === "established") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if (flags & (TCP_FLAGS.PSH | TCP_FLAGS.ACK)) {
        tcp.state = "established";
      } else if (!reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "fin-wait";
      } else if (reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "close-wait";
      }
    } else if (state === "fin-wait") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "fin-wait";
      } else if (!reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "time-wait";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "close-wait";
      } else if (reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "last-ack";
      }
    } else if (state === "close-wait") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "close-wait";
      } else if (!reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "last-ack";
      } else if (reply && flags & (TCP_FLAGS.ACK | TCP_FLAGS.FIN)) {
        tcp.state = "close-wait";
      }
    } else if (state === "last-ack") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "close";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "last-ack";
      }
    } else if (state === "time-wait") {
      if (flags & TCP_FLAGS.RST) {
        tcp.state = "close";
      } else if ((reply && flags & TCP_FLAGS.SYN) || flags & (TCP_FLAGS.ACK | TCP_FLAGS.FIN)) {
        tcp.state = "time-wait";
      }
    }
  }
}
