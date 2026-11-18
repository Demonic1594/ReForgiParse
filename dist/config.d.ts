export type Level = "error" | "warning" | "info" | "off";
export interface Config {
    /** A level for any rule: `error`, `warning`, `info`, or `off`. */
    rules?: Record<string, Level>;
    /** Files and folders to check, relative to the bot's folder (default: all of it). */
    include?: string[];
    /** File or folder names to skip anywhere (`"tests"`), or paths from the bot's folder (`"src/legacy"`). */
    exclude?: string[];
    /** Properties whose strings are ForgeScript code (default `["code"]`). */
    properties?: string[];
    /** Functions made when the bot runs, which no file defines: never reported as unknown. */
    known?: string[];
}
export declare const CONFIG_FILE = "reforgiparse.config.json";
export declare class ConfigError extends Error {
    constructor(file: string, message: string);
}
/**
 * The config for a bot's folder: `file` when given, else `reforgiparse.config.json` there, else the
 * "reforgiparse" key of its package.json, else none. Throws a ConfigError for a config that cannot
 * be used, so a typo never silently checks with other settings.
 */
export declare function loadConfig(root: string, file?: string): {
    config: Config;
    file: string | null;
};
//# sourceMappingURL=config.d.ts.map