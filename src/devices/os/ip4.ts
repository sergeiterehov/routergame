import { NET_ERRORS, type Net, type TInterface } from "./net";
import {
  ETHER_TYPES,
  ICMP_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  pack_icmp_packet,
  pack_ip4_packet,
  unpack_icmp_packet,
  type TEthernetFrame,
  type TIcmpPacket,
  type TIP4Packet,
} from "../pack";
import { testSameNetwork } from "../format";
import { Tracker } from "./tracker";
import { Firewall, FW_CHAINS, type TPacketContext } from "./fw";
import type { TSocket } from "./socket";

export type TRoute = { network: number; prefix: number; gateway?: number; iInterface: number; src?: number };

export class IP4 {
  _forwarding = true;
  _default_ttl = 64;

  _buffer: { iInterface: number; ip: number; frame: TEthernetFrame; socket?: TSocket }[] = [];
  _routes: TRoute[] = [];

  readonly tracker = new Tracker(this);
  readonly fw = new Firewall(this);

  constructor(public readonly net: Net) {}

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const fw_context: TPacketContext = { in: iInterface };

    if (this.fw.handle_chain(FW_CHAINS.PRE_ROUTING, packet, fw_context)) return;
    if (this.fw.handle_chain(FW_CHAINS.DST_NAT, packet, fw_context)) return;

    const { ttl, dst } = packet.header;

    let _input = false;
    if (dst === IP_BROADCAST) {
      _input = true;
    } else {
      for_interfaces: for (const _iface of this.net._interfaces) {
        for (const _ip of _iface.ips) {
          if (_ip.address === dst) {
            _input = true;
            break for_interfaces;
          }
        }
      }
    }

    // Input
    if (_input) {
      if (this.fw.handle_chain(FW_CHAINS.INPUT, packet, fw_context)) return;

      this._handle_input(iInterface, packet, fw_context);
      return;
    }

    // Forwarding
    if (!this._forwarding) return;

    if (ttl <= 1) return this._icmp_send_time_exceeded(iInterface, packet, fw_context);

    if (this.fw.handle_chain(FW_CHAINS.FORWARD, packet, fw_context)) return;

    const route = this.route(dst);
    if (!route) return this._icmp_send_unreachable(iInterface, packet, fw_context);

    packet.header.ttl -= 1;

