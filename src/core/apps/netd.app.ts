import z from "zod";
import type { OS, TApp } from "../os/os";
import { parseCIDRv4, parseIPv4 } from "../format";
import type { TBridge, TBridgePort } from "../os/br";
import { FW_ACTIONS, FW_CHAINS, FW_CONN_STATES, FW_TABLES, type TPredicate, type TRule } from "../os/fw";
import { IP_PROTOCOLS } from "../pack";
import { INTERFACE_TYPES, type TInterface } from "../os/net";
import type { TRoute } from "../os/ip4";

const _CONF_PATH = "/netd.json";

let _started = false;

const z_conf = z.object({
  interfaces: z.array(
    z.object({
      id: z.string(),
      ref: z.custom<TInterface>(),
      static: z.boolean(),
      name: z.string(),
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
      static: z.boolean(),
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
      static: z.boolean(),
      interface_id: z.string(),
      address: z.cidrv4(),
    }),
  ),
  routes: z.array(
    z.object({
      id: z.string(),
      ref: z.custom<TRoute>(),
      static: z.boolean(),
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
      static: z.boolean(),
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
  routes: [],
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
  for (const _new of new_conf.routes) {
    if (!conf.routes.some((i) => i.id === _new.id)) {
      const iface = _get_interface(_new.interface_id)!.ref;
      const network = parseCIDRv4(_new.network);

      const route: TRoute = {
        iInterface: iface.index,
        network: network.ip,
        prefix: network.prefix,
      };
      os.net.ip4._routes.push(route);

      _new.ref = route;

      conf.routes.push(_new);
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
  for (const _new of new_conf.routes) {
    const old = conf.routes.find((i) => i.id === _new.id);
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
  for (const old of [...conf.routes]) {
    if (new_conf.routes.some((i) => i.id === old.id)) continue;
    os.net.ip4._routes.splice(os.net.ip4._routes.indexOf(old.ref), 1);

    conf.routes.splice(conf.routes.indexOf(old), 1);
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

  if (new_conf.fw_enable !== conf.fw_enable) {
    os.net.ip4.fw._enabled = new_conf.fw_enable;
    conf.fw_enable = new_conf.fw_enable;
  }
};

function _get_test_config() {
  const _new_conf: TConf = {
    interfaces: [
      { id: "eth0", ref: null!, name: "eth0", static: true, type: { type: "ethernet", up: true } },
      { id: "eth1", ref: null!, name: "eth1", static: true, type: { type: "ethernet", up: true } },
      { id: "eth2", ref: null!, name: "eth2", static: true, type: { type: "ethernet", up: true } },
      { id: "eth3", ref: null!, name: "eth3", static: true, type: { type: "ethernet", up: true } },
      { id: "eth4", ref: null!, name: "eth4", static: true, type: { type: "ethernet", up: true } },
      { id: "eth5", ref: null!, name: "eth5", static: true, type: { type: "ethernet", up: true } },
      { id: "eth6", ref: null!, name: "eth6", static: true, type: { type: "ethernet", up: true } },
      { id: "eth7", ref: null!, name: "eth7", static: true, type: { type: "ethernet", up: true } },
      {
        id: "br0",
        ref: null!,
        name: "br0",
        static: true,
        type: { type: "bridge", up: true, pvid: 1, vlan_filtering: false },
      },
    ],
    bridge_ports: [
      { id: "bp1", ref: null!, static: true, bridge_id: "br0", port_id: "eth1", pvid: 1, tagged: [], untagged: [] },
      { id: "bp2", ref: null!, static: true, bridge_id: "br0", port_id: "eth2", pvid: 1, tagged: [], untagged: [] },
    ],
    ips: [
      { id: "ip1", interface_id: "eth0", static: true, address: "192.168.0.1/24" },
      { id: "ip2", interface_id: "br0", static: true, address: "10.0.0.1/24" },
    ],
    routes: [
      { id: "r1", ref: null!, interface_id: "eth0", static: true, network: "192.168.0.0/24" },
      { id: "r2", ref: null!, interface_id: "br0", static: true, network: "10.0.0.0/24" },
    ],
    fw_enable: true,
    fw: [
      {
        id: "fw1",
        ref: null!,
        static: true,
        table: "nat",
        chain: "src-nat",
        action: { type: "masquerade" },
        out_interface_ids: ["eth0"],
      },
    ],
  };

  return z_conf.parse(_new_conf);
}

const _reload_conf = (os: OS) => {
  if (!os.fs.exists(_CONF_PATH)) throw new Error(`No ${_CONF_PATH} found`);
  const new_conf = z_conf.parse(JSON.parse(os.fs.read(_CONF_PATH)));

  _reconcile(os, new_conf);
};

let _reload_cb: () => void = () => null;

export const netd: TApp = async (os, args, ctx) => {
  if (_started) throw new Error("Already started");
  _started = true;

  _reload_cb = () => {
    ctx.output("RELOADING\n");
    try {
      _reload_conf(os);
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
