import { hexdump, formatIPv4 } from "./format";
import type { System, Driver } from "./system";

const ARP_TIMEOUT_MS = 10_000;
const ARP_TTL_MS = 30_000;
const ARP_RETRY_MS = 10_000;

export type TIP4 = { address: number; prefix: number };
export type TInterface = {
  name: string;
  mac?: bigint;
  iDriver: number;
  isBridge?: boolean;
  iMasterInterface?: number;
  ips: TIP4[];
};
export type TArpRecord = {
  iInterface: number;
  ip: number;
  mac: bigint;
  expiresAt: number;
  state: "pending" | "success" | "fail";
};
export type TRoute = { network: number; prefix: number; gateway?: number; iInterface: number };
export class OS {
  _system: System;

  _drivers: Driver[] = [];
  _apps: { [key: string]: (os: OS, args: string[]) => void } = {};

  _netInterfaces: TInterface[] = [];
  _netCAMTable: { mac: bigint; iInterface: number }[] = [];
  _netARPTable: TArpRecord[] = [];
  _netIp4Queue: { iInterface: number; ip: number; frame: Uint8Array }[] = [];
  _netRoutes: TRoute[] = [];
  _netForwarding = true;

  on_print?: (text: string) => void;

  constructor(system: System) {
    this._system = system;
    this._system._interrupt = (deviceIndex) => {
      this._interruptHandlers[deviceIndex]?.();
    };
  }

  print(...text: string[]) {
    this.on_print?.(text.join(""));
  }

  install(apps: typeof this._apps) {
    Object.assign(this._apps, apps);
    this.print(`Installed: ${Object.keys(apps).join(", ")}\n`);
  }

  exec(name: string, args: string[] = []) {
    const app = this._apps[name];
    if (!app) return this.print(`Unknown app: ${name}\n`);
    try {
      app(this, args);
    } catch (e) {
      this.print(`Error: ${e}\n`);
    }
  }

  _interruptHandlers: { [key: number]: () => void } = {};
  interrupt_register(iDevice: number, handler: () => void) {
    this._interruptHandlers[iDevice] = handler;
  }

  net_add_interface(name: string, iDriver: number) {
    const index = this._netInterfaces.length;
    this._netInterfaces.push({ name, iDriver, ips: [] });
    return index;
  }

  net_add_cam_entry(mac: bigint, iInterface: number) {
    this._netCAMTable.push({ mac, iInterface });
  }

  net_change_mac(iInterface: number, mac: bigint) {
    const iface = this._netInterfaces[iInterface];
    const driver = this._drivers[iface.iDriver];
    driver.call({ $: "change_mac", mac });
  }

  net_resolve_cam(mac: bigint) {
    for (const entry of this._netCAMTable) {
      if (entry.mac === mac) {
        return entry.iInterface;
      }
    }
    return -1;
  }

  net_resolve_arp(iInterface: number, ip: number) {
    for (const entry of this._netARPTable) {
      if (entry.iInterface === iInterface && entry.ip === ip) {
        return entry.mac;
      }
    }
  }

  net_send_frame(iInterface: number, frame: Uint8Array) {
    if (iInterface === -1) return;
    const iface = this._netInterfaces[iInterface];
    const driver = this._drivers[iface.iDriver];
    driver.net_send_frame?.(iInterface, frame);
  }

  net_handle_frame(iInterface: number, frame: Uint8Array) {
    console.log("-> OS", this._netInterfaces[iInterface].name, hexdump(frame));

    const iface = this._netInterfaces[iInterface];
    if (iface.iMasterInterface !== undefined) {
      const slave = this._netInterfaces[iface.iMasterInterface];
      const driver = this._drivers[slave.iDriver];
      driver.net_send_frame?.(iInterface, frame);
      return;
    }

    const view = new DataView(frame.buffer);

    const dstMac = view.getBigUint64(0) >> 16n;
    // reject if not our mac or broadcast
    if (iface.mac && dstMac !== iface.mac && dstMac !== 0xffffffffffffn) return;

    const etherType = view.getUint16(12);

    if (etherType === 0x0800) {
      const payload = frame.slice(14);
      this.net_ip4_handle_packet(iInterface, payload);
    } else if (etherType === 0x0806) {
      this.net_arp_handle(iInterface, frame);
    }
  }

