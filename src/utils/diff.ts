import type { RootState } from "../app/store";
import type { Patch } from "../entities/sync/types";
import { compare, applyPatch as applyJsonPatch, type Operation } from "fast-json-patch";

export function getPatch(prev: any, next: any): Operation[] | undefined {
    const patch = compare(prev, next);
    return patch.length > 0 ? patch : undefined;
}


export function applyPatch(base: RootState, patches: Patch[]): RootState {
    let result: RootState = structuredClone(base);

    for (const patch of patches) {
        if (!patch.diff) continue;

        const applied = applyJsonPatch(result, patch.diff, false);
        result = applied.newDocument;
    }

    return result;
}