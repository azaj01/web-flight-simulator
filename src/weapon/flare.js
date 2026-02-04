import * as THREE from 'three';
import * as Cesium from 'cesium';

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

		this.trail = [];
		this.lastTrailSpawn = 0;
		this._scratchCartesian = new Cesium.Cartesian3();
		this._scratchMatrix = new Cesium.Matrix4();
		this._scratchCameraMatrix = new Cesium.Matrix4();
		this._scratchThreeMatrix = new THREE.Matrix4();

		this.initMesh();
	}

	initMesh() {
		const group = new THREE.Group();
		const geometry = new THREE.SphereGeometry(0.3, 16, 16);
		const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
		const core = new THREE.Mesh(geometry, material);
		group.add(core);

		const glowGeom = new THREE.SphereGeometry(0.8, 16, 16);
		const glowMat = new THREE.MeshBasicMaterial({
			color: 0xffaa44,
			transparent: true,
			opacity: 0.6
		});
		const glow = new THREE.Mesh(glowGeom, glowMat);
		group.add(glow);

		this.mesh = group;
		this.mesh.matrixAutoUpdate = false;
		this.scene.add(this.mesh);
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

		this.speed *= 0.98;

		this.updateThreeMatrix();
		this.updateTrail(dt);

		const opacity = this.life / this.maxLife;
		this.mesh.traverse(child => {
			if (child.material) {
				if (child === this.mesh.children[1]) child.material.opacity = opacity * 0.6;
				else child.material.opacity = opacity;
				child.material.transparent = true;
			}
		});
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
		const threeMatrix = new THREE.Matrix4();
		for (let j = 0; j < 16; j++) threeMatrix.elements[j] = cameraSpaceMatrix[j];
		this.mesh.matrix.copy(threeMatrix);
		this.mesh.updateMatrixWorld(true);
	}

	updateTrail(dt) {
		const now = performance.now();
		if (now - this.lastTrailSpawn > 10) {
			this.lastTrailSpawn = now;

			const smokeGeom = new THREE.SphereGeometry(0.2, 8, 8);
			const smokeMat = new THREE.MeshBasicMaterial({
				color: 0xcccccc,
				transparent: true,
				opacity: 0.3
			});
			const smoke = new THREE.Mesh(smokeGeom, smokeMat);
			smoke.lon = this.lon;
			smoke.lat = this.lat;
			smoke.alt = this.alt;
			smoke.life = 1.5;
			smoke.maxLife = 1.5;
			smoke.matrixAutoUpdate = false;

			this.scene.add(smoke);
			this.trail.push(smoke);
		}

		const viewMatrix = this.viewer.camera.viewMatrix;
		for (let i = this.trail.length - 1; i >= 0; i--) {
			const t = this.trail[i];
			t.life -= dt;
			if (t.life <= 0) {
				this.scene.remove(t);
				this.trail.splice(i, 1);
				continue;
			}

			if (!t.randomScale) t.randomScale = 0.7 + Math.random() * 0.6;
			const scale = t.randomScale * (1.0 + (1.0 - t.life / t.maxLife) * 8.0);
			t.scale.set(scale, scale, scale);

			const opacity = (t.life / t.maxLife) * 0.3;
			t.material.opacity = opacity;

			const pos = Cesium.Cartesian3.fromDegrees(t.lon, t.lat, t.alt, undefined, this._scratchCartesian);
			const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos, undefined, this._scratchMatrix);
			const cameraSpaceMatrix = Cesium.Matrix4.multiply(viewMatrix, modelMatrix, this._scratchCameraMatrix);

			for (let j = 0; j < 16; j++) {
				this._scratchThreeMatrix.elements[j] = cameraSpaceMatrix[j];
			}
			t.matrix.copy(this._scratchThreeMatrix);
			t.updateMatrixWorld(true);
		}
	}

	destroy() {
		this.active = false;
		this.scene.remove(this.mesh);
		for (const t of this.trail) {
			this.scene.remove(t);
		}
		this.trail = [];
	}
}
