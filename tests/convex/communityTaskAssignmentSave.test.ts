import { describe, expect, it, mock } from 'bun:test';
import {
  CommunityTaskAssignmentSaveError,
  saveCommunityTaskAssignments,
} from '../../lib/communityTaskAssignmentSave';

async function rejectedAssignment(save: Promise<string>) {
  try {
    await save;
  } catch (error) {
    expect(error).toBeInstanceOf(CommunityTaskAssignmentSaveError);
    if (error instanceof CommunityTaskAssignmentSaveError) return error;
    throw error;
  }
  throw new Error('Expected a partial-save failure, not full success');
}

describe('Event Edit community assignment save tail', () => {
  it('rejects an assignment removal and does not signal success or navigate', async () => {
    const navigate = mock(() => 'event-id');
    const setAssignee = mock(async () => {
      throw new Error('Permission denied');
    });
    const error = await rejectedAssignment(
      saveCommunityTaskAssignments([setAssignee], navigate)
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(error.message).toContain('נשמרו');
    expect(error.message).toContain('לא הושלם');
    expect(error.message).not.toContain('Permission denied');
  });

  it('retries only failed and remaining assignments, even after repeated failure', async () => {
    // These operations precede the assignment phase in Event Edit. Retrying
    // the error must not return to that preparation or create the task again.
    const createTask = mock(async () => 'new-task-id');
    const taskId = await createTask();
    const calls: string[] = [];
    let reject = true;
    const first = mock(async () => { calls.push(`assign:${taskId}`); });
    const removal = mock(async () => {
      calls.push('remove-assignee');
      if (reject) throw new Error('Rejected');
    });
    const last = mock(async () => { calls.push('last-assignment'); });
    const finish = mock(() => 'event-id');
    const failure = await rejectedAssignment(
      saveCommunityTaskAssignments([first, removal, last], finish)
    );
    const repeated = await rejectedAssignment(failure.retry());
    expect(first).toHaveBeenCalledTimes(1);
    expect(last).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    reject = false;
    expect(await repeated.retry()).toBe('event-id');
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(removal).toHaveBeenCalledTimes(3);
    expect(last).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      `assign:${taskId}`, 'remove-assignee', 'remove-assignee',
      'remove-assignee', 'last-assignment',
    ]);
  });

  it('finishes once after all assignments succeed, including an empty list', async () => {
    const calls: string[] = [];
    const finish = () => { calls.push('navigate'); return 'event-id'; };
    expect(await saveCommunityTaskAssignments([
      async () => { calls.push('clear-assignee'); },
    ], finish)).toBe('event-id');
    expect(calls).toEqual(['clear-assignee', 'navigate']);
    expect(await saveCommunityTaskAssignments([], () => 'no-tasks')).toBe('no-tasks');
  });
});
