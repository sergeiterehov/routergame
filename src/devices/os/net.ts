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

export type TIP4 = { address: number; prefix: number };

export type TInterface = {
  index: number;
  type: "bridge" | "ethernet";
  name: string;
  flags: {
    UP?: boolean;
    LOWER_UP?: boolean;
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
    this._interfaces.push({ index, type, name, iDriver, ips: [], flags: {} });
    return index;
  }

  change_mac(iInterface: number, mac: bigint) {
    const iface = this._interfaces[iInterface];
    const driver = this.os._drivers[iface.iDriver];
    driver.call({ $: "change_mac", mac });
  }

  send_frame(iInterface: number, frame: TEthernetFrame) {
    const iface = this._interfaces[iInterface];

    if (!iface.flags.UP) return;

    if (iface.type === "bridge") {
      this.br.send(iface.index, frame.dst, frame);

      return;
    }

    const driver = this.os._drivers[iface.iDriver];
    const raw = pack_ethernet_frame(frame);
    driver.net_send_frame?.(iInterface, raw);
  }

  handle_frame(iInterfaceOrigin: number, raw: Uint8Array) {
    const frame = unpack_ethernet_frame(raw);
    const { dst, src, etherType } = frame;

    let iface = this._interfaces[iInterfaceOrigin];

    if (iface.iMasterInterface !== undefined) {
      iface = this._interfaces[iface.iMasterInterface];
    }

    if (iface.type === "bridge") {
      this.br.fdb_update(iface.index, src, iInterfaceOrigin);

      if (dst !== iface.mac) {
        this.br.send(iface.index, dst, frame, iInterfaceOrigin);
      }
    }

    // reject if not our mac or broadcast
    if (dst !== iface.mac && dst !== MAC_BROADCAST) return;

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
      this.arp.handle(iface.index, raw);
    }
  }
}
