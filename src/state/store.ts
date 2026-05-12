import { makeAutoObservable } from "mobx";
import * as Workers from "../devices/workers";
import { hexdump } from "../devices/format";
import type { Bus } from "../devices/bus";
import { initial_arch } from "./initial";
import { ConnectionTool } from "./connection.tool";

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

export const enum TOOL {
  NONE = "none",
  CONNECT = "connect",
}

const Type2Worker: { [key in TArchNode["type"]]: new (options: WorkerOptions) => Worker } = {
  pc: Workers.PCWorker,
  router: Workers.RouterWorker,
  server: Workers.ServerWorker,
  l2: Workers.L2Worker,
};

export class Store {
  arch: TArchitecture = initial_arch;
  instances: { [key: string]: Worker } = {};
  consoles: { [key: string]: string } = {};
  connection_metrics: { [key: string]: { ab: number; ba: number } } = {};

  tool: TOOL = TOOL.NONE;

  connecting_tool = new ConnectionTool(this);

  selected: { $: "node" | "connection"; id: string }[] = [];

  grid = 50;
  sidebar_visible = true;
  console_visible = true;

  viewport_position = { x: 0, y: 0 };

  tool_set(value: TOOL) {
    if (this.tool === value) return;

    this.tool = value;

    if (value === TOOL.CONNECT) this.connecting_tool.reset();
  }

  tool_done() {
    this.tool = TOOL.NONE;
  }

  grid_set(value: number) {
    this.grid = value;
  }

  sidebar_visible_set(value: boolean) {
    this.sidebar_visible = value;
  }

  console_visible_set(value: boolean) {
    this.console_visible = value;
  }

  viewport_position_set(x: number, y: number) {
    this.viewport_position.x = x;
    this.viewport_position.y = y;
  }

  get selected_node_ids() {
    return this.selected.filter((s) => s.$ === "node").map((s) => s.id);
  }

  get selected_connection_ids() {
    return this.selected.filter((s) => s.$ === "connection").map((s) => s.id);
  }

  get selected_node() {
    if (this.selected.length !== 1) return;
    const selected = this.selected[0];
    if (selected.$ !== "node") return;
    const { id } = selected;
    for (const n of this.arch.node) {
      if (n.id === id) return n;
    }
  }

  get selected_connection() {
    if (this.selected.length !== 1) return;
    const selected = this.selected[0];
    if (selected.$ !== "connection") return;
    const { id } = selected;
    for (const c of this.arch.connections) {
      if (c.id === id) return c;
    }
  }

  constructor() {
    makeAutoObservable(this);
  }

  console_clear(node: string) {
    this.consoles[node] = "";
  }
  console_append(id: string, text: string) {
    const current = this.consoles[id];
    this.consoles[id] = (current || "") + text;
  }
  selected_clear() {
    this.selected = [];
  }
  selected_set(type: (typeof this.selected)[0]["$"], id: string) {
    this.selected = [{ $: type, id }];
  }
  selected_exclude(type: (typeof this.selected)[0]["$"], id: string) {
    for (let i = this.selected.length - 1; i >= 0; i -= 1) {
      const s = this.selected[i];
      if (s.id === id && s.$ === type) {
        this.selected.splice(i, 1);
      }
    }
  }
  selected_toggle(type: (typeof this.selected)[0]["$"], id: string) {
    for (let i = 0; i < this.selected.length; i += 1) {
      const selected = this.selected[i];
      if (selected.id === id && selected.$ === type) {
        this.selected.splice(i, 1);
        return;
      }
    }
    this.selected.push({ $: type, id });
  }

  node_rename(id: string, name: string) {
    const node = this.arch.node.find((n) => n.id === id);
    if (!node) return;
    node.name = name;
  }

  node_move(id: string, x: number, y: number) {
    const node = this.arch.node.find((n) => n.id === id);
    if (!node) return;
    node.ui.x = x;
    node.ui.y = y;
  }

  node_terminate(id: string) {
    const node = this.arch.node.find((n) => n.id === id);
    if (!node) return;

    const w = this.instances[id];
    if (!w) return;

    w.terminate();

    delete this.instances[id];
    this.console_append(node.id, "\n[Terminated]\n");
  }

