import {
  formatIPv4,
  formatMAC,
  parseIPv4,
  parseMAC,
  prefixToMask,
  SEC,
  validate_address,
  validate_ip,
  validate_mac,
} from "../format";
import type { TIPIPTun } from "../os/ipip";
import type { TIPIPUDPTun } from "../os/ipip-udp";
import type { TInterface } from "../os/net";
import type { OS, TApp, TAppContext } from "../os/os";
import { find_arg, find_args, has_arg, run_command_of, test_args } from "./app.lib";

const _ALL_FLAGS: Required<TInterface["flags"]> = {
  UP: true,
  RUNNING: true,
  LOOPBACK: true,
  PROMISC: true,
  SLAVE: true,
  MASTER: true,
  POINTTOPOINT: true,
};
const _FLAG_NAMES = Object.keys(_ALL_FLAGS) as (keyof typeof _ALL_FLAGS)[];

function _print_interface(os: OS, name: string) {
  const iface = os.net.iface_by_name(name);

  if (!iface) {
    os.print("Interface not found\n");
    return;
  }

  os.print(
    [
      `${iface.name}: <${_FLAG_NAMES.filter((k) => iface.flags[k]).join()}>`,
      iface.mac && `ether ${formatMAC(iface.mac)}`,
      iface.ips?.map((ip) => `inet ${formatIPv4(ip.address)}/${ip.prefix}`).join("\n\t"),
      ...os.net._interfaces
        .filter((other) => other.iMasterInterface === iface.index)
        .map((other) => `member: ${other.name}`),
    ]
      .filter(Boolean)
      .join("\n\t"),
    "\n",
  );
}

function _print_interfaces(os: OS) {
  for (let i = 0; i < os.net._interfaces.length; i++) {
    const iface = os.net._interfaces[i];
    _print_interface(os, iface.name);
  }
}

function _print_bridge(os: OS, br_iface: TInterface) {
  if (!br_iface || br_iface.type !== "bridge") return;

  const bridge = os.net.br.get_bridge(br_iface.index);

  os.print(`${br_iface.name} (VLAN=${bridge.vlan_filtering ? "ON" : "OFF"}, PVID=${bridge.pvid}):\n`);

  for (const port of bridge.ports) {
    const _iface = os.net.iface(port.iPort);

    os.print(
      `\t${_iface.name}: PVID=${port.pvid}, tagged=[${port.tagged.join(",")}], untagged=[${port.untagged.join(",")}]\n`,
    );
  }

  if (bridge.vlans.length) {
    os.print("\tVLANS:\n");

    for (const vlan of bridge.vlans) {
      const _iface = os.net.iface(vlan.iVlan);

      os.print(`\t\t${_iface.name}: PVID=${vlan.vid}\n`);
    }
  }
}

function _validate_vlan_id(vid: number) {
  return !Number.isNaN(vid) && vid > 0 && vid < 4095;
}

function _flush_interface(os: OS, iface: TInterface) {
  iface.ips.splice(0);

  for (let r = 0; r < os.net.ip4._routes.length; r += 1) {
    if (os.net.ip4._routes[r].iInterface !== iface.index) continue;
    os.net.ip4._routes.splice(r, 1);
    r -= 1;
  }

  for (let a = 0; a < os.net.arp._table.length; a += 1) {
    if (os.net.arp._table[a].iInterface !== iface.index) continue;
    os.net.arp._table.splice(a, 1);
    a -= 1;
  }
}

