import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initCesium, setCameraToPlane, getViewer, setControlsEnabled } from './world/cesiumWorld';
import { PlanePhysics } from './plane/planePhysics';
import { PlaneController } from './plane/planeController';
import { movePosition } from './utils/math';
import { HUD } from './ui/hud';
import { JetFlame } from './plane/jetFlame';
import { soundManager } from './utils/soundManager';
import * as Cesium from 'cesium';

const States = {
	MENU: 'MENU',
	PICK_SPAWN: 'PICK_SPAWN',
	TRANSITIONING: 'TRANSITIONING',
	FLYING: 'FLYING',
	PAUSED: 'PAUSED',
	CRASHED: 'CRASHED'
};

let currentState = States.MENU;

let gameSettings = {
	graphicsQuality: 'medium',
	antialiasing: true,
	fogEffects: true,
	fov: 75,
	mouseSensitivity: 0.2,
	showHud: true,
	minimapRange: 1
};

function loadSettings() {
	const saved = localStorage.getItem('flightSimSettings');
	if (saved) {
		try {
			const parsed = JSON.parse(saved);
			gameSettings = { ...gameSettings, ...parsed };
		} catch (e) {
			console.error('Failed to load settings', e);
		}
	}
	applySettings();
	updateSettingsUI();
}

function saveSettings() {
	localStorage.setItem('flightSimSettings', JSON.stringify(gameSettings));
}

function updateSettingsUI() {
	document.getElementById('graphicsQuality').value = gameSettings.graphicsQuality;
	document.getElementById('antialiasing').checked = gameSettings.antialiasing;
	document.getElementById('fogEffects').checked = gameSettings.fogEffects;
	document.getElementById('fovSlider').value = gameSettings.fov;
	document.getElementById('fovValue').textContent = gameSettings.fov;
	document.getElementById('sensitivitySlider').value = gameSettings.mouseSensitivity;
	document.getElementById('sensitivityValue').textContent = gameSettings.mouseSensitivity;
	document.getElementById('showHud').checked = gameSettings.showHud;
	document.getElementById('minimapRange').value = gameSettings.minimapRange.toString();
}

function applySettings() {
	if (camera) {
		camera.fov = gameSettings.fov;
		camera.updateProjectionMatrix();
	}

	if (controller) {
		controller.setSensitivity(gameSettings.mouseSensitivity);
	}

	if (hud) {
		hud.setMinimapRange(gameSettings.minimapRange);
	}

	const viewer = getViewer();
	if (viewer) {
		if (gameSettings.graphicsQuality === 'low') {
			viewer.resolutionScale = 0.5;
			viewer.scene.globe.maximumScreenSpaceError = 4;
		} else if (gameSettings.graphicsQuality === 'medium') {
			viewer.resolutionScale = 0.75;
			viewer.scene.globe.maximumScreenSpaceError = 2;
		} else {
			viewer.resolutionScale = 1.0;
			viewer.scene.globe.maximumScreenSpaceError = 1.3;
		}

		viewer.scene.postProcessStages.fxaa.enabled = gameSettings.antialiasing;

		viewer.scene.fog.enabled = gameSettings.fogEffects;
		viewer.scene.atmosphere.show = gameSettings.fogEffects;
	}

	const hudElements = [
		document.getElementById('hud-top-left'),
		document.getElementById('hud-top-right'),
		document.getElementById('hud-speed-box'),
		document.getElementById('hud-alt-box'),
		document.getElementById('coords'),
		document.getElementById('minimap-container')
	];

	hudElements.forEach(el => {
		if (el) {
			el.style.display = gameSettings.showHud ? 'block' : 'none';
		}
	});
}

let state = {
	lon: 106.8272,
	lat: -6.1754,
	alt: 1000,
	heading: 0,
	pitch: 0,
	roll: 0,
	speed: 0,
	throttle: 0
};

let scene, camera, renderer;
let planeModel;
let jetFlames = [];
let mixer, clock;
let physics = new PlanePhysics();
let controller = new PlaneController();
let hud = new HUD();