  node_reboot(id: string) {
    const node = this.arch.node.find((n) => n.id === id);
    if (!node) return;

    this.node_terminate(id);

    const WorkerClass = Type2Worker[node.type];
    if (!WorkerClass) throw new Error("Unknown node type");

    const w = new WorkerClass({ name: node.id });

    this.instances[node.id] = w;
    this.console_append(node.id, "");

    w.addEventListener("message", (e) => this._handle_node_message(node, e.data));

    if ("ethernetPorts" in node) {
      for (const eth of node.ethernetPorts) {
        w.postMessage({ $: "exec", app: "iface", args: [eth.id, "mac", eth.mac] });
      }
    }

    if ("init" in node) {
      for (const cmd of node.init) {
        const [app, ...args] = cmd.split(/\s+/);
        w.postMessage({ $: "exec", app, args });
      }
    }
  }

  private _connection_metrics_update(src: TArchNode, via: TArchConnection, size: number) {
    let m = this.connection_metrics[via.id];
    if (!m) m = this.connection_metrics[via.id] = { ab: 0, ba: 0 };
    if (via.a_id === src.id) {
      m.ab += size;
    } else {
      m.ba += size;
    }
  }

  private _handle_node_message(node: TArchNode, data: Bus.Message.Slave) {
    if (data.$ === "ethernet_frame") {
      const port = node.ports[data.port];
      if (!port) return;

      const pid = port.id;
      for (const c of this.arch.connections) {
        let targetNode: TArchNode | undefined;
        let targetPort: number | undefined;

        if (c.a_id === node.id && c.a_pid === pid) {
          targetNode = this.arch.node.find((n) => n.id === c.b_id);
          targetPort = targetNode?.ports.findIndex((p) => p.id === c.b_pid);
        } else if (c.b_id === node.id && c.b_pid === pid) {
          targetNode = this.arch.node.find((n) => n.id === c.a_id);
          targetPort = targetNode?.ports.findIndex((p) => p.id === c.a_pid);
        } else {
          continue;
        }

        if (!targetNode || targetPort === undefined || targetPort === -1) continue;

        const target = this.instances[targetNode.id];
        if (!target) continue;

        console.log(`[${node.id}:${data.port}] => [${targetNode.id}:${targetPort}]\n${hexdump(data.frame)}`);

        const time = c.delay + (1000 * data.frame.length) / c.speed;
        setTimeout(() => {
          target.postMessage({ $: "ethernet_frame", port: targetPort, frame: data.frame });
          this._connection_metrics_update(node, c, data.frame.length);
        }, time);
        break;
      }
    } else if (data.$ === "print") {
      this.console_append(node.id, data.text);
    }
  }

  get_node_connections(id: string) {
    const list: TArchConnection[] = [];
    for (const c of this.arch.connections) {
      if (c.a_id === id || c.b_id === id) list.push(c);
    }
    return list;
  }

  get_node_port_connections(id: string, pid: string) {
    const list: TArchConnection[] = [];
    for (const c of this.arch.connections) {
      if ((c.a_id === id && c.a_pid === pid) || (c.b_id === id && c.b_pid === pid)) list.push(c);
    }
    return list;
  }

  get_node_free_ports(node: TArchNode) {
    const used: string[] = [];
    for (const c of this.get_node_connections(node.id)) {
      used.push(c.a_id === node.id ? c.a_pid : c.b_pid);
    }
    return node.ports.filter((p) => !used.includes(p.id));
  }

  randomize_id(length: number = 12) {
    let id: string = "";
    for (let i = 0; i < length; i++) {
      id += Math.floor(Math.random() * 36).toString(36);
    }
    return id;
  }

  randomize_mac() {
    let mac = "";
    for (let i = 0; i < 6; i++) {
      if (i > 0) mac += ":";
      mac += Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0");
    }
    return mac;
  }

