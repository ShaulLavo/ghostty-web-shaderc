import { describe, expect, test } from 'bun:test'
import { PreviewFrameSchedule, type ShaderFrame } from '../../examples/showcase/frame-schedule.js'

function accept(frames: ShaderFrame[]): (frame: ShaderFrame) => boolean {
  return (frame) => {
    frames.push(frame)
    return true
  }
}

describe('preview frame scheduling', () => {
  test('coalesces paused invalidations and retains a rejected draw until admitted', () => {
    const schedule = new PreviewFrameSchedule()
    const frames: ShaderFrame[] = []
    schedule.draw(0, accept(frames))
    expect(schedule.pending).toBe(false)
    schedule.invalidate()
    schedule.invalidate()
    schedule.draw(16, () => false)
    expect(schedule.pending).toBe(true)
    schedule.draw(32, accept(frames))
    schedule.draw(48, accept(frames))
    expect(frames).toEqual([
      { time: 0, delta: 0, frame: 0 },
      { time: 0, delta: 0, frame: 1 },
    ])
    expect(schedule.pending).toBe(false)
  })

  test('advances real time and frame count only for accepted draws without a delta cap', () => {
    const schedule = new PreviewFrameSchedule()
    const frames: ShaderFrame[] = []
    schedule.setActive(true, 0)
    schedule.draw(0, accept(frames))
    schedule.draw(16, () => false)
    schedule.draw(100, () => false)
    schedule.draw(250, accept(frames))
    schedule.draw(500, accept(frames))
    expect(frames).toEqual([
      { time: 0, delta: 0, frame: 0 },
      { time: 0.25, delta: 0.25, frame: 1 },
      { time: 0.5, delta: 0.25, frame: 2 },
    ])
  })

  test('excludes inactive time without discarding the active tail of a blocked frame', () => {
    const schedule = new PreviewFrameSchedule()
    const frames: ShaderFrame[] = []
    schedule.setActive(true, 0)
    schedule.draw(0, accept(frames))
    schedule.invalidate()
    schedule.draw(100, () => false)
    schedule.setActive(false, 250)
    schedule.draw(500, () => false)
    schedule.setActive(true, 1000)
    schedule.draw(1250, accept(frames))
    expect(frames).toEqual([
      { time: 0, delta: 0, frame: 0 },
      { time: 0.5, delta: 0.5, frame: 1 },
    ])
  })

  test('retains a refused animation draw when animation stops before the retry', () => {
    const schedule = new PreviewFrameSchedule()
    const frames: ShaderFrame[] = []
    schedule.setActive(true, 0)
    schedule.draw(0, accept(frames))
    schedule.draw(100, () => false)
    schedule.setActive(false, 250)
    expect(schedule.pending).toBe(true)
    schedule.draw(1000, accept(frames))
    expect(frames).toEqual([
      { time: 0, delta: 0, frame: 0 },
      { time: 0.25, delta: 0.25, frame: 1 },
    ])
  })

  test('redraws new paused state at frozen time and resumes without a time jump', () => {
    const schedule = new PreviewFrameSchedule()
    const frames: ShaderFrame[] = []
    schedule.setActive(true, 0)
    schedule.draw(250, accept(frames))
    schedule.setActive(false, 500)
    schedule.invalidate()
    schedule.draw(5000, accept(frames))
    schedule.invalidate()
    schedule.draw(6000, accept(frames))
    schedule.setActive(true, 10000)
    schedule.draw(10250, accept(frames))
    expect(frames).toEqual([
      { time: 0.25, delta: 0.25, frame: 0 },
      { time: 0.5, delta: 0.25, frame: 1 },
      { time: 0.5, delta: 0, frame: 2 },
      { time: 0.75, delta: 0.25, frame: 3 },
    ])
  })

  test('does not reset the active clock on a redundant running-state update', () => {
    const schedule = new PreviewFrameSchedule()
    const frames: ShaderFrame[] = []
    schedule.setActive(true, 0)
    schedule.setActive(true, 200)
    schedule.draw(250, accept(frames))
    expect(frames).toEqual([{ time: 0.25, delta: 0.25, frame: 0 }])
  })
})
