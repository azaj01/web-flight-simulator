import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initCesium, setCameraToPlane, getViewer } from './world/cesiumWorld';
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

// Visual Inertia Constants
const BASE_PLANE_POS = new THREE.Vector3(0, -0.8, -2.75);
let visualOffset = new THREE.Vector3().copy(BASE_PLANE_POS);
let visualRotation = new THREE.Euler(0, 0, 0);
let boostRoll = 0;
let currentBoostZOffset = 0;
let boostRollDirection = 1;
let lastIsBoosting = false;
let lastSpeed = 0;

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

	setCameraToPlane(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);

	if (planeModel) {
		// --- INERTIA EFFECTS ---
		// 1. Longitudinal (Speed/Accel)
		const accel = (state.speed - prevSpeed) / dt;
		// Forward offset (away from camera) on acceleration, backward on braking
		// We clamp this effect so post-boost deceleration doesn't throw the plane out of frame
		const accelInertia = Math.max(-0.5, Math.min(1.5, accel * 0.001));
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
		const targetX = BASE_PLANE_POS.x - (input.roll * 0.6) - (input.yaw * 0.12);
		const targetY = BASE_PLANE_POS.y - (input.pitch * 0.1);
		
		// 3. Rotation Lag
		let targetRotZ = THREE.MathUtils.degToRad(-input.roll * 15);
		const targetRotX = THREE.MathUtils.degToRad(input.pitch * 10);
		const targetRotY = THREE.MathUtils.degToRad(-input.yaw * 4);

		// Smooth transition (Spring-like lerp)
		const lerpFactor = physicsResult.isBoosting ? 3.0 * dt : 5.0 * dt; // Slower lag during boost for effect
		visualOffset.x += (targetX - visualOffset.x) * lerpFactor;
		visualOffset.y += (targetY - visualOffset.y) * lerpFactor;
		visualOffset.z += (targetZ - visualOffset.z) * lerpFactor;
		
		visualRotation.z += (targetRotZ - visualRotation.z) * lerpFactor;
		visualRotation.x += (targetRotX - visualRotation.x) * lerpFactor;
		visualRotation.y += (targetRotY - visualRotation.y) * lerpFactor;

		planeModel.position.copy(visualOffset);
		planeModel.rotation.set(visualRotation.x, visualRotation.y, visualRotation.z + boostRoll);
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
document.getElementById('startBtn').onclick = () => {
	mainMenu.classList.add('hidden');
	enterSpawnPicking(false); // No vignette from main menu
};

document.getElementById('optionsBtn').onclick = () => {
	alert('Options: \n- Controls: WASD/Arrows\n- Camera: Follow\n- Sensitivity: 1.0\n(Work in Progress)');
};

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
			
			// Ensure terrain height is at least sea level (0) for safety
			const terrainHeight = Math.max(0, cartographic.height);
			
			// Update pending state
			state.lon = lon;
			state.lat = lat;
			state.alt = terrainHeight + 1500; // Start at ~5000ft (1500m) for breathing room
			
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

		state.speed = 150;
		state.pitch = 0;
		state.roll = 0;
		state.heading = 0;
		
		// Reset physics and set initial orientation
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

		// Minor delay to show threeContainer slightly before flight starts so it blends
		setTimeout(() => {
			if (currentState === States.TRANSITIONING) {
				threeContainer.classList.remove('hidden');
			}
		}, 1500);
	}, 500);
};

// Keyboard for Pause
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
		if (currentState === States.FLYING) {
			currentState = States.PAUSED;
			uiContainer.classList.add('hidden');
			pauseMenu.classList.remove('hidden');
		} else if (currentState === States.PAUSED) {
			currentState = States.FLYING;
			pauseMenu.classList.add('hidden');
			uiContainer.classList.remove('hidden');
		}
	}
});

const viewer = initCesium();
initThree();
setupSpawnPicker();

// Ensure everything is hidden at start
uiContainer.classList.add('hidden');
threeContainer.classList.add('hidden');

animate();

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
