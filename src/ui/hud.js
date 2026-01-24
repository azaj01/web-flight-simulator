export class HUD {
	constructor() {
		this.speedElem = document.getElementById('speed');
		this.altElem = document.getElementById('altitude');
		this.timeElem = document.getElementById('time');
		this.scoreElem = document.getElementById('score');
		this.minimapCanvas = document.getElementById('minimap');
		this.miniCtx = this.minimapCanvas.getContext('2d');
		this.uiContainer = document.getElementById('uiContainer');

		this.startTime = Date.now();
		
		// Inertia / Smoothing properties
		this.smoothedPitch = 0;
		this.smoothedRoll = 0;
		this.smoothedHeading = 0;
		this.smoothedThrottle = 0;
		this.smoothedYaw = 0;
		
		this.createHorizon();
		this.resizeMinimap();
		window.addEventListener('resize', () => this.resizeMinimap());
	}

	resetTime() {
		this.startTime = Date.now();
	}

	resizeMinimap() {
		this.minimapCanvas.width = this.minimapCanvas.offsetWidth;
		this.minimapCanvas.height = this.minimapCanvas.offsetHeight;
	}

	createHorizon() {
		if (!document.getElementById('horizon-container')) {
			const ui = document.getElementById('uiContainer');
			const horizon = document.createElement('div');
			horizon.id = 'horizon-container';
			horizon.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                width: 600px;
                height: 600px;
                transform: translate(-50%, -50%);
                pointer-events: none;
                overflow: hidden;
            `;

			const crosshair = document.createElement('div');
			crosshair.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                width: 40px;
                height: 2px;
                background: #0f0;
                transform: translate(-50%, -50%);
            `;
			const innerCross = document.createElement('div');
			innerCross.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                width: 2px;
                height: 10px;
                background: #0f0;
                transform: translate(-50%, -50%);
            `;
			crosshair.appendChild(innerCross);
			horizon.appendChild(crosshair);

			const pitchLines = document.createElement('div');
			pitchLines.id = 'pitch-lines';
			pitchLines.style.cssText = `
                position: absolute;
                width: 100%;
                height: 100%;
            `;
			
			// Add some pitch ladder lines
			for (let i = -90; i <= 90; i += 10) {
				if (i === 0) continue;
				const line = document.createElement('div');
				line.style.cssText = `
                    position: absolute;
                    left: 30%;
                    width: 40%;
                    height: 1px;
                    background: rgba(0, 255, 0, 0.5);
                    top: ${50 - i}% ;
                    text-align: center;
                    font-size: 10px;
                `;
				line.innerText = i;
				pitchLines.appendChild(line);
			}

			horizon.appendChild(pitchLines);
			ui.appendChild(horizon);
		}
	}

	update(state) {
		// 1. Inertia Calculations (Lagged values)
		const lerpFactor = 0.5; // Lower = more lag/inertia
		
		// Handle angle wrapping for smoothing
		const lerpAngle = (current, target, factor) => {
			let diff = target - current;
			while (diff < -180) diff += 360;
			while (diff > 180) diff -= 360;
			return current + diff * factor;
		};

		const getAngleDiff = (target, current) => {
			let diff = target - current;
			while (diff < -180) diff += 360;
			while (diff > 180) diff -= 360;
			return diff;
		};

		const normalizeAngle = (a) => {
			while (a <= -180) a += 360;
			while (a > 180) a -= 360;
			return a;
		};

		this.smoothedPitch = lerpAngle(this.smoothedPitch, state.pitch, lerpFactor);
		this.smoothedRoll = lerpAngle(this.smoothedRoll, state.roll, lerpFactor);
		this.smoothedHeading = lerpAngle(this.smoothedHeading, state.heading || 0, lerpFactor);
		this.smoothedThrottle = this.smoothedThrottle + ((state.throttle || 0) - this.smoothedThrottle) * (lerpFactor * 0.4); // More inertia for throttle
		this.smoothedYaw = this.smoothedYaw + ((state.yaw || 0) - this.smoothedYaw) * lerpFactor;

		// Keep smoothed values normalized to prevent drift
		this.smoothedPitch = normalizeAngle(this.smoothedPitch);
		this.smoothedRoll = normalizeAngle(this.smoothedRoll);
		this.smoothedHeading = normalizeAngle(this.smoothedHeading);

		// 2. Semi-3D Effect (Tilt and Offset based on lag)
		// Use shortest distance diff to avoid jumps at 180/-180
		const pitchDiff = getAngleDiff(state.pitch, this.smoothedPitch);
		const rollDiff = getAngleDiff(state.roll, this.smoothedRoll);
		const yawDiff = (state.yaw || 0) - this.smoothedYaw;
		const throttleDiff = (state.throttle || 0) - this.smoothedThrottle;
		
		// Apply perspective tilt to the whole HUD
		if (this.uiContainer) {
			const maxTilt = 15; // Limit tilt to prevent extreme distortion
			const tiltX = Math.max(-maxTilt, Math.min(maxTilt, pitchDiff * 0.8));    // Tilt up/down
			const tiltY = Math.max(-maxTilt, Math.min(maxTilt, -rollDiff * 0.3 + yawDiff * 5.0));   // Tilt left/right (Roll + Yaw)
			
			const maxShift = 50;
			const shiftX = Math.max(-maxShift, Math.min(maxShift, -rollDiff * 1.5 - yawDiff * 20.0));  // Slight slide (Roll + Yaw)
			const shiftY = Math.max(-maxShift, Math.min(maxShift, pitchDiff * 3.0 + throttleDiff * 15.0));   // Slide with pitch + throttle
			
			// Acceleration "Zoom" effect
			const scale = 1 + (throttleDiff * 0.25); // More pronounced zoom on acceleration
			
			this.uiContainer.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translate(${shiftX}px, ${shiftY}px) scale(${scale})`;
		}

		// 3. Update Speed & Alt
		this.speedElem.innerText = Math.round(state.speed).toString().padStart(3, '0');
		
		// Convert meters to feet, ensure non-negative for display, and use 5 digits for alt
		const altFeet = Math.max(0, Math.round(state.alt * 3.28084));
		this.altElem.innerText = altFeet.toString().padStart(5, '0');

		// Update Time
		const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
		const h = Math.floor(elapsed / 3600);
		const m = Math.floor((elapsed % 3600) / 60);
		const s = elapsed % 60;
		this.timeElem.innerText = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

		// 4. Update Horizon (Using smoothed values for "Inertia" look)
		const pitchLines = document.getElementById('pitch-lines');
		const horizon = document.getElementById('horizon-container');
		if (pitchLines && horizon) {
			// The ladder rotates and shifts based on physics reality, 
			// but we use smoothed values if we want the LADDER itself to lag.
			horizon.style.transform = `translate(-50%, -50%) rotate(${-this.smoothedRoll}deg)`;
			pitchLines.style.transform = `translateY(${this.smoothedPitch * 6}px)`;
		}

		this.drawMinimap(state);
	}

	drawMinimap(state) {
		if (!this.miniCtx || !this.minimapCanvas) return;
		
		const ctx = this.miniCtx;
		const w = this.minimapCanvas.width || 250;
		const h = this.minimapCanvas.height || 250;
		const centerX = w / 2;
		const centerY = h / 2;
		const radius = Math.min(centerX, centerY) - 10;

		ctx.clearRect(0, 0, w, h);

		// Rotating part (World)
		ctx.save();
		ctx.translate(centerX, centerY);
		
		const heading = this.smoothedHeading;
		ctx.rotate(-heading * Math.PI / 180); // Rotate world opposite to heading

		// Draw background grid
		ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
		ctx.lineWidth = 1;
		const gridSize = 50;
		const limit = 400; // Large enough area
		for (let x = -limit; x <= limit; x += gridSize) {
			ctx.beginPath();
			ctx.moveTo(x, -limit);
			ctx.lineTo(x, limit);
			ctx.stroke();
		}
		for (let y = -limit; y <= limit; y += gridSize) {
			ctx.beginPath();
			ctx.moveTo(-limit, y);
			ctx.lineTo(limit, y);
			ctx.stroke();
		}

		// Draw Compass Directions
		ctx.fillStyle = '#0f0';
		ctx.font = 'bold 18px AceCombat';
		ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
		ctx.shadowBlur = 4;
		ctx.textAlign = 'center';

		const directions = [
			{ label: 'N', angle: 0 },
			{ label: 'E', angle: 90 },
			{ label: 'S', angle: 180 },
			{ label: 'W', angle: 270 }
		];

		directions.forEach(dir => {
			const rad = dir.angle * Math.PI / 180;
			const dx = Math.sin(rad) * radius;
			const dy = -Math.cos(rad) * radius;
			
			ctx.save();
			ctx.translate(dx, dy);
			// Rotate text back so it's always upright
			ctx.rotate(this.smoothedHeading * Math.PI / 180); 
			ctx.fillText(dir.label, 0, 5);
			ctx.restore();
		});

		ctx.restore();

		// Static part (Player Icon) - Always facing up
		ctx.save();
		ctx.translate(centerX, centerY);
		// Fixed position, fixed "up" rotation
		ctx.fillStyle = '#0f0';
		ctx.beginPath();
		ctx.moveTo(0, -12); // Tip
		ctx.lineTo(8, 10);  // Right wing
		ctx.lineTo(0, 5);   // Tail inner
		ctx.lineTo(-8, 10); // Left wing
		ctx.closePath();
		ctx.fill();
		
		// Optional circle overlay
		ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.stroke();

		ctx.restore();

		// Radar sweep effect (Independent of rotation)
		const sweepTime = (Date.now() / 1500) % 1;
		ctx.strokeStyle = `rgba(0, 255, 0, ${0.4 * (1 - sweepTime)})`;
		ctx.beginPath();
		ctx.arc(centerX, centerY, sweepTime * radius, 0, Math.PI * 2);
		ctx.stroke();
	}
}
