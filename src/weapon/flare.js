import * as THREE from 'three';
import * as Cesium from 'cesium';

function makeSpriteTexture(color1 = '#ffffff', color2 = '#ffcc88') {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');

	const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
	grad.addColorStop(0, color1);
	grad.addColorStop(0.2, color2);
	grad.addColorStop(0.6, 'rgba(0,0,0,0.2)');
	grad.addColorStop(1, 'rgba(0,0,0,0)');

	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.needsUpdate = true;
	return tex;
}

export class Flare {
	constructor(scene, viewer, startPos, heading, pitch, speed) {
		this.scene = scene;
		this.viewer = viewer;

		this.lon = startPos.lon;
		this.lat = startPos.lat;
		this.alt = startPos.alt;

		this.heading = (heading + 180 + (Math.random() - 0.5) * 40);
		this.pitch = (pitch - 15 - Math.random() * 20);
		this.speed = speed * 0.5;
		this.gravity = 5.0;
		this.verticalVelocity = 0;

		this.life = 4.0;
		this.maxLife = 4.0;
		this.active = true;

		this._scratchCartesian = new Cesium.Cartesian3();
		this._scratchMatrix = new Cesium.Matrix4();
		this._scratchCameraMatrix = new Cesium.Matrix4();
		this._scratchThreeMatrix = new THREE.Matrix4();

		this.trailPool = [];
		this.activeTrail = [];
		this.lastTrailSpawn = 0;

		this._initAssets();
		this.initMesh();
	}

	_initAssets() {
		this.coreTex = makeSpriteTexture('#ffffff', '#ffeecc');
		this.glowTex = makeSpriteTexture('#ffddaa', '#ff9933');
		this.smokeTex = (function(){
			const size = 128;
			const c = document.createElement('canvas');
			c.width = size; c.height = size;
			const ctx = c.getContext('2d');
			const g = ctx.createRadialGradient(size/2,size/2,2,size/2,size/2,size/1.2);
			g.addColorStop(0,'rgba(200,200,200,0.9)');
			g.addColorStop(0.4,'rgba(180,180,180,0.5)');
			g.addColorStop(1,'rgba(0,0,0,0)');
			ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
			const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
		})();
	}

	initMesh() {
		// Group to hold the core and glow; we'll set its camera-space matrix each frame
		this.group = new THREE.Group();
		this.group.matrixAutoUpdate = false;

		const coreMat = new THREE.SpriteMaterial({ map: this.coreTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
		const core = new THREE.Sprite(coreMat);
		core.scale.set(1.0, 1.0, 1.0);
		this.core = core;
		this.group.add(core);

		const glowMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffaa44, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
		const glow = new THREE.Sprite(glowMat);
		glow.scale.set(3.0, 3.0, 1.0);
		this.glow = glow;
		// add glow behind core for render ordering
		this.group.add(glow);

		this.scene.add(this.group);

		// Preallocate a pooled set of smoke sprites for the trail
		for (let i = 0; i < 80; i++) {
			const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xcccccc, transparent: true, opacity: 0, depthWrite: false });
			const s = new THREE.Sprite(mat);
			s.scale.set(0.8, 0.8, 1);
			s.matrixAutoUpdate = false;
			s._poolIndex = i;
			this.trailPool.push(s);
			// add to scene but invisible initially
			this.scene.add(s);
		}
	}

	update(dt) {
		if (!this.active) return;

		this.life -= dt;
		if (this.life <= 0) {
			this.destroy();
			return;
		}

		const move = (this.speed * dt);
		const newPos = this.calculateMove(move);
		this.lon = newPos.lon;
		this.lat = newPos.lat;
		this.alt = newPos.alt;

		this.verticalVelocity -= this.gravity * dt;
		this.alt += this.verticalVelocity * dt;

		this.speed *= 0.985;

		this.updateThreeMatrix();
		this._spawnTrailIfNeeded();
		this._updateTrail(dt);

		const t = this.life / this.maxLife;
		this.core.material.opacity = Math.min(1.0, t * 1.4);
		this.glow.material.opacity = Math.min(0.9, t * 1.2);
		const coreScale = 0.6 + (1 - t) * 0.2;
		this.core.scale.set(coreScale, coreScale, 1);
		this.glow.scale.set(2.5 * coreScale, 2.5 * coreScale, 1);
	}

