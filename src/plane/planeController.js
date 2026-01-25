export class PlaneController {
	constructor() {
		this.keys = {};
		window.addEventListener('keydown', (e) => this.keys[e.key] = true);
		window.addEventListener('keyup', (e) => this.keys[e.key] = false);

		// Mouse state
		this.mouseDragging = false;
		this.mouseDeltaX = 0;
		this.mouseDeltaY = 0;
		this.lastMouseX = 0;
		this.lastMouseY = 0;

		window.addEventListener('mousedown', (e) => {
			if (e.button === 0) { // Left click
				this.mouseDragging = true;
				this.lastMouseX = e.clientX;
				this.lastMouseY = e.clientY;
			}
		});

		window.addEventListener('mousemove', (e) => {
			if (this.mouseDragging) {
				this.mouseDeltaX += e.clientX - this.lastMouseX;
				this.mouseDeltaY += e.clientY - this.lastMouseY;
				this.lastMouseX = e.clientX;
				this.lastMouseY = e.clientY;
			}
		});

		window.addEventListener('mouseup', (e) => {
			if (e.button === 0) {
				this.mouseDragging = false;
			}
		});

		this.input = {
			throttle: 0,
			pitch: 0,
			roll: 0,
			yaw: 0,
			boost: false,
			cameraYaw: 0,
			cameraPitch: 0
		};
	}
	
	update() {
		// Boost logic
		this.input.boost = !!this.keys[' '];

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

		// Camera Yaw/Pitch (Mouse Drag)
		if (this.mouseDragging) {
			const sensitivity = 0.2;
			this.input.cameraYaw += this.mouseDeltaX * sensitivity;
			this.input.cameraPitch -= this.mouseDeltaY * sensitivity;
			
			// Clamp pitch to avoid flipping over
			this.input.cameraPitch = Math.max(-85, Math.min(85, this.input.cameraPitch));
			
			// Reset deltas after applying
			this.mouseDeltaX = 0;
			this.mouseDeltaY = 0;
		} else {
			// Smoothly reset camera back to center
			this.input.cameraYaw = this.lerp(this.input.cameraYaw, 0, 0.1);
			this.input.cameraPitch = this.lerp(this.input.cameraPitch, 0, 0.1);
		}

		return this.input;
	}

	resetMouse() {
		this.input.cameraYaw = 0;
		this.input.cameraPitch = 0;
		this.mouseDragging = false;
		this.mouseDeltaX = 0;
		this.mouseDeltaY = 0;
	}

	lerp(start, end, amt) {
		return (1 - amt) * start + amt * end;
	}
}
