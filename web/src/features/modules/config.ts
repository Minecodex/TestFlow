import type { Module } from "../../shared/api/types";

export const moduleRuntime = (module: Module) => module.runtime || module.manifest.runtime;
