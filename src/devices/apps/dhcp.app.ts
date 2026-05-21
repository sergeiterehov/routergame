import { formatIPv4, formatMAC, formatTime, maskToPrefix, parseIPv4, prefixToMask, validate_ip } from "../format";
import type { TInterface } from "../os/net";
import type { OS } from "../os/os";
import {
  DHCP_OPS,
  DHCP_OPTIONS,
  DHCP_TYPES,
  ETHER_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  MAC_BROADCAST,
  pack_dhcp_packet,
  pack_ip4_packet,
  pack_udp_packet,
  uint32,
  unpack_dhcp_packet,
  type TDhcpPacket,
  type TEthernetFrame,
} from "../pack";

const LEASE_TIME_S = 86_400;

function get_option(type: number, packet: TDhcpPacket): Uint8Array | undefined {
  for (const option of packet.header.options) {
    if (option.type === type) {
      return option.data;
    }
  }
}

type TLease = { iface: TInterface; ip: number; mac: bigint; expiresAt: number };

const leases: TLease[] = [];
let server_started = false;
export async function dhcpd(os: OS, args: string[]) {
  if (!args.length) {
    os.print("usage:\n");
    os.print("\t<interface> <ip_start> <ip_end> [-g gateway_ip]\n");
    os.print("\tls\n");
    return;
  }

  if (args[0] === "ls") {
    os.print(`Server is ${server_started ? "started" : "stopped"}\n`);
    for (const lease of leases) {
      os.print(
        `- ${lease.iface.name} ${formatMAC(lease.mac)} - ${formatIPv4(lease.ip)} - ${formatTime(lease.expiresAt - Date.now())} left\n`,
      );
    }
    return;
  }

  if (server_started) throw new Error("DHCP server already started");
  server_started = true;

  const _iface_name = args.shift();
  if (!_iface_name) throw new Error("No interface specified");

  const iface = os.net._interfaces.find((i) => i.name === _iface_name)!;
  if (!iface) throw new Error(`Interface ${_iface_name} not found`);

  const server_ip = iface.ips.at(0)!;
  if (!server_ip) throw new Error(`Interface ${_iface_name} has no IPs`)!;

  const pool = {
    start: -1,
    end: -1,
  };

  {
    const start = args.shift();
    if (!start) throw new Error("No pool start specified");
    if (!validate_ip(start)) throw new Error("Invalid pool start specified");

    const end = args.shift();
    if (!end) throw new Error("No pool end specified");
    if (!validate_ip(end)) throw new Error("Invalid pool end specified");

    if (end <= start) throw new Error("Pool end must be greater than pool start");

    pool.start = parseIPv4(start);
    pool.end = parseIPv4(end);
  }

  let gateway_ip = -1;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-g") {
      i += 1;
      const value = args[i] || "";
      if (!validate_ip(value)) throw new Error("Invalid gateway IP specified");
      gateway_ip = parseIPv4(value);
    }
  }

  function addr_allocate(mac: bigint) {
    for_address: for (let ip = pool.start; ip <= pool.end; ip += 1) {
      for (const _used of leases) if (_used.ip === ip) continue for_address;
      leases.push({ iface, ip, mac, expiresAt: Date.now() + 10_000 });
      return leases.at(-1);
    }
  }

  const socket = os.net.socket.create("udp");
  os.net.socket.bind(socket, 0, 67);

  socket.on_error = (error) => os.print(`Socket error: ${error}\n`);

  socket.on_recv = (recv) => {
    const { data: payload, iface: _iface } = recv;
    if (iface.index !== _iface.index) return;

    const packet = unpack_dhcp_packet(payload);

    const client_mac =
      new DataView(packet.header.chaddr.buffer, packet.header.chaddr.byteOffset).getBigUint64(0) >> 16n;

    let leasing = leases.find((lease) => lease.iface === iface && lease.mac === client_mac);

    function get_options() {
      const options: TDhcpPacket["header"]["options"] = [
        { type: DHCP_OPTIONS.SUBNET_MASK, data: uint32(prefixToMask(server_ip.prefix)) },
        { type: DHCP_OPTIONS.SERVER_ID, data: uint32(server_ip.address) },
        { type: DHCP_OPTIONS.LEASE_TIME, data: uint32(LEASE_TIME_S) },
      ];

      if (gateway_ip >= 0) {
        options.push({ type: DHCP_OPTIONS.ROUTER, data: uint32(gateway_ip) });
      }

      return options;
    }

    function send_offer() {
      if (iface.mac === undefined) return;
      if (!leasing) return;

      os.net.send_frame(iface.index, {
        dst: client_mac,
        src: iface.mac,
        etherType: ETHER_TYPES.IPv4,
        payload: pack_ip4_packet({
          header: {
            version: 4,
            dst: IP_BROADCAST,
            src: server_ip.address,
            protocol: IP_PROTOCOLS.UDP,
            ttl: 64,
            checksum: 0,
            flags: 0,
            id: 0,
            ihl: 0,
            length: 0,
            offset: 0,
            options: [],
            tos: 0,
          },
          payload: pack_udp_packet({
            header: {
              src: 67,
              dst: 68,
              length: 0,
              checksum: 0,
            },
            payload: pack_dhcp_packet({
              header: {
                ...packet.header,
                op: DHCP_OPS.REPLY,
                yiaddr: leasing.ip,
                options: [
                  { type: DHCP_OPTIONS.MESSAGE_TYPE, data: new Uint8Array([DHCP_TYPES.OFFER]) },
                  ...get_options(),
                ],
              },
            }),
          }),
        }),
      });
    }

    function send_ack() {
      if (iface.mac === undefined) return;
      if (!leasing) return;

      os.net.send_frame(iface.index, {
        dst: client_mac,
        src: iface.mac,
        etherType: ETHER_TYPES.IPv4,
        payload: pack_ip4_packet({
          header: {
            version: 4,
            dst: IP_BROADCAST,
            src: server_ip.address,
            protocol: IP_PROTOCOLS.UDP,
            ttl: 64,
            checksum: 0,
            flags: 0,
            id: 0,
            ihl: 0,
            length: 0,
            offset: 0,
            options: [],
            tos: 0,
          },
          payload: pack_udp_packet({
            header: {
              src: 67,
              dst: 68,
              length: 0,
              checksum: 0,
            },
            payload: pack_dhcp_packet({
              header: {
                ...packet.header,
                op: DHCP_OPS.REPLY,
                yiaddr: leasing.ip,
                options: [
                  { type: DHCP_OPTIONS.MESSAGE_TYPE, data: new Uint8Array([DHCP_TYPES.ACK]) },
                  ...get_options(),
                ],
              },
            }),
          }),
        }),
      });
    }

    const type = get_option(DHCP_OPTIONS.MESSAGE_TYPE, packet)?.[0];

    if (type === DHCP_TYPES.DISCOVER) {
      if (!leasing) leasing = addr_allocate(client_mac);
      send_offer();
    } else if (type === DHCP_TYPES.REQUEST) {
      if (leasing) {
        const requested_ip_opt = get_option(DHCP_OPTIONS.REQUESTED_IP, packet);
        const server_id_opt = get_option(DHCP_OPTIONS.SERVER_ID, packet);
        if (requested_ip_opt && server_id_opt) {
          const requested_ip = new DataView(requested_ip_opt.buffer, requested_ip_opt.byteOffset).getUint32(0);
          const server_id = new DataView(server_id_opt.buffer, server_id_opt.byteOffset).getUint32(0);
          if (requested_ip === leasing.ip && server_id === server_ip.address) {
            leasing.expiresAt = Date.now() + LEASE_TIME_S * 1_000;
            send_ack();
          }
        }
      }
    }
  };

  os.print("DHCP server started\n");
  await new Promise(() => null);

  os.net.socket.delete(socket);
  server_started = false;
}

