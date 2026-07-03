// @evidata/connection — Connection CRUD/test/introspect (spec 08 §6).
export {
  ConnectionService,
  ConnectionAccessError,
  VaultUnavailableError,
} from './connection-service';
export type {
  ConnectionStore,
  ConnectionServiceDeps,
  CreateConnectionInput,
  IntrospectResult,
  UpdateConnectionInput,
} from './connection-service';
