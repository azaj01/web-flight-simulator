import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initCesium, setCameraToPlane, getViewer, setControlsEnabled } from './world/cesiumWorld';
import { PlanePhysics } from './plane/planePhysics';
import { PlaneController } from './plane/planeController';
import { movePosition } from './utils/math';
import { HUD } from './ui/hud';
import * as Cesium from 'cesium';

// Game States
const States = {
	MENU: 'MENU',
	PICK_SPAWN: 'PICK_SPAWN',
	TRANSITIONING: 'TRANSITIONING',
	FLYING: 'FLYING',
	PAUSED: 'PAUSED',
	CRASHED: 'CRASHED'
};

let currentState = States.MENU;

// Game Settings
let gameSettings = {
	graphicsQuality: 'medium',
	antialiasing: true,
	fogEffects: true,
	fov: 75,
	mouseSensitivity: 0.2,
	showHud: true
};

// Load settings from localStorage
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
}

function applySettings() {
	// Apply FOV to Three.js camera
	if (camera) {
		camera.fov = gameSettings.fov;
		camera.updateProjectionMatrix();
	}

	// Apply mouse sensitivity
	if (controller) {
		controller.setSensitivity(gameSettings.mouseSensitivity);
	}

	// Apply settings to Cesium
	const viewer = getViewer();
	if (viewer) {
		// Graphics Quality
		if (gameSettings.graphicsQuality === 'low') {
			viewer.resolutionScale = 0.5;
			viewer.scene.globe.maximumScreenSpaceError = 4;
		} else if (gameSettings.graphicsQuality === 'medium') {
			viewer.resolutionScale = 1.0;
			viewer.scene.globe.maximumScreenSpaceError = 2;
		} else {
			viewer.resolutionScale = window.devicePixelRatio;
			viewer.scene.globe.maximumScreenSpaceError = 1.3;
		}

		// Anti-aliasing
		viewer.scene.postProcessStages.fxaa.enabled = gameSettings.antialiasing;

		// Fog
		viewer.scene.fog.enabled = gameSettings.fogEffects;
		viewer.scene.atmosphere.show = gameSettings.fogEffects;
	}

	// HUD visibility
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

// Flight State
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
let mixer, clock;
let physics = new PlanePhysics();
let controller = new PlaneController();
let hud = new HUD();

// FPS calculation
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = 0;

// Visual Inertia Constants
const BASE_PLANE_POS = new THREE.Vector3(0, -0.8, -2.75);
let visualOffset = new THREE.Vector3().copy(BASE_PLANE_POS);
let visualRotation = new THREE.Euler(0, 0, 0);
let boostRoll = 0;
let currentBoostZOffset = 0;
let boostRollDirection = 1;
let lastIsBoosting = false;
let lastSpeed = 0;
let initialCameraView = null;

// DOM Elements
const mainMenu = document.getElementById('mainMenu');
const pauseMenu = document.getElementById('pauseMenu');
const crashMenu = document.getElementById('crashMenu');
const uiContainer = document.getElementById('uiContainer');
const threeContainer = document.getElementById('threeContainer');
const spawnInstruction = document.getElementById('spawnInstruction');
const confirmSpawnBtn = document.getElementById('confirmSpawnBtn');

let spawnMarker = null;

function initThree() {
	clock = new THREE.Clock();
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setClearColor(0x000000, 0); // Ensure full transparency
	threeContainer.appendChild(renderer.domElement);
	
	threeContainer.classList.add('hidden'); // Start hidden

	const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
	directionalLight.position.set(5, 10, 5);
	scene.add(directionalLight);

	const loader = new GLTFLoader();
	loader.load('/assets/models/low_poly_f-15.glb', (gltf) => {
		const mesh = gltf.scene;
		
		// Create a wrapper group to fix orientation
		planeModel = new THREE.Group();
		planeModel.add(mesh);
		scene.add(planeModel);

		// Fix the model's internal rotation (it was facing sideways)
		mesh.rotation.y = Math.PI / 2; 

		// Center the model so it rotates around its fuselage
		const box = new THREE.Box3().setFromObject(mesh);
		const center = box.getCenter(new THREE.Vector3());
		mesh.position.sub(center);
		
		// Position relative to camera (Chase View)
		planeModel.position.copy(BASE_PLANE_POS);
		planeModel.scale.set(0.2, 0.2, 0.2); 
		
		// Setup Animation - Using static pose 'F15 ldg'
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

	// Check for crash
	checkCrash();

	// New HUD Update
	hud.update(state);

	// Calculate camera orientation local to plane
	const planeHPR = new Cesium.HeadingPitchRoll(
		Cesium.Math.toRadians(state.heading),
		Cesium.Math.toRadians(state.pitch),
		Cesium.Math.toRadians(state.roll)
	);
	const planeQuat = Cesium.Quaternion.fromHeadingPitchRoll(planeHPR);

	// Mouse orbit as a local rotation
	const orbitHPR = new Cesium.HeadingPitchRoll(
		Cesium.Math.toRadians(input.cameraYaw),
		Cesium.Math.toRadians(-input.cameraPitch),
		0
	);
	const orbitQuat = Cesium.Quaternion.fromHeadingPitchRoll(orbitHPR);

	// Combine: plane orientation * orbit offset
	const finalQuat = Cesium.Quaternion.multiply(planeQuat, orbitQuat, new Cesium.Quaternion());
	const finalHPR = Cesium.HeadingPitchRoll.fromQuaternion(finalQuat);

	setCameraToPlane(
		state.lon, state.lat, state.alt, 
		Cesium.Math.toDegrees(finalHPR.heading),
		Cesium.Math.toDegrees(finalHPR.pitch),
		Cesium.Math.toDegrees(finalHPR.roll)
	);

	if (planeModel) {
		// --- INERTIA EFFECTS ---
		// 1. Longitudinal (Speed/Accel)
		const accel = (state.speed - prevSpeed) / dt;
		// Forward offset (away from camera) on acceleration, backward on braking
		// We clamp this effect so post-boost deceleration doesn't throw the plane out of frame
		const accelInertia = input.isDragging ? 0 : Math.max(-0.5, Math.min(1.5, accel * 0.001));
		let targetZ = BASE_PLANE_POS.z - accelInertia; 

		// --- BOOST ANIMATION LOGIC ---
		let boostZOffset = 0;
		if (physicsResult.isBoosting) {
			if (!lastIsBoosting) {
				boostRollDirection = Math.random() > 0.5 ? 1 : -1;
			}
			
			const T = physicsResult.boostDuration; 
			const p = Math.max(0, Math.min(1.0, 1.0 - (physicsResult.boostTimeRemaining / T))); 

			const totalRotationRad = Math.PI * 2 * physicsResult.boostRotations * boostRollDirection;

			// Phase 1: Forward Surge (0% - 20%)
			if (p < 0.2) {
				const localP = p / 0.2;
				boostZOffset = -(localP * localP) * 1.5; 
				boostRoll = 0;
			} 
			// Phase 2: Barrel Roll (20% - 80%)
			else if (p < 0.8) {
				const localP = (p - 0.2) / 0.6;
				boostZOffset = -1.5;
				// Cubic Ease In-Out: slow-fast-slow
				const easedP = localP < 0.5 
					? 4 * localP * localP * localP 
					: 1 - Math.pow(-2 * localP + 2, 3) / 2;
				// Gunakan perkalian Math.PI * 2 (Satu putaran penuh)
				boostRoll = easedP * (Math.PI * 2 * physicsResult.boostRotations) * boostRollDirection;
			} 
			// Phase 3: Retreat (80% - 100%)
			else {
				const localP = (p - 0.8) / 0.2;
				// Use a very subtle smooth return, but don't come all the way back
				// This keeps the plane at a safer distance from the camera
				const easedReturn = localP * localP * (3 - 2 * localP);
				boostZOffset = -1.5 + (easedReturn * 0.7); // Ends at -0.8 instead of 0
				boostRoll = (Math.PI * 2 * physicsResult.boostRotations) * boostRollDirection;
			}
		} else {
			boostRoll = 0;
			boostZOffset = 0;
		}
		lastIsBoosting = physicsResult.isBoosting;
		
		// Smoothly interpolate the boost Z offset to prevent snapping
		const zLerp = physicsResult.isBoosting ? 10.0 * dt : 2.0 * dt;
		currentBoostZOffset += (boostZOffset - currentBoostZOffset) * zLerp;
		targetZ += currentBoostZOffset;

		// 2. Lateral/Vertical (Pitch/Roll/Yaw)
		// Model shifts slightly in frame when maneuvering
		// Disable inertia during mouse dragging for absolute center spectate
		const targetX = input.isDragging ? BASE_PLANE_POS.x : BASE_PLANE_POS.x - (input.roll * 0.6) - (input.yaw * 0.12);
		const targetY = input.isDragging ? BASE_PLANE_POS.y : BASE_PLANE_POS.y - (input.pitch * 0.1);
		
		// 3. Rotation Lag
		let targetRotZ = input.isDragging ? 0 : THREE.MathUtils.degToRad(-input.roll * 15);
		const targetRotX = input.isDragging ? 0 : THREE.MathUtils.degToRad(input.pitch * 10);
		const targetRotY = input.isDragging ? 0 : THREE.MathUtils.degToRad(-input.yaw * 4);

		// Smooth transition (Spring-like lerp)
		const lerpFactor = physicsResult.isBoosting ? 3.0 * dt : 5.0 * dt; // Slower lag during boost for effect
		visualOffset.x += (targetX - visualOffset.x) * lerpFactor;
		visualOffset.y += (targetY - visualOffset.y) * lerpFactor;
		visualOffset.z += (targetZ - visualOffset.z) * lerpFactor;
		
		visualRotation.z += (targetRotZ - visualRotation.z) * lerpFactor;
		visualRotation.x += (targetRotX - visualRotation.x) * lerpFactor;
		visualRotation.y += (targetRotY - visualRotation.y) * lerpFactor;

		// Apply mouse camera orbit
		// Calculate camera relative orientation to plane
		const orbitQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(
				THREE.MathUtils.degToRad(-input.cameraPitch),
				THREE.MathUtils.degToRad(-input.cameraYaw),
				0,
				'YXZ'
			)
		);
		
		// Locked position: keep model in the middle, don't orbit position vector
		planeModel.position.copy(visualOffset);
		
		// Flight lag/inertia orientation
		const flightLagQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(visualRotation.x, visualRotation.y, visualRotation.z + boostRoll)
		);
		
		// Final model rotation = Inverted camera orbit * Flight lag
		// This ensures the model perspective always matches the Cesium camera viewpoint
		const combinedQ = orbitQ.clone().invert().multiply(flightLagQ);
		planeModel.quaternion.copy(combinedQ);
	}
}

let lastCrashCheck = 0;
let flightStartTime = 0;

function checkCrash() {
	if (currentState !== States.FLYING) return;
	
	const now = Date.now();
	if (now - lastCrashCheck < 100) return; // Only check 10 times per second
	lastCrashCheck = now;

	// Grace period: ignore crashes for first 3 seconds to allow terrain to load
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
	}
}

