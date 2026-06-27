export namespace NDUtils {
  export const NAME_REGEXP = /^[a-z_]+(-?[a-z_0-9]+)*$/i;
  const ID_LENGTH = 6;

  export function rand_id(): string {
    let id: string = "";
    for (let i = 0; i < ID_LENGTH; i++) {
      id += Math.floor(Math.random() * 36).toString(36);
    }
    return id;
  }

  type HookCallback<O, A> = (obj: O, action: A) => void;
  export class Hook<Obj, Actions> {
    private _hooks: HookCallback<Obj, Actions>[] = [];

    add(hook: HookCallback<Obj, Actions>) {
      this._hooks.push(hook);
    }

    notify(obj: Obj, action: Actions) {
      for (const hook of this._hooks) {
        hook(obj, action);
      }
    }
  }
}
