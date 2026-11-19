/** The shape of data an event passes: object keys, string literals, and anything else (`any`). */
export type Shape = {
    kind: "object";
    keys: Record<string, Shape>;
} | {
    kind: "string";
    value: string;
} | {
    kind: "any";
} | {
    kind: "none";
};
/** One way an event runs a command: its `extras` and `states`. `undefined`: not passed. `null`: unknown. */
export interface EventSite {
    extras: Shape | null | undefined;
    states: Shape | null | undefined;
}
/** What running a function gives: something, nothing, a TypeError (quoted), or unknown (it read more than the event's data). */
export type Outcome = "value" | "nothing" | "unknown" | {
    crash: string;
};
interface Source {
    file: string;
    text: string;
}
/** The JavaScript files of a package (its `dist`, else all of it), without node_modules. */
export declare function packageSources(dir: string): Source[];
/** The text from an opening bracket at `open` to its match (exclusive), split at top-level commas. */
export declare function splitTopLevel(text: string, open: number): {
    parts: string[];
    end: number;
} | null;
export declare function eventSites(sources: Source[], event: string): EventSite[];
/** A function's file reads its event's data: itself, or through a helper of its package it passes `ctx` to. */
export declare function readsEventData(text: string, sources: Source[]): boolean;
/** What a probe gives back: per function (lower-case name), its outcome without event data, and in each of its package's events. */
export interface ProbeResult {
    [fn: string]: {
        none: Outcome;
        events: Record<string, Outcome>;
    };
}
/**
 * Runs each function that reads its events' data on stand-in data shaped like each event's, in a child
 * process (functions may be async, and a bad one must not take the checker down). `null` when the probe
 * could not run.
 */
export declare function probeExtension(forgeDir: string, functions: Array<{
    name: string;
    file: string;
}>, events: Record<string, EventSite[]>): ProbeResult | null;
/** {@link probeExtension} for several extensions in one child process, remembered for the process. */
export declare function probeExtensions(forgeDir: string, packages: Array<{
    functions: Array<{
        name: string;
        file: string;
    }>;
    events: Record<string, EventSite[]>;
}>): Array<ProbeResult | null> | null;
export {};
//# sourceMappingURL=events.d.ts.map