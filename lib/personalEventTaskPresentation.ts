export const PERSONAL_TASK_VISIBILITY_DESCRIPTION =
  'כשמופעל, המשתתפים רואים גם את המשימות של כולם';

/** Apply only to authorized personal invitee rows already in stable task order. */
export function prioritizePersonalAssignments<
  T extends { assignedToUserId?: string },
>(tasks: T[], userId: string): T[] {
  return [...tasks].sort(
    (a, b) =>
      Number(b.assignedToUserId === userId) -
      Number(a.assignedToUserId === userId)
  );
}

export function personalAssignmentPresentation(
  assigned: boolean,
  name?: string
) {
  return {
    action: assigned ? 'שנה הקצאה' : 'הקצה',
    title: assigned ? 'שינוי הקצאה' : 'הקצאת משימה',
    label: assigned
      ? `הוקצה ל־${name?.trim() && name !== '?' ? name.trim() : 'חשבון לא מזוהה'}`
      : 'לא הוקצה',
  };
}
