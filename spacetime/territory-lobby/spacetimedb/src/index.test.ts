import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { describe, expect, it } from 'vitest';
import spacetimedb, * as moduleExports from './index';

const HOST = TestAuth.fromJwtPayload(
	JSON.stringify({ iss: 'test', sub: 'publisher' }),
	new ConnectionId(1n)
);

function createTest() {
	return createModuleTestHarness(spacetimedb, moduleExports);
}

const ROOM = {
	databaseName: 'territory-room-demo',
	name: 'DEMO FRONT',
	classification: 'TEST / OPEN',
	description: 'A room directory test.',
	rules: ['TEST RULE'],
	accent: '#7ed6c8',
	seed: 1234,
	width: 1024,
	height: 512,
	playerCount: 8,
	botDifficulty: 'standard',
	timerMinutes: 0,
	botCommandPostStacks: 0
};

describe('room directory', () => {
	it('registers an open room preview', () => {
		const test = createTest();
		test.withReducerTx(HOST, (ctx) => {
			moduleExports.registerRoom(ctx, ROOM);
		});
		expect(test.db.roomDirectory.count()).toBe(1n);
		const row = [...test.db.roomDirectory.iter()][0];
		expect(row.databaseName).toBe(ROOM.databaseName);
		expect(row.status).toBe('open');
	});

	it('only lets the registering host update status', () => {
		const test = createTest();
		test.withReducerTx(HOST, (ctx) => {
			moduleExports.registerRoom(ctx, ROOM);
		});
		test.withReducerTx(HOST, (ctx) => {
			moduleExports.setRoomStatus(ctx, { databaseName: ROOM.databaseName, status: 'running' });
		});
		expect([...test.db.roomDirectory.iter()][0].status).toBe('running');
	});
});
