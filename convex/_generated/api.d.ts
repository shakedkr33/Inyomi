/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as birthdays from "../birthdays.js";
import type * as communities from "../communities.js";
import type * as dailyMoods from "../dailyMoods.js";
import type * as eventRsvps from "../eventRsvps.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as onboarding from "../onboarding.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  birthdays: typeof birthdays;
  communities: typeof communities;
  dailyMoods: typeof dailyMoods;
  eventRsvps: typeof eventRsvps;
  events: typeof events;
  http: typeof http;
  onboarding: typeof onboarding;
  tasks: typeof tasks;
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
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
