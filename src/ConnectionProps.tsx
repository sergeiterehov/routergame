import { observer } from "mobx-react-lite";
import { store } from "./state/store";

export const ConnectionProps = observer(function ConnectionProps(props: { id: string }) {
  const { id } = props;

  const connection = store.arch.connections.find((c) => c.id === id)!;

  const a = store.arch.node.find((n) => n.id === connection.a_id)!;
  const b = store.arch.node.find((n) => n.id === connection.b_id)!;

  const metrics = store.connection_metrics[id];

  const handle_rename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const name = prompt("New name");
    if (!name) return;
    alert("Not implemented!"); // FIXME: connection rename
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold cursor-pointer hover:bg-gray-900/5" onClick={handle_rename}>
        {connection.id}
      </div>
      <div className="text-sm font-mono">
        <div>
          {a.name}: {connection.a_pid} &rarr; [{metrics ? metrics.ab : "0"}]
        </div>
        <div>
          {b.name}: {connection.b_pid} &rarr; [{metrics ? metrics.ba : "0"}]
        </div>
      </div>
      <div
        className="btn btn-outline btn-danger"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          if (confirm("Are you sure?")) {
            store.connection_delete(id);
          }
        }}
      >
        Delete
      </div>
      <div className="h-25 shrink-0"></div>
    </div>
  );
});
