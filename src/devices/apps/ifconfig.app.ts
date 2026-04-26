import { formatIPv4, formatMAC, parseIPv4 } from "../format";
import type { OS } from "../os";

function _validate_ip(ip: string) {
  if (!/\d+\.\d+\.\d+\.\d+/.test(ip)) return false;
  for (const part of ip[0].split(".")) {
    const int = parseInt(part);
    if (int > 255) return false;
  }
  return true;
}

function _validate_address(address: string) {
  if (!/\d+\.\d+\.\d+\.\d+\/\d+/.test(address)) return false;
  const parts = address.split("/");
  const prefix = parseInt(parts[1]);
  if (prefix > 32) return false;
  if (!_validate_ip(parts[0])) return false;
  return true;
}

function _get_iface(os: OS, name: string) {
  return os._netInterfaces.find((p) => p.name === name);
}
function _get_iface_index(os: OS, name: string) {
  return os._netInterfaces.findIndex((p) => p.name === name);
}

function _print_interface(os: OS, name: string) {
  const iInterface = _get_iface_index(os, name);
  const iface = _get_iface(os, name);

  if (!iface) {
    os.print("Interface not found\n");
    return;
  }

  os.print(
    [
      `${iface.name}: <${[iface.isBridge && "BRIDGE", iface.iMasterInterface ? "SLAVE" : undefined].filter(Boolean).join(",")}>`,
      iface.mac && `ether ${formatMAC(iface.mac)}`,
      iface.ips?.map((ip) => `inet ${formatIPv4(ip.address)}/${ip.prefix}`).join("\n\t"),
      ...os._netInterfaces
        .filter((other) => other.iMasterInterface === iInterface)
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
    const ip = args.shift();
    if (!ip) throw new Error(`Usage: ${name} ${op} <ip/prefix>`);
    if (!_validate_address(ip)) throw new Error(`Invalid address ${ip}`);

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
  } else if (op === "flush") {
    iface.ips = [];
  } else {
    throw new Error(["Usage:", "\t<interface> (add|del) <ip/prefix>", "\t<interface> flush"].join("\n"));
  }
}

export function route(os: OS, args: string[]) {
  const op = args.shift();
  if (!op) {
    os.print("Routes:\n");
    for (let i = 0; i < os._netRoutes.length; i++) {
      const route = os._netRoutes[i];
      const iface = os._netInterfaces[route.iInterface];
      os.print(
        [
          "\t",
          route.prefix === 0 ? "default" : `${formatIPv4(route.network)}/${route.prefix}`,
          route.gateway !== undefined && `via ${formatIPv4(route.gateway)}`,
          `dev ${iface.name}`,
        ]
          .filter(Boolean)
          .join(" "),
        "\n",
      );
    }
  } else if (op === "add") {
    if (args[0] === "default" && args[1] === "via" && _validate_ip(args[2]) && args[3] === "dev" && args[4]) {
      const iface_index = _get_iface_index(os, args[4]);
      if (iface_index === -1) throw new Error("Interface not found");

      os._netRoutes.push({
        network: 0,
        prefix: 0,
        iInterface: iface_index,
        gateway: parseIPv4(args[2]),
      });
    } else if (_validate_address(args[0]) && args[1] === "dev" && args[2]) {
      const network = args[0].split("/");
      const network_ip = parseIPv4(network[0]);
      const network_prefix = parseInt(network[1]);

      const iface_index = _get_iface_index(os, args[2]);
      if (iface_index === -1) throw new Error("Interface not found");

      os._netRoutes.push({
        network: network_ip,
        prefix: network_prefix,
        iInterface: iface_index,
      });
    } else {
      throw new Error("Usage: add <network/prefix> via <gateway>");
    }
  }
}
