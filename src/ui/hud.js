export class HUD {
	constructor() {
		this.speedElem = document.getElementById('speed');
		this.altElem = document.getElementById('altitude');
		this.timeElem = document.getElementById('time');
		this.scoreElem = document.getElementById('score');
		this.minimapCanvas = document.getElementById('minimap');
		this.miniCtx = this.minimapCanvas.getContext('2d');

		this.startTime = Date.now();
		this.createHorizon();
		this.resizeMinimap();
		window.addEventListener('resize', () => this.resizeMinimap());
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
                width: 400px;
                height: 400px;
                transform: translate(-50%, -50%);
                pointer-events: none;
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
                transition: transform 0.05s linear;
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
		// Update Speed & Alt
		this.speedElem.innerText = Math.round(state.speed).toString().padStart(3, '0');
		this.altElem.innerText = Math.round(state.alt * 3.28084).toString().padStart(3, '0');

		// Update Time
		const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
		const h = Math.floor(elapsed / 3600);
		const m = Math.floor((elapsed % 3600) / 60);
		const s = elapsed % 60;
		this.timeElem.innerText = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

		// Update Horizon
		const pitchLines = document.getElementById('pitch-lines');
		const horizon = document.getElementById('horizon-container');
		if (pitchLines && horizon) {
			horizon.style.transform = `translate(-50%, -50%) rotate(${-state.roll}deg)`;
			pitchLines.style.transform = `translateY(${state.pitch * 5}px)`;
		}

		this.drawMinimap(state);
	}

	drawMinimap(state) {
		const ctx = this.miniCtx;
		const w = this.minimapCanvas.width;
		const h = this.minimapCanvas.height;
		const centerX = w / 2;
		const centerY = h / 2;
		const radius = Math.min(centerX, centerY) - 10;

		ctx.clearRect(0, 0, w, h);

		// Rotating part (World)
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate(-state.heading * Math.PI / 180); // Rotate world opposite to heading

		// Draw background grid
		ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';
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
		ctx.font = 'bold 16px Courier New';
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
			// Rotate text back so it's always upright? 
			// In Ace Combat, the letters usually stay upright or rotate with the map.
			// Let's make them rotate WITH the map for now as requested ("mata angin menyesuaikan").
			ctx.rotate(state.heading * Math.PI / 180); 
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