export async function dhcp(os: OS, args: string[]) {
  if (!args.length) {
    os.print("usage: <interface>\n");
    return;
  }

  const _iface_name = args.shift();
  if (!_iface_name) throw new Error("No interface specified");

  const iface = os.net._interfaces.find((i) => i.name === _iface_name)!;
  if (!iface) throw new Error(`Interface ${_iface_name} not found`);

  let state: "idle" | "discovering" | "requesting" | "leasing" = "idle";
  let xid = -1;
  let server_id = -1;
  let requested_ip = -1;
  let mask = -1;
  let router = -1;
  let lease_time = -1;

  function refresh_xid() {
    xid = Math.floor(Math.random() * 0xffffffff);
  }

  function reset() {
    state = "idle";
    xid = -1;
    server_id = -1;
    requested_ip = -1;
    mask = -1;
    router = -1;
    lease_time = -1;
  }

  function send_discover() {
    if (iface.mac === undefined) return;

    const chaddr = new Uint8Array(16);
    {
      const $ = new DataView(chaddr.buffer);
      $.setBigUint64(0, iface.mac << 16n);
    }

    const frame: TEthernetFrame = {
      dst: MAC_BROADCAST,
      src: iface.mac,
      etherType: ETHER_TYPES.IPv4,
      payload: pack_ip4_packet({
        header: {
          version: 4,
          dst: IP_BROADCAST,
          src: 0,
          protocol: IP_PROTOCOLS.UDP,
          ttl: 64,
          checksum: 0,
          flags: 0,
          id: 0,
          ihl: 0,
          length: 0,
          offset: 0,
          options: [],
          tos: 0,
        },
        payload: pack_udp_packet({
          header: {
            src: 68,
            dst: 67,
            length: 0,
            checksum: 0,
          },
          payload: pack_dhcp_packet({
            header: {
              op: DHCP_OPS.REQUEST,
              htype: 1,
              hlen: 6,
              chaddr,
              xid,
              flags: 0,
              hops: 0,
              secs: 0,
              file: new Uint8Array(0),
              sname: new Uint8Array(0),
              ciaddr: 0,
              yiaddr: 0,
              giaddr: 0,
              siaddr: 0,
              options: [{ type: DHCP_OPTIONS.MESSAGE_TYPE, data: new Uint8Array([DHCP_TYPES.DISCOVER]) }],
            },
          }),
        }),
      }),
    };

    os.net.send_frame(iface.index, frame);
  }

  function send_request() {
    if (iface.mac === undefined) return;

    const chaddr = new Uint8Array(16);
    {
      const $ = new DataView(chaddr.buffer);
      $.setBigUint64(0, iface.mac << 16n);
    }

    const frame: TEthernetFrame = {
      dst: MAC_BROADCAST,
      src: iface.mac,
      etherType: ETHER_TYPES.IPv4,
      payload: pack_ip4_packet({
        header: {
          version: 4,
          dst: IP_BROADCAST,
          src: 0,
          protocol: IP_PROTOCOLS.UDP,
          ttl: 64,
          checksum: 0,
          flags: 0,
          id: 0,
          ihl: 0,
          length: 0,
          offset: 0,
          options: [],
          tos: 0,
        },
        payload: pack_udp_packet({
          header: {
            src: 68,
            dst: 67,
            length: 0,
            checksum: 0,
          },
          payload: pack_dhcp_packet({
            header: {
              op: DHCP_OPS.REQUEST,
              htype: 1,
              hlen: 6,
              chaddr,
              xid,
              flags: 0,
              hops: 0,
              secs: 0,
              file: new Uint8Array(0),
              sname: new Uint8Array(0),
              ciaddr: 0,
              yiaddr: 0,
              giaddr: 0,
              siaddr: 0,
              options: [
                { type: DHCP_OPTIONS.MESSAGE_TYPE, data: new Uint8Array([DHCP_TYPES.REQUEST]) },
                { type: DHCP_OPTIONS.REQUESTED_IP, data: uint32(requested_ip) },
                { type: DHCP_OPTIONS.SERVER_ID, data: uint32(server_id) },
              ],
            },
          }),
        }),
      }),
    };

    os.net.send_frame(iface.index, frame);
  }

  function save_options(packet: TDhcpPacket) {
    const server_id_opt = get_option(DHCP_OPTIONS.SERVER_ID, packet);
    if (server_id_opt) {
      server_id = new DataView(server_id_opt.buffer, server_id_opt.byteOffset).getUint32(0);
    }

    const mask_opt = get_option(DHCP_OPTIONS.SUBNET_MASK, packet);
    if (mask_opt) {
      mask = new DataView(mask_opt.buffer, mask_opt.byteOffset).getUint32(0);
    }

    const lease_opt = get_option(DHCP_OPTIONS.LEASE_TIME, packet);
    if (lease_opt) {
      lease_time = new DataView(lease_opt.buffer, lease_opt.byteOffset).getUint32(0);
    }

    const router_opt = get_option(DHCP_OPTIONS.ROUTER, packet);
    if (router_opt) {
      router = new DataView(router_opt.buffer, router_opt.byteOffset).getUint32(0);
    }
  }

  const socket = os.net.socket.create("udp");
  os.net.socket.bind(socket, 0, 68);

  socket.on_error = (error) => os.print(`Socket error: ${error}\n`);

  try {
    await new Promise((resolve, reject) => {
      socket.on_error = (e) => reject(new Error(`Socket error: ${e}`));
      socket.on_recv = (recv) => {
        const { data: payload, iface: _iface } = recv;
        if (iface.index !== _iface.index) return;

        const packet = unpack_dhcp_packet(payload);
        if (packet.header.xid !== xid) return;

        const type_opt = get_option(DHCP_OPTIONS.MESSAGE_TYPE, packet);
        if (!type_opt) return;
        const type = type_opt[0];

        if (state === "discovering") {
          if (type === DHCP_TYPES.OFFER) {
            requested_ip = packet.header.yiaddr;
            save_options(packet);

            if (server_id !== -1 && mask !== -1 && lease_time !== -1) {
              state = "requesting";
              refresh_xid();
              send_request();
            } else {
              reset(); // FIXME:
            }
          }
        } else if (state === "requesting") {
          if (type === DHCP_TYPES.ACK) {
            save_options(packet);

            os.exec("iface", [iface.name, "add", `${formatIPv4(packet.header.yiaddr)}/${maskToPrefix(mask)}`]);
            os.exec("route", ["add", `${formatIPv4(packet.header.yiaddr)}/${maskToPrefix(mask)}`, "dev", iface.name]);

            if (router !== -1) {
              os.exec("route", ["add", "default", "via", formatIPv4(router)]);
            }

            state = "leasing";
          } else {
            reset(); // FIXME:
          }
        } else {
          // FIXME:
        }
      };

      state = "discovering";
      refresh_xid();
      send_discover();
    });
  } finally {
    os.net.socket.delete(socket);
  }
}
