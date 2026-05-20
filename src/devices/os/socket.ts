import {
  IP_PROTOCOLS,
  pack_udp_packet,
  unpack_ip4_packet,
  unpack_udp_packet,
  type TIcmpPacket,
  type TIP4Packet,
} from "../pack";
import { NET_ERRORS, type Net, type TInterface } from "./net";

export type TSocket = {
  type: "raw" | "udp";
  protocol: number;
  src_ip: number;
  src_port: number;
  dst_ip: number;
  dst_port: number;
  on_error?: (error: number) => void;
  on_raw_recv?: (recv: { packet: TIP4Packet; ip: number; iface: TInterface }) => void;
  on_udp_recv?: (recv: { data: Uint8Array; ip: number; port: number; iface: TInterface }) => void;
};

export class Socket {
  _sockets: TSocket[] = [];

  constructor(public readonly net: Net) {}

  create<P extends TSocket["type"]>(type: P): TSocket {
    const socket: TSocket = { type, protocol: 0, dst_ip: 0, dst_port: 0, src_ip: 0, src_port: 0 };

    this._sockets.push(socket);

    return socket;
  }

  bind(socket: TSocket, ip: number, port: number): number {
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

    return 0;
  }

  connect(socket: TSocket, ip: number, port: number): number {
    socket.dst_ip = ip;
    socket.dst_port = port;

    const route = this.net.ip4.route(ip);
    if (!route) return NET_ERRORS.NO_ROUTE;

    if (socket.src_ip === 0) socket.src_ip = route.src;
    if (socket.src_port === 0) this._allocate_port(socket);

    return 0;
  }

  delete(socket: TSocket) {
    const index = this._sockets.indexOf(socket);
    if (index === -1) this._sockets.splice(index, 1);
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

  send_udp_to(socket: TSocket, ip: number, port: number, data: Uint8Array): number {
    if (socket.type !== "udp") return NET_ERRORS.BAD_PROTOCOL;

    if (socket.src_port === 0) this._allocate_port(socket);

    const payload = pack_udp_packet({
      header: { dst: port, src: socket.src_port, length: 0, checksum: 0 },
      payload: data,
    });

    return this.net.ip4.send(socket, ip, IP_PROTOCOLS.UDP, payload);
  }
  send_udp(socket: TSocket, data: Uint8Array): number {
    if (socket.type !== "udp") return NET_ERRORS.BAD_PROTOCOL;
    if (socket.dst_ip === 0 || socket.dst_port === 0) return NET_ERRORS.NO_ROUTE;

    return this.send_udp_to(socket, socket.dst_ip, socket.dst_port, data);
  }

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const iface = this.net._interfaces[iInterface];

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
          socket.on_udp_recv?.({ data: udp.payload, ip: packet.header.src, port: udp.header.src, iface });
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
      } else if (socket.type === "udp" && src_packet.header.protocol === IP_PROTOCOLS.UDP) {
        const src_udp = unpack_udp_packet(src_packet.payload);
        if (
          (socket.src_port === 0 || socket.src_port === src_udp.header.src) &&
          (socket.dst_port === 0 || socket.dst_port === src_udp.header.dst)
        ) {
          socket.on_error?.(icmp.type);
        }
      }
      // TODO: tcp also use udp structure
    }
  }

  private _allocate_port(socket: TSocket) {
    if (socket.type === "udp") {
      socket.src_port = Math.round(1 + Math.random() * 0xfff0);
    }
  }
}
