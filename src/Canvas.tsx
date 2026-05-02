import { observer } from "mobx-react-lite";
import { store } from "./store.ts";

const itemSize = 64;

export const Canvas = observer(function Canvas() {
  const { active_id } = store;

  return (
    <div className="relative" style={{ width: 1024, height: 768 }}>
      <svg className="absolute">
        {store.arch.connections.map((c) => {
          const a = store.arch.node.find((n) => n.id === c.a_id);
          const b = store.arch.node.find((n) => n.id === c.b_id);
          if (!a || !b) return null;

          return (
            <line
              key={c.id}
              className="stroke-2 stroke-sky-700"
              x1={a.ui.x + itemSize / 2}
              y1={a.ui.y + itemSize / 2}
              x2={b.ui.x + itemSize / 2}
              y2={b.ui.y + itemSize / 2}
            />
          );
        })}
      </svg>
      {store.arch.node.map((n) => {
        return (
          <div
            key={n.id}
            className={`absolute ${n.type === "pc" ? "bg-sky-200" : n.type === "router" ? "bg-violet-200" : n.type === "server" ? "bg-green-200" : "bg-gray-200"} rounded-lg border-2 ${n.id === active_id ? "border-black" : "border-transparent"}`}
            style={{ left: n.ui.x, top: n.ui.y, width: itemSize, height: itemSize }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              store.active_id_set(n.id);
            }}
          >
            {n.name}
          </div>
        );
      })}
    </div>
  );
});