let fps = 0;
let frameCount = 0;
let lastFpsUpdate = 0;

const BASE_PLANE_POS = new THREE.Vector3(0, -0.8, -2.75);
let visualOffset = new THREE.Vector3().copy(BASE_PLANE_POS);
let visualRotation = new THREE.Euler(0, 0, 0);
let boostRoll = 0;
let currentBoostZOffset = 0;
let boostRollDirection = 1;
let lastIsBoosting = false;
let initialCameraView = null;
let lastThrottleLevel = 0;

const mainMenu = document.getElementById('mainMenu');
const pauseMenu = document.getElementById('pauseMenu');
const crashMenu = document.getElementById('crashMenu');
const uiContainer = document.getElementById('uiContainer');
const threeContainer = document.getElementById('threeContainer');
const spawnInstruction = document.getElementById('spawnInstruction');
const confirmSpawnBtn = document.getElementById('confirmSpawnBtn');

let spawnMarker = null;

async function initSounds() {
	soundManager.init(camera);

	await Promise.all([
		soundManager.loadSound('boost', '/assets/sounds/boost.wav', false, 0.5),
		soundManager.loadSound('throttle', '/assets/sounds/throttle.wav', false, 0.4),
		soundManager.loadSound('explode', '/assets/sounds/explode.wav', false, 0.5),
		soundManager.loadSound('jet-engine', '/assets/sounds/jet-engine.wav', true, 0.3),
		soundManager.loadSound('spawn', '/assets/sounds/spawn.wav', false, 0.5),
		soundManager.loadSound('roll', '/assets/sounds/roll.wav', true, 0.75),
		soundManager.loadSound('pitch', '/assets/sounds/pitch.wav', true, 0.75),
		soundManager.loadSound('button-click', '/assets/sounds/button-click.mp3', false, 0.5),
		soundManager.loadSound('button-hover', '/assets/sounds/button-hover.mp3', false, 0.5),
		soundManager.loadSound('zoom-in', '/assets/sounds/zoom-in.mp3', false, 0.5)
	]);

	setupButtonSounds();
}

function stopAllFlyingSounds(fadeOut = 0.5) {
	soundManager.stop('jet-engine', fadeOut);
	soundManager.stop('boost', fadeOut);
	soundManager.stop('roll', fadeOut);
	soundManager.stop('pitch', fadeOut);
	soundManager.stop('throttle', fadeOut);
}

function setupButtonSounds() {
	document.addEventListener('mouseover', (e) => {
		const target = e.target.closest('button, .menu-btn, .clickable-ui');
		if (target && !target._hovered) {
			soundManager.play('button-hover');
			target._hovered = true;
			target.addEventListener('mouseleave', () => { target._hovered = false; }, { once: true });
		}
	}, true);

	document.addEventListener('click', (e) => {
		const target = e.target.closest('button, .menu-btn, .clickable-ui, #search-toggle-btn');
		if (target) {
			soundManager.play('button-click');
		}
	}, true);
}

function initThree() {
	clock = new THREE.Clock();
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setClearColor(0x000000, 0);
	threeContainer.appendChild(renderer.domElement);

	threeContainer.classList.add('hidden');

	const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
	directionalLight.position.set(5, 10, 5);
	scene.add(directionalLight);

	initSounds().catch(err => console.error('Failed to init sounds', err));

	const loader = new GLTFLoader();
	loader.load('/assets/models/low_poly_f-15.glb', (gltf) => {
		const mesh = gltf.scene;

		planeModel = new THREE.Group();
		planeModel.add(mesh);
		scene.add(planeModel);

		mesh.rotation.y = Math.PI / 2;

		const box = new THREE.Box3().setFromObject(mesh);
		const center = box.getCenter(new THREE.Vector3());
		mesh.position.sub(center);

		planeModel.position.copy(BASE_PLANE_POS);
		planeModel.scale.set(0.2, 0.2, 0.2);

		const flameL = new JetFlame();
		const flameR = new JetFlame();

		flameL.group.position.set(-0.4, -0.065, 5);
		flameR.group.position.set(0.4, -0.065, 5);


		planeModel.add(flameL.group);
		planeModel.add(flameR.group);
		jetFlames.push(flameL, flameR);

		mixer = new THREE.AnimationMixer(mesh);
		const clip = THREE.AnimationClip.findByName(gltf.animations, 'F15 ldg');
		if (clip) {
			const action = mixer.clipAction(clip);
			action.setLoop(THREE.LoopOnce);
			action.clampWhenFinished = true;
			action.play();
		}
	}, undefined, (error) => {
		console.error('Error loading model:', error);
	});
}

