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
}
