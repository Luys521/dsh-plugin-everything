/**
 * Type surface for `dsh-plugin-everything`.
 *
 * The plugin ships as plain ESM (`index.js`); these declarations exist so a
 * host or an editor can see the config keys without resolving the source.
 */

/** Values accepted under the plugin's `config` in `cordis.patch.yml`. */
export interface EverythingPluginConfig {
  /**
   * Path to the ES executable.
   * Defaults to `%LOCALAPPDATA%\Microsoft\WindowsApps\es.exe`, resolved at load.
   */
  esPath?: string
  /** Everything instance name. Empty connects to the default instance. */
  instanceName?: string
  /** Longest wait for the Everything index to load before searching, in ms. Default `10000`. */
  ipcTimeoutMs?: number
  /** Default result cap for `everything_find`. Default `200`. */
  maxResults?: number
  /** Cap on the stdout buffer of a single ES call, in bytes. Default 32 MiB. */
  maxBufferBytes?: number
}

/** Host services this plugin requires. */
export declare const inject: readonly string[]

/** Cordis plugin id, matching the `id` used in `cordis.patch.yml`. */
export declare const name: string

/**
 * Register the `everything_find`, `everything_content` and `everything_status`
 * tools on the host context.
 */
export declare function apply(ctx: unknown, config?: EverythingPluginConfig): void
