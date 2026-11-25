/** Maincloud WebSocket endpoint; override for local Spacetime development. */
export const SPACETIMEDB_URI =
	import.meta.env.VITE_SPACETIMEDB_URI ?? 'wss://maincloud.spacetimedb.com';

/** Shared room directory database. */
export const LOBBY_DATABASE = import.meta.env.VITE_SPACETIMEDB_LOBBY ?? 'territory-lobby';