function animate() {
	requestAnimationFrame(animate);
	
	const dt = clock ? clock.getDelta() : 0.016;
	const now = performance.now();
	
	// FPS Calculation
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
		
		// Plane is rendered, but update() is only called in FLYING state
		// During TRANSITIONING, camera is moved by Cesium flyTo
		renderer.render(scene, camera);
	} else {
		threeContainer.classList.add('hidden');
	}
}

// UI Handlers
function setupModalListeners() {
	const modals = document.querySelectorAll('.modal');
	
	const closeAllModals = () => {
		modals.forEach(m => m.classList.add('hidden'));
	};

	// Open Modals
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

	// Options Logic
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
		
		saveSettings();
		applySettings();
		closeAllModals();
	};

	// Close Modals
	document.querySelectorAll('.close-modal').forEach(btn => {
		btn.onclick = (e) => {
			e.stopPropagation();
			btn.closest('.modal').classList.add('hidden');
		};
	});

	// Close on click outside
	window.addEventListener('click', (event) => {
		if (event.target.classList.contains('modal')) {
			event.target.classList.add('hidden');
		}
	});
}

document.getElementById('startBtn').onclick = () => {
	// Close any open modals when starting the game
	document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
	mainMenu.classList.add('hidden');
	enterSpawnPicking(false); // No vignette from main menu
};

