import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionUsage, Timer } from 'claude-code'

import type { HudSession, HudUsage, HudWindow } from '../types'

const session = atom({ plugin: 'hud', key: 'session' } as const, null)
const usage = atom({ plugin: 'hud', key: 'usage' } as const, null)
const agents = atom({ plugin: 'hud', key: 'agents' } as const, [])
const todos = atom({ plugin: 'hud', key: 'todos' } as const, [])
const now = atom({ plugin: 'hud', key: 'now' } as const, 0)

const AGENTS_SHOWN = 3

const displayModel = (model: string) => {
  const match = /^claude-([a-z]+)-(\d+(?:-\d\b)?)/.exec(model)
  if (!match?.[1] || !match[2]) return model
  return `${match[1][0]?.toUpperCase()}${match[1].slice(1)} ${match[2].replace('-', '.')}`
}

const contextColor = (percent: number) => (percent >= 85 ? 'red' : percent >= 70 ? 'yellow' : 'green')

const quotaColor = (percent: number) => (percent >= 90 ? 'red' : percent >= 75 ? 'magentaBright' : 'blueBright')

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return ['█'.repeat(filled), '░'.repeat(width - filled)] as const
}

const formatResetTime = (resetsAt: string, at: number) => {
  const minutes = Math.ceil((Date.parse(resetsAt) - at) / 60000)
  if (minutes <= 0) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return hours % 24 > 0 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`
  return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
}

const formatElapsed = (ms: number) => {
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ${Math.floor(ms / 1000) % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3)}...`)

const toUsage = ({ context, rateLimits }: Pick<SessionUsage, 'context' | 'rateLimits'>): HudUsage => {
  const windowOf = (kind: string) => {
    const limit = rateLimits.find(each => each.kind === kind)
    return limit ? { percent: limit.percentUsed, resetsAt: limit.resetsAt } : null
  }
  return { contextPercent: context.percent ?? 0, fiveHour: windowOf('five_hour'), sevenDay: windowOf('seven_day') }
}

async function readSession($: EngineInterface): Promise<HudSession> {
  const cwd = await $.session.cwd()
  const [model, branch, status] = await Promise.all([
    $.session.model(),
    $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd }),
    $.process.run(['git', '--no-optional-locks', 'status', '--porcelain'], { cwd }),
  ])
  return {
    model: displayModel(model),
    project: cwd.split('/').filter(Boolean).pop() ?? '/',
    git: branch.exitCode === 0 ? { branch: branch.stdout.trim(), isDirty: status.stdout.trim() !== '' } : null,
  }
}

async function markNow($: EngineInterface) {
  const at = await $.clock.now()
  await update($, now, () => at)
  return at
}

let ticker: Timer | undefined

