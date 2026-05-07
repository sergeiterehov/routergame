import {
  formatIPv4,
  formatMAC,
  parseIPv4,
  parseMAC,
  prefixToMask,
  validate_address,
  validate_ip,
  validate_mac,
} from "../format";
import type { OS } from "../os";

function test_args(args: string[], ...ps: unknown[]) {
  if (ps.length > args.length) return false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (typeof ps[i] === "string" && p === args[i]) continue;
    if (typeof p === "function" && p(args[i])) continue;
    return false;
  }
  return true;
}

function find_arg(args: string[], key: string, initial: string = "") {
  for (let i = 1; i < args.length; i++) {
    if (args[i] === key && args[i + 1]) {
      return args[i + 1];
    }
  }

  return initial;
}

function _get_iface(os: OS, name: string) {
  return os._netInterfaces.find((p) => p.name === name);
}

function _print_interface(os: OS, name: string) {
  const iface = _get_iface(os, name);

  if (!iface) {
    os.print("Interface not found\n");
    return;
  }

  os.print(
    [
      `${iface.name}: <${["UP", iface.type.toUpperCase(), iface.iMasterInterface ? "SLAVE" : undefined].filter(Boolean).join(",")}>`,
      iface.mac && `ether ${formatMAC(iface.mac)}`,
      iface.ips?.map((ip) => `inet ${formatIPv4(ip.address)}/${ip.prefix}`).join("\n\t"),
      ...os._netInterfaces
        .filter((other) => other.iMasterInterface === iface.index)
        .map((other) => `member: ${other.name}`),
    ]
      .filter(Boolean)
      .join("\n\t"),
    "\n",
  );
}

function _print_interfaces(os: OS) {
  for (let i = 0; i < os._netInterfaces.length; i++) {
    const iface = os._netInterfaces[i];
    _print_interface(os, iface.name);
  }
}

export function iface(os: OS, args: string[]) {
  const name = args.shift();
  if (!name) return _print_interfaces(os);

  const iface = _get_iface(os, name);
  if (!iface) throw new Error(`Interface ${name} not found`);

  const op = args.shift();
  if (!op) return _print_interface(os, name);

  if (op === "add" || op === "del") {
    if (iface.iMasterInterface !== undefined) throw new Error("Interface is slave");

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

    os.net_change_mac(iface.index, parseMAC(mac));
  } else if (op === "flush") {
    iface.ips = [];
  } else {
    throw new Error(["Usage:", "\t<interface> (add|del) <ip/prefix>", "\t<interface> flush"].join("\n"));
  }
}

export function route(os: OS, args: string[]) {
  const op = args.shift();
  if (!op) {
    for (let i = 0; i < os._netRoutes.length; i++) {
      const route = os._netRoutes[i];
      const iface = os._netInterfaces[route.iInterface];
      os.print(
        [
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
        const _via_route = os.net_ip4_route(parseIPv4(_via));
        if (!_via_route) throw new Error("Gateway is unreachable");

        if (!_dev) _dev = os._netInterfaces[_via_route.iInterface].name;
      }

      const network_parts = _network.split("/");
      const network_prefix = parseInt(network_parts[1]);
      const network_ip = (parseIPv4(network_parts[0]) & prefixToMask(network_prefix)) >>> 0;

      const _src = find_arg(args, "src");
      if (!_dev && !_src) throw new Error("Device or source IP is required");

      if (!_dev) {
        const src = parseIPv4(_src);
        for_iface: for (const iface of os._netInterfaces) {
          for (const ip of iface.ips) {
            if (ip.address === src) {
              _dev = iface.name;
              break for_iface;
            }
          }
        }
        if (!_dev) throw new Error(`Interface with ${_src} not found`);
      }

      const iface = _get_iface(os, _dev);
      if (!iface) throw new Error("Interface not found");

      if (_src) {
        const src = parseIPv4(_src);
        let _ip = -1;
        for (const ip of os._netInterfaces[iface.index].ips) {
          if (ip.address === src) {
            _ip = ip.address;
            break;
          }
        }
        if (_ip === -1) throw new Error(`Interface ${_dev} has not IP ${_src}`);
      }

      for (const route of os._netRoutes) {
        if (route.network === network_ip && route.prefix === network_prefix) {
          throw new Error("Route already exists");
        }
      }

      os._netRoutes.push({
        network: network_ip,
        prefix: network_prefix,
        iInterface: iface.index,
        gateway: _via ? parseIPv4(_via) : undefined,
        src: _src ? parseIPv4(_src) : undefined,
      });
    } else {
      throw new Error("Usage: add <network/prefix> [dev <interface>] [src <ip>]");
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
      const network_prefix = parseInt(network_parts[1]);
      const network_ip = (parseIPv4(network_parts[0]) & prefixToMask(network_prefix)) >>> 0;

      for (let i = 0; i < os._netRoutes.length; i++) {
        const route = os._netRoutes[i];
        if (route.network === network_ip && route.prefix === network_prefix) {
          os._netRoutes.splice(i, 1);
          os.print("deleted\n");
          break;
        }
      }
    } else {
      throw new Error("Usage: del <network/prefix>");
    }
  } else {
    throw new Error("Usage:\nadd ...\ndel ...");
  }
}

export function br(os: OS, args: string[]) {
  const op = args.shift();

  if (!op) {
    for (const _br of os._netInterfaces) {
      if (_br.type !== "bridge") continue;
      os.print(`${_br.name}:\n`);
      for (const _iface of os._netInterfaces) {
        if (_iface.iMasterInterface !== _br.index) continue;
        os.print(`\t${_iface.name}\n`);
      }
    }

    return;
  }

  if (op === "add") {
    if (test_args(args, Boolean)) {
      const name = args.shift()!;
      for (const _br of os._netInterfaces) {
        if (_br.name === name) throw new Error("Bridge already exists");
      }

      const slaves = args.map((_name) => {
        const _slave = _get_iface(os, _name);
        if (!_slave) throw new Error(`Interface ${_name} not found`);
        if (_slave.iMasterInterface !== undefined) throw new Error(`Interface ${_name} is already a slave`);
        if (_slave.type === "bridge") throw new Error(`Interface ${_name} is a bridge`);
        return _slave;
      });

      const index = os.net_add_interface("bridge", name, -1);
      const br = os._netInterfaces[index];

      br.mac = 0n;

      for (const slave of slaves) {
        slave.ips.splice(0);

        for (let r = 0; r < os._netRoutes.length; r += 1) {
          if (os._netRoutes[r].iInterface !== slave.index) continue;
          os._netRoutes.splice(r, 1);
          r -= 1;
        }

        for (let a = 0; a < os._netARPTable.length; a += 1) {
          if (os._netARPTable[a].iInterface !== slave.index) continue;
          os._netARPTable.splice(a, 1);
          a -= 1;
        }

        slave.iMasterInterface = br.index;

        if (slave.mac !== undefined && br.mac === 0n) br.mac = slave.mac;
      }

      return;
    }

    return;
  }
}