// Initialize modal listeners
setupModalListeners();

document.getElementById('resumeBtn').onclick = () => {
	pauseMenu.classList.add('hidden');
	uiContainer.classList.remove('hidden');
	currentState = States.FLYING;
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
	const vignette = document.getElementById('transition-vignette');
	if (useVignette && vignette) vignette.style.opacity = '1';

	const delay = useVignette ? 500 : 0;

	setTimeout(() => {
		spawnInstruction.classList.remove('hidden');
		threeContainer.classList.add('hidden');
		uiContainer.classList.add('hidden');
		currentState = States.PICK_SPAWN;
		confirmSpawnBtn.classList.add('hidden');
		
		setControlsEnabled(true);
		
		if (spawnMarker) {
			const viewer = getViewer();
			viewer.entities.remove(spawnMarker);
			spawnMarker = null;
		}

		const viewer = getViewer();
		viewer.camera.flyTo({
			destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, 15000),
			duration: 1.5,
			complete: () => {
				if (vignette) vignette.style.opacity = '0';
			}
		});
	}, delay);
}

function exitSpawnPicking() {
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
		duration: 1.5
	});
}

// Spawn logic
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
			
			// Refine altitude asynchronously
			Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic])
				.then(([p]) => state.alt = Math.max(0, p.height || 0) + 1500)
				.catch(() => {});
			
			// Visual marker
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

