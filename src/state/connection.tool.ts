import { makeAutoObservable } from "mobx";
import type { Store, TArchNode } from "./store";

export class ConnectionTool {
  state: "a" | "a_port" | "b" | "b_port" = "a";
  choice: { [key in string]: string } = {};
  a_id = "";
  b_id = "";

  constructor(private _store: Store) {
    makeAutoObservable(this);
  }

  reset() {
    this.state = "a";
    this.choice = {};
    this.a_id = "";
    this.b_id = "";
  }

  get port_selector() {
    const { state } = this;

    const id = state === "a_port" ? this.a_id : state === "b_port" ? this.b_id : undefined;
    if (!id) return;

    const node = this._store.arch.node.find((n) => n.id === id);
    if (!node) return;

    const free_ports = this._store.get_node_free_ports(node);
    return { node, free_ports };
  }

  select_node(node: TArchNode) {
    const { state } = this;
    if (state !== "a" && state !== "b") return;

    const freePort = this._store.get_node_free_ports(node);
    if (!freePort.length) return;

    let autolink = false;
    if (freePort.length === 1) {
      this.choice[node.id] = freePort[0].id;
      autolink = true;
    } else {
      this.choice[node.id] = "";
      this.state = "a_port";
    }

    if (state === "a") {
      this.a_id = node.id;
      this.state = autolink ? "b" : "a_port";
      return;
    }

    if (state === "b") {
      this.b_id = node.id;
      if (autolink) {
        this._create_connection();
        this.state = "a";
      } else {
        this.state = "b_port";
      }
      return;
    }
  }

  select_port(pid: string) {
    const { state } = this;

    if (state === "a_port") {
      this.choice[this.a_id] = pid;
      this.state = "b";
      return;
    }

    if (state === "b_port") {
      this.choice[this.b_id] = pid;
      this._create_connection();
      this.state = "a";
      return;
    }
  }

  private _create_connection() {
    const { a_id, b_id } = this;
    const { [a_id]: a_pid, [b_id]: b_pid } = this.choice;

    this._store.connection_create({ a_id, b_id, a_pid, b_pid });
    this._store.tool_done();
  }
}
