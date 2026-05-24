import { makeAutoObservable, toJS } from "mobx";
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
  fs: { [key: string]: string };
} & ({ type: "pc" | "router" | "server"; ethernetPorts: { id: string; mac: string }[] } | { type: "l2" });

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

  node_editing_file?: {
    id: string;
    path: string;
  };

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

  private _node_worker_send(id: string, msg: Bus.Message.Master) {
    const w = this.instances[id];
    if (!w) return;

    w.postMessage(msg);
  }

  private _node_worker_link_set(node: TArchNode, pid: string, up: boolean) {
    for (let i = 0; i < node.ports.length; i += 1) {
      if (node.ports[i].id === pid) {
        this._node_worker_send(node.id, { $: up ? "link/up" : "link/down", port: i });
        return;
      }
    }
  }

  node_by_id(id: string) {
    for (const n of this.arch.node) {
      if (n.id === id) return n;
    }
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

    for (const c of this.arch.connections) {
      const pid = c.a_id === node.id ? c.a_pid : c.b_id === node.id ? c.b_pid : undefined;
      if (!pid) continue;

      this._node_worker_link_set(node, pid, true);
    }

    if ("ethernetPorts" in node) {
      for (const eth of node.ethernetPorts) {
        this._node_worker_send(node.id, { $: "exec", app: "iface", args: [eth.id, "mac", eth.mac] });
      }
    }

    this._node_worker_send(node.id, { $: "fs", fs: toJS(node.fs) });
    this._node_worker_send(node.id, { $: "exec", app: "init", args: [] });
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

  private _handle_node_message(node: TArchNode, msg: Bus.Message.Slave) {
    if (msg.$ === "print") {
      this.console_append(node.id, msg.text);
    } else if (msg.$ === "ethernet_frame") {
      const port = node.ports[msg.port];
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

        if (c.speed <= 0) {
          console.log(`[${node.id}:${msg.port}] => [${targetNode.id}:${targetPort}] DROP, speed=0`);
          return;
        }

        console.log(`[${node.id}:${msg.port}] => [${targetNode.id}:${targetPort}]\n${hexdump(msg.frame)}`);

        const time = c.delay + (1000 * msg.frame.length) / c.speed;
        setTimeout(() => {
          target.postMessage({ $: "ethernet_frame", port: targetPort, frame: msg.frame });
          this._connection_metrics_update(node, c, msg.frame.length);
        }, time);
        return;
      }

      console.log(`[${node.id}:${msg.port}] => [X] DROP`);
    } else if (msg.$ === "fs") {
      this._node_fs_set(node.id, msg.fs);
    }
  }

  private _node_fs_set(id: string, fs: { [key: string]: string | undefined }) {
    const node = this.node_by_id(id);
    if (!node) return;
    for (const [key, value] of Object.entries(fs)) {
      if (typeof value === "string") {
        node.fs[key] = value;
      } else {
        delete node.fs[key];
      }
    }
  }
  node_fs_set(id: string, fs: { [key: string]: string | undefined }) {
    this._node_fs_set(id, fs);
    this._node_worker_send(id, { $: "fs", fs: toJS(fs) });
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

  connection_by_id(id: string) {
    for (const c of this.arch.connections) {
      if (c.id === id) return c;
    }
  }

  connection_create(
    config: Partial<Omit<TArchConnection, "id">> & Pick<TArchConnection, "a_id" | "b_id" | "a_pid" | "b_pid">,
  ) {
    const { a_id, a_pid, b_id, b_pid, ...rest_config } = config;
    const a = this.node_by_id(a_id);
    const b = this.node_by_id(b_id);
    if (!a || !b) return;

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
      speed: config.speed ?? 1_000_000,
      id: this.randomize_id(),
    };

    this.arch.connections.push(connection);

    this._node_worker_link_set(a, a_pid, true);
    this._node_worker_link_set(b, b_pid, true);

    return connection;
  }

  connection_delete(id: string) {
    this.selected_exclude("connection", id);

    for (let i = this.arch.connections.length - 1; i >= 0; i -= 1) {
      const c = this.arch.connections[i];
      if (c.id !== id) continue;

      const a = this.node_by_id(c.a_id);
      const b = this.node_by_id(c.b_id);

      if (a) this._node_worker_link_set(a, c.a_pid, false);
      if (b) this._node_worker_link_set(b, c.b_pid, false);

      this.arch.connections.splice(i, 1);
      return;
    }
  }

  connection_speed_set(id: string, speed: number) {
    const c = this.connection_by_id(id);
    if (!c) return;

    c.speed = speed;
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
      fs: {},
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
      fs: {},
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
      fs: {},
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
      fs: {},
    });

    this.arch.node.push(node);
    this.selected_set("node", node.id);

    return node;
  }

  node_edit_file(path?: string, id?: string) {
    if (!path) {
      this.node_editing_file = undefined;
      return;
    }
    if (!id) id = this.selected_node?.id;
    if (!id) return;
    this.node_editing_file = { id, path };
  }
}

export const store = new Store();

(function init() {
  for (const n of store.arch.node) store.node_reboot(n.id);
  const some_node = store.arch.node.at(0);
  if (some_node) store.selected_set("node", some_node.id);
})();