	calculateMove(dist) {
		const radH = Cesium.Math.toRadians(this.heading);
		const radP = Cesium.Math.toRadians(this.pitch);
		const R = 6371000;
		const dLat = (dist * Math.cos(radH) * Math.cos(radP)) / R;
		const dLon = (dist * Math.sin(radH) * Math.cos(radP)) / (R * Math.cos(Cesium.Math.toRadians(this.lat)));
		const dAlt = dist * Math.sin(radP);
		return {
			lon: this.lon + Cesium.Math.toDegrees(dLon),
			lat: this.lat + Cesium.Math.toDegrees(dLat),
			alt: this.alt + dAlt
		};
	}

	updateThreeMatrix() {
		const viewMatrix = this.viewer.camera.viewMatrix;
		const pos = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, this.alt);
		const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos);

		const hRad = Cesium.Math.toRadians(this.heading);
		const pRad = Cesium.Math.toRadians(this.pitch);

		const localForward = new Cesium.Cartesian3(
			Math.sin(hRad) * Math.cos(pRad),
			Math.cos(hRad) * Math.cos(pRad),
			Math.sin(pRad)
		);

		const worldForward = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localForward, new Cesium.Cartesian3());
		Cesium.Cartesian3.normalize(worldForward, worldForward);

		const enuUp = new Cesium.Cartesian3(enuMatrix[8], enuMatrix[9], enuMatrix[10]);
		let worldRight = new Cesium.Cartesian3();
		if (Math.abs(Cesium.Cartesian3.dot(worldForward, enuUp)) > 0.99) {
			const enuNorth = new Cesium.Cartesian3(enuMatrix[4], enuMatrix[5], enuMatrix[6]);
			Cesium.Cartesian3.cross(worldForward, enuNorth, worldRight);
		} else {
			Cesium.Cartesian3.cross(worldForward, enuUp, worldRight);
		}
		Cesium.Cartesian3.normalize(worldRight, worldRight);
		const worldUp = Cesium.Cartesian3.cross(worldRight, worldForward, new Cesium.Cartesian3());

		const modelMatrix = new Cesium.Matrix4(
			worldRight.x, worldForward.x, worldUp.x, pos.x,
			worldRight.y, worldForward.y, worldUp.y, pos.y,
			worldRight.z, worldForward.z, worldUp.z, pos.z,
			0, 0, 0, 1
		);

		const cameraSpaceMatrix = Cesium.Matrix4.multiply(viewMatrix, modelMatrix, new Cesium.Matrix4());
		for (let j = 0; j < 16; j++) this._scratchThreeMatrix.elements[j] = cameraSpaceMatrix[j];
		this.group.matrix.copy(this._scratchThreeMatrix);
		this.group.updateMatrixWorld(true);
	}

	_spawnTrailIfNeeded() {
		const now = performance.now();
		if (now - this.lastTrailSpawn < 25) return;
		this.lastTrailSpawn = now;

		// pull one from pool
		const s = this.trailPool.find(sp => sp.material.opacity === 0);
		if (!s) return;
		s._lon = this.lon;
		s._lat = this.lat;
		s._alt = this.alt;
		s.life = 1.8 + Math.random() * 0.8;
		s.maxLife = s.life;
		s.randomScale = 0.6 + Math.random() * 1.2;
		s.material.opacity = 0.9;
		this.activeTrail.push(s);
	}

	_updateTrail(dt) {
		const viewMatrix = this.viewer.camera.viewMatrix;
		for (let i = this.activeTrail.length - 1; i >= 0; i--) {
			const t = this.activeTrail[i];
			t.life -= dt;
			if (t.life <= 0) {
				t.material.opacity = 0;
				this.activeTrail.splice(i, 1);
				continue;
			}

			const lifeRatio = t.life / t.maxLife;
			const scale = t.randomScale * (1.0 + (1.0 - lifeRatio) * 6.0);
			t.scale.set(scale, scale, 1);
			t.material.opacity = Math.max(0, lifeRatio * 0.45);

			const pos = Cesium.Cartesian3.fromDegrees(t._lon, t._lat, t._alt, undefined, this._scratchCartesian);
			const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos, undefined, this._scratchMatrix);
			const cameraSpaceMatrix = Cesium.Matrix4.multiply(viewMatrix, modelMatrix, this._scratchCameraMatrix);
			for (let j = 0; j < 16; j++) this._scratchThreeMatrix.elements[j] = cameraSpaceMatrix[j];
			t.matrix.copy(this._scratchThreeMatrix);
			t.updateMatrixWorld(true);

			// slowly drift smoke downwards in local ENU
			t._alt -= 0.2 * (1 - lifeRatio);
		}
	}

	destroy() {
		this.active = false;
		if (this.group) this.scene.remove(this.group);
		for (const s of this.trailPool) {
			this.scene.remove(s);
		}
		this.trailPool = [];
		this.activeTrail = [];
	}
}
