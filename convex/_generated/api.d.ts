/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appleReviewAuth from "../appleReviewAuth.js";
import type * as auth from "../auth.js";
import type * as birthdays from "../birthdays.js";
import type * as communities from "../communities.js";
import type * as communityActivities from "../communityActivities.js";
import type * as communityCalendarState from "../communityCalendarState.js";
import type * as communityEventCalendar from "../communityEventCalendar.js";
import type * as communityEventCalendarHelpers from "../communityEventCalendarHelpers.js";
import type * as communityMemberUtils from "../communityMemberUtils.js";
import type * as dailyMoods from "../dailyMoods.js";
import type * as devTools from "../devTools.js";
import type * as eventRsvps from "../eventRsvps.js";
import type * as eventTasks from "../eventTasks.js";
import type * as events from "../events.js";
import type * as googleImport from "../googleImport.js";
import type * as http from "../http.js";
import type * as linkedEvents from "../linkedEvents.js";
import type * as members from "../members.js";
import type * as onboarding from "../onboarding.js";
import type * as personalEventCalendar from "../personalEventCalendar.js";
import type * as profileCircles from "../profileCircles.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as pushTokens from "../pushTokens.js";
import type * as reminderScheduler from "../reminderScheduler.js";
import type * as shareLinks from "../shareLinks.js";
import type * as taskUtils from "../taskUtils.js";
import type * as tasks from "../tasks.js";
import type * as userCalendarEntries from "../userCalendarEntries.js";
import type * as userNotifications from "../userNotifications.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appleReviewAuth: typeof appleReviewAuth;
  auth: typeof auth;
  birthdays: typeof birthdays;
  communities: typeof communities;
  communityActivities: typeof communityActivities;
  communityCalendarState: typeof communityCalendarState;
  communityEventCalendar: typeof communityEventCalendar;
  communityEventCalendarHelpers: typeof communityEventCalendarHelpers;
  communityMemberUtils: typeof communityMemberUtils;
  dailyMoods: typeof dailyMoods;
  devTools: typeof devTools;
  eventRsvps: typeof eventRsvps;
  eventTasks: typeof eventTasks;
  events: typeof events;
  googleImport: typeof googleImport;
  http: typeof http;
  linkedEvents: typeof linkedEvents;
  members: typeof members;
  onboarding: typeof onboarding;
  personalEventCalendar: typeof personalEventCalendar;
  profileCircles: typeof profileCircles;
  pushNotifications: typeof pushNotifications;
  pushTokens: typeof pushTokens;
  reminderScheduler: typeof reminderScheduler;
  shareLinks: typeof shareLinks;
  taskUtils: typeof taskUtils;
  tasks: typeof tasks;
  userCalendarEntries: typeof userCalendarEntries;
  userNotifications: typeof userNotifications;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
