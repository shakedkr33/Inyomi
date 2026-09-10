/**
 * FIX 8C — Community Event task reordering, aligned with Personal Event
 * Edit UX.
 *
 * These tests exercise `reconcileEventTaskOrder`
 * (lib/eventTaskOrderReconcile.ts) directly — the exact pure function the
 * real Event Edit save handler
 * (app/(authenticated)/event-edit/[id].tsx) calls to build the
 * `eventTasks.reorder` payload from the form's final local task array. Not
 * a parallel reimplementation of the save logic.
 *
 * Run with: bun test
 */

import { describe, expect, it } from 'bun:test';
import { reconcileEventTaskOrder } from '../../lib/eventTaskOrderReconcile';

/** Every task in these tests already exists on the server — id resolves to itself. */
const identityResolver = (localId: string): string => localId;

describe('reconcileEventTaskOrder', () => {
  it('[TEST 1] pure reorder: A,B,C → C,A,B', () => {
    const currentTasks = [{ id: 'C' }, { id: 'A' }, { id: 'B' }];
    const result = reconcileEventTaskOrder(currentTasks, identityResolver);
    expect(result).toEqual(['C', 'A', 'B']);
  });

  it('[TEST 2] delete + reorder: A,B,C → delete B, move C first → C,A', () => {
    // RelatedTasksSection removes deleted tasks from local state immediately,
    // so `currentTasks` never contains B here — this is the exact shape the
    // real save handler passes in.
    const currentTasks = [{ id: 'C' }, { id: 'A' }];
    const result = reconcileEventTaskOrder(currentTasks, identityResolver);
    expect(result).toEqual(['C', 'A']);
  });

  it('[TEST 3] add + reorder: A,B + add C + move C first → C,A,B', () => {
    // C was just created this save — its local id is a temporary client id
    // ("temp-c") that only resolves to a real backend id ("real-c") after
    // eventTasks.createBatch runs, exactly like newTaskRealIds in the real
    // save handler.
    const currentTasks = [{ id: 'temp-c' }, { id: 'A' }, { id: 'B' }];
    const resolve = (localId: string): string | undefined => {
      if (localId === 'temp-c') return 'real-c';
      return localId; // A, B already existed
    };
    const result = reconcileEventTaskOrder(currentTasks, resolve);
    expect(result).toEqual(['real-c', 'A', 'B']);
  });

  it('[TEST 4] stable/deterministic: re-running with the same input produces the same order', () => {
    const currentTasks = [{ id: 'X' }, { id: 'Y' }, { id: 'Z' }];
    const first = reconcileEventTaskOrder(currentTasks, identityResolver);
    const second = reconcileEventTaskOrder(currentTasks, identityResolver);
    expect(first).toEqual(second);
    expect(first).toEqual(['X', 'Y', 'Z']);
  });

  it('drops a task whose id cannot be resolved (defensive — should not happen in practice)', () => {
    const currentTasks = [{ id: 'A' }, { id: 'ghost' }, { id: 'B' }];
    const resolve = (localId: string): string | undefined =>
      localId === 'ghost' ? undefined : localId;
    const result = reconcileEventTaskOrder(currentTasks, resolve);
    expect(result).toEqual(['A', 'B']);
  });

  it('de-duplicates if the resolver maps two local ids to the same backend id', () => {
    const currentTasks = [{ id: 'A' }, { id: 'A-dup' }, { id: 'B' }];
    const resolve = (localId: string): string | undefined =>
      localId === 'A-dup' ? 'A' : localId;
    const result = reconcileEventTaskOrder(currentTasks, resolve);
    expect(result).toEqual(['A', 'B']);
  });

  it('returns an empty array for an empty task list', () => {
    expect(reconcileEventTaskOrder([], identityResolver)).toEqual([]);
  });
});
