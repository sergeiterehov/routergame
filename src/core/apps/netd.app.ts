import z from "zod";
import type { OS, TApp } from "../os/os";
import { formatIPv4, parseCIDRv4, parseIPv4, prefixToMask } from "../format";
import type { TBridge, TBridgePort } from "../os/br";
import { FW_ACTIONS, FW_CHAINS, FW_CONN_STATES, FW_TABLES, type TPredicate, type TRule } from "../os/fw";
import { IP_PROTOCOLS } from "../pack";
import { INTERFACE_TYPES, type TInterface } from "../os/net";
import type { TRoute } from "../os/ip4";
import { with_commander } from "./app.lib";

const _CONF_PATH = "/netd.json";

const _name_regexp = /^[a-z_]+(-?[a-z_0-9]+)*$/i;

let _started = false;

const z_conf = z.object({
  interfaces: z.array(
    z.object({
      id: z.string(),
      ref: z.custom<TInterface>(),
      dynamic: z.boolean().optional(),
      name: z.string().regex(_name_regexp),
      type: z.union([
        z.object({ type: z.literal(INTERFACE_TYPES.LOOPBACK) }),
        z.object({ type: z.literal(INTERFACE_TYPES.ETHERNET), up: z.boolean() }),
        z.object({
          type: z.literal(INTERFACE_TYPES.BRIDGE),
          up: z.boolean(),
          pvid: z.number(),
          vlan_filtering: z.boolean(),
        }),
        z.object({
          type: z.literal(INTERFACE_TYPES.VLAN),
          up: z.boolean(),
          bridge_interface_id: z.string(),
          vid: z.number(),
        }),
      ]),
    }),
  ),
  bridge_ports: z.array(
    z.object({
      id: z.string(),
      ref: z.custom<TBridgePort>(),
      dynamic: z.boolean().optional(),
      bridge_id: z.string(),
      port_id: z.string(),
      pvid: z.number(),
      tagged: z.array(z.number()),
      untagged: z.array(z.number()),
    }),
  ),
  ips: z.array(
    z.object({
      id: z.string(),
      dynamic: z.boolean().optional(),
      interface_id: z.string(),
      address: z.cidrv4(),
    }),
  ),
  ip_routes: z.array(
    z.object({
      id: z.string(),
      ref: z.custom<TRoute>(),
      dynamic: z.boolean().optional(),
      network: z.cidrv4(),
      interface_id: z.string(),
      gateway: z.ipv4().optional(),
      src: z.ipv4().optional(),
    }),
  ),
  fw_enable: z.boolean(),
  fw: z.array(
    z.object({
      id: z.string(),
      ref: z.custom<TRule>(),
      dynamic: z.boolean().optional(),
      table: z.enum(Object.values(FW_TABLES)),
      chain: z.enum(Object.values(FW_CHAINS)),
      action: z.union([
        z.object({ type: z.literal(FW_ACTIONS.PASS) }),
        z.object({ type: z.literal(FW_ACTIONS.ACCEPT) }),
        z.object({ type: z.literal(FW_ACTIONS.DROP) }),
        z.object({ type: z.literal(FW_ACTIONS.SNAT), ip: z.ipv4().optional(), port: z.number().optional() }),
        z.object({ type: z.literal(FW_ACTIONS.DNAT), ip: z.ipv4().optional(), port: z.number().optional() }),
        z.object({ type: z.literal(FW_ACTIONS.MASQUERADE) }),
      ]),
      in_interface_ids: z.array(z.string()).optional(),
      out_interface_ids: z.array(z.string()).optional(),
      src: z.array(z.ipv4()).optional(),
      dst: z.array(z.ipv4()).optional(),
      protocol: z.array(z.enum(Object.keys(IP_PROTOCOLS).map((p) => p.toLowerCase()))).optional(),
      src_port: z.array(z.number()).optional(),
      dst_port: z.array(z.number()).optional(),
      state: z.array(z.enum(Object.values(FW_CONN_STATES))).optional(),
    }),
  ),
});

type TConf = z.infer<typeof z_conf>;

const conf: TConf = {
  interfaces: [],
  bridge_ports: [],
  ips: [],
  ip_routes: [],
  fw_enable: false,
  fw: [],
};