function update(dt) {
	if (currentState !== States.FLYING) return;

	const input = controller.update();
	const physicsResult = physics.update(input, dt);

	const prevSpeed = state.speed;
	state.speed = physicsResult.speed;
	state.pitch = physicsResult.pitch;
	state.roll = physicsResult.roll;
	state.heading = physicsResult.heading;
	state.throttle = input.throttle;
	state.yaw = input.yaw;
	state.isBoosting = physicsResult.isBoosting;

	const newPos = movePosition(state.lon, state.lat, state.alt, state.heading, state.pitch, state.speed * dt);
	state.lon = newPos.lon;
	state.lat = newPos.lat;
	state.alt = newPos.alt;

	checkCrash();

	if (soundManager.isPlaying('jet-engine')) {
		const minSpeed = 100;
		const maxSpeed = 1000;
		const minVol = 0.25;
		const maxVol = 0.5;
		const speedFactor = Math.max(0, Math.min(1.0, (state.speed - minSpeed) / (maxSpeed - minSpeed)));
		const engineVol = minVol + speedFactor * (maxVol - minVol);
		soundManager.setVolume('jet-engine', engineVol);
	}

	if (state.isBoosting && !lastIsBoosting) {
		soundManager.play('boost');
	}

	if (state.throttle > lastThrottleLevel + 0.01) {
		if (!soundManager.isPlaying('throttle')) {
			soundManager.play('throttle');
		}
	}
	lastThrottleLevel = state.throttle;

	if (Math.abs(input.pitch) > 0.5) {
		if (!soundManager.isPlaying('pitch')) {
			soundManager.play('pitch', 0.1);
		}
	} else {
		if (soundManager.isPlaying('pitch')) {
			soundManager.stop('pitch', 0.1);
		}
	}

	if (Math.abs(input.roll) > 0.5 || Math.abs(input.yaw) > 0.5) {
		if (!soundManager.isPlaying('roll')) {
			soundManager.play('roll', 0.1);
		}
	} else {
		if (soundManager.isPlaying('roll')) {
			soundManager.stop('roll', 0.1);
		}
	}

	hud.update(state);

	const planeHPR = new Cesium.HeadingPitchRoll(
		Cesium.Math.toRadians(state.heading),
		Cesium.Math.toRadians(state.pitch),
		Cesium.Math.toRadians(state.roll)
	);
	const planeQuat = Cesium.Quaternion.fromHeadingPitchRoll(planeHPR);

	const orbitHPR = new Cesium.HeadingPitchRoll(
		Cesium.Math.toRadians(input.cameraYaw),
		Cesium.Math.toRadians(-input.cameraPitch),
		0
	);
	const orbitQuat = Cesium.Quaternion.fromHeadingPitchRoll(orbitHPR);

	const finalQuat = Cesium.Quaternion.multiply(planeQuat, orbitQuat, new Cesium.Quaternion());
	const finalHPR = Cesium.HeadingPitchRoll.fromQuaternion(finalQuat);

	setCameraToPlane(
		state.lon, state.lat, state.alt,
		Cesium.Math.toDegrees(finalHPR.heading),
		Cesium.Math.toDegrees(finalHPR.pitch),
		Cesium.Math.toDegrees(finalHPR.roll)
	);

	if (planeModel) {
		const accel = (state.speed - prevSpeed) / dt;
		const accelInertia = input.isDragging ? 0 : Math.max(-0.5, Math.min(1.5, accel * 0.001));
		let targetZ = BASE_PLANE_POS.z - accelInertia;

		let boostZOffset = 0;
		if (physicsResult.isBoosting) {
			if (!lastIsBoosting) {
				boostRollDirection = Math.random() > 0.5 ? 1 : -1;
			}

			const T = physicsResult.boostDuration;
			const p = Math.max(0, Math.min(1.0, 1.0 - (physicsResult.boostTimeRemaining / T)));

			const totalRotationRad = Math.PI * 2 * physicsResult.boostRotations * boostRollDirection;

			if (p < 0.2) {
				const localP = p / 0.2;
				boostZOffset = -(localP * localP) * 1.5;
				boostRoll = 0;
			}
			else if (p < 0.8) {
				const localP = (p - 0.2) / 0.6;
				boostZOffset = -1.5;
				const easedP = localP < 0.5
					? 4 * localP * localP * localP
					: 1 - Math.pow(-2 * localP + 2, 3) / 2;
				boostRoll = easedP * (Math.PI * 2 * physicsResult.boostRotations) * boostRollDirection;
			}
			else {
				const localP = (p - 0.8) / 0.2;
				const easedReturn = localP * localP * (3 - 2 * localP);
				boostZOffset = -1.5 + (easedReturn * 0.7);
				boostRoll = (Math.PI * 2 * physicsResult.boostRotations) * boostRollDirection;
			}
		} else {
			boostRoll = 0;
			boostZOffset = 0;
		}
		lastIsBoosting = physicsResult.isBoosting;

		const zLerp = physicsResult.isBoosting ? 10.0 * dt : 2.0 * dt;
		currentBoostZOffset += (boostZOffset - currentBoostZOffset) * zLerp;
		targetZ += currentBoostZOffset;


		const time = performance.now() * 0.001;
		const idleX = Math.sin(time * 0.8) * 0.035;
		const idleY = Math.cos(time * 0.6) * 0.025;
		const idleRotX = Math.sin(time * 0.5) * 0.015;
		const idleRotY = Math.cos(time * 0.4) * 0.015;
		const idleRotZ = Math.sin(time * 0.7) * 0.025;

		const targetX = input.isDragging ? BASE_PLANE_POS.x : BASE_PLANE_POS.x - (input.roll * 0.6) - (input.yaw * 0.12) + idleX;
		const targetY = input.isDragging ? BASE_PLANE_POS.y : BASE_PLANE_POS.y - (input.pitch * 0.1) + idleY;

		let targetRotZ = input.isDragging ? 0 : THREE.MathUtils.degToRad(-input.roll * 15) + idleRotZ;
		const targetRotX = input.isDragging ? 0 : THREE.MathUtils.degToRad(input.pitch * 10) + idleRotX;
		const targetRotY = input.isDragging ? 0 : THREE.MathUtils.degToRad(-input.yaw * 4) + idleRotY;

		const lerpFactor = physicsResult.isBoosting ? 3.0 * dt : 5.0 * dt;
		visualOffset.x += (targetX - visualOffset.x) * lerpFactor;
		visualOffset.y += (targetY - visualOffset.y) * lerpFactor;
		visualOffset.z += (targetZ - visualOffset.z) * lerpFactor;

		visualRotation.z += (targetRotZ - visualRotation.z) * lerpFactor;
		visualRotation.x += (targetRotX - visualRotation.x) * lerpFactor;
		visualRotation.y += (targetRotY - visualRotation.y) * lerpFactor;

		const orbitQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(
				THREE.MathUtils.degToRad(-input.cameraPitch),
				THREE.MathUtils.degToRad(-input.cameraYaw),
				0,
				'YXZ'
			)
		);

		planeModel.position.copy(visualOffset);

		const flightLagQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(visualRotation.x, visualRotation.y, visualRotation.z + boostRoll)
		);

		const combinedQ = orbitQ.clone().invert().multiply(flightLagQ);
		planeModel.quaternion.copy(combinedQ);

		if (jetFlames.length > 0) {
			jetFlames.forEach(flame => {
				flame.update(state.throttle, state.isBoosting, clock.getElapsedTime(), dt);
			});
		}
	}
}

