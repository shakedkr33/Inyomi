import { v } from 'convex/values';

// Additive representation: legacy names remain in events.participants.
// This is display provenance, never an independent authorization grant.
export const participantDetail = v.object({
  id: v.string(),
  name: v.string(),
  color: v.string(),
  source: v.union(
    v.literal('family'),
    v.literal('contact'),
    v.literal('legacy'),
    v.literal('user')
  ),
  userId: v.optional(v.id('users')),
});
export const personalTaskChange = v.object({
  id: v.optional(v.id('eventTasks')),
  title: v.optional(v.string()),
  completed: v.optional(v.boolean()),
  order: v.optional(v.number()),
  assignee: v.optional(v.union(v.id('users'), v.null())),
});