const _get_interface = (id: string) => conf.interfaces.find((i) => i.id === id);

const _INTERFACE_TYPE_CREATING_ORDERING: Partial<Record<TInterface["type"], number>> = {
  [INTERFACE_TYPES.LOOPBACK]: -10,
  [INTERFACE_TYPES.ETHERNET]: 0,
  [INTERFACE_TYPES.BRIDGE]: 10,
  [INTERFACE_TYPES.VLAN]: 20,
};

const _interface_creating_sort = (a: TConf["interfaces"][0], b: TConf["interfaces"][0]) => {
  const _map = _INTERFACE_TYPE_CREATING_ORDERING;
  return (_map[a.type.type] ?? 999999999) - (_map[b.type.type] ?? 999999999);
};

const _find_name = <T extends { name: string }>(list: T[], name: string) => list.find((i) => i.name === name);
const _find_id = <T extends { id: string }>(list: T[], id: string) => list.find((i) => i.id === id);
const _find_by = <T extends object, K extends keyof T>(list: T[], key: K, value: T[K]) =>
  list.find((i) => i[key] === value);

const _validate_config = (os: OS, new_conf: TConf) => {
  const if_names = new Set<string>();
  for (const _new of new_conf.interfaces) {
    if (if_names.has(_new.name)) throw new Error(`Duplicate interface name ${_new.name}`);
    if_names.add(_new.name);
  }

  const port_ids = new Set<string>();

  for (const _new of new_conf.bridge_ports) {
    const bridge = _find_id(new_conf.interfaces, _new.bridge_id);
    if (!bridge) throw new Error(`Bridge ${_new.bridge_id} not found`);
    const port = _find_id(new_conf.interfaces, _new.port_id);
    if (!port) throw new Error(`Port ${_new.port_id} not found`);

    if (bridge.type.type !== INTERFACE_TYPES.BRIDGE) throw new Error(`Interface ${bridge.id} is not a bridge`);

    if (port_ids.has(port.id)) throw new Error(`Duplicate port ${port.id}`);
    port_ids.add(port.id);
  }
};

const _cascade_delete = (
  _new: TConf,
  objects: { type: "interface" | "bridge_port" | "ip" | "routes" | "fw"; id: string }[],
): typeof objects => {
  const stack = [...objects];
  const deleted: typeof objects = [];

  deleting: while (stack.length) {
    const obj = stack.pop()!;

    if (obj.type === "interface") {
      const iface = _find_id(_new.interfaces, obj.id);
      if (!iface) continue deleting;

      _new.interfaces.splice(_new.interfaces.indexOf(iface), 1);

      for (const ip of _new.ips) {
        if (ip.interface_id === iface.id) {
          stack.push({ type: "ip", id: ip.id });
        }
      }

      for (const port of _new.bridge_ports) {
        if (port.bridge_id === iface.id || port.port_id === iface.id) {
          stack.push({ type: "bridge_port", id: port.id });
        }
      }

      for (const route of _new.ip_routes) {
        if (route.interface_id === iface.id) {
          stack.push({ type: "routes", id: route.id });
        }
      }

      for (const rule of _new.fw) {
        if (rule.in_interface_ids?.includes(iface.id) || rule.out_interface_ids?.includes(iface.id)) {
          stack.push({ type: "fw", id: rule.id });
        }
      }
    } else if (obj.type === "bridge_port") {
      const port = _find_id(_new.bridge_ports, obj.id);
      if (!port) continue deleting;

      _new.bridge_ports.splice(_new.bridge_ports.indexOf(port), 1);
    } else if (obj.type === "ip") {
      const ip = _find_id(_new.ips, obj.id);
      if (!ip) continue deleting;

      _new.ips.splice(_new.ips.indexOf(ip), 1);
    } else if (obj.type === "routes") {
      const route = _find_id(_new.ip_routes, obj.id);
      if (!route) continue deleting;

      _new.ip_routes.splice(_new.ip_routes.indexOf(route), 1);
    } else if (obj.type === "fw") {
      const rule = _find_id(_new.fw, obj.id);
      if (!rule) continue deleting;

      _new.fw.splice(_new.fw.indexOf(rule), 1);
    } else {
      continue deleting;
    }

    deleted.push(obj);
  }

  return deleted;
};