let lastCrashCheck = 0;
let flightStartTime = 0;

function checkCrash() {
	if (currentState !== States.FLYING) return;

	const now = Date.now();
	if (now - lastCrashCheck < 100) return;
	lastCrashCheck = now;

	if (now - flightStartTime < 3000) return;

	const viewer = getViewer();
	if (!viewer) return;

	const cartographic = Cesium.Cartographic.fromDegrees(state.lon, state.lat);
	const terrainHeight = viewer.scene.globe.getHeight(cartographic);

	if (terrainHeight !== undefined && state.alt <= terrainHeight + 5) {
		currentState = States.CRASHED;
		uiContainer.classList.add('hidden');
		threeContainer.classList.add('hidden');
		crashMenu.classList.remove('hidden');

		soundManager.play('explode');
		stopAllFlyingSounds(0.1);
	}
}

function animate() {
	requestAnimationFrame(animate);

	const dt = clock ? clock.getDelta() : 0.016;
	const now = performance.now();

	frameCount++;
	if (now - lastFpsUpdate >= 1000) {
		fps = (frameCount * 1000) / (now - lastFpsUpdate);
		frameCount = 0;
		lastFpsUpdate = now;
		hud.updateFPS(fps);
	}

	if (currentState === States.FLYING || currentState === States.PAUSED || currentState === States.TRANSITIONING) {
		if (currentState === States.FLYING) {
			update(dt);
		}

		if (mixer) mixer.update(dt);

		renderer.render(scene, camera);
	} else {
		threeContainer.classList.add('hidden');
	}
}

