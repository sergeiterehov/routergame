import { observer } from "mobx-react-lite";
import { store, type TArchNode } from "./store.ts";

const itemSize = 64;

const Type2Color: { [key in TArchNode["type"]]?: string } = {
  pc: "bg-sky-200",
  router: "bg-violet-200",
  server: "bg-green-200",
  l2: "bg-gray-200",
};

export const Canvas = observer(function Canvas() {
  const { active_id } = store;

  const connections = store.arch.connections.filter((c) => c.a_id === active_id || c.b_id === active_id);
  const siblings_ids = connections.map((c) => (c.a_id === active_id ? c.b_id : c.a_id));

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.active_id_set();
      }}
    >
      <svg className="absolute w-full h-full">
        {store.arch.connections.map((c) => {
          const a = store.arch.node.find((n) => n.id === c.a_id);
          const b = store.arch.node.find((n) => n.id === c.b_id);
          if (!a || !b) return null;

          return (
            <line
              key={c.id}
              className={`stroke-2 ${connections.includes(c) ? "stroke-sky-700" : "stroke-sky-500"}`}
              x1={a.ui.x + itemSize / 2}
              y1={a.ui.y + itemSize / 2}
              x2={b.ui.x + itemSize / 2}
              y2={b.ui.y + itemSize / 2}
            />
          );
        })}
      </svg>
      {store.arch.node.map((n) => {
        const color = Type2Color[n.type];
        return (
          <div
            key={n.id}
            className={`absolute cursor-pointer flex text-center justify-center items-center ${color ?? "bg-gray-500 text-gray-400"} rounded-lg border-2 ${n.id === active_id ? "border-black" : siblings_ids.includes(n.id) ? `border-gray-500 border-dashed` : "border-transparent"} overflow-hidden`}
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
