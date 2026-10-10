import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const START = Date.parse('2026-10-07T12:00:00Z')

const mountBand = ($: Engine) =>
  $.ui.mount({
    plugin: 'hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })

const measure = ($: Engine, percent: number, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] = []) =>
  $.session.measure({ context: { window: 200_000, tokens: percent * 2000, percent }, rateLimits, changed: ['context'] })

test('session line shows model, project and dirty branch', async ($, on) => {
  mock.clock(on, { now: START })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/home/dev/my-app' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 200_000 }, rateLimits: [] } }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('status') ? ' M hooks/register.tsx\n' : 'main\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.session.start({ cwd: '/home/dev/my-app', surface: 'terminal', isInteractive: true })
  const ui = await mountBand($)

  expect((await ui.find({ key: 'session' }))?.text).toBe('[Opus 5.5] │ my-app git:(main*)')
  expect((await ui.find({ key: 'usage' }))?.text).toBe('Context ░░░░░░░░░░ 0%')
})

test('context bar is green under 70, yellow under 85, red from 85', async ($, on) => {
  mock.clock(on, { now: START })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await measure($, 45)
  const ui = await mountBand($)

  for (const [percent, color, filled] of [
    [45, 'ansi256(2)', '█████'],
    [70, 'ansi256(3)', '███████'],
    [84, 'ansi256(3)', '████████'],
    [85, 'ansi256(1)', '█████████'],
    [100, 'ansi256(1)', '██████████'],
  ] as const) {
    await measure($, percent)
    const contextBar = await ui.find({ type: 'Text', text: /^█+$/ })
    expect(contextBar?.props.color).toBe(color)
    expect(contextBar?.text).toBe(filled)
    expect((await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe(color)
  }
  expect((await ui.find({ key: 'usage' }))?.text).toBe('Context ██████████ 100%')
})

test('usage segment shows the 5h window with time to reset, and is omitted without rate limits', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await measure($, 45, [{ kind: 'five_hour', percentUsed: 25, resetsAt: new Date(clock.now() + 90 * 60_000).toISOString() }])
  const ui = await mountBand($)
  expect((await ui.find({ key: 'usage' }))?.text).toBe('Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (1h 30m / 5h)')

  await measure($, 45)
  expect((await ui.find({ key: 'usage' }))?.text).toBe('Context █████░░░░░ 45%')
})

test('weekly segment follows the 5h one, and stands alone when only seven_day is reported', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const fiveHour = { kind: 'five_hour', percentUsed: 25, resetsAt: new Date(clock.now() + 90 * 60_000).toISOString() }
  const sevenDay = { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(clock.now() + 76 * 3_600_000).toISOString() }

  await measure($, 45, [fiveHour, sevenDay])
  const ui = await mountBand($)
  expect((await ui.find({ key: 'usage' }))?.text).toBe(
    'Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (1h 30m / 5h) │ Weekly ████░░░░░░ 40% (3d 4h / 7d)',
  )

  await measure($, 45, [sevenDay])
  expect((await ui.find({ key: 'usage' }))?.text).toBe('Context █████░░░░░ 45% │ Weekly ████░░░░░░ 40% (3d 4h / 7d)')
})
