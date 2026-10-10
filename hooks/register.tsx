import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionUsage } from 'claude-code'

import type { HudSession, HudUsage, HudWindow } from '../types'

const session = atom({ plugin: 'hud', key: 'session' } as const, null)
const usage = atom({ plugin: 'hud', key: 'usage' } as const, null)
const now = atom({ plugin: 'hud', key: 'now' } as const, 0)

const displayModel = (model: string) => {
  const match = /^claude-([a-z]+)-(\d+(?:-\d\b)?)/.exec(model)
  if (!match?.[1] || !match[2]) return model
  return `${match[1][0]?.toUpperCase()}${match[1].slice(1)} ${match[2].replace('-', '.')}`
}

const contextColor = (percent: number) => (percent >= 85 ? 'ansi256(1)' : percent >= 70 ? 'ansi256(3)' : 'ansi256(2)')

const quotaColor = (percent: number) => (percent >= 90 ? 'ansi256(1)' : percent >= 75 ? 'ansi256(13)' : 'ansi256(12)')

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const [current, figures] = await Promise.all([readSession($), $.session.usage(), markNow($)])
    await update($, session, () => current)
    await update($, usage, () => toUsage(figures))
    return started
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
    }
    return completed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [current, figures, at] = await Promise.all([read($, session), read($, usage), read($, now)])
    if (!current && !figures) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const barWidth = width >= 100 ? 10 : width >= 60 ? 6 : 4

    const lines: [string, RenderChildren][] = []
    if (current) {
      lines.push([
        'session',
        [
          <Text color="ansi256(6)">[{current.model}]</Text>,
          <Text> │ </Text>,
          <Text color="ansi256(3)">{current.project}</Text>,
          current.git && (
            <Text>
              {' '}
              <Text color="ansi256(5)">git:(</Text>
              <Text color="ansi256(6)">
                {current.git.branch}
                {current.git.isDirty ? '*' : ''}
              </Text>
              <Text color="ansi256(5)">)</Text>
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
            <Text> │ </Text>
            <Text dimColor>{label} </Text>
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
