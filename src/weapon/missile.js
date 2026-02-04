import * as THREE from 'three';
import * as Cesium from 'cesium';
import { movePosition } from '../utils/math';

export class Missile {
	constructor(scene, viewer, startPos, heading, pitch, speed, target = null) {
		this.scene = scene;
		this.viewer = viewer;
		this.target = target;

		this.lon = startPos.lon;
		this.lat = startPos.lat;
		this.alt = startPos.alt;
		this.heading = heading;
		this.pitch = pitch;
		this.roll = 0;
		this.speed = speed + 800;

		this.life = 10;
		this.active = true;

		this._scratchMatrix = new Cesium.Matrix4();
		this._scratchHPR = new Cesium.HeadingPitchRoll();
		this._scratchCartesian = new Cesium.Cartesian3();
		this._scratchThreeMatrix = new THREE.Matrix4();
		this._scratchCameraMatrix = new Cesium.Matrix4();

		this.trail = [];
		this.lastTrailSpawn = 0;

		this.initMesh();
	}

	initMesh() {
		const geometry = new THREE.CylinderGeometry(0.12, 0.12, 2.5, 8);
		geometry.translate(0, -1.25, 0);
		const material = new THREE.MeshPhongMaterial({ color: 0xdddddd });
		this.mesh = new THREE.Mesh(geometry, material);

		const flameGeom = new THREE.ConeGeometry(0.2, 0.8, 8);
		flameGeom.translate(0, -2.7, 0);
		const flameMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
		const flame = new THREE.Mesh(flameGeom, flameMat);
		this.mesh.add(flame);

		this.mesh.matrixAutoUpdate = false;
		this.scene.add(this.mesh);
	}

	update(dt, npcs) {
		if (!this.active) {
			if (this.trail.length > 0) {
				this.updateTrail(dt);
			}
			return;
		}

		this.life -= dt;
		if (this.life <= 0) {
			this.destroy();
			return;
		}

		if (this.target && !this.target.destroyed) {
			this.trackTarget(dt);
		}

		const newPos = movePosition(this.lon, this.lat, this.alt, this.heading, this.pitch, this.speed * dt);
		this.lon = newPos.lon;
		this.lat = newPos.lat;
		this.alt = newPos.alt;

		this.updateTrail(dt);
		this.updateThreeMatrix();

		if (npcs) {
			for (const npc of npcs) {
				const distSq = this.calculateDistSqToNPC(npc);
				if (distSq < 10000) {
					this.hitNPC(npc);
					return;
				}
			}
		}

		this.checkTerrainCollision();
	}

	trackTarget(dt) {
		const targetPos = Cesium.Cartesian3.fromDegrees(this.target.lon, this.target.lat, this.target.alt);
		const myPos = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, this.alt);

		const direction = Cesium.Cartesian3.subtract(targetPos, myPos, new Cesium.Cartesian3());
		Cesium.Cartesian3.normalize(direction, direction);

		const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(myPos);
		const invEnu = Cesium.Matrix4.inverse(enuMatrix, new Cesium.Matrix4());
		const localDir = Cesium.Matrix4.multiplyByPointAsVector(invEnu, direction, new Cesium.Cartesian3());

		const targetHeading = Cesium.Math.toDegrees(Math.atan2(localDir.x, localDir.y));
		const targetPitch = Cesium.Math.toDegrees(Math.asin(localDir.z));

		let headingDiff = targetHeading - this.heading;
		while (headingDiff < -180) headingDiff += 360;
		while (headingDiff > 180) headingDiff -= 360;

