import { type OS } from "./os";
import { testSameNetwork } from "../format";
import {
  ETHER_TYPES,
  MAC_BROADCAST,
  pack_ethernet_frame,
  unpack_ethernet_frame,
  unpack_ip4_packet,
  type TEthernetFrame,
} from "../pack";
import { Bridge } from "./br";
import { IP4 } from "./ip4";
import { Socket } from "./socket";
import { ARP } from "./arp";

export const NET_ERRORS = {
  NO_ROUTE: 1,
  ACCESS: 2,
  UNREACHABLE: 3,
  BAD_PROTOCOL: 4,
  PORT_BUSY: 5,
  NOT_CLOSED: 6,
  NOT_CONNECTED: 7,
  IS_CONNECTED: 8,
  TIMEOUT: 9,
  INTERFACE_DOWN: 10,
} as const;

export type TIP4 = { address: number; prefix: number };

export type TInterface = {
  index: number;
  type: "loopback" | "ethernet" | "bridge" | "vlan" | "ipip" | "ipip-udp";
  name: string;
  flags: {
    UP?: boolean;
    RUNNING?: boolean;
    POINTTOPOINT?: boolean;
    PROMISC?: boolean;
    LOOPBACK?: boolean;
    SLAVE?: boolean;
    MASTER?: boolean;
  };
  mac?: bigint;
  iDriver: number;
  iMasterInterface?: number;
  ips: TIP4[];
};

export class Net {
  _interfaces: TInterface[] = [];

  readonly br = new Bridge(this);
  readonly arp = new ARP(this);
  readonly ip4 = new IP4(this);
  readonly socket = new Socket(this);

  constructor(public readonly os: OS) {}

  iface(iInterface: number) {
    return this._interfaces[iInterface];
  }

  iface_by_name(name: string) {
    for (const iface of this._interfaces) {
      if (iface.name === name) return iface;
    }
  }

  add_interface(type: TInterface["type"], name: string, iDriver: number) {
    const index = this._interfaces.length;
    const iface: TInterface = { index, type, name, iDriver, ips: [], flags: {} };
    this._interfaces.push(iface);
    return iface;
  }

  change_mac(iInterface: number, mac: bigint) {
    const iface = this._interfaces[iInterface];

    if (iface.type === "bridge") {
      this.br.change_mac(iface.index, mac);
      return;
    }

    if (iface.type === "ethernet") {
      const driver = this.os._drivers[iface.iDriver];
      driver.call({ $: "change_mac", mac });
      return;
    }
  }

  send_frame(iInterface: number, frame: TEthernetFrame): number {
    const iface = this._interfaces[iInterface];

    if (!iface.flags.UP) return NET_ERRORS.INTERFACE_DOWN;

    if (!iface.mac) return NET_ERRORS.UNREACHABLE;

    if (iface.type === "bridge") {
      this.br.br_send_frame(iface.index, frame);
      return 0;
    }

    if (iface.type === "vlan") {
      this.br.vlan_send_frame(iface.index, frame);
      return 0;
    }

    if (iface.type === "ethernet") {
      const driver = this.os._drivers[iface.iDriver];
      const raw = pack_ethernet_frame(frame);
      driver.net_send_frame?.(iInterface, raw);
      return 0;
    }

    return NET_ERRORS.UNREACHABLE;
  }

  handle_raw_ingress(iInterface: number, raw: Uint8Array) {
    const frame = unpack_ethernet_frame(raw);
    this.handle_frame(iInterface, frame);
  }

  handle_frame(iInterfaceOrigin: number, frame: TEthernetFrame) {
    const iface = this._interfaces[iInterfaceOrigin];

    if (!iface.flags.UP) return;

    if (!iface.mac) return;

    const { dst, src, etherType } = frame;

    if (iface.iMasterInterface !== undefined) {
      const master_iface = this._interfaces[iface.iMasterInterface];

      if (master_iface.type === "bridge") {
        if (iface.type === "vlan") {
          delete frame.tag;
        } else {
          this.br.br_handle_frame(master_iface, iface, frame);
          return;
        }
      }
    }

    // reject if not our mac or broadcast
    if (dst !== iface.mac && dst !== MAC_BROADCAST) return;

    // common interfaces do not handle tagged frames
    if (frame.tag) return;

    if (etherType === ETHER_TYPES.IPv4) {
      const packet = unpack_ip4_packet(frame.payload);

      // ARP update
      for_arp: for (const _iface of this._interfaces) {
        for (const _ip of _iface.ips) {
          if (!testSameNetwork(packet.header.src, _ip.address, _ip.prefix)) continue;
          this.arp.update(iface.index, packet.header.src, src);
          break for_arp;
        }
      }

      // IPv4
      this.ip4.handle_packet(iface.index, packet);
    } else if (etherType === ETHER_TYPES.ARP) {
      this.arp.handle(iface.index, frame);
    }
  }
}