export const iface: TApp = async (os, args, ctx) => {
  const name = args.shift();
  if (!name) return _print_interfaces(os);

  const iface = os.net.iface_by_name(name);
  if (!iface) throw new Error(`Interface ${name} not found`);

  const op = args.shift();
  if (!op) return _print_interface(os, name);

  if (iface.type === "loopback") throw new Error("Loopback interface is readonly");

  if (op === "add" || op === "del") {
    const ip = args.shift();
    if (!ip) throw new Error(`Usage: ${name} ${op} <ip/prefix>`);
    if (!validate_address(ip)) throw new Error(`Invalid address ${ip}`);

    const _ipaddr = ip.split("/");
    const _ip = parseIPv4(_ipaddr[0]);
    const _prefix = parseInt(_ipaddr[1]);

    const ip_index = iface.ips.findIndex((p) => p.address === _ip);

    if (op === "add") {
      if (ip_index !== -1) throw new Error("IP already exists");
      iface.ips.push({ address: _ip, prefix: _prefix });
    } else if (op === "del") {
      if (ip_index === -1) throw new Error("IP not found");
      iface.ips.splice(ip_index, 1);
    }
  } else if (op === "mac") {
    if (iface.mac === undefined) throw new Error("Mac is unsupported");

    const mac = args.shift();
    if (!mac) return os.print(`${formatMAC(iface.mac) || ""}\n`);
    if (!validate_mac(mac)) throw new Error("Mac is invalid");

    os.net.change_mac(iface.index, parseMAC(mac));
  } else if (op === "up") {
    iface.flags.UP = true;
  } else if (op === "flush") {
    iface.ips = [];
  } else if (op === "down") {
    // clear routes
    for (let i = os.net.ip4._routes.length - 1; i >= 0; i--) {
      if (os.net.ip4._routes[i].iInterface === iface.index) {
        os.net.ip4._routes.splice(i, 1);
      }
    }

    // clear arp
    for (let i = os.net.arp._table.length - 1; i >= 0; i--) {
      if (os.net.arp._table[i].iInterface === iface.index) {
        os.net.arp._table.splice(i, 1);
      }
    }

    // clear fdb
    if (iface.type === "bridge") {
      for (let i = os.net.br._fdb.length - 1; i >= 0; i--) {
        if (os.net.br._fdb[i].iBridge === iface.index) {
          os.net.br._fdb.splice(i, 1);
        }
      }
    } else {
      for (let i = os.net.br._fdb.length - 1; i >= 0; i--) {
        if (os.net.br._fdb[i].iPort === iface.index) {
          os.net.br._fdb.splice(i, 1);
        }
      }
    }

    iface.flags.UP = false;
  } else if (op === "wait") {
    if (test_args(args, "link")) {
      args.shift();

      const timeout = Number(find_arg(args, "-t", "1"));
      if (Number.isNaN(timeout) || timeout < 0) throw new Error("Invalid timeout");

      const signal = AbortSignal.any([AbortSignal.timeout(timeout * SEC), ctx.signal]);

      while (!signal.aborted) {
        if (iface.flags.RUNNING) {
          os.print(`Ok, ${iface.name} is LOWER_UP\n`);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error(`Timeout, ${iface.name} not LOWER_UP`);
    } else {
      throw new Error("usage: iface <interface> wait link [-t timeout_s]");
    }
  } else if (op === "rename") {
    if (test_args(args, Boolean)) {
      const name = args.shift()!;
      if (os.net.iface_by_name(name)) throw new Error(`Interface ${name} already exists`);

      iface.name = name;
    } else {
      throw new Error("usage: iface <interface> rename <new_name>");
    }
  } else {
    throw new Error(
      [
        `Interface ${name} not found`,
        "Usage:",
        "\t<interface> (up|down)",
        "\t<interface> (add|del) <ip/prefix>",
        "\t<interface> flush",
        "\t<interface> wait",
        "\t<interface> rename",
      ].join("\n"),
    );
  }
};

export async function route(os: OS, args: string[]) {
  const op = args.shift();
  if (!op) {
    for (let i = 0; i < os.net.ip4._routes.length; i++) {
      const route = os.net.ip4._routes[i];
      const iface = os.net._interfaces[route.iInterface];
      os.print(
        [
          `${i + 1})`,
          route.prefix === 0 ? "default" : `${formatIPv4(route.network)}/${route.prefix}`,
          route.gateway !== undefined && `via ${formatIPv4(route.gateway)}`,
          `dev ${iface.name}`,
          route.src !== undefined && `src ${formatIPv4(route.src)}`,
        ]
          .filter(Boolean)
          .join(" "),
        "\n",
      );
    }
  } else if (op === "add") {
    if (test_args(args, "default") || test_args(args, validate_address)) {
      let _network: string | undefined;
      let _dev = find_arg(args, "dev");
      const _via = find_arg(args, "via");

      if (args[0] === "default") {
        _network = "0.0.0.0/0";
      } else {
        _network = args[0];
      }

      if (_via) {
        if (!validate_ip(_via)) throw new Error("Invalid gateway");
        const _via_route = os.net.ip4.route(parseIPv4(_via));
        if (!_via_route) throw new Error("Gateway is unreachable");

        if (!_dev) _dev = os.net._interfaces[_via_route.iInterface].name;
      }

      const network_parts = _network.split("/");
      const network_prefix = parseInt(network_parts[1]);
      const network_ip = (parseIPv4(network_parts[0]) & prefixToMask(network_prefix)) >>> 0;

      const _src = find_arg(args, "src");
      if (!_dev && !_src) throw new Error("Device or source IP is required");

      if (!_dev) {
        const src = parseIPv4(_src);
        for_iface: for (const iface of os.net._interfaces) {
          for (const ip of iface.ips) {
            if (ip.address === src) {
              _dev = iface.name;
              break for_iface;
            }
          }
        }
        if (!_dev) throw new Error(`Interface with ${_src} not found`);
      }

      const iface = os.net.iface_by_name(_dev);
      if (!iface) throw new Error("Interface not found");

      if (_src) {
        const src = parseIPv4(_src);
        let _ip = -1;
        for (const ip of os.net._interfaces[iface.index].ips) {
          if (ip.address === src) {
            _ip = ip.address;
            break;
          }
        }
        if (_ip === -1) throw new Error(`Interface ${_dev} has not IP ${_src}`);
      }

      for (const route of os.net.ip4._routes) {
        if (route.network === network_ip && route.prefix === network_prefix) {
          throw new Error("Route already exists");
        }
      }

      const _before = find_arg(args, "before");
      let index = Number.parseInt(_before, 10) - 1;
      if (Number.isNaN(index)) {
        index = os.net.ip4._routes.length;
      } else if (index < 0 || index >= os.net.ip4._routes.length) {
        throw new Error("Invalid index");
      }

      os.net.ip4._routes.splice(index, 0, {
        network: network_ip,
        prefix: network_prefix,
        iInterface: iface.index,
        gateway: _via ? parseIPv4(_via) : undefined,
        src: _src ? parseIPv4(_src) : undefined,
      });
    } else {
      throw new Error("Usage: add <network/prefix> [dev <interface>] [src <ip>] [before <number>]");
    }
  } else if (op === "del") {
    if (test_args(args, "default") || test_args(args, validate_address)) {
      let _network: string | undefined;

      if (args[0] === "default") {
        _network = "0.0.0.0/0";
      } else {
        _network = args[0];
      }

      const network_parts = _network.split("/");
      const network_prefix = Number.parseInt(network_parts[1], 10);
      const network_ip = (parseIPv4(network_parts[0]) & prefixToMask(network_prefix)) >>> 0;

      for (let i = 0; i < os.net.ip4._routes.length; i++) {
        const route = os.net.ip4._routes[i];
        if (route.network === network_ip && route.prefix === network_prefix) {
          os.net.ip4._routes.splice(i, 1);
          os.print("deleted\n");
          break;
        }
      }
    } else {
      throw new Error("Usage: del <network/prefix>");
    }
  } else if (op === "move") {
    if (test_args(args, Boolean, "before", Boolean)) {
      const _from = Number.parseInt(args[0], 10);
      const _to = Number.parseInt(args[2], 10);
      if (Number.isNaN(_from) || Number.isNaN(_to)) throw new Error("Invalid number");
      if (_from < 1 || _from > os.net.ip4._routes.length || _to < 1 || _to > os.net.ip4._routes.length) {
        throw new Error(`Index out of range 1..${os.net.ip4._routes.length}`);
      }

      if (_from === _to) return;
      if (_from < _to) {
        os.net.ip4._routes.splice(_to - 1, 0, os.net.ip4._routes[_from - 1]);
        os.net.ip4._routes.splice(_from - 1, 1);
      } else {
        os.net.ip4._routes.splice(_to - 1, 0, os.net.ip4._routes[_from - 1]);
        os.net.ip4._routes.splice(_from, 1);
      }
    } else {
      throw new Error("Usage: move <number> before <number>");
    }
  } else if (op === "find") {
    if (test_args(args, validate_ip)) {
      const ip = parseIPv4(args[0]);

      const route = os.net.ip4.route(ip);
      if (!route) throw new Error("No route found");

      os.print(
        [
          formatIPv4(ip),
          `[${formatIPv4(route.network)}/${route.prefix}]`,
          `src ${formatIPv4(route.src)} via ${formatIPv4(route.gateway)}`,
          os.net.iface(route.iInterface).name,
        ].join(" -> "),
        "\n",
      );
    } else {
      throw new Error("Usage: find <ip>");
    }
  } else {
    throw new Error("Usage:\nadd ...\ndel ...\nmove ...\nfind ...");
  }
}

export async function br(os: OS, args: string[]) {
  if (!args.length) {
    for (const _br of os.net._interfaces) {
      if (_br.type !== "bridge") continue;
      _print_bridge(os, _br);
    }

    return;
  }

  if (test_args(args, "add", Boolean)) {
    args.shift();

    const name = args.shift()!;
    for (const _br of os.net._interfaces) {
      if (_br.name === name) throw new Error("Bridge already exists");
    }

    const slaves = args.map((_name) => {
      const _slave = os.net.iface_by_name(_name);
      if (!_slave) throw new Error(`Interface ${_name} not found`);
      if (_slave.iMasterInterface !== undefined) throw new Error(`Interface ${_name} is already a slave`);
      if (_slave.type === "bridge") throw new Error(`Interface ${_name} is a bridge`);
      return _slave;
    });

    const br_iface = os.net.add_interface("bridge", name, -1);

    br_iface.mac = 0n;
    br_iface.flags.MASTER = true;
    br_iface.flags.RUNNING = true;

    os.net.br._bridges.push({
      iBridge: br_iface.index,
      ports: [],
      vlans: [],
      pvid: os.net.br._default_vlan_id,
      vlan_filtering: false,
    });

    const bridge = os.net.br.get_bridge(br_iface.index);

    for (const port_iface of slaves) {
      _flush_interface(os, port_iface);
      port_iface.iMasterInterface = br_iface.index;
      port_iface.flags.PROMISC = true;
      port_iface.flags.SLAVE = true;

      bridge.ports.push({
        iPort: port_iface.index,
        pvid: bridge.pvid,
        untagged: [],
        tagged: [],
      });

      if (port_iface.mac !== undefined && br_iface.mac === 0n) {
        br_iface.mac = port_iface.mac;
      }
    }

    return;
  }

  const _br_name = args.shift()!;
  const br_iface = os.net.iface_by_name(_br_name);
  if (!br_iface) throw new Error(`Interface ${_br_name} not found`);
  if (br_iface.type !== "bridge") throw new Error("Interface is not a bridge");

  const bridge = os.net.br.get_bridge(br_iface.index);

  if (!args.length) {
    _print_bridge(os, br_iface);
    return;
  }

  if (test_args(args, "set")) {
    const _vlan = find_arg(args, "-v");
    if (_vlan === "on") {
      bridge.vlan_filtering = true;
    } else if (_vlan === "off") {
      bridge.vlan_filtering = false;
    } else {
      throw new Error("usage: -v on|off");
    }

    const _pvid = find_arg(args, "-p", "");
    const pvid = _pvid ? Number(_pvid) : undefined;
    if (pvid !== undefined && !_validate_vlan_id(pvid)) throw new Error("Invalid PVID");

    if (pvid) bridge.pvid = pvid;

    return;
  }

  if (test_args(args, "add", Boolean)) {
    const _port_name = args[1];
    const port_iface = os.net.iface_by_name(_port_name);
    if (!port_iface) throw new Error(`Interface ${_port_name} not found`);

    try {
      if (os.net.br.get_port(port_iface.index)) throw new Error(`Interface ${_port_name} is already a port`);
    } catch {
      // ok
    }

    if (port_iface.iMasterInterface !== undefined) throw new Error(`Interface ${_port_name} is already a slave`);
    if (port_iface.type === "bridge") throw new Error(`Interface ${_port_name} is a bridge`);

    const tagged = find_args(args, "-t").map(Number);
    if (!tagged.every(_validate_vlan_id)) throw new Error("Invalid tagged VLAN ID");
    const untagged = find_args(args, "-u").map(Number);
    if (!untagged.every(_validate_vlan_id)) throw new Error("Invalid untagged VLAN ID");

    const _pvid = find_arg(args, "-p", bridge.pvid.toString());
    const pvid = Number(_pvid);
    if (!_validate_vlan_id(pvid)) throw new Error("Invalid PVID");

    _flush_interface(os, port_iface);
    port_iface.iMasterInterface = br_iface.index;

    bridge.ports.push({
      iPort: port_iface.index,
      pvid,
      untagged,
      tagged,
    });

    if (port_iface.mac !== undefined && br_iface.mac === 0n) {
      br_iface.mac = port_iface.mac;
    }

    return;
  }

  if (test_args(args, "vlan", "add", Boolean)) {
    args.splice(0, 2);

    const vlan_name = args.shift()!;
    if (os.net.iface_by_name(vlan_name)) throw new Error(`Interface ${vlan_name} already exists`);

    const _vid = find_arg(args, "-v", bridge.pvid.toString());
    const vid = Number(_vid);
    if (!_validate_vlan_id(vid)) throw new Error("Invalid VLAN ID");

    if (bridge.vlans.some((v) => v.vid === vid)) throw new Error(`VLAN ${vid} already exists`);

    const vlan_iface = os.net.add_interface("vlan", vlan_name, -1);
    vlan_iface.iMasterInterface = br_iface.index;
    vlan_iface.mac = br_iface.mac;
    bridge.vlans.push({ iVlan: vlan_iface.index, vid });

    return;
  }

  const port_name = args.shift()!;
  const port_iface = os.net.iface_by_name(port_name);
  if (!port_iface) throw new Error(`Interface ${port_name} not found`);
  const port = os.net.br.get_port(port_iface.index);
  if (!bridge.ports.includes(port)) throw new Error(`Interface ${port_name} is not a port`);

  if (test_args(args, "set")) {
    const tagged = has_arg(args, "-t") ? find_args(args, "-t").map(Number) : undefined;
    if (tagged && !tagged?.every(_validate_vlan_id)) throw new Error("Invalid tagged VLAN ID");
    const untagged = has_arg(args, "-u") ? find_args(args, "-u").map(Number) : undefined;
    if (untagged && !untagged?.every(_validate_vlan_id)) throw new Error("Invalid untagged VLAN ID");

    const _pvid = find_arg(args, "-p", "");
    const pvid = _pvid ? Number(_pvid) : undefined;
    if (pvid !== undefined && !_validate_vlan_id(pvid)) throw new Error("Invalid PVID");

    if (pvid) port.pvid = pvid;
    if (tagged) port.tagged = tagged;
    if (untagged) port.untagged = untagged;
  }
}

async function _tun_ipip_add(os: OS, config: { name: string; local_ip: string; remote_ip: string }, ctx: TAppContext) {
  const { local_ip, name, remote_ip } = config;

  if (os.net.iface_by_name(name)) throw new Error(`Interface ${name} already exists`);

  const iface = os.net.add_interface("ipip", name, -1);
  iface.flags.POINTTOPOINT = true;
  iface.flags.RUNNING = true;

  const tun: TIPIPTun = {
    iInterface: iface.index,
    local_ip: parseIPv4(local_ip),
    remote_ip: parseIPv4(remote_ip),
  };
  os.net.ip4.ipip._tuns.push(tun);

  return;
}

const _tun_ipip: TApp = async (os, args, ctx) => {
  await run_command_of(
    os,
    {
      add: {
        desc: "Add IPIP tunnel",
        args: [
          { alias: "name", type: "string", required: true },
          { name: "local", type: "ip", required: true, desc: "Local IP address" },
          { name: "remote", type: "ip", required: true, desc: "Remote IP address" },
        ],
        fn: (_args, parsed) =>
          _tun_ipip_add(
            os,
            {
              name: parsed.name![0],
              local_ip: parsed.local![0],
              remote_ip: parsed.remote![0],
            },
            ctx,
          ),
      },
    },
    args,
  );
};

const _tun_ipip_udp_add = async (
  os: OS,
  config: {
    name: string;
    local_ip: number;
    remote_ip: number;
    local_port: number;
    remote_port: number;
    active: boolean;
    passive: boolean;
  },
  ctx: TAppContext,
) => {
  const { passive, active, local_ip, local_port, name, remote_ip, remote_port } = config;

  if (os.net.iface_by_name(name)) throw new Error(`Interface ${name} already exists`);
  if (local_port <= 0 || local_port > 65535) throw new Error("Invalid local port");
  if (remote_port <= 0 || remote_port > 65535) throw new Error("Invalid remote port");

  const iface = os.net.add_interface("ipip-udp", name, -1);
  iface.flags.POINTTOPOINT = true;
  iface.flags.RUNNING = !passive && !active;

  const tun: TIPIPUDPTun = {
    iInterface: iface.index,
    local_ip,
    remote_ip,
    local_port,
    remote_port,
    passive,
    active,
    last_ping_at: 0,
  };
  os.net.ip4.ipip_udp._tuns.push(tun);

  return;
};

const _tun_ipip_udp: TApp = async (os, args, ctx) => {
  await run_command_of(
    os,
    {
      add: {
        desc: "Add IPIP UDP tunnel",
        args: [
          { alias: "name", type: "string", required: true },
          { name: "local", type: "ip", required: true, desc: "Local IP address" },
          { name: "local-port", type: "number", required: true, desc: "Local port" },
          { name: "remote", type: "ip", required: true, desc: "Remote IP address" },
          { name: "remote-port", type: "number", required: true, desc: "Remote port" },
          { name: "--active", type: "flag", desc: "Periodic sending ping-packet to keep connection alive" },
          {
            name: "--passive",
            type: "flag",
            desc: "Wait for incoming packets on local-port, saving and updating remote address information",
          },
        ],
        fn: (_args, parsed) =>
          _tun_ipip_udp_add(
            os,
            {
              name: parsed.name![0],
              local_ip: parseIPv4(parsed.local![0]),
              remote_ip: parseIPv4(parsed.remote![0]),
              local_port: Number(parsed["local-port"]![0]),
              remote_port: Number(parsed["remote-port"]![0]),
              active: Boolean(parsed.active),
              passive: Boolean(parsed.passive),
            },
            ctx,
          ),
      },
    },
    args,
  );
};

export const tun: TApp = async (os, args, ctx) => {
  await run_command_of(
    os,
    {
      ipip: {
        desc: "IPIP tunnel",
        fn: (_args) => _tun_ipip(os, _args, ctx),
      },
      "ipip-udp": {
        desc: "IPIP UDP tunnel. Supports passive mode, for automatic remote address update.",
        fn: (_args) => _tun_ipip_udp(os, _args, ctx),
      },
    },
    args,
  );
};
