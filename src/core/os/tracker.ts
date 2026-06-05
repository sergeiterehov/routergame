import { SEC, MINUTE, DAY } from "../format";
import { setIntervalRecursive } from "../helpers";
import {
  extract_ip_ports,
  ICMP_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  TCP_FLAGS,
  unpack_icmp_packet,
  unpack_ip4_packet,
  unpack_tcp_packet,
  type TIP4Packet,
  type TTcpPacket,
} from "../pack";
import type { TPacketContext } from "./fw";
import type { IP4 } from "./ip4";

const TIMEOUTS_MS = {
  GENERIC: 60 * SEC,

  ICMP: 10 * SEC,

  UDP: 30 * SEC,
  UDP_REPLY: 3 * MINUTE,

  TCP_SYN_SENT: 5 * SEC,
  TCP_ESTABLISHED: 1 * DAY,
  TCP_FIN_WAIT: 10 * SEC,
  TCP_CLOSE_WAIT: 10 * SEC,
  TCP_TIME_WAIT: 10 * SEC,
  TCP_CLOSE: 10 * SEC,
} as const;

type _TTcpState = "syn-sent" | "established" | "fin-wait" | "close-wait" | "time-wait" | "close";

const _STATE_TIMEOUTS_MS: Record<_TTcpState, number> = {
  "syn-sent": TIMEOUTS_MS.TCP_SYN_SENT,
  established: TIMEOUTS_MS.TCP_ESTABLISHED,
  "fin-wait": TIMEOUTS_MS.TCP_FIN_WAIT,
  "close-wait": TIMEOUTS_MS.TCP_CLOSE_WAIT,
  "time-wait": TIMEOUTS_MS.TCP_TIME_WAIT,
  close: TIMEOUTS_MS.TCP_CLOSE,
} as const;

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
    state: _TTcpState;
  };
};

export class Tracker {
  _enabled = true;

  _table: TConnection[] = [];

  constructor(public readonly ip4: IP4) {
    setIntervalRecursive(this._timer_handle_1s.bind(this), 1000);
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

  handle_packet(packet: TIP4Packet, ctx: TPacketContext) {
    if (!this._enabled) return;

    if (ctx.untracked) return;

    const { protocol, src, dst } = packet.header;

    ctx.state = "new";

    if (src === 0 || dst === 0) return this._invalidate(ctx);

    if (dst === IP_BROADCAST) return;

    const icmp = protocol === IP_PROTOCOLS.ICMP ? unpack_icmp_packet(packet.payload) : undefined;

    let src_port = 0;
    let dst_port = 0;
    if (protocol === IP_PROTOCOLS.UDP || protocol === IP_PROTOCOLS.TCP) {
      const ports = extract_ip_ports(packet);
      src_port = ports.src;
      dst_port = ports.dst;
    } else if (protocol === IP_PROTOCOLS.ICMP) {
      if (!icmp) return;

      // Related ICMP errors
      if (icmp.type === ICMP_TYPES.DEST_UNREACHABLE || icmp.type === ICMP_TYPES.TIME_EXCEEDED) {
        const src_packet = unpack_ip4_packet(icmp.payload);
        ctx.conn = this._find_related(src_packet);
        ctx.state = "related";
        return;
      }

      src_port = 1;
      dst_port = 1;
    } else {
      return;
    }

    const now = Date.now();

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
        expires_at: now + TIMEOUTS_MS.GENERIC,
        flags: {},
      };

      if (protocol === IP_PROTOCOLS.ICMP) {
        if (!icmp) return;
        conn.icmp = {
          type: icmp.type,
          code: icmp.code,
          id: (icmp.data[0] << 8) | icmp.data[1],
        };
        conn.expires_at = now + TIMEOUTS_MS.ICMP;
      } else if (protocol === IP_PROTOCOLS.UDP) {
        conn.expires_at = now + TIMEOUTS_MS.UDP;
      } else if (protocol === IP_PROTOCOLS.TCP) {
        const tcp = unpack_tcp_packet(packet.payload);
        if (tcp.header.flags !== TCP_FLAGS.SYN) return this._invalidate(ctx);
        conn.tcp = { state: "syn-sent" };
        this._tcp_set_state(conn, "syn-sent");
      }

      reply = false;
      this._table.push(conn);
    } else {
      conn.flags.has_reply ||= reply;
      ctx.state = "established";

      if (protocol === IP_PROTOCOLS.ICMP) {
        conn.expires_at = now + TIMEOUTS_MS.ICMP;
      } else if (protocol === IP_PROTOCOLS.UDP) {
        if (conn.flags.has_reply) {
          conn.expires_at = now + TIMEOUTS_MS.UDP_REPLY;
        } else {
          conn.expires_at = now + TIMEOUTS_MS.UDP;
        }
      } else if (protocol === IP_PROTOCOLS.TCP) {
        const tcp = unpack_tcp_packet(packet.payload);
        this._update_tcp(conn, ctx, reply, tcp);
      }
    }

