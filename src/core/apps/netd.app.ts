import type { OS, TApp } from "../os/os";
import { formatIPv4, formatMAC, parseCIDRv4, prefixToMask } from "../format";
import { with_commander } from "./app.lib";
import { nd } from "./nd.lib";
import { NDUtils } from "./nd.lib/utils";
import { FW_ACTIONS, FW_CHAINS, FW_CONN_STATES, FW_TABLES } from "../os/fw";
import { IP_PROTOCOLS } from "../pack";

const _CONFIG_PATH = "/netd";

function _save(os: OS) {
  const data = JSON.stringify(nd.serialize());
  os.fs.write(_CONFIG_PATH, data);
}

let _started = false;

export const netd: TApp = async (os, _args, ctx) => {
  if (_started) throw new Error("Already started");
  _started = true;

  try {
    nd.os = os;

    if (os.fs.exists(_CONFIG_PATH)) {
      const data = JSON.parse(os.fs.read(_CONFIG_PATH));
      nd.deserialize(data);
    } else {
      ctx.output(`${_CONFIG_PATH} not found\n`);

      nd.interface.ethernet.init();
      ctx.output("Initialized\n");
    }

    await new Promise((_, reject) => {
      ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
  } finally {
    _started = false;
    ctx.output("EXITED");
  }
};

export const net = with_commander({
  save: {
    desc: "Save configuration",
    fn: () => async (os, _args, ctx) => {
      _save(os);
      ctx.output("Saved\n");
    },
  },
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
                fn: (parsed) => async (_os, _args, ctx) => {
                  const bridge_name = parsed.bridge?.[0];

                  ctx.output(`BRIDGE\tPORT\n`);
                  for (const port of nd.interface.bridge.port.list) {
                    if (bridge_name && port.data.bridge_interface.name !== bridge_name) continue;
                    ctx.output(`${port.data.bridge_interface.name}\t${port.data.port_interface.name}\n`);
                  }
                },
              },
              add: {
                desc: "Add port",
                args: [
                  { alias: "interface", type: "string", required: true },
                  { name: "--bridge", alias: "-b", type: "string", required: true },
                ],
                fn: (parsed) => async () => {
                  const interface_name = parsed.interface![0];
                  const bridge_name = parsed.bridge![0];

                  const bridge = nd.interface.by_name(bridge_name, "bridge");
                  if (!bridge) throw new Error(`No bridge ${bridge_name} found`);

                  const port = nd.interface.by_name(interface_name);
                  if (!port) throw new Error(`No interface ${interface_name} found`);

                  nd.interface.bridge.port.add({
                    id: NDUtils.rand_id(),
                    bridge_interface: bridge,
                    port_interface: port,
                    pvid: 1,
                    tagged: [],
                    untagged: [],
                  });
                },
              },
              remove: {
                desc: "Remove port",
                args: [{ alias: "port", type: "string", required: true }],
                fn: (parsed) => async () => {
                  const port_name = parsed.port![0];

                  const port = nd.interface.by_name(port_name);
                  if (!port) throw new Error(`No interface ${port_name} found`);

                  const bridge_port = nd.interface.bridge.port.map.get(port.id);
                  if (!bridge_port) throw new Error(`No bridge port ${port_name} found`);

                  nd.interface.bridge.port.remove(bridge_port.data.id);
                },
              },
            },
          },
          add: {
            desc: "Add bridge",
            args: [{ alias: "name", type: "string", required: true }],
            fn: (parsed) => async () => {
              const name = parsed.name![0];

              nd.interface.bridge.add({
                id: NDUtils.rand_id(),
                name,
                mac: formatMAC(0n),
                type: "bridge",
                props: {
                  pvid: 1,
                  vlan_filtering: false,
                },
              });
            },
          },
          remove: {
            desc: "Remove bridge",
            args: [{ alias: "name", type: "string", required: true }],
            fn: (parsed) => async () => {
              const bridge_name = parsed.name![0];

              const bridge = nd.interface.by_name(bridge_name, "bridge");
              if (!bridge) throw new Error(`No bridge "${bridge_name}" found`);

              nd.interface.bridge.remove(bridge.id);
            },
          },
        },
      },
      print: {
        desc: "Print interface info",
        fn: () => async (_os, _args, ctx) => {
          ctx.output("NAME\tTYPE\n");
          for (const item of nd.interface.list) {
            ctx.output(`${item.name}\t${item.type}\n`);
          }
        },
      },
      find: {
        desc: "Find interface",
        args: [
          { name: "--name", alias: "-n", type: "string" },
          { name: "--print", alias: "-", type: "string", default: ["name"], desc: "(name, .id, .name)" },
        ],
        fn: (parsed) => async (_os, _args, ctx) => {
          const name = parsed.name?.[0];
          const print = parsed.print?.[0];

          const result: string[] = [];

          for (const item of nd.interface.list) {
            if (name && item.name !== name) continue;

            if (print === "name") {
              result.push(item.name);
            } else if (print === ".id") {
              result.push(item.id);
            } else if (print === ".name") {
              result.push(nd.interface.iface_map.get(item.id)!.name);
            } else {
              throw new Error("Unknown print format");
            }
          }

          ctx.output(result.join(";"));
          ctx.output("\n");
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
            fn: (parsed) => async (_os, _args, ctx) => {
              const interface_name = parsed.interface?.[0];
              const filter_interface = interface_name ? nd.interface.by_name(interface_name) : undefined;

              ctx.output(`ADDRESS\tMASK\tINTERFACE\n`);
              for (const { data: ip } of nd.ip.address.list) {
                if (filter_interface && ip.interface !== filter_interface) continue;

                const address = parseCIDRv4(ip.address);

                ctx.output([ip.address, formatIPv4(prefixToMask(address.prefix)), ip.interface.name].join("\t"));
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
            fn: (parsed) => async () => {
              const address = parsed.address![0];
              const interface_name = parsed.interface![0];

              const iface = nd.interface.by_name(interface_name);
              if (!iface) throw new Error(`No interface ${interface_name} found`);

              nd.ip.address.add({
                id: NDUtils.rand_id(),
                address,
                interface: iface,
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
            fn: () => async (_os, _args, ctx) => {
              ctx.output(`#\tNETWORK\tGATEWAY\tINTERFACE\tSOURCE\n`);
              for (let i = 0; i < nd.ip.route.list.length; i += 1) {
                const { data: route } = nd.ip.route.list[i];
                ctx.output(
                  [i.toString(), route.network, route.gateway || "-", route.interface.name, route.src || "-"].join(
                    "\t",
                  ),
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
            fn: (parsed) => async () => {
              const _from = Number(parsed.from![0]);
              const _to = Number(parsed.to![0]);

              const mut_list = nd.ip.route.list;

              if (!mut_list[_from]) throw new Error(`No route ${_from} found`);
              if (!mut_list[_to]) throw new Error(`No route ${_to} found`);

              const _tmp = mut_list[_from];
              mut_list[_from] = mut_list[_to];
              mut_list[_to] = _tmp;
            },
          },
        },
      },
      firewall: {
        desc: "Firewall management",
        fn: {
          print: {
            desc: "Print firewall rules",
            fn: () => async (_os, _args, ctx) => {
              for (let i = 0; i < nd.ip.firewall.list.length; i += 1) {
                const { data: rule } = nd.ip.firewall.list[i];

                ctx.output(
                  [
                    `${i + 1})`,
                    `TABLE=${rule.table}`,
                    `CHAIN=${rule.chain}`,
                    `ACTION=${rule.action.action}`,
                    rule.in_interface?.length && `in=${rule.in_interface.map((i) => i.name).join(",")}`,
                    rule.out_interface?.length && `out=${rule.out_interface.map((i) => i.name).join(",")}`,
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
            fn: (parsed) => async () => {
              const _from = Number(parsed.from![0]);
              const _to = Number(parsed.to![0]);

              const mut_list = nd.ip.firewall.list;

              if (!mut_list[_from]) throw new Error(`No rule ${_from} found`);
              if (!mut_list[_to]) throw new Error(`No rule ${_to} found`);

              const _tmp = mut_list[_from];
              mut_list[_from] = mut_list[_to];
              mut_list[_to] = _tmp;
            },
          },
          add: {
            desc: "Add new rule",
            args: [
              { name: "--table", alias: "-t", type: Object.values(FW_TABLES), required: true },
              { name: "--chain", alias: "-c", type: Object.values(FW_CHAINS), required: true },
              { name: "--action", alias: "-a", type: Object.values(FW_ACTIONS), required: true },
              { name: "--in", alias: "-i", type: "string", multiple: true },
              { name: "--out", alias: "-o", type: "string", multiple: true },
              {
                name: "--protocol",
                alias: "-p",
                type: [...Object.keys(IP_PROTOCOLS), ...Object.values(IP_PROTOCOLS).map(String)],
                multiple: true,
              },
              { name: "--src", alias: "-s", type: "string", multiple: true },
              { name: "--dst", alias: "-d", type: "string", multiple: true },
              { name: "--state", alias: "-st", type: Object.values(FW_CONN_STATES), multiple: true },
              { name: "--src-port", alias: "-sp", type: "string", multiple: true },
              { name: "--dst-port", alias: "-dp", type: "string", multiple: true },
              { name: "--to-ip", alias: "-ti", type: "string", multiple: true },
              { name: "--to-port", alias: "-tp", type: "string", multiple: true },
              { name: "--comment", alias: "--", type: "string" },
            ],
            fn: (parsed) => async () => {
              const {
                table: [table],
                chain: [chain],
                action: [action],
                comment: [comment],
                in: in_interface_names,
                out: out_interface_names,
                protocol,
                src,
                dst,
                state,
                ["src-port"]: src_port,
                ["dst-port"]: dst_port,
                ["to-ip"]: [to_ip],
                ["to-port"]: [to_port],
              } = parsed;

              const map_interface_name = (name: string) => {
                const res = nd.interface.by_name(name);
                if (!res) throw new Error(`Interface ${name} not found`);
                return res;
              };

              const map_port = (port: string) => {
                const res = Number.parseInt(port, 10);
                if (Number.isNaN(res)) throw new Error(`Port ${port} is not a number`);
                if (res < 0 || res > 65535) throw new Error(`Port ${port} is out of range`);
                return res;
              };

              const map_protocol = (proto: string) => {
                const by_name = IP_PROTOCOLS[proto as keyof typeof IP_PROTOCOLS];
                if (by_name !== undefined) return by_name;
                const by_num = Number.parseInt(proto, 10);
                if (Number.isNaN(by_num)) throw new Error(`Protocol ${proto} is not a number`);
                if (by_num < 0 || by_num > 255) throw new Error(`Protocol ${proto} is out of range`);
                return by_num;
              };

              const map_optional_array = <T>(value: T[]): T[] | undefined => {
                if (value.length === 0) return;
                return value;
              };

              nd.ip.firewall.add({
                id: NDUtils.rand_id(),
                comment,
                table: table as (typeof FW_TABLES)[keyof typeof FW_TABLES],
                chain: chain as (typeof FW_CHAINS)[keyof typeof FW_CHAINS],
                action: {
                  action: action as (typeof FW_ACTIONS)[keyof typeof FW_ACTIONS],
                  to_ip: to_ip,
                  to_port: to_port ? map_port(to_port) : undefined,
                },
                in_interface: map_optional_array(in_interface_names.map(map_interface_name)),
                out_interface: map_optional_array(out_interface_names.map(map_interface_name)),
                protocol: map_optional_array(protocol.map(map_protocol)),
                src,
                dst,
                state: state as (typeof FW_CONN_STATES)[keyof typeof FW_CONN_STATES][],
                src_port: map_optional_array(src_port.map(map_port)),
                dst_port: map_optional_array(dst_port.map(map_port)),
              });
            },
          },
        },
      },
    },
  },
});