  connection_create(
    config: Partial<Omit<TArchConnection, "id">> & Pick<TArchConnection, "a_id" | "b_id" | "a_pid" | "b_pid">,
  ) {
    const { a_id, a_pid, b_id, b_pid, ...rest_config } = config;

    for (const c of this.arch.connections) {
      if (
        (c.a_id === a_id && c.a_pid === a_pid && c.b_id === b_id && c.b_pid === b_pid) ||
        (c.b_id === a_id && c.b_pid === a_pid && c.a_id === b_id && c.a_pid === b_pid)
      ) {
        return;
      }
    }

    const connection: TArchConnection = {
      a_id,
      a_pid,
      b_id,
      b_pid,
      ...rest_config,
      delay: config.delay ?? 0,
      speed: config.speed ?? 100_000_000,
      id: this.randomize_id(),
    };

    this.arch.connections.push(connection);
    return connection;
  }

  connection_delete(id: string) {
    this.selected_exclude("connection", id);

    for (let i = this.arch.connections.length - 1; i >= 0; i -= 1) {
      if (this.arch.connections[i].id === id) {
        this.arch.connections.splice(i, 1);
        return;
      }
    }
  }

  node_delete(id: string) {
    const index = this.arch.node.findIndex((n) => n.id === id);
    if (index === -1) return;

    this.node_terminate(id);

    this.selected_exclude("node", id);

    for (let i = this.arch.connections.length - 1; i >= 0; i -= 1) {
      const c = this.arch.connections[i];
      if (c.a_id === id || c.b_id === id) {
        this.selected_exclude("connection", id);
        this.arch.connections.splice(i, 1);
      }
    }

    this.arch.node.splice(index, 1);
  }

  node_create_pc(config: Partial<Pick<TArchNode, "ui" | "name">>) {
    const node: TArchNode = makeAutoObservable({
      type: "pc",
      id: this.randomize_id(),
      ethernetPorts: [{ id: "eth0", mac: this.randomize_mac() }],
      ports: [{ id: "eth0", type: "ethernet" }],
      init: [],
      name: config.name || "New PC",
      ui: config.ui || { x: 0, y: 0 },
    });

    this.arch.node.push(node);
    this.selected_set("node", node.id);

    return node;
  }

  node_create_router(config: Partial<Pick<TArchNode, "ui" | "name">>) {
    const node: TArchNode = makeAutoObservable({
      type: "router",
      id: this.randomize_id(),
      ports: [],
      ethernetPorts: [],
      init: [],
      name: config.name || "Router",
      ui: config.ui || { x: 0, y: 0 },
    });

    for (let i = 0; i < 8; i += 1) {
      const id = `eth${i}`;
      node.ports.push({ id, type: "ethernet" });
      node.ethernetPorts.push({ id, mac: this.randomize_mac() });
    }

    this.arch.node.push(node);
    this.selected_set("node", node.id);

    return node;
  }

  node_create_server(config: Partial<Pick<TArchNode, "ui" | "name">>) {
    const node: TArchNode = makeAutoObservable({
      type: "server",
      id: this.randomize_id(),
      ethernetPorts: [
        { id: "eth0", mac: this.randomize_mac() },
        { id: "eth1", mac: this.randomize_mac() },
      ],
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
      ],
      init: [],
      name: config.name || "New Server",
      ui: config.ui || { x: 0, y: 0 },
    });

    this.arch.node.push(node);
    this.selected_set("node", node.id);

    return node;
  }

  node_create_l2(config: Partial<Pick<TArchNode, "ui" | "name">>) {
    const node: TArchNode = makeAutoObservable({
      type: "l2",
      id: this.randomize_id(),
      ports: new Array(16).fill(0).map((_, i) => ({ id: `eth${i}`, type: "ethernet" })),
      name: config.name || "New Switch",
      ui: config.ui || { x: 0, y: 0 },
    });

    this.arch.node.push(node);
    this.selected_set("node", node.id);

    return node;
  }
}

export const store = new Store();

(function init() {
  for (const n of store.arch.node) store.node_reboot(n.id);
  const some_node = store.arch.node.at(0);
  if (some_node) store.selected_set("node", some_node.id);
})();
