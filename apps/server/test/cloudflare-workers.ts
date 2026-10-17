import { mock } from "bun:test";

// Bun has no workerd runtime: stand in for the base class so Durable Objects run as plain classes.
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
  env: {},
}));