function setupModalListeners() {
	const modals = document.querySelectorAll('.modal');

	const closeAllModals = () => {
		modals.forEach(m => m.classList.add('hidden'));
	};

	document.getElementById('helpBtn').onclick = () => {
		closeAllModals();
		document.getElementById('helpModal').classList.remove('hidden');
	};

	document.getElementById('optionsBtn').onclick = () => {
		closeAllModals();
		updateSettingsUI();
		document.getElementById('optionsModal').classList.remove('hidden');
	};

	document.getElementById('pauseOptionsBtn').onclick = () => {
		updateSettingsUI();
		document.getElementById('optionsModal').classList.remove('hidden');
	};

	document.getElementById('creditsBtn').onclick = () => {
		closeAllModals();
		document.getElementById('creditsModal').classList.remove('hidden');
	};

	document.getElementById('aboutBtn').onclick = () => {
		closeAllModals();
		document.getElementById('aboutBtnModal').classList.remove('hidden');
	};

	document.getElementById('fovSlider').oninput = (e) => {
		document.getElementById('fovValue').textContent = e.target.value;
	};

	document.getElementById('sensitivitySlider').oninput = (e) => {
		document.getElementById('sensitivityValue').textContent = e.target.value;
	};

	document.getElementById('saveOptionsBtn').onclick = () => {
		gameSettings.graphicsQuality = document.getElementById('graphicsQuality').value;
		gameSettings.antialiasing = document.getElementById('antialiasing').checked;
		gameSettings.fogEffects = document.getElementById('fogEffects').checked;
		gameSettings.fov = parseInt(document.getElementById('fovSlider').value);
		gameSettings.mouseSensitivity = parseFloat(document.getElementById('sensitivitySlider').value);
		gameSettings.showHud = document.getElementById('showHud').checked;
		gameSettings.minimapRange = parseInt(document.getElementById('minimapRange').value);

		saveSettings();
		applySettings();
		closeAllModals();
	};

	document.querySelectorAll('.close-modal').forEach(btn => {
		btn.onclick = (e) => {
			e.stopPropagation();
			btn.closest('.modal').classList.add('hidden');
		};
	});

	window.addEventListener('click', (event) => {
		if (event.target.classList.contains('modal')) {
			event.target.classList.add('hidden');
		}
	});
}

