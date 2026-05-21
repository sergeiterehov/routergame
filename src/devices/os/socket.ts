import { SEC } from "../format";
import {
  IP_PROTOCOLS,
  pack_tcp_packet,
  pack_udp_packet,
  TCP_FLAGS,
  unpack_ip4_packet,
  unpack_tcp_packet,
  unpack_udp_packet,
  type TIcmpPacket,
  type TIP4Packet,
  type TTcpPacket,
} from "../pack";
import { NET_ERRORS, type Net, type TInterface } from "./net";

const _TIMEOUTS_MS = {
  TIME_WAIT: 30 * SEC,
} as const;

export type TSocket = {
  type: "raw" | "udp" | "tcp";
  protocol: number;
  src_ip: number;
  src_port: number;
  dst_ip: number;
  dst_port: number;
  state:
    | "closed"
    | "listen"
    | "syn_sent"
    | "syn_received"
    | "established"
    | "fin_wait_1"
    | "fin_wait_2"
    | "close_wait"
    | "last_ack"
    | "time_wait";
  snd_una: number;
  snd_nxt: number;
  rcv_nxt: number;
  snd_wnd: number;
  rcv_wnd: number;
  retry_queue: TTcpPacket[];
  expired_at: number;
  parent?: TSocket;
  on_error?: (error: number) => void;
  on_raw_recv?: (recv: { packet: TIP4Packet; ip: number; iface: TInterface }) => void;
  on_recv?: (recv: { data: Uint8Array; ip: number; port: number; iface: TInterface }) => void;
  on_connected?: (socket: TSocket) => void;
  on_close?: () => void;
};

export class Socket {
  _3_way_closing = true;

  _sockets: TSocket[] = [];

  constructor(public readonly net: Net) {
    setInterval(this._handle_timer_1s.bind(this), 1_000);
  }

  create<P extends TSocket["type"]>(type: P): TSocket {
    const socket: TSocket = {
      type,
      protocol: 0,
      dst_ip: 0,
      dst_port: 0,
      src_ip: 0,
      src_port: 0,
      state: "closed",
      snd_una: 1000,
      snd_nxt: 1000,
      rcv_nxt: 0,
      snd_wnd: 0,
      rcv_wnd: 0,
      retry_queue: [],
      expired_at: 0,
    };

    if (type === "udp") {
      socket.protocol = IP_PROTOCOLS.UDP;
    } else if (type === "tcp") {
      socket.protocol = IP_PROTOCOLS.TCP;
    }

    this._sockets.push(socket);

    return socket;
  }

  bind(socket: TSocket, ip: number, port: number): number {
    if (socket.type === "tcp" && socket.state !== "closed") return NET_ERRORS.NOT_CLOSED;

    socket.src_ip = ip;
    socket.src_port = port;

    if (socket.src_port !== 0 && socket.type !== "raw") {
      for (const _sock of this._sockets) {
        if (_sock === socket) continue;
        if (_sock.type === socket.type && _sock.src_port === socket.src_port) {
          return NET_ERRORS.PORT_BUSY;
        }
      }
    }

    if (socket.type === "tcp") {
      socket.state = "listen";
    }

    return 0;
  }

  connect(socket: TSocket, ip: number, port: number): number {
    if (socket.type === "tcp" && socket.state !== "closed") return NET_ERRORS.NOT_CLOSED;

    const route = this.net.ip4.route(ip);
    if (!route) return NET_ERRORS.NO_ROUTE;

    socket.src_ip = socket.src_ip === 0 ? route.src : socket.src_ip;
    socket.src_port = socket.src_port === 0 ? this._allocate_port(socket) : socket.src_port;
    socket.dst_ip = ip;
    socket.dst_port = port;

    if (socket.src_port < 0) return NET_ERRORS.PORT_BUSY;

    if (socket.type === "tcp") {
      const err = this._send_tcp(socket, TCP_FLAGS.SYN);
      if (err) {
        socket.state = "closed";
        return err;
      }

      socket.snd_nxt += 1;
      socket.state = "syn_sent";
    }

    return 0;
  }

  close(socket: TSocket): number {
    if (socket.type !== "tcp") return NET_ERRORS.BAD_PROTOCOL;

    if (socket.state === "closed") {
      return NET_ERRORS.NOT_CONNECTED;
    } else if (socket.state === "listen") {
      for (const sock of this._sockets) {
        if (sock.parent === socket) {
          const err = this.close(sock);
          if (err) return err;
        }
      }

      this._flush_tcp_socket(socket);
    } else if (socket.state === "established") {
      const err = this._send_tcp(socket, TCP_FLAGS.FIN);
      if (err) {
        this._send_tcp(socket, TCP_FLAGS.RST);
        this._flush_tcp_socket(socket);
      } else {
        socket.state = "fin_wait_1";
      }
    } else if (socket.state === "time_wait") {
      this._flush_tcp_socket(socket);
    } else {
      this._send_tcp(socket, TCP_FLAGS.RST);
      this._flush_tcp_socket(socket);
    }

    return 0;
  }

