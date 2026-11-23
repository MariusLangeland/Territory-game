export interface OnlineStoredSession {
	playerId: number;
	token: string;
	sequence: number;
}

const SESSION_KEY_PREFIX = 'territory.online.';

export function onlineSessionKey(roomId: string): string {
	return `${SESSION_KEY_PREFIX}${roomId}`;
}

/**
 * Reconnect state lives in sessionStorage: a reload of the same tab rejoins the
 * seat with the same token and resumes the intent sequence. Failures are
 * silent because private mode can deny storage access.
 */
export function saveOnlineSession(roomId: string, session: OnlineStoredSession): void {
	try {
		sessionStorage.setItem(onlineSessionKey(roomId), JSON.stringify(session));
	} catch {
		// Session storage may be unavailable in private mode.
	}
}

export function loadOnlineSession(roomId: string): OnlineStoredSession | null {
	try {
		const raw = sessionStorage.getItem(onlineSessionKey(roomId));
		return raw ? (JSON.parse(raw) as OnlineStoredSession) : null;
	} catch {
		return null;
	}
}

/** Room code from the shareable `?room=` URL parameter. */
export function readRoomParam(): string | null {
	if (typeof window === 'undefined') return null;
	return new URLSearchParams(window.location.search).get('room');
}

/** Adds the room code to the address bar and returns the shareable URL. */
export function publishRoomUrl(roomId: string): string {
	if (typeof window === 'undefined') return '';
	const url = new URL(window.location.href);
	url.searchParams.set('room', roomId);
	history.replaceState(null, '', url);
	return url.toString();
}