document.getElementById('startBtn').onclick = () => {
	document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
	mainMenu.classList.add('hidden');
	enterSpawnPicking(false);
};

setupModalListeners();

document.getElementById('resumeBtn').onclick = () => {
	pauseMenu.classList.add('hidden');
	uiContainer.classList.remove('hidden');
	currentState = States.FLYING;
	soundManager.play('jet-engine', 0.5);
};

document.getElementById('restartBtn').onclick = () => {
	pauseMenu.classList.add('hidden');
	enterSpawnPicking(true);
};

document.getElementById('quitBtn').onclick = () => {
	location.reload();
};

document.getElementById('respawnBtn').onclick = () => {
	crashMenu.classList.add('hidden');
	enterSpawnPicking(true);
};

function enterSpawnPicking(useVignette = true) {
	stopAllFlyingSounds(0.3);
	soundManager.play('zoom-in');
	const vignette = document.getElementById('transition-vignette');
	if (useVignette && vignette) vignette.style.opacity = '1';

	const delay = useVignette ? 500 : 0;

	setTimeout(() => {
		spawnInstruction.classList.remove('hidden');
		threeContainer.classList.add('hidden');
		uiContainer.classList.add('hidden');
		currentState = States.PICK_SPAWN;
		confirmSpawnBtn.classList.add('hidden');

		const searchInput = document.getElementById('locationSearch');
		const instructionText = document.getElementById('instruction-text');
		const resultsContainer = document.getElementById('search-results');

		if (searchInput) {
			searchInput.value = '';
			searchInput.style.display = 'none';
		}
		if (instructionText) {
			instructionText.style.display = 'block';
		}
		if (resultsContainer) {
			resultsContainer.style.display = 'none';
		}

		setControlsEnabled(true);

		if (spawnMarker) {
			const viewer = getViewer();
			viewer.entities.remove(spawnMarker);
			spawnMarker = null;
		}

		const viewer = getViewer();
		viewer.camera.flyTo({
			destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, 15000),
			duration: 2.0,
			complete: () => {
				if (vignette) vignette.style.opacity = '0';
			}
		});
	}, delay);
}

function exitSpawnPicking() {
	soundManager.play('zoom-in');
	stopAllFlyingSounds(0.3);
	spawnInstruction.classList.add('hidden');
	confirmSpawnBtn.classList.add('hidden');
	mainMenu.classList.remove('hidden');
	currentState = States.MENU;

	setControlsEnabled(false);

	if (spawnMarker) {
		const viewer = getViewer();
		viewer.entities.remove(spawnMarker);
		spawnMarker = null;
	}

	const viewer = getViewer();
	viewer.camera.flyTo({
		...initialCameraView,
		duration: 2.5
	});
}

