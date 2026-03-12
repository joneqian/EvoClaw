import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateSoul } from './soul.js'
import type { Soul } from '@evoclaw/shared'

function agentDir(agentId: string): string {
  return join(homedir(), '.evoclaw', 'agents', agentId)
}

export function ensureAgentDir(agentId: string): string {
  const dir = agentDir(agentId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function writeSoulFile(agentId: string, soul: Soul): void {
  const dir = ensureAgentDir(agentId)
  const content = generateSoul(soul)
  writeFileSync(join(dir, 'SOUL.md'), content, 'utf-8')
}

export function readSoulFile(agentId: string): string | null {
  const path = join(agentDir(agentId), 'SOUL.md')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function writeMemoryFile(agentId: string, content: string): void {
  const dir = ensureAgentDir(agentId)
  writeFileSync(join(dir, 'MEMORY.md'), content, 'utf-8')
}

export function readMemoryFile(agentId: string): string | null {
  const path = join(agentDir(agentId), 'MEMORY.md')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function generateInitialMemoryMd(agentName: string): string {
  return `# ${agentName} - 记忆档案

## 用户偏好

_尚无记录_

## 领域知识

_尚无记录_

## 行为纠正

_尚无记录_
`
}
