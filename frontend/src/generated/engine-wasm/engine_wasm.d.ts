/* tslint:disable */
/* eslint-disable */

export class EngineHandle {
    free(): void;
    [Symbol.dispose](): void;
    apply_action_json(action_json: string): string;
    apply_legal_action_index(index: number): string;
    legal_actions_json(): string;
    constructor(scenario_id: string, seed: bigint);
    static new_with_roles(scenario_id: string, seed: bigint, deployment_first_army: string, first_bound_army: string): EngineHandle;
    replay_json(): string;
    snapshot_json(): string;
    undo_json(): string;
}

export function build_action_catalog_json(legal_actions_json: string): string;

export function build_user_prompt_json(snapshot_json: string, request_json: string, action_catalog_json: string, action_history_json: string, prompt_profile: string): string;

export function describe_legal_action_json(action_json: string): string;

export function legal_action_to_action_json(action_json: string): string;

export function list_scenarios_json(): string;

export function load_replay_json(replay_json: string): string;

export function rules_metadata_json(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_enginehandle_free: (a: number, b: number) => void;
    readonly build_action_catalog_json: (a: number, b: number) => [number, number, number, number];
    readonly build_user_prompt_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly describe_legal_action_json: (a: number, b: number) => [number, number, number, number];
    readonly enginehandle_apply_action_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly enginehandle_apply_legal_action_index: (a: number, b: number) => [number, number, number, number];
    readonly enginehandle_legal_actions_json: (a: number) => [number, number, number, number];
    readonly enginehandle_new: (a: number, b: number, c: bigint) => [number, number, number];
    readonly enginehandle_new_with_roles: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly enginehandle_replay_json: (a: number) => [number, number, number, number];
    readonly enginehandle_snapshot_json: (a: number) => [number, number, number, number];
    readonly enginehandle_undo_json: (a: number) => [number, number, number, number];
    readonly legal_action_to_action_json: (a: number, b: number) => [number, number, number, number];
    readonly list_scenarios_json: () => [number, number, number, number];
    readonly load_replay_json: (a: number, b: number) => [number, number, number, number];
    readonly rules_metadata_json: () => [number, number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
