export type HudGit = { branch: string; isDirty: boolean }
export type HudSession = { model: string; project: string; git: HudGit | null }
export type HudWindow = { percent: number; resetsAt?: string }
export type HudUsage = { contextPercent: number; fiveHour: HudWindow | null; sevenDay: HudWindow | null }
export type HudAgent = { id: string; type: string; model?: string; description: string; startedAt: number }
export type HudTodo = { id?: string; content: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    hud: {
      session: HudSession | null
      usage: HudUsage | null
      agents: HudAgent[]
      todos: HudTodo[]
      now: number
    }
  }
}
