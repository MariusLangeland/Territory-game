import { ConnectionId, ScheduleAt, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { describe, expect, it } from 'vitest';
import spacetimedb, * as moduleExports from './index';

const HOST_AUTH = TestAuth.fromJwtPayload(
	JSON.stringify({ iss: 'test', sub: 'alice' }),
	new ConnectionId(1n)
);
const GUEST_AUTH = TestAuth.fromJwtPayload(
	JSON.stringify({ iss: 'test', sub: 'bob' }),
	new ConnectionId(2n)
);
const LATE_AUTH = TestAuth.fromJwtPayload(
	JSON.stringify({ iss: 'test', sub: 'late' }),
	new ConnectionId(3n)
);

function createTest() {
	return createModuleTestHarness(spacetimedb, moduleExports);
}

function createRoom(test: ReturnType<typeof createTest>) {
	test.withReducerTx(HOST_AUTH, (ctx) => {
		moduleExports.createRoom(ctx, {
			roomCode: 'TESTROOM',
			hostName: 'Alice',
			seed: 1234,
			width: 1024,
			height: 512,
			playerCount: 8,
			botDifficulty: 'standard',
			timerMinutes: 0,
			botCommandPostStacks: 0,
			version: 'test'
		});
	});
}

describe('room coordinator', () => {
	it('creates a room and seeds the host seat', () => {
		const test = createTest();
		createRoom(test);
		expect(test.db.rooms.count()).toBe(1n);
		expect(test.db.seats.count()).toBe(1n);
		const host = [...test.db.seats.iter()][0];
		expect(host.playerId).toBe(1);
		expect(host.isHost).toBe(true);
	});

	it('starts a match and records an ordered transaction', () => {
		const test = createTest();
		createRoom(test);
		test.withReducerTx(GUEST_AUTH, (ctx) => {
			moduleExports.joinRoom(ctx, { name: 'Bob' });
		});
		test.withReducerTx(HOST_AUTH, (ctx) => {
			moduleExports.setReady(ctx, { ready: true });
			moduleExports.startMatch(ctx, {});
		});
		const startedRoom = [...test.db.rooms.iter()][0];
		expect(startedRoom.status).toBe('running');
		expect(startedRoom.participationLocked).toBe(true);
		expect(startedRoom.startedAt).toBeDefined();
		expect(startedRoom.headTick).toBe(0n);
		test.withReducerTx(HOST_AUTH, (ctx) => {
			moduleExports.submitTransaction(ctx, {
				clientSequence: 1n,
				type: 'build',
				data: [1, 2, 3]
			});
		});
		const rows = [...test.db.ledgerTransactions.iter()];
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('build');
		expect(rows[0].tick).toBe(0n);
		expect(rows[0].playerId).toBe(1);
	});

	it('assigns the transaction tick from the server clock', () => {
		const test = createTest();
		createRoom(test);
		test.withReducerTx(HOST_AUTH, (ctx) => {
			moduleExports.startMatch(ctx, {});
		});
		test.clock.set(new Timestamp(500_000n));
		test.withReducerTx(HOST_AUTH, (ctx) => {
			moduleExports.submitTransaction(ctx, {
				clientSequence: 1n,
				type: 'attack',
				data: [1, 2, 3, 4]
			});
		});
		expect([...test.db.ledgerTransactions.iter()][0].tick).toBe(5n);
	});

	it('rejects late-comers after the first-tick lock', () => {
		const test = createTest();
		createRoom(test);
		test.withReducerTx(HOST_AUTH, (ctx) => {
			moduleExports.startMatch(ctx, {});
		});
		expect(() =>
			test.withReducerTx(LATE_AUTH, (ctx) => {
				moduleExports.joinRoom(ctx, { name: 'Late' });
			})
		).toThrow(/locked/);
		expect(test.db.seats.count()).toBe(1n);
	});

	it('does not emit heartbeat rows while heartbeats are disabled', () => {
		const test = createTest();
		createRoom(test);
		test.withReducerTx(HOST_AUTH, (ctx) => {
			moduleExports.startMatch(ctx, {});
		});
		test.clock.set(new Timestamp(1_000_000n));
		test.withReducerTx(TestAuth.internal(), (ctx) => {
			moduleExports.checkLiveness(ctx, {
				timer: {
					scheduledId: 0n,
					scheduledAt: ScheduleAt.interval(1_000_000n)
				}
			});
		});
		expect([...test.db.ledgerTransactions.iter()]).toHaveLength(0);
		expect(test.db.heartbeatTimers.count()).toBe(0n);
		expect([...test.db.rooms.iter()][0]?.headTick).toBe(0n);
	});
});