function setupSpawnPicker() {
	const viewer = getViewer();
	const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

	handler.setInputAction((click) => {
		if (currentState !== States.PICK_SPAWN) return;

		const ray = viewer.camera.getPickRay(click.position);
		const cartesian = viewer.scene.globe.pick(ray, viewer.scene);

		if (cartesian) {
			const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
			const lon = Cesium.Math.toDegrees(cartographic.longitude);
			const lat = Cesium.Math.toDegrees(cartographic.latitude);

			state.lon = lon;
			state.lat = lat;
			state.alt = Math.max(0, cartographic.height) + 1500;

			Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic])
				.then(([p]) => state.alt = Math.max(0, p.height || 0) + 1500)
				.catch(() => { });

			if (spawnMarker) {
				viewer.entities.remove(spawnMarker);
			}
			spawnMarker = viewer.entities.add({
				position: cartesian,
				point: {
					pixelSize: 15,
					color: Cesium.Color.RED,
					outlineColor: Cesium.Color.WHITE,
					outlineWidth: 2,
					disableDepthTestDistance: Number.POSITIVE_INFINITY
				},
				label: {
					text: "Target Spawn Location",
					font: "14pt AceCombat",
					style: Cesium.LabelStyle.FILL_AND_OUTLINE,
					outlineWidth: 2,
					verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
					pixelOffset: new Cesium.Cartesian2(0, -20),
					disableDepthTestDistance: Number.POSITIVE_INFINITY
				}
			});

			confirmSpawnBtn.classList.remove('hidden');
		}
	}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function setupLocationSearch() {
	const searchInput = document.getElementById('locationSearch');
	const resultsContainer = document.getElementById('search-results');
	const instructionText = document.getElementById('instruction-text');
	const searchToggleBtn = document.getElementById('search-toggle-btn');
	const originalSearchIcon = searchToggleBtn ? searchToggleBtn.innerHTML : '';
	let debounceTimer;

	if (searchToggleBtn) {
		searchToggleBtn.onclick = (e) => {
			e.stopPropagation();
			const isSearching = searchInput.style.display === 'block';

			if (isSearching) {
				searchInput.style.display = 'none';
				instructionText.style.display = 'block';
				resultsContainer.style.display = 'none';
			} else {
				searchInput.style.display = 'block';
				instructionText.style.display = 'none';
				searchInput.focus();
			}
		};
	}

	searchInput.addEventListener('input', (e) => {
		clearTimeout(debounceTimer);
		const query = e.target.value.trim();

		if (query.length < 3) {
			resultsContainer.style.display = 'none';
			return;
		}

		debounceTimer = setTimeout(async () => {
			if (searchToggleBtn) {
				searchToggleBtn.innerHTML = '<div class="loader-spinner"></div>';
			}

			try {
				const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
				const data = await response.json();

				resultsContainer.innerHTML = '';
				if (data.length > 0) {
					data.forEach(item => {
						const div = document.createElement('div');
						div.textContent = item.display_name;
						div.style.padding = '10px';
						div.style.cursor = 'pointer';
						div.onclick = () => {
							const lon = parseFloat(item.lon);
							const lat = parseFloat(item.lat);

							const viewer = getViewer();
							const position = Cesium.Cartesian3.fromDegrees(lon, lat);

							state.lon = lon;
							state.lat = lat;
							state.alt = 1500;

							const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
							Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic])
								.then(([p]) => {
									state.alt = Math.max(0, p.height || 0) + 1500;
								})
								.catch(() => { });

							viewer.camera.flyTo({
								destination: Cesium.Cartesian3.fromDegrees(lon, lat, 15000),
								duration: 1.5
							});

							if (spawnMarker) {
								viewer.entities.remove(spawnMarker);
							}
							spawnMarker = viewer.entities.add({
								position: position,
								point: {
									pixelSize: 15,
									color: Cesium.Color.RED,
									outlineColor: Cesium.Color.WHITE,
									outlineWidth: 2,
									disableDepthTestDistance: Number.POSITIVE_INFINITY
								},
								label: {
									text: item.display_name.split(',')[0],
									font: "14pt AceCombat",
									style: Cesium.LabelStyle.FILL_AND_OUTLINE,
									outlineWidth: 2,
									verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
									pixelOffset: new Cesium.Cartesian2(0, -20),
									disableDepthTestDistance: Number.POSITIVE_INFINITY
								}
							});

							confirmSpawnBtn.classList.remove('hidden');
							resultsContainer.style.display = 'none';

							searchInput.style.display = 'none';
							instructionText.style.display = 'block';
							searchInput.value = item.display_name;
						};
						resultsContainer.appendChild(div);
					});
					resultsContainer.style.display = 'block';
				} else {
					resultsContainer.style.display = 'none';
				}
			} catch (error) {
				console.error('Search error:', error);
			} finally {
				if (searchToggleBtn) {
					searchToggleBtn.innerHTML = originalSearchIcon;
				}
			}
		}, 500);
	});

	document.addEventListener('click', (e) => {
		if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target) && !searchToggleBtn.contains(e.target)) {
			resultsContainer.style.display = 'none';
			if (searchInput.style.display === 'block') {
				searchInput.style.display = 'none';
				instructionText.style.display = 'block';
			}
		}
	});
}

