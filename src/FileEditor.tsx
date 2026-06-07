import { observer } from "mobx-react-lite";
import { store, type TArchNode } from "./state/store";

export const FileEditor = observer(function FileEditor() {
  const { id, path, content } = store.node_editing_file!;
  const node = store.node_by_id(id)!;

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
          value={content}
          onChange={(e) => {
            store.node_edit_file_set_content(e.currentTarget.value);
          }}
        />
        <div className="modal-action">
          <button
            className="btn btn-error btn-outline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm("Are you sure?")) {
                store.node_edit_file_delete();
              }
            }}
          >
            Delete
          </button>
          <div className="grow" />
          <form method="dialog">
            <button className="btn">Cancel</button>
          </form>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              store.node_edit_file_save();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </dialog>
  );
});