  send_raw_to(socket: TSocket, ip: number, packet: TIP4Packet): number {
    if (socket.type !== "raw") return NET_ERRORS.BAD_PROTOCOL;

    return this.net.ip4.send_raw(ip, packet, socket);
  }
  send_raw(socket: TSocket, packet: TIP4Packet): number {
    if (socket.type !== "raw") return NET_ERRORS.BAD_PROTOCOL;
    if (socket.dst_ip === 0) return NET_ERRORS.NO_ROUTE;

    return this.net.ip4.send_raw(socket.dst_ip, packet, socket);
  }
  send_raw_msg(socket: TSocket, payload: Uint8Array): number {
    if (socket.type !== "raw") return NET_ERRORS.BAD_PROTOCOL;
    if (socket.dst_ip === 0 || socket.protocol) return NET_ERRORS.NO_ROUTE;

    return this.net.ip4.send(socket, socket.dst_ip, socket.protocol, payload);
  }

  send_to(socket: TSocket, ip: number, port: number, data: Uint8Array): number {
    if (socket.type === "raw") return NET_ERRORS.BAD_PROTOCOL;

    if (socket.type === "tcp") {
      if (socket.state !== "established") return NET_ERRORS.NOT_CONNECTED;
      if (socket.dst_ip !== ip || socket.dst_port !== port) return NET_ERRORS.IS_CONNECTED;
    }

    if (socket.src_port === 0) {
      const src_port = this._allocate_port(socket);
      if (src_port < 0) return NET_ERRORS.PORT_BUSY;
      socket.src_port = src_port;
    }

    if (socket.type === "tcp") {
      return this._send_tcp(socket, TCP_FLAGS.ACK, data);
    } else if (socket.type === "udp") {
      const payload = pack_udp_packet({
        header: { dst: port, src: socket.src_port, length: 0, checksum: 0 },
        payload: data,
      });

      return this.net.ip4.send(socket, ip, IP_PROTOCOLS.UDP, payload);
    }

    return NET_ERRORS.BAD_PROTOCOL;
  }
  send(socket: TSocket, data: Uint8Array): number {
    if (socket.type === "raw") return NET_ERRORS.BAD_PROTOCOL;
    if (socket.dst_ip === 0 || socket.dst_port === 0) return NET_ERRORS.NO_ROUTE;

    return this.send_to(socket, socket.dst_ip, socket.dst_port, data);
  }

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const iface = this.net.iface(iInterface);

