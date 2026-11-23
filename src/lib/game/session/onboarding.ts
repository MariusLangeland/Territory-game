const ONBOARDING_KEY = 'territory.onboarding.v1';

export function loadOnboardingDone(): boolean {
	try {
		return window.localStorage.getItem(ONBOARDING_KEY) === 'done';
	} catch {
		return false;
	}
}

export function saveOnboardingDone(): void {
	try {
		window.localStorage.setItem(ONBOARDING_KEY, 'done');
	} catch {
		// Storage can be unavailable in private/sandboxed contexts; the current
		// match still shows hints, they just reappear next time.
	}
}
