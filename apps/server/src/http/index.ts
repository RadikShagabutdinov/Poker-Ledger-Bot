// HTTP API transport (SPEC §11): routes and auth only, business logic is in `services/`.
export { createApp, type HttpOptions } from './app';
export { ApiRateLimiter } from './rateLimit';
