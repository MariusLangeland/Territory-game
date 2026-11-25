import { schema, table, t } from 'spacetimedb/server';

/**
 * Global room discovery for the one-database-per-room architecture. The lobby
 * module stores only public room previews and lifecycle metadata. Gameplay
 * transactions live in the room database named by `databaseName`.
 */
export const roomDirectory = table(
	{ name: 'room_directory', public: true },
	{
		databaseName: t.string().primaryKey(),
		name: t.string(),
		classification: t.string(),
		description: t.string(),
		rules: t.array(t.string()),
		accent: t.string(),
		status: t.string(),
		seed: t.u32(),
		width: t.u32(),
		height: t.u32(),
		playerCount: t.u8(),
		botDifficulty: t.string(),
		timerMinutes: t.u8(),
		botCommandPostStacks: t.u32(),
		host: t.identity(),
		createdAt: t.timestamp(),
		updatedAt: t.timestamp()
	}
);

const spacetimedb = schema({ roomDirectory });

export default spacetimedb;
