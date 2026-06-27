import * as init from "./init.app";
import * as fs from "./fs.pkg";
import * as netd from "./netd.app";
import * as pkg from "./pkg.pkg";

export const software = { ...init, ...fs, ...netd, ...pkg } as const;
