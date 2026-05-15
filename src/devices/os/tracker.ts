import {
  ICMP_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  TCP_FLAGS,
  unpack_icmp_packet,
  unpack_tcp_packet,
  unpack_udp_packet,
  type TIP4Packet,
  type TTcpPacket,
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

  flags: {
    has_reply?: boolean;
    src_nat?: boolean;
    dst_nat?: boolean;
  };

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

  constructor(public readonly ip4: IP4) {
    setInterval(this._timer_handle_1s.bind(this), 1000);
  }

  _timer_handle_1s() {
    this._actualize();
  }

  _actualize() {
    const now = Date.now();
    for (let i = this._table.length - 1; i >= 0; i -= 1) {
      if (this._table[i].expires_at < now) {
        this._table.splice(i, 1);
      }
    }
  }

  handle_packet(packet: TIP4Packet) {
    const { protocol, src, dst } = packet.header;

    if (src === 0 || dst === 0 || dst === IP_BROADCAST) return;

    if (protocol !== IP_PROTOCOLS.ICMP && protocol !== IP_PROTOCOLS.UDP && protocol !== IP_PROTOCOLS.TCP) return;

    const udp = protocol === IP_PROTOCOLS.UDP ? unpack_udp_packet(packet.payload) : undefined;
    const tcp = protocol === IP_PROTOCOLS.TCP ? unpack_tcp_packet(packet.payload) : undefined;
    const icmp = protocol === IP_PROTOCOLS.ICMP ? unpack_icmp_packet(packet.payload) : undefined;

    let src_port = 0;
    let dst_port = 0;
    if (protocol === IP_PROTOCOLS.UDP) {
      if (!udp) return;
      src_port = udp.header.src;
      dst_port = udp.header.dst;
    } else if (protocol === IP_PROTOCOLS.ICMP) {
      src_port = 1;
      dst_port = 1;
    } else if (protocol === IP_PROTOCOLS.TCP) {
      if (!tcp) return;
      src_port = tcp.header.src;
      dst_port = tcp.header.dst;
    } else {
      return;
    }

    let reply = false;
    let conn: TConnection | undefined;
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

      if (icmp && c.icmp) {
        if (
          (icmp.type === ICMP_TYPES.ECHO_REQUEST || icmp.type === ICMP_TYPES.ECHO_REPLY) &&
          c.icmp.id === ((icmp.data[0] << 8) | icmp.data[1])
        ) {
          // echo
        } else {
          continue;
        }
      }

      conn = c;
      break;
    }

    if (!conn) {
      conn = {
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
        flags: {},
      };

      if (protocol === IP_PROTOCOLS.ICMP) {
        if (!icmp) return;
        conn.icmp = {
          type: icmp.type,
          code: icmp.code,
          id: (icmp.data[0] << 8) | icmp.data[1],
        };
      } else if (protocol === IP_PROTOCOLS.TCP) {
        if (!tcp) return;
        if (tcp.header.flags !== TCP_FLAGS.SYN) return;
        conn.tcp = {
          state: "syn-sent",
        };
      }
      reply = false;
      this._table.push(conn);
    } else {
      conn.flags.has_reply ||= reply;
      conn.expires_at = Date.now() + TIMEOUT_DEFAULT_MS;
    }

    if (protocol === IP_PROTOCOLS.TCP) {
      if (!tcp) return;
      this._update_tcp(conn, reply, tcp);
    }

    return conn;
  }

  _update_tcp(c: TConnection, reply: boolean, packet: TTcpPacket) {
    const { tcp } = c;
    if (!tcp) return;

    const flags = packet.header.flags;

    const { state } = tcp;

    if (flags & TCP_FLAGS.RST) {
      tcp.state = "close";
    } else if (state === "syn-sent") {
      if (!reply && flags & TCP_FLAGS.SYN) {
        tcp.state = "syn-sent";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      } else if (reply && flags & TCP_FLAGS.SYN && flags & TCP_FLAGS.ACK) {
        tcp.state = "syn-recv";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      }
    } else if (state === "syn-recv") {
      if (reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "close-wait";
      } else if (!reply && flags & TCP_FLAGS.SYN) {
        tcp.state = "syn-recv";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      }
    } else if (state === "established") {
      if (!reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "fin-wait";
      } else if (reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "close-wait";
      } else if (flags & TCP_FLAGS.ACK) {
        tcp.state = "established";
      }
    } else if (state === "fin-wait") {
      if (!reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "time-wait";
      } else if (reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "last-ack";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "close-wait";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "fin-wait";
      }
    } else if (state === "close-wait") {
      if (!reply && flags & TCP_FLAGS.FIN) {
        tcp.state = "last-ack";
      } else if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "close-wait";
      } else if (reply && flags & (TCP_FLAGS.ACK | TCP_FLAGS.FIN)) {
        tcp.state = "close-wait";
      }
    } else if (state === "last-ack") {
      if (!reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "close";
      } else if (reply && flags & TCP_FLAGS.ACK) {
        tcp.state = "last-ack";
      }
    } else if (state === "time-wait") {
      if ((reply && flags & TCP_FLAGS.SYN) || flags & (TCP_FLAGS.ACK | TCP_FLAGS.FIN)) {
        tcp.state = "time-wait";
      }
    }
  }
}