    ctx.conn = conn;
  }

  private _find_related(packet: TIP4Packet) {
    const { protocol, src, dst } = packet.header;

    let src_port = 0;
    let dst_port = 0;
    if (protocol === IP_PROTOCOLS.UDP || protocol === IP_PROTOCOLS.TCP) {
      const ports = extract_ip_ports(packet);
      src_port = ports.src;
      dst_port = ports.dst;
    } else if (protocol === IP_PROTOCOLS.ICMP) {
      src_port = 1;
      dst_port = 1;
    } else {
      return;
    }

    for (const c of this._table) {
      if (c.protocol !== protocol) continue;

      if (c.src === dst && c.dst === src && c.src_port == dst_port && c.dst_port === src_port) {
        // Same direction
      } else if (
        c.reply_src === dst &&
        c.reply_dst === src &&
        c.reply_src_port == dst_port &&
        c.reply_dst_port === src_port
      ) {
        // Reverse direction, reply
      } else {
        continue;
      }

      return c;
    }
  }

  private _update_tcp(conn: TConnection, ctx: TPacketContext, reply: boolean, packet: TTcpPacket) {
    const { tcp } = conn;
    if (!tcp) return;

    const { flags } = packet.header;
    const { state } = tcp;

    if (state !== "close" && flags & TCP_FLAGS.RST) return this._tcp_set_state(conn, "close");

    if (state === "syn-sent") {
      if (reply) {
        if (flags & TCP_FLAGS.SYN && flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "established");
      } else {
        if (flags & TCP_FLAGS.SYN) return this._tcp_set_state(conn, "syn-sent");
      }
    } else if (state === "established") {
      if (reply) {
        if (flags & TCP_FLAGS.FIN) return this._tcp_set_state(conn, "close-wait");
        if (flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "established");
      } else {
        if (flags & TCP_FLAGS.FIN) return this._tcp_set_state(conn, "fin-wait");
        if (flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "established");
      }
    } else if (state === "fin-wait") {
      if (reply) {
        if (flags & TCP_FLAGS.FIN) return this._tcp_set_state(conn, "time-wait");
        if (flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "fin-wait");
      } else {
        if (flags & TCP_FLAGS.FIN) return this._tcp_set_state(conn, "fin-wait");
        if (flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "fin-wait");
      }
    } else if (state === "close-wait") {
      if (reply) {
        if (flags & TCP_FLAGS.FIN) return this._tcp_set_state(conn, "close-wait");
        if (flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "close-wait");
      } else {
        if (flags & TCP_FLAGS.FIN) return this._tcp_set_state(conn, "time-wait");
        if (flags & TCP_FLAGS.ACK) return this._tcp_set_state(conn, "close-wait");
      }
    } else if (state === "time-wait") {
      if (flags & TCP_FLAGS.FIN) return;
      if (flags & TCP_FLAGS.ACK) return;
    }

    this._invalidate(ctx);
  }

  private _tcp_set_state(conn: TConnection, state: _TTcpState) {
    if (!conn.tcp) return;

    conn.tcp.state = state;
    conn.expires_at = Date.now() + _STATE_TIMEOUTS_MS[state];
  }

  private _invalidate(ctx: TPacketContext) {
    ctx.state = "invalid";
  }
}