const _apply_new_fw_rule = (os: OS, _new: TConf["fw"][0]) => {
  const pred: TPredicate = {};

  if (_new.in_interface_ids) {
    pred.in = [];
    for (const id of _new.in_interface_ids) {
      const iface = _get_interface(id)!.ref;
      pred.in.push(iface.index);
    }
  }

  if (_new.out_interface_ids) {
    pred.out = [];
    for (const id of _new.out_interface_ids) {
      const iface = _get_interface(id)!.ref;
      pred.out.push(iface.index);
    }
  }

  pred.src = _new.src?.map((i) => parseIPv4(i));
  pred.dst = _new.dst?.map((i) => parseIPv4(i));
  pred.src_port = _new.src_port;
  pred.dst_port = _new.dst_port;
  pred.protocol = _new.protocol?.map((i) => IP_PROTOCOLS[i.toUpperCase() as keyof typeof IP_PROTOCOLS]);
  pred.state = _new.state;

  const rule = os.net.ip4.fw.add(_new.table, _new.chain, pred, {
    action: _new.action.type,
    ...(_new.action.type === "snat" || _new.action.type === "dnat"
      ? {
          to_ip: _new.action.ip ? parseIPv4(_new.action.ip) : undefined,
          to_port: _new.action.port,
        }
      : null),
  });

  _new.ref = rule;
};

/**
 * ADD:
 * - interface
 * - port
 * - ip
 * - route
 * - fw
 * UPDATE:
 * - interface
 * - port
 * - ip
 * - route
 * - fw
 * REMOVE:
 * - fw
 * - route
 * - ip
 * - port
 * - interface
 */