async function syncTicker($: EngineInterface) {
  const isRunning = (await read($, agents)).length > 0
  if (isRunning && !ticker) ticker = $.clock.every(1000, () => void markNow($))
  if (!isRunning) {
    ticker?.cancel()
    ticker = undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const [current, figures] = await Promise.all([readSession($), $.session.usage(), markNow($)])
    await update($, session, () => current)
    await update($, usage, () => toUsage(figures))
    return started
  })

  on('session.end', async ($, e, next) => {
    await update($, agents, () => [])
    await update($, todos, () => [])
    await syncTicker($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await markNow($)
    await update($, usage, () => toUsage(e))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      const current = await readSession($)
      await update($, session, () => current)
    } else {
      await update($, agents, list => list.filter(agent => agent.id !== e.agentId))
      await syncTicker($)
    }
    return completed
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (e.parentAgentId !== undefined || started.agentId === undefined) return started
    const agent = {
      id: started.agentId,
      type: e.subagentType,
      model: e.model,
      description: e.description,
      startedAt: await markNow($),
    }
    await update($, agents, list => [...list, agent])
    await syncTicker($)
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    if (e.tool === 'TodoWrite') {
      await update($, todos, () => e.todos.map(({ content, status }) => ({ content, status })))
      return next(e)
    }

    if (e.tool === 'TaskCreate') {
      const ran = await next(e)
      const task = ran.isError || ran.deny !== undefined ? undefined : ran.result.task
      if (task) await update($, todos, list => [...list, { id: task.id, content: e.subject, status: 'pending' as const }])
      return ran
    }

    if (e.tool === 'TaskUpdate') {
      const { taskId, status, subject } = e
      await update($, todos, list =>
        status === 'deleted'
          ? list.filter(todo => todo.id !== taskId)
          : list.map(todo =>
              todo.id === taskId ? { ...todo, status: status ?? todo.status, content: subject ?? todo.content } : todo,
            ),
      )
      return next(e)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [current, figures, running, list, at] = await Promise.all([
      read($, session),
      read($, usage),
      read($, agents),
      read($, todos),
      read($, now),
    ])
    if (!current && !figures) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const barWidth = width >= 100 ? 10 : width >= 60 ? 6 : 4

    const inProgress = list.find(todo => todo.status === 'in_progress')
    const completedTodos = list.filter(todo => todo.status === 'completed').length
    const todoProgress = <Text dimColor>({completedTodos}/{list.length})</Text>

    const lines: [string, RenderChildren][] = []
    if (current) {
      lines.push([
        'session',
        [
          <Text color="cyan">[{current.model}]</Text>,
          <Text dimColor> │ </Text>,
          <Text color="yellow">{current.project}</Text>,
          current.git && (
            <Text>
              {' '}
              <Text color="magenta">git:(</Text>
              <Text color="cyan">
                {current.git.branch}
                {current.git.isDirty ? '*' : ''}
              </Text>
              <Text color="magenta">)</Text>
            </Text>
          ),
        ],
      ])
    }
    if (figures) {
      const [contextFilled, contextEmpty] = bar(figures.contextPercent, barWidth)
      const quotaSegment = (label: string, window: HudWindow | null, windowLabel: string) => {
        if (!window) return null
        const reset = window.resetsAt ? formatResetTime(window.resetsAt, at) : ''
        return (
          <Text>
            <Text dimColor> │ {label} </Text>
            <Text color={quotaColor(window.percent)}>{bar(window.percent, barWidth)[0]}</Text>
            <Text dimColor>{bar(window.percent, barWidth)[1]}</Text>
            <Text color={quotaColor(window.percent)}> {window.percent}%</Text>
            {reset && <Text> ({reset} / {windowLabel})</Text>}
          </Text>
        )
      }
      lines.push([
        'usage',
        [
          <Text dimColor>Context </Text>,
          <Text color={contextColor(figures.contextPercent)}>{contextFilled}</Text>,
          <Text dimColor>{contextEmpty}</Text>,
          <Text color={contextColor(figures.contextPercent)}> {figures.contextPercent}%</Text>,
          quotaSegment('Usage', figures.fiveHour, '5h'),
          quotaSegment('Weekly', figures.sevenDay, '7d'),
        ],
      ])
    }
    for (const agent of running.slice(-AGENTS_SHOWN)) {
      lines.push([
        `agent-${agent.id}`,
        [
          <Text color="yellow">◐</Text>,
          ' ',
          <Text color="magenta">{agent.type}</Text>,
          agent.model && <Text dimColor> [{agent.model}]</Text>,
          agent.description && <Text dimColor>: {truncate(agent.description, 40)}</Text>,
          <Text dimColor> ({formatElapsed(Math.max(0, at - agent.startedAt))})</Text>,
        ],
      ])
    }
    if (inProgress) {
      lines.push(['todos', [<Text color="yellow">▸</Text>, ` ${truncate(inProgress.content, 50)} `, todoProgress]])
    } else if (list.length > 0 && completedTodos === list.length) {
      lines.push(['todos', [<Text color="green">✓</Text>, ' All todos complete ', todoProgress]])
    }

    return (
      <Box flexDirection="column" width={width}>
        {lines.map(([key, line]) => (
          <Box key={key}>
            <Text wrap="truncate">{line}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
