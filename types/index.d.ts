export type HudGit = { branch: string; isDirty: boolean }
export type HudSession = { model: string; project: string; git: HudGit | null }
export type HudWindow = { percent: number; resetsAt?: string }
export type HudUsage = { contextPercent: number; fiveHour: HudWindow | null; sevenDay: HudWindow | null }

declare module 'claude-code' {
  interface PluginState {
    hud: {
      session: HudSession | null
      usage: HudUsage | null
      now: number
    }
  }
}
