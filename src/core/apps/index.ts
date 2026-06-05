import * as init from "./init.app";
import * as fs from "./fs.pkg";
import * as pkg from "./pkg.pkg";

export const software = { ...init, ...fs, ...pkg } as const;
