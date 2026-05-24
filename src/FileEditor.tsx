import { observer } from "mobx-react-lite";
import { store, type TArchNode } from "./state/store";

export const FileEditor = observer(function FileEditor(props: { node: TArchNode; path: string }) {
  const { node, path } = props;

  return (
    <dialog
      open
      className="modal"
      onClose={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.node_edit_file();
      }}
    >
      <div className="modal-box">
        <h3 className="font-bold text-lg">
          {node.name}: {path}
        </h3>
        <textarea
          className="textarea textarea-sm w-full font-mono my-4"
          value={node.fs[path] || ""}
          onChange={(e) => {
            store.node_fs_set(node.id, { [path]: e.currentTarget.value });
          }}
        />
        <div className="modal-action">
          <button
            className="btn btn-error btn-outline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm("Are you sure?")) {
                store.node_edit_file();
                store.node_fs_set(node.id, { [path]: undefined });
              }
            }}
          >
            Delete
          </button>
          <div className="grow" />
          <form method="dialog">
            <button className="btn">Close</button>
          </form>
        </div>
      </div>
    </dialog>
  );
});
