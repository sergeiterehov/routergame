import { observer } from "mobx-react-lite";
import { store, type TArchConnection, type TArchNode } from "./state/store";
import { IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";

function useTimeout(expired_at: number): boolean {
  const [expired, setExpired] = useState<boolean>(() => expired_at < Date.now());

  useEffect(() => {
    const _expired = expired_at < Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpired(_expired);
    if (_expired) return;
    const tm = setTimeout(() => setExpired(true), Math.max(0, expired_at - Date.now()));
    return () => clearTimeout(tm);
  }, [expired_at]);

  return expired;
}

const Link = observer(function Link(props: { id: string; pid: string; c: TArchConnection; ext_node: TArchNode }) {
  const { id, pid, c, ext_node } = props;

  const _a = c.a_id === id;
  const ext_port = _a ? c.b_pid : c.a_pid;

  const { ab = 0, ba = 0, ab_beacon_at = 0, ba_beacon_at = 0 } = store.connection_metrics[c.id] || {};

  const link = !useTimeout((_a ? ab_beacon_at : ba_beacon_at) + 3_000);
  const power_on = Boolean(store.instances[id]);

  return (
    <a
      href="#"
      className="flex items-center gap-1 link link-hover"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.selected_set("connection", c.id);
      }}
    >
      <div className={`${power_on && link ? "bg-green-400" : "bg-green-900"} rounded-full size-1.5`} />
      {pid} &rarr; {ext_node.name}: {ext_port}{" "}
      {(() => {
        const tx = _a ? ab : ba;
        const rx = _a ? ba : ab;
        return `[${tx}/${rx}]`;
      })()}
    </a>
  );
});

export const NodeProps = observer(function NodeProps(props: { id: string }) {
  const { id } = props;

  const node = store.arch.node.find((n) => n.id === id)!;

  const handle_rename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const name = prompt("New name", node.name);
    if (!name) return;
    store.node_rename(id, name);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold link link-hover" onClick={handle_rename}>
        {node.name}
      </div>
      <div className="text-sm font-mono">
        {node.ports.map((p) => {
          for (const c of store.arch.connections) {
            if ((c.a_id === id && c.a_pid === p.id) || (c.b_id === id && c.b_pid === p.id)) {
              for (const ext_node of store.arch.node) {
                if (ext_node.id === (c.a_id === id ? c.b_id : c.a_id)) {
                  return <Link key={p.id} id={id} pid={p.id} c={c} ext_node={ext_node} />;
                }
              }
            }
          }

          return (
            <div key={p.id} className="flex items-center gap-1 text-black/33">
              <div className="bg-gray-400 rounded-full size-1.5" />
              {p.id}
            </div>
          );
        })}
      </div>
      <div className="text-md font-semibold">Initial script</div>
      <pre className="textarea textarea-sm w-full font-mono">{node.fs["/init"]}</pre>
      <div className="text-md font-semibold flex items-center">
        <div className="grow">Files</div>
        <IconPlus
          className="cursor-pointer rounded-full hover:bg-purple-500 hover:text-white"
          title="Add file"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const path = prompt("Path", "/name");
            if (!path) return;
            store.node_edit_file(path);
          }}
          size="1em"
        />
      </div>
      <div className="font-mono text-sm">
        {Object.keys(node.fs).map((path, i) => {
          return (
            <a
              key={i}
              href="#"
              className="block link link-hover"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                store.node_edit_file(path);
              }}
            >
              {path}
            </a>
          );
        })}
      </div>
      <div className="text-md font-semibold">Actions</div>
      {store.instances[node.id] ? (
        <div
          className="btn btn-outline btn-error"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            store.node_terminate(id);
          }}
        >
          Power off
        </div>
      ) : (
        <div
          className="btn btn-success"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            store.node_reboot(id);
          }}
        >
          Power on
        </div>
      )}
      <div
        className="btn btn-outline btn-error"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          if (confirm("Are you sure?")) {
            store.node_delete(id);
          }
        }}
      >
        Delete
      </div>
      <div className="h-25 shrink-0"></div>
    </div>
  );
});