  net_ip4_handle_packet(iInterface: number, packet: Uint8Array) {
    const iface = this._netInterfaces[iInterface];

    const pack_view = new DataView(packet.buffer);
    const ttl = pack_view.getUint32(8);
    const src = pack_view.getUint32(12);
    const dst = pack_view.getUint32(16);

    console.log("=> OS:IP", formatIPv4(dst), `from ${iface.name}`, hexdump(packet));

    if (ttl === 0) return;

    // Local
    let ip: TIP4 | undefined;
    for (const _iface of this._netInterfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === dst) {
          ip = _ip;
          break;
        }
      }
    }
    if (ip) {
      // TODO: L4
      console.log("PROCESS L4", hexdump(packet));
      return;
    }

    // Forwarding
    if (!this._netForwarding) return;

    if (ttl === 1) return;

    let route: TRoute | undefined;
    for (const _route of this._netRoutes) {
      const mask = ~((1 << (32 - _route.prefix)) - 1);
      if ((dst & mask) !== (_route.network & mask)) continue;
      if (!route || _route.prefix > route.prefix) {
        route = _route;
      }
    }
    if (!route) return;

    const next_hop = route.gateway ?? dst;

    pack_view.setUint32(8, ttl - 1);

    this.net_ip4_send_packet(route.iInterface, next_hop, packet);
  }

  net_ip4_send_packet(iInterface: number, ip: number, packet: Uint8Array) {
    const route_iface = this._netInterfaces[iInterface];
    if (route_iface.mac === undefined) return;

    const src_mac = route_iface.mac;
    let dst_mac = -1n; // -1 unknown, -2 pending, -3 fail

    for (const _entry of this._netARPTable) {
      if (_entry.iInterface === iInterface && _entry.ip === ip) {
        switch (_entry.state) {
          case "success": {
            dst_mac = _entry.mac;
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

    if (dst_mac === -3n) return;

    const frame = new Uint8Array(6 + 6 + 2 + packet.length);
    const frame_view = new DataView(frame.buffer);
    frame_view.setBigUint64(0, dst_mac << 16n);
    frame_view.setBigUint64(6, src_mac << 16n);
    frame_view.setUint16(12, 0x0800);
    frame.set(packet, 14);

    if (dst_mac < 0n) {
      this._netIp4Queue.push({ iInterface, ip, frame });
      if (dst_mac === -1n) this.net_arp_send_request(iInterface, ip);
    } else {
      this.net_send_frame(iInterface, frame);
    }
  }

  net_arp_send_request(iInterface: number, ip: number) {
    const iface = this._netInterfaces[iInterface];
    const src_mac = iface.mac;
    if (!src_mac) return;

    const sender_ip = iface.ips[0];
    if (!sender_ip) return;

    const dst_mac = 0xffffffffffffn;

    const frame = new Uint8Array(6 + 6 + 2 + 28);
    const view = new DataView(frame.buffer);
    view.setBigUint64(0, dst_mac << 16n);
    view.setBigUint64(6, src_mac << 16n);
    view.setUint16(12, 0x0806);
    view.setUint16(14, 0x0001);
    view.setUint16(16, 0x0800);
    view.setUint8(18, 0x06);
    view.setUint8(19, 0x04);
    view.setUint16(20, 0x0001);
    view.setBigUint64(22, src_mac << 16n);
    view.setUint32(28, sender_ip.address);
    view.setBigUint64(32, 0n);
    view.setUint32(38, ip);

    this.net_send_frame(iInterface, frame);

    // TODO: timeout
    this._netARPTable.push({
      iInterface,
      ip,
      mac: 0n,
      state: "pending",
      expiresAt: Date.now() + ARP_TIMEOUT_MS,
    });
  }

  net_arp_handle(iInterface: number, frame: Uint8Array) {
    const iface = this._netInterfaces[iInterface];

    const view = new DataView(frame.buffer);
    const opcode = view.getUint16(20);

    if (opcode === 0x0001) {
      // Request
      if (!iface.mac) return;

      const remote_mac = view.getBigUint64(6) >> 16n;
      const remote_ip = view.getUint32(28);
      const who_is_ip = view.getUint32(38);

      for (const _iface of this._netInterfaces) {
        for (const _ip of _iface.ips) {
          if (_ip.address === who_is_ip) {
            const frame = new Uint8Array(6 + 6 + 2 + 28);
            const view = new DataView(frame.buffer);
            view.setBigUint64(0, remote_mac << 16n);
            view.setBigUint64(6, iface.mac << 16n);
            view.setUint16(12, 0x0806);
            view.setUint16(14, 0x0001);
            view.setUint16(16, 0x0800);
            view.setUint8(18, 0x06);
            view.setUint8(19, 0x04);
            view.setUint16(20, 0x0002);
            view.setBigUint64(22, iface.mac << 16n);
            view.setUint32(28, who_is_ip);
            view.setBigUint64(32, remote_mac << 16n);
            view.setUint32(38, remote_ip);

            this.net_send_frame(iInterface, frame);

            return;
          }
        }
      }
    } else if (opcode === 0x0002) {
      // Reply
      const mac = view.getBigUint64(22) >> 16n;
      const ip = view.getUint32(28);

      let arp: TArpRecord | undefined;
      for (const _arp of this._netARPTable) {
        if (_arp.iInterface === iInterface && _arp.ip === ip) {
          arp = _arp;
          break;
        }
      }
      if (!arp) return;

      arp.state = "success";
      arp.mac = mac;
      arp.expiresAt = Date.now() + ARP_TTL_MS;

      this.net_ip4_process_queue(iInterface, ip);
    }
  }

  net_arp_resolve(iInterface: number, ip: number) {
    for (const _entry of this._netARPTable) {
      if (_entry.iInterface === iInterface && _entry.ip === ip) {
        if (_entry.state === "success") {
          return _entry.mac;
        }
      }
    }

    return -1n;
  }

  net_ip4_process_queue(iInterface: number, ip: number) {
    for (let i = 0; i < this._netIp4Queue.length; i++) {
      const record = this._netIp4Queue[i];
      if (record.iInterface === iInterface && record.ip === ip) {
        const dst_mac = this.net_arp_resolve(iInterface, ip);
        if (dst_mac < 0n) continue;

        const frame = record.frame;
        const view = new DataView(frame.buffer);
        view.setBigUint64(0, (view.getBigUint64(0) & 0xffffn) | (dst_mac << 16n));

        this.net_send_frame(record.iInterface, frame);
      }
    }
  }
}
