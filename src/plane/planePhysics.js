import * as THREE from 'three';

export class PlanePhysics {
	constructor() {
		this.speed = 150; // Initial speed
		this.maxSpeed = 1000; // Ace Combat style speed
		this.minSpeed = 100;
		this.throttle = 0.5;
		this.enginePower = 1.2;
		this.drag = 0.005;
		this.liftFactor = 0.002;
		this.gravity = 9.8;

		this.pitch = 0;
		this.roll = 0;
		this.heading = 0;

		this.pitchRate = 1.2; // Radians per second
		this.rollRate = 2.5;  // Radians per second
		this.yawRate = 0.5;   // Radians per second

		// Internal orientation using a Quaternion to avoid Gimbal Lock
		this.quaternion = new THREE.Quaternion();
	}

	reset(lon, lat, alt, heading, pitch, roll) {
		this.heading = heading || 0;
		this.pitch = pitch || 0;
		this.roll = roll || 0;
		
		const euler = new THREE.Euler(
			THREE.MathUtils.degToRad(this.pitch),
			THREE.MathUtils.degToRad(this.heading),
			THREE.MathUtils.degToRad(this.roll),
			'YXZ'
		);
		this.quaternion.setFromEuler(euler);
	}

	update(input, dt) {
		// Throttle / Speed logic - Arcade style
		this.throttle = input.throttle;
		const targetSpeed = this.minSpeed + (this.throttle * (this.maxSpeed - this.minSpeed));
		this.speed += (targetSpeed - this.speed) * dt * 2;

		const controlEffectiveness = this.speed > this.minSpeed ? 1 : (this.speed / this.minSpeed);

		// Current rotation rates - Fixed based on feedback
		const localPitch = input.pitch * this.pitchRate * dt * controlEffectiveness;
		const localRoll = input.roll * this.rollRate * dt * controlEffectiveness;
		const localYaw = input.yaw * this.yawRate * dt * controlEffectiveness;

		// Create incremental rotations around LOCAL axes
		const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), localPitch);
		const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), localRoll);
		const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), localYaw);

		// Combine: Multiply existing quaternion by local rotations
		// Sequence: Yaw -> Pitch -> Roll (Standard flight dynamics)
		this.quaternion.multiply(qYaw);
		this.quaternion.multiply(qPitch);
		this.quaternion.multiply(qRoll);

		// Normalize to prevent numerical drift
		this.quaternion.normalize();

		// Convert Quaternion back to Heading, Pitch, Roll for Cesium
		// We use YXZ: Y is Heading, X is Pitch, Z is Roll
		const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
		
		// Map Euler to flight angles (In Degrees)
		// Three.js Euler 'YXZ' -> y is Heading, x is Pitch, z is Roll
		this.heading = THREE.MathUtils.radToDeg(euler.y);
		this.pitch = THREE.MathUtils.radToDeg(euler.x);
		this.roll = THREE.MathUtils.radToDeg(euler.z);

		return {
			speed: this.speed,
			pitch: this.pitch,
			roll: this.roll,
			heading: this.heading,
		};
	}
}