    this._send_packet(route.iInterface, route.gateway, packet, fw_context, undefined);
  }

  private _send_packet(
    iInterface: number,
    ip: number,
    packet: TIP4Packet,
    fw_context: TPacketContext,
    socket: TSocket | undefined,
  ): number {
    fw_context.out = iInterface;

    const route_iface = this.net._interfaces[iInterface];
    if (route_iface.mac === undefined) return NET_ERRORS.NO_ROUTE;

    let local_iface: TInterface | undefined;
    for (const _iface of this.net._interfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address !== ip) continue;
        local_iface = _iface;
        break;
      }
    }
    if (local_iface) {
      setTimeout(() => this.handle_packet(local_iface.index, packet));
      return 0;
    }

    const src_mac = route_iface.mac;
    let dst_mac = -1n; // -1 unknown, -2 pending, -3 fail

    for (const _arp of this.net.arp._table) {
      if (_arp.iInterface === iInterface && _arp.ip === ip) {
        switch (_arp.state) {
          case "success": {
            dst_mac = _arp.mac;
            break;
          }
          case "pending": {
            dst_mac = -2n;
            break;
          }
          case "fail": {
            dst_mac = -3n;
            break;
          }
        }
        break;
      }
    }

    if (dst_mac === -3n) return NET_ERRORS.UNREACHABLE;

    if (this.fw.handle_chain(FW_CHAINS.POST_ROUTING, packet, fw_context)) return NET_ERRORS.ACCESS;
    if (this.fw.handle_chain(FW_CHAINS.SRC_NAT, packet, fw_context)) return NET_ERRORS.ACCESS;

    const frame: TEthernetFrame = {
      dst: dst_mac,
      src: src_mac,
      etherType: ETHER_TYPES.IPv4,
      payload: pack_ip4_packet(packet),
    };

    if (dst_mac < 0n) {
      this._buffer.push({ iInterface, ip, frame, socket });
      if (dst_mac === -1n) this.net.arp.send_request(iInterface, ip);
    } else {
      this.net.send_frame(iInterface, frame);
    }

    return 0;
  }

  send_raw(dst_ip: number, packet: TIP4Packet, socket: TSocket | undefined): number {
    const { src } = packet.header;

    const fw_context: TPacketContext = {};

    if (this.fw.handle_chain(FW_CHAINS.OUTPUT, packet, fw_context)) return NET_ERRORS.ACCESS;

    const route = this.route(dst_ip);
    if (!route) return NET_ERRORS.NO_ROUTE;

    if (src <= 0) packet.header.src = route.src;

    return this._send_packet(route.iInterface, route.gateway, packet, fw_context, socket);
  }

  send(socket: TSocket | undefined, dst_ip: number, protocol: number, payload: Uint8Array, src_ip?: number): number {
    const packet: TIP4Packet = {
      header: {
        version: 4,
        dst: dst_ip,
        src: src_ip ?? 0,
        protocol,
        ttl: this._default_ttl,
        flags: 0,
        id: 0,
        ihl: 0,
        length: 0,
        offset: 0,
        options: [],
        tos: 0,
        checksum: 0,
      },
      payload,
    };

    return this.send_raw(dst_ip, packet, socket);
  }

  route(dst: number) {
    let route: TRoute | undefined;
    for (const _route of this._routes) {
      if (!testSameNetwork(dst, _route.network, _route.prefix)) continue;
      if (!route || _route.prefix > route.prefix) {
        route = _route;
        break;
      }
    }
    if (!route) return;

    const iface = this.net._interfaces[route.iInterface];

    let src = -1;
    if (route.src) {
      src = route.src;
    } else if (iface.ips.length) {
      src = iface.ips[0].address;
    } else {
      return;
    }

    return { ...route, gateway: route.gateway ?? dst, src };
  }

  buffer_process(iInterface: number, ip: number) {
    const arp = this.net.arp.get_record(iInterface, ip);

    // arp probe failed, drop
    if (!arp || arp.state === "fail") {
      for (let i = this._buffer.length - 1; i >= 0; i -= 1) {
        const record = this._buffer[i];
        if (record.iInterface !== iInterface || record.ip !== ip) continue;

        this._buffer.splice(i, 1);
        record.socket?.on_error?.(NET_ERRORS.UNREACHABLE);
      }

      return;
    }

    // arp has not final state
    if (arp.state !== "success") return;

    for (let i = this._buffer.length - 1; i >= 0; i -= 1) {
      const record = this._buffer[i];
      if (record.iInterface !== iInterface || record.ip !== ip) continue;

      const { frame } = record;
      frame.dst = arp.mac;

      this._buffer.splice(i, 1);
      this.net.send_frame(record.iInterface, frame);
    }
  }

  private _handle_input(iInterface: number, packet: TIP4Packet, fw_context: TPacketContext) {

    // ICMP Reply
    if (packet.header.protocol === IP_PROTOCOLS.ICMP) {
      const icmp = unpack_icmp_packet(packet.payload);

      if (icmp.type === ICMP_TYPES.ECHO_REQUEST) {
        const reply = pack_icmp_packet({
          type: ICMP_TYPES.ECHO_REPLY,
          code: 0,
          checksum: 0,
          data: icmp.data,
          payload: icmp.payload,
        });

        const err = this.send(undefined, packet.header.src, IP_PROTOCOLS.ICMP, reply, packet.header.dst);
        if (err) this._icmp_send_unreachable(iInterface, packet, fw_context);

        return;
      }
    }

    // Sockets
    const socket_err = this.net.socket.handle_packet(iInterface, packet);
    if (socket_err) this._icmp_send_unreachable(iInterface, packet, fw_context);
  }

  private _icmp_send_response(iInterface: number, packet: TIP4Packet, fw_context: TPacketContext, icmp: TIcmpPacket) {
    // storm protection
    if (packet.header.protocol === IP_PROTOCOLS.ICMP) {
      const icmp = unpack_icmp_packet(packet.payload);
      if (icmp.type === ICMP_TYPES.TIME_EXCEEDED) return;
    }

    const { src } = packet.header;

    const route = this.route(src);
    if (!route) return;

    const response: TIP4Packet = {
      header: {
        version: 4,
        dst: src,
        src: route.src,
        protocol: 1,
        ttl: this._default_ttl,
        flags: 0,
        id: 0,
        ihl: 0,
        length: 0,
        offset: 0,
        options: [],
        tos: 0,
        checksum: 0,
      },
      payload: pack_icmp_packet(icmp),
    };

    return this._send_packet(iInterface, route.gateway, response, fw_context, undefined);
  }

  private _icmp_send_time_exceeded(iInterface: number, packet: TIP4Packet, fw_context: TPacketContext) {
    return this._icmp_send_response(iInterface, packet, fw_context, {
      type: ICMP_TYPES.TIME_EXCEEDED,
      code: 0,
      checksum: 0,
      data: new Uint8Array(4),
      payload: pack_ip4_packet({ ...packet, payload: packet.payload.slice(0, 8) }),
    });
  }

  private _icmp_send_unreachable(iInterface: number, packet: TIP4Packet, fw_context: TPacketContext) {
    return this._icmp_send_response(iInterface, packet, fw_context, {
      type: ICMP_TYPES.DEST_UNREACHABLE,
      code: 0,
      checksum: 0,
      data: new Uint8Array(4),
      payload: pack_ip4_packet({ ...packet, payload: packet.payload.slice(0, 8) }),
    });
  }
}