document.getElementById('confirmSpawnBtn').onclick = () => {
	const vignette = document.getElementById('transition-vignette');
	if (vignette) vignette.style.opacity = '1';

	soundManager.play('spawn');

	setTimeout(() => {
		const viewer = getViewer();
		if (spawnMarker) {
			viewer.entities.remove(spawnMarker);
			spawnMarker = null;
		}

		setControlsEnabled(false);

		state.speed = 100;
		state.pitch = 0;
		state.roll = 0;
		state.heading = 0;

		visualOffset.copy(BASE_PLANE_POS);
		visualRotation.set(0, 0, 0);
		boostRoll = 0;
		currentBoostZOffset = 0;
		lastIsBoosting = false;

		controller.reset();
		physics = new PlanePhysics();
		physics.reset(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);

		hud.resetTime();
		hud.resizeMinimap();

		spawnInstruction.classList.add('hidden');
		confirmSpawnBtn.classList.add('hidden');

		currentState = States.TRANSITIONING;

		viewer.camera.flyTo({
			destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt),
			orientation: {
				heading: Cesium.Math.toRadians(state.heading),
				pitch: Cesium.Math.toRadians(state.pitch),
				roll: Cesium.Math.toRadians(state.roll)
			},
			duration: 2.0,
			easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
			complete: () => {
				flightStartTime = Date.now();
				uiContainer.classList.remove('hidden');
				threeContainer.classList.remove('hidden');
				hud.resizeMinimap();
				currentState = States.FLYING;
				soundManager.play('jet-engine', 1.0);
				if (vignette) vignette.style.opacity = '0';
			}
		});
	}, 500);
};

window.addEventListener('keydown', (e) => {
	const key = e.key.toLowerCase();
	if (key === 'escape') {
		const openModals = document.querySelectorAll('.modal:not(.hidden)');
		if (openModals.length > 0) {
			openModals.forEach(m => m.classList.add('hidden'));
			return;
		}
	}

	if (key === 'escape' || key === 'p') {
		if (currentState === States.FLYING) {
			currentState = States.PAUSED;
			uiContainer.classList.add('hidden');
			pauseMenu.classList.remove('hidden');
			stopAllFlyingSounds(0.3);
		} else if (currentState === States.PAUSED) {
			currentState = States.FLYING;
			pauseMenu.classList.add('hidden');
			uiContainer.classList.remove('hidden');
			soundManager.play('jet-engine', 0.5);
		} else if (currentState === States.PICK_SPAWN && key === 'escape') {
			exitSpawnPicking();
		}
	}
});

document.addEventListener('visibilitychange', () => {
	if (document.hidden && currentState === States.FLYING) {
		currentState = States.PAUSED;
		uiContainer.classList.add('hidden');
		pauseMenu.classList.remove('hidden');
		stopAllFlyingSounds(0.3);
	}
});

window.addEventListener('blur', () => {
	if (currentState === States.FLYING) {
		currentState = States.PAUSED;
		uiContainer.classList.add('hidden');
		pauseMenu.classList.remove('hidden');
		stopAllFlyingSounds(0.3);
	}
});

const viewer = initCesium();

const resumeAudio = () => {
	if (soundManager.listener.context.state === 'suspended') {
		soundManager.listener.context.resume();
	}
	window.removeEventListener('mousedown', resumeAudio);
	window.removeEventListener('keydown', resumeAudio);
};
window.addEventListener('mousedown', resumeAudio);
window.addEventListener('keydown', resumeAudio);

initialCameraView = {
	destination: viewer.camera.position.clone(),
	orientation: {
		heading: viewer.camera.heading,
		pitch: viewer.camera.pitch,
		roll: viewer.camera.roll
	}
};

initThree();
setupSpawnPicker();
setupLocationSearch();
loadSettings();

uiContainer.classList.add('hidden');
threeContainer.classList.add('hidden');

animate();

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);

	const viewer = getViewer();
	if (viewer) viewer.resize();
});
