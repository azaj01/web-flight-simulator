export class PlaneController {
	constructor() {
		this.keys = {};
		window.addEventListener('keydown', (e) => this.keys[e.key] = true);
		window.addEventListener('keyup', (e) => this.keys[e.key] = false);

		this.input = {
			throttle: 0,
			pitch: 0,
			roll: 0,
			yaw: 0
		};
	}
a
	update() {
		// Throttle logic
		const accelRate = 0.5;
		if (this.keys['w'] || this.keys['Shift']) {
			this.input.throttle = Math.min(1, this.input.throttle + accelRate * 0.016);
		} else if (this.keys['s'] || this.keys['Control']) {
			this.input.throttle = Math.max(0, this.input.throttle - accelRate * 0.016);
		}

		// Pitch logic (Inverted for flight)
		const pitchTarget = (this.keys['ArrowUp'] ? -1 : (this.keys['ArrowDown'] ? 1 : 0));
		this.input.pitch = this.lerp(this.input.pitch, pitchTarget, 0.1);

		// Roll logic
		const rollTarget = (this.keys['ArrowLeft'] ? -1 : (this.keys['ArrowRight'] ? 1 : 0));
		this.input.roll = this.lerp(this.input.roll, rollTarget, 0.1);

		// Yaw logic
		const yawTarget = (this.keys['a'] ? -1 : (this.keys['d'] ? 1 : 0));
		this.input.yaw = this.lerp(this.input.yaw, yawTarget, 0.1);

		return this.input;
	}

	lerp(start, end, amt) {
		return (1 - amt) * start + amt * end;
	}
}
