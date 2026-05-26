import { observer } from "mobx-react-lite";
import { store } from "./state/store";
import { IconPlus } from "@tabler/icons-react";

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
              const ext = c.a_id === id ? c.b_pid : c.a_pid;
              for (const ext_node of store.arch.node) {
                if (ext_node.id === (c.a_id === id ? c.b_id : c.a_id)) {
                  const metrics = store.connection_metrics[c.id];
                  return (
                    <a
                      key={p.id}
                      href="#"
                      className="block link link-hover"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        store.selected_set("connection", c.id);
                      }}
                    >
                      {p.id} &rarr; {ext_node.name}: {ext}{" "}
                      {(() => {
                        const { ab, ba } = metrics || { ab: 0, ba: 0 };
                        const tx = c.a_id === id ? ab : ba;
                        const rx = c.a_id === id ? ba : ab;
                        return `[${tx}/${rx}]`;
                      })()}
                    </a>
                  );
                }
              }
            }
          }

          return (
            <div key={p.id} className="text-black/33">
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