		const turnRate = 90;
		this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, headingDiff));
		this.pitch += Math.max(-turnRate * dt, Math.min(turnRate * dt, targetPitch - this.pitch));
	}

	updateTrail(dt) {
		const now = performance.now();
		if (this.active && now - this.lastTrailSpawn > 5) {
			this.lastTrailSpawn = now;

			const smokeGeom = new THREE.SphereGeometry(0.5, 16, 16);
			const smokeMat = new THREE.MeshBasicMaterial({
				color: 0xcccccc,
				transparent: true,
				opacity: 0.5
			});
			const smoke = new THREE.Mesh(smokeGeom, smokeMat);
			smoke.lon = this.lon;
			smoke.lat = this.lat;
			smoke.alt = this.alt;
			smoke.life = 4.0;
			smoke.maxLife = 4.0;
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

			if (!t.randomScale) t.randomScale = 0.8 + Math.random() * 0.5;
			const scale = t.randomScale * (1.0 + (1.0 - t.life / t.maxLife) * 15.0);
			t.scale.set(scale, scale, scale);

			const opacity = (t.life / t.maxLife) * 0.5;
			t.material.opacity = opacity;

			const pos = Cesium.Cartesian3.fromDegrees(t.lon, t.lat, t.alt, undefined, this._scratchCartesian);
			const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos, undefined, this._scratchMatrix);
			const cameraSpaceMatrix = Cesium.Matrix4.multiply(viewMatrix, modelMatrix, this._scratchCameraMatrix);

			for (let j = 0; j < 16; j++) {
				this._scratchThreeMatrix.elements[j] = cameraSpaceMatrix[j];
			}

			t.matrix.copy(this._scratchThreeMatrix);
			t.matrix.scale(new THREE.Vector3(scale, scale, scale));
			t.updateMatrixWorld(true);
		}
	}

	updateThreeMatrix() {
		const viewMatrix = this.viewer.camera.viewMatrix;
		const pos = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, this.alt, undefined, this._scratchCartesian);

		const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos, undefined, this._scratchMatrix);

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
		if (Math.abs(Cesium.Cartesian3.dot(worldForward, enuUp)) > 0.999) {
			const enuNorth = new Cesium.Cartesian3(enuMatrix[4], enuMatrix[5], enuMatrix[6]);
			Cesium.Cartesian3.cross(worldForward, enuNorth, worldRight);
		} else {
			Cesium.Cartesian3.cross(worldForward, enuUp, worldRight);
		}
		Cesium.Cartesian3.normalize(worldRight, worldRight);

		const worldUp = new Cesium.Cartesian3();
		Cesium.Cartesian3.cross(worldRight, worldForward, worldUp);

		const finalModelMatrix = this._scratchMatrix;
		finalModelMatrix[0] = worldRight.x; finalModelMatrix[1] = worldRight.y; finalModelMatrix[2] = worldRight.z; finalModelMatrix[3] = 0;
		finalModelMatrix[4] = worldForward.x; finalModelMatrix[5] = worldForward.y; finalModelMatrix[6] = worldForward.z; finalModelMatrix[7] = 0;
		finalModelMatrix[8] = worldUp.x; finalModelMatrix[9] = worldUp.y; finalModelMatrix[10] = worldUp.z; finalModelMatrix[11] = 0;
		finalModelMatrix[12] = pos.x; finalModelMatrix[13] = pos.y; finalModelMatrix[14] = pos.z; finalModelMatrix[15] = 1;

		const cameraSpaceMatrix = Cesium.Matrix4.multiply(viewMatrix, finalModelMatrix, this._scratchCameraMatrix);

		for (let i = 0; i < 16; i++) {
			this._scratchThreeMatrix.elements[i] = cameraSpaceMatrix[i];
		}

		this.mesh.matrix.copy(this._scratchThreeMatrix);
		this.mesh.updateMatrixWorld(true);
	}

	calculateDistSqToNPC(npc) {
		const dLon = (npc.lon - this.lon) * 111320 * Math.cos(Cesium.Math.toRadians(this.lat));
		const dLat = (npc.lat - this.lat) * 111320;
		const dAlt = npc.alt - this.alt;
		return dLon * dLon + dLat * dLat + dAlt * dAlt;
	}

	hitNPC(npc) {
		npc.destroyed = true;
		this.destroy();
	}

	checkTerrainCollision() {
		const cartographic = Cesium.Cartographic.fromDegrees(this.lon, this.lat);
		const terrainHeight = this.viewer.scene.globe.getHeight(cartographic);
		if (terrainHeight !== undefined && this.alt < terrainHeight) {
			this.destroy();
		}
	}

	destroy() {
		this.active = false;
		if (this.mesh) {
			this.scene.remove(this.mesh);
		}
	}
}
