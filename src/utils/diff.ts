import type { RootState } from "../app/store";
import type { Patch } from "../entities/sync/types";
import jsonpatch, { type Operation } from "fast-json-patch";

export function getPatch(prev: RootState, next: RootState): Operation[] | undefined {
    const patch = jsonpatch.compare(prev, next);
    return patch.length > 0 ? patch : undefined;
}

export function applyPatch(base: RootState, patches: Patch[]): RootState {
    let result: RootState = base;
    const concatDiff: Operation[] = patches.flatMap(p => p.diff ? p.diff : []);

    try {
        result = jsonpatch.applyPatch(result, concatDiff, false, false).newDocument;
    } catch (error) {
        throw new Error(`Failed to apply patch: ${(error as Error).message}`);
    }

    return result;
}