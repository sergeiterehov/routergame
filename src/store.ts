import { makeAutoObservable } from "mobx";
import { hexdump } from "./devices/format";
import PCWorker from "./devices/workers/pc.worker.ts?worker";
import RouterWorker from "./devices/workers/router.worker.ts?worker";
import ServerWorker from "./devices/workers/server.worker.ts?worker";
import L2Worker from "./devices/workers/l2.worker.ts?worker";

export type TArchNode = {
  id: string;
  name: string;
  ports: { id: string; type: "ethernet" }[];
  ui: { x: number; y: number };
} & (
  | { type: "pc" | "router" | "server"; ethernetPorts: { id: string; mac: string }[]; init: string[] }
  | { type: "l2" }
);

export type TArchConnection = {
  id: string;
  a_id: string;
  a_pid: string;
  b_id: string;
  b_pid: string;
  delay: number;
  speed: number;
};

export type TArchitecture = {
  title: string;
  node: TArchNode[];
  connections: TArchConnection[];
};

const Type2Worker: { [key in TArchNode["type"]]: new (options: WorkerOptions) => Worker } = {
  pc: PCWorker,
  router: RouterWorker,
  server: ServerWorker,
  l2: L2Worker,
};

const initial_arch: TArchitecture = {
  title: "Test",
  node: [
    {
      id: "router",
      type: "router",
      name: "Router",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
        { id: "eth2", type: "ethernet" },
        { id: "eth3", type: "ethernet" },
        { id: "eth4", type: "ethernet" },
        { id: "eth5", type: "ethernet" },
        { id: "eth6", type: "ethernet" },
        { id: "eth7", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:ff:00:00" },
        { id: "eth1", mac: "00:00:00:ff:00:01" },
        { id: "eth2", mac: "00:00:00:ff:00:02" },
        { id: "eth3", mac: "00:00:00:ff:00:03" },
        { id: "eth4", mac: "00:00:00:ff:00:04" },
        { id: "eth5", mac: "00:00:00:ff:00:05" },
        { id: "eth6", mac: "00:00:00:ff:00:06" },
        { id: "eth7", mac: "00:00:00:ff:00:07" },
      ],
      init: [
        "iface eth0 add 192.168.0.1/24",
        "route add 192.168.0.0/24 dev eth0",
        "br add br0 eth1 eth2",
        "iface br0 add 10.0.0.1/24",
        "route add 10.0.0.0/24 dev br0",
        "dhcpd br0 10.0.0.10 10.0.0.20 -g 10.0.0.1",
      ],
      ui: { x: 150, y: 50 },
    },
    {
      id: "sw",
      type: "l2",
      ui: { x: 250, y: 50 },
      name: "Switch",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
        { id: "eth2", type: "ethernet" },
        { id: "eth3", type: "ethernet" },
      ],
    },
    {
      id: "server",
      type: "server",
      name: "Server",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:bb:00:00" },
        { id: "eth1", mac: "00:00:00:bb:00:01" },
      ],
      init: [
        "iface eth0 add 192.168.0.100/24",
        "route add 192.168.0.0/24 dev eth0",
        "route add default via 192.168.0.1",
      ],
      ui: { x: 150, y: 150 },
    },
    {
      id: "pc_a",
      type: "pc",
      name: "PC A",
      ports: [{ id: "eth0", type: "ethernet" }],
      ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:00:00" }],
      init: ["dhcp eth0"],
      ui: { x: 50, y: 50 },
    },
    {
      id: "pc_b",
      type: "pc",
      name: "PC B",
      ports: [{ id: "eth0", type: "ethernet" }],
      ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:01:00" }],
      init: ["dhcp eth0"],
      ui: { x: 350, y: 50 },
    },
  ],
  connections: [
    { id: "server-router", a_id: "server", a_pid: "eth0", b_id: "router", b_pid: "eth0", delay: 0, speed: 100_000_000 },
    { id: "pc_a-router", a_id: "pc_a", a_pid: "eth0", b_id: "router", b_pid: "eth1", delay: 0, speed: 100_000_000 },
    { id: "router-sw", a_id: "router", a_pid: "eth2", b_id: "sw", b_pid: "eth0", delay: 0, speed: 100_000_000 },
    { id: "pc_b-sw", a_id: "pc_b", a_pid: "eth0", b_id: "sw", b_pid: "eth1", delay: 0, speed: 100_000_000 },
  ],
};

class Store {
  arch: TArchitecture = initial_arch;
  instances: { [key: string]: Worker } = {};
  consoles: { [key: string]: string } = {};

  active_id?: string;

  constructor() {
    makeAutoObservable(this);
  }

  console_clear(node: string) {
    store.consoles[node] = "";
  }
  console_append(node: string, text: string) {
    store.consoles[node] += text;
  }
  active_id_set(id?: string) {
    store.active_id = id;
  }
}

export const store = new Store();

(function init() {
  for (const n of store.arch.node) {
    const WorkerClass = Type2Worker[n.type];
    if (!WorkerClass) throw new Error("Unknown node type");

    const w = new WorkerClass({ name: n.id });

    store.instances[n.id] = w;
    store.consoles[n.id] = "";

    w.addEventListener("message", (e) => {
      if (e.data.$ === "ethernet_frame") {
        const port = n.ports[e.data.port];
        if (!port) return;

        const pid = port.id;
        for (const c of store.arch.connections) {
          let targetNode: TArchNode | undefined;
          let targetPort: number | undefined;

          if (c.a_id === n.id && c.a_pid === pid) {
            targetNode = store.arch.node.find((n) => n.id === c.b_id);
            targetPort = targetNode?.ports.findIndex((p) => p.id === c.b_pid);
          } else if (c.b_id === n.id && c.b_pid === pid) {
            targetNode = store.arch.node.find((n) => n.id === c.a_id);
            targetPort = targetNode?.ports.findIndex((p) => p.id === c.a_pid);
          } else {
            continue;
          }

          if (!targetNode || targetPort === undefined || targetPort === -1) continue;

          const target = store.instances[targetNode.id];
          if (!target) continue;

          console.log(`[${n.id}:${e.data.port}] => [${targetNode.id}:${targetPort}]\n${hexdump(e.data.frame)}`);

          const time = c.delay + (1000 * e.data.frame.length) / c.speed;
          setTimeout(() => target.postMessage({ $: "ethernet_frame", port: targetPort, frame: e.data.frame }), time);
          break;
        }
      } else if (e.data.$ === "print") {
        store.console_append(n.id, e.data.text);
      }
    });

    if ("ethernetPorts" in n) {
      for (const eth of n.ethernetPorts) {
        w.postMessage({ $: "exec", app: "iface", args: [eth.id, "mac", eth.mac] });
      }
    }

    if ("init" in n) {
      for (const cmd of n.init) {
        const [app, ...args] = cmd.split(/\s+/);
        w.postMessage({ $: "exec", app, args });
      }
    }
  }

  store.active_id = store.arch.node.at(0)?.id;
})();