const _reconcile = (os: OS, new_conf: TConf) => {
  // ADD

  // Add new interfaces
  for (const _new of new_conf.interfaces.toSorted(_interface_creating_sort)) {
    if (!conf.interfaces.some((i) => i.id === _new.id)) {
      if (_new.type.type === INTERFACE_TYPES.ETHERNET) {
        const iface = os.net.iface_by_name(_new.name)!;
        iface.flags.UP = Boolean(_new.type.up);

        _new.ref = iface;
      } else if (_new.type.type === INTERFACE_TYPES.BRIDGE) {
        const iface = os.net.add_interface(INTERFACE_TYPES.BRIDGE, _new.name, -1);
        iface.flags.UP = Boolean(_new.type.up);
        iface.flags.MASTER = true;
        iface.flags.RUNNING = true;

        const br: TBridge = {
          iBridge: iface.index,
          pvid: _new.type.pvid,
          vlan_filtering: _new.type.vlan_filtering,
        };
        os.net.br._bridges.push(br);

        _new.ref = iface;
      } else if (_new.type.type === INTERFACE_TYPES.VLAN) {
        const iface = os.net.add_interface(INTERFACE_TYPES.VLAN, _new.name, -1);
        iface.flags.UP = Boolean(_new.type.up);
        iface.flags.RUNNING = true;

        const bridge_iface = _get_interface(_new.type.bridge_interface_id)!.ref;
        const bridge = os.net.br.get_bridge(bridge_iface.index)!;
        os.net.br._vlans.push({ iBridge: bridge.iBridge, iVlan: iface.index, vid: _new.type.vid });

        _new.ref = iface;
      }

      conf.interfaces.push(_new);
    }
  }

  // Add new bridge ports
  for (const _new of new_conf.bridge_ports) {
    if (!conf.bridge_ports.some((i) => i.id === _new.id)) {
      const bridge_iface = _get_interface(_new.bridge_id)!.ref;
      const port_iface = _get_interface(_new.port_id)!.ref;

      port_iface.iMasterInterface = bridge_iface.index;
      port_iface.flags.SLAVE = true;
      port_iface.flags.PROMISC = true;

      const bridge = os.net.br.get_bridge(bridge_iface.index);
      const port: TBridgePort = {
        iBridge: bridge.iBridge,
        iPort: port_iface.index,
        pvid: _new.pvid,
        tagged: _new.tagged,
        untagged: _new.untagged,
      };
      os.net.br._ports.push(port);

      _new.ref = port;

      if (!bridge_iface.mac) {
        bridge_iface.mac = port_iface.mac;
      }

      conf.bridge_ports.push(_new);
    }
  }

  // Add new IPs
  for (const _new of new_conf.ips) {
    if (!conf.ips.some((i) => i.id === _new.id)) {
      const iface = _get_interface(_new.interface_id)!.ref;
      const address = parseCIDRv4(_new.address);
      iface.ips.push({
        ip: address.ip,
        prefix: address.prefix,
      });

      conf.ips.push(_new);
    }
  }

  // Add new routes
  for (const _new of new_conf.ip_routes) {
    if (!conf.ip_routes.some((i) => i.id === _new.id)) {
      const iface = _get_interface(_new.interface_id)!.ref;
      const network = parseCIDRv4(_new.network);

      const route: TRoute = {
        iInterface: iface.index,
        network: network.ip,
        prefix: network.prefix,
      };
      os.net.ip4._routes.push(route);

      _new.ref = route;

      conf.ip_routes.push(_new);
    }
  }

  // Add new fw
  for (const _new of new_conf.fw) {
    if (!conf.fw.some((i) => i.id === _new.id)) {
      _apply_new_fw_rule(os, _new);
      conf.fw.push(_new);
    }
  }

  // UPDATE

  // Update interfaces
  for (const _new of new_conf.interfaces) {
    const old = conf.interfaces.find((i) => i.id === _new.id);
    if (!old) continue;
    // We can not change type
    if (old.type.type !== _new.type.type) continue;

    if (old.name !== _new.name) {
      old.ref.name = _new.name;
      old.name = _new.name;
    }

    if (old.type.type === INTERFACE_TYPES.ETHERNET && _new.type.type === old.type.type) {
      if (old.type.up !== _new.type.up) {
        // TODO: physical up/down
        old.ref.flags.UP = _new.type.up;
        old.type.up = _new.type.up;
      }
    } else if (old.type.type === INTERFACE_TYPES.BRIDGE && _new.type.type === old.type.type) {
      const br = os.net.br.get_bridge(old.ref.index);

      if (old.type.up !== _new.type.up) {
        old.ref.flags.UP = _new.type.up;
        old.type.up = _new.type.up;
      }

      if (old.type.pvid !== _new.type.pvid) {
        br.pvid = _new.type.pvid;
        old.type.pvid = _new.type.pvid;
      }

      if (old.type.vlan_filtering !== _new.type.vlan_filtering) {
        br.vlan_filtering = _new.type.vlan_filtering;
        old.type.vlan_filtering = _new.type.vlan_filtering;
      }
    } else if (old.type.type === INTERFACE_TYPES.VLAN && _new.type.type === old.type.type) {
      const vlan = os.net.br.get_vlan(old.ref.index);

      if (old.type.up !== _new.type.up) {
        old.ref.flags.UP = _new.type.up;
        old.type.up = _new.type.up;
      }

      if (old.type.vid !== _new.type.vid) {
        vlan.vid = _new.type.vid;
        old.type.vid = _new.type.vid;
      }

      if (old.type.bridge_interface_id !== _new.type.bridge_interface_id) {
        vlan.iBridge = _get_interface(_new.type.bridge_interface_id)!.ref.index;
        old.type.bridge_interface_id = _new.type.bridge_interface_id;
      }
    }
  }

  // Update bridge ports
  for (const _new of new_conf.bridge_ports) {
    const old = conf.bridge_ports.find((i) => i.id === _new.id);
    if (!old) continue;

    const old_port_iface = _get_interface(old.port_id)!.ref;

    if (old.bridge_id !== _new.bridge_id) {
      old.ref.iBridge = _get_interface(_new.bridge_id)!.ref.index;
      old.bridge_id = _new.bridge_id;
    }

    if (old.port_id !== _new.port_id) {
      delete old_port_iface.iMasterInterface;
      delete old_port_iface.flags.SLAVE;
      delete old_port_iface.flags.PROMISC;

      const new_port_iface = _get_interface(_new.port_id)!.ref;
      new_port_iface.iMasterInterface = _get_interface(_new.bridge_id)!.ref.index;
      new_port_iface.flags.SLAVE = true;
      new_port_iface.flags.PROMISC = true;

      old.ref.iPort = _get_interface(_new.port_id)!.ref.index;
      old.port_id = _new.port_id;
    }

    if (old.pvid !== _new.pvid) {
      old.ref.pvid = _new.pvid;
      old.pvid = _new.pvid;
    }

    old.ref.tagged = _new.tagged;
    old.tagged = _new.tagged;

    old.ref.untagged = _new.untagged;
    old.untagged = _new.untagged;
  }

  // Update ips
  for (const _new of new_conf.ips) {
    const old = conf.ips.find((i) => i.id === _new.id);
    if (!old) continue;

    const old_iface = _get_interface(old.interface_id)!.ref;
    const old_address = parseCIDRv4(old.address);
    const old_ip = old_iface.ips.find((ip) => ip.ip === old_address.ip && ip.prefix === old_address.prefix)!;

    if (old.address !== _new.address) {
      const address = parseCIDRv4(_new.address);
      old_ip.ip = address.ip;
      old_ip.prefix = address.prefix;
      old.address = _new.address;
    }

    if (old.interface_id !== _new.interface_id) {
      old_iface.ips.splice(old_iface.ips.indexOf(old_ip), 1);

      const new_iface = _get_interface(_new.interface_id)!.ref;
      new_iface.ips.push(old_ip);

      old.interface_id = _new.interface_id;
    }
  }

  // Update routes
  for (const _new of new_conf.ip_routes) {
    const old = conf.ip_routes.find((i) => i.id === _new.id);
    if (!old) continue;

    if (old.interface_id !== _new.interface_id) {
      old.ref.iInterface = _get_interface(_new.interface_id)!.ref.index;
      old.interface_id = _new.interface_id;
    }

    if (old.network !== _new.network) {
      const network = parseCIDRv4(_new.network);

      old.ref.network = network.ip;
      old.ref.prefix = network.prefix;
      old.network = _new.network;
    }
  }

  // Update fws
  for (const _new of new_conf.fw) {
    const old = conf.fw.find((i) => i.id === _new.id);
    if (!old) continue;

    os.net.ip4.fw._table.splice(os.net.ip4.fw._table.indexOf(old.ref), 1);
    old.ref = null!;

    _apply_new_fw_rule(os, _new);
  }

  // DELETE

  // Delete fws
  for (const old of [...conf.fw]) {
    if (new_conf.fw.some((i) => i.id === old.id)) continue;
    os.net.ip4.fw._table.splice(os.net.ip4.fw._table.indexOf(old.ref), 1);

    conf.fw.splice(conf.fw.indexOf(old), 1);
  }

  // Delete routes
  for (const old of [...conf.ip_routes]) {
    if (new_conf.ip_routes.some((i) => i.id === old.id)) continue;
    os.net.ip4._routes.splice(os.net.ip4._routes.indexOf(old.ref), 1);

    conf.ip_routes.splice(conf.ip_routes.indexOf(old), 1);
  }

  // Delete ips
  for (const old of [...conf.ips]) {
    if (new_conf.ips.some((i) => i.id === old.id)) continue;
    const iface = _get_interface(old.interface_id)!.ref;
    const address = parseCIDRv4(old.address);
    const index = iface.ips.findIndex((ip) => ip.ip === address.ip && ip.prefix === address.prefix);
    iface.ips.splice(index, 1);

    conf.ips.splice(conf.ips.indexOf(old), 1);
  }

  // Delete bridge ports
  for (const old of [...conf.bridge_ports]) {
    if (new_conf.bridge_ports.some((i) => i.id === old.id)) continue;

    const port_iface = _get_interface(old.port_id)!.ref;
    delete port_iface.iMasterInterface;
    delete port_iface.flags.SLAVE;
    delete port_iface.flags.PROMISC;

    os.net.br._ports.splice(os.net.br._ports.indexOf(old.ref), 1);

    // clear fdb
    for (let i = os.net.br._fdb.length - 1; i >= 0; i--) {
      if (os.net.br._fdb[i].iPort === old.ref.iPort) {
        os.net.br._fdb.splice(i, 1);
      }
    }

    conf.bridge_ports.splice(conf.bridge_ports.indexOf(old), 1);
  }

  // Delete interfaces
  for (const old of conf.interfaces.toSorted(_interface_creating_sort).reverse()) {
    if (new_conf.interfaces.some((i) => i.id === old.id)) continue;

    const iface = old.ref;

    // Physical interface can't be deleted
    if (old.type.type === INTERFACE_TYPES.ETHERNET) continue;

    if (old.type.type === INTERFACE_TYPES.BRIDGE) {
      const index = os.net.br._ports.findIndex((p) => p.iBridge === iface.index);
      os.net.br._ports.splice(index, 1);
    } else if (old.type.type === INTERFACE_TYPES.VLAN) {
      const index = os.net.br._vlans.findIndex((v) => v.iVlan === iface.index);
      os.net.br._vlans.splice(index, 1);
    }

    // clear arp
    for (let i = os.net.arp._table.length - 1; i >= 0; i--) {
      if (os.net.arp._table[i].iInterface === iface.index) {
        os.net.arp._table.splice(i, 1);
        // TODO: notify
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

    delete os.net._interfaces[old.ref.index];

    conf.interfaces.splice(conf.interfaces.indexOf(old), 1);
  }

  // After all

  // Apply route ordering
  {
    const _managed_routes = conf.ip_routes.map((i) => i.ref);
    const _unmanaged_routes = os.net.ip4._routes.filter((i) => !_managed_routes.includes(i));
    os.net.ip4._routes = [..._unmanaged_routes, ..._managed_routes];
  }

  // Apply fw ordering
  {
    const _managed_rules = conf.fw.map((i) => i.ref);
    const _unmanaged_rules = os.net.ip4.fw._table.filter((i) => !_managed_rules.includes(i));
    os.net.ip4.fw._table = [..._unmanaged_rules, ..._managed_rules];
  }

  if (new_conf.fw_enable !== conf.fw_enable) {
    os.net.ip4.fw._enabled = new_conf.fw_enable;
    conf.fw_enable = new_conf.fw_enable;
  }
};

const _read_config = (os: OS): unknown => {
  if (!os.fs.exists(_CONF_PATH)) throw new Error(`No ${_CONF_PATH} found`);

  return JSON.parse(os.fs.read(_CONF_PATH));
};

const _write_config = (os: OS, new_conf: TConf) => {
  os.fs.write(_CONF_PATH, JSON.stringify(new_conf, null, 2));
};

const _modify_config = (os: OS, fn: (_new: TConf) => void) => {
  const _new: TConf = z_conf.parse(_read_config(os));

  fn(_new);

  z_conf.parse(_new);
  _validate_config(os, _new);

  _write_config(os, _new);
};

const _reload = (os: OS) => {
  const new_conf: TConf = z_conf.parse(_read_config(os));

  _validate_config(os, new_conf);

  _reconcile(os, new_conf);
};

let _reload_cb: () => void = () => null;

export const netd: TApp = async (os, args, ctx) => {
  if (_started) throw new Error("Already started");
  _started = true;

  _reload_cb = () => {
    ctx.output("RELOADING\n");
    try {
      _reload(os);
    } catch (e) {
      ctx.output(`LOADING ERROR: ${e}\n`);
    }
  };

  const watcher = os.fs.watch(_CONF_PATH, _reload_cb);

  try {
    _reload_cb();

    await new Promise((_, reject) => {
      ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
  } finally {
    os.fs.unwatch(watcher);
    _reload_cb = () => null;
    _started = false;

    ctx.output("EXITED");
  }
};

export const net = with_commander({
  interface: {
    desc: "Interface management",
    fn: {
      bridge: {
        desc: "Bridge management",
        fn: {
          port: {
            desc: "Port management",
            fn: {
              print: {
                desc: "Print ports",
                args: [{ name: "--bridge", alias: "-b", type: "string" }],
                fn: (parsed) => async (os, _, ctx) => {
                  const bridge_name = parsed.bridge?.[0];

                  const _new: TConf = z_conf.parse(_read_config(os));

                  ctx.output(`BRIDGE\tPORT\n`);
                  for (const port of _new.bridge_ports) {
                    if (bridge_name && port.bridge_id !== bridge_name) continue;
                    ctx.output(`${port.bridge_id}\t${port.port_id}\n`);
                  }
                },
              },
              add: {
                desc: "Add port",
                args: [
                  { alias: "interface", type: "string", required: true },
                  { name: "--bridge", alias: "-b", type: "string", required: true },
                ],
                fn: (parsed) => async (os) => {
                  const interface_name = parsed.interface![0];
                  const bridge_name = parsed.bridge![0];

                  _modify_config(os, (_new) => {
                    const bridge = _find_name(_new.interfaces, bridge_name);
                    if (!bridge) throw new Error(`No bridge ${bridge_name} found`);
                    const port = _find_name(_new.interfaces, interface_name);
                    if (!port) throw new Error(`No interface ${interface_name} found`);

                    _new.bridge_ports.push({
                      id: `${bridge.id}:${port.id}`,
                      bridge_id: bridge.id,
                      port_id: port.id,
                      pvid: 1,
                      ref: null!,
                      tagged: [],
                      untagged: [],
                    });
                  });
                },
              },
              remove: {
                desc: "Remove port",
                args: [{ alias: "port", type: "string", required: true }],
                fn: (parsed) => async (os) => {
                  const port_name = parsed.port![0];

                  _modify_config(os, (_new) => {
                    const port = _find_name(_new.interfaces, port_name);
                    if (!port) throw new Error(`No interface ${port_name} found`);

                    const bridge_port = _find_by(_new.bridge_ports, "port_id", port.id);
                    if (!bridge_port) throw new Error(`No bridge port ${port_name} found`);

                    _cascade_delete(_new, [{ type: "bridge_port", id: bridge_port.id }]);
                  });
                },
              },
            },
          },
          add: {
            desc: "Add bridge",
            args: [{ alias: "name", type: "string", required: true }],
            fn: (parsed) => async (os) => {
              const name = parsed.name![0];

              _modify_config(os, (_new) => {
                _new.interfaces.push({
                  id: name,
                  name,
                  ref: null!,
                  type: {
                    type: INTERFACE_TYPES.BRIDGE,
                    pvid: 1,
                    up: false,
                    vlan_filtering: false,
                  },
                });
              });
            },
          },
          remove: {
            desc: "Remove bridge",
            args: [{ alias: "name", type: "string", required: true }],
            fn: (parsed) => async (os) => {
              _modify_config(os, (_new) => {
                const bridge_name = parsed.name![0];
                const bridge = _find_name(_new.interfaces, bridge_name);
                if (!bridge) throw new Error(`No bridge "${bridge_name}" found`);
                if (bridge.type.type !== INTERFACE_TYPES.BRIDGE) {
                  throw new Error(`Interface "${bridge_name}" is not a bridge`);
                }

                _cascade_delete(_new, [{ type: "interface", id: bridge.id }]);
              });
            },
          },
        },
      },
      print: {
        desc: "Print interface info",
        fn: () => async (os, args, ctx) => {
          ctx.output("NAME\tTYPE\n");
          for (const iface of conf.interfaces) {
            ctx.output(`${iface.name}\t${iface.type.type}\n`);
          }
        },
      },
    },
  },
  ip: {
    desc: "IP management",
    fn: {
      address: {
        desc: "IP Address management",
        fn: {
          print: {
            desc: "Print IP addresses",
            args: [{ name: "--interface", alias: "-i", type: "string" }],
            fn: (parsed) => async (os, _, ctx) => {
              const _new = z_conf.parse(_read_config(os));

              const interface_name = parsed.interface?.[0];
              const filter_interface = interface_name ? _find_name(_new.interfaces, interface_name) : undefined;

              ctx.output(`ADDRESS\tMASK\tINTERFACE\n`);
              for (const ip of _new.ips) {
                if (filter_interface && ip.interface_id !== filter_interface.id) continue;

                const _interface = _find_id(_new.interfaces, ip.interface_id);
                const address = parseCIDRv4(ip.address);

                ctx.output(
                  [
                    ip.address,
                    formatIPv4(prefixToMask(address.prefix)),
                    _interface ? _interface.name : `*${ip.interface_id}`,
                  ].join("\t"),
                );
                ctx.output("\n");
              }
            },
          },
          add: {
            desc: "Add IP address",
            args: [
              { alias: "address", type: "ip/", required: true },
              { name: "--interface", alias: "-i", type: "string", required: true },
            ],
            fn: (parsed) => async (os) => {
              const address = parsed.address![0];
              const interface_name = parsed.interface![0];

              _modify_config(os, (_new) => {
                const iface = _find_name(_new.interfaces, interface_name);
                if (!iface) throw new Error(`No interface ${interface_name} found`);

                _new.ips.push({
                  id: `${iface.id}:${address.replaceAll(/[^\d]/g, "_")}`,
                  interface_id: iface.id,
                  address,
                });
              });
            },
          },
        },
      },
      route: {
        desc: "IP Route management",
        fn: {
          print: {
            desc: "Print IP routes",
            fn: () => async (os, _, ctx) => {
              const _new = z_conf.parse(_read_config(os));

              ctx.output(`#\tNETWORK\tGATEWAY\tINTERFACE\tSOURCE\n`);
              for (let i = 0; i < _new.ip_routes.length; i += 1) {
                const route = _new.ip_routes[i];
                ctx.output(
                  [
                    i.toString(),
                    route.network,
                    route.gateway || "-",
                    _find_id(_new.interfaces, route.interface_id)?.name ?? `*${route.interface_id}`,
                    route.src || "-",
                  ].join("\t"),
                );
                ctx.output("\n");
              }
            },
          },
          move: {
            desc: "Set route priority",
            args: [
              { name: "--from", alias: "-f", type: "number", required: true },
              { name: "--to", alias: "-t", type: "number", required: true },
            ],
            fn: (parsed) => async (os) => {
              const _from = Number(parsed.from![0]);
              const _to = Number(parsed.to![0]);

              _modify_config(os, (_new) => {
                if (!_new.ip_routes[_from]) throw new Error(`No route ${_from} found`);
                if (!_new.ip_routes[_to]) throw new Error(`No route ${_to} found`);

                const _tmp = _new.ip_routes[_from];
                _new.ip_routes[_from] = _new.ip_routes[_to];
                _new.ip_routes[_to] = _tmp;
              });
            },
          },
        },
      },
    },
  },
  fw: {
    desc: "Firewall management",
    fn: {
      print: {
        desc: "Print firewall rules",
        fn: () => async (os, _, ctx) => {
          const _new = z_conf.parse(_read_config(os));

          for (let i = 0; i < _new.fw.length; i += 1) {
            const rule = _new.fw[i];

            ctx.output(
              [
                `${i + 1})`,
                `TABLE=${rule.table}`,
                `CHAIN=${rule.chain}`,
                `ACTION=${rule.action.type}`,
                rule.in_interface_ids?.length &&
                  `in=${rule.in_interface_ids.map((i) => _find_id(_new.interfaces, i)?.name || `*${i}`).join(",")}`,
                rule.out_interface_ids?.length &&
                  `out=${rule.out_interface_ids.map((i) => _find_id(_new.interfaces, i)?.name || `*${i}`).join(",")}`,
                rule.protocol?.length && `protocol=${rule.protocol.join(",")}`,
                rule.src?.length && `src=${rule.src?.join(",")}`,
                rule.src_port?.length && `src_port=${rule.src_port.join(",")}`,
                rule.dst?.length && `src=${rule.dst?.join(",")}`,
                rule.dst_port?.length && `dst_port=${rule.dst_port.join(",")}`,
                rule.state?.length && `state=${rule.state.join(",")}`,
              ]
                .filter(Boolean)
                .join(" "),
            );
            ctx.output("\n");
          }
        },
      },
      move: {
        desc: "Set rule priority",
        args: [
          { name: "--from", alias: "-f", type: "number", required: true },
          { name: "--to", alias: "-t", type: "number", required: true },
        ],
        fn: (parsed) => async (os) => {
          const _from = Number(parsed.from![0]);
          const _to = Number(parsed.to![0]);

          _modify_config(os, (_new) => {
            if (!_new.fw[_from]) throw new Error(`No rule ${_from} found`);
            if (!_new.fw[_to]) throw new Error(`No rule ${_to} found`);

            const _tmp = _new.fw[_from];
            _new.fw[_from] = _new.fw[_to];
            _new.fw[_to] = _tmp;
          });
        },
      },
    },
  },
});
