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
  on_error?: (error: number) => void;
} & (
  | { protocol: "raw"; on_data?: (recv: { packet: TIP4Packet; ip: number; iface: TInterface }) => void }
  | {
      protocol: "udp";
      port: number;
      on_data?: (recv: { data: Uint8Array; ip: number; port: number; iface: TInterface }) => void;
    }
);

export class Socket {
  _sockets: TSocket[] = [];

  constructor(public readonly net: Net) {}

  create<P extends TSocket["protocol"]>(
    protocol: P,
    config: Omit<TSocket & { protocol: P }, "protocol">,
  ): TSocket & { protocol: P } {
    const socket = { ...config, protocol } as TSocket & { protocol: P };

    this._sockets.push(socket);

    return socket;
  }

  delete(socket: TSocket) {
    const index = this._sockets.indexOf(socket);
    if (index === -1) this._sockets.splice(index, 1);
  }

  send_raw(socket: TSocket, packet: TIP4Packet): number {
    if (socket.protocol !== "raw") return NET_ERRORS.BAD_PROTOCOL;

    return this.net.ip4.send_raw(packet.header.dst, packet, socket);
  }

  send_udp(socket: TSocket, data: Uint8Array, ip: number, port: number): number {
    if (socket.protocol !== "udp") return NET_ERRORS.BAD_PROTOCOL;

    const payload = pack_udp_packet({ header: { dst: port, src: socket.port, length: 0, checksum: 0 }, payload: data });

    return this.net.ip4.send(socket, ip, IP_PROTOCOLS.UDP, payload);
  }

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const iface = this.net._interfaces[iInterface];

    for (const socket of this._sockets) {
      if (socket.ip !== 0 && socket.ip !== packet.header.dst) continue;
      if (socket.protocol === "raw") {
        socket.on_data?.({ packet, ip: packet.header.src, iface });
      } else if (socket.protocol === "udp" && packet.header.protocol === IP_PROTOCOLS.UDP) {
        const udp = unpack_udp_packet(packet.payload);
        if (socket.port === udp.header.dst) {
          socket.on_data?.({ data: udp.payload, ip: packet.header.src, port: udp.header.src, iface });
        }
      }
    }
  }

  handle_icmp_error(iInterface: number, icmp: TIcmpPacket) {
    const src_packet = unpack_ip4_packet(icmp.payload);

    for (const socket of this._sockets) {
      if (socket.ip !== 0 && socket.ip !== src_packet.header.src) continue;

      if (socket.protocol === "udp" && src_packet.header.protocol === IP_PROTOCOLS.UDP) {
        const src_udp = unpack_udp_packet(src_packet.payload);
        if (socket.port === src_udp.header.src) {
          socket.on_error?.(icmp.type);
        }
      }
      // TODO: tcp also use udp structure
    }
  }
}
