import { invoke } from '@tauri-apps/api/core'

export interface SidecarInfo {
  port: number
  token: string
}

let cachedInfo: SidecarInfo | null = null

export async function getSidecarInfo(): Promise<SidecarInfo> {
  if (cachedInfo) return cachedInfo
  const [port, token] = await invoke<[number, string]>('get_sidecar_info')
  cachedInfo = { port, token }
  return cachedInfo
}

export async function keychainGet(service: string, account: string): Promise<string> {
  return invoke<string>('keychain_get', { service, account })
}

export async function keychainSet(service: string, account: string, value: string): Promise<void> {
  return invoke<void>('keychain_set', { service, account, value })
}

export async function keychainDelete(service: string, account: string): Promise<void> {
  return invoke<void>('keychain_delete', { service, account })
}
