import { observer } from "mobx-react-lite";
import { store } from "./state/store";
import { formatValue } from "./devices/format";

const SPEEDS = [0, 100, 1_000, 10_000, 1_000_000];

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

  const { speed } = connection;

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
      <div>Speed</div>
      <div>
        <div className="w-full max-w-xs">
          <input
            type="range"
            className="range"
            min="0"
            step="1"
            max={SPEEDS.length - 1}
            value={(() => {
              const value = SPEEDS.indexOf(speed);
              if (value === -1) return SPEEDS.length - 1;
              return value;
            })()}
            onChange={(e) => {
              store.connection_speed_set(connection.id, SPEEDS[parseInt(e.currentTarget.value)]);
            }}
          />
          <div className="flex justify-between px-2.5 mt-2 text-xs">
            {Array.from({ length: SPEEDS.length }).map((_, i) => (
              <span key={i}>|</span>
            ))}
          </div>
          <div className="flex justify-between px-2.5 mt-2 text-xs">
            {Array.from({ length: SPEEDS.length }).map((_, i) => (
              <span key={i}>{formatValue(SPEEDS[i], 0)}</span>
            ))}
          </div>
        </div>
      </div>
      <div
        className="btn btn-outline btn-error"
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
