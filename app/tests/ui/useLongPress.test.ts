import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLongPress } from '../../src/ui/useLongPress';

const ev = (x: number, y: number) => ({ pointerType: 'touch', button: 0, clientX: x, clientY: y }) as never;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useLongPress', () => {
  it('fires after 500ms', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress(fn));
    result.current.onPointerDown(ev(0, 0));
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a move of 11px cancels it', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress(fn));
    result.current.onPointerDown(ev(0, 0));
    result.current.onPointerMove(ev(11, 0));
    vi.advanceTimersByTime(600);
    expect(fn).not.toHaveBeenCalled();
  });

  it('swallows the click after firing', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress(fn));
    result.current.onPointerDown(ev(0, 0));
    vi.advanceTimersByTime(500);
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    result.current.onClickCapture(click as never);
    expect(click.stopPropagation).toHaveBeenCalled();
  });

  it('a short tap lets the click through', () => {
    const { result } = renderHook(() => useLongPress(vi.fn()));
    result.current.onPointerDown(ev(0, 0));
    vi.advanceTimersByTime(200);
    result.current.onPointerUp();
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    result.current.onClickCapture(click as never);
    expect(click.stopPropagation).not.toHaveBeenCalled();
  });
});
