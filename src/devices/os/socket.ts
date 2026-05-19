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
  ip: number;
  error: number;
  on_wake_up: () => void;
} & (
  | { protocol: "raw"; recv: { packet: TIP4Packet; ip: number; iface: TInterface }[] }
  | { protocol: "icmp"; recv: { data: Uint8Array; ip: number; iface: TInterface }[] }
  | { protocol: "udp"; port: number; recv: { data: Uint8Array; ip: number; port: number; iface: TInterface }[] }
);

export class Socket {
  _sockets: TSocket[] = [];

  constructor(public readonly net: Net) {}

  send_raw(socket: TSocket, packet: TIP4Packet) {
    if (socket.protocol !== "raw") return;

    return this.net.ip4.send_raw(packet.header.dst, packet);
  }

  send_udp(socket: TSocket, data: Uint8Array, ip: number, port: number): number {
    if (socket.protocol !== "udp") return NET_ERRORS.BAD_PROTOCOL;

    const payload = pack_udp_packet({ header: { dst: port, src: socket.port, length: 0, checksum: 0 }, payload: data });

    return this.net.ip4.send(ip, IP_PROTOCOLS.UDP, payload);
  }

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const iface = this.net._interfaces[iInterface];

    for (const socket of this._sockets) {
      if (socket.ip !== 0 && socket.ip !== packet.header.dst) continue;
      if (socket.protocol === "raw") {
        socket.error = 0;
        socket.recv.push({ packet, ip: packet.header.src, iface });
        socket.on_wake_up();
      } else if (packet.header.protocol === IP_PROTOCOLS.ICMP && socket.protocol === "icmp") {
        socket.error = 0;
        socket.recv.push({ data: packet.payload, ip: packet.header.src, iface });
        socket.on_wake_up();
      } else if (socket.protocol === "udp" && packet.header.protocol === IP_PROTOCOLS.UDP) {
        const udp = unpack_udp_packet(packet.payload);
        if (socket.port === udp.header.dst) {
          socket.error = 0;
          socket.recv.push({ data: udp.payload, ip: packet.header.src, port: udp.header.src, iface });
          socket.on_wake_up();
        }
      }
    }
  }

  handle_icmp_error(iInterface: number, icmp: TIcmpPacket) {
    const src_packet = unpack_ip4_packet(icmp.payload);

    for (const socket of this._sockets) {
      if (socket.ip !== 0 && socket.ip !== src_packet.header.src) continue;

      if (src_packet.header.protocol === IP_PROTOCOLS.ICMP && socket.protocol === "icmp") {
        socket.error = icmp.type;
        socket.on_wake_up();
      } else if (socket.protocol === "udp" && src_packet.header.protocol === IP_PROTOCOLS.UDP) {
        const src_udp = unpack_udp_packet(src_packet.payload);
        if (socket.port === src_udp.header.src) {
          socket.error = icmp.type;
          socket.on_wake_up();
        }
      }
      // TODO: tcp always use udp structure
    }
  }
}