    for (const socket of this._sockets) {
      if (socket.src_ip !== 0 && socket.src_ip !== packet.header.dst) continue;
      if (socket.dst_ip !== 0 && socket.dst_ip !== packet.header.src) continue;

      if (socket.type === "raw") {
        if (socket.protocol === 0 || socket.protocol === packet.header.protocol) {
          socket.on_raw_recv?.({ packet, ip: packet.header.src, iface });
        }
      } else if (socket.type === "udp" && packet.header.protocol === IP_PROTOCOLS.UDP) {
        const udp = unpack_udp_packet(packet.payload);
        if (
          (socket.src_port === 0 || socket.src_port === udp.header.dst) &&
          (socket.dst_port === 0 || socket.dst_port === udp.header.src)
        ) {
          socket.on_recv?.({ data: udp.payload, ip: packet.header.src, port: udp.header.src, iface });
        }
      } else if (socket.type === "tcp" && packet.header.protocol === IP_PROTOCOLS.TCP) {
        const tcp = unpack_tcp_packet(packet.payload);
        if (
          (socket.src_port === 0 || socket.src_port === tcp.header.dst) &&
          (socket.dst_port === 0 || socket.dst_port === tcp.header.src)
        ) {
          this._handle_tcp(socket, iface, packet, tcp);
        }
      }
    }
  }

  handle_icmp_error(iInterface: number, icmp: TIcmpPacket) {
    const src_packet = unpack_ip4_packet(icmp.payload);

    for (const socket of this._sockets) {
      if (socket.src_ip !== 0 && socket.src_ip !== src_packet.header.src) continue;
      if (socket.dst_ip !== 0 && socket.dst_ip !== src_packet.header.dst) continue;

      if (socket.type === "raw") {
        if (socket.protocol === 0 || socket.protocol === src_packet.header.protocol) {
          socket.on_error?.(icmp.type);
        }
      } else if (
        (socket.type === "udp" && src_packet.header.protocol === IP_PROTOCOLS.UDP) ||
        (socket.type === "tcp" && src_packet.header.protocol === IP_PROTOCOLS.TCP)
      ) {
        // tcp also use udp (ports) structure
        const src_udp = unpack_udp_packet(src_packet.payload);
        if (
          (socket.src_port === 0 || socket.src_port === src_udp.header.src) &&
          (socket.dst_port === 0 || socket.dst_port === src_udp.header.dst)
        ) {
          socket.on_error?.(icmp.type);
        }
      }
    }
  }

  private _send_tcp(socket: TSocket, flags: number, payload: Uint8Array = new Uint8Array()) {
    const tcp: TTcpPacket = {
      header: {
        dst: socket.dst_port,
        src: socket.src_port,
        ack: socket.rcv_nxt,
        seq: socket.snd_nxt,
        flags: flags,
        urgent: 0,
        window: 0,
        options: new Uint8Array(),
        checksum: 0,
        data_offset: 0,
      },
      payload,
    };

    socket.snd_nxt += payload.length;

    if (tcp.header.flags !== TCP_FLAGS.ACK || payload.length) socket.retry_queue.push(tcp);

    return this.net.ip4.send(socket, socket.dst_ip, IP_PROTOCOLS.TCP, pack_tcp_packet(tcp), socket.src_ip);
  }

  private _handle_tcp(socket: TSocket, iface: TInterface, ip: TIP4Packet, tcp: TTcpPacket) {
    const { flags, ack, seq, window } = tcp.header;

    if (socket.state === "listen") {
      if (flags & TCP_FLAGS.SYN) {
        const child = this.create("tcp");
        child.parent = socket;
        child.state = "listen";
        child.src_ip = ip.header.dst;
        child.src_port = tcp.header.dst;
        child.dst_ip = ip.header.src;
        child.dst_port = tcp.header.src;

        child.rcv_nxt = seq + 1;
        this._send_tcp(child, TCP_FLAGS.SYN + TCP_FLAGS.ACK);
        child.snd_nxt += 1;
        child.state = "syn_received";
      }

      return;
    }

    if (flags & TCP_FLAGS.RST) {
      this._flush_tcp_socket(socket);
      return;
    }

    const { state } = socket;

    if (ack < socket.snd_una) return;

    for (let i = 0; i < socket.retry_queue.length; i += 1) {
      if (socket.retry_queue[i].header.seq < ack) {
        socket.retry_queue.splice(i, 1);
        i -= 1;
      }
    }

    socket.snd_una = ack;
    socket.snd_wnd = window;

    // TODO: retransmit timers

    if (state === "syn_sent") {
      if (flags & (TCP_FLAGS.SYN + TCP_FLAGS.ACK)) {
        socket.rcv_nxt = seq + 1;
        this._send_tcp(socket, TCP_FLAGS.ACK);
        socket.state = "established";
        socket.on_connected?.(socket);
      }
      return;
    }

    if (seq !== socket.rcv_nxt) return;

    if (state === "syn_received") {
      if (flags & TCP_FLAGS.ACK) {
        socket.state = "established";
        socket.parent?.on_connected?.(socket);
      }
    } else if (state === "established") {
      if (flags & TCP_FLAGS.ACK) {
        socket.rcv_nxt += tcp.payload.length;

        if (tcp.payload.length) {
          this._send_tcp(socket, TCP_FLAGS.ACK);
          socket.on_recv?.({ data: tcp.payload, ip: ip.header.src, port: tcp.header.src, iface });
        }
      } else if (flags & TCP_FLAGS.FIN) {
        if (this._3_way_closing) {
          this._send_tcp(socket, TCP_FLAGS.FIN + TCP_FLAGS.ACK);
          socket.state = "last_ack";
        } else {
          this._send_tcp(socket, TCP_FLAGS.ACK);
          socket.state = "close_wait";
        }
      }
    } else if (state === "last_ack") {
      if (flags & TCP_FLAGS.ACK) {
        this._flush_tcp_socket(socket);
      }
    } else if (state === "fin_wait_1") {
      if (flags & TCP_FLAGS.FIN && flags & TCP_FLAGS.ACK) {
        this._send_tcp(socket, TCP_FLAGS.ACK);
        socket.state = "time_wait";
        socket.expired_at = Date.now() + _TIMEOUTS_MS.TIME_WAIT;
        socket.on_close?.();
      } else if (flags & TCP_FLAGS.ACK) {
        socket.state = "fin_wait_2";
      }
    } else if (state === "fin_wait_2") {
      if (flags & TCP_FLAGS.FIN) {
        this._send_tcp(socket, TCP_FLAGS.ACK);
        socket.state = "time_wait";
        socket.expired_at = Date.now() + _TIMEOUTS_MS.TIME_WAIT;
        socket.on_close?.();
      }
    }
  }

  private _flush_tcp_socket(socket: TSocket) {
    const index = this._sockets.indexOf(socket);
    if (index === -1) return;

    socket.retry_queue.splice(0);

    if (socket.state !== "closed") {
      socket.state = "closed";
      socket.on_close?.();
    }

    this._sockets.splice(index, 1);
  }

  private _allocate_port(socket: TSocket) {
    if (socket.type === "raw") {
      return 0;
    } else if (socket.type === "udp") {
      return Math.round(1 + Math.random() * 0xfff0);
    } else if (socket.type === "tcp") {
      return Math.round(1 + Math.random() * 0xfff0);
    }

    return -1;
  }

  private _handle_timer_1s() {
    const now = Date.now();

    for (const socket of this._sockets) {
      if (socket.expired_at > now) continue;

      if (socket.state === "time_wait") {
        socket.state = "closed";
        this._flush_tcp_socket(socket);
        continue;
      }
    }
  }
}
