/** Server-resolved display projection; it never grants event access. */
export type PersonalHomeParticipant = {
  id: string;
  userId?: string;
  name: string;
  color: string;
};

export type PersonalHomeParticipants = {
  profiles: PersonalHomeParticipant[];
  extraCount: number;
};

export function personalHomeCircles(
  participants: PersonalHomeParticipants,
  viewerId?: string
) {
  const seen = new Set<string>();
  return {
    profiles: participants.profiles.filter((profile) => {
      if (profile.userId && profile.userId === viewerId) return false;
      const identity = profile.userId ? `user:${profile.userId}` : profile.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }),
    extraCount: participants.extraCount,
  };
}
