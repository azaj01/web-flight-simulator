export class PlanePhysics {
	constructor() {
		this.speed = 150; // Initial speed
		this.maxSpeed = 800; // Ace Combat style speed
		this.minSpeed = 100;
		this.throttle = 0.5;
		this.enginePower = 1.2;
		this.drag = 0.005;
		this.liftFactor = 0.002;
		this.gravity = 9.8;

		this.pitch = 0;
		this.roll = 0;
		this.heading = 0;

		this.pitchRate = 60.0; // Faster
		this.rollRate = 120.0; // Much faster
		this.yawRate = 40.0; // Faster
	}

	update(input, dt) {
		// Throttle / Speed logic - Arcade style
		this.throttle = input.throttle;
		// Speed tends towards a baseline depending on throttle
		const targetSpeed = this.minSpeed + (this.throttle * (this.maxSpeed - this.minSpeed));
		this.speed += (targetSpeed - this.speed) * dt * 2;

		// Pitch, Roll, Yaw
		// In Ace Combat, control effectiveness is high at most speeds
		const controlEffectiveness = this.speed > this.minSpeed ? 1 : (this.speed / this.minSpeed);
		
		this.pitch += input.pitch * this.pitchRate * dt * controlEffectiveness;
		this.roll += input.roll * this.rollRate * dt * controlEffectiveness;
		
		// Banking turns the aircraft (Roll to Yaw/Heading coupling)
		const bankingTurn = Math.sin(this.roll * Math.PI / 180) * 20; 
		this.heading += (input.yaw * this.yawRate + bankingTurn) * dt * controlEffectiveness;

		return {
			speed: this.speed,
			pitch: this.pitch,
			roll: this.roll,
			heading: this.heading,
		};
	}
}
