/** Event Edit's final community-assignment phase, after other writes succeeded. */
export class CommunityTaskAssignmentSaveError extends Error {
  constructor(readonly retry: () => Promise<string>) {
    super(
      'פרטי האירוע ושינויים נוספים נשמרו, אך עדכון שיוך המשימות לא הושלם. אפשר לנסות שוב להשלמת השיוך. עד אז הטופס נשאר לתצוגה בלבד. יציאה לא תבטל שינויים שכבר נשמרו.'
    );
    this.name = 'CommunityTaskAssignmentSaveError';
  }
}

export async function saveCommunityTaskAssignments(
  updates: ReadonlyArray<() => Promise<unknown>>,
  finishSave: () => string
): Promise<string> {
  // The cursor belongs to this save attempt, not to the reactive query/form.
  // Advance only after acknowledgement; completed assignments are not replayed.
  let next = 0;
  const resume = async (): Promise<string> => {
    while (next < updates.length) {
      try {
        await updates[next]();
      } catch {
        throw new CommunityTaskAssignmentSaveError(resume);
      }
      next += 1;
    }
    return finishSave();
  };
  return resume();
}