document.getElementById('confirmSpawnBtn').onclick = () => {
	const vignette = document.getElementById('transition-vignette');
	if (vignette) vignette.style.opacity = '1';

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

		// Reset visual inertia
		visualOffset.copy(BASE_PLANE_POS);
		visualRotation.set(0, 0, 0);
		boostRoll = 0;
		currentBoostZOffset = 0;
		lastIsBoosting = false;
		
		// Reset physics and controls
		controller.reset();
		physics = new PlanePhysics();
		physics.reset(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);
		
		hud.resetTime();
		hud.resizeMinimap(); 
		
		spawnInstruction.classList.add('hidden');
		confirmSpawnBtn.classList.add('hidden');
		
		currentState = States.TRANSITIONING;

		// Beautiful fly-in transition to cockpit
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
				if (vignette) vignette.style.opacity = '0';
			}
		});
	}, 500);
};

// Keyboard for Pause
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		// Check for open modals first
		const openModals = document.querySelectorAll('.modal:not(.hidden)');
		if (openModals.length > 0) {
			openModals.forEach(m => m.classList.add('hidden'));
			return; // Stop here, we only wanted to close the modal
		}
	}

	if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
		if (currentState === States.FLYING) {
			currentState = States.PAUSED;
			uiContainer.classList.add('hidden');
			pauseMenu.classList.remove('hidden');
		} else if (currentState === States.PAUSED) {
			currentState = States.FLYING;
			pauseMenu.classList.add('hidden');
			uiContainer.classList.remove('hidden');
		} else if (currentState === States.PICK_SPAWN && e.key === 'Escape') {
			exitSpawnPicking();
		}
	}
});

// Auto-Pause when switching tabs or windows
document.addEventListener('visibilitychange', () => {
	if (document.hidden && currentState === States.FLYING) {
		currentState = States.PAUSED;
		uiContainer.classList.add('hidden');
		pauseMenu.classList.remove('hidden');
	}
});

window.addEventListener('blur', () => {
	if (currentState === States.FLYING) {
		currentState = States.PAUSED;
		uiContainer.classList.add('hidden');
		pauseMenu.classList.remove('hidden');
	}
});

const viewer = initCesium();

// Capture initial camera view for returning to menu
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
loadSettings(); // Initialization settings

// Ensure everything is hidden at start
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
